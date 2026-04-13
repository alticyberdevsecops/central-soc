"""
Incident routes — all queries are tenant-scoped.
super_admin can query across all tenants via ?tenant_id= param.
"""
import logging
import json as _json
import uuid as _uuid
from datetime import datetime, timezone
from typing import Optional, List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Form, File, UploadFile, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel
import httpx
import redis.asyncio as aioredis
from incidents.database import get_db
from incidents.auth import get_current_user
from config import settings

router = APIRouter()
logger = logging.getLogger("incidents.routes")


async def _publish_automation_event(event_type: str, incident_data: dict):
    """Publish incident event to Redis for the automation trigger evaluator."""
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        payload = _json.dumps({
            "event_type": event_type,
            "incident_id": str(incident_data.get("id", "")),
            "ticket_id": incident_data.get("ticket_id", ""),
            "tenant_id": str(incident_data.get("tenant_id", "")),
            "title": incident_data.get("title", ""),
            "severity": incident_data.get("severity", ""),
            "status": incident_data.get("status", ""),
            "old_status": incident_data.get("old_status", ""),
            "assigned_to": str(incident_data.get("assigned_to", "") or ""),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        await r.publish("incident_events", payload)
        await r.aclose()
    except Exception as e:
        logger.warning(f"Failed to publish automation event {event_type}: {e}")


def is_uuid(val: str) -> bool:
    try:
        UUID(val)
        return True
    except (ValueError, TypeError):
        return False


class StatusUpdate(BaseModel):
    status: str


class AssignUpdate(BaseModel):
    user_id: Optional[str] = None


class AssignAgenticJob(BaseModel):
    job_id: str


class CommentCreate(BaseModel):
    content: str
    is_internal: bool = False


class MailingRequest(BaseModel):
    team_id: str


class AutonomousReport(BaseModel):
    incident_id: str
    ticket_id: str
    status: str
    analysis_report: str
    timestamp: str


class ReplyRequest(BaseModel):
    body: str


class ManualIncidentCreate(BaseModel):
    title: str
    description: Optional[str] = None
    severity: str = "medium"
    status: str = "new"
    tenant_id: Optional[str] = None
    created_by_id: Optional[str] = None
    incident_id: Optional[str] = None
    tags: Optional[List[str]] = []
    affected_hosts: Optional[List[str]] = []
    affected_users: Optional[List[str]] = []
    alert_ids: Optional[List[str]] = []
    alert_arrival_timestamp: Optional[str] = None
    command_initiated: Optional[str] = None
    asset_details: Optional[list] = []
    iocs: Optional[list] = []
    mitre_attack: Optional[list] = []
    observations: Optional[List[str]] = []
    business_impact: Optional[List[str]] = []
    recommendations: Optional[List[str]] = []


class ManualIncidentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    tags: Optional[List[str]] = None
    affected_hosts: Optional[List[str]] = None
    affected_users: Optional[List[str]] = None
    alert_ids: Optional[List[str]] = None
    alert_arrival_timestamp: Optional[str] = None
    command_initiated: Optional[str] = None
    asset_details: Optional[list] = None
    iocs: Optional[list] = None
    mitre_attack: Optional[list] = None
    mitre_tactics: Optional[List[str]] = None
    mitre_techniques: Optional[List[str]] = None
    notes: Optional[str] = None
    observations: Optional[List[str]] = None
    business_impact: Optional[List[str]] = None
    recommendations: Optional[List[str]] = None


SCHEMA_CACHE = {}  # tenant_id -> schema_name

async def get_schema_for_tenant(db: AsyncSession, tenant_id: str) -> str:
    if not tenant_id or str(tenant_id) == "public" or str(tenant_id) == "None":
        return "public"
        
    s_tid = str(tenant_id)
    if s_tid in SCHEMA_CACHE:
        return SCHEMA_CACHE[s_tid]
    
    try:
        result = await db.execute(
            text("SELECT schema_name FROM public.tenants WHERE id = CAST(:tid AS UUID)"),
            {"tid": s_tid}
        )
        row = result.fetchone()
        if row:
            SCHEMA_CACHE[s_tid] = row[0]
            return row[0]
    except Exception as e:
        logger.error(f"Error resolving schema for tenant {tenant_id}: {e}")
        
    return "public"


async def get_schema_from_incident(db: AsyncSession, incident_id: str, user: dict) -> str:
    _, _, target_tid = build_tenant_filter(user)
    
    if is_uuid(incident_id):
        t_sql = text("SELECT tenant_id FROM public.incidents WHERE id = CAST(:iid AS UUID)")
    else:
        t_sql = text("SELECT tenant_id FROM public.incidents WHERE ticket_id = :iid")
        
    t_res = await db.execute(t_sql, {"iid": incident_id})
    t_row = t_res.fetchone()
    
    if not t_row:
        raise HTTPException(status_code=404, detail="Incident not found in global register")

    actual_tid = str(t_row[0]) if t_row[0] else None

    # Access check: super_admin can access all; multi-tenant users can access their assigned tenants
    if user.get("role") != "super_admin":
        user_tenant_ids = user.get("tenant_ids") or []
        if user_tenant_ids:
            if actual_tid and actual_tid not in user_tenant_ids:
                raise HTTPException(status_code=403, detail="Access denied")
        elif target_tid and target_tid != actual_tid:
            raise HTTPException(status_code=403, detail="Access denied")

    return await get_schema_for_tenant(db, actual_tid)


def build_tenant_filter(user: dict, requested_tenant_id: Optional[str] = None) -> tuple[str, dict, str]:
    """
    Return (where_clause, params, schema_name).
    - super_admin → full cross-tenant (public schema)
    - Multi-tenant user (tenant_ids has 2+) → public schema, filter by allowed tenant_ids
    - Single-tenant user → their own tenant schema
    - No tenant → cross-tenant (public schema)
    """
    role = user.get("role")
    user_tenant_id = user.get("tenant_id")
    user_tenant_ids = user.get("tenant_ids") or []

    # Super admin → full cross-tenant access
    if role == "super_admin":
        target_tenant = requested_tenant_id if requested_tenant_id else None
        if not target_tenant:
            return "1=1", {}, "public"
        return "1=1", {}, target_tenant

    # Multi-tenant user: has specific assigned tenants (2+)
    if len(user_tenant_ids) > 1:
        if requested_tenant_id and requested_tenant_id in user_tenant_ids:
            return "1=1", {}, requested_tenant_id
        # Query public schema — caller should add tenant_id IN (...) filter
        return "1=1", {}, "public"

    # Single tenant user (from tenant_ids or legacy tenant_id)
    single_tid = user_tenant_ids[0] if user_tenant_ids else user_tenant_id
    if single_tid:
        return "1=1", {}, single_tid

    # No tenant assigned → cross-tenant access
    target_tenant = requested_tenant_id if requested_tenant_id else None
    if not target_tenant:
        return "1=1", {}, "public"
    return "1=1", {}, target_tenant


@router.get("")
async def list_incidents(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    tenant_id: Optional[str] = Query(None, description="Filter by tenant (super_admin only)"),
    severity: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    source_vendor: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort_by: str = Query("last_updated_at"),
    sort_dir: str = Query("desc"),
):
    where_clause_tpl, params, target_tid = build_tenant_filter(user, tenant_id)
    
    async with db as session:
        # Schema switching
        schema = await get_schema_for_tenant(session, target_tid)
        await session.execute(text(f"SET search_path TO {schema}, public"))

        conditions = ["1=1"] # Filter by tenant_id is now handled by search_path/schema

        # Multi-tenant user: restrict to their assigned tenants when querying public schema
        user_tenant_ids = user.get("tenant_ids") or []
        if len(user_tenant_ids) > 1 and schema == "public" and not tenant_id:
            tid_list = ",".join(f"'{t}'" for t in user_tenant_ids)
            conditions.append(f"i.tenant_id::text IN ({tid_list})")

        if severity:
            conditions.append("i.severity = :severity")
            params["severity"] = severity
        if status:
            conditions.append("i.status = :status")
            params["status"] = status
        if source_vendor:
            conditions.append("i.source_vendor = :source_vendor")
            params["source_vendor"] = source_vendor
        if search:
            conditions.append("""(
                i.title ILIKE :search
                OR i.description ILIKE :search
                OR i.ticket_id ILIKE :search
                OR i.vendor_incident_id ILIKE :search
                OR i.source_vendor ILIKE :search
                OR i.severity ILIKE :search
                OR i.status ILIKE :search
                OR COALESCE(i.affected_hosts::text, '') ILIKE :search
                OR COALESCE(i.affected_users::text, '') ILIKE :search
                OR COALESCE(i.tags::text, '') ILIKE :search
                OR COALESCE(i.iocs::text, '') ILIKE :search
                OR COALESCE(i.mitre_tactics::text, '') ILIKE :search
                OR COALESCE(i.mitre_techniques::text, '') ILIKE :search
                OR COALESCE(i.raw_payload::text, '') ILIKE :search
                OR COALESCE(t.name, '') ILIKE :search
            )""")
            params["search"] = f"%{search}%"

        where_clause = " AND ".join(conditions)
        sort_col = sort_by if sort_by in ("created_at", "source_created_at", "last_updated_at", "updated_at", "severity", "status", "source_vendor", "title") else "last_updated_at"
        sort_direction = "DESC" if sort_dir.lower() == "desc" else "ASC"
        offset = (page - 1) * page_size
        params.update({"limit": page_size, "offset": offset})

        count_sql = text(f"""
            SELECT COUNT(*) FROM incidents i
            LEFT JOIN public.tenants t ON t.id = i.tenant_id
            WHERE {where_clause}
        """)
        data_sql = text(f"""
            SELECT i.id, i.tenant_id, i.ticket_id, i.source_vendor, i.vendor_incident_id, i.title,
                   i.description, i.severity, i.status, i.affected_hosts, i.affected_users,
                   i.iocs, i.mitre_tactics, i.mitre_techniques, i.tags, i.vendor_url,
                   i.source_created_at, i.created_at, i.updated_at, i.last_updated_at, i.assigned_to,
                   i.sla_first_response_breached, i.sla_resolution_breached,
                   i.sla_fr_warning_sent, i.sla_res_warning_sent,
                   t.name AS tenant_name, t.slug AS tenant_slug,
                   u.full_name AS assigned_to_name
            FROM incidents i
            LEFT JOIN public.tenants t ON t.id = i.tenant_id
            LEFT JOIN public.users u ON u.id = i.assigned_to
            WHERE {where_clause}
            ORDER BY i.{sort_col} {sort_direction}
            LIMIT :limit OFFSET :offset
        """)

        total_result = await session.execute(count_sql, params)
        total = total_result.scalar()
        result = await session.execute(data_sql, params)
        rows = result.mappings().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "incidents": [dict(row) for row in rows],
    }


@router.get("/stats")
async def get_stats(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    tenant_id: Optional[str] = Query(None),
):
    _, _, target_tid = build_tenant_filter(user, tenant_id)
    
    async with db as session:
        schema = await get_schema_for_tenant(session, target_tid)
        await session.execute(text(f"SET search_path TO {schema}, public"))

        # Multi-tenant filter for stats
        user_tenant_ids = user.get("tenant_ids") or []
        stats_where = "1=1"
        if len(user_tenant_ids) > 1 and schema == "public" and not tenant_id:
            tid_list = ",".join(f"'{t}'" for t in user_tenant_ids)
            stats_where = f"tenant_id::text IN ({tid_list})"

        sql = text(f"""
            SELECT
                COUNT(*) FILTER (WHERE status = 'new') AS new_count,
                COUNT(*) FILTER (WHERE status = 'triaging') AS triaging_count,
                COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_count,
                COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
                COUNT(*) FILTER (WHERE status = 'false_positive') AS false_positive_count,
                COUNT(*) FILTER (WHERE status = 'escalated') AS escalated_count,
                COUNT(*) FILTER (WHERE status = 'ai triaging') AS ai_triaging_count,
                COUNT(*) FILTER (WHERE status = 'sent to customer') AS sent_to_customer_count,
                COUNT(*) FILTER (WHERE status = 'customer response received') AS customer_response_count,
                COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
                COUNT(*) FILTER (WHERE severity = 'high') AS high_count,
                COUNT(*) FILTER (WHERE severity = 'medium') AS medium_count,
                COUNT(*) FILTER (WHERE severity = 'low') AS low_count,
                COUNT(*) FILTER (WHERE severity = 'informational') AS informational_count,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS last_7d,
                source_vendor,
                COUNT(*) AS vendor_count
            FROM incidents
            WHERE {stats_where}
            GROUP BY ROLLUP(source_vendor)
        """)
        result = await session.execute(sql)
        rows = result.mappings().all()

    summary = {}
    vendor_breakdown = []
    for row in rows:
        r = dict(row)
        if r.get("source_vendor") is None:
            summary = {k: int(v or 0) for k, v in r.items() if k not in ("source_vendor", "vendor_count")}
            summary["total_incidents"] = int(r.get("vendor_count") or 0)
        else:
            vendor_breakdown.append({"vendor": r["source_vendor"], "count": int(r.get("vendor_count") or 0)})

    return {"summary": summary, "by_vendor": vendor_breakdown}


@router.post("")
async def create_incident(
    body: ManualIncidentCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Create a manual ticket / incident."""
    valid_severities = ("critical", "high", "medium", "low", "informational")
    valid_statuses = ("new", "triaging", "ai triaging", "in_progress", "resolved", "false_positive", "escalated", "sent to customer", "customer response received")

    if body.severity not in valid_severities:
        raise HTTPException(status_code=400, detail=f"Invalid severity. Must be one of: {valid_severities}")
    if body.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")

    # Determine tenant_id
    role = user.get("role")
    user_tenant_id = user.get("tenant_id")
    is_cross_tenant = role == "super_admin" or not user_tenant_id

    if is_cross_tenant:
        target_tenant_id = body.tenant_id  # super_admin chooses tenant
    else:
        target_tenant_id = user_tenant_id  # regular users → their own tenant

    if not target_tenant_id:
        raise HTTPException(status_code=400, detail="A tenant must be selected for ticket creation")

    tenant_name = "Unknown"

    async with db as session:
        async with session.begin():
            schema = await get_schema_for_tenant(session, target_tenant_id)
            if schema == "public" and target_tenant_id and target_tenant_id != "public":
                raise HTTPException(status_code=400, detail="Invalid tenant — schema not found")

            await session.execute(text(f"SET LOCAL search_path TO {schema}, public"))

            # Fetch tenant name (needed later for Redis live event)
            tn_res = await session.execute(
                text("SELECT name FROM public.tenants WHERE id = CAST(:tid AS UUID)"),
                {"tid": target_tenant_id}
            )
            tn_row = tn_res.fetchone()
            if tn_row:
                tenant_name = tn_row[0]

            # Generate ticket_id: {TENANT_PREFIX}-{SEQ} (same pattern as auto-ingested)
            # e.g. ATPL-0001, STAR-0002
            tenant_prefix = tenant_name[:4].upper() if tenant_name and tenant_name != "Unknown" else "MAN"

            if body.incident_id and body.incident_id.strip():
                # User provided a custom incident ID — prepend tenant prefix
                custom_id = body.incident_id.strip()
                ticket_id = f"{tenant_prefix}-{custom_id}"
            else:
                # Auto-generate: count existing manual tickets for this tenant
                count_res = await session.execute(
                    text("SELECT COUNT(*) FROM incidents WHERE source_vendor = 'manual'")
                )
                count = count_res.scalar() or 0
                ticket_id = f"{tenant_prefix}-{count + 1:04d}"

            # Generate unique vendor_incident_id
            vendor_incident_id = f"manual-{_uuid.uuid4().hex[:16]}"

            # Resolve "created by" user info
            # Admins can pick an analyst; analysts default to themselves
            creator_id = user.get("sub")
            creator_email = user.get("email")
            creator_name = None

            if body.created_by_id and role in ("super_admin", "customer_admin"):
                # Admin selected a specific user — look up their info
                u_res = await session.execute(
                    text("SELECT id, email, full_name FROM public.users WHERE id = CAST(:uid AS UUID)"),
                    {"uid": body.created_by_id}
                )
                u_row = u_res.mappings().first()
                if u_row:
                    creator_id = str(u_row["id"])
                    creator_email = u_row["email"]
                    creator_name = u_row["full_name"]

            # Extract MITRE tactics/techniques from mitre_attack list of dicts
            mitre_data = body.mitre_attack or []
            mitre_tactics_list = list({m.get("tactic", "") for m in mitre_data if m.get("tactic")})
            mitre_techniques_list = list({m.get("technique", "") for m in mitre_data if m.get("technique")})

            # Build raw_payload with creator info + extended fields
            raw_payload = _json.dumps({
                "created_by": {
                    "id": creator_id,
                    "email": creator_email,
                    "name": creator_name,
                    "role": role,
                },
                "submitted_by": {
                    "id": user.get("sub"),
                    "email": user.get("email"),
                    "role": role,
                },
                "source": "manual_ticket",
                "alert_ids": body.alert_ids or [],
                "alert_arrival_timestamp": body.alert_arrival_timestamp,
                "command_initiated": body.command_initiated,
                "asset_details": body.asset_details or [],
                "iocs": body.iocs or [],
                "tags": body.tags or [],
                "affected_hosts": body.affected_hosts or [],
                "affected_users": body.affected_users or [],
                "observations": body.observations or [],
                "business_impact": body.business_impact or [],
                "recommendations": body.recommendations or [],
                "mitre_attack": mitre_data,
            })

            # Build JSON arrays for postgres JSONB columns
            tags_json = _json.dumps(body.tags or [])
            hosts_json = _json.dumps(body.affected_hosts or [])
            users_json = _json.dumps(body.affected_users or [])
            iocs_json = _json.dumps(body.iocs or [])
            mitre_tactics_json = _json.dumps(mitre_tactics_list)
            mitre_techniques_json = _json.dumps(mitre_techniques_list)

            sql = text("""
                INSERT INTO incidents (
                    tenant_id, ticket_id, source_vendor, vendor_incident_id,
                    title, description, severity, status, assigned_to,
                    affected_hosts, affected_users, tags,
                    iocs, mitre_tactics, mitre_techniques,
                    raw_payload, first_response_at, resolved_at
                ) VALUES (
                    CAST(:tenant_id AS UUID), :ticket_id, 'manual', :vendor_incident_id,
                    :title, :description, :severity, CAST(:status AS VARCHAR),
                    CAST(:creator_id AS UUID),
                    CAST(:affected_hosts AS JSONB), CAST(:affected_users AS JSONB),
                    CAST(:tags AS JSONB),
                    CAST(:iocs AS JSONB), CAST(:mitre_tactics AS JSONB), CAST(:mitre_techniques AS JSONB),
                    CAST(:raw_payload AS JSONB),
                    CASE WHEN CAST(:status AS VARCHAR) != 'new' THEN NOW() ELSE NULL END,
                    CASE WHEN CAST(:status AS VARCHAR) = 'resolved' THEN NOW() ELSE NULL END
                )
                RETURNING id, ticket_id, tenant_id, title, severity, status, created_at
            """)
            result = await session.execute(sql, {
                "tenant_id": target_tenant_id if target_tenant_id != "public" else None,
                "ticket_id": ticket_id,
                "vendor_incident_id": vendor_incident_id,
                "title": body.title,
                "description": body.description or "",
                "severity": body.severity,
                "status": body.status,
                "creator_id": creator_id,
                "affected_hosts": hosts_json,
                "affected_users": users_json,
                "tags": tags_json,
                "iocs": iocs_json,
                "mitre_tactics": mitre_tactics_json,
                "mitre_techniques": mitre_techniques_json,
                "raw_payload": raw_payload,
            })
            row = result.mappings().first()

    if not row:
        raise HTTPException(status_code=500, detail="Failed to create ticket")

    created = dict(row)
    logger.info(f"Manual ticket {ticket_id} created by {creator_email} (submitted by {user.get('email')}) in tenant {target_tenant_id}")

    # Publish to Redis pub/sub so Live Monitoring picks it up in real-time
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        live_event = _json.dumps({
            "event_type": "new_incident",
            "incident_id": str(created["id"]),
            "ticket_id": ticket_id,
            "tenant_id": target_tenant_id,
            "tenant_name": tenant_name,
            "title": body.title,
            "severity": body.severity,
            "status": body.status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        await r.publish("soc:incidents:live", live_event)
        await r.aclose()
        logger.info(f"Published live event for {ticket_id}")
    except Exception as e:
        logger.warning(f"Failed to publish live event for {ticket_id}: {e}")

    # ── SLA: record 'created' event ──
    try:
        from incidents.sla import record_sla_event
        async with db as sla_session:
            async with sla_session.begin():
                await record_sla_event(sla_session, str(created["id"]), target_tenant_id, "created", actor_id=user.get("sub"))
    except Exception as e:
        logger.warning(f"SLA event failed for create {ticket_id}: {e}")

    # ── Automation: publish incident_created event ──
    await _publish_automation_event("incident_created", {
        "id": created["id"], "ticket_id": ticket_id, "tenant_id": target_tenant_id,
        "title": body.title, "severity": body.severity, "status": body.status,
    })

    # ── Build the full incident payload for ITSM pushes (rich HTML needs all fields) ──
    _itsm_incident_data = {
        "id": created["id"],
        "ticket_id": ticket_id,
        "title": body.title,
        "description": body.description or "",
        "severity": body.severity,
        "status": body.status,
        "created_at": created["created_at"],
        "raw_payload": raw_payload,   # JSON string — generate_incident_html handles it
        "user_id": creator_id,        # Used to fetch the analyst's saved signature
    }

    # ── Freshservice: push new incident (fire-and-forget) ──
    try:
        from incidents.freshservice import push_to_freshservice
        from incidents.database import AsyncSessionLocal as _ASL
        _itsm_data_fs = dict(_itsm_incident_data)
        async def _push_fs():
            async with _ASL() as _fs_sess:
                await push_to_freshservice(_fs_sess, _itsm_data_fs, target_tenant_id)
        import asyncio as _asyncio
        _asyncio.create_task(_push_fs())
    except Exception as _e:
        logger.warning(f"Freshservice push skipped for {ticket_id}: {_e}")

    # ── ServiceNow: push new incident (fire-and-forget) ──
    try:
        from incidents.servicenow import push_to_servicenow
        from incidents.database import AsyncSessionLocal as _ASL2
        _itsm_data_sn = dict(_itsm_incident_data)
        async def _push_sn():
            async with _ASL2() as _sn_sess:
                await push_to_servicenow(_sn_sess, _itsm_data_sn, target_tenant_id)
        import asyncio as _asyncio
        _asyncio.create_task(_push_sn())
    except Exception as _e:
        logger.warning(f"ServiceNow push skipped for {ticket_id}: {_e}")

    # ── Freshdesk: push new incident (fire-and-forget) ──
    try:
        from incidents.freshdesk import push_to_freshdesk
        from incidents.database import AsyncSessionLocal as _ASL3
        _itsm_data_fd = dict(_itsm_incident_data)
        async def _push_fd():
            async with _ASL3() as _fd_sess:
                await push_to_freshdesk(_fd_sess, _itsm_data_fd, target_tenant_id)
        import asyncio as _asyncio
        _asyncio.create_task(_push_fd())
    except Exception as _e:
        logger.warning(f"Freshdesk push skipped for {ticket_id}: {_e}")

    return created


# ═══════════════════════════════════════════════════════════════
# SLA QUERY ENDPOINTS (must be before /{incident_id} routes)
# ═══════════════════════════════════════════════════════════════

@router.get("/sla/summary")
async def sla_summary_endpoint(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    tenant_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    """Tenant-wide SLA compliance summary."""
    from incidents.sla import get_sla_summary
    _, _, target_tid = build_tenant_filter(user, tenant_id)
    async with db as session:
        return await get_sla_summary(session, target_tid, date_from, date_to)


@router.get("/sla/analysts")
async def sla_analysts_endpoint(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    tenant_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    """Per-analyst SLA performance metrics."""
    from incidents.sla import get_analyst_metrics
    _, _, target_tid = build_tenant_filter(user, tenant_id)
    async with db as session:
        return await get_analyst_metrics(session, target_tid, date_from, date_to)


@router.get("/sla/analysts/{analyst_id}")
async def sla_analyst_detail_endpoint(
    analyst_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    tenant_id: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    """Detailed SLA breakdown for one analyst."""
    from incidents.sla import get_single_analyst
    _, _, target_tid = build_tenant_filter(user, tenant_id)
    async with db as session:
        return await get_single_analyst(session, analyst_id, target_tid, date_from, date_to)



@router.get("/ciso/dashboard")
async def ciso_dashboard_endpoint(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """High-level executive dashboard metrics."""
    role = user.get("role")
    if role != "super_admin":
        raise HTTPException(status_code=403, detail="CISO Dashboard is for Super Admins only")

    async with db as session:
        # 1. Global Risk Score
        # Formula: (Active Critical * 10 + High * 5 + Medium * 2) / Total
        risk_sql = text("""
            SELECT 
                COUNT(*) FILTER (WHERE severity = 'critical' AND status != 'resolved') as crit,
                COUNT(*) FILTER (WHERE severity = 'high' AND status != 'resolved') as high,
                COUNT(*) FILTER (WHERE severity = 'medium' AND status != 'resolved') as med,
                COUNT(*) as total
            FROM public.incidents
        """)
        risk_res = await session.execute(risk_sql)
        risk_row = risk_res.mappings().first()
        
        crit = risk_row["crit"] or 0
        high = risk_row["high"] or 0
        med = risk_row["med"] or 0
        total = risk_row["total"] or 1
        # Normalize to 0-100
        risk_score = min(100.0, round(((crit * 10) + (high * 5) + (med * 2)) / total * 10, 1))

        # 2. Automation ROI
        roi_sql = text("""
            SELECT 
                COUNT(*) FILTER (WHERE status = 'resolved') as total_resolved,
                COUNT(*) FILTER (WHERE status = 'ai triaging') as ai_handled
            FROM public.incidents
        """)
        roi_res = await session.execute(roi_sql)
        roi_row = roi_res.mappings().first()
        
        # 3. Monthly Trends
        trend_sql = text("""
            SELECT 
                DATE(created_at) as date,
                severity,
                COUNT(*) as count
            FROM public.incidents
            WHERE created_at > NOW() - INTERVAL '30 days'
            GROUP BY DATE(created_at), severity
            ORDER BY DATE(created_at) ASC
        """)
        trend_res = await session.execute(trend_sql)
        trend_rows = trend_res.mappings().all()
        
        trends = {}
        for row in trend_rows:
            dt = row["date"].isoformat()
            if dt not in trends:
                trends[dt] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "informational": 0}
            trends[dt][row["severity"]] = row["count"]

        # 4. Top Tenants by volume
        tenant_sql = text("""
            SELECT 
                t.name,
                COUNT(i.id) as incident_count
            FROM public.incidents i
            JOIN public.tenants t ON t.id = i.tenant_id
            GROUP BY t.name
            ORDER BY incident_count DESC
            LIMIT 5
        """)
        tenant_res = await session.execute(tenant_sql)
        tenant_rows = tenant_res.mappings().all()

    return {
        "risk_score": risk_score,
        "automation_roi": {
            "incidents_resolved": roi_row["total_resolved"] or 0,
            "ai_triaged": roi_row["ai_handled"] or 0,
            "estimated_savings_usd": (roi_row["total_resolved"] or 0) * 50 # $50 per resolved incident ROI
        },
        "trends": [{"date": k, **v} for k, v in trends.items()],
        "top_tenants": [dict(r) for r in tenant_rows]
    }


@router.get("/sla/time-series")
async def sla_time_series_endpoint(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    tenant_id: Optional[str] = Query(None),
    days: int = Query(30),
):
    """Time-series SLA metrics (MTTD, MTTR Response, MTTR Resolution) grouped by day."""
    from incidents.sla import get_sla_time_series
    _, _, target_tid = build_tenant_filter(user, tenant_id)
    async with db as session:
        return await get_sla_time_series(session, target_tid, days)


@router.delete("/{incident_id}")
async def delete_incident(
    incident_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Delete an incident — super_admin and customer_admin only."""
    role = user.get("role")
    if role not in ("super_admin", "customer_admin"):
        raise HTTPException(status_code=403, detail="Only admins can delete incidents")

    async with db as session:
        async with session.begin():
            schema = await get_schema_from_incident(session, incident_id, user)
            await session.execute(text(f"SET LOCAL search_path TO {schema}, public"))

            where_col = "id" if is_uuid(incident_id) else "ticket_id"

            # Delete comments first (foreign key)
            uuid_res = await session.execute(
                text(f"SELECT id FROM incidents WHERE {where_col} = :iid"), {"iid": incident_id}
            )
            actual_uuid = uuid_res.scalar()
            if not actual_uuid:
                raise HTTPException(status_code=404, detail="Incident not found")

            await session.execute(
                text("DELETE FROM incident_comments WHERE incident_id = :iid"),
                {"iid": actual_uuid}
            )
            result = await session.execute(
                text(f"DELETE FROM incidents WHERE id = :iid RETURNING id, ticket_id"),
                {"iid": actual_uuid}
            )
            deleted = result.fetchone()
            if not deleted:
                raise HTTPException(status_code=404, detail="Incident not found")

    logger.info(f"Incident {incident_id} deleted by {user.get('email')}")
    return {"status": "deleted", "id": str(deleted[0]), "ticket_id": deleted[1]}


@router.get("/{incident_id}")
async def get_incident(
    incident_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    async with db as session:
        async with session.begin():
            schema = await get_schema_from_incident(session, incident_id, user)
            await session.execute(text(f"SET LOCAL search_path TO {schema}, public"))

            where_col = "i.id" if is_uuid(incident_id) else "i.ticket_id"
            sql = text(f"""
                SELECT i.*, i.ticket_id, i.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
                       u.full_name AS assigned_to_name, u.email AS assigned_to_email,
                       i.agentic_job_id
                FROM incidents i
                LEFT JOIN public.tenants t ON t.id = i.tenant_id
                LEFT JOIN public.users u ON u.id = i.assigned_to
                WHERE {where_col} = :incident_id
            """)
            result = await session.execute(sql, {"incident_id": incident_id})
            row = result.mappings().first()

            if not row:
                raise HTTPException(status_code=404, detail="Incident not found")

            actual_incident_id = row['id']

            # Fetch comments timeline
            comment_sql = text("""
                SELECT ic.*, u.full_name AS author_name, u.email AS author_email
                FROM incident_comments ic
                JOIN public.users u ON u.id = ic.author_id
                WHERE ic.incident_id = :incident_uuid
                ORDER BY ic.created_at ASC
            """)
            comments_result = await session.execute(comment_sql, {"incident_uuid": actual_incident_id})
            comments = [dict(c) for c in comments_result.mappings().all()]

    incident = dict(row)
    incident["comments"] = comments
    return incident


@router.patch("/{incident_id}/status")
async def update_status(
    incident_id: str,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    valid_statuses = ("new", "triaging", "ai triaging", "in_progress", "resolved", "false_positive", "escalated", "sent to customer", "customer response received")
    if body.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")

    old_status = None
    inc_id_str = None
    inc_tenant_id = None
    inc_title = None
    inc_severity = None

    async with db as session:
        async with session.begin():
            schema = await get_schema_from_incident(session, incident_id, user)
            await session.execute(text(f"SET LOCAL search_path TO {schema}, public"))

            where_col = "id" if is_uuid(incident_id) else "ticket_id"

            # Get old status + tenant_id before update
            old_row = await session.execute(
                text(f"SELECT id, status, tenant_id, title, severity FROM incidents WHERE {where_col} = :incident_id"),
                {"incident_id": incident_id},
            )
            old = old_row.mappings().first()
            if old:
                old_status = old["status"]
                inc_id_str = str(old["id"])
                inc_tenant_id = str(old["tenant_id"])
                inc_title = old.get("title", "")
                inc_severity = old.get("severity", "")

            params = {"incident_id": incident_id, "status": body.status}
            # Also set resolved_at if transitioning to resolved, and first_response_at if new -> non-new
            extra_set = ""
            if body.status == "resolved":
                extra_set += ", resolved_at = NOW()"
            
            sql = text(f"""
                UPDATE incidents SET 
                    status = :status, 
                    updated_at = NOW(),
                    first_response_at = CASE 
                        WHEN status = 'new' AND :status != 'new' AND first_response_at IS NULL THEN NOW() 
                        ELSE first_response_at 
                    END
                    {extra_set}
                WHERE {where_col} = :incident_id
                RETURNING id
            """)
            result = await session.execute(sql, params)
            if not result.fetchone():
                raise HTTPException(status_code=404, detail="Incident not found or unauthorized")

    # ── SLA: record status_change + first response ──
    if inc_id_str and inc_tenant_id:
        try:
            from incidents.sla import record_sla_event, check_first_response
            async with db as sla_session:
                async with sla_session.begin():
                    await record_sla_event(sla_session, inc_id_str, inc_tenant_id, "status_change",
                        actor_id=user.get("sub"), old_value=old_status, new_value=body.status)
                    # First action on an incident = first response
                    if old_status == "new" and body.status != "new":
                        await check_first_response(sla_session, inc_id_str, inc_tenant_id)
                    if body.status == "resolved":
                        await record_sla_event(sla_session, inc_id_str, inc_tenant_id, "resolved", actor_id=user.get("sub"))
        except Exception as e:
            logger.warning(f"SLA event failed for status update {incident_id}: {e}")

    # Broadcast update
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        await r.publish("soc:incidents:live", _json.dumps({
            "event_type": "incident_updated",
            "incident_id": incident_id,
            "status": body.status,
            "tenant_id": inc_tenant_id or "",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }))
        await r.aclose()
    except: pass

    # ── Automation: publish incident_updated event (matches trigger_incident_updated nodes) ──
    event_payload = {
        "id": inc_id_str or incident_id, "tenant_id": inc_tenant_id or "",
        "status": body.status, "old_status": old_status,
        "title": inc_title or "", "severity": inc_severity or "",
    }
    await _publish_automation_event("incident_updated", event_payload)
    # Also publish status_changed for backward compat with trigger_status_changed nodes
    await _publish_automation_event("status_changed", event_payload)

    # ── Freshservice: sync status change (fire-and-forget) ──
    if inc_id_str and inc_tenant_id:
        try:
            from incidents.freshservice import update_freshservice
            from incidents.database import AsyncSessionLocal as _ASL
            async def _update_fs_status():
                async with _ASL() as _fs_sess:
                    await update_freshservice(_fs_sess, inc_id_str, inc_tenant_id, {"status": body.status})
            import asyncio as _asyncio
            _asyncio.create_task(_update_fs_status())
        except Exception as _e:
            logger.warning(f"Freshservice status sync skipped for {incident_id}: {_e}")

    # ── ServiceNow: sync status change (fire-and-forget) ──
    if inc_id_str and inc_tenant_id:
        try:
            from incidents.servicenow import update_servicenow
            from incidents.database import AsyncSessionLocal as _ASL_SN
            async def _update_sn_status():
                async with _ASL_SN() as _sn_sess:
                    await update_servicenow(_sn_sess, inc_id_str, inc_tenant_id, {"status": body.status})
            import asyncio as _asyncio
            _asyncio.create_task(_update_sn_status())
        except Exception as _e:
            logger.warning(f"ServiceNow status sync skipped for {incident_id}: {_e}")

    # ── Freshdesk: sync status change (fire-and-forget) ──
    if inc_id_str and inc_tenant_id:
        try:
            from incidents.freshdesk import update_freshdesk
            from incidents.database import AsyncSessionLocal as _ASL_FD
            async def _update_fd_status():
                async with _ASL_FD() as _fd_sess:
                    await update_freshdesk(_fd_sess, inc_id_str, inc_tenant_id, {"status": body.status})
            import asyncio as _asyncio
            _asyncio.create_task(_update_fd_status())
        except Exception as _e:
            logger.warning(f"Freshdesk status sync skipped for {incident_id}: {_e}")

    return {"id": incident_id, "status": body.status}


@router.patch("/{incident_id}")
async def patch_incident(
    incident_id: str,
    body: ManualIncidentUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Update any fields of an incident."""
    async with db as session:
        async with session.begin():
            schema = await get_schema_from_incident(session, incident_id, user)
            await session.execute(text(f"SET LOCAL search_path TO {schema}, public"))

            update_fields = []
            params = {"iid": incident_id}

            if body.title is not None:
                update_fields.append("title = :title")
                params["title"] = body.title
            if body.description is not None:
                update_fields.append("description = :description")
                params["description"] = body.description
            if body.severity is not None:
                update_fields.append("severity = :severity")
                params["severity"] = body.severity
            if body.status is not None:
                update_fields.append("status = :status")
                update_fields.append("""
                    first_response_at = CASE 
                        WHEN status = 'new' AND CAST(:status AS VARCHAR) != 'new' AND first_response_at IS NULL THEN NOW() 
                        ELSE first_response_at 
                    END
                """)
                if body.status == "resolved":
                    update_fields.append("resolved_at = NOW()")
                params["status"] = body.status
            if body.assigned_to is not None:
                update_fields.append("assigned_to = CAST(:assigned_to AS UUID)")
                params["assigned_to"] = body.assigned_to
            if body.tags is not None:
                update_fields.append("tags = CAST(:tags AS JSONB)")
                params["tags"] = _json.dumps(body.tags)
            if body.affected_hosts is not None:
                update_fields.append("affected_hosts = CAST(:hosts AS JSONB)")
                params["hosts"] = _json.dumps(body.affected_hosts)
            if body.affected_users is not None:
                update_fields.append("affected_users = CAST(:users AS JSONB)")
                params["users"] = _json.dumps(body.affected_users)

            # Complex fields in raw_payload
            raw_payload_updates = {}
            if body.alert_ids is not None: raw_payload_updates["alert_ids"] = body.alert_ids
            if body.alert_arrival_timestamp is not None: raw_payload_updates["alert_arrival_timestamp"] = body.alert_arrival_timestamp
            if body.command_initiated is not None: raw_payload_updates["command_initiated"] = body.command_initiated
            if body.asset_details is not None: raw_payload_updates["asset_details"] = body.asset_details
            if body.iocs is not None: raw_payload_updates["iocs"] = body.iocs
            if body.mitre_attack is not None: raw_payload_updates["mitre_attack"] = body.mitre_attack
            if body.observations is not None: raw_payload_updates["observations"] = body.observations
            if body.business_impact is not None: raw_payload_updates["business_impact"] = body.business_impact
            if body.recommendations is not None: raw_payload_updates["recommendations"] = body.recommendations
            if body.notes is not None:
                if "incident" not in raw_payload_updates: raw_payload_updates["incident"] = {}
                raw_payload_updates["incident"]["notes"] = body.notes

            if raw_payload_updates:
                # Merge into existing raw_payload
                where_col = "id" if is_uuid(incident_id) else "ticket_id"
                p_res = await session.execute(text(f"SELECT raw_payload FROM incidents WHERE {where_col} = :iid"), {"iid": incident_id})
                p_row = p_res.fetchone()
                if p_row:
                    try:
                        current_payload = p_row[0] if isinstance(p_row[0], dict) else _json.loads(p_row[0] or "{}")
                    except Exception:
                        current_payload = {}
                    current_payload.update(raw_payload_updates)
                    update_fields.append("raw_payload = CAST(:raw_payload AS JSONB)")
                    params["raw_payload"] = _json.dumps(current_payload)
            
            # MITRE tactics/techniques mirrors
            # MITRE tactics/techniques mirrors (priority: specific fields > attack list)
            mitre_tactics_final = None
            mitre_techniques_final = None

            if body.mitre_attack is not None:
                mitre_data = body.mitre_attack or []
                mitre_tactics_final = list({m.get("tactic", "") for m in mitre_data if m.get("tactic")})
                mitre_techniques_final = list({m.get("technique", "") for m in mitre_data if m.get("technique")})
            
            if body.mitre_tactics is not None:
                mitre_tactics_final = body.mitre_tactics
            if body.mitre_techniques is not None:
                mitre_techniques_final = body.mitre_techniques

            if mitre_tactics_final is not None:
                update_fields.append("mitre_tactics = CAST(:fm_tactics AS JSONB)")
                params["fm_tactics"] = _json.dumps(mitre_tactics_final)
            if mitre_techniques_final is not None:
                update_fields.append("mitre_techniques = CAST(:fm_techniques AS JSONB)")
                params["fm_techniques"] = _json.dumps(mitre_techniques_final)
            
            if body.iocs is not None:
                update_fields.append("iocs = CAST(:mi_iocs AS JSONB)")
                params["mi_iocs"] = _json.dumps(body.iocs)

            if not update_fields:
                raise HTTPException(status_code=400, detail="No fields to update")

            where_col = "id" if is_uuid(incident_id) else "ticket_id"
            sql = text(f"""
                UPDATE incidents SET {', '.join(update_fields)}, updated_at = NOW(), last_updated_at = NOW()
                WHERE {where_col} = :iid
                RETURNING id
            """)
            result = await session.execute(sql, params)
            if not result.fetchone():
                raise HTTPException(status_code=404, detail="Incident not found or unauthorized")

    # Broadcast update
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        await r.publish("soc:incidents:live", _json.dumps({
            "event_type": "incident_updated",
            "incident_id": incident_id,
            "updates": list(params.keys())
        }))
        await r.aclose()
    except Exception as e:
        logger.error(f"Failed to publish live update: {e}")

    # ── Automation: publish incident_updated event for field changes ──
    await _publish_automation_event("incident_updated", {
        "id": incident_id, "tenant_id": "",
        "status": body.status or "", "severity": body.severity or "",
        "title": body.title or "", "updates": list(params.keys()),
    })

    # ── ITSM sync: resolve UUID + tenant_id once, then fan out ──
    _itsm_changed = {}
    if body.title is not None: _itsm_changed["title"] = body.title
    if body.severity is not None: _itsm_changed["severity"] = body.severity
    if body.status is not None: _itsm_changed["status"] = body.status

    if _itsm_changed:
        # Resolve real UUID + tenant_id (incident_id may be a ticket_id like "TEST-0954")
        _itsm_where = "id" if is_uuid(incident_id) else "ticket_id"
        try:
            from incidents.database import AsyncSessionLocal as _ITSM_ASL
            async def _sync_all_itsm():
                async with _ITSM_ASL() as _itsm_sess:
                    _id_res = await _itsm_sess.execute(
                        text(f"SELECT id::text, tenant_id::text FROM public.incidents WHERE {_itsm_where} = :iid LIMIT 1"),
                        {"iid": incident_id}
                    )
                    _id_row = _id_res.fetchone()
                    if not _id_row:
                        return
                    _real_uuid = _id_row[0]   # actual UUID string
                    _real_tid  = _id_row[1]   # tenant UUID string

                    # Freshservice
                    try:
                        from incidents.freshservice import update_freshservice
                        await update_freshservice(_itsm_sess, _real_uuid, _real_tid, _itsm_changed)
                    except Exception as _e:
                        logger.warning(f"Freshservice patch sync skipped for {incident_id}: {_e}")

                    # ServiceNow
                    try:
                        from incidents.servicenow import update_servicenow
                        await update_servicenow(_itsm_sess, _real_uuid, _real_tid, _itsm_changed)
                    except Exception as _e:
                        logger.warning(f"ServiceNow patch sync skipped for {incident_id}: {_e}")

                    # Freshdesk
                    try:
                        from incidents.freshdesk import update_freshdesk
                        await update_freshdesk(_itsm_sess, _real_uuid, _real_tid, _itsm_changed)
                    except Exception as _e:
                        logger.warning(f"Freshdesk patch sync skipped for {incident_id}: {_e}")

            import asyncio as _asyncio
            _asyncio.create_task(_sync_all_itsm())
        except Exception as _e:
            logger.warning(f"ITSM patch sync task creation failed for {incident_id}: {_e}")

    return {"status": "updated", "incident_id": incident_id}


@router.post("/{incident_id}/assign")
async def assign_incident(
    incident_id: str,
    body: AssignUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    async with db as session:
        async with session.begin():
            schema = await get_schema_from_incident(session, incident_id, user)
            await session.execute(text(f"SET LOCAL search_path TO {schema}, public"))

            where_col = "id" if is_uuid(incident_id) else "ticket_id"
            params = {"incident_id": incident_id, "user_id": body.user_id}
            sql = text(f"""
                UPDATE incidents SET assigned_to = :user_id::uuid, updated_at = NOW()
                WHERE {where_col} = :incident_id
                RETURNING id
            """)
            result = await session.execute(sql, params)
            if not result.fetchone():
                raise HTTPException(status_code=404, detail="Incident not found or unauthorized")

    # Broadcast update
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        await r.publish("soc:incidents:live", _json.dumps({
            "event_type": "incident_updated",
            "incident_id": incident_id,
            "tenant_id": target_tid,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }))
        await r.aclose()
    except: pass

    return {"id": incident_id, "assigned_to": body.user_id}


@router.post("/{incident_id}/comments")
async def add_comment(
    incident_id: str,
    body: CommentCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    async with db as session:
        async with session.begin():
            schema = await get_schema_from_incident(session, incident_id, user)
            await session.execute(text(f"SET LOCAL search_path TO {schema}, public"))

            where_col = "id" if is_uuid(incident_id) else "ticket_id"
            # Get actual UUID first for foreign key compliance
            uuid_res = await session.execute(text(f"SELECT id FROM incidents WHERE {where_col} = :iid"), {"iid": incident_id})
            actual_uuid = uuid_res.scalar()
            if not actual_uuid:
                 raise HTTPException(status_code=404, detail="Incident not found")

            sql = text("""
                INSERT INTO incident_comments (incident_id, author_id, content, is_internal)
                VALUES (:incident_id, :author_id, :content, :is_internal)
                RETURNING id, created_at
            """)
            result = await session.execute(sql, {
                "incident_id": actual_uuid,
                "author_id": user.get("sub"),
                "content": body.content,
                "is_internal": body.is_internal,
            })
            row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")
        
    # Broadcast update
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        await r.publish("soc:incidents:live", _json.dumps({
            "event_type": "incident_updated",
            "incident_id": incident_id,
            "tenant_id": target_tid,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }))
        await r.aclose()
    except: pass

    return {"id": str(row[0]), "created_at": str(row[1])}


@router.post("/{incident_id}/send-email")
async def trigger_send_email(
    incident_id: str,
    team_id: str = Form(...),
    level: Optional[int] = Form(1),
    cc_emails: Optional[str] = Form(None),
    body: Optional[str] = Form(None),
    files: List[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Manually trigger email to a specific team's Level with custom CC/body/files."""
    try:
        from incidents.mailing import send_incident_email

        custom_cc = [e.strip() for e in cc_emails.split(",") if e.strip()] if cc_emails else []

        attachments = []
        if files:
            for f in files:
                content = await f.read()
                ctype = f.content_type or "application/octet-stream"
                maintype, subtype = ctype.split('/', 1) if '/' in ctype else ("application", "octet-stream")
                attachments.append({
                    "content": content,
                    "maintype": maintype,
                    "subtype": subtype,
                    "filename": f.filename
                })

        level_number = level if level and level >= 1 else 1
        success = await send_incident_email(
            db, incident_id, team_id, level_number,
            custom_cc=custom_cc,
            attachments=attachments,
            custom_body=body,
            analyst_id=user.get("sub")
        )
        if not success:
            logger.warning(f"Email send triggered but returned False for incident {incident_id}, team {team_id}")
            raise HTTPException(status_code=500, detail="Failed to send email. Check mailing configuration.")
        
        # Broadcast update for real-time UI
        try:
            r = aioredis.from_url(settings.redis_url, decode_responses=True)
            # Need tenant_id — we can get it from incident record if not already available
            await r.publish("soc:incidents:live", _json.dumps({
                "event_type": "incident_updated",
                "incident_id": incident_id,
                "update_type": "email_sent",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }))
            await r.aclose()
        except Exception as e:
            logger.warning(f"Failed to broadcast email_sent event: {e}")

        return {"status": "sent", "incident_id": incident_id, "team_id": team_id}
    except Exception as e:
        logger.exception(f"Exception in trigger_send_email for incident {incident_id}: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{incident_id}/interactions")
async def get_incident_interactions(
    incident_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Fetch communication history for an incident."""
    try:
        async with db as session:
            # Incident interactions are global (linked to UUID), so we search public schema
            where_col = "id" if is_uuid(incident_id) else "ticket_id"
            val = incident_id
            if where_col == "id":
                sql_find = text(f"SELECT id FROM public.incidents WHERE id = CAST(:iid AS UUID)")
            else:
                sql_find = text(f"SELECT id FROM public.incidents WHERE ticket_id = :iid")
                
            i_res = await session.execute(sql_find, {"iid": val})
            incident = i_res.mappings().first()
            if not incident:
                raise HTTPException(status_code=404, detail="Incident not found")
                
            sql = text("""
                SELECT * FROM public.incident_email_interactions 
                WHERE incident_id = :iid 
                ORDER BY created_at ASC
            """)
            res = await session.execute(sql, {"iid": incident["id"]})
            interactions = res.mappings().all()
            logger.info(f"API get_incident_interactions returning {len(interactions)} interactions for {incident_id}")
            return interactions
    except Exception as e:
        logger.exception(f"Exception in get_incident_interactions for incident {incident_id}: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{incident_id}/reply")
async def reply_to_incident_thread(
    incident_id: str,
    body: str = Form(...),
    cc: str = Form(None),
    files: List[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Send an analyst reply with optional attachments and CCs."""
    try:
        from incidents.mailing import send_analyst_reply
        
        attachments = []
        if files:
            for f in files:
                content = await f.read()
                # Determine maintype and subtype from filename or content type
                ctype = f.content_type or "application/octet-stream"
                if '/' in ctype:
                    maintype, subtype = ctype.split('/', 1)
                else:
                    maintype, subtype = "application", "octet-stream"
                
                attachments.append({
                    "content": content,
                    "maintype": maintype,
                    "subtype": subtype,
                    "filename": f.filename
                })
        
        async with db as session:
            success, msg = await send_analyst_reply(session, incident_id, body, attachments, cc, analyst_id=user.get("sub"))
            if not success:
                logger.error(f"Reply failed for incident {incident_id}: {msg}")
                raise HTTPException(status_code=500, detail=msg)
        
        # Broadcast update for real-time UI
        try:
            r = aioredis.from_url(settings.redis_url, decode_responses=True)
            await r.publish("soc:incidents:live", _json.dumps({
                "event_type": "incident_updated",
                "incident_id": incident_id,
                "update_type": "reply_sent",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }))
            await r.aclose()
        except Exception as e:
            logger.warning(f"Failed to broadcast reply_sent event: {e}")

        return {"status": "success", "message": msg}
    except Exception as e:
        logger.exception(f"Unexpected error in reply_to_incident_thread: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{incident_id}/itsm-comment")
async def post_itsm_comment(
    incident_id: str,
    body: str = Form(...),
    files: List[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Post a comment/note to the linked ITSM ticket and record in the timeline."""
    try:
        async with db as session:
            where_col = "id" if is_uuid(incident_id) else "ticket_id"
            inc_res = await session.execute(
                text(f"SELECT id, tenant_id FROM public.incidents WHERE {where_col} = :val LIMIT 1"),
                {"val": incident_id},
            )
            incident = inc_res.mappings().first()
            if not incident:
                raise HTTPException(status_code=404, detail="Incident not found")
            soc_id = str(incident["id"])
            tenant_id = str(incident["tenant_id"])

            # Retry for up to 15s — ITSM push is async and may not be done yet
            mapping = None
            for _attempt in range(5):
                mapping_res = await session.execute(
                    text("""
                        SELECT integration, external_ticket_id, external_ticket_url
                        FROM public.integration_ticket_mappings
                        WHERE soc_incident_id = CAST(:sid AS UUID)
                          AND sync_status = 'synced'
                          AND external_ticket_id != ''
                        LIMIT 1
                    """),
                    {"sid": soc_id},
                )
                mapping = mapping_res.mappings().first()
                if mapping:
                    break
                import asyncio as _aio
                await _aio.sleep(3)
            if not mapping:
                raise HTTPException(status_code=404, detail="No active ITSM ticket linked to this incident")

            integration = mapping["integration"]
            ext_ticket_id = mapping["external_ticket_id"]

            attachments = []
            if files:
                for f in files:
                    content = await f.read()
                    attachments.append({
                        "content": content,
                        "filename": f.filename,
                        "content_type": f.content_type or "application/octet-stream",
                    })

            analyst_email = user.get("email", "")
            analyst_name = user.get("name", "") or user.get("full_name", "")

            if integration == "freshservice":
                from incidents.freshservice import add_note_to_freshservice
                await add_note_to_freshservice(session, soc_id, tenant_id, ext_ticket_id, body, attachments, analyst_email, analyst_name)
            elif integration == "freshdesk":
                from incidents.freshdesk import add_note_to_freshdesk
                await add_note_to_freshdesk(session, soc_id, tenant_id, ext_ticket_id, body, attachments, analyst_email, analyst_name)
            elif integration == "servicenow":
                from incidents.servicenow import add_note_to_servicenow
                await add_note_to_servicenow(session, soc_id, tenant_id, ext_ticket_id, body, attachments, analyst_email, analyst_name)
            else:
                raise HTTPException(status_code=400, detail=f"Unknown ITSM integration: {integration}")

        return {"status": "success", "message": "Comment posted to ITSM ticket"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"ITSM comment failed for {incident_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{incident_id}/reply-simple")
async def reply_simple(
    incident_id: str,
    req: ReplyRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    try:
        from incidents.mailing import send_analyst_reply
        async with db as session:
            success, msg = await send_analyst_reply(session, incident_id, req.body, analyst_id=user.get("sub"))
            if not success:
                logger.error(f"Reply simple failed for incident {incident_id}: {msg}")
                raise HTTPException(status_code=500, detail=msg)
        
        # Broadcast update for real-time UI
        try:
            r = aioredis.from_url(settings.redis_url, decode_responses=True)
            await r.publish("soc:incidents:live", _json.dumps({
                "event_type": "incident_updated",
                "incident_id": incident_id,
                "update_type": "reply_sent",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }))
            await r.aclose()
        except Exception as e:
            logger.warning(f"Failed to broadcast reply_simple event: {e}")

        return {"status": "success", "message": msg}
    except Exception as e:
        logger.exception(f"Unexpected error in reply_simple: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{incident_id}/interactions/{interaction_id}/attachments/{filename}")
async def download_attachment(
    incident_id: str,
    interaction_id: str,
    filename: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Download an attachment for a specific email interaction."""
    from fastapi.responses import Response
    
    async with db as session:
        # Verify incident and interaction exist
        where_col = "id" if is_uuid(incident_id) else "ticket_id"
        if where_col == "id":
            sql_find = text("SELECT id FROM public.incidents WHERE id = CAST(:iid AS UUID)")
        else:
            sql_find = text("SELECT id FROM public.incidents WHERE ticket_id = :iid")
            
        i_res = await session.execute(sql_find, {"iid": incident_id})
        incident = i_res.mappings().first()
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")
            
        # Get attachment data
        sql = text("""
            SELECT content_type, data 
            FROM public.incident_attachments 
            WHERE interaction_id = CAST(:interaction_id AS UUID) 
            AND filename = :filename
        """)
        res = await session.execute(sql, {"interaction_id": interaction_id, "filename": filename})
        attachment = res.mappings().first()
        
        if not attachment:
            raise HTTPException(status_code=404, detail="Attachment not found")
            
        return Response(
            content=attachment["data"], 
            media_type=attachment["content_type"] or "application/octet-stream",
            headers={"Content-Disposition": f'inline; filename="{filename}"'}
        )


@router.patch("/{incident_id}/agentic-job")
async def update_agentic_job_id(
    incident_id: str,
    body: AssignAgenticJob,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Save the agentic_job_id returned by the Agentic SOC swarm."""
    async with db as session:
        async with session.begin():
            schema = await get_schema_from_incident(session, incident_id, user)
            await session.execute(text(f"SET LOCAL search_path TO {schema}, public"))

            where_col = "id" if is_uuid(incident_id) else "ticket_id"
            params = {"incident_id": incident_id, "job_id": body.job_id}
            sql = text(f"""
                UPDATE incidents SET agentic_job_id = :job_id, updated_at = NOW()
                WHERE {where_col} = :incident_id
                RETURNING id
            """)
            result = await session.execute(sql, params)
            if not result.fetchone():
                raise HTTPException(status_code=404, detail="Incident not found or unauthorized")

    return {"id": incident_id, "agentic_job_id": body.job_id}


@router.post("/{incident_id}/analyze")
async def analyze_incident(
    incident_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Forward incident to Autonomous SOC for analysis."""
    async with db as session:
        schema = await get_schema_from_incident(session, incident_id, user)
        await session.execute(text(f"SET search_path TO {schema}, public"))

        where_col = "id" if is_uuid(incident_id) else "ticket_id"
        sql = text(f"SELECT * FROM incidents WHERE {where_col} = :incident_id")
        result = await session.execute(sql, {"incident_id": incident_id})
        incident = result.mappings().first()

        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")

        incident_dict = dict(incident)
        # Ensure raw_payload is parsed if it's a string
        if isinstance(incident_dict.get("raw_payload"), str):
            import json
            try:
                incident_dict["raw_payload"] = json.loads(incident_dict["raw_payload"])
            except:
                pass

        # Use the configured values or fallbacks
        # Use the configured values or fallbacks
        autonomous_soc_url = getattr(settings, "autonomous_soc_url", "http://localhost:8000/api/analyze")
        # We assume the gateway or a configured base URL is used for callback
        base_callback_url = getattr(settings, "callback_url_base", "http://localhost:8012")
        callback_url = f"{base_callback_url}/incidents/webhooks/autonomous-report"

        from uuid import UUID
        from datetime import datetime
        def stringify(obj):
            if isinstance(obj, dict):
                return {k: stringify(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [stringify(i) for i in obj]
            elif isinstance(obj, UUID):
                return str(obj)
            elif isinstance(obj, datetime):
                return obj.isoformat()
            return obj

        payload = stringify({
            "incident": incident_dict,
            "callback_url": callback_url,
            "ticket_id": incident_dict.get("ticket_id")
        })

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(autonomous_soc_url, json=payload, timeout=10.0)
                resp.raise_for_status()
                data = resp.json()
                
                # Update job ID, ai_status AND incident status
                job_id = data.get("job_id")
                up_sql = text(f"""
                    UPDATE incidents 
                    SET agentic_job_id = :job_id, 
                        ai_status = 'pending', 
                        status = 'ai triaging',
                        updated_at = NOW() 
                    WHERE {where_col} = :incident_id
                """)
                await session.execute(up_sql, {"job_id": job_id, "incident_id": incident_id})
                await session.commit()
                
                return {"status": "dispatched", "job_id": job_id}
            except httpx.HTTPError as e:
                logger.error(f"Failed to send incident to Autonomous SOC: {e}")
                raise HTTPException(status_code=502, detail=f"Autonomous SOC error: {str(e)}")


@router.post("/webhooks/freshservice")
async def freshservice_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Public endpoint — receives Freshservice automation webhooks.
    URL: POST /incidents/webhooks/freshservice?tenant_id={uuid}
    No JWT required (registered in PUBLIC_PATHS in api-gateway).
    """
    from incidents.freshservice import apply_freshservice_webhook

    tenant_id = request.query_params.get("tenant_id", "")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id query param required")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    soc_incident_id = None
    async with db as session:
        async with session.begin():
            soc_incident_id = await apply_freshservice_webhook(session, payload, tenant_id)

    # Broadcast live update so the SOC UI refreshes in real time
    if soc_incident_id:
        try:
            r = aioredis.from_url(settings.redis_url, decode_responses=True)
            await r.publish("soc:incidents:live", _json.dumps({
                "event_type": "incident_updated",
                "incident_id": soc_incident_id,
                "tenant_id": tenant_id,
                "source": "freshservice_webhook",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }))
            await r.aclose()
        except Exception as _e:
            logger.warning(f"Freshservice webhook: failed to broadcast live event: {_e}")

    return {"status": "ok", "soc_incident_id": soc_incident_id}


@router.post("/webhooks/servicenow")
async def servicenow_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Public endpoint — receives ServiceNow Business Rule webhooks.
    URL: POST /incidents/webhooks/servicenow?tenant_id={uuid}
    No JWT required (registered in PUBLIC_PATHS in api-gateway).
    ServiceNow sends sys_id + state in the payload via Script Action.
    """
    from incidents.servicenow import apply_servicenow_webhook

    tenant_id = request.query_params.get("tenant_id", "")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id query param required")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    soc_incident_id = None
    async with db as session:
        async with session.begin():
            soc_incident_id = await apply_servicenow_webhook(session, payload, tenant_id)

    # Broadcast live update so the SOC UI refreshes in real time
    if soc_incident_id:
        try:
            r = aioredis.from_url(settings.redis_url, decode_responses=True)
            await r.publish("soc:incidents:live", _json.dumps({
                "event_type": "incident_updated",
                "incident_id": soc_incident_id,
                "tenant_id": tenant_id,
                "source": "servicenow_webhook",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }))
            await r.aclose()
        except Exception as _e:
            logger.warning(f"ServiceNow webhook: failed to broadcast live event: {_e}")

    return {"status": "ok", "soc_incident_id": soc_incident_id}


@router.post("/webhooks/freshdesk")
async def freshdesk_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Public endpoint — receives Freshdesk Automation Rule webhooks.
    URL: POST /incidents/webhooks/freshdesk?tenant_id={uuid}
    No JWT required (registered in PUBLIC_PATHS in api-gateway).
    """
    from incidents.freshdesk import apply_freshdesk_webhook

    tenant_id = request.query_params.get("tenant_id", "")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id query param required")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    soc_incident_id = None
    async with db as session:
        async with session.begin():
            soc_incident_id = await apply_freshdesk_webhook(session, payload, tenant_id)

    # Broadcast live update so the SOC UI refreshes in real time
    if soc_incident_id:
        try:
            r = aioredis.from_url(settings.redis_url, decode_responses=True)
            await r.publish("soc:incidents:live", _json.dumps({
                "event_type": "incident_updated",
                "incident_id": soc_incident_id,
                "tenant_id": tenant_id,
                "source": "freshdesk_webhook",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }))
            await r.aclose()
        except Exception as _e:
            logger.warning(f"Freshdesk webhook: failed to broadcast live event: {_e}")

    return {"status": "ok", "soc_incident_id": soc_incident_id}


@router.post("/webhooks/autonomous-report")
async def autonomous_report_webhook(
    body: AutonomousReport,
    db: AsyncSession = Depends(get_db),
):
    """Receive analysis report from Autonomous SOC."""
    async with db as session:
        # Find incident by ticket_id across all schemas is hard, 
        # but we can look in public.incidents first to find the tenant_id
        # IMPORTANT: Only accept report if ai_status is 'pending'
        t_sql = text("SELECT id, tenant_id, ai_status FROM public.incidents WHERE ticket_id = :tid")
        t_res = await session.execute(t_sql, {"tid": body.ticket_id})
        t_row = t_res.fetchone()

        if not t_row:
            logger.warning(f"Received report for unknown ticket_id: {body.ticket_id}")
            raise HTTPException(status_code=404, detail="Ticket not found in register")

        incident_uuid, tenant_id, current_ai_status = t_row
        
        if current_ai_status != 'pending':
            logger.warning(f"Rejected unsolicited AI report for ticket {body.ticket_id} (current status: {current_ai_status})")
            return {"status": "rejected", "reason": "No pending analysis for this incident"}

        schema = await get_schema_for_tenant(session, str(tenant_id))
        
        await session.execute(text(f"SET LOCAL search_path TO {schema}, public"))

        # Add the report as a comment
        # We'll use a system user ID if available, otherwise we might need a dedicated bot user
        # For now, we'll try to find a 'system' or 'ai_agent' user or just use a placeholder
        author_sql = text("SELECT id FROM public.users WHERE email = 'ai@soc.internal' LIMIT 1")
        author_res = await session.execute(author_sql)
        author_row = author_res.fetchone()
        author_id = author_row[0] if author_row else None
        
        if not author_id:
            # Fallback: get first super_admin or any user just to make it work for now
            fallback_res = await session.execute(text("SELECT id FROM public.users LIMIT 1"))
            author_id = fallback_res.scalar()

        comment_sql = text("""
            INSERT INTO incident_comments (incident_id, author_id, content, is_internal)
            VALUES (:incident_id, :author_id, :content, :is_internal)
        """)
        
        report_content = f"### [AUTONOMOUS ANALYSIS REPORT]\nStatus: {body.status}\n\n{body.analysis_report}"
        
        await session.execute(comment_sql, {
            "incident_id": incident_uuid,
            "author_id": author_id,
            "content": report_content,
            "is_internal": False
        })
        
        # Update the standalone AI verdict and status
        update_sql = text("""
            UPDATE incidents 
            SET ai_verdict = :verdict, ai_status = 'completed', updated_at = NOW()
            WHERE id = :incident_id
        """)
        await session.execute(update_sql, {
            "verdict": body.analysis_report,
            "incident_id": incident_uuid
        })

        await session.commit()

        return {"status": "accepted"}


@router.get("/{incident_id}/verdict")
async def get_incident_verdict(
    incident_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Fetch the AI analysis verdict for an incident."""
    async with db as session:
        schema = await get_schema_from_incident(session, incident_id, user)
        await session.execute(text(f"SET search_path TO {schema}, public"))

        where_col = "id" if is_uuid(incident_id) else "ticket_id"
        sql = text(f"SELECT id, ticket_id, ai_verdict, ai_status FROM incidents WHERE {where_col} = :incident_id")
        result = await session.execute(sql, {"incident_id": incident_id})
        row = result.mappings().first()

        if not row:
            raise HTTPException(status_code=404, detail="Incident not found")

        return dict(row)


# ═══════════════════════════════════════════════════════════════
# SLA ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.get("/{incident_id}/sla")
async def get_incident_sla_endpoint(
    incident_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """SLA events + metrics for a single incident."""
    from incidents.sla import get_incident_sla
    # Resolve UUID
    async with db as session:
        if not is_uuid(incident_id):
            row = await session.execute(text("SELECT id FROM public.incidents WHERE ticket_id = :tid"), {"tid": incident_id})
            r = row.fetchone()
            if r:
                incident_id = str(r[0])
        return await get_incident_sla(session, incident_id)


