import asyncio
import httpx
from sqlalchemy import text
from incidents.database import AsyncSessionLocal
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:8012"
WEBHOOK_URL = f"{BASE_URL}/incidents/webhooks/autonomous-report"

async def verify_fix():
    print("--- Starting AI Trigger Fix Verification ---")
    
    async with AsyncSessionLocal() as db:
        # 1. Find a test incident or create one
        print("1. Identifying test incident...")
        res = await db.execute(text("SELECT id, ticket_id, ai_status, status FROM incidents LIMIT 1"))
        incident = res.mappings().first()
        
        if not incident:
            print("ERROR: No incidents found to test with. Run seed.py first.")
            return

        iid = str(incident["id"])
        tid = incident["ticket_id"]
        print(f"   Testing with Ticket ID: {tid} (UUID: {iid})")
        print(f"   Current ai_status: {incident['ai_status']}, Main status: {incident['status']}")

        # 2. Reset status for clean test
        print("2. Resetting incident status to 'none' and 'new'...")
        await db.execute(text("UPDATE incidents SET ai_status = 'none', status = 'new' WHERE id = :iid"), {"iid": iid})
        await db.commit()

        # 3. Test Webhook (Should be REJECTED)
        print("3. Attempting unsolicited AI report (ai_status is 'none')...")
        payload = {
            "incident_id": iid,
            "ticket_id": tid,
            "status": "completed",
            "analysis_report": "This should be rejected",
            "timestamp": datetime.now().isoformat()
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(WEBHOOK_URL, json=payload)
            print(f"   Response Code: {resp.status_code}")
            print(f"   Response Body: {resp.text}")
            
            if resp.status_code == 200 and '"status":"rejected"' in resp.text:
                print("   SUCCESS: Webhook rejected the unsolicited report.")
            else:
                print("   FAILURE: Webhook did not reject as expected.")

        # 4. Simulate Triggering Analysis (Sets ai_status to 'pending' and status to 'ai triaging')
        print("4. Simulating analysis trigger (setting ai_status='pending', status='ai triaging')...")
        await db.execute(text("UPDATE incidents SET ai_status = 'pending', status = 'ai triaging' WHERE id = :iid"), {"iid": iid})
        await db.commit()

        # 5. Test Webhook (Should be ACCEPTED)
        print("5. Attempting authorized AI report (ai_status is 'pending')...")
        payload["analysis_report"] = "Authorized AI analysis report"
        async with httpx.AsyncClient() as client:
            resp = await client.post(WEBHOOK_URL, json=payload)
            print(f"   Response Code: {resp.status_code}")
            print(f"   Response Body: {resp.text}")
            
            if resp.status_code == 200 and '"status":"accepted"' in resp.text:
                print("   SUCCESS: Webhook accepted the authorized report.")
            else:
                print("   FAILURE: Webhook rejected the authorized report.")

        # 6. Verify Final Database State
        print("6. Verifying final database state...")
        res = await db.execute(text("SELECT ai_status, status FROM incidents WHERE id = :iid"), {"iid": iid})
        updated = res.mappings().first()
        print(f"   Final state -> ai_status: {updated['ai_status']}, Main status: {updated['status']}")
        
        if updated['ai_status'] == 'completed':
            print("   SUCCESS: Incident updated to 'completed' after authorized report.")
        else:
            print("   FAILURE: Incident ai_status not updated correctly.")

if __name__ == "__main__":
    asyncio.run(verify_fix())
