# Central SOC — Role-Based Access Control (RBAC) Feature Roadmap

## Current State

- **2 roles**: `super_admin` and `analyst` (stored in cookies)
- **UI-only gating** — sidebar shows/hides pages based on role
- **No backend enforcement** — API routes don't check permissions
- **No granular permissions** — all-or-nothing access

---

## Role Hierarchy

```
Super Admin (Platform Level)
  └── Tenant Admin (Org Level)
       └── SOC Manager
            └── Senior Analyst
                 └── Analyst (L1)
                      └── Viewer (Read-Only)
```

| Role | Scope | Purpose |
|------|-------|---------|
| **Super Admin** | Platform-wide | Manage all tenants, connectors, users, system config |
| **Tenant Admin** | Single tenant | Manage their org's users, settings, integrations |
| **SOC Manager** | Single tenant | Oversee all incidents, assign work, view reports, manage SLAs |
| **Senior Analyst** | Single tenant | Handle escalations, approve closures, manage playbooks |
| **Analyst (L1)** | Single tenant | Triage, investigate, resolve incidents |
| **Viewer** | Single tenant | Read-only dashboard access (for executives, auditors, clients) |

---

## Permission Categories

### Incident Permissions
- `incidents.view` — See incident list & details
- `incidents.create` — Manually create incidents
- `incidents.update` — Edit severity, status, details
- `incidents.delete` — Delete incidents (very restricted)
- `incidents.assign` — Assign/reassign to analysts
- `incidents.escalate` — Escalate to higher tier
- `incidents.close` — Close/resolve incidents
- `incidents.bulk_action` — Perform bulk operations
- `incidents.export` — Export incident data

### Verdict / AI Permissions
- `verdicts.view` — See AI verdicts
- `verdicts.trigger` — Trigger AI analysis
- `verdicts.override` — Override AI verdict with manual one

### User Management
- `users.view` — See user list
- `users.create` — Create new users
- `users.edit` — Edit user roles/details
- `users.deactivate` — Disable user accounts

### Tenant / Platform
- `tenants.view` — See tenant list
- `tenants.create` — Onboard new tenants
- `tenants.edit` — Edit tenant config
- `connectors.manage` — Add/edit/delete connectors

### Reporting
- `reports.view` — View dashboards & reports
- `reports.export` — Export reports
- `reports.schedule` — Set up scheduled reports

### Settings
- `settings.sla` — Configure SLA policies
- `settings.playbooks` — Manage playbooks
- `settings.notifications` — Configure notification rules
- `settings.automation` — Manage workflow automation rules

---

## Permission Matrix

| Permission | Super Admin | Tenant Admin | SOC Manager | Sr. Analyst | Analyst | Viewer |
|------------|:-----------:|:------------:|:-----------:|:-----------:|:-------:|:------:|
| incidents.view | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| incidents.create | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| incidents.update | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| incidents.assign | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| incidents.escalate | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| incidents.close | ✅ | ✅ | ✅ | ✅ | ❌* | ❌ |
| incidents.delete | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| incidents.bulk_action | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| incidents.export | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| verdicts.view | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| verdicts.trigger | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| verdicts.override | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| users.view | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| users.create | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| users.edit | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| users.deactivate | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| tenants.view | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| tenants.create | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| tenants.edit | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| connectors.manage | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| reports.view | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| reports.export | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| reports.schedule | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| settings.sla | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| settings.playbooks | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| settings.notifications | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| settings.automation | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

> *\*Analyst can close only Low/Medium severity incidents — Critical/High require Senior Analyst or above*

---

## Custom Roles (Advanced)

Allow tenant admins to create custom roles beyond the fixed hierarchy:

```
Custom Role: "Threat Hunter"
  ├── incidents.view       ✅
  ├── incidents.update     ✅
  ├── incidents.create     ✅
  ├── verdicts.trigger     ✅
  ├── reports.view         ✅
  └── everything else      ❌

Custom Role: "Compliance Auditor"
  ├── incidents.view       ✅
  ├── incidents.export     ✅
  ├── reports.view         ✅
  ├── reports.export       ✅
  └── everything else      ❌
```

- Custom roles are scoped to a single tenant
- Tenant admins can create/edit/delete custom roles
- Cannot grant permissions higher than their own role
- System roles (Super Admin, Tenant Admin) cannot be modified

---

## Scoped Permissions (Data-Level Access)

Beyond action permissions, control **what data** users can access:

### Tenant Scoping
- Users only see their own tenant's data
- Super Admin can switch between tenant contexts

### Severity Scoping
- L1 Analysts only see Medium/Low/Informational incidents
- Critical/High incidents route directly to Senior Analyst queue
- Configurable per tenant

### Source Scoping
- Analyst A handles XSIAM alerts only
- Analyst B handles CrowdStrike alerts only
- Useful for specialized teams

### Tag Scoping
- Only "Compliance Team" role sees incidents tagged `compliance`
- Only "Threat Intel" role sees incidents tagged `apt` or `campaign`
- Tag-based visibility rules

---

## Backend Enforcement Strategy

### Three-Layer Defense

```
┌─────────────────────────────────────┐
│  Layer 1: UI (hide/show/disable)    │  ← Visual gating
├─────────────────────────────────────┤
│  Layer 2: API Middleware (guard)    │  ← Route-level enforcement
├─────────────────────────────────────┤
│  Layer 3: DB Row-Level Security     │  ← Data-level isolation
└─────────────────────────────────────┘
```

### Layer 1 — UI Gating
- Hide sidebar items the user can't access
- Disable buttons they don't have permission for
- Show greyed-out states with lock icon + tooltip ("Requires SOC Manager role")
- Better UX than hiding — users know features exist

### Layer 2 — API Middleware
- `@require_permission("incidents.assign")` decorator on FastAPI routes
- JWT token contains role + permissions (no DB lookup per request)
- Return `403 Forbidden` with clear error message
- Log all permission denied events

### Layer 3 — Database Row-Level Security
- PostgreSQL RLS policies enforce tenant isolation
- Even if API code has a bug, data can't leak across tenants
- `ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;`
- Policy: `CREATE POLICY tenant_isolation ON incidents USING (tenant_id = current_setting('app.tenant_id'))`

---

## Database Schema

### Core RBAC Tables

```sql
-- Roles table
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,           -- e.g., "soc_manager"
    display_name VARCHAR(100) NOT NULL,  -- e.g., "SOC Manager"
    description TEXT,
    tenant_id UUID REFERENCES tenants(id),  -- NULL = platform-level role
    is_system BOOLEAN DEFAULT false,     -- true = cannot be deleted/modified
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(name, tenant_id)
);

-- Permissions table
CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) UNIQUE NOT NULL,   -- e.g., "incidents.assign"
    category VARCHAR(50) NOT NULL,       -- e.g., "incidents"
    display_name VARCHAR(100) NOT NULL,  -- e.g., "Assign Incidents"
    description TEXT
);

-- Role-Permission mapping (many-to-many)
CREATE TABLE role_permissions (
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Users table (extend existing)
ALTER TABLE users ADD COLUMN role_id UUID REFERENCES roles(id);
ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN last_login TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT false;
```

### Seed Data — System Roles

```sql
INSERT INTO roles (name, display_name, is_system) VALUES
('super_admin', 'Super Admin', true),
('tenant_admin', 'Tenant Admin', true),
('soc_manager', 'SOC Manager', true),
('senior_analyst', 'Senior Analyst', true),
('analyst', 'Analyst', true),
('viewer', 'Viewer', true);
```

---

## UI Pages for RBAC Management

### 1. User Management Page (`/settings/users`)
- User list with role, status, last login, incident count
- Invite new user (email invitation flow)
- Edit user role via dropdown
- Activate/deactivate user toggle
- Search & filter by role, status
- Visible to: Tenant Admin+

### 2. Role Management Page (`/settings/roles`)
- List of all roles (system + custom)
- Create custom role with permission checkboxes
- Edit custom role permissions
- Delete custom role (reassign users first)
- Role comparison view (side-by-side)
- Visible to: Tenant Admin+

### 3. Permission Denied States
- Greyed-out buttons with lock icon
- Tooltip: "You need SOC Manager role to perform this action"
- "Request Access" button that notifies Tenant Admin
- Consistent styling across all restricted features

### 4. Activity / Audit Log (`/settings/audit-log`)
- Track all RBAC-related events:
  - "Role changed: john@acme.com from Analyst → Senior Analyst by admin@acme.com"
  - "Permission denied: john@acme.com attempted incidents.delete"
  - "New user invited: jane@acme.com as Analyst by admin@acme.com"
  - "Custom role created: Threat Hunter by admin@acme.com"
- Filterable by user, action type, date range
- Exportable for compliance

---

## Security Features

### 1. Break-Glass Access
- Emergency elevated access for critical incidents
- Temporary role escalation (e.g., Analyst → SOC Manager for 1 hour)
- Requires justification text
- Fully logged and audited
- Auto-reverts after time expires
- Notification sent to Tenant Admin

### 2. Dual Authorization
- Critical actions require two people to approve:
  - Delete incident
  - Override AI verdict on Critical severity
  - Deactivate user account
  - Modify automation rules
- Approval workflow: Request → Pending → Approved/Rejected
- Approval notifications via email + in-app

### 3. Session Security
- **Session timeout**: Auto-logout after inactivity
  - Analyst: 15 minutes
  - Manager: 30 minutes
  - Admin: 60 minutes
  - Configurable per role
- **Concurrent session limit**: Max 2 active sessions per user
- **Session termination**: Admin can force-logout any user

### 4. IP Whitelisting
- Restrict Super Admin access to specific IPs/VPN ranges
- Tenant Admin can set IP restrictions for their org
- Alert on login from new/unknown IP

### 5. MFA Enforcement
- Require MFA for Tenant Admin and above
- Optional MFA for Analyst/Viewer roles
- Support TOTP (Google Authenticator, Authy)
- Backup codes for recovery

### 6. API Key Management
- Service accounts with API keys for integrations
- Scoped API keys (read-only, specific endpoints)
- Key rotation reminders
- Usage logging per API key

---

## JWT Token Structure

```json
{
  "sub": "user-uuid-here",
  "email": "john@acme.com",
  "tenant_id": "tenant-uuid-here",
  "role": "senior_analyst",
  "permissions": [
    "incidents.view",
    "incidents.update",
    "incidents.assign",
    "incidents.escalate",
    "incidents.close",
    "verdicts.view",
    "verdicts.trigger",
    "verdicts.override",
    "reports.view",
    "reports.export",
    "settings.playbooks"
  ],
  "iat": 1709900000,
  "exp": 1709903600
}
```

- Permissions embedded in JWT — no DB lookup per request
- Short-lived tokens (1 hour) with refresh token rotation
- Permission changes take effect on next token refresh

---

## Implementation Priority

| Priority | Feature | Impact | Effort |
|----------|---------|--------|--------|
| 1 | Backend API middleware + JWT permissions | Critical | Medium |
| 2 | Fixed role hierarchy (6 system roles) | Critical | Low |
| 3 | Permission seeding + role-permission mapping | Critical | Low |
| 4 | User management page (CRUD) | High | Medium |
| 5 | UI permission gating (disable vs hide) | High | Medium |
| 6 | PostgreSQL Row-Level Security | High | Medium |
| 7 | Session security (timeout, concurrent limits) | High | Low |
| 8 | Audit log for RBAC events | High | Medium |
| 9 | MFA enforcement | Medium | Medium |
| 10 | Custom roles | Medium | Medium |
| 11 | Scoped permissions (severity, source, tag) | Medium | High |
| 12 | Break-glass access | Low | High |
| 13 | Dual authorization | Low | High |
| 14 | IP whitelisting | Low | Medium |
| 15 | API key management | Low | Medium |
