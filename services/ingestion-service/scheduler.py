"""
Ingestion Scheduler — APScheduler-based per-tenant connector polling.

PLUGIN ARCHITECTURE:
  - Connectors are AUTO-DISCOVERED by scanning the connectors/ directory.
  - To add a NEW vendor: create connectors/my_vendor.py that subclasses ConnectorBase
    and sets VENDOR = "my_vendor". That's it — zero other changes needed.
  - The scheduler reads connector_configs from DB (vendor = "my_vendor") and
    automatically routes to the right connector class.
"""
import asyncio
import importlib
import inspect
import json
import logging
import pkgutil
import dataclasses
from datetime import datetime, timezone
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import redis
from sqlalchemy import create_engine, text
from config import settings
from connectors.base import ConnectorBase, ConnectorCredentials, RawIncident

logger = logging.getLogger("ingestion.scheduler")

# ─────────────────────────────────────────────────────────────────────────────
# AUTO-DISCOVERY REGISTRY
# Scans the entire connectors/ package and registers every subclass of
# ConnectorBase that declares a VENDOR attribute. No manual registration.
# ─────────────────────────────────────────────────────────────────────────────
_CONNECTOR_REGISTRY: dict[str, type] = {}


def _autodiscover_connectors() -> dict[str, type]:
    """
    Walk every module in the `connectors` package and collect all
    ConnectorBase subclasses. The class's VENDOR attribute is used as the
    registry key (must match connector_configs.vendor in the DB).
    """
    import connectors as connectors_pkg
    discovered = {}
    for _finder, name, _ispkg in pkgutil.walk_packages(
        path=connectors_pkg.__path__,
        prefix=connectors_pkg.__name__ + ".",
        onerror=lambda x: logger.warning(f"Error scanning connector module {x}"),
    ):
        try:
            module = importlib.import_module(name)
        except Exception as e:
            logger.warning(f"Could not import connector module {name}: {e}")
            continue

        for _attr_name, obj in inspect.getmembers(module, inspect.isclass):
            if (
                issubclass(obj, ConnectorBase)
                and obj is not ConnectorBase
                and hasattr(obj, "VENDOR")
                and obj.VENDOR != "generic"
            ):
                vendor_key = obj.VENDOR.lower()
                if vendor_key not in discovered:
                    discovered[vendor_key] = obj
                    logger.info(f"🔌 Auto-discovered connector: [{vendor_key}] → {obj.__name__} ({name})")
    return discovered


def get_connector_class(vendor: str) -> type | None:
    """Look up a connector class by vendor name. Auto-discovers on first call."""
    global _CONNECTOR_REGISTRY
    if not _CONNECTOR_REGISTRY:
        _CONNECTOR_REGISTRY = _autodiscover_connectors()
        logger.info(f"Connector registry loaded — {len(_CONNECTOR_REGISTRY)} vendors: {list(_CONNECTOR_REGISTRY.keys())}")
    return _CONNECTOR_REGISTRY.get(vendor.lower())


def refresh_registry():
    """Force re-scan (call after hot-deploying a new connector file)."""
    global _CONNECTOR_REGISTRY
    _CONNECTOR_REGISTRY = {}
    return _autodiscover_connectors()


# ─────────────────────────────────────────────────────────────────────────────

def get_redis_client():
    return redis.from_url(settings.redis_url, decode_responses=True)


def get_sync_db():
    engine = create_engine(settings.database_url_sync, pool_pre_ping=True)
    return engine


def enqueue_incidents(incidents: list[RawIncident], tenant_id: str, vendor: str):
    """Push raw incidents to Redis queue. Deduplication is done here.

    Dedup strategy:
    - For XSIAM: re-enqueue if modification_time is newer OR alert_count increased.
      This ensures updated incidents (severity change, status change, new alerts, etc.)
      are always re-processed even if the incident already exists in the DB.
    - For other vendors: re-enqueue on any new poll (no dedup block for updates).
    """
    if not incidents:
        return
    r = get_redis_client()
    pipe = r.pipeline()
    enqueued = 0
    for inc in incidents:
        dedup_key = f"dedup:{tenant_id}:{vendor}:{inc.vendor_incident_id}"
        current_data = r.get(dedup_key)

        should_enqueue = True
        if current_data and vendor == "xsiam":
            try:
                meta = json.loads(current_data)
                if isinstance(meta, dict):
                    incident_data = inc.raw_payload.get("incident", {})
                    new_alert_count = int(incident_data.get("alert_count", 0))
                    new_mod_time = int(incident_data.get("modification_time", 0))

                    old_alert_count = int(meta.get("alert_count", 0))
                    old_mod_time = int(meta.get("modification_time", 0))

                    # Re-enqueue if XSIAM says the incident was modified more recently
                    # OR if the alert count increased (new alerts stitched in)
                    if new_mod_time <= old_mod_time and new_alert_count <= old_alert_count:
                        should_enqueue = False
                # If meta is not a dict (legacy "1"), always re-enqueue to pick up updates
            except (json.JSONDecodeError, ValueError):
                # Malformed dedup entry — re-enqueue to be safe
                pass

        if not should_enqueue:
            continue

        # Build the dedup fingerprint stored in Redis
        if vendor == "xsiam":
            incident_data = inc.raw_payload.get("incident", {})
            dedup_val = json.dumps({
                "alert_count": int(incident_data.get("alert_count", 0)),
                "modification_time": int(incident_data.get("modification_time", 0)),
            })
        else:
            dedup_val = "1"

        pipe.setex(dedup_key, 604800, dedup_val)  # 7-day TTL
        pipe.rpush("soc:raw_incidents:queue", json.dumps(dataclasses.asdict(inc)))
        enqueued += 1
    pipe.execute()
    if enqueued > 0:
        logger.info(f"📥 Enqueued {enqueued} incidents (new+updated) | vendor={vendor} | tenant={tenant_id[:8]}")


def poll_connector(connector_id: str, tenant_id: str, vendor: str, credentials: dict, poll_interval: int, schema: str):
    """Execute one poll cycle for a single tenant+vendor connector."""
    connector_class = get_connector_class(vendor)
    if not connector_class:
        logger.error(
            f"⚠️  No connector found for vendor='{vendor}' (tenant={tenant_id[:8]}). "
            f"Add connectors/{vendor}.py inheriting ConnectorBase with VENDOR='{vendor}' to fix."
        )
        return

    r = get_redis_client()
    last_poll_key = f"last_poll:{connector_id}"
    last_poll_str = r.get(last_poll_key)
    since = datetime.fromisoformat(last_poll_str) if last_poll_str else None

    creds = ConnectorCredentials(raw=credentials)
    connector = connector_class(tenant_id=tenant_id, credentials=creds)

    engine = get_sync_db()
    import asyncio
    try:
        incidents = asyncio.run(connector.fetch_incidents(since=since))
        
        count = len(incidents) if incidents is not None else 0
        
        if count > 0:
            enqueue_incidents(incidents, tenant_id, vendor)
        
        r.set(last_poll_key, datetime.now(timezone.utc).isoformat())
        with engine.connect() as conn:
            conn.execute(text(f"SET search_path TO {schema}, public"))
            conn.execute(
                text("UPDATE connector_configs SET last_polled_at = NOW(), last_poll_status = 'ok', last_error_msg = NULL WHERE id = :id"),
                {"id": connector_id},
            )
            conn.commit()
    except Exception as e:
        logger.error(f"Connector poll error | vendor={vendor} | tenant={tenant_id[:8]} | schema={schema}: {e}")
        try:
            with engine.connect() as conn:
                conn.execute(text(f"SET search_path TO {schema}, public"))
                conn.execute(
                    text("UPDATE connector_configs SET last_polled_at = NOW(), last_poll_status = 'error', last_error_msg = :msg WHERE id = :id"),
                    {"id": connector_id, "msg": str(e)[:500]},
                )
                conn.commit()
        except Exception as e2:
            logger.error(f"Failed to record error in DB for {connector_id}: {e2}")
    finally:
        engine.dispose()


def load_and_schedule_connectors(scheduler: AsyncIOScheduler):
    """
    Read all enabled connector_configs from DB and schedule them.
    Unknown vendors are logged with helpful guidance — other vendors are unaffected.
    """
    # Force fresh registry scan
    registry = refresh_registry()
    logger.info(f"Registry has {len(registry)} available connectors: {list(registry.keys())}")

    engine = get_sync_db()
    rows = []
    try:
        with engine.connect() as conn:
            # 1. Get all tenants and their schemas
            tenants = conn.execute(text("SELECT id, schema_name FROM public.tenants")).fetchall()
            
            # 2. For each tenant, query their isolated connector_configs
            for t_id, t_schema in tenants:
                try:
                    conn.execute(text(f"SET search_path TO {t_schema}, public"))
                    configs = conn.execute(text(
                        "SELECT id, vendor, credentials, poll_interval_sec, label FROM connector_configs WHERE is_enabled = TRUE"
                    )).fetchall()
                    for cfg in configs:
                        rows.append((cfg[0], t_id, cfg[1], cfg[2], cfg[3], cfg[4], t_schema))
                except Exception as e:
                    logger.error(f"Error loading connectors for tenant {t_id} (schema {t_schema}): {e}")
    finally:
        engine.dispose()

    logger.info(f"Scheduling {len(rows)} active connector configurations from all tenant schemas")
    scheduled = 0
    skipped = []

    for row in rows:
        connector_id, tenant_id, vendor, credentials, poll_interval, label, schema = (
            str(row[0]), str(row[1]), row[2], row[3], row[4], row[5] or "", row[6]
        )
        if vendor.lower() not in registry:
            skipped.append(vendor)
            logger.warning(
                f"⚠️  Vendor '{vendor}' (label='{label}', tenant={tenant_id[:8]}) has no connector class. "
                f"Create connectors/{vendor}.py to enable it."
            )
            continue

        scheduler.add_job(
            poll_connector,
            trigger=IntervalTrigger(seconds=poll_interval),
            args=[connector_id, tenant_id, vendor, credentials, poll_interval, schema],
            id=f"connector_{connector_id}",
            replace_existing=True,
            max_instances=1,
            next_run_time=datetime.now(timezone.utc),
        )
        logger.info(f"  ✅ Scheduled [{vendor}] '{label}' for tenant {tenant_id[:8]} every {poll_interval}s")
        scheduled += 1

    # Add self-healing periodic refresh job (every 10 minutes)
    scheduler.add_job(
        load_and_schedule_connectors,
        trigger=IntervalTrigger(minutes=10),
        args=[scheduler],
        id="scheduler_self_healing_refresh",
        replace_existing=True,
        next_run_time=None, # Avoid immediate double-run if called from startup
    )
    logger.info("  🔄 Scheduled self-healing connector refresh (every 10m)")

    if skipped:
        logger.warning(f"Skipped {len(skipped)} connectors with no implementation: {set(skipped)}")
    logger.info(f"Scheduler ready — {scheduled} connectors active")
