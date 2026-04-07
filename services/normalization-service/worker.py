"""
Normalization Worker — Continuously consumes incidents from the Redis queue
and persists them to PostgreSQL with full tenant isolation.

Pipeline: ingestion-service → Redis queue → normalizer → PostgreSQL + Redis pub/sub
"""
import json
import logging
import time
import redis
import sqlalchemy
from sqlalchemy import create_engine, text
from datetime import datetime, timezone
import importlib
import pkgutil
import inspect
from parsers.base_parser import BaseParser
from config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("normalization.worker")

QUEUE_KEY = "soc:raw_incidents:queue"
PUBSUB_CHANNEL = "soc:incidents:live"

def get_db_engine():
    return create_engine(settings.database_url_sync, pool_size=5, max_overflow=10)


_PARSER_REGISTRY = {}

def get_parser(vendor: str) -> BaseParser | None:
    global _PARSER_REGISTRY
    if not _PARSER_REGISTRY:
        import parsers as parsers_pkg
        for _finder, name, _ispkg in pkgutil.walk_packages(
            path=parsers_pkg.__path__,
            prefix=parsers_pkg.__name__ + ".",
        ):
            try:
                module = importlib.import_module(name)
                for _attr_name, obj in inspect.getmembers(module, inspect.isclass):
                    if issubclass(obj, BaseParser) and obj is not BaseParser and hasattr(obj, "VENDOR") and obj.VENDOR != "generic":
                        _PARSER_REGISTRY[obj.VENDOR.lower()] = obj()
            except Exception as e:
                logger.warning(f"Could not import parser module {name}: {e}")
    return _PARSER_REGISTRY.get(vendor.lower())


def get_redis():
    return redis.from_url(settings.redis_url, decode_responses=True)


TENANT_CACHE = {}  # tenant_id -> (schema_name, tenant_name)

def get_tenant_schema(conn, tenant_id: str) -> tuple[str, str]:
    if tenant_id in TENANT_CACHE:
        return TENANT_CACHE[tenant_id]

    result = conn.execute(
        text("SELECT schema_name, name FROM tenants WHERE id = :tid"),
        {"tid": tenant_id}
    ).fetchone()

    if result:
        TENANT_CACHE[tenant_id] = (result[0], result[1])  # Cache both schema_name and tenant_name
        return result[0], result[1]
    return "public", "SOC"


def upsert_incident(conn, incident: dict, schema: str) -> bool:
    """
    Insert or update incident in PostgreSQL.
    Tenant isolation is enforced by targeting the correct schema.
    Returns True if this is a new incident, False if updated.
    """
    insert_sql = text(f"""
        INSERT INTO {schema}.incidents (
            tenant_id, ticket_id, source_vendor, vendor_incident_id, title, description,
            severity, status, affected_hosts, affected_users, iocs,
            mitre_tactics, mitre_techniques, tags, raw_payload, source_created_at
        ) VALUES (
            :tenant_id, :ticket_id, :source_vendor, :vendor_incident_id, :title, :description,
            :severity, :status, :affected_hosts, :affected_users, :iocs,
            :mitre_tactics, :mitre_techniques, :tags, :raw_payload, :source_created_at
        )
        ON CONFLICT (source_vendor, vendor_incident_id) DO UPDATE
            SET title = EXCLUDED.title,
                ticket_id = CASE WHEN NULLIF(EXCLUDED.ticket_id, '') IS NOT NULL THEN EXCLUDED.ticket_id ELSE {schema}.incidents.ticket_id END,
                description = EXCLUDED.description,
                severity = EXCLUDED.severity,
                status = CASE
                    WHEN {schema}.incidents.status IN ('resolved', 'false_positive')
                    THEN {schema}.incidents.status
                    ELSE EXCLUDED.status
                END,
                affected_hosts = EXCLUDED.affected_hosts,
                affected_users = EXCLUDED.affected_users,
                iocs = EXCLUDED.iocs,
                mitre_tactics = EXCLUDED.mitre_tactics,
                mitre_techniques = EXCLUDED.mitre_techniques,
                raw_payload = EXCLUDED.raw_payload,
                last_updated_at = NOW(),
                updated_at = NOW()
        RETURNING id, (xmax = 0) AS is_new
    """)

    result = conn.execute(insert_sql, {
        "tenant_id": incident.get("tenant_id"),
        "ticket_id": incident.get("ticket_id"),
        "source_vendor": incident.get("source_vendor"),
        "vendor_incident_id": incident.get("vendor_incident_id"),
        "title": (incident.get("title") or "No Title")[:500],
        "description": incident.get("description") or "",
        "severity": incident.get("severity") or "medium",
        "status": incident.get("status") or "new",
        "affected_hosts": json.dumps(incident.get("affected_hosts", [])),
        "affected_users": json.dumps(incident.get("affected_users", [])),
        "iocs": json.dumps(incident.get("iocs", [])),
        "mitre_tactics": json.dumps(incident.get("mitre_tactics", [])),
        "mitre_techniques": json.dumps(incident.get("mitre_techniques", [])),
        "tags": json.dumps(incident.get("tags", [])),
        "raw_payload": json.dumps(incident.get("raw_payload", {})),
        "source_created_at": incident.get("source_created_at"),
    })
    row = result.fetchone()
    conn.commit()
    return row[1] if row else False  # is_new


def publish_live_event(r: redis.Redis, incident: dict, incident_id: str, is_new: bool, tenant_name: str = "Unknown"):
    """Publish to Redis pub/sub — WebSocket clients receive this in real-time."""
    event = {
        "event_type": "new_incident" if is_new else "incident_updated",
        "incident_id": incident_id,
        "ticket_id": incident.get("ticket_id"),
        "tenant_id": incident.get("tenant_id"),
        "tenant_name": tenant_name,
        "source_vendor": incident.get("source_vendor"),
        "title": incident.get("title", "No Title"),
        "severity": incident.get("severity", "medium"),
        "status": incident.get("status", "new"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    r.publish(PUBSUB_CHANNEL, json.dumps(event))


def run_worker():
    engine = get_db_engine()
    r = get_redis()
    logger.info("🔄 Normalization worker started — waiting for incidents on queue...")

    while True:
        try:
            item = r.blpop(QUEUE_KEY, timeout=5)
            if not item:
                continue
            _, payload_str = item
            raw_incident = json.loads(payload_str)
            tenant_id = raw_incident.get("tenant_id", "unknown")
            vendor = raw_incident.get("source_vendor", "generic")

            parser = get_parser(vendor)
            if not parser:
                logger.error(f"⚠️ No parser found for vendor '{vendor}'. Skipping.")
                continue

            with engine.connect() as conn:
                # 1. Get schema and info for tenant (needed for search_path and prefix)
                schema, tenant_name = get_tenant_schema(conn, tenant_id)
                
                # 2. Add tenant_name to raw_incident so parser can use it for Ticket ID
                raw_incident["tenant_name"] = tenant_name
                
                # 3. Parse incident (now parser can include ticket_id in its structure)
                normalized = parser.parse(raw_incident)
                
                # 4. Fallback/Consistency: Ensure ticket_id is set at top level and in raw_payload
                tid = normalized.get("ticket_id")
                if not tid:
                    prefix = tenant_name[:4].upper()
                    tid = f"{prefix}-{normalized.get('vendor_incident_id')}"
                    normalized["ticket_id"] = tid
                
                if "raw_payload" in normalized and isinstance(normalized["raw_payload"], dict):
                    if not normalized["raw_payload"].get("ticket_id"):
                        normalized["raw_payload"]["ticket_id"] = tid

                logger.info(f"Upserting incident for {tenant_name} with ticket_id = {tid}")

                # 5. Switch search_path
                conn.execute(text(f"SET search_path TO {schema}, public"))
                
                # 6. Upsert incident in tenant schema
                is_new = upsert_incident(conn, normalized, schema)

                # 5. Get the incident ID for real-time feed
                res = conn.execute(text(f"""
                    SELECT id FROM {schema}.incidents 
                    WHERE source_vendor = :v AND vendor_incident_id = :vid
                """), {"v": vendor, "vid": normalized["vendor_incident_id"]}).fetchone()
            
            if res:
                incident_db_id = str(res[0])
            else:
                incident_db_id = "unknown"

            publish_live_event(r, normalized, incident_db_id, is_new, tenant_name)
            action = "✅ NEW" if is_new else "🔄 UPDATED"
            logger.info(f"{action} incident [{vendor.upper()}] {normalized.get('title', 'Untitled')[:60]} (tenant: {tenant_name})")

        except redis.exceptions.ConnectionError as e:
            logger.error(f"Redis connection error: {e}. Retrying in 5s...")
            time.sleep(5)
        except Exception as e:
            logger.error(f"Error processing incident: {e}", exc_info=True)
            time.sleep(1)


if __name__ == "__main__":
    run_worker()
