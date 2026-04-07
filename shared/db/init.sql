-- ═══════════════════════════════════════════════════════════════════
--  Central SOC Dashboard — PostgreSQL Schema (Schema-per-Tenant)
-- ═══════════════════════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────
--  ENUMS
-- ─────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('super_admin', 'customer_admin', 'analyst');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE incident_severity AS ENUM ('critical', 'high', 'medium', 'low', 'informational');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE incident_status AS ENUM ('new', 'triaging', 'in_progress', 'resolved', 'false_positive', 'escalated');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ─────────────────────────────────────────────────
--  GLOBAL TABLES (public schema)
-- ─────────────────────────────────────────────────

-- 1. Tenants
CREATE TABLE IF NOT EXISTS tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL UNIQUE,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    schema_name     VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    logo_url        TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    plan            VARCHAR(50) NOT NULL DEFAULT 'enterprise',
    contact_email   VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL for super_admin
    email           VARCHAR(255) NOT NULL UNIQUE,
    full_name       VARCHAR(255) NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'analyst',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login      TIMESTAMPTZ,
    signature       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Refresh Tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Master Incidents (for inheritance/unified view)
CREATE TABLE IF NOT EXISTS incidents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID REFERENCES tenants(id) ON DELETE CASCADE,
    ticket_id           VARCHAR(100),
    source_vendor       VARCHAR(100) NOT NULL,
    vendor_incident_id  VARCHAR(512) NOT NULL,
    vendor_url          TEXT,
    title               TEXT NOT NULL,
    description         TEXT,
    severity            VARCHAR(50) NOT NULL DEFAULT 'medium',
    status              VARCHAR(50) NOT NULL DEFAULT 'new',
    assigned_to         UUID REFERENCES users(id) ON DELETE SET NULL,
    affected_hosts      JSONB NOT NULL DEFAULT '[]',
    affected_users      JSONB NOT NULL DEFAULT '[]',
    iocs                JSONB NOT NULL DEFAULT '[]',
    mitre_tactics       JSONB NOT NULL DEFAULT '[]',
    mitre_techniques    JSONB NOT NULL DEFAULT '[]',
    tags                JSONB NOT NULL DEFAULT '[]',
    raw_payload         JSONB NOT NULL DEFAULT '{}',
    source_created_at   TIMESTAMPTZ,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ,
    ai_verdict          TEXT,
    ai_status           VARCHAR(50) DEFAULT 'none', -- none, pending, completed
    agentic_job_id      TEXT,
    first_response_at   TIMESTAMPTZ,
    assigned_at         TIMESTAMPTZ,
    sla_first_response_breached BOOLEAN DEFAULT FALSE,
    sla_resolution_breached     BOOLEAN DEFAULT FALSE,
    sla_fr_warning_sent         BOOLEAN DEFAULT FALSE,
    sla_res_warning_sent        BOOLEAN DEFAULT FALSE,
    sla_fr_notified             BOOLEAN DEFAULT FALSE,
    sla_res_notified            BOOLEAN DEFAULT FALSE,
    assigned_team_id            UUID,
    escalation_level            INT DEFAULT 0,
    last_escalated_at           TIMESTAMPTZ,
    next_escalation_check_at    TIMESTAMPTZ,
    notification_message_id     TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID REFERENCES tenants(id) ON DELETE SET NULL,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(100) NOT NULL,
    resource_type   VARCHAR(100),
    resource_id     UUID,
    old_values      JSONB,
    new_values      JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. SLA Configs
CREATE TABLE IF NOT EXISTS sla_configs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    first_response_min      INTEGER NOT NULL DEFAULT 30,
    resolution_min          INTEGER NOT NULL DEFAULT 1440,
    customer_reply_min      INTEGER NOT NULL DEFAULT 60,
    escalation_response_min INTEGER NOT NULL DEFAULT 15,
    severity_targets        JSONB DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id)
);

-- 6b. SLA Events
CREATE TABLE IF NOT EXISTS sla_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL,
    tenant_id   UUID NOT NULL,
    event_type  VARCHAR(100) NOT NULL,
    actor_id    UUID,
    old_value   TEXT,
    new_value   TEXT,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sla_events_incident ON sla_events(incident_id);
CREATE INDEX IF NOT EXISTS idx_sla_events_tenant   ON sla_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sla_events_type     ON sla_events(event_type);

-- 7. Tenant Teams (Escalation)
CREATE TABLE IF NOT EXISTS tenant_teams (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Team Escalation Levels
CREATE TABLE IF NOT EXISTS team_escalation_levels (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id             UUID REFERENCES tenant_teams(id) ON DELETE CASCADE,
    level_number        INTEGER NOT NULL,
    escalation_time_min INTEGER DEFAULT 30,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, level_number)
);

-- 8. Level Emails
CREATE TABLE IF NOT EXISTS level_emails (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level_id        UUID REFERENCES team_escalation_levels(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Mailing Configs
CREATE TABLE IF NOT EXISTS mailing_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
    group_id        UUID DEFAULT gen_random_uuid(),
    label           VARCHAR(255) DEFAULT 'Default',
    smtp_host       VARCHAR(255),
    smtp_port       INTEGER DEFAULT 587,
    smtp_user       VARCHAR(255),
    smtp_pass       VARCHAR(255),
    imap_host       VARCHAR(255),
    imap_port       INTEGER DEFAULT 993,
    imap_user       VARCHAR(255),
    imap_pass       VARCHAR(255),
    from_email      VARCHAR(255),
    is_active       BOOLEAN DEFAULT TRUE,
    template_subject VARCHAR(255),
    template_html   TEXT,
    level_number    INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Email Interactions
CREATE TABLE IF NOT EXISTS incident_email_interactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id         UUID NOT NULL,
    message_id          TEXT UNIQUE,
    in_reply_to         TEXT,
    from_email          VARCHAR(255),
    to_email            TEXT,
    cc_email            TEXT,
    sender_name         VARCHAR(255),
    subject             TEXT,
    body                TEXT,
    direction           VARCHAR(50), -- inbound/outbound
    interaction_source  VARCHAR(50) DEFAULT 'email', -- email | freshservice | freshdesk | servicenow
    has_attachments     BOOLEAN DEFAULT FALSE,
    attachment_names    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Incident Attachments
CREATE TABLE IF NOT EXISTS incident_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    interaction_id  UUID REFERENCES incident_email_interactions(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    content_type    VARCHAR(100),
    data            BYTEA NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────
--  PROVISIONING FUNCTION
-- ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION provision_tenant_schema(t_schema_name TEXT)
RETURNS VOID AS $$
BEGIN
    -- 1. Create Schema
    EXECUTE 'CREATE SCHEMA IF NOT EXISTS ' || quote_ident(t_schema_name);
    
    -- 2. Connector Configs in schema
    EXECUTE 'CREATE TABLE IF NOT EXISTS ' || quote_ident(t_schema_name) || '.connector_configs (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor              VARCHAR(100) NOT NULL,
        label               VARCHAR(255),
        is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
        poll_interval_sec   INTEGER NOT NULL DEFAULT 300,
        credentials         JSONB NOT NULL DEFAULT ''{}'',
        last_polled_at      TIMESTAMPTZ,
        last_poll_status    VARCHAR(50),
        last_error_msg      TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(vendor, label)
    )';

    -- 2b. Mailing Configs in schema (DEPRECATED - moved to public)
    -- 6. Email Interactions in schema (DEPRECATED - moved to public)

    -- 3. Incidents in schema (Inheriting from public.incidents)
    EXECUTE 'CREATE TABLE IF NOT EXISTS ' || quote_ident(t_schema_name) || '.incidents (
        PRIMARY KEY (id),
        UNIQUE(source_vendor, vendor_incident_id)
    ) INHERITS (public.incidents)';

    -- 4. Comments in schema
    EXECUTE 'CREATE TABLE IF NOT EXISTS ' || quote_ident(t_schema_name) || '.incident_comments (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id     UUID NOT NULL,
        author_id       UUID REFERENCES public.users(id) ON DELETE SET NULL,
        content         TEXT NOT NULL,
        is_internal     BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )';

    -- 7. Grant Permissions
    EXECUTE 'GRANT USAGE ON SCHEMA ' || quote_ident(t_schema_name) || ' TO soc_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ' || quote_ident(t_schema_name) || ' TO soc_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ' || quote_ident(t_schema_name) || ' TO soc_app';

END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────
--  RLS & GRANTS
-- ─────────────────────────────────────────────────

DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'soc_app') THEN
        CREATE ROLE soc_app LOGIN PASSWORD 'soc_secret_2024';
    END IF;
END $$;

GRANT CONNECT ON DATABASE central_soc TO soc_app;
GRANT USAGE ON SCHEMA public TO soc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO soc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO soc_app;

-- Enable RLS on master tables
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Master Incident Isolation
CREATE POLICY tenant_isolation_incidents ON incidents
    FOR ALL TO soc_app
    USING (
        current_setting('app.current_tenant_id', TRUE) IS NULL
        OR tenant_id::TEXT = current_setting('app.current_tenant_id', TRUE)
    );

-- Audit Log Isolation
CREATE POLICY tenant_isolation_audit ON audit_logs
    FOR ALL TO soc_app
    USING (
        current_setting('app.current_tenant_id', TRUE) IS NULL
        OR tenant_id::TEXT = current_setting('app.current_tenant_id', TRUE)
    );

-- ─────────────────────────────────────────────────
--  INDEXES & TRIGGERS
-- ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_id ON incidents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_incidents_updated_at BEFORE UPDATE ON incidents FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────────
--  INTEGRATIONS (Marketplace)
-- ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.integration_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    integration     VARCHAR(100) NOT NULL,
    is_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    config          JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, integration)
);

CREATE TABLE IF NOT EXISTS public.integration_ticket_mappings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    integration         VARCHAR(100) NOT NULL,
    soc_incident_id     UUID NOT NULL,
    external_ticket_id  VARCHAR(255) NOT NULL,
    external_ticket_url TEXT,
    sync_status         VARCHAR(50) DEFAULT 'synced',
    last_synced_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, integration, soc_incident_id)
);

CREATE INDEX IF NOT EXISTS idx_integration_configs_tenant ON public.integration_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_itm_external ON public.integration_ticket_mappings(tenant_id, integration, external_ticket_id);
CREATE INDEX IF NOT EXISTS idx_itm_soc_incident ON public.integration_ticket_mappings(soc_incident_id);

CREATE TRIGGER trg_integration_configs_updated_at
    BEFORE UPDATE ON public.integration_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
