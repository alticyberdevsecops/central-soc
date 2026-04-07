import asyncio
import os
import sys
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://soc_admin:soc_secret_2024@localhost:5432/central_soc"
)

engine = create_async_engine(DATABASE_URL, echo=True)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def migrate():
    async with AsyncSessionLocal() as session:
        async with session.begin():
            # Create incident_attachments table
            print("Creating incident_attachments table...")
            await session.execute(text("""
                CREATE TABLE IF NOT EXISTS public.incident_attachments (
                    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    interaction_id      UUID NOT NULL REFERENCES public.incident_email_interactions(id) ON DELETE CASCADE,
                    filename            TEXT NOT NULL,
                    content_type        TEXT,
                    data                BYTEA NOT NULL,
                    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            """))
            
            print("Granting permissions...")
            await session.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON public.incident_attachments TO soc_app;"))
            
            print("Migration complete!")

if __name__ == "__main__":
    asyncio.run(migrate())
