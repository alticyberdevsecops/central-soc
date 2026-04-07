
import asyncio
import json
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://soc_admin:soc_secret_2024@postgres:5432/central_soc"

settings = Settings()
engine = create_async_engine(settings.database_url)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Verified credentials from working app.py
CREDS = {
    "xsiam_url": "api-atpl-nfr.xdr.in.paloaltonetworks.com",
    "api_key": "lDQIXkpPuY3ye41yUwgjUmSWzhKeTUTrryw2ft6yhm6DcP4na6QcF5vyeROu8uDab0SM35jDB6nbBvLKTBpepTagVI2QLYsvuSvQB4jI4i891QLGh43DpoQwhy0bN85g",
    "api_key_id": "24"
}

# Active Tenant ID
TENANT_ID = "0a94528e-78b4-4fdf-bb69-d8236a3a5026"

async def sync():
    async with AsyncSessionLocal() as db:
        try:
            # 1. Get the schema name for the tenant
            res = await db.execute(text("SELECT schema_name FROM tenants WHERE id = :tid"), {"tid": TENANT_ID})
            schema = res.scalar()
            if not schema:
                print(f"ERROR: Tenant {TENANT_ID} not found")
                return

            print(f"INFO: Updating credentials in schema: {schema}")
            
            # 2. Update the credentials in the tenant's schema
            await db.execute(text(f"SET search_path TO {schema}, public"))
            
            # Check if config exists
            res = await db.execute(text("SELECT id FROM connector_configs WHERE vendor = 'xsiam'"))
            config_id = res.scalar()
            
            if config_id:
                print(f"INFO: Updating existing XSIAM config ID: {config_id}")
                await db.execute(
                    text("UPDATE connector_configs SET credentials = :creds, is_enabled = True WHERE id = :id"),
                    {"creds": json.dumps(CREDS), "id": config_id}
                )
            else:
                print("INFO: Creating new XSIAM config")
                await db.execute(
                    text("INSERT INTO connector_configs (vendor, label, is_enabled, credentials) VALUES ('xsiam', 'Cortex XSIAM', True, :creds)"),
                    {"creds": json.dumps(CREDS)}
                )
            
            await db.commit()
            print("SUCCESS: Credentials synchronized with working app.py")
            
        except Exception as e:
            print(f"ERROR: {e}")
            await db.rollback()

if __name__ == "__main__":
    asyncio.run(sync())
