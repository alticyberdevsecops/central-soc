"""
Migration: Create integration_configs and integration_ticket_mappings tables.
Run with: docker compose exec soc-incidents python migrate_integrations.py
"""
import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://soc_user:soc_pass@soc-postgres:5432/central_soc"
)

# Execute each statement separately to avoid splitting $$ blocks
STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS public.integration_configs (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        integration     VARCHAR(100) NOT NULL,
        is_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
        config          JSONB NOT NULL DEFAULT '{}',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(tenant_id, integration)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS public.integration_ticket_mappings (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        integration         VARCHAR(100) NOT NULL,
        soc_incident_id     UUID NOT NULL,
        external_ticket_id  VARCHAR(255) NOT NULL,
        external_ticket_url TEXT,
        sync_status         VARCHAR(50) DEFAULT 'synced',
        last_synced_at      TIMESTAMPTZ DEFAULT NOW(),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(tenant_id, integration, soc_incident_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_integration_configs_tenant ON public.integration_configs(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_itm_external ON public.integration_ticket_mappings(tenant_id, integration, external_ticket_id)",
    "CREATE INDEX IF NOT EXISTS idx_itm_soc_incident ON public.integration_ticket_mappings(soc_incident_id)",
    # Trigger — update_updated_at() function already exists from init.sql
    """
    DO $do$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'trg_integration_configs_updated_at'
        ) THEN
            CREATE TRIGGER trg_integration_configs_updated_at
                BEFORE UPDATE ON public.integration_configs
                FOR EACH ROW EXECUTE FUNCTION update_updated_at();
        END IF;
    END
    $do$
    """,
]

async def main():
    engine = create_async_engine(DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        for stmt in STATEMENTS:
            stmt = stmt.strip()
            if stmt:
                await conn.execute(text(stmt))
                print(f"✓ {stmt[:60].replace(chr(10),' ')}…")
    await engine.dispose()
    print("\n✅ Integration tables created successfully.")

if __name__ == "__main__":
    asyncio.run(main())
