import asyncio
import os
import sys

# Ensure tenant-service modules can be imported
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

# DB connection matching main.py
DB_URL = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"
engine = create_async_engine(DB_URL, pool_size=5)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def migrate():
    print("Starting template migration...")
    async with AsyncSessionLocal() as session:
        try:
            # Add new columns to mailing_configs
            await session.execute(text("""
                ALTER TABLE public.mailing_configs 
                ADD COLUMN IF NOT EXISTS template_subject VARCHAR(255),
                ADD COLUMN IF NOT EXISTS template_html TEXT;
            """))
            await session.commit()
            print("Successfully added template_subject and template_html to mailing_configs.")
        except Exception as e:
            await session.rollback()
            print(f"Error during migration: {e}")

if __name__ == "__main__":
    asyncio.run(migrate())
