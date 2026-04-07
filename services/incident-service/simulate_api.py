import asyncio
from sqlalchemy import text
from incidents.database import AsyncSessionLocal

async def simulate_route(incident_id: str):
    async with AsyncSessionLocal() as db:
        print(f"--- Simulating get_incident_interactions('{incident_id}') ---")
        
        # 1. Logic from routes.py: find incident
        is_uuid = False
        try:
            import uuid
            uuid.UUID(incident_id)
            is_uuid = True
        except: pass
        
        val = incident_id
        if is_uuid:
            sql_find = text(f"SELECT id FROM public.incidents WHERE id = CAST(:iid AS UUID)")
        else:
            sql_find = text(f"SELECT id FROM public.incidents WHERE ticket_id = :iid")
            
        i_res = await db.execute(sql_find, {"iid": val})
        incident = i_res.mappings().first()
        if not incident:
            print("Incident NOT FOUND in public.incidents")
            return
            
        print(f"Found Incident UUID: {incident['id']}")
        
        # 2. Query interactions
        sql = text("""
            SELECT id, subject, direction, created_at FROM public.incident_email_interactions 
            WHERE incident_id = :iid 
            ORDER BY created_at ASC
        """)
        res = await db.execute(sql, {"iid": incident["id"]})
        interactions = res.mappings().all()
        
        print(f"Interactions found by route logic: {len(interactions)}")
        for i in interactions:
            print(f"  - {i['direction']} | {i['subject']} | {i['created_at']}")

if __name__ == "__main__":
    import sys
    iid = sys.argv[1] if len(sys.argv) > 1 else 'ATPL-0001'
    asyncio.run(simulate_route(iid))
