import requests
import json
import uuid

# Configuration
AUTH_URL = "http://localhost:8013/auth/login"
INCIDENT_URL = "http://localhost:8014/incidents"
EMAIL = "superadmin@admin.com"
PASSWORD = "superadmin"

def verify():
    print("--- Starting Verification Script ---")
    
    # 1. Login
    print(f"Logging in as {EMAIL}...")
    try:
        resp = requests.post(AUTH_URL, json={"email": EMAIL, "password": PASSWORD})
        resp.raise_for_status()
        login_data = resp.json()
        token = login_data["access_token"]
        tenant_id = login_data["user"].get("tenant_id")
        
        # If superadmin doesn't have a specific tenant, we need to find one
        if not tenant_id:
             tenant_ids = login_data["user"].get("tenant_ids", [])
             if tenant_ids:
                 tenant_id = str(tenant_ids[0])
        
        print(f"Login successful. Using Tenant ID: {tenant_id}")
    except Exception as e:
        print(f"Login failed: {e}")
        return

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # 2. Create Incident with IOCs
    ticket_id = f"TEST-IOC-{uuid.uuid4().hex[:6].upper()}"
    payload = {
        "title": f"Verification Incident for IOC Fix - {ticket_id}",
        "description": "Testing if IOCs are saved in raw_payload during creation.",
        "severity": "medium",
        "status": "new",
        "tenant_id": tenant_id,
        "iocs": [
            {"category": "IP", "signature": "1.2.3.4", "domain_name": "malicious.com"},
            {"category": "Hash", "signature": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "domain_name": ""}
        ],
        "asset_details": [{"detection_method": "Script Test", "source_ip": "10.0.0.1", "log_source": "Python", "action": "block"}],
        "tags": ["verification", "ioc-fix"],
        "affected_hosts": ["srv-verify-01"],
        "affected_users": ["admin-verify"]
    }

    print(f"Creating incident {ticket_id}...")
    try:
        resp = requests.post(INCIDENT_URL, json=payload, headers=headers)
        resp.raise_for_status()
        created_id = resp.json()["id"]
        print(f"Incident created with ID: {created_id}")
    except Exception as e:
        print(f"Creation failed: {e}")
        if 'resp' in locals():
            print(f"Response: {resp.text}")
        return

    # 3. Fetch Incident and Verify raw_payload
    print(f"Fetching incident {created_id} to verify raw_payload...")
    try:
        resp = requests.get(f"{INCIDENT_URL}/{created_id}", headers=headers)
        resp.raise_for_status()
        incident_data = resp.json()
        
        raw_payload = incident_data.get("raw_payload", {})
        if isinstance(raw_payload, str):
            try:
                raw_payload = json.loads(raw_payload)
            except:
                pass
            
        iocs = raw_payload.get("iocs", [])
        print(f"IOCs found in raw_payload: {json.dumps(iocs, indent=2)}")
        
        if len(iocs) == 2 and (iocs[0].get("signature") == "1.2.3.4" or iocs[1].get("signature") == "1.2.3.4"):
            print("SUCCESS: IOCs are present in raw_payload!")
        else:
            print("FAILURE: IOCs are missing or incorrect in raw_payload.")
            
        # Verify other fields too
        tags = raw_payload.get("tags", [])
        if "ioc-fix" in tags:
            print("SUCCESS: Tags are present in raw_payload!")
        else:
            print("FAILURE: Tags are missing from raw_payload.")

    except Exception as e:
        print(f"Verification failed: {e}")

    # 4. Verify Patch works (to fix the AmbiguousParameterError)
    print(f"Patching incident {created_id} to verify update works...")
    patch_data = {
        "status": "in_progress",
        "title": f"Updated Verification Incident {ticket_id}",
        "tags": ["verified", "patched"]
    }
    try:
        patch_response = requests.patch(f"{INCIDENT_URL}/{created_id}", json=patch_data, headers=headers)
        if patch_response.status_code == 200:
            print("SUCCESS: Patch incident returned 200 OK!")
        else:
            print(f"FAILED: Patch incident returned {patch_response.status_code}")
            print(patch_response.text)
    except Exception as e:
        print(f"Patch failed: {e}")

if __name__ == "__main__":
    verify()
