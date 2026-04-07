
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"

async def run():
    engine = create_async_engine(DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        await session.execute(text("SET search_path TO tenant_atpl, public"))
        
        sql = text("""
            SELECT
                COUNT(*) FILTER (WHERE status = 'new') AS new_count,
                COUNT(*) FILTER (WHERE status = 'triaging') AS triaging_count,
                COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_count,
                COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
                COUNT(*) FILTER (WHERE status = 'false_positive') AS false_positive_count,
                COUNT(*) FILTER (WHERE status = 'escalated') AS escalated_count,
                COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
                COUNT(*) FILTER (WHERE severity = 'high') AS high_count,
                COUNT(*) FILTER (WHERE severity = 'medium') AS medium_count,
                COUNT(*) FILTER (WHERE severity = 'low') AS low_count,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS last_7d,
                source_vendor,
                COUNT(*) AS vendor_count
            FROM incidents
            GROUP BY ROLLUP(source_vendor)
        """)
        
        result = await session.execute(sql)
        rows = result.mappings().all()
        print(f"Total rows: {len(rows)}")
        for r in rows:
            print(dict(r))
            
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(run())
