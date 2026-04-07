import asyncio
import asyncpg
import os

async def update_incidents():
    DATABASE_URL = "postgresql://soc_admin:soc_secret_2024@postgres:5432/central_soc"
    conn = await asyncpg.connect(DATABASE_URL)
    
    # 1. Get ALL incidents globally, ordered by last_updated_at DESC (matching UI)
    incidents = await conn.fetch("SELECT id, ticket_id, title FROM public.incidents ORDER BY last_updated_at DESC")
    print(f"Found {len(incidents)} total incidents globally")
    
    for i, rec in enumerate(incidents):
        new_status = 'resolved'
        if i < 3:
            new_status = 'new'
        elif i < 7: # Indices 3, 4, 5, 6 (next 4 items)
            new_status = 'in_progress'
        
        # Update via public.incidents. 
        # We explicitly set status. last_updated_at should remain the same unless changed by a trigger.
        await conn.execute("UPDATE public.incidents SET status = $1 WHERE id = $2", new_status, rec['id'])
        if i < 10:
            print(f"Updated UI rank {i} ({rec['ticket_id']}): {rec['title'][:50]} to {new_status}")

    await conn.close()
    print("✅ Successfully updated global ticket distribution for demo (aligned with UI sort).")

    await conn.close()
    print("✅ Successfully updated all tickets for demo across all tenants.")

if __name__ == "__main__":
    asyncio.run(update_incidents())
