import asyncio
import logging
import re
import base64
from typing import Optional, List, Tuple
from datetime import datetime, timezone, timedelta
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import aiosmtplib
import uuid
import email
from email.message import EmailMessage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from email.utils import make_msgid, parseaddr
from imapclient import IMAPClient
from incidents.database import AsyncSessionLocal

DEFAULT_SIGNATURE_HTML = """
<div style="margin-top: 16px; padding-top: 0px;">
    <p style="font-size: 12px; color: #57606a; margin-bottom: 8px;">Alticyber SOC Notification.</p>
    <p style="font-size: 13px; font-weight: 700; color: #000000; margin: 0;">Thanks and Regards</p>
    <p style="font-size: 13px; font-weight: 700; color: #000000; margin: 4px 0 0 0;">Alticyber Technologies PVT LTD</p>
</div>
"""

DEFAULT_SIGNATURE_TEXT = "\n\nThanks and Regards\nAlticyber Technologies PVT LTD"


logger = logging.getLogger("incidents.mailing")


def extract_base64_images_for_cid(html: str):
    """
    Scans HTML for base64 data: image URLs (src="data:image/TYPE;base64,DATA"),
    replaces each with a cid: reference, and returns the modified HTML plus a list
    of (cid, raw_bytes, mime_subtype) tuples ready to attach as inline parts.
    This is necessary because email clients (Outlook, Gmail, etc.) block data: URIs.
    """
    pattern = re.compile(r'src="data:image/([^;]+);base64,([A-Za-z0-9+/=]+)"', re.IGNORECASE)
    inline_images: list = []

    def _replace(m):
        mime_subtype = m.group(1).lower().replace('jpeg', 'jpeg')
        b64_data = m.group(2)
        cid = f"sig_img_{uuid.uuid4().hex[:12]}@soc"
        try:
            img_bytes = base64.b64decode(b64_data)
        except Exception:
            return m.group(0)  # leave unchanged on decode error
        inline_images.append((cid, img_bytes, mime_subtype))
        return f'src="cid:{cid}"'

    modified_html = pattern.sub(_replace, html)
    return modified_html, inline_images


async def embed_images_as_base64(html: str) -> str:
    """Replaces <img src="http(s)://..."> URLs in HTML with base64 data URIs so
    images render correctly in email clients that block external resources."""
    import httpx

    img_pattern = re.compile(r'(<img\b[^>]*?\bsrc=")([^"]+)(")', re.IGNORECASE)
    matches = list(img_pattern.finditer(html))
    if not matches:
        return html

    async def fetch_as_data_uri(url: str) -> Optional[str]:
        # Already a data URI – nothing to do
        if url.startswith("data:"):
            return url
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    mime = resp.headers.get("content-type", "image/png").split(";")[0]
                    b64 = base64.b64encode(resp.content).decode()
                    return f"data:{mime};base64,{b64}"
        except Exception as exc:
            logger.warning(f"Could not embed image {url}: {exc}")
        return None

    # Fetch all images concurrently
    urls = [m.group(2) for m in matches]
    data_uris = await asyncio.gather(*[fetch_as_data_uri(u) for u in urls])

    # Replace in reverse order to keep offsets stable
    result = html
    for match, data_uri in zip(reversed(matches), reversed(data_uris)):
        if data_uri:
            result = result[:match.start(2)] + data_uri + result[match.end(2):]
    return result


import uuid
def is_uuid(val: str) -> bool:
    try:
        uuid.UUID(str(val))
        return True
    except (ValueError, TypeError):
        return False

async def get_mailing_config(db: AsyncSession, tenant_id: str, level_number: Optional[int] = None):
    # Try to get config for specific level
    if level_number is not None:
        result = await db.execute(
            text("SELECT * FROM public.mailing_configs WHERE tenant_id = :tid AND level_number = :lvl AND is_active = TRUE"),
            {"tid": tenant_id, "lvl": level_number}
        )
        cfg = result.mappings().first()
        if cfg:
            return cfg

    # Fallback 1: config with no level (default / generic)
    result = await db.execute(
        text("SELECT * FROM public.mailing_configs WHERE tenant_id = :tid AND level_number IS NULL AND is_active = TRUE"),
        {"tid": tenant_id}
    )
    cfg = result.mappings().first()
    if cfg:
        return cfg

    # Fallback 2: any active config for this tenant (e.g. level_number = 1)
    result = await db.execute(
        text("SELECT * FROM public.mailing_configs WHERE tenant_id = :tid AND is_active = TRUE ORDER BY level_number ASC NULLS LAST LIMIT 1"),
        {"tid": tenant_id}
    )
    return result.mappings().first()


async def get_user_default_signature(db: AsyncSession, user_id: str, type: str = 'new') -> Optional[dict]:
    """Fetches the default rich text signature for a user."""
    try:
        col = "is_default_new" if type == 'new' else "is_default_reply"
        sql = text(f"SELECT name, content FROM public.user_signatures WHERE user_id = :uid AND {col} = TRUE LIMIT 1")
        res = await db.execute(sql, {"uid": user_id})
        row = res.fetchone()
        if row:
            return {"name": row[0], "content": row[1]}
        return None
    except Exception as e:
        logger.warning(f"Error fetching rich signature for {user_id}: {e}")
        return None

def generate_incident_html(incident, level_number: int = 1):
    """Generates a rich HTML template for incident notifications."""
    raw = incident.get("raw_payload", {}) or {}
    if isinstance(raw, str):
        try:
            import json
            raw = json.loads(raw)
        except:
            raw = {}

    sev = incident["severity"].lower()
    sev_color = "#f85149" if sev == "critical" else "#f0883e" if sev == "high" else "#d29922" if sev == "medium" else "#3fb950"
    
    # Helper for tables
    def row(label, value):
        return f"""
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #d0d7de; color: #57606a; width: 30%; font-size: 12px; font-weight: 600; text-transform: uppercase;">{label}</td>
            <td style="padding: 10px; border-bottom: 1px solid #d0d7de; color: #24292f; font-size: 13px;">{value or '—'}</td>
        </tr>
        """

    # Asset Details table
    assets_html = ""
    assets = raw.get("asset_details", [])
    if assets:
        assets_rows = "".join([f"""
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #d0d7de; font-size: 12px; color: #24292f;">{a.get('detection_method','—')}</td>
                <td style="padding: 8px; border-bottom: 1px solid #d0d7de; font-size: 12px; color: #24292f;">{a.get('source_ip','—')}</td>
                <td style="padding: 8px; border-bottom: 1px solid #d0d7de; font-size: 12px; color: #24292f;">{a.get('log_source','—')}</td>
                <td style="padding: 8px; border-bottom: 1px solid #d0d7de; font-size: 12px; color: #24292f;">{a.get('action','—')}</td>
            </tr>
        """ for a in assets])
        assets_html = f"""
        <div style="margin-top: 20px;">
            <table style="width: 100%; border-collapse: collapse; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; overflow: hidden;">
                <thead>
                    <tr style="background: #f3f4f6;">
                        <th style="padding: 8px; text-align: left; font-size: 11px; color: #57606a; text-transform: uppercase;">Detection Method</th>
                        <th style="padding: 8px; text-align: left; font-size: 11px; color: #57606a; text-transform: uppercase;">Source IP</th>
                        <th style="padding: 8px; text-align: left; font-size: 11px; color: #57606a; text-transform: uppercase;">Log Source</th>
                        <th style="padding: 8px; text-align: left; font-size: 11px; color: #57606a; text-transform: uppercase;">Action</th>
                    </tr>
                </thead>
                <tbody>{assets_rows}</tbody>
            </table>
        </div>
        """

    # IOCs table
    iocs_html = ""
    iocs = raw.get("iocs", [])
    if iocs:
        iocs_rows = "".join([f"""
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #d0d7de; font-size: 12px; color: #24292f;">{i.get('signature', i if isinstance(i, str) else '—')}</td>
                <td style="padding: 8px; border-bottom: 1px solid #d0d7de; font-size: 12px; color: #24292f;">{i.get('domain_name','—') if isinstance(i, dict) else '—'}</td>
                <td style="padding: 8px; border-bottom: 1px solid #d0d7de; font-size: 12px; color: #24292f;">{i.get('category','—') if isinstance(i, dict) else '—'}</td>
            </tr>
        """ for i in iocs])
        iocs_html = f"""
        <div style="margin-top: 20px;">
             <p style="font-size: 12px; font-weight: 700; color: #57606a; text-transform: uppercase; margin-bottom: 8px;">Indicators of Compromise (IOCs)</p>
            <table style="width: 100%; border-collapse: collapse; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; overflow: hidden;">
                <thead>
                    <tr style="background: #f3f4f6;">
                        <th style="padding: 8px; text-align: left; font-size: 11px; color: #57606a; text-transform: uppercase;">Signature</th>
                        <th style="padding: 8px; text-align: left; font-size: 11px; color: #57606a; text-transform: uppercase;">Domain Name</th>
                        <th style="padding: 8px; text-align: left; font-size: 11px; color: #57606a; text-transform: uppercase;">Category</th>
                    </tr>
                </thead>
                <tbody>{iocs_rows}</tbody>
            </table>
        </div>
        """

    # MITRE HTML
    mitre_html = ""
    mitre = raw.get("mitre_attack", [])
    if mitre:
        mitre_rows = "".join([f"""
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #d0d7de; font-size: 12px; color: #24292f;">{m.get('tactic','—')}</td>
                <td style="padding: 8px; border-bottom: 1px solid #d0d7de; font-size: 12px; color: #24292f;">{m.get('technique','—')}</td>
            </tr>
        """ for m in mitre])
        mitre_html = f"""
        <div style="margin-top: 20px;">
             <p style="font-size: 12px; font-weight: 700; color: #57606a; text-transform: uppercase; margin-bottom: 8px;">Mitre Att&ck</p>
            <table style="width: 100%; border-collapse: collapse; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; overflow: hidden;">
                <thead>
                    <tr style="background: #f3f4f6;">
                        <th style="padding: 8px; text-align: left; font-size: 11px; color: #57606a; text-transform: uppercase;">Tactic</th>
                        <th style="padding: 8px; text-align: left; font-size: 11px; color: #57606a; text-transform: uppercase;">Technique</th>
                    </tr>
                </thead>
                <tbody>{mitre_rows}</tbody>
            </table>
        </div>
        """

    def list_section(title, items):
        if not items: return ""
        li = "".join([f"<li style='margin-bottom: 5px; line-height: 1.6;'>{it.replace(chr(10), '<br>')}</li>" for it in items])
        return f"""
        <div style="margin-top: 20px;">
            <p style="font-size: 12px; font-weight: 700; color: #57606a; text-transform: uppercase; margin-bottom: 8px;">{title}</p>
            <ol style="color: #24292f; font-size: 13px; padding-left: 20px;">{li}</ol>
        </div>
        """

    html = f"""
    <!DOCTYPE html>
    <html>
    <body style="background-color: #ffffff; color: #24292f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #d0d7de; border-radius: 8px; padding: 24px;">
            
            <p style="font-size: 11px; color: #57606a; text-transform: uppercase; font-weight: 600; margin-bottom: 16px;">Please Keep the subject line unchanged</p>
            
            <h2 style="font-size: 18px; margin: 0 0 8px 0; color: #000000;">Hello Team,</h2>
            <p style="font-size: 14px; margin: 0 0 20px 0; color: #57606a;">Greetings from Alticyber SOC!</p>
            
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
                <span style="font-size: 16px; font-weight: 600; color: #24292f;">A</span>
                <span style="background: {sev_color}; color: #ffffff; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 800; text-transform: uppercase; margin: 0 8px;">{sev.upper()}</span>
                <span style="font-size: 16px; font-weight: 600; color: #24292f;">Severity Incident has been triggered.</span>
            </div>
            
            <p style="font-size: 13px; color: #57606a; margin-bottom: 24px;">We have observed a {sev.upper()} Severity Incident in your environment. Below are the initial details:</p>
            
            <table style="width: 100%; border-collapse: collapse; border: 1px solid #d0d7de; border-radius: 6px; overflow: hidden;">
                {row("Incident Severity", f'<span style="background: {sev_color}; color: #ffffff; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 800;">{sev.upper()}</span>')}
                {row("Incident Name", incident['title'])}
                {row("Incident ID", incident['ticket_id'])}
                {row("Alert ID", ", ".join(raw.get('alert_ids', [])))}
                {row("Incident Creation Timestamp", incident['created_at'].strftime('%-d/%-m/%Y, %-I:%M:%S %p') if isinstance(incident['created_at'], datetime) else incident['created_at'])}
                {row("Alert Arrival Timestamp", raw.get('alert_arrival_timestamp'))}
                {row("Description", incident['description'])}
                {row("Command Initiated", raw.get('command_initiated'))}
            </table>

            {assets_html}
            {iocs_html}
            {mitre_html}
            
            {list_section("Observations", raw.get('observations'))}
            {list_section("Business Impact", raw.get('business_impact'))}
            {list_section("Recommendations", raw.get('recommendations'))}

            <div style="margin-top: 30px; border-top: 1px solid #d0d7de; padding-top: 20px;">
                <p style="font-size: 13px; font-weight: 600; color: #24292f; margin-bottom: 12px;">To prevent any sort of malicious attack within the organization, it is recommended to take immediate action upon receiving this mail.</p>
                <p style="font-size: 13px; color: #57606a; margin-bottom: 24px;">In case of any queries or concerns, please let us know. We'll be glad to assist you.</p>
                {{SIGNATURE}}
            </div>


        </div>
    </body>
    </html>
    """
    return html


def render_custom_template(template: str, incident: dict, level_number: int = 1) -> str:
    """Very simple variable replacement for custom templates."""
    mapping = {
        "{{ticket_id}}": str(incident.get("ticket_id", "")),
        "{{title}}": str(incident.get("title", "")),
        "{{severity}}": str(incident.get("severity", "").upper()),
        "{{status}}": str(incident.get("status", "")),
        "{{description}}": str(incident.get("description", "")),
        "{{created_at}}": str(incident.get("created_at", "")),
        "{{level_number}}": str(level_number),
    }
    rendered = template
    for k, v in mapping.items():
        rendered = rendered.replace(k, v)
    return rendered

async def get_interaction_history(db: AsyncSession, incident_id: uuid.UUID) -> List[dict]:
    """Fetches all previous email interactions for this incident, ordered by creation date ascending."""
    res = await db.execute(
        text("""
            SELECT from_email, sender_name, created_at, body, direction, subject 
            FROM public.incident_email_interactions 
            WHERE incident_id = :iid 
            ORDER BY created_at ASC
        """),
        {"iid": incident_id}
    )
    return [dict(r) for r in res.mappings().all()]

def format_history_html(interactions: List[dict]) -> str:
    """Formats interactions into a Gmail-style quoted history for HTML emails."""
    if not interactions:
        return ""
    
    html = '<div style="margin-top: 30px; border-top: 1px solid #d0d7de; padding-top: 20px;">'
    # Process in reverse order for the trail (most recent at top of trail)
    for i in reversed(interactions):
        timestamp = i['created_at'].strftime('%a, %d %b %Y at %I:%M %p') if isinstance(i['created_at'], datetime) else str(i['created_at'])
        sender = i['sender_name'] if i['sender_name'] else i['from_email']
        
        attachments_line = f'<strong>Attachments:</strong> {i["attachment_names"]}<br>' if i.get("attachment_names") else ""
        
        html += f"""
        <div style="border-left: 2px solid #d0d7de; margin: 15px 0 15px 10px; padding-left: 15px; color: #57606a;">
            <p style="font-size: 12px; margin-bottom: 8px;">
                <strong>From:</strong> {sender}<br>
                <strong>Sent:</strong> {timestamp}<br>
                <strong>Subject:</strong> {i['subject'] or 'No Subject'}<br>
                {attachments_line}
            </p>
            <div style="font-size: 13px; color: #24292f; white-space: pre-wrap;">
                {i['body']}
            </div>
        </div>
        """
    html += '</div>'
    return html

def format_history_text(interactions: List[dict]) -> str:
    """Formats interactions into a plain-text quoted history."""
    if not interactions:
        return ""
    
    text_trail = "\n\n--- Message History ---\n"
    for i in reversed(interactions):
        timestamp = i['created_at'].strftime('%a, %d %b %Y at %I:%M %p') if isinstance(i['created_at'], datetime) else str(i['created_at'])
        sender = i['sender_name'] if i['sender_name'] else i['from_email']
        
        att_info = f"Attachments: {i['attachment_names']}\n" if i.get('attachment_names') else ""
        text_trail += f"\nFrom: {sender}\nSent: {timestamp}\nSubject: {i['subject'] or 'No Subject'}\n{att_info}"
        # Quote each line
        quoted_body = "\n".join([f"> {line}" for line in i['body'].splitlines()])
        text_trail += f"{quoted_body}\n"
        
    return text_trail


async def get_team_level_details(db: AsyncSession, team_id: str, level_number: int):
    # Fetch level
    l_res = await db.execute(
        text("SELECT id, escalation_time_min FROM public.team_escalation_levels WHERE team_id = :tid AND level_number = :num"),
        {"tid": team_id, "num": level_number}
    )
    level = l_res.mappings().first()
    if not level:
        return None, []
    
    # Fetch emails
    e_res = await db.execute(
        text("SELECT email FROM public.level_emails WHERE level_id = :lid"),
        {"lid": level["id"]}
    )
    emails = [r["email"] for r in e_res.mappings().all()]
    return level, emails

async def get_thread_subject(db: AsyncSession, incident_id: uuid.UUID) -> Optional[str]:
    """Retrieves the subject of the first email interaction for this incident to maintain threading consistency."""
    res = await db.execute(
        text("SELECT subject FROM public.incident_email_interactions WHERE incident_id = :iid ORDER BY created_at ASC LIMIT 1"),
        {"iid": incident_id}
    )
    row = res.fetchone()
    return row[0] if row else None

async def get_level_recipients(db: AsyncSession, team_id: str, level_number: int):
    # Fetch recipients for a specific level
    res = await db.execute(
        text("""
            SELECT e.email 
            FROM public.level_emails e
            JOIN public.team_escalation_levels l ON l.id = e.level_id
            WHERE l.team_id = :tid AND l.level_number = :num
        """),
        {"tid": team_id, "num": level_number}
    )
    return [r["email"] for r in res.mappings().all()]

async def get_all_previous_emails(db: AsyncSession, team_id: str, up_to_level: int):
    # Fetch all emails from level 1 up to level-1
    e_res = await db.execute(
        text("""
            SELECT e.email 
            FROM public.level_emails e
            JOIN public.team_escalation_levels l ON l.id = e.level_id
            WHERE l.team_id = :tid AND l.level_number < :num
        """),
        {"tid": team_id, "num": up_to_level}
    )
    return [r["email"] for r in e_res.mappings().all()]

async def send_incident_email(
    db: AsyncSession, 
    incident_id: str, 
    team_id: str, 
    level_number: int = 1,
    custom_cc: List[str] = None,
    attachments: List[dict] = None,
    custom_body: str = None,
    analyst_id: str = None
):
    # 1. Get incident details
    where_col = "id" if is_uuid(incident_id) else "ticket_id"
    if where_col == "id":
        sql = text("SELECT * FROM public.incidents WHERE id = CAST(:iid AS UUID)")
    else:
        sql = text("SELECT * FROM public.incidents WHERE ticket_id = :iid")
        
    i_res = await db.execute(sql, {"iid": incident_id})
    incident = i_res.mappings().first()
    if not incident:
        logger.error(f"Incident {incident_id} not found")
        return False

    tenant_id = str(incident["tenant_id"])
    parent_msg_id = incident.get("notification_message_id")
    
    # 2. Get mailing config
    config = await get_mailing_config(db, tenant_id, level_number)
    if not config:
        logger.warning(f"No active mailing config for tenant {tenant_id} (level {level_number})")
        return False

    # 3. Get level details
    level, recipients = await get_team_level_details(db, team_id, level_number)
    if not level or not recipients:
        logger.warning(f"No recipients found for team {team_id} level {level_number}")
        return False

    # 4. Recipients logic
    # To: Always Level 1 recipients
    to_recipients = await get_level_recipients(db, team_id, 1)
    
    # CC: Previous levels (from 2 up to current level) + Custom CCs
    cc_recipients = []
    if level_number >= 2:
        for lvl in range(2, level_number + 1):
            lvl_emails = await get_level_recipients(db, team_id, lvl)
            cc_recipients.extend(lvl_emails)
    
    if custom_cc:
        cc_recipients.extend(custom_cc)

    # De-duplicate
    to_recipients = list(set(to_recipients))
    cc_recipients = list(set(cc_recipients))

    if not to_recipients:
        logger.warning(f"No Level 1 recipients found for team {team_id}")
        return False

    # 5. Construct Email
    msg = EmailMessage()
    
    # Threading: Try to find original subject from first interaction
    existing_subject = await get_thread_subject(db, incident["id"])

    # Custom Template Support
    if existing_subject:
        # If this is an escalation (level > 1), ensure "Re: " prefix
        if level_number > 1:
            msg["Subject"] = existing_subject if existing_subject.lower().startswith("re:") else f"Re: {existing_subject}"
        else:
            msg["Subject"] = existing_subject
    elif config.get("template_subject"):
        msg["Subject"] = render_custom_template(config["template_subject"], incident, level_number)
    else:
        base_subject = f"[{incident['severity'].upper()}] Incident Alert: {incident['ticket_id']} - {incident['title']}"
        if level_number > 1 and parent_msg_id:
            msg["Subject"] = f"Re: {base_subject}"
        else:
            msg["Subject"] = base_subject
    
    
    new_msg_id = make_msgid(domain="alticyber.com")
    msg["Message-ID"] = new_msg_id
    msg["From"] = config["from_email"]
    msg["To"] = ", ".join(to_recipients)
    if cc_recipients:
        msg["Cc"] = ", ".join(cc_recipients)

    # 5a. Threading Headers: Build References chain
    history = await get_interaction_history(db, incident["id"])
    all_msg_ids = []
    if parent_msg_id:
        all_msg_ids.append(parent_msg_id if parent_msg_id.startswith('<') else f"<{parent_msg_id}>")
    
    for h in history:
        mid = h.get('message_id')
        if mid:
            fmt_mid = mid if mid.startswith('<') else f"<{mid}>"
            if fmt_mid not in all_msg_ids:
                all_msg_ids.append(fmt_mid)
    
    if all_msg_ids:
        msg["References"] = " ".join(all_msg_ids)
        msg["In-Reply-To"] = all_msg_ids[-1] # Reply to the latest known message

    escalation_prefix = f"ESCALATION LEVEL {level_number}: " if level_number > 1 else ""
    
    # Use custom HTML template if available
    html_body = None
    if config.get("template_html"):
        html_body = render_custom_template(config["template_html"], incident, level_number)
        # For text fallback, keep it simple
        text_body = f"{escalation_prefix}Incident Notification for {incident['ticket_id']}. Please view HTML version."
    else:
        if custom_body:
            text_body = custom_body
        else:
            text_body = f"""
{escalation_prefix}Incident Notification

Hello Team,

This is a {'Level ' + str(level_number) if level_number > 1 else 'initial'} notification for the following incident:

Ticket ID: {incident['ticket_id']}
Title: {incident['title']}
Severity: {incident['severity'].upper()}
Status: {incident['status']}
Created At: {incident['created_at']}

Description:
{incident['description']}

Please take necessary actions.

Thanks,
Alticyber SOC
"""
        try:
            html_body = generate_incident_html(incident, level_number)
            # If custom body exists, prepend it to the HTML or wrap it nicely
            if custom_body:
                html_body = html_body.replace(
                    '<h2 style="font-size: 18px; margin: 0 0 8px 0; color: #000000;">Hello Team,</h2>',
                    f'<div style="background: #f0f7ff; border: 1px solid #c9e3fe; border-radius: 6px; padding: 16px; margin-bottom: 24px; color: #24292f; font-size: 14px;">{custom_body.replace("\n", "<br>")}</div>'
                    '<h2 style="font-size: 18px; margin: 0 0 8px 0; color: #000000;">Hello Team,</h2>'
                )
        except Exception as e:
            logger.error(f"Failed to generate HTML template, falling back to text: {e}")

    # Fetch analyst signature if provided (Manual Send Email flow)
    sig_content_html = ""
    sig_content_text = ""
    if analyst_id:
        try:
            if isinstance(analyst_id, uuid.UUID) or is_uuid(str(analyst_id)):
                # 1. Try rich signature
                rich_signature = await get_user_default_signature(db, str(analyst_id), type='new')
                if rich_signature:
                    sig_content_html = f"<div class='rich-signature' style='margin-top: 16px;'>{rich_signature['content']}</div>"
                    sig_content_text = f"\n\n--\n{rich_signature['name']}"
                else:
                    # 2. Fallback to legacy
                    res = await db.execute(text("SELECT signature FROM public.users WHERE id = :uid"), {"uid": analyst_id})
                    row = res.fetchone()
                    if row and row[0]:
                        sig_content_html = f"<div style='color: #57606a; padding-top: 8px; margin-top: 8px; font-size: 13px;'>{row[0].replace(chr(10), '<br>')}</div>"
                        sig_content_text = f"\n\n--\n{row[0]}"
        except Exception as e:
            logger.warning(f"Could not fetch signature for analyst {analyst_id}: {e}")

    # Finalize bodies with signature (use default if none found)
    if not sig_content_html:
        sig_content_html = DEFAULT_SIGNATURE_HTML
        sig_content_text = DEFAULT_SIGNATURE_TEXT

    # Embed any external images in the signature as base64 data URIs so they
    # render correctly in email clients that block remote images.
    sig_content_html = await embed_images_as_base64(sig_content_html)

    if html_body:
        html_body = html_body.replace("{SIGNATURE}", sig_content_html)
    
    if sig_content_text:
        text_body += sig_content_text

    # 5b. Fetch and Append History (Already fetched for headers)
    history_html = format_history_html(history)
    history_text = format_history_text(history)

    # 5b-extra. Extract base64 images from HTML and replace with CID references
    # so they render correctly in Outlook, Gmail, and other clients that block data: URIs.
    inline_cid_images = []
    if html_body:
        full_html = html_body + history_html
        full_html_cid, inline_cid_images = extract_base64_images_for_cid(full_html)
        log_body = full_html  # store original for timeline (without cid swap)
    else:
        full_html_cid = None
        log_body = text_body + history_text

    if full_html_cid and inline_cid_images:
        # Build multipart/related > multipart/alternative structure with inline images
        outer = MIMEMultipart('related')
        outer['Subject'] = msg['Subject']
        outer['From'] = msg['From']
        outer['To'] = msg['To']
        if msg.get('Cc'):
            outer['Cc'] = msg['Cc']
        outer['Message-ID'] = msg['Message-ID']
        if msg.get('References'):
            outer['References'] = msg['References']
        if msg.get('In-Reply-To'):
            outer['In-Reply-To'] = msg['In-Reply-To']

        alt = MIMEMultipart('alternative')
        alt.attach(MIMEText(text_body + history_text, 'plain', 'utf-8'))
        alt.attach(MIMEText(full_html_cid, 'html', 'utf-8'))
        outer.attach(alt)

        for cid, img_bytes, mime_subtype in inline_cid_images:
            img_part = MIMEImage(img_bytes, _subtype=mime_subtype)
            img_part.add_header('Content-ID', f'<{cid}>')
            img_part.add_header('Content-Disposition', 'inline')
            outer.attach(img_part)

        # 5c. Add file attachments
        if attachments:
            for att in attachments:
                from email.mime.base import MIMEBase
                from email import encoders
                part = MIMEBase(att['maintype'], att['subtype'])
                part.set_payload(att['content'])
                encoders.encode_base64(part)
                part.add_header('Content-Disposition', 'attachment', filename=att['filename'])
                outer.attach(part)

        msg = outer  # swap to the CID-based message

    else:
        # No inline images — use the original EmailMessage approach
        msg.set_content(text_body + history_text)
        if full_html_cid:
            msg.add_alternative(full_html_cid, subtype='html')

        # 5c. Add attachments
        if attachments:
            for att in attachments:
                msg.add_attachment(
                    att["content"],
                    maintype=att["maintype"],
                    subtype=att["subtype"],
                    filename=att["filename"]
                )

    # 6. Send Email
    try:
        await aiosmtplib.send(
            msg,
            hostname=config["smtp_host"],
            port=config["smtp_port"],
            username=config["smtp_user"],
            password=config["smtp_pass"],
            use_tls=(config["smtp_port"] == 465),
            start_tls=(config["smtp_port"] == 587),
        )
        logger.info(f"Email sent for incident {incident['ticket_id']} to Level {level_number}")
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False

    # 7. Update incident state
    next_check = None
    if level["escalation_time_min"]:
        next_check = datetime.now(timezone.utc) + timedelta(minutes=level["escalation_time_min"])
    
    # Store the Message-ID if this is the first mail
    store_msg_id = parent_msg_id if parent_msg_id else new_msg_id

    # AUTO-STATUS: 'sent to customer'
    await db.execute(
        text("""
            UPDATE public.incidents 
            SET assigned_team_id = :tid, 
                escalation_level = :lvl, 
                last_escalated_at = NOW(),
                next_escalation_check_at = :next,
                notification_message_id = :msgid,
                status = 'sent to customer',
                updated_at = NOW(), last_updated_at = NOW()
            WHERE id = :iid
        """),
        {
            "tid": team_id, "lvl": level_number, "next": next_check, 
            "iid": incident["id"], "msgid": store_msg_id
        }
    )


    # Save to interactions for timeline
    att_names = ", ".join([a["filename"] for a in attachments]) if attachments else None
    await db.execute(
        text("""
            INSERT INTO public.incident_email_interactions 
            (incident_id, message_id, in_reply_to, from_email, to_email, cc_email, sender_name, subject, body, direction, has_attachments, attachment_names)
            VALUES (:iid, :mid, :irt, :frm, :to, :cc, :name, :subj, :body, 'outbound', :has_att, :att_names)
            ON CONFLICT (message_id) DO NOTHING
        """),
        {
            "iid": incident["id"], "mid": new_msg_id, "irt": parent_msg_id, 
            "frm": config["from_email"], "to": ", ".join(to_recipients), "cc": ", ".join(cc_recipients) if cc_recipients else None,
            "name": "Alticyber SOC", "subj": msg["Subject"], "body": log_body,
            "has_att": bool(attachments), "att_names": att_names
        }
    )

    await db.commit()

    # ── SLA: record email_sent + first response ──
    try:
        from incidents.sla import record_sla_event, check_first_response
        async with AsyncSessionLocal() as sla_db:
            async with sla_db.begin():
                await record_sla_event(sla_db, str(incident["id"]), str(incident["tenant_id"]), "email_sent",
                    metadata={"level": level_number, "recipients": to_recipients[:5]})
                await check_first_response(sla_db, str(incident["id"]), str(incident["tenant_id"]))
    except Exception as e:
        logger.warning(f"SLA event failed for send_incident_email: {e}")

    return True


async def escalation_worker():
    """Background task to check for incidents that need escalation."""
    logger.info("Escalation worker started")
    while True:
        try:
            async with AsyncSessionLocal() as db:
                # Find incidents with next_escalation_check_at in the past, locking them to prevent double escalation
                res = await db.execute(
                    text("""
                        SELECT id, assigned_team_id, escalation_level, ticket_id 
                        FROM public.incidents 
                        WHERE next_escalation_check_at <= NOW() AND status != 'resolved'
                        FOR UPDATE SKIP LOCKED
                    """)
                )
                to_escalate = res.mappings().all()
                
                for i in to_escalate:
                    next_lvl = i["escalation_level"] + 1
                    logger.info(f"Escalating incident {i['ticket_id']} to level {next_lvl}")
                    success = await send_incident_email(db, str(i["id"]), str(i["assigned_team_id"]), next_lvl)
                    if success:
                        try:
                            from incidents.sla import record_sla_event
                            await record_sla_event(db, str(i["id"]), "", "escalated",
                                metadata={"from_level": i["escalation_level"], "to_level": next_lvl})
                            await db.commit()
                        except Exception:
                            pass
                    if not success:
                        # Clear next_escalation_check_at if no next level exists or failure
                        await db.execute(
                            text("UPDATE public.incidents SET next_escalation_check_at = NULL WHERE id = :iid"),
                            {"iid": i["id"]}
                        )
                        await db.commit()
            
        except Exception as e:
            logger.error(f"Escalation worker error: {e}")
            
        await asyncio.sleep(60) # Check every minute

async def inbound_email_poller():
    """Background task to poll IMAP for replies."""
    logger.info("Inbound email poller started")
    while True:
        try:
            async with AsyncSessionLocal() as db:
                # Get all active mailing configs
                configs_res = await db.execute(text("SELECT * FROM public.mailing_configs WHERE is_active = TRUE AND imap_host IS NOT NULL"))
                configs = configs_res.mappings().all()
                
                for config in configs:
                    try:
                        with IMAPClient(config["imap_host"], port=config["imap_port"], ssl=True) as client:
                            client.login(config["smtp_user"], config["smtp_pass"])
                            client.select_folder('INBOX')
                            
                            messages = client.search(['UNSEEN'])
                            for msgid, data in client.fetch(messages, ['ENVELOPE', 'RFC822']).items():
                                raw_email = data[b'RFC822']
                                msg = email.message_from_bytes(raw_email)
                                
                                in_reply_to = msg.get('In-Reply-To')
                                if not in_reply_to:
                                    continue
                                
                                # Match with incident
                                # notification_message_id is stored with <...> brackets often, make sure to handle
                                ref_id = in_reply_to.strip()
                                
                                # Check if this belongs to an incident or a previous interaction
                                i_res = await db.execute(
                                    text("SELECT id FROM public.incidents WHERE notification_message_id = :ref OR notification_message_id = :ref2"),
                                    {"ref": ref_id, "ref2": f"<{ref_id}>"}
                                )
                                incident = i_res.mappings().first()
                                
                                if not incident:
                                    # Check interactions table
                                    int_res = await db.execute(
                                        text("SELECT incident_id FROM public.incident_email_interactions WHERE message_id = :ref OR message_id = :ref2"),
                                        {"ref": ref_id, "ref2": f"<{ref_id}>"}
                                    )
                                    interaction = int_res.mappings().first()
                                    if interaction:
                                        incident = {"id": interaction["incident_id"]}
                                
                                if incident:
                                    # Save interaction
                                    from_name, from_email = parseaddr(msg.get('From'))
                                    body = ""
                                    interaction_has_att = False
                                    interaction_att_names_list = []
                                    if msg.is_multipart():
                                        for part in msg.walk():
                                            cdisposition = str(part.get("Content-Disposition"))
                                            if "attachment" in cdisposition:
                                                interaction_has_att = True
                                                filename = part.get_filename()
                                                if filename:
                                                    interaction_att_names_list.append(filename)
                                            if part.get_content_type() == 'text/plain' and "attachment" not in cdisposition:
                                                body = part.get_payload(decode=True).decode(errors='ignore')
                                    else:
                                        body = msg.get_payload(decode=True).decode(errors='ignore')
                                    
                                    interaction_att_names = ", ".join(interaction_att_names_list) if interaction_att_names_list else None

                                    int_res = await db.execute(
                                        text("""
                                            INSERT INTO public.incident_email_interactions 
                                            (incident_id, message_id, in_reply_to, from_email, to_email, cc_email, sender_name, subject, body, direction, has_attachments, attachment_names)
                                            VALUES (:iid, :mid, :irt, :frm, :to, :cc, :name, :subj, :body, 'inbound', :has_att, :att_names)
                                            ON CONFLICT (message_id) DO UPDATE SET message_id = EXCLUDED.message_id
                                            RETURNING id
                                        """),
                                        {
                                            "iid": incident["id"], "mid": msg.get('Message-ID'), 
                                            "irt": in_reply_to, "frm": from_email, "to": msg.get('To'), "cc": msg.get('Cc'),
                                            "name": from_name, "subj": msg.get('Subject'), "body": body,
                                            "has_att": interaction_has_att, "att_names": interaction_att_names
                                        }
                                    )
                                    interaction = int_res.mappings().first()
                                    
                                    # AUTO-STATUS: 'customer response received'
                                    # Also clear next_escalation_check_at so the escalation
                                    # worker does NOT send an escalation mail after customer replied
                                    await db.execute(
                                        text("""
                                            UPDATE public.incidents
                                            SET status = 'customer response received',
                                                next_escalation_check_at = NULL,
                                                updated_at = NOW(),
                                                last_updated_at = NOW()
                                            WHERE id = :iid
                                        """),
                                        {"iid": incident["id"]}
                                    )
                                    logger.info(f"Customer reply received for {incident.get('ticket_id')} — escalation timer cleared")

                                    # ── SLA: record email_received event ──
                                    try:
                                        from incidents.sla import record_sla_event
                                        await record_sla_event(db, str(incident["id"]), str(incident["tenant_id"]), "email_received",
                                            metadata={"from": from_email, "subject": msg.get('Subject', '')[:100]})
                                    except Exception:
                                        pass

                                    
                                    # Save attachment contents
                                    if interaction and interaction_has_att:
                                        for part in msg.walk():
                                            cdisposition = str(part.get("Content-Disposition"))
                                            if "attachment" in cdisposition:
                                                filename = part.get_filename()
                                                if filename:
                                                    payload = part.get_payload(decode=True)
                                                    if payload:
                                                        await db.execute(
                                                            text("""
                                                                INSERT INTO public.incident_attachments
                                                                (interaction_id, filename, content_type, data)
                                                                VALUES (:int_id, :fname, :ctype, :data)
                                                            """),
                                                            {
                                                                "int_id": interaction["id"],
                                                                "fname": filename,
                                                                "ctype": part.get_content_type(),
                                                                "data": payload
                                                            }
                                                        )

                                    await db.commit()
                                    # Mark as seen is automatic by fetch unless specified, but let's be safe
                                    # client.add_flags(msgid, [b'\\Seen'])
                    except Exception as cfg_err:
                        logger.error(f"Error polling IMAP for config {config['id']}: {cfg_err}")
                        
        except Exception as e:
            logger.error(f"Inbound poller error: {e}")
            
        await asyncio.sleep(60)

async def send_analyst_reply(db: AsyncSession, incident_id: str, body: str, attachments: list = None, custom_cc: str = None, analyst_id: str = None):
    # 1. Get incident and config
    where_col = "id" if is_uuid(incident_id) else "ticket_id"
    if where_col == "id":
        sql = text("SELECT * FROM public.incidents WHERE id = CAST(:iid AS UUID)")
    else:
        sql = text("SELECT * FROM public.incidents WHERE ticket_id = :iid")
        
    i_res = await db.execute(sql, {"iid": incident_id})
    incident = i_res.mappings().first()
    if not incident: return False, "Incident not found"
    
    config = await get_mailing_config(db, str(incident["tenant_id"]))
    if not config: return False, "Mailing config not found"
    
    # 2. To & CC recipients (Reply All Logic)
    # Fetch latest interaction to get previous recipients
    latest_interaction_sql = text("""
        SELECT from_email, to_email, cc_email, direction 
        FROM public.incident_email_interactions 
        WHERE incident_id = :iid 
        ORDER BY created_at DESC LIMIT 1
    """)
    li_res = await db.execute(latest_interaction_sql, {"iid": incident["id"]})
    last_int = li_res.mappings().first()
    
    to_recips = []
    cc_recips = []
    
    soc_email = config["from_email"].lower()
    
    if last_int:
        # If last was inbound, reply to sender AND keep others in CC
        if last_int["direction"] == 'inbound':
            if last_int["from_email"]:
                to_recips.append(last_int["from_email"])
            
            # Add all others (original To/Cc) to CC, excluding SOC
            raw_to = last_int["to_email"] or ""
            raw_cc = last_int["cc_email"] or ""
            
            # Helper to parse and clean emails
            def clean_emails(raw_str):
                if not raw_str: return []
                # Replace newlines, carriage returns and tabs with spaces
                s = raw_str.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')
                return [e.strip() for e in s.split(",") if e.strip()]
            
            potential_ccs = clean_emails(raw_to) + clean_emails(raw_cc)
            for e in potential_ccs:
                _, e_addr = parseaddr(e)
                e_low = e_addr.lower().strip()
                if not e_low: continue

                # Check if it's the SOC email
                if e_low == soc_email:
                    continue
                
                # Check if already in to_recips or cc_recips
                is_duplicate = False
                for t in to_recips:
                    if parseaddr(t)[1].lower().strip() == e_low:
                        is_duplicate = True
                        break
                if is_duplicate: continue

                for c in cc_recips:
                    if parseaddr(c)[1].lower().strip() == e_low:
                        is_duplicate = True
                        break
                if is_duplicate: continue

                cc_recips.append(e)
        else:
            # If last was outbound, mirror the recipients
            to_recips = [e.strip() for e in (last_int["to_email"] or "").split(",") if e.strip()]
            cc_recips = [e.strip() for e in (last_int["cc_email"] or "").split(",") if e.strip()]
    
    # Fallback to team levels if no interaction or no To recipients found
    if not to_recips:
        to_recips = await get_level_recipients(db, str(incident["assigned_team_id"]), 1)
        if incident["escalation_level"] >= 1:
            for lvl in range(2, incident["escalation_level"] + 1):
                lvl_emails = await get_level_recipients(db, str(incident["assigned_team_id"]), lvl)
                for le in lvl_emails:
                    if le.lower() not in [t.lower() for t in to_recips] and le.lower() not in [c.lower() for c in cc_recips]:
                        cc_recips.append(le)

    if custom_cc:
        for email in custom_cc.split(','):
            e = email.strip()
            if e and e.lower() not in [c.lower() for c in cc_recips] and e.lower() not in [t.lower() for t in to_recips]:
                cc_recips.append(e)
    
    # FINAL SAFETY: If still no To, use the level 1 or from_email as a last resort to avoid 500
    if not to_recips:
        # This shouldn't happen with team configs, but let's be safe
        logger.warning(f"No recipients found for reply to incident {incident_id}, using from_email as fallback To")
        to_recips = [soc_email]

    msg = EmailMessage()
    
    # Threading: Try to find original subject from first interaction
    existing_subject = await get_thread_subject(db, incident["id"])
    if existing_subject:
        msg["Subject"] = (existing_subject if existing_subject.lower().startswith("re:") else f"Re: {existing_subject}").replace('\n','').replace('\r','')
    else:
        msg["Subject"] = f"Re: [{incident['severity'].upper()}] Incident Alert: {incident['ticket_id']} - {incident['title']}".replace('\n','').replace('\r','')
    
    msg["From"] = config["from_email"].replace('\n','').replace('\r','')
    msg["To"] = ", ".join([r.replace('\n', ' ').replace('\r', ' ') for r in to_recips])
    if cc_recips:
        msg["Cc"] = ", ".join([r.replace('\n', ' ').replace('\r', ' ') for r in cc_recips])
    
    new_id = make_msgid(domain="alticyber.com")
    msg["Message-ID"] = new_id
    
    # Threading Headers: Build References chain
    history = await get_interaction_history(db, incident["id"])
    parent_id = incident["notification_message_id"]
    all_msg_ids = []
    if parent_id:
        all_msg_ids.append(parent_id if parent_id.startswith('<') else f"<{parent_id}>")
    
    for h in history:
        mid = h.get('message_id')
        if mid:
            fmt_mid = mid if mid.startswith('<') else f"<{mid}>"
            if fmt_mid not in all_msg_ids:
                all_msg_ids.append(fmt_mid)
                
    if all_msg_ids:
        msg["References"] = " ".join(all_msg_ids)
        msg["In-Reply-To"] = all_msg_ids[-1] # Reply to the absolute latest message
    
    # Fetch and Append History
    history_html = format_history_html(history)
    history_text = format_history_text(history)

    # Fetch analyst signature if id provided
    sig_content_html = ""
    sig_content_text = ""
    if analyst_id:
        try:
            # Use is_uuid helper to be safe
            if analyst_id and (isinstance(analyst_id, uuid.UUID) or is_uuid(str(analyst_id))):
                # 1. Try rich signature first
                rich_signature = await get_user_default_signature(db, str(analyst_id), type='reply')
                if rich_signature:
                    sig_content_html = f"<div class='rich-signature' style='margin-top: 16px;'>{rich_signature['content']}</div>"
                    sig_content_text = f"\n\n--\n{rich_signature['name']}"
                else:
                    # 2. Fallback to legacy plain text signature
                    res = await db.execute(text("SELECT signature FROM public.users WHERE id = :uid"), {"uid": analyst_id})
                    row = res.fetchone()
                    if row and row[0]:
                        sig_content_html = f"<div style='color: #57606a; padding-top: 8px; margin-top: 8px; font-size: 13px;'>{row[0].replace(chr(10), '<br>')}</div>"
                        sig_content_text = f"\n\n--\n{row[0]}"
        except Exception as e:
            logger.warning(f"Could not fetch signature for analyst {analyst_id}: {e}")

    # Build bodies (use default if none found)
    if not sig_content_html:
        sig_content_html = DEFAULT_SIGNATURE_HTML
        sig_content_text = DEFAULT_SIGNATURE_TEXT
    else:
        # For replies, if we have an analyst signature, add a border to separate it from the message
        sig_content_html = f"<div style='border-top: 1px solid #d0d7de; margin-top: 20px; padding-top: 10px;'>{sig_content_html}</div>"

    reply_body = f"{body}{sig_content_text}"


    html_reply = f"""
<html>
<body>
    <div style='font-family: sans-serif; font-size: 14px; color: #24292f;'>
        {body.replace(chr(10), '<br>')}
        {sig_content_html}
    </div>
    {history_html}
</body>
</html>
"""
    
    # Actually most analyst replies are text, so we'll do text + text history
    msg.set_content(reply_body + history_text)
    
    # If we want rich threads in UI/Inbox, we should really send HTML for replies too
    # Wrap text body in simple HTML
    msg.add_alternative(html_reply, subtype='html')
    
    # Attachments
    if attachments:
        for att in attachments:
            msg.add_attachment(
                att["content"],
                maintype=att["maintype"],
                subtype=att["subtype"],
                filename=att["filename"]
            )
            
    # Send
    try:
        await aiosmtplib.send(
            msg, hostname=config["smtp_host"], port=config["smtp_port"],
            username=config["smtp_user"], password=config["smtp_pass"],
            use_tls=(config["smtp_port"] == 465),
            start_tls=(config["smtp_port"] == 587),
        )
        
        # Save to interactions
        att_names = ", ".join([a["filename"] for a in attachments]) if attachments else None
        int_res = await db.execute(
            text("""
                INSERT INTO public.incident_email_interactions 
                (incident_id, message_id, in_reply_to, from_email, to_email, cc_email, sender_name, subject, body, direction, has_attachments, attachment_names)
                VALUES (:iid, :mid, :irt, :frm, :to, :cc, :name, :subj, :body, 'outbound', :has_att, :att_names)
                RETURNING id
            """),
            {
                "iid": incident["id"], "mid": new_id, "irt": parent_id, 
                "frm": config["from_email"], "to": ", ".join(to_recips), "cc": ", ".join(cc_recips) if cc_recips else None,
                "name": "SOC Analyst", "subj": msg["Subject"], "body": body, 
                "has_att": bool(attachments), "att_names": att_names
            }
        )
        interaction = int_res.mappings().first()
        
        # Save attachment contents
        if interaction and attachments:
            for att in attachments:
                await db.execute(
                    text("""
                        INSERT INTO public.incident_attachments
                        (interaction_id, filename, content_type, data)
                        VALUES (:int_id, :fname, :ctype, :data)
                    """),
                    {
                        "int_id": interaction["id"],
                        "fname": att["filename"],
                        "ctype": f"{att['maintype']}/{att['subtype']}",
                        "data": att["content"]
                    }
                )
                
        # AUTO-STATUS: 'sent to customer'
        old_status_res = await db.execute(
            text("SELECT status, tenant_id FROM public.incidents WHERE id = :iid"),
            {"iid": incident["id"]}
        )
        old_row = old_status_res.mappings().first()
        old_status = old_row["status"] if old_row else "unknown"
        reply_tenant = str(old_row["tenant_id"]) if old_row else str(incident.get("tenant_id", ""))

        await db.execute(
            text("UPDATE public.incidents SET status = 'sent to customer', updated_at = NOW(), last_updated_at = NOW() WHERE id = :iid"),
            {"iid": incident["id"]}
        )

        # ── SLA: email_sent + first-response check ──
        try:
            from incidents.sla import record_sla_event, check_first_response
            await record_sla_event(db, str(incident["id"]), reply_tenant, "email_sent",
                                   metadata={"direction": "outbound", "to": ", ".join(to_recips), "subject": msg["Subject"]})
            if old_status == "new":
                await record_sla_event(db, str(incident["id"]), reply_tenant, "status_change",
                                       old_value=old_status, new_value="sent to customer")
                await check_first_response(db, str(incident["id"]), reply_tenant)
        except Exception as sla_err:
            logger.warning(f"SLA event recording failed in send_analyst_reply: {sla_err}")

        await db.commit()
        return True, "Reply sent"
    except Exception as e:
        logger.error(f"Failed to send analyst reply: {e}")
        return False, str(e)
