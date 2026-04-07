"""
Migration: Add interaction_source column to incident_email_interactions.

This allows ITSM events (ticket creation, agent replies) to be stored
alongside regular email interactions in the communication timeline.

Values: 'email' (default), 'freshservice', 'freshdesk', 'servicenow'

Run once:
    docker exec soc-incidents python migrate_itsm_timeline.py
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
            ALTER TABLE public.incident_email_interactions
            ADD COLUMN IF NOT EXISTS interaction_source VARCHAR(50) DEFAULT 'email'
        """))
        await db.commit()
        print("✓ interaction_source column added to incident_email_interactions")

    await engine.dispose()


asyncio.run(run())
