import asyncio
import asyncpg
import os

async def test():
    conn = await asyncpg.connect("postgresql://soc_admin:soc_secret_2024@postgres:5432/central_soc")
    val = await conn.fetchval("SELECT COUNT(*) FROM public.incidents;")
    print(f"soc_admin public.incidents count: {val}")
    await conn.close()
    
    conn2 = await asyncpg.connect("postgresql://soc_app:soc_secret_2024@postgres:5432/central_soc")
    val2 = await conn2.fetchval("SELECT COUNT(*) FROM public.incidents;")
    is_null = await conn2.fetchval("SELECT current_setting('app.current_tenant_id', TRUE) IS NULL;")
    await conn2.execute("SET search_path TO public, public")
    val_search = await conn2.fetchval("SELECT COUNT(*) FROM incidents WHERE 1=1")
    print(f"soc_app public.incidents count: {val2} (is_null: {is_null}), with search_path: {val_search}")
    await conn2.close()

if __name__ == "__main__":
    asyncio.run(test())
