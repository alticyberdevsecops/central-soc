"""
SLA Phase 1 Migration — Per-Severity Targets + Breach Notification Tracking
Run: docker compose exec tenant-service python migrate_sla_phase1.py
"""
import asyncio
import logging
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migrate_sla_phase1")

DATABASE_URL = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"

DEFAULT_SEVERITY_TARGETS = {
    "critical":      {"first_response_min": 15,  "resolution_min": 240},
    "high":          {"first_response_min": 30,  "resolution_min": 480},
    "medium":        {"first_response_min": 120, "resolution_min": 1440},
    "low":           {"first_response_min": 480, "resolution_min": 2880},
    "informational": {"first_response_min": 1440, "resolution_min": 4320},
}

async def migrate():
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        logger.info("=== SLA Phase 1 Migration ===")

        # 1. Add severity_targets JSONB column to sla_configs
        logger.info("Adding severity_targets column to sla_configs...")
        await conn.execute(text("""
            ALTER TABLE public.sla_configs
            ADD COLUMN IF NOT EXISTS severity_targets JSONB DEFAULT '{}'::jsonb
        """))

        # 2. Add breach_notification_sent flags to incidents
        logger.info("Adding breach notification tracking columns to incidents...")
        await conn.execute(text("""
            ALTER TABLE public.incidents
            ADD COLUMN IF NOT EXISTS sla_fr_notified BOOLEAN DEFAULT FALSE
        """))
        await conn.execute(text("""
            ALTER TABLE public.incidents
            ADD COLUMN IF NOT EXISTS sla_res_notified BOOLEAN DEFAULT FALSE
        """))

        # 3. Add approaching_breach notification flags
        await conn.execute(text("""
            ALTER TABLE public.incidents
            ADD COLUMN IF NOT EXISTS sla_fr_warning_sent BOOLEAN DEFAULT FALSE
        """))
        await conn.execute(text("""
            ALTER TABLE public.incidents
            ADD COLUMN IF NOT EXISTS sla_res_warning_sent BOOLEAN DEFAULT FALSE
        """))

        # 4. Populate default severity targets for existing configs
        import json
        logger.info("Setting default severity targets for existing configs...")
        await conn.execute(text("""
            UPDATE public.sla_configs
            SET severity_targets = :targets
            WHERE severity_targets = '{}'::jsonb OR severity_targets IS NULL
        """), {"targets": json.dumps(DEFAULT_SEVERITY_TARGETS)})

        logger.info("=== SLA Phase 1 Migration Complete ===")

    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(migrate())
