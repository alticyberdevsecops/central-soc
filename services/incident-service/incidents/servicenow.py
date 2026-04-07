"""
ServiceNow bidirectional sync module.

Outbound (SOC → ServiceNow):
  push_to_servicenow(session, incident_data, tenant_id)
  update_servicenow(session, soc_incident_id, tenant_id, changed_fields)

Inbound (ServiceNow → SOC via webhook):
  apply_servicenow_webhook(session, payload, tenant_id) -> soc_incident_id | None

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

logger = logging.getLogger("incidents.servicenow")

# ── SOC severity → ServiceNow urgency + impact ───────────────────────────────
# Priority is auto-calculated from urgency × impact in ServiceNow
SEVERITY_TO_SN = {
    # (urgency, impact)
    "critical":      (1, 1),  # → Priority 1 Critical
    "high":          (1, 2),  # → Priority 2 High
    "medium":        (2, 2),  # → Priority 3 Moderate
    "low":           (3, 3),  # → Priority 4 Low
    "informational": (3, 3),  # → Priority 4 Low
}

# SOC status → ServiceNow state
STATUS_TO_SN_STATE = {
    "new":                        "1",   # New
    "triaging":                   "1",   # New
    "ai triaging":                "1",   # New
    "in_progress":                "2",   # In Progress
    "escalated":                  "2",   # In Progress
    "sent to customer":           "3",   # On Hold
    "customer response received": "2",   # In Progress
    "resolved":                   "6",   # Resolved
    "false_positive":             "7",   # Closed
}

# ServiceNow state → SOC status
SN_STATE_TO_SOC = {
    "1": "triaging",
    "2": "in_progress",
    "3": "sent to customer",
    "6": "resolved",
    "7": "false_positive",
    "8": "false_positive",   # Canceled → false_positive
}


# ── Auth helper ──────────────────────────────────────────────────────────────
def _make_auth_header(username: str, password: str) -> dict:
    """Basic auth: base64(username:password)"""
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return {
        "Authorization": f"Basic {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


# ── Config loader ────────────────────────────────────────────────────────────
async def get_integration_config(session: AsyncSession, tenant_id: str) -> dict | None:
    """
    Fetch enabled ServiceNow config for a tenant.
    Returns None if not configured, disabled, or missing required fields.
    """
    try:
        result = await session.execute(
            text("""
                SELECT config, is_enabled
                FROM public.integration_configs
                WHERE tenant_id = CAST(:tid AS UUID)
                  AND integration = 'servicenow'
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
        if not config.get("instance") or not config.get("username") or not config.get("password"):
            return None
        return config
    except Exception as e:
        logger.warning(f"Could not fetch ServiceNow config for tenant {tenant_id}: {e}")
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
    """Insert a ServiceNow ITSM event into the communication timeline."""
    try:
        await session.execute(
            text("""
                INSERT INTO public.incident_email_interactions
                    (incident_id, from_email, sender_name, subject, body,
                     direction, interaction_source)
                VALUES
                    (CAST(:iid AS UUID), :from, :name, :subj, :body,
                     :dir, 'servicenow')
            """),
            {
                "iid": incident_id, "from": from_email, "name": sender_name,
                "subj": subject, "body": body, "dir": direction,
            },
        )
    except Exception as e:
        logger.warning(f"Failed to record ServiceNow timeline event: {e}")


# ── Outbound: create ─────────────────────────────────────────────────────────
async def push_to_servicenow(
    session: AsyncSession,
    incident_data: dict,
    tenant_id: str,
) -> None:
    """
    Create a ServiceNow incident for a new SOC incident.
    Fire-and-forget — never raises.
    """
    config = await get_integration_config(session, tenant_id)
    if not config:
        return

    instance = config["instance"]
    username = config["username"]
    password = config["password"]
    caller_id = config.get("caller_id", "")   # Optional: sys_id of default caller

    severity = str(incident_data.get("severity", "medium")).lower()
    urgency, impact = SEVERITY_TO_SN.get(severity, (2, 2))
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
        logger.warning(f"Failed to render incident HTML for ServiceNow, using plain text: {_e}")
        description_html = (
            f"SOC Ticket: {ticket_id}\n"
            f"Severity: {incident_data.get('severity', 'medium')}\n"
            f"Status: {incident_data.get('status', 'new')}\n\n"
            f"{incident_data.get('description') or ''}"
        )

    payload: dict = {
        "short_description": f"[SOC] {title} [{ticket_id}]",
        "description": description_html,
        "urgency": str(urgency),
        "impact": str(impact),
        "state": "1",   # New
        "category": "security",
        "contact_type": "self-service",
    }
    if caller_id:
        payload["caller_id"] = caller_id

    url = f"https://{instance}.service-now.com/api/now/table/incident"

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.post(url, json=payload, headers=_make_auth_header(username, password))
            resp.raise_for_status()
            sn_result = resp.json().get("result", {})
            sn_sys_id = sn_result.get("sys_id", "")
            sn_number = sn_result.get("number", "")
            sn_url = f"https://{instance}.service-now.com/incident.do?sys_id={sn_sys_id}"

            await session.execute(
                text("""
                    INSERT INTO public.integration_ticket_mappings
                        (tenant_id, integration, soc_incident_id, external_ticket_id, external_ticket_url, sync_status)
                    VALUES (CAST(:tid AS UUID), 'servicenow', CAST(:soc_id AS UUID), :ext_id, :ext_url, 'synced')
                    ON CONFLICT (tenant_id, integration, soc_incident_id) DO UPDATE SET
                        external_ticket_id  = EXCLUDED.external_ticket_id,
                        external_ticket_url = EXCLUDED.external_ticket_url,
                        last_synced_at      = NOW(),
                        sync_status         = 'synced'
                """),
                {"tid": tenant_id, "soc_id": str(incident_data["id"]), "ext_id": sn_sys_id, "ext_url": sn_url},
            )
            await session.commit()
            logger.info(f"ServiceNow incident {sn_number} ({sn_sys_id}) created for SOC {ticket_id}")

            # Update SOC incident status → "sent to customer"
            # Also stamp first_response_at — ServiceNow ticket creation IS the first response
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
                logger.warning(f"Failed to update SOC status after ServiceNow ticket creation: {_se}")

            # Record ticket creation in communication timeline
            await _record_timeline(
                session,
                incident_id=str(incident_data["id"]),
                direction="outbound",
                subject=f"ServiceNow incident {sn_number} created",
                body=(
                    f"<div style='margin-bottom:16px; padding:12px 16px; background:#eaf5fb; border:1px solid #b6d9f0; border-radius:6px; font-family:sans-serif;'>"
                    f"<span style='font-size:13px; font-weight:700; color:#0969da;'>✅ ServiceNow Incident Created</span><br><br>"
                    f"<span style='font-size:12px; color:#24292f;'>"
                    f"<b>Incident Number:</b> <a href='{sn_url}' target='_blank' style='color:#0969da;'>{sn_number}</a> &nbsp;|&nbsp; "
                    f"<b>Status:</b> New"
                    f"</span>"
                    f"</div>"
                    f"{description_html}"
                ),
                from_email="servicenow@system",
                sender_name="ServiceNow",
            )
            await session.commit()

    except Exception as e:
        logger.warning(f"ServiceNow push failed for {ticket_id}: {e}")
        try:
            await session.execute(
                text("""
                    INSERT INTO public.integration_ticket_mappings
                        (tenant_id, integration, soc_incident_id, external_ticket_id, sync_status)
                    VALUES (CAST(:tid AS UUID), 'servicenow', CAST(:soc_id AS UUID), '', 'error')
                    ON CONFLICT (tenant_id, integration, soc_incident_id) DO UPDATE SET
                        sync_status = 'error', last_synced_at = NOW()
                """),
                {"tid": tenant_id, "soc_id": str(incident_data["id"])},
            )
            await session.commit()
        except Exception:
            pass


# ── Outbound: update ─────────────────────────────────────────────────────────
async def update_servicenow(
    session: AsyncSession,
    soc_incident_id: str,
    tenant_id: str,
    changed_fields: dict,
) -> None:
    """
    Update a ServiceNow incident when a SOC incident is patched.
    changed_fields: subset of {title, severity, status}.
    Fire-and-forget — never raises.
    """
    if not changed_fields:
        return

    config = await get_integration_config(session, tenant_id)
    if not config:
        return

    # Look up ServiceNow sys_id
    try:
        mapping = await session.execute(
            text("""
                SELECT external_ticket_id FROM public.integration_ticket_mappings
                WHERE tenant_id = CAST(:tid AS UUID)
                  AND integration = 'servicenow'
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
        sn_sys_id = row[0]
    except Exception as e:
        logger.warning(f"ServiceNow mapping lookup failed for {soc_incident_id}: {e}")
        return

    update_payload: dict = {}

    if "title" in changed_fields and changed_fields["title"]:
        update_payload["short_description"] = f"[SOC] {changed_fields['title']}"

    if "severity" in changed_fields and changed_fields["severity"]:
        urgency, impact = SEVERITY_TO_SN.get(str(changed_fields["severity"]).lower(), (2, 2))
        update_payload["urgency"] = str(urgency)
        update_payload["impact"] = str(impact)

    if "status" in changed_fields and changed_fields["status"]:
        sn_state = STATUS_TO_SN_STATE.get(str(changed_fields["status"]).lower())
        if sn_state:
            update_payload["state"] = sn_state
            # ServiceNow requires close_code + close_notes when resolving/closing
            if sn_state in ("6", "7"):
                update_payload["close_code"] = "Solved (Permanently)"
                update_payload["close_notes"] = f"Resolved via Central SOC — status: {changed_fields['status']}"

    if not update_payload:
        return

    instance = config["instance"]
    username = config["username"]
    password = config["password"]
    url = f"https://{instance}.service-now.com/api/now/table/incident/{sn_sys_id}"

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.patch(url, json=update_payload, headers=_make_auth_header(username, password))
            resp.raise_for_status()
            await session.execute(
                text("""
                    UPDATE public.integration_ticket_mappings
                    SET last_synced_at = NOW(), sync_status = 'synced'
                    WHERE tenant_id = CAST(:tid AS UUID)
                      AND integration = 'servicenow'
                      AND soc_incident_id = CAST(:sid AS UUID)
                """),
                {"tid": tenant_id, "sid": soc_incident_id},
            )
            await session.commit()
            logger.info(f"ServiceNow incident {sn_sys_id} updated: {list(update_payload.keys())}")
    except Exception as e:
        logger.warning(f"ServiceNow update failed for {sn_sys_id}: {e}")


# ── Inbound: webhook ─────────────────────────────────────────────────────────
async def apply_servicenow_webhook(
    session: AsyncSession,
    payload: dict,
    tenant_id: str,
) -> str | None:
    """
    Handle an inbound ServiceNow Business Rule webhook.
    Finds the corresponding SOC incident and updates its status.
    Returns the SOC incident UUID string if updated, else None.
    """
    if not tenant_id:
        return None

    # ServiceNow sends sys_id in the payload (from our Script Action)
    sn_sys_id = str(payload.get("sys_id", "")).strip()
    if not sn_sys_id:
        logger.warning("ServiceNow webhook: missing sys_id in payload")
        return None

    # Lookup SOC incident via mapping
    try:
        mapping = await session.execute(
            text("""
                SELECT soc_incident_id FROM public.integration_ticket_mappings
                WHERE tenant_id = CAST(:tid AS UUID)
                  AND integration = 'servicenow'
                  AND external_ticket_id = :ext_id
                LIMIT 1
            """),
            {"tid": tenant_id, "ext_id": sn_sys_id},
        )
        row = mapping.fetchone()
        if not row:
            logger.warning(f"ServiceNow webhook: no SOC mapping for sys_id {sn_sys_id}")
            return None
        soc_incident_id = str(row[0])
    except Exception as e:
        logger.warning(f"ServiceNow webhook mapping lookup error: {e}")
        return None

    # Extract state — could be int or string
    raw_state = payload.get("state")
    soc_status = None
    if raw_state is not None:
        soc_status = SN_STATE_TO_SOC.get(str(raw_state).strip())

    # Extract comment/note from payload
    note_body = (
        str(payload.get("comments", ""))
        or str(payload.get("work_notes", ""))
        or str(payload.get("note_body", ""))
        or ""
    )
    note_author = str(payload.get("caller_name") or payload.get("assigned_to") or "ServiceNow Agent")
    note_email = str(payload.get("caller_email") or "agent@servicenow")

    if note_body.strip():
        await _record_timeline(
            session,
            incident_id=soc_incident_id,
            direction="inbound",
            subject=f"Update from ServiceNow incident {sn_sys_id}",
            body=note_body,
            from_email=note_email,
            sender_name=note_author,
        )
        try:
            await session.commit()
        except Exception:
            pass

    if not soc_status:
        logger.info(f"ServiceNow webhook: no actionable state (raw={raw_state}) for {sn_sys_id}")
        return soc_incident_id

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
                  AND integration = 'servicenow'
            """),
            {"iid": soc_incident_id},
        )
        # Record status change in timeline
        await _record_timeline(
            session,
            incident_id=soc_incident_id,
            direction="inbound",
            subject=f"ServiceNow incident {sn_sys_id} status changed",
            body=f"<b>ITSM Status Update from ServiceNow.</b><br><br><b>New Status:</b> {soc_status}",
            from_email="servicenow@system",
            sender_name="ServiceNow",
        )
        await session.commit()
        logger.info(
            f"ServiceNow webhook: SOC incident {soc_incident_id} → '{soc_status}' (SN sys_id {sn_sys_id})"
        )
    except Exception as e:
        logger.warning(f"ServiceNow webhook: failed to update SOC incident {soc_incident_id}: {e}")

    return soc_incident_id


# ── Outbound: add note/comment ────────────────────────────────────────────────
async def add_note_to_servicenow(
    session: AsyncSession,
    soc_incident_id: str,
    tenant_id: str,
    sn_sys_id: str,
    body_text: str,
    attachments: list,
    analyst_email: str = "",
    analyst_name: str = "",
) -> None:
    """Post a comment to a ServiceNow incident and record in timeline."""
    config = await get_integration_config(session, tenant_id)
    if not config:
        return
    instance = config["instance"]
    username = config["username"]
    password = config["password"]
    try:
        # Update incident with comment
        comment_payload = {"comments": body_text}
        url = f"https://{instance}.service-now.com/api/now/table/incident/{sn_sys_id}"
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.patch(url, json=comment_payload, headers=_make_auth_header(username, password))
            resp.raise_for_status()
        # Upload attachments separately via ServiceNow attachment API
        att_note = ""
        if attachments:
            att_url = f"https://{instance}.service-now.com/api/now/attachment/file"
            uploaded = []
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                for a in attachments:
                    params = {
                        "table_name": "incident",
                        "table_sys_id": sn_sys_id,
                        "file_name": a["filename"]
                    }
                    att_headers = {**_make_auth_header(username, password), "Content-Type": a["content_type"]}
                    try:
                        ar = await client.post(att_url, content=a["content"], headers=att_headers, params=params)
                        ar.raise_for_status()
                        uploaded.append(a["filename"])
                    except Exception as ae:
                        logger.warning(f"ServiceNow attachment upload failed for {a['filename']}: {ae}")
            if uploaded:
                att_note = f"<br><br><i>📎 Attachments: {', '.join(uploaded)}</i>"
        await _record_timeline(
            session,
            incident_id=soc_incident_id,
            direction="outbound",
            subject=f"Comment added to ServiceNow incident {sn_sys_id}",
            body=f"<p>{body_text}</p>{att_note}",
            from_email=analyst_email or "analyst@soc",
            sender_name=analyst_name or "SOC Analyst",
        )
        await session.commit()
        logger.info(f"Note added to ServiceNow incident {sn_sys_id}")
    except Exception as e:
        logger.warning(f"Failed to add note to ServiceNow incident {sn_sys_id}: {e}")
