-- ============================================================
-- Migration: Fix incident uniqueness constraint to be tenant-aware
-- Run this on the database BEFORE deploying normalization-service
-- ============================================================

-- Drop the old cross-tenant unique constraint (name may differ based on your schema).
-- The old constraint was only on (source_vendor, vendor_incident_id) which allows
-- different tenants to collide. We replace it with a tenant-aware one.

DO $$
DECLARE
    t_schema TEXT;
BEGIN
    -- Apply the constraint to each tenant schema
    FOR t_schema IN
        SELECT schema_name FROM public.tenants
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.incidents
             DROP CONSTRAINT IF EXISTS incidents_source_vendor_vendor_incident_id_key;',
            t_schema
        );
        EXECUTE format(
            'ALTER TABLE %I.incidents
             DROP CONSTRAINT IF EXISTS incidents_tenant_vendor_unique;',
            t_schema
        );
        EXECUTE format(
            'ALTER TABLE %I.incidents
             ADD CONSTRAINT incidents_tenant_vendor_unique
             UNIQUE (tenant_id, source_vendor, vendor_incident_id);',
            t_schema
        );
        RAISE NOTICE 'Updated constraint for schema: %', t_schema;
    END LOOP;
END;
$$;
