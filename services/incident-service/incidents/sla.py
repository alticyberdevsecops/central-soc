"""
SLA tracking module — event recording, first-response detection,
per-severity breach checker, approaching-breach warnings, breach email notifications.
"""
import asyncio
import logging
import json
from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from incidents.database import AsyncSessionLocal

logger = logging.getLogger("incidents.sla")

# Default per-severity targets (used as fallback)
DEFAULT_SEVERITY_TARGETS = {
    "critical":      {"first_response_min": 15,   "resolution_min": 240},
    "high":          {"first_response_min": 30,   "resolution_min": 480},
    "medium":        {"first_response_min": 120,  "resolution_min": 1440},
    "low":           {"first_response_min": 480,  "resolution_min": 2880},
    "informational": {"first_response_min": 1440, "resolution_min": 4320},
}

WARNING_THRESHOLD = 0.75   # 75% elapsed → yellow warning
CRITICAL_THRESHOLD = 0.90  # 90% elapsed → orange/red warning


def _get_severity_target(sla_config: dict, severity: str, field: str) -> int:
    """
    Resolve the SLA target for a given severity.
    Priority: severity_targets[severity][field] → flat fallback (first_response_min / resolution_min)
    """
    sev_targets = sla_config.get("severity_targets") or {}
    if isinstance(sev_targets, str):
        try:
            sev_targets = json.loads(sev_targets)
        except:
            sev_targets = {}
    sev = (severity or "medium").lower()
    if sev in sev_targets and field in sev_targets[sev]:
        return int(sev_targets[sev][field])
    # fallback to defaults
    if sev in DEFAULT_SEVERITY_TARGETS and field in DEFAULT_SEVERITY_TARGETS[sev]:
        return int(DEFAULT_SEVERITY_TARGETS[sev][field])
    # last resort: flat config value
    return int(sla_config.get(field, 60))


# ─── Event Recording ─────────────────────────────────────────────

async def record_sla_event(
    db: AsyncSession,
    incident_id: str,
    tenant_id: str,
    event_type: str,
    actor_id: Optional[str] = None,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
    metadata: Optional[dict] = None,
):
    """Insert a row into sla_events. Fire-and-forget safe."""
    try:
        await db.execute(
            text("""
                INSERT INTO public.sla_events
                    (incident_id, tenant_id, event_type, actor_id, old_value, new_value, metadata)
                VALUES
                    (:iid, :tid, :etype, :aid, :old, :new, :meta)
            """),
            {
                "iid": incident_id,
                "tid": tenant_id,
                "etype": event_type,
                "aid": actor_id,
                "old": old_value,
                "new": new_value,
                "meta": json.dumps(metadata or {}),
            },
        )
    except Exception as e:
        logger.warning(f"SLA event recording failed for {incident_id}: {e}")


# ─── First-Response Detection ────────────────────────────────────

async def check_first_response(db: AsyncSession, incident_id: str, tenant_id: str):
    """
    If first_response_at is still NULL, set it to NOW().
    Then check against the tenant's per-severity SLA config and flag breach if exceeded.
    """
    try:
        # Only set if not already set
        result = await db.execute(
            text("""
                UPDATE public.incidents
                SET first_response_at = NOW()
                WHERE id = :iid AND first_response_at IS NULL
                RETURNING id, created_at, first_response_at, severity
            """),
            {"iid": incident_id},
        )
        row = result.mappings().first()
        if not row:
            return  # Already had first_response_at

        # Get SLA config
        cfg = await db.execute(
            text("SELECT first_response_min, resolution_min, severity_targets FROM public.sla_configs WHERE tenant_id = :tid"),
            {"tid": tenant_id},
        )
        sla = cfg.mappings().first()
        if not sla:
            return

        sla_dict = dict(sla)
        severity = row["severity"] or "medium"
        target_min = _get_severity_target(sla_dict, severity, "first_response_min")

        created = row["created_at"]
        responded = row["first_response_at"]
        if created and responded:
            elapsed_min = (responded - created).total_seconds() / 60
            if elapsed_min > target_min:
                await db.execute(
                    text("UPDATE public.incidents SET sla_first_response_breached = TRUE WHERE id = :iid"),
                    {"iid": incident_id},
                )
                await record_sla_event(
                    db, incident_id, tenant_id, "sla_breach",
                    metadata={
                        "type": "first_response",
                        "elapsed_min": round(elapsed_min, 1),
                        "target_min": target_min,
                        "severity": severity,
                    },
                )
    except Exception as e:
        logger.warning(f"check_first_response failed for {incident_id}: {e}")


# ─── Send Breach / Warning Email Notification ─────────────────────

async def _send_sla_notification(db: AsyncSession, incident: dict, breach_type: str, is_warning: bool = False):
    """
    Send an email notification to the assigned analyst about an SLA breach or approaching breach.
    """
    try:
        assigned_to = incident.get("assigned_to")
        if not assigned_to:
            return

        # Get analyst info
        user_res = await db.execute(
            text("SELECT full_name, email FROM public.users WHERE id = :uid"),
            {"uid": str(assigned_to)},
        )
        analyst = user_res.mappings().first()
        if not analyst or not analyst.get("email"):
            return

        tenant_id = str(incident["tenant_id"])

        # Get mailing config
        mail_res = await db.execute(
            text("SELECT * FROM public.mailing_configs WHERE tenant_id = :tid AND is_active = TRUE LIMIT 1"),
            {"tid": tenant_id},
        )
        mail_cfg = mail_res.mappings().first()
        if not mail_cfg:
            logger.warning(f"No mailing config for tenant {tenant_id}, skipping SLA notification")
            return

        import aiosmtplib
        from email.message import EmailMessage

        ticket_id = incident.get("ticket_id", "N/A")
        title = incident.get("title", "Untitled")
        severity = (incident.get("severity") or "medium").upper()
        elapsed_min = round(incident.get("_elapsed_min", 0), 0)
        target_min = incident.get("_target_min", 0)

        if is_warning:
            pct = round((elapsed_min / target_min * 100) if target_min else 0)
            subject = f"⚠️ SLA Warning: {breach_type.replace('_', ' ').title()} approaching breach — {ticket_id}"
            status_label = f"APPROACHING BREACH ({pct}% elapsed)"
            color = "#f0883e"
        else:
            subject = f"🔴 SLA BREACH: {breach_type.replace('_', ' ').title()} — {ticket_id}"
            status_label = "BREACHED"
            color = "#f85149"

        html = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: {color}; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
                <h2 style="margin: 0; font-size: 16px;">SLA {status_label}</h2>
            </div>
            <div style="background: #f6f8fa; border: 1px solid #d0d7de; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; color: #57606a; font-weight: 600;">Ticket</td>
                        <td style="padding: 8px 0; color: #24292f;">{ticket_id}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #57606a; font-weight: 600;">Title</td>
                        <td style="padding: 8px 0; color: #24292f;">{title}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #57606a; font-weight: 600;">Severity</td>
                        <td style="padding: 8px 0; color: #24292f;">{severity}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #57606a; font-weight: 600;">SLA Type</td>
                        <td style="padding: 8px 0; color: #24292f;">{breach_type.replace('_', ' ').title()}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #57606a; font-weight: 600;">Time Elapsed</td>
                        <td style="padding: 8px 0; color: {color}; font-weight: 700;">{int(elapsed_min // 60)}h {int(elapsed_min % 60)}m</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #57606a; font-weight: 600;">SLA Target</td>
                        <td style="padding: 8px 0; color: #24292f;">{int(target_min // 60)}h {int(target_min % 60)}m</td>
                    </tr>
                </table>
                <p style="margin-top: 16px; font-size: 13px; color: #57606a;">
                    Please take immediate action on this incident.
                </p>
            </div>
        </div>
        """

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = mail_cfg["from_email"]
        msg["To"] = analyst["email"]
        msg.set_content(f"SLA {status_label} for {ticket_id}: {title} (Severity: {severity}). Elapsed: {int(elapsed_min)}m, Target: {int(target_min)}m")
        msg.add_alternative(html, subtype="html")

        await aiosmtplib.send(
            msg,
            hostname=mail_cfg["smtp_host"],
            port=mail_cfg["smtp_port"],
            username=mail_cfg["smtp_user"],
            password=mail_cfg["smtp_pass"],
            use_tls=(mail_cfg["smtp_port"] == 465),
            start_tls=(mail_cfg["smtp_port"] == 587),
        )
        logger.info(f"SLA {'warning' if is_warning else 'breach'} notification sent to {analyst['email']} for {ticket_id}")

    except Exception as e:
        logger.warning(f"Failed to send SLA notification for incident {incident.get('id')}: {e}")


# ─── Background Breach Checker ───────────────────────────────────

async def sla_breach_checker():
    """
    Runs every 60 seconds.  Scans open incidents for SLA breaches
    and approaching-breach warnings. Uses per-severity targets.
    Also sends email notifications on breach/warning.
    """
    logger.info("SLA breach checker started (per-severity + notifications)")
    while True:
        try:
            async with AsyncSessionLocal() as db:
                async with db.begin():
                    now = datetime.now(timezone.utc)

                    # Load all SLA configs keyed by tenant_id
                    cfg_rows = await db.execute(text(
                        "SELECT tenant_id, first_response_min, resolution_min, severity_targets FROM public.sla_configs"
                    ))
                    configs = {}
                    for c in cfg_rows.mappings().all():
                        configs[str(c["tenant_id"])] = dict(c)

                    # ── Get all open incidents that might need checking, locking them to prevent double processing ──
                    rows = await db.execute(text("""
                        SELECT i.id, i.tenant_id, i.created_at, i.severity, i.status,
                               i.first_response_at, i.assigned_to, i.ticket_id, i.title,
                               i.sla_first_response_breached, i.sla_resolution_breached,
                               i.sla_fr_notified, i.sla_res_notified,
                               i.sla_fr_warning_sent, i.sla_res_warning_sent
                        FROM public.incidents i
                        WHERE i.status NOT IN ('resolved', 'false_positive')
                        FOR UPDATE SKIP LOCKED
                    """))
                    open_incidents = rows.mappings().all()

                    for r in open_incidents:
                        inc = dict(r)
                        tid = str(inc["tenant_id"])
                        cfg = configs.get(tid)
                        if not cfg:
                            continue

                        severity = (inc.get("severity") or "medium").lower()
                        created = inc["created_at"]
                        if not created:
                            continue

                        elapsed_total = (now - created).total_seconds() / 60

                        # ── FIRST RESPONSE checks ──
                        if inc["first_response_at"] is None:
                            fr_target = _get_severity_target(cfg, severity, "first_response_min")
                            fr_pct = elapsed_total / fr_target if fr_target > 0 else 0

                            # Breach
                            if not inc["sla_first_response_breached"] and fr_pct >= 1.0:
                                await db.execute(
                                    text("UPDATE public.incidents SET sla_first_response_breached = TRUE WHERE id = :iid"),
                                    {"iid": str(inc["id"])},
                                )
                                await record_sla_event(
                                    db, str(inc["id"]), tid, "sla_breach",
                                    metadata={
                                        "type": "first_response",
                                        "elapsed_min": round(elapsed_total, 1),
                                        "target_min": fr_target,
                                        "severity": severity,
                                    },
                                )
                                logger.info(f"SLA BREACH first_response: {inc['ticket_id']} ({severity}) {round(elapsed_total,1)}m > {fr_target}m")

                                # Send breach notification email
                                if not inc.get("sla_fr_notified"):
                                    inc["_elapsed_min"] = elapsed_total
                                    inc["_target_min"] = fr_target
                                    await _send_sla_notification(db, inc, "first_response", is_warning=False)
                                    await db.execute(
                                        text("UPDATE public.incidents SET sla_fr_notified = TRUE WHERE id = :iid"),
                                        {"iid": str(inc["id"])},
                                    )

                            # Approaching breach warning (75%+)
                            elif not inc.get("sla_fr_warning_sent") and fr_pct >= WARNING_THRESHOLD and fr_pct < 1.0:
                                await record_sla_event(
                                    db, str(inc["id"]), tid, "sla_warning",
                                    metadata={
                                        "type": "first_response",
                                        "elapsed_min": round(elapsed_total, 1),
                                        "target_min": fr_target,
                                        "pct": round(fr_pct * 100, 1),
                                        "severity": severity,
                                    },
                                )
                                inc["_elapsed_min"] = elapsed_total
                                inc["_target_min"] = fr_target
                                await _send_sla_notification(db, inc, "first_response", is_warning=True)
                                await db.execute(
                                    text("UPDATE public.incidents SET sla_fr_warning_sent = TRUE WHERE id = :iid"),
                                    {"iid": str(inc["id"])},
                                )
                                logger.info(f"SLA WARNING first_response: {inc.get('ticket_id')} ({severity}) {round(fr_pct*100)}% elapsed")

                        # ── RESOLUTION checks ──
                        res_target = _get_severity_target(cfg, severity, "resolution_min")
                        res_pct = elapsed_total / res_target if res_target > 0 else 0

                        # Breach
                        if not inc["sla_resolution_breached"] and res_pct >= 1.0:
                            await db.execute(
                                text("UPDATE public.incidents SET sla_resolution_breached = TRUE WHERE id = :iid"),
                                {"iid": str(inc["id"])},
                            )
                            await record_sla_event(
                                db, str(inc["id"]), tid, "sla_breach",
                                metadata={
                                    "type": "resolution",
                                    "elapsed_min": round(elapsed_total, 1),
                                    "target_min": res_target,
                                    "severity": severity,
                                },
                            )
                            logger.info(f"SLA BREACH resolution: {inc.get('ticket_id')} ({severity}) {round(elapsed_total,1)}m > {res_target}m")

                            # Send breach notification email
                            if not inc.get("sla_res_notified"):
                                inc["_elapsed_min"] = elapsed_total
                                inc["_target_min"] = res_target
                                await _send_sla_notification(db, inc, "resolution", is_warning=False)
                                await db.execute(
                                    text("UPDATE public.incidents SET sla_res_notified = TRUE WHERE id = :iid"),
                                    {"iid": str(inc["id"])},
                                )

                        # Approaching breach warning (75%+)
                        elif not inc.get("sla_res_warning_sent") and not inc["sla_resolution_breached"] and res_pct >= WARNING_THRESHOLD and res_pct < 1.0:
                            await record_sla_event(
                                db, str(inc["id"]), tid, "sla_warning",
                                metadata={
                                    "type": "resolution",
                                    "elapsed_min": round(elapsed_total, 1),
                                    "target_min": res_target,
                                    "pct": round(res_pct * 100, 1),
                                    "severity": severity,
                                },
                            )
                            inc["_elapsed_min"] = elapsed_total
                            inc["_target_min"] = res_target
                            await _send_sla_notification(db, inc, "resolution", is_warning=True)
                            await db.execute(
                                text("UPDATE public.incidents SET sla_res_warning_sent = TRUE WHERE id = :iid"),
                                {"iid": str(inc["id"])},
                            )
                            logger.info(f"SLA WARNING resolution: {inc.get('ticket_id')} ({severity}) {round(res_pct*100)}% elapsed")

        except Exception as e:
            logger.error(f"SLA breach checker error: {e}")

        await asyncio.sleep(60)


# ─── Query Helpers ────────────────────────────────────────────────

async def get_incident_sla(db: AsyncSession, incident_id: str):
    """Return SLA events + computed metrics for one incident, with per-severity targets."""
    events = await db.execute(
        text("""
            SELECT se.*, u.full_name AS actor_name
            FROM public.sla_events se
            LEFT JOIN public.users u ON u.id = se.actor_id
            WHERE se.incident_id = :iid
            ORDER BY se.created_at ASC
        """),
        {"iid": incident_id},
    )
    event_list = [dict(r) for r in events.mappings().all()]

    # Get incident timing + SLA config
    inc = await db.execute(
        text("""
            SELECT i.created_at, i.first_response_at, i.resolved_at, i.assigned_at,
                   i.sla_first_response_breached, i.sla_resolution_breached,
                   i.tenant_id, i.severity, i.status,
                   sc.first_response_min, sc.resolution_min,
                   sc.customer_reply_min, sc.escalation_response_min,
                   sc.severity_targets
            FROM public.incidents i
            LEFT JOIN public.sla_configs sc ON sc.tenant_id = i.tenant_id
            WHERE i.id = :iid
        """),
        {"iid": incident_id},
    )
    row = inc.mappings().first()
    metrics = {}
    if row:
        r = dict(row)
        created = r.get("created_at")
        first_resp = r.get("first_response_at")
        resolved = r.get("resolved_at")
        severity = (r.get("severity") or "medium").lower()
        status = r.get("status", "")

        if created and first_resp:
            metrics["first_response_min"] = round((first_resp - created).total_seconds() / 60, 1)
        if created and resolved:
            metrics["resolution_min"] = round((resolved - created).total_seconds() / 60, 1)

        # Compute time_open_min for live display
        if created:
            end_time = resolved if resolved else datetime.now(timezone.utc)
            metrics["time_open_min"] = round((end_time - created).total_seconds() / 60, 1)

        # Per-severity targets
        fr_target = _get_severity_target(r, severity, "first_response_min")
        res_target = _get_severity_target(r, severity, "resolution_min")

        metrics["targets"] = {
            "first_response_min": fr_target,
            "resolution_min": res_target,
            "customer_reply_min": r.get("customer_reply_min"),
            "escalation_response_min": r.get("escalation_response_min"),
        }
        metrics["severity"] = severity
        metrics["first_response_breached"] = r.get("sla_first_response_breached", False)
        metrics["resolution_breached"] = r.get("sla_resolution_breached", False)

        # Countdown info — how much time remains
        now = datetime.now(timezone.utc)
        if created:
            elapsed = (now - created).total_seconds() / 60

            # First response countdown
            if not first_resp and status not in ('resolved', 'false_positive'):
                fr_remaining = fr_target - elapsed
                metrics["fr_remaining_min"] = round(fr_remaining, 1)
                metrics["fr_pct_elapsed"] = round(min(elapsed / fr_target * 100, 100), 1) if fr_target > 0 else 100
            elif first_resp:
                fr_elapsed = (first_resp - created).total_seconds() / 60
                metrics["fr_pct_elapsed"] = round(min(fr_elapsed / fr_target * 100, 100), 1) if fr_target > 0 else 100

            # Resolution countdown
            if status not in ('resolved', 'false_positive'):
                res_remaining = res_target - elapsed
                metrics["res_remaining_min"] = round(res_remaining, 1)
                metrics["res_pct_elapsed"] = round(min(elapsed / res_target * 100, 100), 1) if res_target > 0 else 100
            elif resolved:
                res_elapsed = (resolved - created).total_seconds() / 60
                metrics["res_pct_elapsed"] = round(min(res_elapsed / res_target * 100, 100), 1) if res_target > 0 else 100

        # All severity targets for reference
        sev_targets = r.get("severity_targets") or {}
        if isinstance(sev_targets, str):
            try:
                sev_targets = json.loads(sev_targets)
            except:
                sev_targets = {}
        metrics["all_severity_targets"] = sev_targets or DEFAULT_SEVERITY_TARGETS

    # Serialise datetimes
    for ev in event_list:
        for k, v in ev.items():
            if isinstance(v, datetime):
                ev[k] = v.isoformat()

    return {"events": event_list, "metrics": metrics}


async def get_sla_summary(db: AsyncSession, tenant_id: str, date_from: str = None, date_to: str = None):
    """Tenant-wide SLA compliance summary."""
    date_filter = ""
    params: dict = {}
    if tenant_id and tenant_id != "public":
        date_filter += " AND i.tenant_id = :tid"
        params["tid"] = tenant_id
    if date_from:
        date_filter += " AND i.created_at >= :dfrom"
        params["dfrom"] = date_from
    if date_to:
        date_filter += " AND i.created_at <= :dto"
        params["dto"] = date_to

    result = await db.execute(text(f"""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE i.sla_first_response_breached = TRUE) AS first_response_breaches,
            COUNT(*) FILTER (WHERE i.sla_resolution_breached = TRUE) AS resolution_breaches,
            COUNT(*) FILTER (WHERE i.first_response_at IS NOT NULL) AS responded,
            COUNT(*) FILTER (WHERE i.status = 'resolved') AS resolved,
            AVG(EXTRACT(EPOCH FROM (i.first_response_at - i.created_at)) / 60)
                FILTER (WHERE i.first_response_at IS NOT NULL) AS avg_first_response_min,
            AVG(EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) / 60)
                FILTER (WHERE i.resolved_at IS NOT NULL) AS avg_resolution_min
        FROM public.incidents i
        WHERE 1=1 {date_filter}
    """), params)
    row = result.mappings().first()
    r = dict(row) if row else {}
    total = int(r.get("total") or 0)
    fr_breaches = int(r.get("first_response_breaches") or 0)
    res_breaches = int(r.get("resolution_breaches") or 0)

    return {
        "total_incidents": total,
        "first_response_breaches": fr_breaches,
        "resolution_breaches": res_breaches,
        "first_response_compliance_pct": round(((total - fr_breaches) / total * 100) if total else 100, 1),
        "resolution_compliance_pct": round(((total - res_breaches) / total * 100) if total else 100, 1),
        "avg_first_response_min": round(float(r.get("avg_first_response_min") or 0), 1),
        "avg_resolution_min": round(float(r.get("avg_resolution_min") or 0), 1),
        "responded": int(r.get("responded") or 0),
        "resolved": int(r.get("resolved") or 0),
    }


async def get_analyst_metrics(db: AsyncSession, tenant_id: str = None, date_from: str = None, date_to: str = None):
    """Per-analyst SLA performance."""
    date_filter = ""
    params: dict = {}
    if tenant_id and tenant_id != "public":
        date_filter += " AND i.tenant_id = :tid"
        params["tid"] = tenant_id
    if date_from:
        date_filter += " AND i.created_at >= :dfrom"
        params["dfrom"] = date_from
    if date_to:
        date_filter += " AND i.created_at <= :dto"
        params["dto"] = date_to

    result = await db.execute(text(f"""
        SELECT
            u.id AS analyst_id,
            u.full_name AS analyst_name,
            u.email AS analyst_email,
            COUNT(i.id) AS assigned_count,
            COUNT(i.id) FILTER (WHERE i.status = 'resolved') AS resolved_count,
            COUNT(i.id) FILTER (WHERE i.sla_first_response_breached = TRUE) AS fr_breaches,
            COUNT(i.id) FILTER (WHERE i.sla_resolution_breached = TRUE) AS res_breaches,
            AVG(EXTRACT(EPOCH FROM (i.first_response_at - i.created_at)) / 60)
                FILTER (WHERE i.first_response_at IS NOT NULL) AS avg_first_response_min,
            AVG(EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) / 60)
                FILTER (WHERE i.resolved_at IS NOT NULL) AS avg_resolution_min
        FROM public.incidents i
        JOIN public.users u ON u.id = i.assigned_to
        WHERE i.assigned_to IS NOT NULL {date_filter}
        GROUP BY u.id, u.full_name, u.email
        ORDER BY assigned_count DESC
    """), params)
    rows = result.mappings().all()
    analysts = []
    for r in rows:
        r = dict(r)
        assigned = int(r.get("assigned_count") or 0)
        fr_b = int(r.get("fr_breaches") or 0)
        res_b = int(r.get("res_breaches") or 0)
        analysts.append({
            "analyst_id": str(r["analyst_id"]),
            "analyst_name": r["analyst_name"],
            "analyst_email": r["analyst_email"],
            "assigned_count": assigned,
            "resolved_count": int(r.get("resolved_count") or 0),
            "fr_breaches": fr_b,
            "res_breaches": res_b,
            "compliance_pct": round(((assigned - fr_b) / assigned * 100) if assigned else 100, 1),
            "avg_first_response_min": round(float(r.get("avg_first_response_min") or 0), 1),
            "avg_resolution_min": round(float(r.get("avg_resolution_min") or 0), 1),
        })
    return {"analysts": analysts}


async def get_single_analyst(db: AsyncSession, analyst_id: str, tenant_id: str = None, date_from: str = None, date_to: str = None):
    """Detailed SLA breakdown for one analyst."""
    date_filter = ""
    params: dict = {"aid": analyst_id}
    if tenant_id:
        date_filter += " AND i.tenant_id = :tid"
        params["tid"] = tenant_id
    if date_from:
        date_filter += " AND i.created_at >= :dfrom"
        params["dfrom"] = date_from
    if date_to:
        date_filter += " AND i.created_at <= :dto"
        params["dto"] = date_to

    # Analyst info
    user_res = await db.execute(text("SELECT id, full_name, email FROM public.users WHERE id = :aid"), {"aid": analyst_id})
    user = user_res.mappings().first()

    # Incidents assigned to this analyst
    result = await db.execute(text(f"""
        SELECT i.id, i.ticket_id, i.title, i.severity, i.status,
               i.created_at, i.first_response_at, i.resolved_at, i.assigned_at,
               i.sla_first_response_breached, i.sla_resolution_breached
        FROM public.incidents i
        WHERE i.assigned_to = :aid {date_filter}
        ORDER BY i.created_at DESC
        LIMIT 100
    """), params)
    incidents = []
    for r in result.mappings().all():
        r = dict(r)
        for k, v in r.items():
            if isinstance(v, datetime):
                r[k] = v.isoformat()
        incidents.append(r)

    return {
        "analyst": dict(user) if user else None,
        "incidents": incidents,
    }

async def get_sla_time_series(db: AsyncSession, tenant_id: str = None, days: int = 30):
    """
    Returns time-series data for SLA metrics (MTTD, MTTR Response, MTTR Resolution)
    grouped by day.
    """
    date_filter = ""
    params: dict = {"days": days}
    if tenant_id and tenant_id != "public":
        date_filter += " AND i.tenant_id = :tid"
        params["tid"] = tenant_id

    # We group by date of creation.
    # MTTD: Detection Time = Arrival (source_created_at or first_seen_at) to SOC Creation (created_at)
    # MTTR Response: Reaction Time = SOC Creation to First Response
    # MTTR Resolution: Resolution Time = SOC Creation to Resolution
    
    sql = text(f"""
        SELECT
            DATE(i.created_at) AS date,
            AVG(EXTRACT(EPOCH FROM (i.created_at - COALESCE(i.source_created_at, i.first_seen_at, i.created_at))) / 60) AS avg_mttd_min,
            AVG(EXTRACT(EPOCH FROM (i.first_response_at - i.created_at)) / 60) 
                FILTER (WHERE i.first_response_at IS NOT NULL) AS avg_mttr_response_min,
            AVG(EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) / 60) 
                FILTER (WHERE i.resolved_at IS NOT NULL) AS avg_mttr_resolution_min,
            COUNT(*) AS total_count
        FROM public.incidents i
        WHERE i.created_at >= NOW() - (:days * INTERVAL '1 day') {date_filter}
        GROUP BY DATE(i.created_at)
        ORDER BY DATE(i.created_at) ASC
    """)

    result = await db.execute(sql, params)
    rows = result.mappings().all()
    
    series = []
    for r in rows:
        series.append({
            "date": r["date"].isoformat() if r["date"] else None,
            "mttd": round(float(r["avg_mttd_min"] or 0), 1),
            "mttr_response": round(float(r["avg_mttr_response_min"] or 0), 1),
            "mttr_resolution": round(float(r["avg_mttr_resolution_min"] or 0), 1),
            "count": int(r["total_count"] or 0)
        })
        
    return {"series": series}
