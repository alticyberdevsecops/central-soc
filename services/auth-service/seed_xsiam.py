from sqlalchemy import create_engine, text
import json

DATABASE_URL = "postgresql://soc_admin:soc_secret_2024@soc-postgres:5432/central_soc"

def seed_xsiam_incident():
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

        # Seed XSIAM rich incident
        raw_payload = {
            "incident": {
                "incident_id": "XSIAM-12345",
                "incident_name": "Suspicious File Activity and C2 Communication",
                "creation_time": "2026-03-01T10:00:00Z",
                "severity": "high",
                "status": "new",
                "description": "Multi-stage attack involving a malicious dropper and subsequent C2 callback."
            },
            "file_artifacts": [
                {
                    "file_name": "dropper.exe",
                    "file_sha256": "8f9e0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f",
                    "file_wildfire_verdict": "MALWARE",
                    "is_malicious": True,
                    "type": "HASH"
                },
                {
                    "file_name": "config.ini",
                    "file_sha256": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
                    "file_wildfire_verdict": "BENIGN",
                    "is_malicious": False,
                    "type": "HASH"
                }
            ],
            "network_artifacts": [
                {
                    "type": "DOMAIN",
                    "network_domain": "malicious-c2.com",
                    "network_remote_ip": "185.123.45.67",
                    "network_remote_port": 443,
                    "network_country": "UNKNOWN",
                    "alert_count": 5
                },
                {
                    "type": "IP",
                    "network_remote_ip": "91.234.56.78",
                    "network_remote_port": 80,
                    "network_country": "RU",
                    "alert_count": 2
                }
            ],
            "alerts": []
        }

        conn.execute(text(f"SET search_path TO tenant_test, public"))
        conn.execute(text("""
            INSERT INTO incidents (tenant_id, source_vendor, vendor_incident_id, title, description, severity, status, raw_payload)
            VALUES (:tid, 'xsiam', 'XSIAM-12345', 'Suspicious File Activity and C2 Communication', 
                    'Multi-stage attack involving a malicious dropper and subsequent C2 callback.', 
                    'high', 'new', :raw)
        """), {
            "tid": tenant_id,
            "raw": json.dumps(raw_payload)
        })
        conn.commit()
    print("✅ Seeded XSIAM rich incident.")

if __name__ == "__main__":
    seed_xsiam_incident()
