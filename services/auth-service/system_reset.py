import sys
import os
import redis
import requests
from sqlalchemy import create_engine, text
from passlib.hash import bcrypt

# Connection details inside the docker network
DATABASE_URL = "postgresql://soc_admin:soc_secret_2024@soc-postgres:5432/central_soc"
REDIS_URL = "redis://:redis_secret_2024@soc-redis:6379/0"
INGESTION_SERVICE_URL = "http://soc-ingestion:8000"

def hash_password(password: str) -> str:
    return bcrypt.hash(password)

def quote_ident(name):
    return '"' + name.replace('"', '""') + '"'

def reset_system():
    # ── 1. Reset PostgreSQL ──────────────────────────────────────────
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print("🛑 Wiping tenant-specific schemas...")
        # Get all non-standard schemas
        schemas_res = conn.execute(text("""
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('public', 'information_schema', 'pg_catalog', 'pg_toast')
            AND schema_name NOT LIKE 'pg_temp_%'
            AND schema_name NOT LIKE 'pg_toast_temp_%'
        """))
        schemas = [row[0] for row in schemas_res]

        for schema in schemas:
            print(f"   - Dropping schema: {schema}")
            conn.execute(text(f"DROP SCHEMA IF EXISTS {quote_ident(schema)} CASCADE"))

        print("🧹 Truncating global tables...")
        conn.execute(text("TRUNCATE public.tenants, public.users, public.incidents, public.audit_logs, public.refresh_tokens CASCADE"))

        print("🔑 Seeding Super Admin...")
        conn.execute(text("""
            INSERT INTO public.users (email, full_name, hashed_password, role, tenant_id)
            VALUES ('superadmin@admin.com', 'Super Admin', :pass, 'super_admin', NULL)
        """), {"pass": hash_password("superadmin")})

        conn.commit()
        print("✨ Database is now clean.")
        print("   - Super Admin: superadmin@admin.com / superadmin")
    engine.dispose()

    # ── 2. Flush Redis (dedup keys, last_poll timestamps, queued incidents) ──
    print("\n🗑️  Flushing Redis...")
    try:
        r = redis.from_url(REDIS_URL, decode_responses=True)

        # Clear dedup keys
        dedup_keys = r.keys("dedup:*")
        if dedup_keys:
            r.delete(*dedup_keys)
            print(f"   - Cleared {len(dedup_keys)} dedup keys")

        # Clear last_poll timestamps
        poll_keys = r.keys("last_poll:*")
        if poll_keys:
            r.delete(*poll_keys)
            print(f"   - Cleared {len(poll_keys)} last_poll keys")

        # Clear the raw incidents queue
        queue_len = r.llen("soc:raw_incidents:queue")
        if queue_len > 0:
            r.delete("soc:raw_incidents:queue")
            print(f"   - Cleared {queue_len} items from raw incidents queue")

        print("✨ Redis is now clean.")
    except Exception as e:
        print(f"⚠️  Could not flush Redis (non-fatal, will clear on next restart): {e}")

    # ── 3. Notify ingestion-service to reload (clear stale scheduler jobs) ──
    print("\n🔄 Notifying ingestion-service to reload schedules...")
    try:
        resp = requests.post(f"{INGESTION_SERVICE_URL}/connectors/reload", timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            print(f"   - Ingestion reloaded: {data.get('active_connectors', 0)} connectors active")
        else:
            print(f"   - Ingestion reload returned HTTP {resp.status_code}")
    except Exception as e:
        print(f"⚠️  Could not notify ingestion-service (will pick up changes on restart): {e}")

    print("\n🎉 System reset complete!")

if __name__ == "__main__":
    reset_system()
