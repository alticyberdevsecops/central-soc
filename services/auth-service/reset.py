import os
import sys
import psycopg2
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

DB_URL = os.environ.get(
    "DATABASE_URL_SEED",
    "postgresql://soc_admin:soc_secret_2024@postgres:5432/central_soc"
)

def connect():
    return psycopg2.connect(DB_URL)

def run_reset():
    conn = connect()
    cur = conn.cursor()
    
    print("🧹 Starting full database reset...")
    
    # 1. Find all tenant schemas
    cur.execute("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_%'")
    schemas = cur.fetchall()
    
    for (schema_name,) in schemas:
        print(f"   Dropping schema {schema_name} CASCADE...")
        cur.execute(f"DROP SCHEMA IF EXISTS {schema_name} CASCADE")
        
    # 2. Truncate public tables
    print("   Truncating public tables...")
    cur.execute("TRUNCATE public.users, public.tenants, public.incidents, public.refresh_tokens, public.audit_logs CASCADE")
    
    # 3. Insert specific super admin
    print("   Inserting Super Admin: superadmin@admin.com")
    email = "superadmin@admin.com"
    password = "superadmin"
    hashed_pwd = pwd_context.hash(password)
    
    cur.execute("""
        INSERT INTO users (tenant_id, email, full_name, hashed_password, role)
        VALUES (NULL, %s, 'Super Admin', %s, 'super_admin')
    """, (email, hashed_pwd))
    
    conn.commit()
    cur.close()
    conn.close()
    print("✅ Reset complete! Only one Super Admin exists now.")

if __name__ == "__main__":
    run_reset()
