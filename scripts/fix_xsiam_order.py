import asyncio
import asyncpg

async def fix_last_updated():
    conn = await asyncpg.connect("postgresql://soc_admin:soc_secret_2024@postgres:5432/central_soc")
    try:
        # Get all schemas
        schemas = await conn.fetch("SELECT schema_name FROM public.tenants")
        
        # Add public schema
        schemas_to_process = [s['schema_name'] for s in schemas]
        if 'public' not in schemas_to_process:
            schemas_to_process.append('public')
            
        total_updated = 0
            
        for schema in schemas_to_process:
            print(f"Fixing XSIAM incidents in schema: {schema}")
            await conn.execute(f"SET search_path TO {schema}, public")
            
            # Extract modification_time from raw_payload->'incident' and convert from ms to postgres timestamp
            query = f"""
                UPDATE {schema}.incidents
                SET last_updated_at = TO_TIMESTAMP((raw_payload->'incident'->>'modification_time')::bigint / 1000.0)
                WHERE source_vendor = 'xsiam'
                  AND raw_payload->'incident' ? 'modification_time'
                  AND raw_payload->'incident'->>'modification_time' IS NOT NULL;
            """
            
            status = await conn.execute(query)
            try:
                # status format usually looks like "UPDATE N"
                updated_count = int(status.split()[-1])
                total_updated += updated_count
                print(f"  -> Updated {updated_count} rows in {schema}.")
            except Exception:
                print(f"  -> Executed query. Result: {status}")
                
        print(f"Total rows updated across all schemas: {total_updated}")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(fix_last_updated())
