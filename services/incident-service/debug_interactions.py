import asyncio
from sqlalchemy import text
from incidents.database import AsyncSessionLocal

async def check():
    async with AsyncSessionLocal() as db:
        # Check all incidents with this ticket_id
        res = await db.execute(text("SELECT id, ticket_id, tenant_id, notification_message_id, created_at FROM public.incidents WHERE ticket_id = 'ATPL-0001'"))
        incidents = res.mappings().all()
        print(f"Found {len(incidents)} matching incidents in registry:")
        for idx, inc in enumerate(incidents):
            print(f"  [{idx}] UUID: {inc['id']} | Tenant: {inc['tenant_id']} | MsgID: {inc['notification_message_id']} | Created: {inc['created_at']}")
            
            # Check interactions for each
            iid = inc['id']
            res_int = await db.execute(text("SELECT id, subject, direction, created_at FROM public.incident_email_interactions WHERE incident_id = :iid ORDER BY created_at ASC"), {"iid": iid})
            interactions = res_int.mappings().all()
            print(f"    Interactions ({len(interactions)}):")
            for i in interactions:
                print(f"      - {i['direction']} | {i['subject']} | {i['created_at']}")

if __name__ == "__main__":
    asyncio.run(check())
