import asyncio
import os
import sys
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

DATABASE_URL = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"

async def migrate():
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        print("Adding level_number to mailing_configs...")
        await conn.execute(text("""
            ALTER TABLE public.mailing_configs 
            ADD COLUMN IF NOT EXISTS level_number INTEGER;
        """))
        print("✅ Migration complete.")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(migrate())
