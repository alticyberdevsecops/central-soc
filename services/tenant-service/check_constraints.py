import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

DATABASE_URL = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"

async def check_constraints():
    engine = create_async_engine(DATABASE_URL)
    async with engine.connect() as conn:
        print("Checking constraints for incident_email_interactions...")
        res = await conn.execute(text("""
            SELECT conname, pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'public'
            AND conrelid = 'public.incident_email_interactions'::regclass;
        """))
        constraints = res.fetchall()
        for con in constraints:
            print(f"Constraint: {con[0]}, Definition: {con[1]}")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(check_constraints())
