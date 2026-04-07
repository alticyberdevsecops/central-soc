-- ============================================================
-- Migration: Add agentic_job_id to incidents table
-- Run this on the database to store the Agentic SOC job ID
-- ============================================================

DO $$
DECLARE
    t_schema TEXT;
BEGIN
    -- Apply the column addition to each tenant schema
    FOR t_schema IN
        SELECT schema_name FROM public.tenants
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.incidents 
             ADD COLUMN IF NOT EXISTS agentic_job_id VARCHAR(255);',
            t_schema
        );
        RAISE NOTICE 'Added agentic_job_id to schema: %', t_schema;
    END LOOP;
END;
$$;
