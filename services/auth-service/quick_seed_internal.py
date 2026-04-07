import sys
import os
from sqlalchemy import create_engine, text
from passlib.hash import bcrypt

# Database URL inside the docker network
DATABASE_URL = "postgresql://soc_admin:soc_secret_2024@soc-postgres:5432/central_soc"

def hash_password(password: str) -> str:
    return bcrypt.hash(password)

def seed():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print("🧹 Cleaning existing data...")
        conn.execute(text("TRUNCATE tenants, users, incidents CASCADE"))
        
        # Add superadmin
        conn.execute(text("""
            INSERT INTO users (email, full_name, hashed_password, role, tenant_id)
            VALUES ('superadmin@admin.com', 'Super Admin', :pass, 'super_admin', NULL)
        """), {"pass": hash_password("superadmin")})

        # Provision and seed Tenant 1 (test)
        conn.execute(text("SELECT provision_tenant_schema('tenant_test')"))
        res = conn.execute(text("INSERT INTO tenants (name, slug, schema_name) VALUES ('test', 'test', 'tenant_test') RETURNING id"))
        tenant1_id = res.fetchone()[0]

        # Provision and seed Tenant 2 (FinCorp)
        conn.execute(text("SELECT provision_tenant_schema('tenant_fincorp')"))
        res = conn.execute(text("INSERT INTO tenants (name, slug, schema_name) VALUES ('FinCorp', 'fincorp', 'tenant_fincorp') RETURNING id"))
        tenant2_id = res.fetchone()[0]

        # Function to seed incidents for a tenant
        def seed_incidents(tid, schema, count=15):
            # Set search_path to the tenant schema
            conn.execute(text(f"SET search_path TO {schema}, public"))
            for i in range(count):
                conn.execute(text("""
                    INSERT INTO incidents (tenant_id, source_vendor, vendor_incident_id, title, description, severity, status)
                    VALUES (:tid, :vendor, :vid, :title, :desc, :sev, 'new')
                """), {
                    "tid": tid,
                    "vendor": "crowdstrike" if i % 2 == 0 else "xsiam",
                    "vid": f"INC-{schema[:3].upper()}-{i}",
                    "title": f"Threat Detected on {schema}-node-{i}",
                    "desc": f"Suspicious activity observed in {schema} environment.",
                    "sev": "high" if i % 2 == 0 else "medium"
                })

        seed_incidents(tenant1_id, "tenant_test", 15)
        seed_incidents(tenant2_id, "tenant_fincorp", 15)
        
        conn.commit()
        print("✅ Seeded two tenants with 15 incidents each (Total 30).")
        print("✅ Superadmin provisioned (superadmin@admin.com / superadmin)")

if __name__ == "__main__":
    seed()
