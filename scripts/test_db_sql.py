import asyncio
import asyncpg

async def test():
    conn = await asyncpg.connect("postgresql://soc_admin:soc_secret_2024@postgres:5432/central_soc")
    try:
        await conn.execute("""
            CREATE TEMP TABLE test_inc (
                last_updated_at timestamp with time zone NOT NULL DEFAULT NOW()
            );
            INSERT INTO test_inc (last_updated_at) VALUES (COALESCE(CAST($1 AS timestamp with time zone), NOW()));
        """, None)
        print("Success for NULL")
        await conn.execute("""
            INSERT INTO test_inc (last_updated_at) VALUES (COALESCE(CAST($1 AS timestamp with time zone), NOW()));
        """, '2024-01-01T00:00:00Z')
        print("Success for string")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(test())
