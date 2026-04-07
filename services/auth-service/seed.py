"""
Seed Script — Populates the Central SOC with 3 demo tenants, users, connectors, and mock incidents.
Run: docker compose exec normalization-service python /app/scripts/seed.py
  or: python scripts/seed.py (from monorepo root, with venv)
"""
import os
import sys
import json
import uuid
import random
from datetime import datetime, timezone, timedelta

import psycopg2
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

DB_URL = os.environ.get(
    "DATABASE_URL_SEED",
    "postgresql://soc_admin:soc_secret_2024@postgres:5432/central_soc"
)
SUPER_ADMIN_PASSWORD = os.environ.get("SEED_SUPER_ADMIN_PASSWORD", "Admin@SOC2024!")
ANALYST_PASSWORD = os.environ.get("SEED_ANALYST_PASSWORD", "Analyst@SOC2024!")


def connect():
    return psycopg2.connect(DB_URL)


TENANTS = [
    {
        "name": "Tata Play (BFSI)",
        "slug": "tata-play",
        "description": "Tata Play financial services — XSIAM deployment",
        "contact_email": "soc@tataplay.com",
        "primary_vendor": "xsiam",
    },
    {
        "name": "HDFC Life Insurance",
        "slug": "hdfc-life",
        "description": "HDFC Life Insurance — CrowdStrike Falcon deployment",
        "contact_email": "soc@hdfclife.com",
        "primary_vendor": "crowdstrike",
    },
    {
        "name": "Kotak Mahindra Bank",
        "slug": "kotak-bank",
        "description": "Kotak Mahindra Bank — Microsoft Defender + SentinelOne",
        "contact_email": "soc@kotak.com",
        "primary_vendor": "defender",
    },
]

INCIDENT_TEMPLATES = {
    "xsiam": [
        ("Ransomware Activity Detected on Finance Workstation", "critical", "FIN-WS-001", "TA0040", "T1486"),
        ("Credential Harvesting via Mimikatz", "critical", "DC-PROD-01", "TA0006", "T1003"),
        ("Phishing Email with Macro Payload Opened", "high", "HR-LT-042", "TA0001", "T1566.001"),
        ("Suspicious PowerShell Empire C2 Beacon", "high", "IT-SRV-012", "TA0011", "T1059.001"),
        ("Lateral Movement via WMI Exec", "high", "FIN-WS-007", "TA0008", "T1047"),
        ("Anomalous Data Exfiltration — 2.3GB", "critical", "DBA-SRV-01", "TA0010", "T1041"),
        ("Brute Force — 247 Failed Logins on VPN", "high", "VPN-GW-01", "TA0006", "T1110"),
        ("Malicious DLL Side-Loading Detected", "medium", "SAP-SRV-03", "TA0005", "T1574.002"),
        ("Suspicious DNS Tunneling Traffic", "medium", "KIOSK-05", "TA0011", "T1071.004"),
        ("Privilege Escalation via Token Impersonation", "high", "ADMIN-WS-01", "TA0004", "T1134"),
    ],
    "crowdstrike": [
        ("Falcon Complete: Active Ransomware Kill Chain Blocked", "critical", "SALES-LT-88", "TA0040", "T1486"),
        ("Spear Phishing Attachment — CFO Targeted", "critical", "CFO-LT-001", "TA0001", "T1566.001"),
        ("Process Hollow Injection into svchost.exe", "high", "WIN-SRV-2022", "TA0005", "T1055.012"),
        ("USB External Drive Mass Data Copy", "high", "AUDIT-WS-02", "TA0009", "T1052"),
        ("Golden Ticket Attack Detected in AD", "critical", "DC-BACKUP-01", "TA0006", "T1558.001"),
        ("Cobalt Strike Beacon C2 Communication", "critical", "IT-WS-042", "TA0011", "T1071.001"),
        ("Scheduled Task Created for Persistence", "medium", "MGMT-JUMP-01", "TA0003", "T1053.005"),
        ("Registry Run Key Modification", "low", "USER-LT-019", "TA0003", "T1547.001"),
    ],
    "defender": [
        ("BEC — Finance Team Email Account Compromised", "critical", "M365-CLOUD", "TA0001", "T1566"),
        ("Azure AD Sign-In from Impossible Travel", "high", "AZURE-AD", "TA0001", "T1078"),
        ("SharePoint Bulk File Download Detected", "high", "SHAREPOINT-01", "TA0009", "T1213"),
        ("Macro-Enabled XLSM Execution Chain", "high", "MGMT-WS-007", "TA0002", "T1204.002"),
        ("Suspicious OAuth App Consent Granted", "high", "M365-CLOUD", "TA0001", "T1566.002"),
        ("Defender Blocked EternalBlue Exploit Attempt", "critical", "LEGACY-SRV-01", "TA0008", "T1210"),
    ],
    "sentinelone": [
        ("Fileless Malware Executed via PowerShell", "critical", "APP-SRV-012", "TA0002", "T1059.001"),
        ("Trojan Dropper Quarantined on Endpoint", "high", "KIOSK-003", "TA0002", "T1204"),
        ("Suspicious Memory Injection via RWX Pages", "high", "IT-WS-034", "TA0005", "T1055"),
        ("Cryptominer Detected — CPU Spike 97%", "medium", "DEV-WS-011", "TA0040", "T1496"),
        ("Remote Access Tool Installed by Non-Admin", "medium", "RECEPTION-01", "TA0011", "T1219"),
    ],
}

STATUSES = ["new", "new", "new", "triaging", "in_progress", "resolved", "false_positive"]


def seed():
    conn = connect()
    cur = conn.cursor()

    print("🌱 Starting seed process...\n")

    # ── Super Admin ─────────────────────────────────
    super_admin_id = str(uuid.uuid4())
    cur.execute("""
        INSERT INTO users (id, tenant_id, email, full_name, hashed_password, role)
        VALUES (%s, NULL, 'super@altisec.com', 'AltiSec Super Admin', %s, 'super_admin')
        ON CONFLICT (email) DO UPDATE SET hashed_password = EXCLUDED.hashed_password
        RETURNING id
    """, (super_admin_id, pwd_context.hash(SUPER_ADMIN_PASSWORD)))
    result = cur.fetchone()
    if result:
        super_admin_id = str(result[0])
    conn.commit()
    print(f"✅ Super Admin: super@altisec.com / {SUPER_ADMIN_PASSWORD}")

    # ── Tenants + Users + Connectors + Incidents ────
    for tenant_def in TENANTS:
        tenant_id = str(uuid.uuid4())

        # Create tenant
        schema_name = f"tenant_{tenant_def['slug'].replace('-', '_')}"
        cur.execute("""
            INSERT INTO tenants (id, name, slug, schema_name, description, contact_email)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
        """, (tenant_id, tenant_def["name"], tenant_def["slug"], schema_name, tenant_def["description"], tenant_def["contact_email"]))
        result = cur.fetchone()
        if result:
            tenant_id = str(result[0])

        # Provision schema
        cur.execute("SELECT provision_tenant_schema(%s)", (schema_name,))

        # Customer admin
        admin_email = f"admin@{tenant_def['slug']}.com"
        cur.execute("""
            INSERT INTO users (tenant_id, email, full_name, hashed_password, role)
            VALUES (%s, %s, %s, %s, 'customer_admin')
            ON CONFLICT (email) DO NOTHING
        """, (tenant_id, admin_email, f"Admin - {tenant_def['name']}", pwd_context.hash(SUPER_ADMIN_PASSWORD)))

        # Analyst
        analyst_email = f"analyst@{tenant_def['slug']}.com"
        cur.execute("""
            INSERT INTO users (tenant_id, email, full_name, hashed_password, role)
            VALUES (%s, %s, %s, %s, 'analyst')
            ON CONFLICT (email) DO NOTHING
        """, (tenant_id, analyst_email, f"SOC Analyst - {tenant_def['name']}", pwd_context.hash(ANALYST_PASSWORD)))

        # Connector config in tenant schema
        vendor = tenant_def["primary_vendor"]
        cur.execute("SET search_path TO %s, public" % schema_name)
        cur.execute("""
            INSERT INTO connector_configs (vendor, label, is_enabled, poll_interval_sec, credentials, last_poll_status)
            VALUES (%s, %s, %s, %s, %s::jsonb, 'ok')
            ON CONFLICT (vendor, label) DO NOTHING
        """, (vendor, f"{tenant_def['name']} Primary", True, 300, json.dumps({"mock": True})))

        conn.commit()
        print(f"\n✅ Tenant: {tenant_def['name']}")
        print(f"   Admin:   {admin_email} / {SUPER_ADMIN_PASSWORD}")
        print(f"   Analyst: {analyst_email} / {ANALYST_PASSWORD}")

        # Seed incidents for this tenant's vendor
        incidents = INCIDENT_TEMPLATES.get(vendor, [])
        seeds = 0
        for title, severity, hostname, tactic, technique in incidents:
            base_time = datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 72))
            ip = f"10.{random.randint(1, 254)}.{random.randint(1, 254)}.{random.randint(1, 254)}"
            iocs = [
                {"type": "ip", "value": f"185.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}", "context": "C2 server"},
                {"type": "file_hash_sha256", "value": uuid.uuid4().hex * 2, "context": "Malware sample"},
                {"type": "domain", "value": f"malware-{uuid.uuid4().hex[:8]}.net", "context": "C2 domain"},
            ]
            cur.execute(f"SET search_path TO {schema_name}, public")
            cur.execute("""
                INSERT INTO incidents (
                    tenant_id, source_vendor, vendor_incident_id, title, description,
                    severity, status, affected_hosts, affected_users, iocs,
                    mitre_tactics, mitre_techniques, raw_payload, source_created_at, first_seen_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s,
                    %s::jsonb, %s::jsonb, %s::jsonb,
                    %s::jsonb, %s::jsonb, %s::jsonb, %s, %s
                )
                ON CONFLICT (source_vendor, vendor_incident_id) DO NOTHING
            """, (
                tenant_id, vendor, f"{vendor.upper()}-SEED-{uuid.uuid4().hex[:8].upper()}",
                title, f"[Demo Data] {title}. Detected by {vendor.upper()} security platform.",
                severity, random.choice(STATUSES),
                json.dumps([{"hostname": hostname, "ip": ip, "os": "Windows Server 2022"}]),
                json.dumps([{"username": "svc_account", "domain": "CORP"}]),
                json.dumps(iocs),
                json.dumps([tactic]), json.dumps([technique]),
                json.dumps({"seed": True, "vendor": vendor, "title": title}),
                base_time.isoformat(), base_time.isoformat()
            ))
            seeds += 1

        conn.commit()
        print(f"   Incidents seeded: {seeds} ({vendor.upper()})")

    cur.close()
    conn.close()
    print("\n\n🎉 Seed complete! Login at http://localhost:8011")
    print("━" * 50)
    print(f"  Super Admin: super@altisec.com / {SUPER_ADMIN_PASSWORD}")
    print(f"  HDFC Admin:  admin@hdfc-life.com / {SUPER_ADMIN_PASSWORD}")
    print(f"  HDFC Analyst: analyst@hdfc-life.com / {ANALYST_PASSWORD}")
    print("━" * 50)


if __name__ == "__main__":
    seed()
