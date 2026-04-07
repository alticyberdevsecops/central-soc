"""
Freshdesk bidirectional sync module.

Outbound (SOC → Freshdesk):
  push_to_freshdesk(session, incident_data, tenant_id)
  update_freshdesk(session, soc_incident_id, tenant_id, changed_fields)

Inbound (Freshdesk → SOC via webhook):
  apply_freshdesk_webhook(session, payload, tenant_id) -> soc_incident_id | None

Helper:
  get_integration_config(session, tenant_id) -> dict | None
"""
import base64
import json
import logging

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from incidents.mailing import generate_incident_html, DEFAULT_SIGNATURE_HTML, get_user_default_signature

logger = logging.getLogger("incidents.freshdesk")

# ── Priority mappings ────────────────────────────────────────────────────────
SEVERITY_TO_FD_PRIORITY = {
    "critical":      4,   # Urgent
    "high":          3,   # High
    "medium":        2,   # Medium
    "low":           1,   # Low
    "informational": 1,   # Low
}

# ── Status mappings (SOC → Freshdesk) ───────────────────────────────────────
STATUS_TO_FD_STATUS = {
    "new":                        2,   # Open
    "triaging":                   2,   # Open
    "ai triaging":                2,   # Open
    "in_progress":                2,   # Open
    "escalated":                  2,   # Open
    "sent to customer":           3,   # Pending
    "customer response received": 3,   # Pending
    "resolved":                   4,   # Resolved
    "false_positive":             5,   # Closed
}

# ── Status mappings (Freshdesk → SOC) ───────────────────────────────────────
FD_STATUS_TO_SOC = {
    2: "in_progress",
    3: "sent to customer",
    4: "resolved",
    5: "false_positive",
}
FD_STATUS_LABEL_TO_SOC = {
    "open":     "in_progress",
    "pending":  "sent to customer",
    "resolved": "resolved",
    "closed":   "false_positive",
}


# ── Auth helper ──────────────────────────────────────────────────────────────
def _make_auth_header(api_key: str) -> dict:
    """Basic auth: base64(api_key:X) — Freshdesk uses X as the password."""
    token = base64.b64encode(f"{api_key}:X".encode()).decode()
    return {"Authorization": f"Basic {token}", "Content-Type": "application/json"}


# ── Config loader ────────────────────────────────────────────────────────────
async def get_integration_config(session: AsyncSession, tenant_id: str) -> dict | None:
    """
    Fetch enabled Freshdesk config for a tenant.
    Returns None if not configured, disabled, or missing required fields.
    """
    try:
        result = await session.execute(
            text("""
                SELECT config, is_enabled
                FROM public.integration_configs
                WHERE tenant_id = CAST(:tid AS UUID)
                  AND integration = 'freshdesk'
                LIMIT 1
            """),
            {"tid": tenant_id},
        )
        row = result.mappings().first()
        if not row or not row["is_enabled"]:
            return None
        config = row["config"]
        if isinstance(config, str):
            config = json.loads(config)
        if not config.get("domain") or not config.get("api_key"):
            return None
        return config
    except Exception as e:
        logger.warning(f"Could not fetch Freshdesk config for tenant {tenant_id}: {e}")
        return None


# ── Timeline helper ──────────────────────────────────────────────────────────
async def _record_timeline(
    session: AsyncSession,
    incident_id: str,
    direction: str,
    subject: str,
    body: str,
    from_email: str = "",
    sender_name: str = "",
) -> None:
    """Insert a Freshdesk ITSM event into the communication timeline."""
    try:
        await session.execute(
            text("""
                INSERT INTO public.incident_email_interactions
                    (incident_id, from_email, sender_name, subject, body,
                     direction, interaction_source)
                VALUES
                    (CAST(:iid AS UUID), :from, :name, :subj, :body,
                     :dir, 'freshdesk')
            """),
            {
                "iid": incident_id, "from": from_email, "name": sender_name,
                "subj": subject, "body": body, "dir": direction,
            },
        )
    except Exception as e:
        logger.warning(f"Failed to record Freshdesk timeline event: {e}")


# ── Outbound: create ─────────────────────────────────────────────────────────
async def push_to_freshdesk(
    session: AsyncSession,
    incident_data: dict,
    tenant_id: str,
) -> None:
    """
    Create a Freshdesk ticket for a new SOC incident.
    Fire-and-forget — never raises.
    """
    config = await get_integration_config(session, tenant_id)
    if not config:
        return

    domain = config["domain"]
    api_key = config["api_key"]
    requester_email = config.get("requester_email", "soc@localhost")

    priority = SEVERITY_TO_FD_PRIORITY.get(
        str(incident_data.get("severity", "medium")).lower(), 2
    )
    ticket_id = incident_data.get("ticket_id", "")
    title = incident_data.get("title", "Untitled")

    # Fetch the analyst's saved signature (fall back to default if none set)
    user_id = incident_data.get("user_id", "")
    signature_html = DEFAULT_SIGNATURE_HTML
    if user_id:
        try:
            user_sig = await get_user_default_signature(session, user_id, type="new")
            if user_sig and user_sig.get("content"):
                signature_html = user_sig["content"]
        except Exception:
            pass

    # Generate the same rich HTML used in email notifications (with signature)
    try:
        description_html = generate_incident_html(incident_data)
        description_html = description_html.replace("{SIGNATURE}", signature_html).replace("{{SIGNATURE}}", signature_html)
    except Exception as _e:
        logger.warning(f"Failed to render incident HTML for Freshdesk, using plain text: {_e}")
        description_html = (
            f"<b>SOC Ticket:</b> {ticket_id}<br>"
            f"<b>Severity:</b> {incident_data.get('severity', 'medium')}<br>"
            f"<b>Status:</b> {incident_data.get('status', 'new')}<br><br>"
            f"{incident_data.get('description') or ''}"
        )

    payload = {
        "subject": f"[SOC] {title} [{ticket_id}]",
        "description": description_html,
        "email": requester_email,
        "priority": priority,
        "status": 2,   # Open on creation
        "tags": ["central-soc", ticket_id],
    }

    url = f"https://{domain}.freshdesk.com/api/v2/tickets"

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.post(url, json=payload, headers=_make_auth_header(api_key))
            resp.raise_for_status()
            fd_ticket = resp.json()
            fd_ticket_id = str(fd_ticket.get("id", ""))
            fd_ticket_url = f"https://{domain}.freshdesk.com/helpdesk/tickets/{fd_ticket_id}"

            await session.execute(
                text("""
                    INSERT INTO public.integration_ticket_mappings
                        (tenant_id, integration, soc_incident_id, external_ticket_id, external_ticket_url, sync_status)
                    VALUES (CAST(:tid AS UUID), 'freshdesk', CAST(:soc_id AS UUID), :ext_id, :ext_url, 'synced')
                    ON CONFLICT (tenant_id, integration, soc_incident_id) DO UPDATE SET
                        external_ticket_id  = EXCLUDED.external_ticket_id,
                        external_ticket_url = EXCLUDED.external_ticket_url,
                        last_synced_at      = NOW(),
                        sync_status         = 'synced'
                """),
                {"tid": tenant_id, "soc_id": str(incident_data["id"]), "ext_id": fd_ticket_id, "ext_url": fd_ticket_url},
            )
            await session.commit()
            logger.info(f"Freshdesk ticket #{fd_ticket_id} created for SOC {ticket_id}")

            # Update SOC incident status → "sent to customer"
            # Also stamp first_response_at — Freshdesk ticket creation IS the first response
            try:
                await session.execute(
                    text("""
                        UPDATE public.incidents
                        SET status = 'sent to customer',
                            first_response_at = COALESCE(first_response_at, NOW()),
                            updated_at = NOW(), last_updated_at = NOW()
                        WHERE id = CAST(:iid AS UUID)
                    """),
                    {"iid": str(incident_data["id"])},
                )
                await session.commit()
            except Exception as _se:
                logger.warning(f"Failed to update SOC status after Freshdesk ticket creation: {_se}")

            # Record ticket creation in communication timeline — full rich HTML
            timeline_body = (
                f"<div style='margin-bottom:16px; padding:12px 16px; background:#eaf5fb; border:1px solid #b6d9f0; border-radius:6px; font-family:sans-serif;'>"
                f"<span style='font-size:13px; font-weight:700; color:#0969da;'>✅ Freshdesk Ticket Created</span><br><br>"
                f"<span style='font-size:12px; color:#24292f;'>"
                f"<b>Ticket ID:</b> <a href='{fd_ticket_url}' target='_blank' style='color:#0969da;'>#{fd_ticket_id}</a> &nbsp;|&nbsp; "
                f"<b>Priority:</b> {priority} &nbsp;|&nbsp; "
                f"<b>Status:</b> Open"
                f"</span>"
                f"</div>"
                f"{description_html}"
            )
            await _record_timeline(
                session,
                incident_id=str(incident_data["id"]),
                direction="outbound",
                subject=f"Freshdesk ticket #{fd_ticket_id} created",
                body=timeline_body,
                from_email="freshdesk@system",
                sender_name="Freshdesk",
            )
            await session.commit()

    except Exception as e:
        logger.warning(f"Freshdesk push failed for {ticket_id}: {e}")
        try:
            await session.execute(
                text("""
                    INSERT INTO public.integration_ticket_mappings
                        (tenant_id, integration, soc_incident_id, external_ticket_id, sync_status)
                    VALUES (CAST(:tid AS UUID), 'freshdesk', CAST(:soc_id AS UUID), '', 'error')
                    ON CONFLICT (tenant_id, integration, soc_incident_id) DO UPDATE SET
                        sync_status    = 'error',
                        last_synced_at = NOW()
                """),
                {"tid": tenant_id, "soc_id": str(incident_data["id"])},
            )
            await session.commit()
        except Exception:
            pass


# ── Outbound: update ─────────────────────────────────────────────────────────
async def update_freshdesk(
    session: AsyncSession,
    soc_incident_id: str,
    tenant_id: str,
    changed_fields: dict,
) -> None:
    """
    Update a Freshdesk ticket when a SOC incident is patched.
    changed_fields: subset of {title, severity, status}.
    Fire-and-forget — never raises.
    """
    if not changed_fields:
        return

    config = await get_integration_config(session, tenant_id)
    if not config:
        return

    # Look up Freshdesk ticket ID
    try:
        mapping = await session.execute(
            text("""
                SELECT external_ticket_id FROM public.integration_ticket_mappings
                WHERE tenant_id = CAST(:tid AS UUID)
                  AND integration = 'freshdesk'
                  AND soc_incident_id = CAST(:sid AS UUID)
                  AND sync_status != 'error'
                  AND external_ticket_id != ''
                LIMIT 1
            """),
            {"tid": tenant_id, "sid": soc_incident_id},
        )
        row = mapping.fetchone()
        if not row:
            return
        fd_ticket_id = row[0]
    except Exception as e:
        logger.warning(f"Freshdesk mapping lookup failed for {soc_incident_id}: {e}")
        return

    update_payload: dict = {}
    if "title" in changed_fields and changed_fields["title"]:
        update_payload["subject"] = f"[SOC] {changed_fields['title']}"
    if "severity" in changed_fields and changed_fields["severity"]:
        update_payload["priority"] = SEVERITY_TO_FD_PRIORITY.get(
            str(changed_fields["severity"]).lower(), 2
        )
    if "status" in changed_fields and changed_fields["status"]:
        fd_status = STATUS_TO_FD_STATUS.get(str(changed_fields["status"]).lower())
        if fd_status:
            update_payload["status"] = fd_status

    if not update_payload:
        return

    domain = config["domain"]
    api_key = config["api_key"]
    url = f"https://{domain}.freshdesk.com/api/v2/tickets/{fd_ticket_id}"

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.put(url, json=update_payload, headers=_make_auth_header(api_key))
            resp.raise_for_status()
            await session.execute(
                text("""
                    UPDATE public.integration_ticket_mappings
                    SET last_synced_at = NOW(), sync_status = 'synced'
                    WHERE tenant_id = CAST(:tid AS UUID)
                      AND integration = 'freshdesk'
                      AND soc_incident_id = CAST(:sid AS UUID)
                """),
                {"tid": tenant_id, "sid": soc_incident_id},
            )
            await session.commit()
            logger.info(f"Freshdesk ticket #{fd_ticket_id} updated: {list(update_payload.keys())}")
    except Exception as e:
        logger.warning(f"Freshdesk update failed for ticket #{fd_ticket_id}: {e}")


# ── Inbound: webhook ─────────────────────────────────────────────────────────
async def apply_freshdesk_webhook(
    session: AsyncSession,
    payload: dict,
    tenant_id: str,
) -> str | None:
    """
    Handle an inbound Freshdesk Automation Rule webhook.
    Finds the corresponding SOC incident and updates its status.
    Returns the SOC incident UUID string if updated, else None.
    """
    if not tenant_id:
        return None

    # Freshdesk sends payload under freshdesk_webhook key or flat
    webhook_data = payload.get("freshdesk_webhook", payload)

    fd_ticket_id = str(
        webhook_data.get("ticket_id", "")
        or payload.get("id", "")
    ).strip()

    if not fd_ticket_id or fd_ticket_id in ("", "None", "0"):
        logger.warning("Freshdesk webhook: could not find ticket_id in payload")
        return None

    # Lookup SOC incident via mapping
    try:
        mapping = await session.execute(
            text("""
                SELECT soc_incident_id FROM public.integration_ticket_mappings
                WHERE tenant_id = CAST(:tid AS UUID)
                  AND integration = 'freshdesk'
                  AND external_ticket_id = :ext_id
                LIMIT 1
            """),
            {"tid": tenant_id, "ext_id": fd_ticket_id},
        )
        row = mapping.fetchone()
        if not row:
            logger.warning(f"Freshdesk webhook: no SOC mapping for ticket #{fd_ticket_id}")
            return None
        soc_incident_id = str(row[0])
    except Exception as e:
        logger.warning(f"Freshdesk webhook mapping lookup error: {e}")
        return None

    # Extract status — can be int code or string label
    raw_status = webhook_data.get("ticket_status") or payload.get("status")

    soc_status = None
    if raw_status is not None:
        if isinstance(raw_status, int):
            soc_status = FD_STATUS_TO_SOC.get(raw_status)
        else:
            soc_status = FD_STATUS_LABEL_TO_SOC.get(str(raw_status).lower())

    # Extract reply/note body from various payload shapes
    note_body = (
        webhook_data.get("note_body")
        or webhook_data.get("reply_body")
        or payload.get("note_body")
        or payload.get("comment")
        or ""
    )
    note_author = (
        webhook_data.get("note_created_by")
        or payload.get("note_created_by")
        or "Freshdesk Agent"
    )
    note_email = (
        webhook_data.get("note_created_by_email")
        or payload.get("note_created_by_email")
        or "agent@freshdesk"
    )

    # Record inbound reply in communication timeline (if body present)
    if note_body.strip():
        await _record_timeline(
            session,
            incident_id=soc_incident_id,
            direction="inbound",
            subject=f"Reply from Freshdesk ticket #{fd_ticket_id}",
            body=note_body,
            from_email=note_email,
            sender_name=note_author,
        )
        try:
            await session.commit()
        except Exception:
            pass

    if not soc_status:
        logger.info(f"Freshdesk webhook: no actionable status (raw={raw_status}) for ticket #{fd_ticket_id}")
        return soc_incident_id   # ACK without update

    try:
        await session.execute(
            text("""
                UPDATE public.incidents
                SET status = :status, updated_at = NOW(), last_updated_at = NOW()
                WHERE id = CAST(:iid AS UUID)
            """),
            {"status": soc_status, "iid": soc_incident_id},
        )
        await session.execute(
            text("""
                UPDATE public.integration_ticket_mappings
                SET last_synced_at = NOW()
                WHERE soc_incident_id = CAST(:iid AS UUID)
                  AND integration = 'freshdesk'
            """),
            {"iid": soc_incident_id},
        )
        # Record status change in timeline
        await _record_timeline(
            session,
            incident_id=soc_incident_id,
            direction="inbound",
            subject=f"Freshdesk ticket #{fd_ticket_id} status changed",
            body=f"<b>ITSM Status Update from Freshdesk.</b><br><br><b>New Status:</b> {soc_status}",
            from_email="freshdesk@system",
            sender_name="Freshdesk",
        )
        await session.commit()
        logger.info(
            f"Freshdesk webhook: SOC incident {soc_incident_id} → '{soc_status}' (FD ticket #{fd_ticket_id})"
        )
    except Exception as e:
        logger.warning(f"Freshdesk webhook: failed to update SOC incident {soc_incident_id}: {e}")

    return soc_incident_id


# ── Outbound: add note/comment ────────────────────────────────────────────────
async def add_note_to_freshdesk(
    session: AsyncSession,
    soc_incident_id: str,
    tenant_id: str,
    fd_ticket_id: str,
    body_text: str,
    attachments: list,
    analyst_email: str = "",
    analyst_name: str = "",
) -> None:
    """Post a public note to a Freshdesk ticket and record in timeline."""
    config = await get_integration_config(session, tenant_id)
    if not config:
        return
    domain = config["domain"]
    api_key = config["api_key"]
    url = f"https://{domain}.freshdesk.com/api/v2/tickets/{fd_ticket_id}/notes"
    try:
        auth = _make_auth_header(api_key)
        if attachments:
            multipart_auth = {"Authorization": auth["Authorization"]}
            files_data = [
                ("attachments[]", (a["filename"], a["content"], a["content_type"]))
                for a in attachments
            ]
            form_data = {"body": f"<p>{body_text}</p>", "private": "false"}
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.post(url, data=form_data, files=files_data, headers=multipart_auth)
                resp.raise_for_status()
        else:
            note_payload = {"body": f"<p>{body_text}</p>", "private": False}
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.post(url, json=note_payload, headers=auth)
                resp.raise_for_status()
        att_note = ""
        if attachments:
            names = ", ".join(a["filename"] for a in attachments)
            att_note = f"<br><br><i>📎 Attachments: {names}</i>"
        await _record_timeline(
            session,
            incident_id=soc_incident_id,
            direction="outbound",
            subject=f"Comment added to Freshdesk ticket #{fd_ticket_id}",
            body=f"<p>{body_text}</p>{att_note}",
            from_email=analyst_email or "analyst@soc",
            sender_name=analyst_name or "SOC Analyst",
        )
        await session.commit()
        logger.info(f"Note added to Freshdesk ticket {fd_ticket_id}")
    except Exception as e:
        logger.warning(f"Failed to add note to Freshdesk ticket {fd_ticket_id}: {e}")
