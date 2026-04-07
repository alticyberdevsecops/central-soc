# Central SOC Dashboard — Enterprise Multi-Tenant Platform

A production-ready **Central SOC dashboard** that aggregates security incidents from multiple customers' EDR/XDR platforms (Palo Alto XSIAM, CrowdStrike, SentinelOne, Microsoft Defender) into a single pane of glass — with **hard tenant isolation**, live WebSocket updates, and a dark enterprise UI.

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              CUSTOMER TENANTS (Layer 1)              │
│  Tata Play XSIAM │ HDFC CrowdStrike │ Kotak S1 │ …  │
└──────────────────────┬──────────────────────────────┘
                       │ REST API per tenant (API key)
                       ▼
┌─────────────────────────────────────────────────────┐
│       INGESTION + NORMALIZATION (Layer 2)           │
│  ingestion-service (connector plugins + scheduler)  │
│  normalization-service (vendor → unified schema)    │
│  Redis Queue (BullMQ)                               │
└──────────────────────┬──────────────────────────────┘
                       │ normalized events
                       ▼
┌─────────────────────────────────────────────────────┐
│          CENTRAL DATA PLATFORM (Layer 3)            │
│  PostgreSQL (RLS per tenant_id)                     │
│  Redis (dedup + WebSocket pub/sub)                  │
│  incident-service (REST + WebSocket API)            │
│  auth-service (JWT + RBAC)                          │
│  api-gateway (Nginx routing + rate limit)           │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                 SOC CONSOLE UI                      │
│  Next.js — dark theme — live WebSocket updates      │
│  Tenant switcher (super_admin only)                 │
│  Incident dashboard, detail view, analyst panel     │
└─────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|---|---|
| Backend services | Python FastAPI |
| Queue | Redis + BullMQ (Python `rq`) |
| Database | PostgreSQL 16 with Row-Level Security |
| Cache / Dedup | Redis |
| Frontend | Next.js 14 (App Router) |
| Container | Docker Compose |
| Auth | JWT (RS256) + RBAC |
| Onboarding | Multi-step Wizard (Tenant + Connector) |

---

# Mock Data Removal & Production Re-onboarding

Clear all mock tenants, incidents, and users from the Central SOC to prepare for production-like use, followed by a clean re-onboarding of the ATPL NFR customer.

## User Review Required

> [!IMPORTANT]
> This process will PERMANENTLY delete all current data in the `incidents`, `tenants`, and `connector_configs` tables. Only the `super_admin` account will be preserved.

## Proposed Changes

### Database Cleanup

- **SQL Command**: Execute TRUNCATE on `incidents`, `connector_configs`, and `tenants` tables.
- **User Cleanup**: DELETE users where `role != 'super_admin'`.

### Seeding Logic

- **Disable Seeding**: Ensure no services run `seed.py` on startup (verified in `docker-compose.yml`, it's manual).

### Re-onboarding Flow

1. **Login**: Access the dashboard as `super@altisec.com`.
2. **Onboard**: Use the `/onboarding` wizard to add **ATPL NFR**.
3. **Credentials**: Use the provided XSIAM credentials.
4. **Activation**: Trigger `/reload` to start real-time fetching.

## Verification Plan

### Automated Steps
- Query database to ensure 0 incidents and 1 tenant (post-onboarding) exist.
- Check `ingestion-service` logs for successful job scheduling for ATPL NFR.

### Manual Verification
- Verify the Dashboard is empty before onboarding.
- Verify ATPL NFR appears after onboarding.

---

## Proposed Changes

### Monorepo Root

#### [NEW] `docker-compose.yml`
Full stack: PostgreSQL, Redis, all 5 microservices, ui-console.

#### [NEW] `.env.example`
All environment variables with safe defaults.

#### [NEW] `Makefile`
Convenience commands: `make up`, `make seed`, `make logs`.

---

### Shared Schema

#### [NEW] `shared/schema/unified_incident.json`
Normalized incident model with fields: `tenant_id`, `incident_id`, `source_vendor`, `severity` (1-10), `status`, `title`, `description`, `affected_hosts[]`, `affected_users[]`, `iocs[]`, `raw_payload`, `created_at`, `updated_at`.

#### [NEW] `shared/db/init.sql`
PostgreSQL schema with:
- `tenants` table
- `users` table (tenant-bound + RBAC roles)
- `incidents` table (all tenants, RLS enforced)
- `connector_configs` table (per-tenant API keys + polling config)
- Row-Level Security policies (tenant_id = current_setting)

---

### Auth Service (`services/auth-service/`)

FastAPI service handling JWT issuance and RBAC.

#### [NEW] `main.py`, `auth/routes.py`, `auth/models.py`, `Dockerfile`
- `POST /auth/login` — returns access + refresh JWT
- `POST /auth/refresh` — rotate tokens
- `POST /auth/register` — create user (admin only)
- `GET /auth/me` — current user info
- Roles: `super_admin`, `customer_admin`, `analyst`

---

### Ingestion Service (`services/ingestion-service/`)

Plugin-based connector framework. Each connector is a Python class implementing a `ConnectorBase` interface.

#### [NEW] `connectors/base.py` — abstract interface
#### [NEW] `connectors/xsiam.py` — Palo Alto XSIAM
#### [NEW] `connectors/crowdstrike.py` — CrowdStrike Falcon
#### [NEW] `connectors/sentinelone.py` — SentinelOne
#### [NEW] `connectors/defender.py` — Microsoft Defender
#### [NEW] `scheduler.py` — APScheduler polling every 1–5 min per tenant
#### [NEW] `Dockerfile`

---

### Normalization Service (`services/normalization-service/`)

#### [NEW] `normalizer.py` — consumes Redis queue, maps vendor fields → unified schema
#### [NEW] `worker.py` — RQ worker
#### [NEW] `Dockerfile`

---

### Incident Service (`services/incident-service/`)

FastAPI service — the backend brain.

#### [NEW] `main.py`, `incidents/routes.py`, `incidents/models.py`, `Dockerfile`
- `GET /incidents` — paginated, filtered, tenant-scoped
- `GET /incidents/{id}` — detail with full timeline
- `PATCH /incidents/{id}/status` — update status
- `POST /incidents/{id}/comments` — analyst notes
- `POST /incidents/{id}/assign` — assign analyst
- `WS /ws/incidents` — WebSocket live updates per tenant

---

### API Gateway (`services/api-gateway/`)

#### [NEW] `nginx.conf` — upstream routing to all services
#### [NEW] `middleware/` — JWT validation, tenant context injection
#### [NEW] `Dockerfile`

---

### SOC Console UI — Layout & Design Refactor

The current UI uses ad-hoc styling that mimics Tailwind but lacks the actual engine, leading to layout breakage and overlapping elements. I will implement a robust Vanilla CSS design system.

#### [MODIFY] `app/globals.css`
- Core design tokens: colors (vibrant but professional enterprise palette), spacing, typography.
- Layout system: Fixed Sidebar + Header + Scrolling Main Content.
- Standardized components: `.stat-card`, `.incident-table`, `.live-badge`.
- Visual effects: subtle borders, glassmorphic headers, and smooth transitions.

#### [MODIFY] `app/dashboard/page.tsx`
- Structural refactor to ensure proper alignment of the main content area.
- Clean up unused utility classes and replace with semantic CSS.

#### [MODIFY] `components/StatCards.tsx`
- Implementation of high-impact visual cards with proper iconography and status coloring.

#### [MODIFY] `components/IncidentTable.tsx`
- Optimized table layout with clear typography and status indicators.

#### [NEW] `components/Sidebar.tsx`
- Centralized sidebar component with `useRouter` for seamless navigation.
- Responsive hover states and active route tracking.
- Replaces ad-hoc sidebar implementations in `Dashboard` and `IncidentDetail`.

---

### Seed Data (`scripts/seed.py`)

3 demo tenants with mock incidents across all vendors.

---

## User Review Required

> [!IMPORTANT]
> **Tech Stack Confirmation**: Services are Python FastAPI + Next.js. If you prefer NestJS (Node.js) for backend, please let me know before I build.

> [!IMPORTANT]
> **Real API Keys**: The connectors will be built with real API client code (XSIAM, CrowdStrike, SentinelOne, Defender). For the demo/seed data they use mocks. You can plug in real API keys via `.env` per tenant.

> [!NOTE]
> This will be a **local Docker Compose** deployment. Cloud (GKE) deployment config can be added as Phase 2 after this works end-to-end locally.

---

## Verification Plan

### Automated
1. `docker compose up --build` — all containers start healthy
2. `python scripts/seed.py` — seeds 3 tenants + 50 mock incidents
3. `curl http://localhost:8000/health` — API gateway health

### Manual (Browser)
1. Open `http://localhost:3000`
2. Login as `super_admin` → see all tenants' incidents in combined view
3. Switch to Tenant A → see only Tenant A's incidents
4. Switch to Tenant B → see only Tenant B's incidents (different data)
5. Open incident detail → see full IOC list, affected hosts, raw payload
6. Change incident status → see live update in WebSocket dashboard
7. Login as `analyst` (tenant-bound) → tenant switcher hidden, only own data visible
