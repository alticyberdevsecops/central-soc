"""
Automation Service — Drag-and-drop workflow builder engine.
Handles workflow CRUD, execution, trigger evaluation, and node processing.
"""
import asyncio
import logging
import json
import uuid
from datetime import datetime, timezone
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
import redis.asyncio as aioredis
import httpx

from config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("automation-service")

# ── Database ──
engine = create_async_engine(settings.database_url, pool_size=10)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ── Redis ──
redis_client: Optional[aioredis.Redis] = None


async def get_db():
    async with AsyncSessionLocal() as s:
        yield s


# ── Auth via Gateway Headers ──
def get_user(request: Request) -> dict:
    role = request.headers.get("X-User-Role", "")
    tid = request.headers.get("X-Tenant-ID", "")
    # Super admins / users without a specific tenant get a global marker
    # so downstream logic doesn't reject them
    if not tid and role == "super_admin":
        tid = "global"
    return {
        "role": role,
        "sub": request.headers.get("X-User-ID", ""),
        "email": request.headers.get("X-User-Email", ""),
        "tenant_id": tid,
    }


# ── Pydantic Models ──
class NodeData(BaseModel):
    id: str
    node_type: str
    category: str = ""
    label: str = ""
    config: dict = {}
    position_x: float = 0
    position_y: float = 0
    error_handling: str = "stop"
    retry_count: int = 0
    timeout_sec: int = 30


class EdgeData(BaseModel):
    id: str
    source_node_id: str
    target_node_id: str
    condition: Optional[dict] = None
    label: str = ""


class WorkflowCreate(BaseModel):
    name: str
    description: str = ""
    nodes: List[NodeData] = []
    edges: List[EdgeData] = []
    canvas_data: dict = {}
    settings: dict = {}
    target_tenant_ids: Optional[List[str]] = None  # ["all"] or list of tenant UUIDs


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[List[NodeData]] = None
    edges: Optional[List[EdgeData]] = None
    canvas_data: Optional[dict] = None
    settings: Optional[dict] = None
    target_tenant_ids: Optional[List[str]] = None


class ManualTriggerInput(BaseModel):
    input_data: dict = {}
    incident_id: Optional[str] = None
    dry_run: bool = False


def _auto_headers(context: dict) -> dict:
    """Generate X-User headers for internal service calls."""
    return {
        "X-User-ID": context.get("triggered_by", "automation"),
        "X-User-Role": "super_admin",
        "X-Tenant-ID": context.get("tenant_id", ""),
    }


async def _get_credential(db: AsyncSession, tenant_id: str, credential_id: str, integration: str) -> Optional[str]:
    """Retrieve a stored API key for a given integration."""
    try:
        if credential_id:
            res = await db.execute(text(
                "SELECT api_key FROM public.automation_credentials WHERE id = :cid AND tenant_id = :tid"
            ), {"cid": credential_id, "tid": tenant_id})
        else:
            res = await db.execute(text(
                "SELECT api_key FROM public.automation_credentials WHERE tenant_id = :tid AND integration = :integ LIMIT 1"
            ), {"tid": tenant_id, "integ": integration})
        row = res.mappings().first()
        return row["api_key"] if row else None
    except Exception:
        return None


# ── Node Executor ──
async def execute_node(db: AsyncSession, node: dict, context: dict, execution_id: str) -> dict:
    """
    Execute a single node and return its output.
    Context carries variables from prior nodes.
    Supports retry with exponential backoff and dry-run mode.
    """
    node_type = node["node_type"]
    config = node.get("config") or {}
    node_id = node["id"]
    max_retries = node.get("retry_count", 0)
    started = datetime.now(timezone.utc)
    output = {}
    status = "success"
    error_msg = None

    # ── Dry Run Mode: skip side-effect nodes ──
    side_effect_types = {
        "change_status", "add_comment", "assign_incident", "add_tags", "escalate_incident",
        "create_incident", "update_incident", "close_incident", "send_email", "send_notification",
        "http_request", "virustotal_lookup", "abuseipdb_check", "whois_lookup", "dns_resolve",
        "geoip_lookup", "approval_gate", "wait_for_event", "sub_workflow",
    }
    if context.get("_dry_run") and node_type in side_effect_types:
        output = {"dry_run": True, "would_execute": node_type, "config_summary": {k: str(v)[:80] for k, v in config.items()}}
        completed = datetime.now(timezone.utc)
        duration_ms = int((completed - started).total_seconds() * 1000)
        await db.execute(text("""
            INSERT INTO public.execution_node_logs
                (id, execution_id, node_id, node_type, status, input_data, output_data,
                 error_message, started_at, completed_at, duration_ms)
            VALUES (:id, :eid, :nid, :ntype, :status, :input, :output, :err, :started, :completed, :dur)
        """), {
            "id": str(uuid.uuid4()), "eid": execution_id, "nid": node_id, "ntype": node_type,
            "status": "skipped_dry_run", "input": json.dumps({"config": config}),
            "output": json.dumps(output, default=str), "err": None,
            "started": started, "completed": completed, "dur": duration_ms,
        })
        node_label = node.get("label", "").replace(" ", "_").lower() or node_id
        context["nodes"][node_label] = {"output": output, "status": "skipped_dry_run"}
        context["nodes"][node_id] = {"output": output, "status": "skipped_dry_run"}
        return {"output": output, "status": "skipped_dry_run", "error": None}

    # ── Retry loop with exponential backoff ──
    for attempt in range(max_retries + 1):
        output = {}
        status = "success"
        error_msg = None
        try:
            status, output, error_msg = await _execute_node_inner(db, node, config, node_id, node_type, context, execution_id)
            if status != "failed" or attempt >= max_retries:
                break
            # Retry on failure
            wait_time = min(2 ** attempt * 1.0, 60)
            logger.info(f"Retrying node {node_id} (attempt {attempt + 1}/{max_retries}) after {wait_time}s")
            await asyncio.sleep(wait_time)
        except Exception as e:
            status = "failed"
            error_msg = str(e)
            output = {"error": str(e)}
            if attempt < max_retries:
                wait_time = min(2 ** attempt * 1.0, 60)
                logger.info(f"Retrying node {node_id} (attempt {attempt + 1}/{max_retries}) after {wait_time}s")
                await asyncio.sleep(wait_time)

    completed = datetime.now(timezone.utc)
    duration_ms = int((completed - started).total_seconds() * 1000)

    # Log node execution
    await db.execute(text("""
        INSERT INTO public.execution_node_logs
            (id, execution_id, node_id, node_type, status, input_data, output_data,
             error_message, started_at, completed_at, duration_ms, retry_attempt)
        VALUES
            (:id, :eid, :nid, :ntype, :status, :input, :output, :err, :started, :completed, :dur, :retry)
    """), {
        "id": str(uuid.uuid4()),
        "eid": execution_id,
        "nid": node_id,
        "ntype": node_type,
        "status": status,
        "input": json.dumps({"config": config, "context_keys": list(context.keys())}),
        "output": json.dumps(output, default=str),
        "err": error_msg,
        "started": started,
        "completed": completed,
        "dur": duration_ms,
        "retry": min(attempt, max_retries) if max_retries > 0 else 0,
    })

    # Store output in context for downstream nodes
    node_label = node.get("label", "").replace(" ", "_").lower() or node_id
    context["nodes"][node_label] = {"output": output, "status": status}
    context["nodes"][node_id] = {"output": output, "status": status}

    return {"output": output, "status": status, "error": error_msg}


async def _execute_node_inner(db, node, config, node_id, node_type, context, execution_id):
    """Inner execution logic for a single node. Returns (status, output, error_msg)."""
    output = {}
    status = "success"
    error_msg = None

    try:
        # ── Trigger nodes just pass through ──
        if node_type.startswith("trigger_"):
            output = context.get("trigger_data", {})

        # ── If/Condition ──
        elif node_type == "if_condition":
            field = config.get("field", "")
            operator = config.get("operator", "==")
            value = config.get("value", "")

            actual = _resolve_variable(field, context)
            matched = _evaluate_condition(actual, operator, value)
            output = {"result": matched, "branch": "true" if matched else "false"}

        # ── Switch / Router ──
        elif node_type == "switch":
            field = config.get("field", "")
            cases = config.get("cases", {})
            actual = str(_resolve_variable(field, context)).lower()
            matched_case = cases.get(actual, config.get("default", "default"))
            output = {"matched_case": actual, "branch": matched_case}

        # ── Set Variable ──
        elif node_type == "set_variable":
            var_name = config.get("variable_name", "custom_var")
            var_value = config.get("value", "")
            # Resolve template variables
            resolved = _resolve_template(str(var_value), context)
            context["variables"][var_name] = resolved
            output = {"variable": var_name, "value": resolved}

        # ── Add Comment ──
        elif node_type == "add_comment":
            incident_id = config.get("incident_id") or context.get("incident_id") or context.get("trigger_data", {}).get("incident_id")
            comment_text = _resolve_template(config.get("comment", ""), context)
            if incident_id and comment_text:
                try:
                    async with httpx.AsyncClient(timeout=15) as client:
                        resp = await client.post(
                            f"{settings.incident_service_url}/incidents/{incident_id}/comments",
                            json={"content": comment_text},
                            headers={"X-User-ID": context.get("triggered_by", "automation"), "X-User-Role": "super_admin", "X-Tenant-ID": context.get("tenant_id", "")},
                        )
                        output = {"status_code": resp.status_code, "incident_id": incident_id, "comment": comment_text}
                except Exception as e:
                    output = {"error": str(e), "incident_id": incident_id}

        # ── Change Status ──
        elif node_type == "change_status":
            incident_id = config.get("incident_id") or context.get("incident_id") or context.get("trigger_data", {}).get("incident_id")
            new_status = _resolve_template(config.get("status", ""), context)
            if incident_id and new_status:
                try:
                    async with httpx.AsyncClient(timeout=15) as client:
                        resp = await client.patch(
                            f"{settings.incident_service_url}/incidents/{incident_id}/status",
                            json={"status": new_status},
                            headers={"X-User-ID": context.get("triggered_by", "automation"), "X-User-Role": "super_admin", "X-Tenant-ID": context.get("tenant_id", "")},
                        )
                        output = {"status_code": resp.status_code, "incident_id": incident_id, "new_status": new_status}
                except Exception as e:
                    output = {"error": str(e)}

        # ── Assign Incident ──
        elif node_type == "assign_incident":
            incident_id = config.get("incident_id") or context.get("incident_id") or context.get("trigger_data", {}).get("incident_id")
            analyst_id = _resolve_template(config.get("analyst_id", ""), context)
            if incident_id and analyst_id:
                try:
                    async with httpx.AsyncClient(timeout=15) as client:
                        resp = await client.patch(
                            f"{settings.incident_service_url}/incidents/{incident_id}",
                            json={"assigned_to": analyst_id},
                            headers={"X-User-ID": context.get("triggered_by", "automation"), "X-User-Role": "super_admin", "X-Tenant-ID": context.get("tenant_id", "")},
                        )
                        output = {"status_code": resp.status_code, "incident_id": incident_id, "analyst_id": analyst_id}
                except Exception as e:
                    output = {"error": str(e)}

        # ── Escalate Incident ──
        elif node_type == "escalate_incident":
            incident_id = config.get("incident_id") or context.get("incident_id") or context.get("trigger_data", {}).get("incident_id")
            reason = _resolve_template(config.get("reason", "Automated escalation"), context)
            if incident_id:
                try:
                    # Get incident's current escalation level and team, then escalate
                    inc_res = await db.execute(text(
                        "SELECT id, assigned_team_id, escalation_level, ticket_id, tenant_id FROM public.incidents WHERE id = CAST(:iid AS UUID)"
                    ), {"iid": incident_id})
                    inc = inc_res.mappings().first()
                    if inc and inc["assigned_team_id"]:
                        next_level = (inc["escalation_level"] or 1) + 1
                        # Call incident-service send-email with next level
                        async with httpx.AsyncClient(timeout=30) as client:
                            resp = await client.post(
                                f"{settings.incident_service_url}/incidents/{incident_id}/send-email",
                                data={"team_id": str(inc["assigned_team_id"]), "level": str(next_level)},
                                headers=_auto_headers(context),
                            )
                            if resp.status_code < 400:
                                # Also update status to escalated
                                await client.patch(
                                    f"{settings.incident_service_url}/incidents/{incident_id}/status",
                                    json={"status": "escalated"},
                                    headers=_auto_headers(context),
                                )
                                output = {"incident_id": incident_id, "reason": reason, "action": "escalated", "new_level": next_level}
                            else:
                                output = {"incident_id": incident_id, "reason": reason, "action": "escalated", "warning": f"Email escalation returned {resp.status_code}"}
                    else:
                        # No team assigned, just change status
                        async with httpx.AsyncClient(timeout=15) as client:
                            await client.patch(
                                f"{settings.incident_service_url}/incidents/{incident_id}/status",
                                json={"status": "escalated"},
                                headers=_auto_headers(context),
                            )
                        output = {"incident_id": incident_id, "reason": reason, "action": "escalated", "note": "No team assigned, status changed only"}
                except Exception as e:
                    output = {"error": str(e), "incident_id": incident_id}
                    status = "error"
                    error_msg = str(e)
            else:
                output = {"error": "No incident_id", "reason": reason}

        # ── Add Tags ──
        elif node_type == "add_tags":
            incident_id = config.get("incident_id") or context.get("incident_id") or context.get("trigger_data", {}).get("incident_id")
            tags = config.get("tags", [])
            if incident_id and tags:
                try:
                    async with httpx.AsyncClient(timeout=15) as client:
                        resp = await client.patch(
                            f"{settings.incident_service_url}/incidents/{incident_id}",
                            json={"tags": tags},
                            headers={"X-User-ID": context.get("triggered_by", "automation"), "X-User-Role": "super_admin", "X-Tenant-ID": context.get("tenant_id", "")},
                        )
                        output = {"status_code": resp.status_code, "tags": tags}
                except Exception as e:
                    output = {"error": str(e)}

        # ── Send Notification (in-app — posts comment + publishes Redis event) ──
        elif node_type == "send_notification":
            message = _resolve_template(config.get("message", ""), context)
            incident_id = config.get("incident_id") or context.get("incident_id") or context.get("trigger_data", {}).get("incident_id")
            channel = config.get("channel", "comment")  # comment, redis, both

            if incident_id and message:
                try:
                    # Add as incident comment for in-app visibility
                    async with httpx.AsyncClient(timeout=15) as client:
                        resp = await client.post(
                            f"{settings.incident_service_url}/incidents/{incident_id}/comments",
                            json={"content": f"🔔 [Automation] {message}"},
                            headers={"X-User-ID": "automation", "X-User-Role": "super_admin", "X-Tenant-ID": context.get("tenant_id", "")},
                        )

                    # Also publish to Redis for live monitoring
                    try:
                        r = await aioredis.from_url(settings.redis_url, decode_responses=True)
                        await r.publish("soc:notifications", json.dumps({
                            "type": "automation_notification",
                            "incident_id": incident_id,
                            "message": message,
                            "tenant_id": context.get("tenant_id", ""),
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }))
                        await r.aclose()
                    except Exception:
                        pass

                    output = {"message": message, "type": "notification", "sent": True, "incident_id": incident_id}
                except Exception as e:
                    output = {"error": str(e), "message": message}
                    status = "error"
                    error_msg = str(e)
            elif message:
                # No incident, just publish to Redis
                try:
                    r = await aioredis.from_url(settings.redis_url, decode_responses=True)
                    await r.publish("soc:notifications", json.dumps({
                        "type": "automation_notification",
                        "message": message,
                        "tenant_id": context.get("tenant_id", ""),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }))
                    await r.aclose()
                    output = {"message": message, "type": "notification", "sent": True}
                except Exception as e:
                    output = {"message": message, "type": "notification", "sent": False, "error": str(e)}
            else:
                output = {"message": "", "type": "notification", "sent": False, "error": "No message provided"}

        # ── HTTP Request ──
        elif node_type == "http_request":
            url = _resolve_template(config.get("url", ""), context)
            method = config.get("method", "GET").upper()
            headers = config.get("headers", {})
            body = config.get("body")
            if body:
                body = _resolve_template(json.dumps(body) if isinstance(body, dict) else str(body), context)
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.request(method, url, headers=headers, content=body)
                    try:
                        resp_json = resp.json()
                    except:
                        resp_json = resp.text
                    output = {"status_code": resp.status_code, "response": resp_json}
            except Exception as e:
                output = {"error": str(e)}

        # ── Delay / Wait ──
        elif node_type == "delay":
            seconds = int(config.get("seconds", 5))
            seconds = min(seconds, 300)  # Max 5 min delay
            await asyncio.sleep(seconds)
            output = {"waited_seconds": seconds}

        # ── Log / Debug ──
        elif node_type == "log":
            message = _resolve_template(config.get("message", ""), context)
            logger.info(f"[Workflow Log] {message}")
            output = {"logged": message}

        # ── Stop ──
        elif node_type == "stop":
            output = {"stopped": True, "reason": config.get("reason", "Workflow ended")}

        # ── Try/Catch ── (routing node - just passes through, BFS handles catch logic)
        elif node_type == "try_catch":
            output = {"type": "try_catch", "branch": "try"}

        # ── Approval Gate ──
        elif node_type == "approval_gate":
            approvers_str = config.get("approvers", "")
            approvers = [a.strip() for a in approvers_str.split(",") if a.strip()] if isinstance(approvers_str, str) else approvers_str
            message = _resolve_template(config.get("message", "Approval required to continue workflow"), context)
            timeout = int(config.get("timeout_minutes", 1440))

            gate_id = str(uuid.uuid4())
            await db.execute(text("""
                INSERT INTO public.workflow_approval_gates
                    (id, execution_id, node_id, tenant_id, message, approvers, requested_by, timeout_minutes)
                VALUES (:id, :eid, :nid, :tid, :msg, :approvers, :by, :timeout)
            """), {
                "id": gate_id, "eid": execution_id, "nid": node_id,
                "tid": context.get("tenant_id", ""),
                "msg": message, "approvers": approvers,
                "by": context.get("triggered_by", "system"),
                "timeout": timeout,
            })
            output = {"gate_id": gate_id, "message": message, "approvers": approvers, "status": "pending"}
            # Signal pause
            output["_pause"] = True
            output["_pause_type"] = "waiting_approval"

        # ── Wait for Event ──
        elif node_type == "wait_for_event":
            event_type = _resolve_template(config.get("event_type", ""), context)
            event_filter = config.get("filter", {})
            timeout = int(config.get("timeout_minutes", 1440))

            wait_id = str(uuid.uuid4())
            await db.execute(text("""
                INSERT INTO public.workflow_pending_events
                    (id, execution_id, node_id, tenant_id, event_type, event_filter, timeout_minutes)
                VALUES (:id, :eid, :nid, :tid, :etype, :efilter, :timeout)
            """), {
                "id": wait_id, "eid": execution_id, "nid": node_id,
                "tid": context.get("tenant_id", ""),
                "etype": event_type,
                "efilter": json.dumps(event_filter),
                "timeout": timeout,
            })
            output = {"wait_id": wait_id, "event_type": event_type, "status": "waiting"}
            output["_pause"] = True
            output["_pause_type"] = "waiting_event"

        # ── Sub-Workflow ──
        elif node_type == "sub_workflow":
            sub_wf_id = _resolve_template(config.get("workflow_id", ""), context)
            input_mapping = config.get("input_mapping", {})
            depth = context.get("_depth", 0)

            if depth >= 5:
                output = {"error": "Max sub-workflow depth (5) exceeded"}
                status = "failed"
                error_msg = "Max sub-workflow depth exceeded"
            elif not sub_wf_id:
                output = {"error": "No workflow_id specified"}
                status = "failed"
                error_msg = "No workflow_id for sub-workflow"
            else:
                sub_wf = await _load_full_workflow(db, sub_wf_id)
                if not sub_wf:
                    output = {"error": f"Sub-workflow {sub_wf_id} not found"}
                    status = "failed"
                    error_msg = f"Sub-workflow {sub_wf_id} not found"
                else:
                    sub_trigger = {}
                    for key, path in input_mapping.items():
                        sub_trigger[key] = _resolve_variable(path, context)
                    sub_trigger["_parent_execution"] = execution_id
                    sub_trigger["_depth"] = depth + 1

                    sub_result = await run_workflow(
                        db, sub_wf, sub_trigger,
                        context.get("triggered_by", "system"),
                        context.get("incident_id"),
                        depth=depth + 1,
                    )
                    output = {
                        "sub_execution_id": sub_result.get("execution_id"),
                        "sub_status": sub_result.get("status"),
                        "sub_duration_ms": sub_result.get("duration_ms"),
                    }
                    context["variables"]["sub_workflow_result"] = sub_result
                    if sub_result.get("status") == "failed":
                        status = "failed"
                        error_msg = f"Sub-workflow failed: {sub_result.get('error')}"

        # ── Merge (combine parallel outputs) ──
        elif node_type == "merge":
            # Collect outputs from all nodes that feed into this merge
            merged = {}
            for nkey, ndata in context.get("nodes", {}).items():
                if isinstance(ndata, dict) and "output" in ndata:
                    merged[nkey] = ndata["output"]
            output = {"merged": merged, "sources": list(merged.keys())}
            context["variables"]["merged"] = merged

        # ── Create Incident ──
        elif node_type == "create_incident":
            title = _resolve_template(config.get("title", "Automated Incident"), context)
            severity = _resolve_template(config.get("severity", "medium"), context)
            description = _resolve_template(config.get("description", ""), context)
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.post(
                        f"{settings.incident_service_url}/incidents",
                        json={"title": title, "severity": severity, "description": description, "status": "new", "tenant_id": context.get("tenant_id", "")},
                        headers=_auto_headers(context),
                    )
                    output = {"status_code": resp.status_code, "response": resp.json() if resp.status_code < 300 else resp.text}
                    if resp.status_code < 300:
                        created = resp.json()
                        context["variables"]["created_incident_id"] = str(created.get("id", ""))
            except Exception as e:
                output = {"error": str(e)}

        # ── Update Incident ──
        elif node_type == "update_incident":
            incident_id = config.get("incident_id") or context.get("incident_id") or context.get("trigger_data", {}).get("incident_id")
            fields = {}
            for f in ("title", "severity", "description", "assigned_to"):
                val = config.get(f)
                if val:
                    fields[f] = _resolve_template(val, context)
            if incident_id and fields:
                try:
                    async with httpx.AsyncClient(timeout=15) as client:
                        resp = await client.patch(
                            f"{settings.incident_service_url}/incidents/{incident_id}",
                            json=fields,
                            headers=_auto_headers(context),
                        )
                        output = {"status_code": resp.status_code, "updated_fields": list(fields.keys())}
                except Exception as e:
                    output = {"error": str(e)}

        # ── Close Incident ──
        elif node_type == "close_incident":
            incident_id = config.get("incident_id") or context.get("incident_id") or context.get("trigger_data", {}).get("incident_id")
            resolution_note = _resolve_template(config.get("resolution_note", "Auto-closed by workflow"), context)
            if incident_id:
                try:
                    async with httpx.AsyncClient(timeout=15) as client:
                        await client.patch(
                            f"{settings.incident_service_url}/incidents/{incident_id}/status",
                            json={"status": "resolved"},
                            headers=_auto_headers(context),
                        )
                        await client.post(
                            f"{settings.incident_service_url}/incidents/{incident_id}/comments",
                            json={"content": f"[Auto-Resolved] {resolution_note}"},
                            headers=_auto_headers(context),
                        )
                        output = {"incident_id": incident_id, "closed": True, "note": resolution_note}
                except Exception as e:
                    output = {"error": str(e)}

        # ── Get Incident Details ──
        elif node_type == "get_incident":
            incident_id = config.get("incident_id") or context.get("incident_id") or context.get("trigger_data", {}).get("incident_id")
            if incident_id:
                try:
                    async with httpx.AsyncClient(timeout=15) as client:
                        resp = await client.get(
                            f"{settings.incident_service_url}/incidents/{incident_id}",
                            headers=_auto_headers(context),
                        )
                        if resp.status_code == 200:
                            output = resp.json()
                            context["variables"]["incident"] = output
                        else:
                            output = {"error": f"Status {resp.status_code}"}
                except Exception as e:
                    output = {"error": str(e)}

        # ── Extract IOCs ──
        elif node_type == "extract_iocs":
            text_input = _resolve_template(config.get("text", ""), context)
            if not text_input:
                text_input = str(context.get("trigger_data", {}).get("title", "")) + " " + str(context.get("trigger_data", {}).get("description", ""))
            import re as _re
            ips = list(set(_re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', text_input)))
            domains = list(set(_re.findall(r'\b[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}\b', text_input)))
            urls = list(set(_re.findall(r'https?://[^\s<>"\']+', text_input)))
            md5s = list(set(_re.findall(r'\b[a-fA-F0-9]{32}\b', text_input)))
            sha256s = list(set(_re.findall(r'\b[a-fA-F0-9]{64}\b', text_input)))
            emails = list(set(_re.findall(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b', text_input)))
            all_iocs = []
            for ip in ips: all_iocs.append({"type": "ip", "value": ip})
            for d in domains: all_iocs.append({"type": "domain", "value": d})
            for u in urls: all_iocs.append({"type": "url", "value": u})
            for h in md5s: all_iocs.append({"type": "md5", "value": h})
            for h in sha256s: all_iocs.append({"type": "sha256", "value": h})
            for e in emails: all_iocs.append({"type": "email", "value": e})
            output = {"iocs": all_iocs, "ips": ips, "domains": domains, "urls": urls, "hashes": md5s + sha256s, "emails": emails, "total": len(all_iocs)}
            context["variables"]["iocs"] = all_iocs

        # ── Search Incidents ──
        elif node_type == "search_incidents":
            query = _resolve_template(config.get("query", ""), context)
            limit = int(config.get("limit", 20))
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    params = {"limit": str(limit)}
                    if query:
                        params["search"] = query
                    if context.get("tenant_id"):
                        params["tenant_id"] = context["tenant_id"]
                    resp = await client.get(
                        f"{settings.incident_service_url}/incidents",
                        params=params,
                        headers=_auto_headers(context),
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        output = {"count": len(data) if isinstance(data, list) else data.get("total", 0), "incidents": data if isinstance(data, list) else data.get("incidents", [])}
                    else:
                        output = {"error": f"Status {resp.status_code}"}
            except Exception as e:
                output = {"error": str(e)}

        # ── Send Email ──
        elif node_type == "send_email":
            incident_id = config.get("incident_id") or context.get("incident_id") or context.get("trigger_data", {}).get("incident_id")
            to = _resolve_template(config.get("to", ""), context)
            subject_line = _resolve_template(config.get("subject", ""), context)
            body_text = _resolve_template(config.get("body", ""), context)
            team_id = config.get("team_id") or ""

            # Strategy: If we have custom to/subject/body, send directly via SMTP using tenant mailing config.
            #           If only incident_id and team_id, use the incident send-email endpoint.
            if to and subject_line and body_text:
                # Direct SMTP send using tenant mailing config
                try:
                    tenant_id = context.get("tenant_id", "")
                    # Fetch mailing config for this tenant
                    mail_cfg = None
                    mail_res = await db.execute(text(
                        "SELECT * FROM public.mailing_configs WHERE tenant_id = :tid AND is_active = TRUE"
                    ), {"tid": tenant_id})
                    mail_cfg = mail_res.mappings().first()

                    if not mail_cfg:
                        output = {"error": "No active mailing config for tenant", "tenant_id": tenant_id}
                        status = "error"
                        error_msg = "No mailing config"
                    else:
                        import aiosmtplib
                        from email.message import EmailMessage as _EM

                        msg = _EM()
                        msg["Subject"] = subject_line
                        msg["From"] = mail_cfg["from_email"]
                        msg["To"] = to
                        cc = _resolve_template(config.get("cc", ""), context)
                        if cc:
                            msg["Cc"] = cc
                        msg.set_content(body_text)

                        # If body looks like HTML, add as alternative
                        if "<" in body_text and ">" in body_text:
                            msg.add_alternative(body_text, subtype='html')

                        await aiosmtplib.send(
                            msg,
                            hostname=mail_cfg["smtp_host"],
                            port=mail_cfg["smtp_port"],
                            username=mail_cfg["smtp_user"],
                            password=mail_cfg["smtp_pass"],
                            use_tls=(mail_cfg["smtp_port"] == 465),
                            start_tls=(mail_cfg["smtp_port"] == 587),
                        )
                        output = {"sent": True, "to": to, "subject": subject_line, "incident_id": incident_id or ""}
                except Exception as e:
                    output = {"error": str(e)}
                    status = "error"
                    error_msg = str(e)
            elif incident_id and team_id:
                # Use incident send-email endpoint with team_id
                try:
                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.post(
                            f"{settings.incident_service_url}/incidents/{incident_id}/send-email",
                            data={"team_id": team_id},
                            headers=_auto_headers(context),
                        )
                        output = {"status_code": resp.status_code, "incident_id": incident_id}
                        if resp.status_code >= 400:
                            output["error"] = resp.text
                            status = "error"
                            error_msg = f"Send-email returned {resp.status_code}"
                except Exception as e:
                    output = {"error": str(e)}
                    status = "error"
                    error_msg = str(e)
            elif incident_id:
                # No team_id but have incident_id - try direct SMTP with incident details
                try:
                    tenant_id = context.get("tenant_id", "")
                    trigger = context.get("trigger_data", {})
                    # Build email from incident data
                    mail_res = await db.execute(text(
                        "SELECT * FROM public.mailing_configs WHERE tenant_id = :tid AND is_active = TRUE"
                    ), {"tid": tenant_id})
                    mail_cfg = mail_res.mappings().first()

                    if mail_cfg:
                        import aiosmtplib
                        from email.message import EmailMessage as _EM

                        # Get incident details
                        inc_res = await db.execute(text(
                            "SELECT * FROM public.incidents WHERE id = CAST(:iid AS UUID)"
                        ), {"iid": incident_id})
                        inc = inc_res.mappings().first()

                        if inc:
                            # Get team level 1 recipients
                            team = str(inc.get("assigned_team_id", ""))
                            recip_res = await db.execute(text("""
                                SELECT e.email FROM public.level_emails e
                                JOIN public.team_escalation_levels l ON l.id = e.level_id
                                WHERE l.team_id = :tid AND l.level_number = 1
                            """), {"tid": team})
                            recipients = [r["email"] for r in recip_res.mappings().all()]

                            if recipients:
                                msg = _EM()
                                msg["Subject"] = subject_line or f"[{inc['severity'].upper()}] Incident: {inc['ticket_id']} - {inc['title']}"
                                msg["From"] = mail_cfg["from_email"]
                                msg["To"] = ", ".join(recipients)
                                email_body = body_text or f"Automated notification for incident {inc['ticket_id']}: {inc['title']}\nSeverity: {inc['severity']}\nStatus: {inc['status']}"
                                msg.set_content(email_body)

                                await aiosmtplib.send(
                                    msg,
                                    hostname=mail_cfg["smtp_host"],
                                    port=mail_cfg["smtp_port"],
                                    username=mail_cfg["smtp_user"],
                                    password=mail_cfg["smtp_pass"],
                                    use_tls=(mail_cfg["smtp_port"] == 465),
                                    start_tls=(mail_cfg["smtp_port"] == 587),
                                )
                                output = {"sent": True, "to": ", ".join(recipients), "incident_id": incident_id}
                            else:
                                output = {"error": "No recipients found for team", "incident_id": incident_id}
                        else:
                            output = {"error": "Incident not found", "incident_id": incident_id}
                    else:
                        output = {"error": "No mailing config", "tenant_id": tenant_id}
                except Exception as e:
                    output = {"error": str(e)}
                    status = "error"
                    error_msg = str(e)
            else:
                output = {"info": "No incident_id or to address, email skipped"}

        # ── Loop / For Each ──
        elif node_type == "loop":
            items_path = config.get("items", "")
            items = _resolve_variable(items_path, context)
            if isinstance(items, str):
                try:
                    items = json.loads(items)
                except:
                    items = items.split(",")
            if not isinstance(items, list):
                items = [items] if items else []
            output = {"items": items, "count": len(items), "branch": "loop_body"}
            context["variables"]["loop_items"] = items
            context["variables"]["loop_count"] = len(items)

        # ── Regex Extract ──
        elif node_type == "regex_extract":
            import re as _re
            text_input = _resolve_template(config.get("text", ""), context)
            pattern = config.get("pattern", "")
            try:
                matches = _re.findall(pattern, text_input)
                output = {"matches": matches, "count": len(matches)}
                context["variables"]["regex_matches"] = matches
            except Exception as e:
                output = {"error": str(e)}

        # ── JSON Parse ──
        elif node_type == "json_parse":
            raw = _resolve_template(config.get("input", ""), context)
            try:
                parsed = json.loads(raw)
                output = {"parsed": parsed}
                context["variables"]["parsed_json"] = parsed
            except Exception as e:
                output = {"error": f"JSON parse failed: {e}"}

        # ── Math Expression ──
        elif node_type == "math_expression":
            expression = _resolve_template(config.get("expression", "0"), context)
            try:
                # Safe eval: only allow numbers and basic operators
                allowed = set("0123456789+-*/().% ")
                if all(c in allowed for c in expression):
                    result = eval(expression)
                    output = {"result": result, "expression": expression}
                    context["variables"]["math_result"] = result
                else:
                    output = {"error": "Invalid characters in expression"}
            except Exception as e:
                output = {"error": str(e)}

        # ── VirusTotal Lookup ──
        elif node_type == "virustotal_lookup":
            ioc_value = _resolve_template(config.get("ioc_value", ""), context)
            ioc_type = config.get("ioc_type", "ip")
            api_key = await _get_credential(db, context.get("tenant_id", ""), config.get("credential_id", ""), "virustotal")
            if not api_key:
                api_key = config.get("api_key", "")
            if ioc_value and api_key:
                try:
                    vt_url = f"https://www.virustotal.com/api/v3/"
                    if ioc_type == "ip":
                        vt_url += f"ip_addresses/{ioc_value}"
                    elif ioc_type == "domain":
                        vt_url += f"domains/{ioc_value}"
                    elif ioc_type in ("hash", "md5", "sha256"):
                        vt_url += f"files/{ioc_value}"
                    elif ioc_type == "url":
                        import base64
                        url_id = base64.urlsafe_b64encode(ioc_value.encode()).decode().rstrip("=")
                        vt_url += f"urls/{url_id}"
                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.get(vt_url, headers={"x-apikey": api_key})
                        if resp.status_code == 200:
                            data = resp.json().get("data", {}).get("attributes", {})
                            stats = data.get("last_analysis_stats", {})
                            output = {
                                "ioc": ioc_value, "type": ioc_type,
                                "malicious": stats.get("malicious", 0),
                                "suspicious": stats.get("suspicious", 0),
                                "harmless": stats.get("harmless", 0),
                                "undetected": stats.get("undetected", 0),
                                "score": stats.get("malicious", 0),
                                "reputation": data.get("reputation", 0),
                                "country": data.get("country", ""),
                            }
                        else:
                            output = {"error": f"VT API returned {resp.status_code}", "ioc": ioc_value}
                except Exception as e:
                    output = {"error": str(e), "ioc": ioc_value}
            else:
                output = {"error": "Missing IOC value or API key", "ioc": ioc_value}

        # ── AbuseIPDB Check ──
        elif node_type == "abuseipdb_check":
            ip = _resolve_template(config.get("ip_address", ""), context)
            api_key = await _get_credential(db, context.get("tenant_id", ""), config.get("credential_id", ""), "abuseipdb")
            if not api_key:
                api_key = config.get("api_key", "")
            if ip and api_key:
                try:
                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.get(
                            "https://api.abuseipdb.com/api/v2/check",
                            params={"ipAddress": ip, "maxAgeInDays": "90"},
                            headers={"Key": api_key, "Accept": "application/json"},
                        )
                        if resp.status_code == 200:
                            data = resp.json().get("data", {})
                            output = {
                                "ip": ip,
                                "abuse_score": data.get("abuseConfidenceScore", 0),
                                "country": data.get("countryCode", ""),
                                "isp": data.get("isp", ""),
                                "domain": data.get("domain", ""),
                                "total_reports": data.get("totalReports", 0),
                                "is_public": data.get("isPublic", True),
                                "is_tor": data.get("isTor", False),
                            }
                        else:
                            output = {"error": f"AbuseIPDB returned {resp.status_code}", "ip": ip}
                except Exception as e:
                    output = {"error": str(e), "ip": ip}
            else:
                output = {"error": "Missing IP or API key", "ip": ip}

        # ── Whois Lookup ──
        elif node_type == "whois_lookup":
            target = _resolve_template(config.get("target", ""), context)
            if target:
                try:
                    async with httpx.AsyncClient(timeout=15) as client:
                        resp = await client.get(f"https://rdap.org/domain/{target}")
                        if resp.status_code == 200:
                            data = resp.json()
                            output = {
                                "target": target,
                                "name": data.get("name", ""),
                                "status": data.get("status", []),
                                "events": [{"action": e.get("eventAction"), "date": e.get("eventDate")} for e in data.get("events", [])],
                                "nameservers": [ns.get("ldhName", "") for ns in data.get("nameservers", [])],
                            }
                        else:
                            # Fallback to ip-api for IPs
                            resp2 = await client.get(f"http://ip-api.com/json/{target}")
                            if resp2.status_code == 200:
                                output = {"target": target, **resp2.json()}
                            else:
                                output = {"target": target, "error": "Lookup failed"}
                except Exception as e:
                    output = {"error": str(e), "target": target}
            else:
                output = {"error": "No target specified"}

        # ── DNS Resolve ──
        elif node_type == "dns_resolve":
            target = _resolve_template(config.get("target", ""), context)
            if target:
                try:
                    async with httpx.AsyncClient(timeout=10) as client:
                        resp = await client.get(f"https://dns.google/resolve?name={target}&type=A")
                        if resp.status_code == 200:
                            data = resp.json()
                            answers = [{"name": a.get("name"), "type": a.get("type"), "data": a.get("data"), "ttl": a.get("TTL")} for a in data.get("Answer", [])]
                            output = {"target": target, "answers": answers, "status": data.get("Status", -1)}
                        else:
                            output = {"target": target, "error": f"DNS query returned {resp.status_code}"}
                except Exception as e:
                    output = {"error": str(e), "target": target}
            else:
                output = {"error": "No target specified"}

        # ── GeoIP Lookup ──
        elif node_type == "geoip_lookup":
            ip = _resolve_template(config.get("ip_address", ""), context)
            if ip:
                try:
                    async with httpx.AsyncClient(timeout=10) as client:
                        resp = await client.get(f"http://ip-api.com/json/{ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query")
                        if resp.status_code == 200:
                            data = resp.json()
                            output = {"ip": ip, **data}
                        else:
                            output = {"ip": ip, "error": f"GeoIP returned {resp.status_code}"}
                except Exception as e:
                    output = {"error": str(e), "ip": ip}
            else:
                output = {"error": "No IP specified"}

        # ── Text Template ──
        elif node_type == "text_template":
            template = config.get("template", "")
            output = {"text": _resolve_template(template, context)}

        # ── Array Filter ──
        elif node_type == "array_filter":
            items_path = config.get("items", "")
            field = config.get("field", "")
            operator = config.get("operator", "==")
            value = config.get("value", "")
            items = _resolve_variable(items_path, context)
            if isinstance(items, list):
                filtered = [i for i in items if _evaluate_condition(i.get(field, i) if isinstance(i, dict) else i, operator, value)]
                output = {"filtered": filtered, "count": len(filtered), "original_count": len(items)}
                context["variables"]["filtered"] = filtered
            else:
                output = {"error": "Items is not a list"}

        # ══════════════════════════════════════════════════
        #   FRESHDESK INTEGRATION
        # ══════════════════════════════════════════════════

        elif node_type == "freshdesk_create_ticket":
            api_key = await _get_credential(db, context.get("tenant_id", ""), config.get("credential_id", ""), "freshdesk")
            if not api_key:
                api_key = config.get("api_key", "")
            domain = _resolve_template(config.get("domain", ""), context)
            subject = _resolve_template(config.get("subject", ""), context)
            description = _resolve_template(config.get("description", ""), context)
            email = _resolve_template(config.get("email", ""), context)
            priority = int(config.get("priority", 1))  # 1=Low,2=Med,3=High,4=Urgent
            fd_status = int(config.get("status", 2))     # 2=Open,3=Pending,4=Resolved,5=Closed
            ticket_type = _resolve_template(config.get("type", ""), context)
            tags = config.get("tags", [])

            if not domain or not api_key:
                output = {"error": "Missing Freshdesk domain or API key"}
                status = "failed"
                error_msg = "Missing Freshdesk domain or API key"
            else:
                try:
                    import base64 as _b64
                    auth_header = _b64.b64encode(f"{api_key}:X".encode()).decode()
                    payload = {
                        "subject": subject or f"SOC Incident: {context.get('trigger_data', {}).get('title', 'N/A')}",
                        "description": description or f"Auto-created from SOC workflow {context.get('workflow_id', '')}",
                        "email": email or "soc-automation@noreply.com",
                        "priority": priority,
                        "status": fd_status,
                    }
                    if ticket_type:
                        payload["type"] = ticket_type
                    if tags:
                        payload["tags"] = tags

                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.post(
                            f"https://{domain}.freshdesk.com/api/v2/tickets",
                            json=payload,
                            headers={"Authorization": f"Basic {auth_header}", "Content-Type": "application/json"},
                        )
                        if resp.status_code in (200, 201):
                            data = resp.json()
                            output = {"ticket_id": data.get("id"), "subject": data.get("subject"), "status_code": resp.status_code, "url": f"https://{domain}.freshdesk.com/a/tickets/{data.get('id')}"}
                            context["variables"]["freshdesk_ticket_id"] = data.get("id")
                            context["variables"]["freshdesk_ticket_url"] = output["url"]
                        else:
                            output = {"error": f"Freshdesk API returned {resp.status_code}", "detail": resp.text[:500]}
                            status = "failed"
                            error_msg = f"Freshdesk: {resp.status_code}"
                except Exception as e:
                    output = {"error": str(e)}
                    status = "failed"
                    error_msg = str(e)

        elif node_type == "freshdesk_update_ticket":
            api_key = await _get_credential(db, context.get("tenant_id", ""), config.get("credential_id", ""), "freshdesk")
            if not api_key:
                api_key = config.get("api_key", "")
            domain = _resolve_template(config.get("domain", ""), context)
            ticket_id = _resolve_template(config.get("ticket_id", ""), context)
            if not ticket_id:
                ticket_id = str(context.get("variables", {}).get("freshdesk_ticket_id", ""))

            if not domain or not api_key or not ticket_id:
                output = {"error": "Missing domain, API key, or ticket_id"}
                status = "failed"
                error_msg = "Missing Freshdesk config"
            else:
                try:
                    import base64 as _b64
                    auth_header = _b64.b64encode(f"{api_key}:X".encode()).decode()
                    update_fields = {}
                    for f in ("subject", "description", "priority", "status", "type", "group_id", "responder_id"):
                        val = config.get(f)
                        if val:
                            resolved = _resolve_template(str(val), context)
                            update_fields[f] = int(resolved) if f in ("priority", "status", "group_id", "responder_id") else resolved
                    tags = config.get("tags")
                    if tags:
                        update_fields["tags"] = tags

                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.put(
                            f"https://{domain}.freshdesk.com/api/v2/tickets/{ticket_id}",
                            json=update_fields,
                            headers={"Authorization": f"Basic {auth_header}", "Content-Type": "application/json"},
                        )
                        output = {"ticket_id": ticket_id, "status_code": resp.status_code, "updated_fields": list(update_fields.keys())}
                        if resp.status_code >= 400:
                            output["error"] = resp.text[:500]
                            status = "failed"
                            error_msg = f"Freshdesk update: {resp.status_code}"
                except Exception as e:
                    output = {"error": str(e)}
                    status = "failed"
                    error_msg = str(e)

        elif node_type == "freshdesk_get_ticket":
            api_key = await _get_credential(db, context.get("tenant_id", ""), config.get("credential_id", ""), "freshdesk")
            if not api_key:
                api_key = config.get("api_key", "")
            domain = _resolve_template(config.get("domain", ""), context)
            ticket_id = _resolve_template(config.get("ticket_id", ""), context)
            if not ticket_id:
                ticket_id = str(context.get("variables", {}).get("freshdesk_ticket_id", ""))

            if not domain or not api_key or not ticket_id:
                output = {"error": "Missing domain, API key, or ticket_id"}
                status = "failed"
                error_msg = "Missing Freshdesk config"
            else:
                try:
                    import base64 as _b64
                    auth_header = _b64.b64encode(f"{api_key}:X".encode()).decode()
                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.get(
                            f"https://{domain}.freshdesk.com/api/v2/tickets/{ticket_id}",
                            headers={"Authorization": f"Basic {auth_header}"},
                        )
                        if resp.status_code == 200:
                            data = resp.json()
                            output = {"ticket": data, "ticket_id": data.get("id"), "subject": data.get("subject"), "status": data.get("status"), "priority": data.get("priority")}
                            context["variables"]["freshdesk_ticket"] = data
                        else:
                            output = {"error": f"Freshdesk: {resp.status_code}", "detail": resp.text[:500]}
                except Exception as e:
                    output = {"error": str(e)}

        elif node_type == "freshdesk_add_note":
            api_key = await _get_credential(db, context.get("tenant_id", ""), config.get("credential_id", ""), "freshdesk")
            if not api_key:
                api_key = config.get("api_key", "")
            domain = _resolve_template(config.get("domain", ""), context)
            ticket_id = _resolve_template(config.get("ticket_id", ""), context)
            if not ticket_id:
                ticket_id = str(context.get("variables", {}).get("freshdesk_ticket_id", ""))
            body_text = _resolve_template(config.get("body", ""), context)
            private = config.get("private", True)

            if not domain or not api_key or not ticket_id or not body_text:
                output = {"error": "Missing domain, API key, ticket_id, or body"}
                status = "failed"
                error_msg = "Missing Freshdesk note config"
            else:
                try:
                    import base64 as _b64
                    auth_header = _b64.b64encode(f"{api_key}:X".encode()).decode()
                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.post(
                            f"https://{domain}.freshdesk.com/api/v2/tickets/{ticket_id}/notes",
                            json={"body": body_text, "private": private},
                            headers={"Authorization": f"Basic {auth_header}", "Content-Type": "application/json"},
                        )
                        if resp.status_code in (200, 201):
                            data = resp.json()
                            output = {"note_id": data.get("id"), "ticket_id": ticket_id, "status_code": resp.status_code}
                        else:
                            output = {"error": f"Freshdesk: {resp.status_code}", "detail": resp.text[:500]}
                            status = "failed"
                            error_msg = f"Freshdesk add note: {resp.status_code}"
                except Exception as e:
                    output = {"error": str(e)}
                    status = "failed"
                    error_msg = str(e)

        elif node_type == "freshdesk_list_tickets":
            api_key = await _get_credential(db, context.get("tenant_id", ""), config.get("credential_id", ""), "freshdesk")
            if not api_key:
                api_key = config.get("api_key", "")
            domain = _resolve_template(config.get("domain", ""), context)
            query = _resolve_template(config.get("query", ""), context)
            per_page = int(config.get("per_page", 30))

            if not domain or not api_key:
                output = {"error": "Missing Freshdesk domain or API key"}
                status = "failed"
                error_msg = "Missing Freshdesk config"
            else:
                try:
                    import base64 as _b64
                    auth_header = _b64.b64encode(f"{api_key}:X".encode()).decode()
                    url = f"https://{domain}.freshdesk.com/api/v2/tickets?per_page={per_page}"
                    if query:
                        url = f"https://{domain}.freshdesk.com/api/v2/search/tickets?query=\"{query}\""
                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.get(url, headers={"Authorization": f"Basic {auth_header}"})
                        if resp.status_code == 200:
                            data = resp.json()
                            tickets = data if isinstance(data, list) else data.get("results", [])
                            output = {"tickets": tickets, "count": len(tickets)}
                            context["variables"]["freshdesk_tickets"] = tickets
                        else:
                            output = {"error": f"Freshdesk: {resp.status_code}", "detail": resp.text[:500]}
                except Exception as e:
                    output = {"error": str(e)}

        # ══════════════════════════════════════════════════
        #   ONEDESK INTEGRATION
        # ══════════════════════════════════════════════════

        elif node_type == "onedesk_create_item":
            api_key = await _get_credential(db, context.get("tenant_id", ""), config.get("credential_id", ""), "onedesk")
            if not api_key:
                api_key = config.get("api_key", "")
            base_url = _resolve_template(config.get("base_url", "https://app.onedesk.com/rest/2.0"), context)
            name = _resolve_template(config.get("name", ""), context)
            description = _resolve_template(config.get("description", ""), context)
            item_type = config.get("item_type", "ticket")  # ticket, task, feature, bug
            priority = int(config.get("priority", 50))  # 0-100 scale
            project_id = _resolve_template(config.get("project_id", ""), context)

            if not api_key:
                output = {"error": "Missing OneDesk API key"}
                status = "failed"
                error_msg = "Missing OneDesk API key"
            else:
                try:
                    payload = {
                        "name": name or f"SOC Incident: {context.get('trigger_data', {}).get('title', 'N/A')}",
                        "description": description or f"Auto-created from SOC workflow {context.get('workflow_id', '')}",
                        "type": item_type,
                        "priority": priority,
                    }
                    if project_id:
                        payload["projectId"] = project_id

                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.post(
                            f"{base_url}/items",
                            json=payload,
                            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        )
                        if resp.status_code in (200, 201):
                            data = resp.json()
                            item_id = data.get("id") or data.get("itemId") or data.get("data", {}).get("id", "")
                            output = {"item_id": item_id, "name": name, "status_code": resp.status_code, "response": data}
                            context["variables"]["onedesk_item_id"] = item_id
                        else:
                            output = {"error": f"OneDesk API returned {resp.status_code}", "detail": resp.text[:500]}
                            status = "failed"
                            error_msg = f"OneDesk: {resp.status_code}"
                except Exception as e:
                    output = {"error": str(e)}
                    status = "failed"
                    error_msg = str(e)

        elif node_type == "onedesk_update_item":
            api_key = await _get_credential(db, context.get("tenant_id", ""), config.get("credential_id", ""), "onedesk")
            if not api_key:
                api_key = config.get("api_key", "")
            base_url = _resolve_template(config.get("base_url", "https://app.onedesk.com/rest/2.0"), context)
            item_id = _resolve_template(config.get("item_id", ""), context)
            if not item_id:
                item_id = str(context.get("variables", {}).get("onedesk_item_id", ""))

            if not api_key or not item_id:
                output = {"error": "Missing OneDesk API key or item_id"}
                status = "failed"
                error_msg = "Missing OneDesk config"
            else:
                try:
                    update_fields = {}
                    for f in ("name", "description", "priority", "status", "assigneeId"):
                        val = config.get(f)
                        if val:
                            update_fields[f] = _resolve_template(str(val), context)
                    if config.get("priority"):
                        update_fields["priority"] = int(update_fields.get("priority", 50))

                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.patch(
                            f"{base_url}/items/{item_id}",
                            json=update_fields,
                            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        )
                        output = {"item_id": item_id, "status_code": resp.status_code, "updated_fields": list(update_fields.keys())}
                        if resp.status_code >= 400:
                            output["error"] = resp.text[:500]
                            status = "failed"
                            error_msg = f"OneDesk update: {resp.status_code}"
                except Exception as e:
                    output = {"error": str(e)}
                    status = "failed"
                    error_msg = str(e)

        elif node_type == "onedesk_get_item":
            api_key = await _get_credential(db, context.get("tenant_id", ""), config.get("credential_id", ""), "onedesk")
            if not api_key:
                api_key = config.get("api_key", "")
            base_url = _resolve_template(config.get("base_url", "https://app.onedesk.com/rest/2.0"), context)
            item_id = _resolve_template(config.get("item_id", ""), context)
            if not item_id:
                item_id = str(context.get("variables", {}).get("onedesk_item_id", ""))

            if not api_key or not item_id:
                output = {"error": "Missing OneDesk API key or item_id"}
            else:
                try:
                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.get(
                            f"{base_url}/items/{item_id}",
                            headers={"Authorization": f"Bearer {api_key}"},
                        )
                        if resp.status_code == 200:
                            data = resp.json()
                            output = {"item": data, "item_id": item_id, "name": data.get("name", ""), "status": data.get("status", "")}
                            context["variables"]["onedesk_item"] = data
                        else:
                            output = {"error": f"OneDesk: {resp.status_code}", "detail": resp.text[:500]}
                except Exception as e:
                    output = {"error": str(e)}

        elif node_type == "onedesk_add_comment":
            api_key = await _get_credential(db, context.get("tenant_id", ""), config.get("credential_id", ""), "onedesk")
            if not api_key:
                api_key = config.get("api_key", "")
            base_url = _resolve_template(config.get("base_url", "https://app.onedesk.com/rest/2.0"), context)
            item_id = _resolve_template(config.get("item_id", ""), context)
            if not item_id:
                item_id = str(context.get("variables", {}).get("onedesk_item_id", ""))
            comment_text = _resolve_template(config.get("content", ""), context)

            if not api_key or not item_id or not comment_text:
                output = {"error": "Missing OneDesk API key, item_id, or content"}
                status = "failed"
                error_msg = "Missing OneDesk comment config"
            else:
                try:
                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.post(
                            f"{base_url}/items/{item_id}/comments",
                            json={"content": comment_text},
                            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        )
                        if resp.status_code in (200, 201):
                            data = resp.json()
                            output = {"comment_id": data.get("id", ""), "item_id": item_id, "status_code": resp.status_code}
                        else:
                            output = {"error": f"OneDesk: {resp.status_code}", "detail": resp.text[:500]}
                            status = "failed"
                            error_msg = f"OneDesk add comment: {resp.status_code}"
                except Exception as e:
                    output = {"error": str(e)}
                    status = "failed"
                    error_msg = str(e)

        elif node_type == "onedesk_list_items":
            api_key = await _get_credential(db, context.get("tenant_id", ""), config.get("credential_id", ""), "onedesk")
            if not api_key:
                api_key = config.get("api_key", "")
            base_url = _resolve_template(config.get("base_url", "https://app.onedesk.com/rest/2.0"), context)
            item_type = config.get("item_type", "ticket")
            limit = int(config.get("limit", 25))

            if not api_key:
                output = {"error": "Missing OneDesk API key"}
                status = "failed"
                error_msg = "Missing OneDesk config"
            else:
                try:
                    async with httpx.AsyncClient(timeout=30) as client:
                        resp = await client.get(
                            f"{base_url}/items?type={item_type}&limit={limit}",
                            headers={"Authorization": f"Bearer {api_key}"},
                        )
                        if resp.status_code == 200:
                            data = resp.json()
                            items = data if isinstance(data, list) else data.get("data", data.get("items", []))
                            output = {"items": items, "count": len(items)}
                            context["variables"]["onedesk_items"] = items
                        else:
                            output = {"error": f"OneDesk: {resp.status_code}", "detail": resp.text[:500]}
                except Exception as e:
                    output = {"error": str(e)}

        else:
            output = {"warning": f"Unknown node type: {node_type}"}

    except Exception as e:
        status = "failed"
        error_msg = str(e)
        output = {"error": str(e)}

    return status, output, error_msg


def _resolve_variable(path: str, context: dict):
    """Resolve a dot-notated path like 'trigger_data.severity' from context."""
    parts = path.replace("{{", "").replace("}}", "").strip().split(".")
    current = context
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part, "")
        else:
            return ""
    return current


def _resolve_template(template: str, context: dict) -> str:
    """Replace {{variable.path}} patterns in a string."""
    import re
    def replacer(match):
        path = match.group(1).strip()
        val = _resolve_variable(path, context)
        return str(val) if val != "" else match.group(0)
    return re.sub(r'\{\{(.+?)\}\}', replacer, template)


def _evaluate_condition(actual, operator: str, expected) -> bool:
    """Evaluate a condition: actual <operator> expected."""
    actual_str = str(actual).lower().strip()
    expected_str = str(expected).lower().strip()

    if operator in ("==", "equals"):
        return actual_str == expected_str
    elif operator in ("!=", "not_equals"):
        return actual_str != expected_str
    elif operator in ("contains",):
        return expected_str in actual_str
    elif operator in ("not_contains",):
        return expected_str not in actual_str
    elif operator in (">", "gt"):
        try:
            return float(actual) > float(expected)
        except:
            return False
    elif operator in ("<", "lt"):
        try:
            return float(actual) < float(expected)
        except:
            return False
    elif operator in (">=", "gte"):
        try:
            return float(actual) >= float(expected)
        except:
            return False
    elif operator in ("<=", "lte"):
        try:
            return float(actual) <= float(expected)
        except:
            return False
    elif operator in ("exists",):
        return actual is not None and actual != ""
    elif operator in ("not_exists",):
        return actual is None or actual == ""
    elif operator in ("in",):
        return actual_str in [v.strip().lower() for v in expected_str.split(",")]
    return False


# ── Workflow Executor ──
async def run_workflow(
    db: AsyncSession, workflow: dict, trigger_data: dict,
    triggered_by: str = "system", incident_id: str = None,
    depth: int = 0, dry_run: bool = False,
    resume_execution_id: str = None, resume_context: dict = None,
    resume_visited: set = None, resume_node: str = None,
):
    """
    Execute a workflow: traverse nodes following edges, respecting conditions.
    Supports try/catch, pause/resume (approval gates, wait-for-event), sub-workflows, and dry-run.
    """
    wf_id = str(workflow["id"])
    execution_id = resume_execution_id or str(uuid.uuid4())
    nodes = workflow.get("_nodes", [])
    edges = workflow.get("_edges", [])
    tenant_id = str(workflow.get("tenant_id", ""))

    # Build adjacency map
    adj: dict = {}
    for edge in edges:
        src = edge["source_node_id"]
        if src not in adj:
            adj[src] = []
        adj[src].append(edge)

    # Build node lookup
    node_map = {n["id"]: n for n in nodes}

    # Find trigger node (start node)
    trigger_nodes = [n for n in nodes if n.get("category") == "trigger" or n["node_type"].startswith("trigger_")]
    if not trigger_nodes:
        trigger_nodes = [n for n in nodes if not any(e["target_node_id"] == n["id"] for e in edges)]

    started_at = datetime.now(timezone.utc)

    if not resume_execution_id:
        # Create execution record
        mode = "dry_run" if dry_run else ("manual" if triggered_by not in ("system", "scheduler", "webhook") else "automatic")
        await db.execute(text("""
            INSERT INTO public.workflow_executions
                (id, workflow_id, workflow_version, tenant_id, trigger_type, trigger_data,
                 status, started_at, nodes_total, incident_id, triggered_by, execution_mode)
            VALUES
                (:id, :wid, :ver, :tid, :ttype, :tdata, 'running', :started, :total, :iid, :by, :mode)
        """), {
            "id": execution_id,
            "wid": wf_id,
            "ver": workflow.get("version", 1),
            "tid": tenant_id,
            "ttype": "manual" if triggered_by not in ("system", "scheduler", "webhook") else triggered_by,
            "tdata": json.dumps(trigger_data, default=str),
            "started": started_at,
            "total": len(nodes),
            "iid": incident_id,
            "by": triggered_by,
            "mode": mode,
        })
    else:
        # Resume — update status back to running
        await db.execute(text(
            "UPDATE public.workflow_executions SET status = 'running', paused_at_node = NULL WHERE id = :eid"
        ), {"eid": execution_id})

    # Execution context — shared data between nodes
    # For multi-tenant workflows (tenant_id="global"), use the event's actual tenant_id
    effective_tenant_id = tenant_id
    if tenant_id == "global" and trigger_data.get("tenant_id"):
        effective_tenant_id = trigger_data["tenant_id"]

    context = resume_context or {
        "trigger_data": trigger_data,
        "incident_id": incident_id or trigger_data.get("incident_id"),
        "tenant_id": effective_tenant_id,
        "triggered_by": triggered_by,
        "variables": {},
        "nodes": {},
        "workflow_id": wf_id,
        "execution_id": execution_id,
        "_depth": depth,
        "_dry_run": dry_run,
    }

    nodes_executed = 0
    nodes_failed = 0
    final_status = "success"
    error_message = None

    try:
        # BFS / topological traversal
        if resume_node:
            # Resume from the node after the paused one
            queue = []
            for edge in adj.get(resume_node, []):
                queue.append(edge["target_node_id"])
            visited = resume_visited or set()
        else:
            queue = [n["id"] for n in trigger_nodes]
            visited = set()

        # Try/Catch scope stack
        try_catch_stack = []

        while queue:
            node_id = queue.pop(0)
            if node_id in visited:
                continue
            visited.add(node_id)

            node = node_map.get(node_id)
            if not node:
                continue

            # ── Try/Catch routing node ──
            if node["node_type"] == "try_catch":
                catch_targets = [e["target_node_id"] for e in adj.get(node_id, [])
                                 if (e.get("condition") or {}).get("branch") == "catch"]
                try_targets = [e["target_node_id"] for e in adj.get(node_id, [])
                               if (e.get("condition") or {}).get("branch") != "catch"]
                try_catch_stack.append({"node_id": node_id, "catch_targets": catch_targets})
                # Follow only try branch
                for tid in try_targets:
                    if tid not in visited:
                        queue.append(tid)
                # Log the try_catch node itself
                await execute_node(db, node, context, execution_id)
                nodes_executed += 1
                continue

            result = await execute_node(db, node, context, execution_id)
            nodes_executed += 1

            # ── Check for pause signal (approval gate, wait for event) ──
            pause_info = result.get("output", {})
            if isinstance(pause_info, dict) and pause_info.get("_pause"):
                pause_type = pause_info.get("_pause_type", "paused")
                # Serialize context and visited set for later resume
                serializable_context = {k: v for k, v in context.items() if not k.startswith("_")}
                serializable_context["variables"] = context.get("variables", {})
                serializable_context["nodes"] = context.get("nodes", {})
                await db.execute(text("""
                    UPDATE public.workflow_executions
                    SET status = :status, paused_at_node = :node, context_snapshot = :ctx,
                        visited_nodes = :visited, nodes_executed = :nexec, nodes_failed = :nfail
                    WHERE id = :eid
                """), {
                    "status": pause_type,
                    "node": node_id,
                    "ctx": json.dumps(serializable_context, default=str),
                    "visited": list(visited),
                    "nexec": nodes_executed,
                    "nfail": nodes_failed,
                    "eid": execution_id,
                })
                return {
                    "execution_id": execution_id,
                    "status": pause_type,
                    "paused_at": node_id,
                    "nodes_executed": nodes_executed,
                }

            # ── Handle failure ──
            if result["status"] == "failed":
                nodes_failed += 1
                error_handling = node.get("error_handling", "stop")

                if error_handling == "continue":
                    pass  # Skip and continue to next nodes
                elif try_catch_stack:
                    # Jump to catch branch of nearest try/catch
                    scope = try_catch_stack.pop()
                    context["variables"]["error"] = result.get("error", "")
                    context["variables"]["error_node"] = node_id
                    context["variables"]["error_node_type"] = node["node_type"]
                    for catch_target in scope["catch_targets"]:
                        if catch_target not in visited:
                            queue.append(catch_target)
                    continue  # Skip normal edge following
                else:
                    final_status = "failed"
                    error_message = result.get("error")
                    break

            # Check for stop node
            if node["node_type"] == "stop":
                break

            # Get outgoing edges
            outgoing = adj.get(node_id, [])
            for edge in outgoing:
                target_id = edge["target_node_id"]
                edge_condition = edge.get("condition")

                if edge_condition:
                    # For if_condition / switch / try_catch nodes, check branch
                    branch = result.get("output", {}).get("branch", "")
                    expected_branch = edge_condition.get("branch", "")
                    if branch and expected_branch and branch != expected_branch:
                        continue  # Skip this edge

                if target_id not in visited:
                    queue.append(target_id)

    except Exception as e:
        final_status = "failed"
        error_message = str(e)
        logger.error(f"Workflow execution failed: {e}")

    completed_at = datetime.now(timezone.utc)
    duration_ms = int((completed_at - started_at).total_seconds() * 1000)

    # Update execution record
    await db.execute(text("""
        UPDATE public.workflow_executions
        SET status = :status, completed_at = :completed, duration_ms = :dur,
            nodes_executed = :nexec, nodes_failed = :nfail, error_message = :err
        WHERE id = :eid
    """), {
        "status": final_status,
        "completed": completed_at,
        "dur": duration_ms,
        "nexec": nodes_executed,
        "nfail": nodes_failed,
        "err": error_message,
        "eid": execution_id,
    })

    return {
        "execution_id": execution_id,
        "status": final_status,
        "duration_ms": duration_ms,
        "nodes_executed": nodes_executed,
        "nodes_failed": nodes_failed,
        "error": error_message,
    }


async def _resume_workflow(db: AsyncSession, execution_id: str, resume_data: dict = None):
    """Resume a paused workflow execution from where it left off."""
    try:
        exe_res = await db.execute(text("""
            SELECT we.*, w.id as wf_id FROM public.workflow_executions we
            JOIN public.workflows w ON w.id = we.workflow_id
            WHERE we.id = :eid
        """), {"eid": execution_id})
        exe = exe_res.mappings().first()
        if not exe:
            return {"error": "Execution not found"}

        wf = await _load_full_workflow(db, str(exe["wf_id"]))
        if not wf:
            return {"error": "Workflow not found"}

        # Restore context
        ctx = exe.get("context_snapshot") or {}
        if isinstance(ctx, str):
            ctx = json.loads(ctx)

        # Inject resume data (e.g., approval result or event data)
        if resume_data:
            ctx.setdefault("variables", {})
            ctx["variables"]["resume_data"] = resume_data

        # Restore visited set
        visited_list = exe.get("visited_nodes") or []
        visited = set(visited_list)

        paused_node = exe.get("paused_at_node", "")

        result = await run_workflow(
            db, wf, ctx.get("trigger_data", {}),
            ctx.get("triggered_by", "system"),
            ctx.get("incident_id"),
            resume_execution_id=execution_id,
            resume_context=ctx,
            resume_visited=visited,
            resume_node=paused_node,
        )
        return result
    except Exception as e:
        logger.error(f"Resume workflow failed: {e}")
        return {"error": str(e)}


# ── Trigger Evaluator (listens to Redis pub/sub for incident events) ──
async def trigger_evaluator():
    """
    Listen for incident events on Redis pub/sub and evaluate workflow triggers.
    """
    global redis_client
    logger.info("Trigger evaluator started — listening for incident events")

    while True:
        try:
            if not redis_client:
                await asyncio.sleep(5)
                continue

            pubsub = redis_client.pubsub()
            await pubsub.subscribe("incident_events")

            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue

                try:
                    event_data = json.loads(message["data"])
                    event_type = event_data.get("event_type", "")
                    tenant_id = event_data.get("tenant_id", "")

                    if not event_type or not tenant_id:
                        continue

                    # Find active workflows with matching triggers
                    # Match: exact tenant_id, OR target_tenant_ids contains this tenant or "all"
                    async with AsyncSessionLocal() as db:
                        async with db.begin():
                            wf_rows = await db.execute(text("""
                                SELECT w.id, w.tenant_id, w.version, w.settings
                                FROM public.workflows w
                                JOIN public.workflow_nodes wn ON wn.workflow_id = w.id
                                WHERE w.status = 'active'
                                  AND (
                                      w.tenant_id = :tid
                                      OR w.target_tenant_ids @> :tid_json
                                      OR w.target_tenant_ids @> '"all"'::jsonb
                                  )
                                  AND wn.node_type = :trigger_type
                                  AND wn.category = 'trigger'
                            """), {
                                "tid": tenant_id,
                                "tid_json": json.dumps([tenant_id]),
                                "trigger_type": f"trigger_{event_type}",
                            })

                            workflows = wf_rows.mappings().all()

                            for wf_row in workflows:
                                wf = dict(wf_row)
                                # Load full workflow
                                full_wf = await _load_full_workflow(db, str(wf["id"]))
                                if full_wf:
                                    # Check trigger node filters
                                    trigger_nodes = [n for n in full_wf.get("_nodes", []) if n["node_type"] == f"trigger_{event_type}"]
                                    for trig_node in trigger_nodes:
                                        if _matches_trigger_filter(trig_node.get("config", {}), event_data):
                                            logger.info(f"Trigger matched: workflow {wf['id']} for event {event_type}")
                                            await run_workflow(db, full_wf, event_data, "system", event_data.get("incident_id"))

                            # Also check for paused workflows waiting for this event type
                            pending_res = await db.execute(text("""
                                SELECT * FROM public.workflow_pending_events
                                WHERE status = 'waiting' AND event_type = :etype AND tenant_id = :tid
                            """), {"etype": event_type, "tid": tenant_id})
                            for pending in pending_res.mappings().all():
                                pending_dict = dict(pending)
                                event_filter = pending_dict.get("event_filter") or {}
                                if isinstance(event_filter, str):
                                    event_filter = json.loads(event_filter)
                                if _matches_trigger_filter({"filters": event_filter}, event_data):
                                    logger.info(f"Wait-for-event matched: execution {pending_dict['execution_id']}")
                                    await db.execute(text("""
                                        UPDATE public.workflow_pending_events
                                        SET status = 'received', event_data = :data, resolved_at = NOW()
                                        WHERE id = :pid
                                    """), {"data": json.dumps(event_data, default=str), "pid": str(pending_dict["id"])})
                                    await _resume_workflow(db, str(pending_dict["execution_id"]), event_data)

                except Exception as e:
                    logger.warning(f"Error processing trigger event: {e}")

        except Exception as e:
            logger.error(f"Trigger evaluator error: {e}")
            await asyncio.sleep(10)


def _matches_trigger_filter(trigger_config: dict, event_data: dict) -> bool:
    """Check if event data matches trigger node's filter configuration."""
    filters = trigger_config.get("filters", {})
    if not filters:
        return True  # No filters = match all

    for key, expected in filters.items():
        if not expected:
            continue
        actual = str(event_data.get(key, "")).lower()
        expected_str = str(expected).lower()

        if "," in expected_str:
            # Multiple allowed values
            if actual not in [v.strip() for v in expected_str.split(",")]:
                return False
        elif actual != expected_str:
            return False

    return True


async def _load_full_workflow(db: AsyncSession, workflow_id: str) -> Optional[dict]:
    """Load a workflow with its nodes and edges."""
    wf_res = await db.execute(text("SELECT * FROM public.workflows WHERE id = :wid"), {"wid": workflow_id})
    wf = wf_res.mappings().first()
    if not wf:
        return None

    wf_dict = dict(wf)

    nodes_res = await db.execute(text("SELECT * FROM public.workflow_nodes WHERE workflow_id = :wid ORDER BY position_y, position_x"), {"wid": workflow_id})
    wf_dict["_nodes"] = [dict(n) for n in nodes_res.mappings().all()]

    edges_res = await db.execute(text("SELECT * FROM public.workflow_edges WHERE workflow_id = :wid"), {"wid": workflow_id})
    wf_dict["_edges"] = [dict(e) for e in edges_res.mappings().all()]

    return wf_dict


# ── Cron Evaluator (scheduled trigger execution) ──
async def cron_evaluator():
    """Check for scheduled workflows that need to run."""
    logger.info("Cron evaluator started — checking scheduled triggers every 30s")
    await asyncio.sleep(10)  # Initial delay

    while True:
        try:
            async with AsyncSessionLocal() as db:
                async with db.begin():
                    due = await db.execute(text("""
                        SELECT st.*, w.id as wf_id, w.status as wf_status
                        FROM public.workflow_scheduled_triggers st
                        JOIN public.workflows w ON w.id = st.workflow_id
                        WHERE st.enabled = TRUE AND st.next_run_at <= NOW()
                          AND w.status = 'active'
                        LIMIT 10
                    """))
                    for row in due.mappings().all():
                        row_dict = dict(row)
                        try:
                            wf = await _load_full_workflow(db, str(row_dict["wf_id"]))
                            if wf:
                                logger.info(f"Cron trigger: running workflow {row_dict['wf_id']}")
                                await run_workflow(db, wf, {"trigger": "scheduled", "cron": row_dict["cron_expression"]}, "scheduler")

                            # Calculate next run
                            from croniter import croniter
                            cron = croniter(row_dict["cron_expression"], datetime.now(timezone.utc))
                            next_run = cron.get_next(datetime)
                            await db.execute(text("""
                                UPDATE public.workflow_scheduled_triggers
                                SET next_run_at = :next, last_run_at = NOW()
                                WHERE id = :sid
                            """), {"next": next_run, "sid": str(row_dict["id"])})
                        except Exception as e:
                            logger.warning(f"Cron trigger failed for {row_dict.get('wf_id')}: {e}")

                    # Expire old approval gates and pending events
                    await db.execute(text("""
                        UPDATE public.workflow_approval_gates
                        SET status = 'expired', decided_at = NOW()
                        WHERE status = 'pending'
                          AND requested_at + (timeout_minutes || ' minutes')::interval < NOW()
                    """))
                    await db.execute(text("""
                        UPDATE public.workflow_pending_events
                        SET status = 'expired', resolved_at = NOW()
                        WHERE status = 'waiting'
                          AND created_at + (timeout_minutes || ' minutes')::interval < NOW()
                    """))

        except Exception as e:
            logger.error(f"Cron evaluator error: {e}")

        await asyncio.sleep(30)


# ── Lifespan ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    # Create tables
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.workflows (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id VARCHAR(100) NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT DEFAULT '',
                status VARCHAR(20) DEFAULT 'draft',
                version INT DEFAULT 1,
                canvas_data JSONB DEFAULT '{}',
                settings JSONB DEFAULT '{}',
                target_tenant_ids JSONB DEFAULT NULL,
                created_by VARCHAR(100),
                updated_by VARCHAR(100),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.workflow_nodes (
                id VARCHAR(100) NOT NULL,
                workflow_id UUID NOT NULL,
                node_type VARCHAR(100) NOT NULL,
                category VARCHAR(50) DEFAULT '',
                label VARCHAR(255) DEFAULT '',
                config JSONB DEFAULT '{}',
                position_x FLOAT DEFAULT 0,
                position_y FLOAT DEFAULT 0,
                error_handling VARCHAR(20) DEFAULT 'stop',
                retry_count INT DEFAULT 0,
                timeout_sec INT DEFAULT 30,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (workflow_id, id)
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.workflow_edges (
                id VARCHAR(100) NOT NULL,
                workflow_id UUID NOT NULL,
                source_node_id VARCHAR(100) NOT NULL,
                target_node_id VARCHAR(100) NOT NULL,
                condition JSONB,
                label VARCHAR(100) DEFAULT '',
                edge_type VARCHAR(20) DEFAULT 'default',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (workflow_id, id)
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.workflow_executions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                workflow_id UUID NOT NULL,
                workflow_version INT DEFAULT 1,
                tenant_id VARCHAR(100) NOT NULL,
                trigger_type VARCHAR(50) DEFAULT 'manual',
                trigger_data JSONB DEFAULT '{}',
                status VARCHAR(20) DEFAULT 'pending',
                started_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ,
                duration_ms INT,
                nodes_total INT DEFAULT 0,
                nodes_executed INT DEFAULT 0,
                nodes_failed INT DEFAULT 0,
                error_message TEXT,
                incident_id UUID,
                triggered_by VARCHAR(100) DEFAULT 'system',
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.execution_node_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                execution_id UUID NOT NULL,
                node_id VARCHAR(100),
                node_type VARCHAR(100),
                status VARCHAR(20),
                input_data JSONB,
                output_data JSONB,
                error_message TEXT,
                started_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ,
                duration_ms INT DEFAULT 0,
                retry_attempt INT DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.workflow_templates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                description TEXT DEFAULT '',
                category VARCHAR(50) DEFAULT '',
                workflow_data JSONB NOT NULL DEFAULT '{}',
                tags TEXT[] DEFAULT '{}',
                is_official BOOLEAN DEFAULT TRUE,
                usage_count INT DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.automation_credentials (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id VARCHAR(100) NOT NULL,
                name VARCHAR(255) NOT NULL,
                integration VARCHAR(100) NOT NULL,
                api_key TEXT NOT NULL,
                extra_config JSONB DEFAULT '{}',
                created_by VARCHAR(100),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        # Phase 3 tables
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.workflow_approval_gates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                execution_id UUID NOT NULL,
                node_id VARCHAR(100) NOT NULL,
                tenant_id VARCHAR(100) NOT NULL,
                message TEXT DEFAULT 'Approval required',
                approvers TEXT[] DEFAULT '{}',
                requested_by VARCHAR(100),
                requested_at TIMESTAMPTZ DEFAULT NOW(),
                status VARCHAR(20) DEFAULT 'pending',
                decided_by VARCHAR(100),
                decided_at TIMESTAMPTZ,
                decision_note TEXT,
                timeout_minutes INT DEFAULT 1440
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.workflow_pending_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                execution_id UUID NOT NULL,
                node_id VARCHAR(100) NOT NULL,
                tenant_id VARCHAR(100) NOT NULL,
                event_type VARCHAR(100) NOT NULL,
                event_filter JSONB DEFAULT '{}',
                status VARCHAR(20) DEFAULT 'waiting',
                timeout_minutes INT DEFAULT 1440,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                resolved_at TIMESTAMPTZ,
                event_data JSONB
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.workflow_webhook_triggers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                workflow_id UUID NOT NULL,
                tenant_id VARCHAR(100) NOT NULL,
                webhook_token VARCHAR(255) UNIQUE NOT NULL,
                description TEXT DEFAULT '',
                enabled BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.workflow_scheduled_triggers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                workflow_id UUID NOT NULL,
                tenant_id VARCHAR(100) NOT NULL,
                cron_expression VARCHAR(100) NOT NULL,
                timezone VARCHAR(50) DEFAULT 'UTC',
                next_run_at TIMESTAMPTZ,
                last_run_at TIMESTAMPTZ,
                enabled BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        # Add pause/resume columns to workflow_executions
        try:
            await conn.execute(text("ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS context_snapshot JSONB"))
            await conn.execute(text("ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS paused_at_node VARCHAR(100)"))
            await conn.execute(text("ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS visited_nodes TEXT[] DEFAULT '{}'"))
            await conn.execute(text("ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(20) DEFAULT 'automatic'"))
        except Exception:
            pass  # Columns may already exist

        # Add target_tenant_ids column for multi-tenant workflow targeting
        try:
            await conn.execute(text("ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS target_tenant_ids JSONB DEFAULT NULL"))
        except Exception:
            pass

    # Connect Redis
    try:
        redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
        await redis_client.ping()
        logger.info("Redis connected")
    except Exception as e:
        logger.warning(f"Redis connection failed: {e}")
        redis_client = None

    # Start trigger evaluator & cron evaluator
    asyncio.create_task(trigger_evaluator())
    asyncio.create_task(cron_evaluator())

    # Seed default templates
    asyncio.create_task(_seed_templates())

    yield

    if redis_client:
        await redis_client.close()


async def _seed_templates():
    """Insert default workflow templates if none exist."""
    await asyncio.sleep(3)  # Wait for tables
    try:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                # Get existing template names to avoid duplicates
                existing_res = await db.execute(text("SELECT name FROM public.workflow_templates"))
                existing_names = {r["name"] for r in existing_res.mappings().all()}

                templates = [
                    {
                        "name": "Auto-Triage Critical Incidents",
                        "description": "Automatically assigns critical incidents to the senior analyst team and adds an urgent tag.",
                        "category": "triage",
                        "tags": ["critical", "auto-assign", "triage"],
                        "workflow_data": json.dumps({
                            "nodes": [
                                {"id": "trigger_1", "node_type": "trigger_incident_created", "category": "trigger", "label": "Incident Created", "config": {"filters": {"severity": "critical"}}, "position_x": 250, "position_y": 50},
                                {"id": "tag_1", "node_type": "add_tags", "category": "soc_action", "label": "Add Urgent Tag", "config": {"tags": ["urgent", "auto-triaged"]}, "position_x": 250, "position_y": 200},
                                {"id": "comment_1", "node_type": "add_comment", "category": "soc_action", "label": "Add Triage Note", "config": {"comment": "Auto-triaged: Critical incident detected. Escalation priority applied."}, "position_x": 250, "position_y": 350},
                                {"id": "status_1", "node_type": "change_status", "category": "soc_action", "label": "Set to Triaging", "config": {"status": "triaging"}, "position_x": 250, "position_y": 500},
                            ],
                            "edges": [
                                {"id": "e1", "source_node_id": "trigger_1", "target_node_id": "tag_1"},
                                {"id": "e2", "source_node_id": "tag_1", "target_node_id": "comment_1"},
                                {"id": "e3", "source_node_id": "comment_1", "target_node_id": "status_1"},
                            ],
                        }),
                    },
                    {
                        "name": "Severity-Based Router",
                        "description": "Routes incidents to different actions based on severity level.",
                        "category": "routing",
                        "tags": ["routing", "severity", "conditional"],
                        "workflow_data": json.dumps({
                            "nodes": [
                                {"id": "trigger_1", "node_type": "trigger_incident_created", "category": "trigger", "label": "Incident Created", "config": {}, "position_x": 300, "position_y": 50},
                                {"id": "switch_1", "node_type": "if_condition", "category": "logic", "label": "Is Critical?", "config": {"field": "trigger_data.severity", "operator": "==", "value": "critical"}, "position_x": 300, "position_y": 200},
                                {"id": "comment_crit", "node_type": "add_comment", "category": "soc_action", "label": "Critical Alert", "config": {"comment": "CRITICAL: Immediate attention required. Auto-escalation initiated."}, "position_x": 100, "position_y": 400},
                                {"id": "comment_norm", "node_type": "add_comment", "category": "soc_action", "label": "Normal Queue", "config": {"comment": "Incident queued for standard processing."}, "position_x": 500, "position_y": 400},
                            ],
                            "edges": [
                                {"id": "e1", "source_node_id": "trigger_1", "target_node_id": "switch_1"},
                                {"id": "e2", "source_node_id": "switch_1", "target_node_id": "comment_crit", "condition": {"branch": "true"}},
                                {"id": "e3", "source_node_id": "switch_1", "target_node_id": "comment_norm", "condition": {"branch": "false"}},
                            ],
                        }),
                    },
                    {
                        "name": "New Incident Notification",
                        "description": "Logs and comments on every new incident as it comes in.",
                        "category": "notification",
                        "tags": ["notification", "logging", "simple"],
                        "workflow_data": json.dumps({
                            "nodes": [
                                {"id": "trigger_1", "node_type": "trigger_incident_created", "category": "trigger", "label": "Incident Created", "config": {}, "position_x": 250, "position_y": 50},
                                {"id": "var_1", "node_type": "set_variable", "category": "logic", "label": "Set Greeting", "config": {"variable_name": "greeting", "value": "New incident received: {{trigger_data.title}}"}, "position_x": 250, "position_y": 200},
                                {"id": "log_1", "node_type": "log", "category": "logic", "label": "Log Event", "config": {"message": "{{variables.greeting}} — Severity: {{trigger_data.severity}}"}, "position_x": 250, "position_y": 350},
                            ],
                            "edges": [
                                {"id": "e1", "source_node_id": "trigger_1", "target_node_id": "var_1"},
                                {"id": "e2", "source_node_id": "var_1", "target_node_id": "log_1"},
                            ],
                        }),
                    },
                    {
                        "name": "IOC Enrichment Pipeline",
                        "description": "Extracts IOCs from incident and enriches them via VirusTotal and GeoIP lookups.",
                        "category": "enrichment",
                        "tags": ["ioc", "virustotal", "geoip", "enrichment", "threat-intel"],
                        "workflow_data": json.dumps({
                            "nodes": [
                                {"id": "trigger_1", "node_type": "trigger_incident_created", "category": "trigger", "label": "Incident Created", "config": {"filters": {"severity": "critical,high"}}, "position_x": 300, "position_y": 50},
                                {"id": "extract_1", "node_type": "extract_iocs", "category": "data_transform", "label": "Extract IOCs", "config": {}, "position_x": 300, "position_y": 200},
                                {"id": "if_1", "node_type": "if_condition", "category": "logic", "label": "IOCs Found?", "config": {"field": "nodes.extract_iocs.output.total", "operator": ">", "value": "0"}, "position_x": 300, "position_y": 350},
                                {"id": "comment_1", "node_type": "add_comment", "category": "soc_action", "label": "Add IOC Summary", "config": {"comment": "Auto-extracted {{nodes.extract_iocs.output.total}} IOCs: {{nodes.extract_iocs.output.ips}} IPs, {{nodes.extract_iocs.output.domains}} domains, {{nodes.extract_iocs.output.hashes}} hashes"}, "position_x": 100, "position_y": 500},
                                {"id": "comment_none", "node_type": "add_comment", "category": "soc_action", "label": "No IOCs", "config": {"comment": "No IOCs automatically extracted from this incident."}, "position_x": 500, "position_y": 500},
                            ],
                            "edges": [
                                {"id": "e1", "source_node_id": "trigger_1", "target_node_id": "extract_1"},
                                {"id": "e2", "source_node_id": "extract_1", "target_node_id": "if_1"},
                                {"id": "e3", "source_node_id": "if_1", "target_node_id": "comment_1", "condition": {"branch": "true"}},
                                {"id": "e4", "source_node_id": "if_1", "target_node_id": "comment_none", "condition": {"branch": "false"}},
                            ],
                        }),
                    },
                    {
                        "name": "Auto-Close False Positives",
                        "description": "Automatically resolves incidents tagged as false positive after a waiting period.",
                        "category": "response",
                        "tags": ["false-positive", "auto-close", "response"],
                        "workflow_data": json.dumps({
                            "nodes": [
                                {"id": "trigger_1", "node_type": "trigger_status_changed", "category": "trigger", "label": "Status Changed", "config": {"filters": {"to_status": "false_positive"}}, "position_x": 300, "position_y": 50},
                                {"id": "delay_1", "node_type": "delay", "category": "logic", "label": "Wait 60 Seconds", "config": {"seconds": 60}, "position_x": 300, "position_y": 200},
                                {"id": "close_1", "node_type": "close_incident", "category": "incident_ops", "label": "Close Incident", "config": {"resolution_note": "Auto-closed: Confirmed false positive."}, "position_x": 300, "position_y": 350},
                            ],
                            "edges": [
                                {"id": "e1", "source_node_id": "trigger_1", "target_node_id": "delay_1"},
                                {"id": "e2", "source_node_id": "delay_1", "target_node_id": "close_1"},
                            ],
                        }),
                    },
                    {
                        "name": "IP Reputation Check",
                        "description": "Checks an IP against AbuseIPDB and GeoIP, then comments results on the incident.",
                        "category": "enrichment",
                        "tags": ["abuseipdb", "geoip", "ip", "enrichment"],
                        "workflow_data": json.dumps({
                            "nodes": [
                                {"id": "trigger_1", "node_type": "trigger_manual", "category": "trigger", "label": "Manual Trigger", "config": {}, "position_x": 300, "position_y": 50},
                                {"id": "extract_1", "node_type": "extract_iocs", "category": "data_transform", "label": "Extract IPs", "config": {}, "position_x": 300, "position_y": 200},
                                {"id": "geoip_1", "node_type": "geoip_lookup", "category": "enrichment", "label": "GeoIP Lookup", "config": {"ip_address": "{{variables.iocs.0.value}}"}, "position_x": 150, "position_y": 370},
                                {"id": "abuse_1", "node_type": "abuseipdb_check", "category": "enrichment", "label": "AbuseIPDB Check", "config": {"ip_address": "{{variables.iocs.0.value}}"}, "position_x": 450, "position_y": 370},
                                {"id": "comment_1", "node_type": "add_comment", "category": "soc_action", "label": "Add Enrichment Note", "config": {"comment": "IP Enrichment: GeoIP={{nodes.geoip_lookup.output.country}}, Abuse Score={{nodes.abuseipdb_check.output.abuse_score}}"}, "position_x": 300, "position_y": 540},
                            ],
                            "edges": [
                                {"id": "e1", "source_node_id": "trigger_1", "target_node_id": "extract_1"},
                                {"id": "e2", "source_node_id": "extract_1", "target_node_id": "geoip_1"},
                                {"id": "e3", "source_node_id": "extract_1", "target_node_id": "abuse_1"},
                                {"id": "e4", "source_node_id": "geoip_1", "target_node_id": "comment_1"},
                                {"id": "e5", "source_node_id": "abuse_1", "target_node_id": "comment_1"},
                            ],
                        }),
                    },
                    {
                        "name": "Phishing Response Playbook",
                        "description": "Full phishing incident response: extract IOCs, enrich via VirusTotal, check maliciousness, update incident accordingly.",
                        "category": "response",
                        "tags": ["phishing", "response", "enrichment", "playbook"],
                        "workflow_data": json.dumps({
                            "nodes": [
                                {"id": "trigger_1", "node_type": "trigger_incident_created", "category": "trigger", "label": "Incident Created", "config": {"filters": {}}, "position_x": 300, "position_y": 50},
                                {"id": "extract_1", "node_type": "extract_iocs", "category": "data_transform", "label": "Extract IOCs", "config": {}, "position_x": 300, "position_y": 200},
                                {"id": "if_1", "node_type": "if_condition", "category": "logic", "label": "IOCs Found?", "config": {"field": "nodes.extract_iocs.output.total", "operator": ">", "value": "0"}, "position_x": 300, "position_y": 350},
                                {"id": "tag_1", "node_type": "add_tags", "category": "soc_action", "label": "Tag as Phishing", "config": {"tags": ["phishing", "ioc-extracted"]}, "position_x": 100, "position_y": 500},
                                {"id": "comment_1", "node_type": "add_comment", "category": "soc_action", "label": "Add IOC Summary", "config": {"comment": "Phishing analysis: Found {{nodes.extract_iocs.output.total}} IOCs — IPs: {{nodes.extract_iocs.output.ips}}, URLs: {{nodes.extract_iocs.output.urls}}, Domains: {{nodes.extract_iocs.output.domains}}"}, "position_x": 100, "position_y": 650},
                                {"id": "status_1", "node_type": "change_status", "category": "soc_action", "label": "Set Triaging", "config": {"status": "triaging"}, "position_x": 100, "position_y": 800},
                                {"id": "comment_none", "node_type": "add_comment", "category": "soc_action", "label": "No IOCs Found", "config": {"comment": "No IOCs extracted from this incident. Manual analysis required."}, "position_x": 500, "position_y": 500},
                            ],
                            "edges": [
                                {"id": "e1", "source_node_id": "trigger_1", "target_node_id": "extract_1"},
                                {"id": "e2", "source_node_id": "extract_1", "target_node_id": "if_1"},
                                {"id": "e3", "source_node_id": "if_1", "target_node_id": "tag_1", "condition": {"branch": "true"}},
                                {"id": "e4", "source_node_id": "tag_1", "target_node_id": "comment_1"},
                                {"id": "e5", "source_node_id": "comment_1", "target_node_id": "status_1"},
                                {"id": "e6", "source_node_id": "if_1", "target_node_id": "comment_none", "condition": {"branch": "false"}},
                            ],
                        }),
                    },
                    {
                        "name": "Brute Force Response",
                        "description": "Detects brute force incidents, extracts source IP, checks reputation, escalates if abuse score is high.",
                        "category": "response",
                        "tags": ["brute-force", "abuseipdb", "response", "playbook"],
                        "workflow_data": json.dumps({
                            "nodes": [
                                {"id": "trigger_1", "node_type": "trigger_incident_created", "category": "trigger", "label": "Incident Created", "config": {"filters": {}}, "position_x": 300, "position_y": 50},
                                {"id": "extract_1", "node_type": "extract_iocs", "category": "data_transform", "label": "Extract IPs", "config": {}, "position_x": 300, "position_y": 200},
                                {"id": "geoip_1", "node_type": "geoip_lookup", "category": "enrichment", "label": "GeoIP Lookup", "config": {"ip_address": "{{variables.iocs.0.value}}"}, "position_x": 300, "position_y": 370},
                                {"id": "comment_1", "node_type": "add_comment", "category": "soc_action", "label": "Add Geo Info", "config": {"comment": "Brute Force Source: IP={{variables.iocs.0.value}}, Country={{nodes.geoip_lookup.output.country}}, ISP={{nodes.geoip_lookup.output.isp}}"}, "position_x": 300, "position_y": 540},
                                {"id": "tag_1", "node_type": "add_tags", "category": "soc_action", "label": "Tag Brute Force", "config": {"tags": ["brute-force", "auto-enriched"]}, "position_x": 300, "position_y": 700},
                                {"id": "status_1", "node_type": "change_status", "category": "soc_action", "label": "Set Triaging", "config": {"status": "triaging"}, "position_x": 300, "position_y": 850},
                            ],
                            "edges": [
                                {"id": "e1", "source_node_id": "trigger_1", "target_node_id": "extract_1"},
                                {"id": "e2", "source_node_id": "extract_1", "target_node_id": "geoip_1"},
                                {"id": "e3", "source_node_id": "geoip_1", "target_node_id": "comment_1"},
                                {"id": "e4", "source_node_id": "comment_1", "target_node_id": "tag_1"},
                                {"id": "e5", "source_node_id": "tag_1", "target_node_id": "status_1"},
                            ],
                        }),
                    },
                    {
                        "name": "SLA Escalation Workflow",
                        "description": "Monitors SLA approaching thresholds, notifies analyst, waits for response, and escalates if needed.",
                        "category": "sla",
                        "tags": ["sla", "escalation", "notification", "playbook"],
                        "workflow_data": json.dumps({
                            "nodes": [
                                {"id": "trigger_1", "node_type": "trigger_sla_approaching", "category": "trigger", "label": "SLA Approaching", "config": {"filters": {"threshold_pct": 75}}, "position_x": 300, "position_y": 50},
                                {"id": "comment_1", "node_type": "add_comment", "category": "soc_action", "label": "SLA Warning", "config": {"comment": "⚠️ SLA approaching breach threshold (75%). Please respond soon."}, "position_x": 300, "position_y": 200},
                                {"id": "tag_1", "node_type": "add_tags", "category": "soc_action", "label": "Tag SLA Warning", "config": {"tags": ["sla-warning"]}, "position_x": 300, "position_y": 350},
                                {"id": "delay_1", "node_type": "delay", "category": "logic", "label": "Wait 15 min", "config": {"seconds": 300}, "position_x": 300, "position_y": 500},
                                {"id": "escalate_1", "node_type": "escalate_incident", "category": "soc_action", "label": "Escalate", "config": {"reason": "SLA approaching breach — auto-escalation triggered"}, "position_x": 300, "position_y": 650},
                            ],
                            "edges": [
                                {"id": "e1", "source_node_id": "trigger_1", "target_node_id": "comment_1"},
                                {"id": "e2", "source_node_id": "comment_1", "target_node_id": "tag_1"},
                                {"id": "e3", "source_node_id": "tag_1", "target_node_id": "delay_1"},
                                {"id": "e4", "source_node_id": "delay_1", "target_node_id": "escalate_1"},
                            ],
                        }),
                    },
                ]

                new_templates = [t for t in templates if t["name"] not in existing_names]
                for t in new_templates:
                    await db.execute(text("""
                        INSERT INTO public.workflow_templates (name, description, category, tags, workflow_data, is_official)
                        VALUES (:name, :desc, :cat, :tags, :wd, TRUE)
                    """), {
                        "name": t["name"],
                        "desc": t["description"],
                        "cat": t["category"],
                        "tags": t["tags"],
                        "wd": t["workflow_data"],
                    })

                if new_templates:
                    logger.info(f"Seeded {len(new_templates)} new workflow templates")

    except Exception as e:
        logger.warning(f"Template seeding failed: {e}")


# ── FastAPI App ──
app = FastAPI(title="Central SOC — Automation Service", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "automation-service"}


# ──────────────────────────────────────────────────────────────
#   WORKFLOW CRUD
# ──────────────────────────────────────────────────────────────

@app.get("/automations/workflows")
async def list_workflows(request: Request, tenant_id: str = Query(None), status: str = Query(None)):
    user = get_user(request)
    tid = tenant_id or user.get("tenant_id")

    async with AsyncSessionLocal() as db:
        where = "WHERE 1=1"
        params = {}
        # Super admins see all workflows; others filter by tenant
        if tid and tid != "global":
            where += " AND w.tenant_id = :tid"
            params["tid"] = tid
        elif user.get("role") != "super_admin":
            if tid:
                where += " AND w.tenant_id = :tid"
                params["tid"] = tid
        if status:
            where += " AND w.status = :status"
            params["status"] = status

        res = await db.execute(text(f"""
            SELECT w.*,
                   (SELECT COUNT(*) FROM public.workflow_nodes wn WHERE wn.workflow_id = w.id) as node_count,
                   (SELECT COUNT(*) FROM public.workflow_executions we WHERE we.workflow_id = w.id) as execution_count,
                   (SELECT we2.status FROM public.workflow_executions we2 WHERE we2.workflow_id = w.id ORDER BY we2.created_at DESC LIMIT 1) as last_run_status
            FROM public.workflows w
            {where}
            ORDER BY w.updated_at DESC
        """), params)
        rows = res.mappings().all()
        workflows = []
        for r in rows:
            d = dict(r)
            for k, v in d.items():
                if isinstance(v, datetime):
                    d[k] = v.isoformat()
            workflows.append(d)
        return {"workflows": workflows}


@app.post("/automations/workflows", status_code=201)
async def create_workflow(request: Request, body: WorkflowCreate):
    user = get_user(request)
    tid = user.get("tenant_id")
    if not tid:
        raise HTTPException(400, "tenant_id required")

    wf_id = str(uuid.uuid4())

    async with AsyncSessionLocal() as db:
        async with db.begin():
            await db.execute(text("""
                INSERT INTO public.workflows (id, tenant_id, name, description, canvas_data, settings, target_tenant_ids, created_by, updated_by)
                VALUES (:id, :tid, :name, :desc, :canvas, :settings, :target_tids, :by, :by)
            """), {
                "id": wf_id,
                "tid": tid,
                "name": body.name,
                "desc": body.description,
                "canvas": json.dumps(body.canvas_data),
                "settings": json.dumps(body.settings),
                "target_tids": json.dumps(body.target_tenant_ids) if body.target_tenant_ids else None,
                "by": user.get("sub", ""),
            })

            # Insert nodes
            for node in body.nodes:
                await db.execute(text("""
                    INSERT INTO public.workflow_nodes (id, workflow_id, node_type, category, label, config, position_x, position_y, error_handling, retry_count, timeout_sec)
                    VALUES (:id, :wid, :ntype, :cat, :label, :config, :px, :py, :eh, :rc, :ts)
                """), {
                    "id": node.id,
                    "wid": wf_id,
                    "ntype": node.node_type,
                    "cat": node.category,
                    "label": node.label,
                    "config": json.dumps(node.config),
                    "px": node.position_x,
                    "py": node.position_y,
                    "eh": node.error_handling,
                    "rc": node.retry_count,
                    "ts": node.timeout_sec,
                })

            # Insert edges
            for edge in body.edges:
                await db.execute(text("""
                    INSERT INTO public.workflow_edges (id, workflow_id, source_node_id, target_node_id, condition, label, edge_type)
                    VALUES (:id, :wid, :src, :tgt, :cond, :label, 'default')
                """), {
                    "id": edge.id,
                    "wid": wf_id,
                    "src": edge.source_node_id,
                    "tgt": edge.target_node_id,
                    "cond": json.dumps(edge.condition) if edge.condition else None,
                    "label": edge.label,
                })

    return {"id": wf_id, "name": body.name, "status": "draft"}


@app.get("/automations/workflows/{workflow_id}")
async def get_workflow(request: Request, workflow_id: str):
    async with AsyncSessionLocal() as db:
        wf_res = await db.execute(text("SELECT * FROM public.workflows WHERE id = :wid"), {"wid": workflow_id})
        wf = wf_res.mappings().first()
        if not wf:
            raise HTTPException(404, "Workflow not found")

        wf_dict = dict(wf)

        nodes_res = await db.execute(text("SELECT * FROM public.workflow_nodes WHERE workflow_id = :wid"), {"wid": workflow_id})
        wf_dict["nodes"] = [dict(n) for n in nodes_res.mappings().all()]

        edges_res = await db.execute(text("SELECT * FROM public.workflow_edges WHERE workflow_id = :wid"), {"wid": workflow_id})
        wf_dict["edges"] = [dict(e) for e in edges_res.mappings().all()]

        # Serialize datetimes
        for k, v in wf_dict.items():
            if isinstance(v, datetime):
                wf_dict[k] = v.isoformat()
        for n in wf_dict["nodes"]:
            for k, v in n.items():
                if isinstance(v, datetime):
                    n[k] = v.isoformat()
        for e in wf_dict["edges"]:
            for k, v in e.items():
                if isinstance(v, datetime):
                    e[k] = v.isoformat()

        return wf_dict


@app.put("/automations/workflows/{workflow_id}")
async def update_workflow(request: Request, workflow_id: str, body: WorkflowUpdate):
    user = get_user(request)

    async with AsyncSessionLocal() as db:
        async with db.begin():
            # Verify exists
            wf_res = await db.execute(text("SELECT id FROM public.workflows WHERE id = :wid"), {"wid": workflow_id})
            if not wf_res.mappings().first():
                raise HTTPException(404, "Workflow not found")

            # Update workflow fields
            updates = ["updated_at = NOW()", "updated_by = :by"]
            params = {"wid": workflow_id, "by": user.get("sub", "")}
            if body.name is not None:
                updates.append("name = :name")
                params["name"] = body.name
            if body.description is not None:
                updates.append("description = :desc")
                params["desc"] = body.description
            if body.canvas_data is not None:
                updates.append("canvas_data = :canvas")
                params["canvas"] = json.dumps(body.canvas_data)
            if body.settings is not None:
                updates.append("settings = :settings")
                params["settings"] = json.dumps(body.settings)
            if body.target_tenant_ids is not None:
                updates.append("target_tenant_ids = :target_tids")
                params["target_tids"] = json.dumps(body.target_tenant_ids)

            await db.execute(text(f"UPDATE public.workflows SET {', '.join(updates)} WHERE id = :wid"), params)

            # Replace nodes if provided
            if body.nodes is not None:
                await db.execute(text("DELETE FROM public.workflow_nodes WHERE workflow_id = :wid"), {"wid": workflow_id})
                for node in body.nodes:
                    await db.execute(text("""
                        INSERT INTO public.workflow_nodes (id, workflow_id, node_type, category, label, config, position_x, position_y, error_handling, retry_count, timeout_sec)
                        VALUES (:id, :wid, :ntype, :cat, :label, :config, :px, :py, :eh, :rc, :ts)
                    """), {
                        "id": node.id,
                        "wid": workflow_id,
                        "ntype": node.node_type,
                        "cat": node.category,
                        "label": node.label,
                        "config": json.dumps(node.config),
                        "px": node.position_x,
                        "py": node.position_y,
                        "eh": node.error_handling,
                        "rc": node.retry_count,
                        "ts": node.timeout_sec,
                    })

            # Replace edges if provided
            if body.edges is not None:
                await db.execute(text("DELETE FROM public.workflow_edges WHERE workflow_id = :wid"), {"wid": workflow_id})
                for edge in body.edges:
                    await db.execute(text("""
                        INSERT INTO public.workflow_edges (id, workflow_id, source_node_id, target_node_id, condition, label, edge_type)
                        VALUES (:id, :wid, :src, :tgt, :cond, :label, 'default')
                    """), {
                        "id": edge.id,
                        "wid": workflow_id,
                        "src": edge.source_node_id,
                        "tgt": edge.target_node_id,
                        "cond": json.dumps(edge.condition) if edge.condition else None,
                        "label": edge.label,
                    })

    return {"id": workflow_id, "updated": True}


@app.delete("/automations/workflows/{workflow_id}")
async def delete_workflow(request: Request, workflow_id: str):
    async with AsyncSessionLocal() as db:
        async with db.begin():
            await db.execute(text("DELETE FROM public.workflow_edges WHERE workflow_id = :wid"), {"wid": workflow_id})
            await db.execute(text("DELETE FROM public.workflow_nodes WHERE workflow_id = :wid"), {"wid": workflow_id})
            await db.execute(text("UPDATE public.workflows SET status = 'archived' WHERE id = :wid"), {"wid": workflow_id})
    return {"deleted": True}


@app.post("/automations/workflows/{workflow_id}/publish")
async def publish_workflow(request: Request, workflow_id: str):
    async with AsyncSessionLocal() as db:
        async with db.begin():
            await db.execute(text("UPDATE public.workflows SET status = 'active', updated_at = NOW() WHERE id = :wid"), {"wid": workflow_id})
    return {"id": workflow_id, "status": "active"}


@app.post("/automations/workflows/{workflow_id}/pause")
async def pause_workflow(request: Request, workflow_id: str):
    async with AsyncSessionLocal() as db:
        async with db.begin():
            await db.execute(text("UPDATE public.workflows SET status = 'paused', updated_at = NOW() WHERE id = :wid"), {"wid": workflow_id})
    return {"id": workflow_id, "status": "paused"}


@app.post("/automations/workflows/{workflow_id}/clone")
async def clone_workflow(request: Request, workflow_id: str):
    user = get_user(request)
    async with AsyncSessionLocal() as db:
        async with db.begin():
            wf = await _load_full_workflow(db, workflow_id)
            if not wf:
                raise HTTPException(404, "Workflow not found")

            new_id = str(uuid.uuid4())
            await db.execute(text("""
                INSERT INTO public.workflows (id, tenant_id, name, description, canvas_data, settings, created_by, updated_by, status)
                VALUES (:id, :tid, :name, :desc, :canvas, :settings, :by, :by, 'draft')
            """), {
                "id": new_id,
                "tid": wf["tenant_id"],
                "name": f"{wf['name']} (Copy)",
                "desc": wf.get("description", ""),
                "canvas": json.dumps(wf.get("canvas_data") or {}),
                "settings": json.dumps(wf.get("settings") or {}),
                "by": user.get("sub", ""),
            })

            for node in wf.get("_nodes", []):
                await db.execute(text("""
                    INSERT INTO public.workflow_nodes (id, workflow_id, node_type, category, label, config, position_x, position_y, error_handling, retry_count, timeout_sec)
                    VALUES (:id, :wid, :ntype, :cat, :label, :config, :px, :py, :eh, :rc, :ts)
                """), {
                    "id": node["id"],
                    "wid": new_id,
                    "ntype": node["node_type"],
                    "cat": node.get("category", ""),
                    "label": node.get("label", ""),
                    "config": json.dumps(node.get("config") or {}),
                    "px": node.get("position_x", 0),
                    "py": node.get("position_y", 0),
                    "eh": node.get("error_handling", "stop"),
                    "rc": node.get("retry_count", 0),
                    "ts": node.get("timeout_sec", 30),
                })

            for edge in wf.get("_edges", []):
                await db.execute(text("""
                    INSERT INTO public.workflow_edges (id, workflow_id, source_node_id, target_node_id, condition, label, edge_type)
                    VALUES (:id, :wid, :src, :tgt, :cond, :label, 'default')
                """), {
                    "id": str(uuid.uuid4())[:8],
                    "wid": new_id,
                    "src": edge["source_node_id"],
                    "tgt": edge["target_node_id"],
                    "cond": json.dumps(edge.get("condition")) if edge.get("condition") else None,
                    "label": edge.get("label", ""),
                })

    return {"id": new_id, "name": f"{wf['name']} (Copy)", "status": "draft"}


# ──────────────────────────────────────────────────────────────
#   EXECUTION
# ──────────────────────────────────────────────────────────────

@app.post("/automations/workflows/{workflow_id}/execute")
async def manual_execute(request: Request, workflow_id: str, body: ManualTriggerInput):
    user = get_user(request)

    async with AsyncSessionLocal() as db:
        async with db.begin():
            wf = await _load_full_workflow(db, workflow_id)
            if not wf:
                raise HTTPException(404, "Workflow not found")

            trigger_data = body.input_data
            if body.incident_id:
                # Fetch incident data as trigger context
                try:
                    async with httpx.AsyncClient(timeout=10) as client:
                        resp = await client.get(
                            f"{settings.incident_service_url}/incidents/{body.incident_id}",
                            headers={"X-User-ID": user.get("sub", ""), "X-User-Role": user.get("role", ""), "X-Tenant-ID": user.get("tenant_id", "")},
                        )
                        if resp.status_code == 200:
                            trigger_data = {**trigger_data, **resp.json()}
                except:
                    pass

            result = await run_workflow(db, wf, trigger_data, user.get("sub", "manual"), body.incident_id, dry_run=body.dry_run)

    return result


@app.get("/automations/executions")
async def list_executions(request: Request, workflow_id: str = Query(None), tenant_id: str = Query(None), limit: int = Query(50)):
    user = get_user(request)
    tid = tenant_id or user.get("tenant_id")

    async with AsyncSessionLocal() as db:
        where = "WHERE 1=1"
        params: dict = {"limit": limit}
        if tid:
            where += " AND we.tenant_id = :tid"
            params["tid"] = tid
        if workflow_id:
            where += " AND we.workflow_id = :wid"
            params["wid"] = workflow_id

        res = await db.execute(text(f"""
            SELECT we.*, w.name as workflow_name
            FROM public.workflow_executions we
            LEFT JOIN public.workflows w ON w.id = we.workflow_id
            {where}
            ORDER BY we.created_at DESC
            LIMIT :limit
        """), params)

        executions = []
        for r in res.mappings().all():
            d = dict(r)
            for k, v in d.items():
                if isinstance(v, datetime):
                    d[k] = v.isoformat()
            executions.append(d)
        return {"executions": executions}


@app.get("/automations/executions/{execution_id}")
async def get_execution(request: Request, execution_id: str):
    async with AsyncSessionLocal() as db:
        exe_res = await db.execute(text("""
            SELECT we.*, w.name as workflow_name
            FROM public.workflow_executions we
            LEFT JOIN public.workflows w ON w.id = we.workflow_id
            WHERE we.id = :eid
        """), {"eid": execution_id})
        exe = exe_res.mappings().first()
        if not exe:
            raise HTTPException(404, "Execution not found")

        exe_dict = dict(exe)

        # Get node logs
        logs_res = await db.execute(text("""
            SELECT * FROM public.execution_node_logs
            WHERE execution_id = :eid
            ORDER BY started_at ASC
        """), {"eid": execution_id})
        exe_dict["node_logs"] = [dict(l) for l in logs_res.mappings().all()]

        # Serialize
        for k, v in exe_dict.items():
            if isinstance(v, datetime):
                exe_dict[k] = v.isoformat()
        for l in exe_dict["node_logs"]:
            for k, v in l.items():
                if isinstance(v, datetime):
                    l[k] = v.isoformat()

        return exe_dict


# ──────────────────────────────────────────────────────────────
#   TEMPLATES
# ──────────────────────────────────────────────────────────────

@app.get("/automations/templates")
async def list_templates(request: Request, category: str = Query(None)):
    async with AsyncSessionLocal() as db:
        where = ""
        params = {}
        if category:
            where = "WHERE category = :cat"
            params["cat"] = category

        res = await db.execute(text(f"SELECT * FROM public.workflow_templates {where} ORDER BY usage_count DESC"), params)
        templates = []
        for r in res.mappings().all():
            d = dict(r)
            for k, v in d.items():
                if isinstance(v, datetime):
                    d[k] = v.isoformat()
            templates.append(d)
        return {"templates": templates}


@app.get("/automations/templates/{template_id}")
async def get_template(request: Request, template_id: str):
    async with AsyncSessionLocal() as db:
        res = await db.execute(text("SELECT * FROM public.workflow_templates WHERE id = :tid"), {"tid": template_id})
        t = res.mappings().first()
        if not t:
            raise HTTPException(404, "Template not found")
        d = dict(t)
        for k, v in d.items():
            if isinstance(v, datetime):
                d[k] = v.isoformat()
        return d


@app.post("/automations/templates/{template_id}/use")
async def use_template(request: Request, template_id: str):
    user = get_user(request)
    tid = user.get("tenant_id")
    if not tid:
        raise HTTPException(400, "tenant_id required")

    async with AsyncSessionLocal() as db:
        async with db.begin():
            res = await db.execute(text("SELECT * FROM public.workflow_templates WHERE id = :tid"), {"tid": template_id})
            t = res.mappings().first()
            if not t:
                raise HTTPException(404, "Template not found")

            t_dict = dict(t)
            wf_data = t_dict.get("workflow_data") or {}
            if isinstance(wf_data, str):
                wf_data = json.loads(wf_data)

            wf_id = str(uuid.uuid4())
            await db.execute(text("""
                INSERT INTO public.workflows (id, tenant_id, name, description, created_by, updated_by, status)
                VALUES (:id, :tid, :name, :desc, :by, :by, 'draft')
            """), {
                "id": wf_id,
                "tid": tid,
                "name": t_dict["name"],
                "desc": t_dict.get("description", ""),
                "by": user.get("sub", ""),
            })

            for node in wf_data.get("nodes", []):
                await db.execute(text("""
                    INSERT INTO public.workflow_nodes (id, workflow_id, node_type, category, label, config, position_x, position_y)
                    VALUES (:id, :wid, :ntype, :cat, :label, :config, :px, :py)
                """), {
                    "id": node["id"],
                    "wid": wf_id,
                    "ntype": node["node_type"],
                    "cat": node.get("category", ""),
                    "label": node.get("label", ""),
                    "config": json.dumps(node.get("config", {})),
                    "px": node.get("position_x", 0),
                    "py": node.get("position_y", 0),
                })

            for edge in wf_data.get("edges", []):
                await db.execute(text("""
                    INSERT INTO public.workflow_edges (id, workflow_id, source_node_id, target_node_id, condition, label)
                    VALUES (:id, :wid, :src, :tgt, :cond, :label)
                """), {
                    "id": edge["id"],
                    "wid": wf_id,
                    "src": edge["source_node_id"],
                    "tgt": edge["target_node_id"],
                    "cond": json.dumps(edge.get("condition")) if edge.get("condition") else None,
                    "label": edge.get("label", ""),
                })

            # Increment usage count
            await db.execute(text("UPDATE public.workflow_templates SET usage_count = usage_count + 1 WHERE id = :tid"), {"tid": template_id})

    return {"id": wf_id, "name": t_dict["name"], "status": "draft"}


# ──────────────────────────────────────────────────────────────
#   CREDENTIALS MANAGEMENT
# ──────────────────────────────────────────────────────────────

class CredentialCreate(BaseModel):
    name: str
    integration: str
    api_key: str
    extra_config: dict = {}


class CredentialUpdate(BaseModel):
    name: Optional[str] = None
    integration: Optional[str] = None
    api_key: Optional[str] = None
    extra_config: Optional[dict] = None


@app.get("/automations/credentials")
async def list_credentials(request: Request, tenant_id: str = Query(None)):
    user = get_user(request)
    tid = tenant_id or user.get("tenant_id")
    if not tid:
        raise HTTPException(400, "tenant_id required")

    async with AsyncSessionLocal() as db:
        res = await db.execute(text("""
            SELECT id, tenant_id, name, integration, extra_config, created_by, created_at, updated_at
            FROM public.automation_credentials
            WHERE tenant_id = :tid
            ORDER BY created_at DESC
        """), {"tid": tid})
        creds = []
        for r in res.mappings().all():
            d = dict(r)
            d["api_key_preview"] = "••••••••"  # Never expose full key
            for k, v in d.items():
                if isinstance(v, datetime):
                    d[k] = v.isoformat()
            creds.append(d)
        return {"credentials": creds}


@app.post("/automations/credentials", status_code=201)
async def create_credential(request: Request, body: CredentialCreate):
    user = get_user(request)
    tid = user.get("tenant_id")
    if not tid:
        raise HTTPException(400, "tenant_id required")

    cred_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        async with db.begin():
            await db.execute(text("""
                INSERT INTO public.automation_credentials (id, tenant_id, name, integration, api_key, extra_config, created_by)
                VALUES (:id, :tid, :name, :integ, :key, :extra, :by)
            """), {
                "id": cred_id,
                "tid": tid,
                "name": body.name,
                "integ": body.integration,
                "key": body.api_key,
                "extra": json.dumps(body.extra_config),
                "by": user.get("sub", ""),
            })

    return {"id": cred_id, "name": body.name, "integration": body.integration}


@app.put("/automations/credentials/{credential_id}")
async def update_credential(request: Request, credential_id: str, body: CredentialUpdate):
    user = get_user(request)
    tid = user.get("tenant_id")

    async with AsyncSessionLocal() as db:
        async with db.begin():
            existing = await db.execute(text(
                "SELECT id FROM public.automation_credentials WHERE id = :cid AND tenant_id = :tid"
            ), {"cid": credential_id, "tid": tid})
            if not existing.mappings().first():
                raise HTTPException(404, "Credential not found")

            updates = ["updated_at = NOW()"]
            params = {"cid": credential_id, "tid": tid}
            if body.name is not None:
                updates.append("name = :name")
                params["name"] = body.name
            if body.integration is not None:
                updates.append("integration = :integ")
                params["integ"] = body.integration
            if body.api_key is not None:
                updates.append("api_key = :key")
                params["key"] = body.api_key
            if body.extra_config is not None:
                updates.append("extra_config = :extra")
                params["extra"] = json.dumps(body.extra_config)

            await db.execute(text(
                f"UPDATE public.automation_credentials SET {', '.join(updates)} WHERE id = :cid AND tenant_id = :tid"
            ), params)

    return {"id": credential_id, "updated": True}


@app.delete("/automations/credentials/{credential_id}")
async def delete_credential(request: Request, credential_id: str):
    user = get_user(request)
    tid = user.get("tenant_id")

    async with AsyncSessionLocal() as db:
        async with db.begin():
            await db.execute(text(
                "DELETE FROM public.automation_credentials WHERE id = :cid AND tenant_id = :tid"
            ), {"cid": credential_id, "tid": tid})

    return {"deleted": True}


# ──────────────────────────────────────────────────────────────
#   APPROVAL GATES
# ──────────────────────────────────────────────────────────────

@app.get("/automations/approvals")
async def list_approvals(request: Request, tenant_id: str = Query(None), status: str = Query("pending")):
    user = get_user(request)
    tid = tenant_id or user.get("tenant_id")

    async with AsyncSessionLocal() as db:
        where = "WHERE 1=1"
        params: dict = {}
        if tid:
            where += " AND ag.tenant_id = :tid"
            params["tid"] = tid
        if status:
            where += " AND ag.status = :status"
            params["status"] = status

        res = await db.execute(text(f"""
            SELECT ag.*, we.workflow_id, w.name as workflow_name
            FROM public.workflow_approval_gates ag
            LEFT JOIN public.workflow_executions we ON we.id = ag.execution_id
            LEFT JOIN public.workflows w ON w.id = we.workflow_id
            {where}
            ORDER BY ag.requested_at DESC
            LIMIT 100
        """), params)
        approvals = []
        for r in res.mappings().all():
            d = dict(r)
            for k, v in d.items():
                if isinstance(v, datetime):
                    d[k] = v.isoformat()
            approvals.append(d)
        return {"approvals": approvals}


@app.get("/automations/approvals/{gate_id}")
async def get_approval(request: Request, gate_id: str):
    async with AsyncSessionLocal() as db:
        res = await db.execute(text("""
            SELECT ag.*, we.workflow_id, w.name as workflow_name
            FROM public.workflow_approval_gates ag
            LEFT JOIN public.workflow_executions we ON we.id = ag.execution_id
            LEFT JOIN public.workflows w ON w.id = we.workflow_id
            WHERE ag.id = :gid
        """), {"gid": gate_id})
        gate = res.mappings().first()
        if not gate:
            raise HTTPException(404, "Approval gate not found")
        d = dict(gate)
        for k, v in d.items():
            if isinstance(v, datetime):
                d[k] = v.isoformat()
        return d


class ApprovalDecision(BaseModel):
    decision: str  # "approved" or "rejected"
    note: str = ""


@app.post("/automations/approvals/{gate_id}/decide")
async def decide_approval(request: Request, gate_id: str, body: ApprovalDecision):
    user = get_user(request)

    if body.decision not in ("approved", "rejected"):
        raise HTTPException(400, "Decision must be 'approved' or 'rejected'")

    async with AsyncSessionLocal() as db:
        async with db.begin():
            res = await db.execute(text(
                "SELECT * FROM public.workflow_approval_gates WHERE id = :gid AND status = 'pending'"
            ), {"gid": gate_id})
            gate = res.mappings().first()
            if not gate:
                raise HTTPException(404, "Approval gate not found or already decided")

            gate_dict = dict(gate)

            await db.execute(text("""
                UPDATE public.workflow_approval_gates
                SET status = :decision, decided_by = :by, decided_at = NOW(), decision_note = :note
                WHERE id = :gid
            """), {
                "decision": body.decision,
                "by": user.get("sub", ""),
                "note": body.note,
                "gid": gate_id,
            })

            if body.decision == "approved":
                # Resume the paused workflow
                result = await _resume_workflow(db, str(gate_dict["execution_id"]), {
                    "approval_status": "approved",
                    "approved_by": user.get("sub", ""),
                    "approval_note": body.note,
                })
                return {"gate_id": gate_id, "decision": "approved", "workflow_resumed": True, "result": result}
            else:
                # Mark execution as failed
                await db.execute(text("""
                    UPDATE public.workflow_executions
                    SET status = 'rejected', error_message = :msg, completed_at = NOW()
                    WHERE id = :eid
                """), {
                    "msg": f"Approval rejected by {user.get('sub', 'unknown')}: {body.note}",
                    "eid": str(gate_dict["execution_id"]),
                })
                return {"gate_id": gate_id, "decision": "rejected", "workflow_resumed": False}


# ──────────────────────────────────────────────────────────────
#   WEBHOOK TRIGGERS
# ──────────────────────────────────────────────────────────────

@app.post("/automations/webhooks/{webhook_token}")
async def webhook_trigger(webhook_token: str, request: Request):
    """Receive an external webhook and trigger the associated workflow."""
    try:
        body = await request.json()
    except Exception:
        body = {}

    async with AsyncSessionLocal() as db:
        async with db.begin():
            wh_res = await db.execute(text("""
                SELECT wt.*, w.id as wf_id, w.status as wf_status
                FROM public.workflow_webhook_triggers wt
                JOIN public.workflows w ON w.id = wt.workflow_id
                WHERE wt.webhook_token = :token AND wt.enabled = TRUE
            """), {"token": webhook_token})
            row = wh_res.mappings().first()
            if not row:
                raise HTTPException(404, "Webhook not found or disabled")

            row_dict = dict(row)
            if row_dict.get("wf_status") != "active":
                raise HTTPException(400, "Associated workflow is not active")

            wf = await _load_full_workflow(db, str(row_dict["wf_id"]))
            if not wf:
                raise HTTPException(404, "Workflow not found")

            body["_webhook_token"] = webhook_token
            result = await run_workflow(db, wf, body, "webhook")
            return result


@app.post("/automations/workflows/{workflow_id}/webhooks")
async def create_webhook(request: Request, workflow_id: str):
    """Create a webhook trigger for a workflow."""
    user = get_user(request)
    tid = user.get("tenant_id")
    if not tid:
        raise HTTPException(400, "tenant_id required")

    import secrets
    token = secrets.token_urlsafe(32)
    wh_id = str(uuid.uuid4())

    async with AsyncSessionLocal() as db:
        async with db.begin():
            await db.execute(text("""
                INSERT INTO public.workflow_webhook_triggers (id, workflow_id, tenant_id, webhook_token)
                VALUES (:id, :wid, :tid, :token)
            """), {"id": wh_id, "wid": workflow_id, "tid": tid, "token": token})

    webhook_url = f"/automations/webhooks/{token}"
    return {"id": wh_id, "webhook_token": token, "webhook_url": webhook_url}


@app.get("/automations/workflows/{workflow_id}/webhooks")
async def list_webhooks(request: Request, workflow_id: str):
    async with AsyncSessionLocal() as db:
        res = await db.execute(text("""
            SELECT * FROM public.workflow_webhook_triggers WHERE workflow_id = :wid ORDER BY created_at DESC
        """), {"wid": workflow_id})
        webhooks = []
        for r in res.mappings().all():
            d = dict(r)
            for k, v in d.items():
                if isinstance(v, datetime):
                    d[k] = v.isoformat()
            webhooks.append(d)
        return {"webhooks": webhooks}


@app.delete("/automations/webhooks/{webhook_id}")
async def delete_webhook(request: Request, webhook_id: str):
    async with AsyncSessionLocal() as db:
        async with db.begin():
            await db.execute(text("DELETE FROM public.workflow_webhook_triggers WHERE id = :wid"), {"wid": webhook_id})
    return {"deleted": True}


# ──────────────────────────────────────────────────────────────
#   SCHEDULED TRIGGERS
# ──────────────────────────────────────────────────────────────

class ScheduledTriggerCreate(BaseModel):
    cron_expression: str
    timezone: str = "UTC"


@app.post("/automations/workflows/{workflow_id}/schedules")
async def create_schedule(request: Request, workflow_id: str, body: ScheduledTriggerCreate):
    user = get_user(request)
    tid = user.get("tenant_id")
    if not tid:
        raise HTTPException(400, "tenant_id required")

    from croniter import croniter
    if not croniter.is_valid(body.cron_expression):
        raise HTTPException(400, "Invalid cron expression")

    cron = croniter(body.cron_expression, datetime.now(timezone.utc))
    next_run = cron.get_next(datetime)
    sched_id = str(uuid.uuid4())

    async with AsyncSessionLocal() as db:
        async with db.begin():
            await db.execute(text("""
                INSERT INTO public.workflow_scheduled_triggers
                    (id, workflow_id, tenant_id, cron_expression, timezone, next_run_at)
                VALUES (:id, :wid, :tid, :cron, :tz, :next)
            """), {
                "id": sched_id, "wid": workflow_id, "tid": tid,
                "cron": body.cron_expression, "tz": body.timezone, "next": next_run,
            })

    return {"id": sched_id, "cron_expression": body.cron_expression, "next_run_at": next_run.isoformat()}


@app.get("/automations/workflows/{workflow_id}/schedules")
async def list_schedules(request: Request, workflow_id: str):
    async with AsyncSessionLocal() as db:
        res = await db.execute(text("""
            SELECT * FROM public.workflow_scheduled_triggers WHERE workflow_id = :wid ORDER BY created_at DESC
        """), {"wid": workflow_id})
        schedules = []
        for r in res.mappings().all():
            d = dict(r)
            for k, v in d.items():
                if isinstance(v, datetime):
                    d[k] = v.isoformat()
            schedules.append(d)
        return {"schedules": schedules}


@app.delete("/automations/schedules/{schedule_id}")
async def delete_schedule(request: Request, schedule_id: str):
    async with AsyncSessionLocal() as db:
        async with db.begin():
            await db.execute(text("DELETE FROM public.workflow_scheduled_triggers WHERE id = :sid"), {"sid": schedule_id})
    return {"deleted": True}


# ──────────────────────────────────────────────────────────────
#   EXECUTION RESUME & DRY RUN
# ──────────────────────────────────────────────────────────────

@app.post("/automations/executions/{execution_id}/resume")
async def resume_execution(request: Request, execution_id: str):
    """Manually resume a paused execution (e.g., after approval or event)."""
    async with AsyncSessionLocal() as db:
        async with db.begin():
            result = await _resume_workflow(db, execution_id, {"manual_resume": True})
            return result


# ──────────────────────────────────────────────────────────────
#   NODE CATALOG — For the frontend node library sidebar
# ──────────────────────────────────────────────────────────────

@app.get("/automations/node-catalog")
async def node_catalog():
    """Return the full catalog of available node types for the canvas."""
    return {"categories": [
        {
            "id": "trigger",
            "label": "Triggers",
            "icon": "Zap",
            "color": "#f0883e",
            "nodes": [
                {"type": "trigger_incident_created", "label": "Incident Created", "description": "Fires when a new incident is created", "icon": "AlertCircle",
                 "config_schema": {"filters": {"type": "object", "properties": {"severity": {"type": "string", "label": "Severity Filter", "placeholder": "e.g. critical,high"}, "source": {"type": "string", "label": "Source Filter"}, "title_pattern": {"type": "string", "label": "Title Contains"}}}}},
                {"type": "trigger_incident_updated", "label": "Incident Updated", "description": "Fires when an incident field changes", "icon": "RefreshCw",
                 "config_schema": {"filters": {"type": "object", "properties": {"field": {"type": "string", "label": "Field Name"}, "severity": {"type": "string", "label": "Severity Filter"}}}}},
                {"type": "trigger_status_changed", "label": "Status Changed", "description": "Fires on status transitions", "icon": "ArrowRightCircle",
                 "config_schema": {"filters": {"type": "object", "properties": {"from_status": {"type": "string", "label": "From Status"}, "to_status": {"type": "string", "label": "To Status"}}}}},
                {"type": "trigger_sla_approaching", "label": "SLA Approaching", "description": "Fires when SLA hits warning threshold", "icon": "Clock",
                 "config_schema": {"filters": {"type": "object", "properties": {"threshold_pct": {"type": "number", "label": "Threshold %", "default": 75}, "sla_type": {"type": "string", "label": "SLA Type", "placeholder": "first_response,resolution"}}}}},
                {"type": "trigger_sla_breached", "label": "SLA Breached", "description": "Fires when any SLA target is breached", "icon": "AlertTriangle",
                 "config_schema": {"filters": {"type": "object", "properties": {"sla_type": {"type": "string", "label": "SLA Type"}}}}},
                {"type": "trigger_manual", "label": "Manual Trigger", "description": "Run manually from the UI or incident page", "icon": "Play",
                 "config_schema": {}},
            ],
        },
        {
            "id": "logic",
            "label": "Logic & Flow",
            "icon": "GitBranch",
            "color": "#a371f7",
            "nodes": [
                {"type": "if_condition", "label": "If / Condition", "description": "Branch based on a condition", "icon": "GitBranch",
                 "config_schema": {"field": {"type": "string", "label": "Variable Path", "placeholder": "trigger_data.severity"}, "operator": {"type": "select", "label": "Operator", "options": ["==", "!=", "contains", "not_contains", ">", "<", ">=", "<=", "exists", "not_exists", "in"]}, "value": {"type": "string", "label": "Expected Value"}}},
                {"type": "switch", "label": "Switch / Router", "description": "Multi-way branch on a value", "icon": "Shuffle",
                 "config_schema": {"field": {"type": "string", "label": "Variable Path"}, "cases": {"type": "object", "label": "Cases (value → branch name)"}}},
                {"type": "set_variable", "label": "Set Variable", "description": "Store a value for later nodes", "icon": "Variable",
                 "config_schema": {"variable_name": {"type": "string", "label": "Variable Name"}, "value": {"type": "string", "label": "Value (supports {{templates}})"}}},
                {"type": "delay", "label": "Delay / Wait", "description": "Pause execution for N seconds", "icon": "Clock",
                 "config_schema": {"seconds": {"type": "number", "label": "Seconds to wait", "default": 5, "max": 300}}},
                {"type": "log", "label": "Log / Debug", "description": "Log a message for debugging", "icon": "FileText",
                 "config_schema": {"message": {"type": "string", "label": "Message (supports {{templates}})"}}},
                {"type": "stop", "label": "Stop / End", "description": "Terminate the workflow", "icon": "Square",
                 "config_schema": {"reason": {"type": "string", "label": "Reason"}}},
                {"type": "try_catch", "label": "Try / Catch", "description": "Error handler — wrap nodes with try branch, failures route to catch branch", "icon": "ShieldCheck",
                 "config_schema": {}},
                {"type": "approval_gate", "label": "Approval Gate", "description": "Pause and wait for human approval before continuing", "icon": "UserCheck",
                 "config_schema": {"message": {"type": "textarea", "label": "Approval Message (supports {{templates}})"}, "approvers": {"type": "string", "label": "Approvers (comma-separated user IDs)", "placeholder": "Leave empty for any user"}, "timeout_minutes": {"type": "number", "label": "Timeout (minutes)", "default": 1440}}},
                {"type": "wait_for_event", "label": "Wait for Event", "description": "Pause execution until a specific incident event occurs", "icon": "Hourglass",
                 "config_schema": {"event_type": {"type": "select", "label": "Event Type", "options": ["incident_created", "incident_updated", "status_changed", "sla_approaching", "sla_breached"]}, "filter": {"type": "object", "label": "Event Filters"}, "timeout_minutes": {"type": "number", "label": "Timeout (minutes)", "default": 1440}}},
                {"type": "sub_workflow", "label": "Sub-Workflow", "description": "Call another workflow as a step (max depth: 5)", "icon": "Layers",
                 "config_schema": {"workflow_id": {"type": "string", "label": "Workflow ID to call"}, "input_mapping": {"type": "object", "label": "Input Mapping (key → variable path)"}}},
                {"type": "merge", "label": "Merge", "description": "Combine outputs from parallel branches", "icon": "GitMerge",
                 "config_schema": {}},
            ],
        },
        {
            "id": "soc_action",
            "label": "SOC Actions",
            "icon": "Shield",
            "color": "#3fb950",
            "nodes": [
                {"type": "change_status", "label": "Change Status", "description": "Change incident status", "icon": "RefreshCw",
                 "config_schema": {"incident_id": {"type": "string", "label": "Incident ID (or auto from trigger)", "placeholder": "Leave empty to use trigger incident"}, "status": {"type": "select", "label": "New Status", "options": ["new", "triaging", "sent to customer", "customer response received", "resolved", "false_positive"]}}},
                {"type": "add_comment", "label": "Add Comment", "description": "Add internal note to incident", "icon": "MessageSquare",
                 "config_schema": {"incident_id": {"type": "string", "label": "Incident ID (auto from trigger)", "placeholder": "Leave empty to use trigger incident"}, "comment": {"type": "textarea", "label": "Comment text (supports {{templates}})"}}},
                {"type": "assign_incident", "label": "Assign Incident", "description": "Assign to an analyst", "icon": "UserPlus",
                 "config_schema": {"incident_id": {"type": "string", "label": "Incident ID (auto)", "placeholder": "Leave empty"}, "analyst_id": {"type": "string", "label": "Analyst User ID"}}},
                {"type": "add_tags", "label": "Add Tags", "description": "Add tags to incident", "icon": "Tag",
                 "config_schema": {"incident_id": {"type": "string", "label": "Incident ID (auto)", "placeholder": "Leave empty"}, "tags": {"type": "array", "label": "Tags to add"}}},
                {"type": "escalate_incident", "label": "Escalate", "description": "Escalate the incident", "icon": "ArrowUp",
                 "config_schema": {"incident_id": {"type": "string", "label": "Incident ID (auto)"}, "reason": {"type": "string", "label": "Escalation reason"}}},
            ],
        },
        {
            "id": "communication",
            "label": "Communication",
            "icon": "Mail",
            "color": "#79c0ff",
            "nodes": [
                {"type": "send_notification", "label": "Send Notification", "description": "Send in-app notification", "icon": "Bell",
                 "config_schema": {"message": {"type": "textarea", "label": "Notification message (supports {{templates}})"}}},
                {"type": "send_email", "label": "Send Email", "description": "Send email notification for an incident", "icon": "Mail",
                 "config_schema": {"incident_id": {"type": "string", "label": "Incident ID (auto from trigger)", "placeholder": "Leave empty"}, "to": {"type": "string", "label": "To (email)"}, "subject": {"type": "string", "label": "Subject"}, "body": {"type": "textarea", "label": "Body"}}},
                {"type": "http_request", "label": "HTTP Request", "description": "Make an HTTP request to any URL", "icon": "Globe",
                 "config_schema": {"url": {"type": "string", "label": "URL"}, "method": {"type": "select", "label": "Method", "options": ["GET", "POST", "PUT", "PATCH", "DELETE"]}, "headers": {"type": "object", "label": "Headers"}, "body": {"type": "textarea", "label": "Body (JSON)"}}},
            ],
        },
        {
            "id": "enrichment",
            "label": "Enrichment",
            "icon": "Search",
            "color": "#f778ba",
            "nodes": [
                {"type": "virustotal_lookup", "label": "VirusTotal Lookup", "description": "Query VirusTotal for IOC reputation", "icon": "ShieldAlert",
                 "config_schema": {"ioc_value": {"type": "string", "label": "IOC Value (supports {{templates}})"}, "ioc_type": {"type": "select", "label": "IOC Type", "options": ["ip", "domain", "hash", "md5", "sha256", "url"]}, "credential_id": {"type": "string", "label": "Credential ID (optional)"}, "api_key": {"type": "string", "label": "API Key (or use credential)"}}},
                {"type": "abuseipdb_check", "label": "AbuseIPDB Check", "description": "Check IP reputation on AbuseIPDB", "icon": "ShieldX",
                 "config_schema": {"ip_address": {"type": "string", "label": "IP Address (supports {{templates}})"}, "credential_id": {"type": "string", "label": "Credential ID (optional)"}, "api_key": {"type": "string", "label": "API Key (or use credential)"}}},
                {"type": "whois_lookup", "label": "WHOIS Lookup", "description": "Get domain/IP WHOIS registration data", "icon": "SearchCode",
                 "config_schema": {"target": {"type": "string", "label": "Domain or IP (supports {{templates}})"}}},
                {"type": "dns_resolve", "label": "DNS Resolve", "description": "Resolve DNS records for a domain", "icon": "Network",
                 "config_schema": {"target": {"type": "string", "label": "Domain to resolve (supports {{templates}})"}}},
                {"type": "geoip_lookup", "label": "GeoIP Lookup", "description": "Get geographic location for an IP address", "icon": "MapPin",
                 "config_schema": {"ip_address": {"type": "string", "label": "IP Address (supports {{templates}})"}}},
            ],
        },
        {
            "id": "data_transform",
            "label": "Data Transform",
            "icon": "Braces",
            "color": "#d2a8ff",
            "nodes": [
                {"type": "extract_iocs", "label": "Extract IOCs", "description": "Extract IPs, domains, hashes, URLs, emails from text", "icon": "Crosshair",
                 "config_schema": {"text": {"type": "textarea", "label": "Text to analyze (supports {{templates}}). Leave empty to use trigger data."}}},
                {"type": "regex_extract", "label": "Regex Extract", "description": "Extract matches using a regex pattern", "icon": "Regex",
                 "config_schema": {"text": {"type": "textarea", "label": "Input Text (supports {{templates}})"}, "pattern": {"type": "string", "label": "Regex Pattern"}}},
                {"type": "json_parse", "label": "JSON Parse", "description": "Parse a JSON string into an object", "icon": "Braces",
                 "config_schema": {"input": {"type": "textarea", "label": "JSON String (supports {{templates}})"}}},
                {"type": "math_expression", "label": "Math Expression", "description": "Evaluate a math expression", "icon": "Calculator",
                 "config_schema": {"expression": {"type": "string", "label": "Expression (supports {{templates}})", "placeholder": "e.g. 100 * 0.75"}}},
                {"type": "text_template", "label": "Text Template", "description": "Generate text using template variables", "icon": "Type",
                 "config_schema": {"template": {"type": "textarea", "label": "Template (supports {{templates}})", "placeholder": "Incident {{trigger_data.title}} has severity {{trigger_data.severity}}"}}},
                {"type": "array_filter", "label": "Array Filter", "description": "Filter an array based on a condition", "icon": "Filter",
                 "config_schema": {"items": {"type": "string", "label": "Items Variable Path"}, "field": {"type": "string", "label": "Field to check (for objects)"}, "operator": {"type": "select", "label": "Operator", "options": ["==", "!=", "contains", "not_contains", ">", "<"]}, "value": {"type": "string", "label": "Expected Value"}}},
                {"type": "loop", "label": "Loop / For Each", "description": "Iterate over a list of items", "icon": "Repeat",
                 "config_schema": {"items": {"type": "string", "label": "Items Variable Path (e.g. variables.iocs)"}}},
            ],
        },
        {
            "id": "incident_ops",
            "label": "Incident Operations",
            "icon": "FileSearch",
            "color": "#f0883e",
            "nodes": [
                {"type": "create_incident", "label": "Create Incident", "description": "Create a new incident", "icon": "FilePlus",
                 "config_schema": {"title": {"type": "string", "label": "Title (supports {{templates}})"}, "severity": {"type": "select", "label": "Severity", "options": ["critical", "high", "medium", "low"]}, "description": {"type": "textarea", "label": "Description (supports {{templates}})"}}},
                {"type": "update_incident", "label": "Update Incident", "description": "Update incident fields", "icon": "FileEdit",
                 "config_schema": {"incident_id": {"type": "string", "label": "Incident ID (auto)", "placeholder": "Leave empty"}, "title": {"type": "string", "label": "New Title"}, "severity": {"type": "select", "label": "New Severity", "options": ["", "critical", "high", "medium", "low"]}, "description": {"type": "textarea", "label": "New Description"}, "assigned_to": {"type": "string", "label": "Assign To"}}},
                {"type": "close_incident", "label": "Close Incident", "description": "Resolve and close an incident", "icon": "FileCheck",
                 "config_schema": {"incident_id": {"type": "string", "label": "Incident ID (auto)", "placeholder": "Leave empty"}, "resolution_note": {"type": "textarea", "label": "Resolution Note"}}},
                {"type": "get_incident", "label": "Get Incident", "description": "Fetch full incident details", "icon": "FileSearch",
                 "config_schema": {"incident_id": {"type": "string", "label": "Incident ID (auto)", "placeholder": "Leave empty"}}},
                {"type": "search_incidents", "label": "Search Incidents", "description": "Search for incidents by query", "icon": "Search",
                 "config_schema": {"query": {"type": "string", "label": "Search Query"}, "limit": {"type": "number", "label": "Max Results", "default": 20}}},
            ],
        },
        {
            "id": "freshdesk",
            "label": "Freshdesk",
            "icon": "Headphones",
            "color": "#22c55e",
            "nodes": [
                {"type": "freshdesk_create_ticket", "label": "Create Ticket", "description": "Create a new Freshdesk support ticket", "icon": "TicketPlus",
                 "config_schema": {"domain": {"type": "string", "label": "Freshdesk Domain (e.g. mycompany)", "placeholder": "yourcompany"}, "credential_id": {"type": "string", "label": "Credential ID (optional)"}, "api_key": {"type": "string", "label": "API Key (or use credential)"}, "subject": {"type": "string", "label": "Subject (supports {{templates}})"}, "description": {"type": "textarea", "label": "Description (supports {{templates}})"}, "email": {"type": "string", "label": "Requester Email"}, "priority": {"type": "select", "label": "Priority", "options": ["1 - Low", "2 - Medium", "3 - High", "4 - Urgent"]}, "status": {"type": "select", "label": "Status", "options": ["2 - Open", "3 - Pending", "4 - Resolved", "5 - Closed"]}, "type": {"type": "string", "label": "Ticket Type (optional)", "placeholder": "Incident, Problem, etc."}, "tags": {"type": "array", "label": "Tags"}}},
                {"type": "freshdesk_update_ticket", "label": "Update Ticket", "description": "Update an existing Freshdesk ticket", "icon": "TicketCheck",
                 "config_schema": {"domain": {"type": "string", "label": "Freshdesk Domain"}, "credential_id": {"type": "string", "label": "Credential ID"}, "api_key": {"type": "string", "label": "API Key"}, "ticket_id": {"type": "string", "label": "Ticket ID (auto from previous node)", "placeholder": "Leave empty to use last created"}, "subject": {"type": "string", "label": "New Subject"}, "priority": {"type": "select", "label": "New Priority", "options": ["", "1 - Low", "2 - Medium", "3 - High", "4 - Urgent"]}, "status": {"type": "select", "label": "New Status", "options": ["", "2 - Open", "3 - Pending", "4 - Resolved", "5 - Closed"]}, "tags": {"type": "array", "label": "Tags"}}},
                {"type": "freshdesk_get_ticket", "label": "Get Ticket", "description": "Fetch Freshdesk ticket details", "icon": "TicketSearch",
                 "config_schema": {"domain": {"type": "string", "label": "Freshdesk Domain"}, "credential_id": {"type": "string", "label": "Credential ID"}, "api_key": {"type": "string", "label": "API Key"}, "ticket_id": {"type": "string", "label": "Ticket ID"}}},
                {"type": "freshdesk_add_note", "label": "Add Note", "description": "Add a private or public note to a ticket", "icon": "StickyNote",
                 "config_schema": {"domain": {"type": "string", "label": "Freshdesk Domain"}, "credential_id": {"type": "string", "label": "Credential ID"}, "api_key": {"type": "string", "label": "API Key"}, "ticket_id": {"type": "string", "label": "Ticket ID (auto)", "placeholder": "Leave empty"}, "body": {"type": "textarea", "label": "Note Body (supports {{templates}})"}, "private": {"type": "select", "label": "Visibility", "options": ["true - Private", "false - Public"]}}},
                {"type": "freshdesk_list_tickets", "label": "List / Search Tickets", "description": "List or search Freshdesk tickets", "icon": "ListFilter",
                 "config_schema": {"domain": {"type": "string", "label": "Freshdesk Domain"}, "credential_id": {"type": "string", "label": "Credential ID"}, "api_key": {"type": "string", "label": "API Key"}, "query": {"type": "string", "label": "Search Query (Freshdesk filter syntax)", "placeholder": "e.g. status:2 AND priority:3"}, "per_page": {"type": "number", "label": "Results Per Page", "default": 30}}},
            ],
        },
        {
            "id": "onedesk",
            "label": "OneDesk",
            "icon": "LayoutList",
            "color": "#3b82f6",
            "nodes": [
                {"type": "onedesk_create_item", "label": "Create Item", "description": "Create a ticket, task, or feature in OneDesk", "icon": "ClipboardPlus",
                 "config_schema": {"base_url": {"type": "string", "label": "API Base URL", "default": "https://app.onedesk.com/rest/2.0"}, "credential_id": {"type": "string", "label": "Credential ID (optional)"}, "api_key": {"type": "string", "label": "API Key / Bearer Token"}, "name": {"type": "string", "label": "Item Name (supports {{templates}})"}, "description": {"type": "textarea", "label": "Description (supports {{templates}})"}, "item_type": {"type": "select", "label": "Item Type", "options": ["ticket", "task", "feature", "bug"]}, "priority": {"type": "number", "label": "Priority (0-100)", "default": 50}, "project_id": {"type": "string", "label": "Project ID (optional)"}}},
                {"type": "onedesk_update_item", "label": "Update Item", "description": "Update an existing OneDesk item", "icon": "ClipboardEdit",
                 "config_schema": {"base_url": {"type": "string", "label": "API Base URL", "default": "https://app.onedesk.com/rest/2.0"}, "credential_id": {"type": "string", "label": "Credential ID"}, "api_key": {"type": "string", "label": "API Key"}, "item_id": {"type": "string", "label": "Item ID (auto)", "placeholder": "Leave empty to use last created"}, "name": {"type": "string", "label": "New Name"}, "description": {"type": "textarea", "label": "New Description"}, "priority": {"type": "number", "label": "New Priority"}, "status": {"type": "string", "label": "New Status"}, "assigneeId": {"type": "string", "label": "Assignee ID"}}},
                {"type": "onedesk_get_item", "label": "Get Item", "description": "Fetch OneDesk item details", "icon": "ClipboardList",
                 "config_schema": {"base_url": {"type": "string", "label": "API Base URL", "default": "https://app.onedesk.com/rest/2.0"}, "credential_id": {"type": "string", "label": "Credential ID"}, "api_key": {"type": "string", "label": "API Key"}, "item_id": {"type": "string", "label": "Item ID"}}},
                {"type": "onedesk_add_comment", "label": "Add Comment", "description": "Add a comment to a OneDesk item", "icon": "MessageCirclePlus",
                 "config_schema": {"base_url": {"type": "string", "label": "API Base URL", "default": "https://app.onedesk.com/rest/2.0"}, "credential_id": {"type": "string", "label": "Credential ID"}, "api_key": {"type": "string", "label": "API Key"}, "item_id": {"type": "string", "label": "Item ID (auto)", "placeholder": "Leave empty"}, "content": {"type": "textarea", "label": "Comment Text (supports {{templates}})"}}},
                {"type": "onedesk_list_items", "label": "List Items", "description": "List OneDesk items by type", "icon": "ListTodo",
                 "config_schema": {"base_url": {"type": "string", "label": "API Base URL", "default": "https://app.onedesk.com/rest/2.0"}, "credential_id": {"type": "string", "label": "Credential ID"}, "api_key": {"type": "string", "label": "API Key"}, "item_type": {"type": "select", "label": "Item Type", "options": ["ticket", "task", "feature", "bug"]}, "limit": {"type": "number", "label": "Limit", "default": 25}}},
            ],
        },
    ]}
