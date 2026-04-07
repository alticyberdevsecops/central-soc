
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from incidents.sla import get_sla_time_series
from config import settings

async def test():
    engine = create_async_engine(settings.database_url)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        try:
            print("Testing get_sla_time_series with tenant_id=None...")
            res = await get_sla_time_series(session, tenant_id=None, days=30)
            print("Result:", res)
            
            print("\nTesting get_sla_time_series with tenant_id='public'...")
            res = await get_sla_time_series(session, tenant_id="public", days=30)
            print("Result:", res)
        except Exception as e:
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test())
