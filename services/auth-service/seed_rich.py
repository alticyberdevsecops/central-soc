from sqlalchemy import create_engine, text
import json

DATABASE_URL = "postgresql://soc_admin:soc_secret_2024@soc-postgres:5432/central_soc"

def seed_rich_incident():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        print("🔍 Checking tenant...")
        conn.execute(text("SELECT provision_tenant_schema('tenant_test')"))
        res = conn.execute(text("INSERT INTO tenants (name, slug, schema_name) VALUES ('test', 'test', 'tenant_test') ON CONFLICT (slug) DO NOTHING RETURNING id"))
        tenant_id = res.fetchone()
        if not tenant_id:
            res = conn.execute(text("SELECT id FROM tenants WHERE slug='test'"))
            tenant_id = res.fetchone()[0]
        else:
            tenant_id = tenant_id[0]

        # Seed rich incident
        raw_payload = {
            "event_id": "EVT-998877",
            "network_context": {
                "source_ip": "192.168.1.50",
                "dest_ip": "10.4.0.1",
                "protocol": "TCP",
                "port": 443
            },
            "process_tree": {
                "parent": "explorer.exe",
                "child": "powershell.exe",
                "command_line": "powershell.exe -ExecutionPolicy Bypass -File C:\\Windows\\Temp\\exploit.ps1",
                "integrity_level": "High"
            },
            "threat_intel": {
                "indicator": "malicious-site.com",
                "score": 95,
                "category": "C2"
            },
            "environment": "Production",
            "tags": ["zero-day", "apt", "powershell"]
        }

        conn.execute(text(f"SET search_path TO tenant_test, public"))
        conn.execute(text("""
            INSERT INTO incidents (tenant_id, source_vendor, vendor_incident_id, title, description, severity, status, raw_payload)
            VALUES (:tid, 'Custom', 'RICH-INC-001', 'Advanced PowerShell Injection Detected', 
                    'A suspicious powershell process was detected spawning from explorer.exe with high integrity.', 
                    'critical', 'new', :raw)
        """), {
            "tid": tenant_id,
            "raw": json.dumps(raw_payload)
        })
        conn.commit()
    print("✅ Seeded rich incident.")

if __name__ == "__main__":
    seed_rich_incident()
