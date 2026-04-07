import os
import psycopg2
from psycopg2 import sql

DB_URL = "postgresql://soc_admin:soc_secret_2024@postgres:5432/central_soc"

def migrate():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    columns = ['mitre_tactics', 'mitre_techniques', 'tags']

    try:
        # 0. Get all tenant schemas
        cur.execute("SELECT schema_name FROM public.tenants;")
        tenants = cur.fetchall()
        schemas = ["public"] + [t[0] for t in tenants]

        # 1. Drop defaults in all schemas (parent and children)
        for schema in schemas:
            print(f"Dropping defaults in {schema}.incidents...")
            for col in columns:
                try:
                    cur.execute(sql.SQL("ALTER TABLE {}.incidents ALTER COLUMN {} DROP DEFAULT;").format(
                        sql.Identifier(schema), sql.Identifier(col)
                    ))
                except Exception as e:
                    print(f"  (Skipping {schema}.{col} drop default: {e})")

        # 2. Modify public.incidents (parent)
        print("Migrating public.incidents columns to JSONB...")
        for col in columns:
            cur.execute(f"ALTER TABLE public.incidents ALTER COLUMN {col} TYPE jsonb USING to_jsonb({col});")
            cur.execute(f"ALTER TABLE public.incidents ALTER COLUMN {col} SET DEFAULT '[]'::jsonb;")
            cur.execute(f"ALTER TABLE public.incidents ALTER COLUMN {col} SET NOT NULL;")

        # 3. Add back defaults in all child schemas (inheritance check)
        for schema in schemas:
            if schema == "public": continue
            print(f"Adding defaults to {schema}.incidents...")
            for col in columns:
                try:
                    cur.execute(sql.SQL("ALTER TABLE {}.incidents ALTER COLUMN {} SET DEFAULT '[]'::jsonb;").format(
                        sql.Identifier(schema), sql.Identifier(col)
                    ))
                except Exception as e:
                    print(f"  (Skipping {schema}.{col} set default: {e})")
        
        print("✅ Migration completed successfully.")

    except Exception as e:
        print(f"❌ Migration failed: {e}")
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    migrate()
