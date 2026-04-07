import asyncio
import os
import sys

base_dir = r"c:\Users\Threat Hunting\OneDrive - AltiSec Technologies Pvt. Ltd\Desktop\aman\Aman Raj\cental soc"
sys.path.insert(0, os.path.join(base_dir, "services", "incident-service"))
sys.path.insert(0, base_dir)

from shared.db.database import async_session
from sqlalchemy import text

async def check_incident_db():
    try:
        async with async_session() as session:
            res = await session.execute(text("SELECT id, mitre_tactics, mitre_techniques, raw_payload, updated_at FROM incidents ORDER BY updated_at DESC NULLS LAST LIMIT 5"))
            rows = res.fetchall()
            for idx, row in enumerate(rows):
                print(f"Incident {idx} --- ID: {row[0]}\nUpdated At: {row[4]}")
                print(f" Mitre Tactics: {row[1]}")
                print(f" Mitre Techniques: {row[2]}")
                print(f" Raw Payload: {row[3]}\n")
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    asyncio.run(check_incident_db())
