"""SLA tables and incident columns migration."""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

DATABASE_URL = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"


async def run_migrations():
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:

        print("Creating sla_configs table...")
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.sla_configs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
                first_response_min INTEGER NOT NULL DEFAULT 30,
                resolution_min INTEGER NOT NULL DEFAULT 1440,
                customer_reply_min INTEGER NOT NULL DEFAULT 60,
                escalation_response_min INTEGER NOT NULL DEFAULT 15,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(tenant_id)
            );
        """))

        print("Creating sla_events table...")
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.sla_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                incident_id UUID NOT NULL,
                tenant_id UUID NOT NULL,
                event_type VARCHAR(100) NOT NULL,
                actor_id UUID,
                old_value TEXT,
                new_value TEXT,
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        """))

        # Create indexes if they don't exist
        for idx, col in [
            ("idx_sla_events_incident", "incident_id"),
            ("idx_sla_events_actor", "actor_id"),
            ("idx_sla_events_tenant", "tenant_id"),
            ("idx_sla_events_type", "event_type"),
        ]:
            await conn.execute(text(f"""
                CREATE INDEX IF NOT EXISTS {idx} ON public.sla_events({col});
            """))

        # Add SLA columns to incidents if they don't exist
        print("Adding SLA columns to public.incidents...")
        for col, typedef in [
            ("first_response_at", "TIMESTAMPTZ"),
            ("assigned_at", "TIMESTAMPTZ"),
            ("sla_first_response_breached", "BOOLEAN DEFAULT FALSE"),
            ("sla_resolution_breached", "BOOLEAN DEFAULT FALSE"),
        ]:
            res = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = 'incidents' "
                f"AND column_name = '{col}'"
            ))
            if not res.fetchone():
                await conn.execute(text(
                    f"ALTER TABLE public.incidents ADD COLUMN {col} {typedef}"
                ))
                print(f"  Added column: {col}")

        # Insert default SLA config for every tenant that doesn't have one
        print("Inserting default SLA configs for existing tenants...")
        await conn.execute(text("""
            INSERT INTO public.sla_configs (tenant_id)
            SELECT id FROM public.tenants t
            WHERE NOT EXISTS (
                SELECT 1 FROM public.sla_configs sc WHERE sc.tenant_id = t.id
            )
        """))

    print("✅ SLA migrations completed successfully.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_migrations())
