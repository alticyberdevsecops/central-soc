import asyncio
import uuid
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

DATABASE_URL = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"

async def run_migrations():
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        print("Creating tenant_teams table...")
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.tenant_teams (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        """))

        print("Creating team_escalation_levels table...")
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.team_escalation_levels (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                team_id UUID REFERENCES public.tenant_teams(id) ON DELETE CASCADE,
                level_number INTEGER NOT NULL,
                escalation_time_min INTEGER DEFAULT 30,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(team_id, level_number)
            );
        """))

        print("Creating level_emails table...")
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.level_emails (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                level_id UUID REFERENCES public.team_escalation_levels(id) ON DELETE CASCADE,
                email VARCHAR(255) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        """))

        print("Creating mailing_configs table...")
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.mailing_configs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
                smtp_host VARCHAR(255),
                smtp_port INTEGER,
                smtp_user VARCHAR(255),
                smtp_pass VARCHAR(255),
                imap_host VARCHAR(255),
                imap_port INTEGER DEFAULT 993,
                from_email VARCHAR(255),
                is_active BOOLEAN DEFAULT TRUE,
                UNIQUE(tenant_id)
            );
        """))

        print("Creating incident_email_interactions table...")
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.incident_email_interactions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                incident_id UUID NOT NULL,
                message_id TEXT UNIQUE,
                in_reply_to TEXT,
                from_email VARCHAR(255),
                sender_name VARCHAR(255),
                subject TEXT,
                body TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                direction VARCHAR(50),
                has_attachments BOOLEAN DEFAULT FALSE
            );
        """))

        # Drop the problematic FK if it exists (it doesn't work with table inheritance)
        await conn.execute(text("ALTER TABLE public.incident_email_interactions DROP CONSTRAINT IF EXISTS incident_email_interactions_incident_id_fkey"))

        print("Updating public.incidents table for escalation tracking...")
        # Check and add columns individually
        cols = ["assigned_team_id", "escalation_level", "last_escalated_at", "next_escalation_check_at", "notification_message_id"]
        for col in cols:
            res = await conn.execute(text(f"""
                SELECT column_name FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = '{col}';
            """))
            if not res.fetchone():
                if col == "assigned_team_id":
                    await conn.execute(text("ALTER TABLE public.incidents ADD COLUMN assigned_team_id UUID REFERENCES public.tenant_teams(id) ON DELETE SET NULL"))
                elif col == "escalation_level":
                    await conn.execute(text("ALTER TABLE public.incidents ADD COLUMN escalation_level INTEGER DEFAULT 0"))
                elif col == "last_escalated_at":
                    await conn.execute(text("ALTER TABLE public.incidents ADD COLUMN last_escalated_at TIMESTAMP WITH TIME ZONE"))
                elif col == "next_escalation_check_at":
                    await conn.execute(text("ALTER TABLE public.incidents ADD COLUMN next_escalation_check_at TIMESTAMP WITH TIME ZONE"))
                elif col == "notification_message_id":
                    await conn.execute(text("ALTER TABLE public.incidents ADD COLUMN notification_message_id TEXT"))
        
        # Add imap + multi-server fields to mailing_configs if they don't exist
        for col in ["imap_host", "imap_port", "imap_user", "imap_pass", "label", "created_at"]:
            res = await conn.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name = 'mailing_configs' AND column_name = '{col}'"))
            if not res.fetchone():
                if col == "imap_host":
                    await conn.execute(text("ALTER TABLE public.mailing_configs ADD COLUMN imap_host VARCHAR(255)"))
                elif col == "imap_port":
                    await conn.execute(text("ALTER TABLE public.mailing_configs ADD COLUMN imap_port INTEGER DEFAULT 993"))
                elif col == "imap_user":
                    await conn.execute(text("ALTER TABLE public.mailing_configs ADD COLUMN imap_user VARCHAR(255)"))
                elif col == "imap_pass":
                    await conn.execute(text("ALTER TABLE public.mailing_configs ADD COLUMN imap_pass VARCHAR(255)"))
                elif col == "label":
                    await conn.execute(text("ALTER TABLE public.mailing_configs ADD COLUMN label VARCHAR(255) DEFAULT 'Default'"))
                elif col == "created_at":
                    await conn.execute(text("ALTER TABLE public.mailing_configs ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()"))

        # Add metadata columns to incident_email_interactions
        for col in ["to_email", "cc_email", "attachment_names"]:
            res = await conn.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name = 'incident_email_interactions' AND column_name = '{col}'"))
            if not res.fetchone():
                await conn.execute(text(f"ALTER TABLE public.incident_email_interactions ADD COLUMN {col} TEXT"))

        # Drop unique constraint on tenant_id to allow multiple configs per tenant
        try:
            await conn.execute(text("ALTER TABLE public.mailing_configs DROP CONSTRAINT IF EXISTS mailing_configs_tenant_id_key"))
        except Exception:
            pass

    print("✅ Migrations completed successfully.")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(run_migrations())
