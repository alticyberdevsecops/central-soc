import os
import sys
from sqlalchemy import text
from config import settings
from worker import get_db_engine

engine = get_db_engine()

def patch_missing_tickets():
    print("Patching missing ticket IDs...")
    with engine.connect() as conn:
        # Get all tenants
        tenants = conn.execute(text("SELECT id, name, schema_name FROM tenants")).fetchall()
        for t_id, t_name, schema in tenants:
            prefix = t_name[:4].upper()
            try:
                result = conn.execute(text(f"""
                    UPDATE {schema}.incidents
                    SET ticket_id = '{prefix}' || '-' || vendor_incident_id
                    WHERE ticket_id IS NULL OR ticket_id = ''
                """))
                conn.commit()
                print(f"Patched {result.rowcount} incidents for tenant {t_name}")
            except Exception as e:
                print(f"Error patching tenant {t_name}: {e}")
                conn.rollback()
    print("Done patching.")

if __name__ == "__main__":
    patch_missing_tickets()
