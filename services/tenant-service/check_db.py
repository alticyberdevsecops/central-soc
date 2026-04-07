
import asyncio
from sqlalchemy import text
from database import SessionLocal

async def check():
    try:
        async with SessionLocal() as db:
            result = await db.execute(text("SELECT id, vendor, is_enabled, credentials FROM connector_configs"))
            configs = result.fetchall()
            print(f"DEBUG: Found {len(configs)} configurations")
            for c in configs:
                print(f"ID: {c[0]} | Vendor: {c[1]} | Enabled: {c[2]} | HasCreds: {bool(c[3])}")
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    asyncio.run(check())
