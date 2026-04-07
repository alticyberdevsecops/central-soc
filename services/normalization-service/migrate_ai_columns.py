import os
import psycopg2
from psycopg2 import sql

DB_URL = os.environ.get("DATABASE_URL_SYNC", "postgresql://soc_admin:soc_secret_2024@postgres:5432/central_soc")
if DB_URL.startswith("postgresql+psycopg2://"):
    DB_URL = DB_URL.replace("postgresql+psycopg2://", "postgresql://")

def migrate_ai_columns():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    try:
        # 1. Add columns to base table
        print("Adding columns to public.incidents...")
        cur.execute("ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS ai_verdict TEXT;")
        cur.execute("ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'none';")

        # 2. Get all tenant schemas
        cur.execute("SELECT schema_name FROM public.tenants;")
        tenants = cur.fetchall()

        for (schema,) in tenants:
            print(f"Adding columns to {schema}.incidents...")
            # Columns might already be inherited if tables are fresh, but safe to check
            try:
                cur.execute(sql.SQL("ALTER TABLE {}.incidents ADD COLUMN IF NOT EXISTS ai_verdict TEXT;").format(sql.Identifier(schema)))
                cur.execute(sql.SQL("ALTER TABLE {}.incidents ADD COLUMN IF NOT EXISTS ai_status VARCHAR(50) DEFAULT 'none';").format(sql.Identifier(schema)))
            except Exception as e:
                print(f"Skipping {schema} (might be inherited): {e}")

        print("Migration completed successfully.")

    except Exception as e:
        print(f"Migration failed: {e}")
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    migrate_ai_columns()
