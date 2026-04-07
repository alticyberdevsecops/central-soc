import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
DATABASE_URL = 'postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc'
async def check():
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        res = await conn.execute(text("SELECT ai_verdict FROM tenant_atpl.incidents WHERE id = '87f35c6d-04da-4810-a391-e5e3e69f8037'"))
        inc = res.fetchone()
        with open("/tmp/verdict_dump.html", "w", encoding="utf-8") as f:
            f.write(inc[0])
asyncio.run(check())
