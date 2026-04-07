import httpx
import asyncio
import json

BASE_URL = "http://localhost:8012"
SUPER_ADMIN_CREDS = {"username": "superadmin@admin.com", "password": "superadmin"}

def login_and_get_incidents(email, password, role_name):
    print(f"\n--- Testing {role_name} ({email}) ---")
    
    # 1. Login
    login_data = {
        "email": email,
        "password": password
    }
    
    response = requests.post(f"{BASE_URL}/auth/login", json=login_data)
    if response.status_code != 200:
        print(f"Login failed: {response.text}")
        return
        
    token = response.json().get("access_token")
    if not token:
        print("No access token found in response.")
        return
        
    print(f"Login successful.")
    
    # 2. Get Incidents
    headers = {
        "Authorization": f"Bearer {token}"
    }
    
    response = requests.get(f"{BASE_URL}/incidents?limit=100", headers=headers)
    if response.status_code != 200:
        print(f"Failed to fetch incidents: {response.text}")
        return
        
    incidents = response.json().get("incidents", [])
    print(f"Incidents retrieved: {len(incidents)}")
    
    if len(incidents) > 0:
        vendors = set(inc["source_vendor"] for inc in incidents)
        print(f"   Vendors seen: {', '.join(vendors)}")
        
if __name__ == "__main__":
    # Super Admin (should see all 24 incidents from all vendors)
    login_and_get_incidents("super@altisec.com", "Admin@SOC2024!", "Super Admin")
    
    # HDFC Life Analyst (should see only 8 CrowdStrike incidents)
    login_and_get_incidents("analyst@hdfc-life.com", "Analyst@SOC2024!", "HDFC Analyst")
    
    # Tata Play Analyst (should see only 10 XSIAM incidents)
    login_and_get_incidents("analyst@tata-play.com", "Analyst@SOC2024!", "Tata Play Analyst")
