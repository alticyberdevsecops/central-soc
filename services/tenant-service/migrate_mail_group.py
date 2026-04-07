"""
Migration: Add group_id column to mailing_configs.

This allows one mail server configuration to be shared across multiple tenants.
Each row still has its own tenant_id — group_id links rows that share the same
SMTP/IMAP settings (created together via the multi-tenant form).

Run once:
    docker compose exec soc-tenants python migrate_mail_group.py
"""
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

DATABASE_URL = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"

engine = create_async_engine(DATABASE_URL)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def run():
    async with AsyncSessionLocal() as db:
        await db.execute(text("""
            ALTER TABLE public.mailing_configs
            ADD COLUMN IF NOT EXISTS group_id UUID DEFAULT gen_random_uuid()
        """))
        # Give every existing row its own unique group_id
        await db.execute(text("""
            UPDATE public.mailing_configs
            SET group_id = gen_random_uuid()
            WHERE group_id IS NULL
        """))
        await db.commit()
        print("✓ group_id column added to mailing_configs")

    await engine.dispose()


asyncio.run(run())
