# 🧱 PHASE 1 — Project Bootstrap

## 🎯 Goal

Create enterprise microservice foundation.

## 🤖 AI PROMPT

You are a senior cloud architect.  
  
Create a production-ready microservices monorepo for an Enterprise SOC platform.  
  
Requirements:  
- Backend: Node.js (NestJS) OR Python (FastAPI)  
- Frontend: Next.js  
- Containerized architecture  
- Docker Compose setup  
- Microservices structure  
  
Services:  
- api-gateway  
- auth-service  
- ingestion-service  
- normalization-service  
- incident-service  
- ui-console  
- shared-schema  
  
Include:  
- folder structure  
- Dockerfiles  
- docker-compose.yml  
- environment configs  
- health check endpoints  
  
Follow enterprise best practices.

---

# 🧱 PHASE 2 — Multi-Tenant Architecture

## 🎯 Goal

Enterprise customer isolation.

## 🤖 AI PROMPT

Extend the SOC platform to support multi-tenancy.  
  
Requirements:  
- tenant_id enforced everywhere  
- PostgreSQL schema design  
- Row Level Security (RLS)  
- middleware validating tenant context  
- tenant-aware repositories  
  
Create:  
- tenant table  
- incidents table  
- users table  
- tenant middleware  
  
Ensure customers cannot access other tenant data.

---

# 🧱 PHASE 3 — Authentication & RBAC

## 🎯 Goal

Enterprise access control.

## 🤖 AI PROMPT

Build an enterprise authentication service.  
  
Requirements:  
- JWT authentication  
- Role Based Access Control  
- roles:  
  - super_admin  
  - customer_admin  
  - analyst  
- tenant-bound users  
- refresh tokens  
- secure password hashing  
  
Create login, register, validate endpoints.  
  
Integrate auth middleware into API gateway.

---

# 🧱 PHASE 4 — Unified Incident Schema

## 🎯 Goal

Normalize ALL XDR platforms.

## 🤖 AI PROMPT

Design a unified incident schema for multiple EDR/XDR vendors.  
  
Create a standard incident model supporting:  
- source_vendor  
- severity normalization  
- host/user fields  
- IOC array  
- raw vendor payload storage  
  
Provide:  
- JSON schema  
- validation layer  
- mapping interface for connectors

---

# 🧱 PHASE 5 — Connector Framework

## 🎯 Goal

Plugin-based integrations.

## 🤖 AI PROMPT

Create a connector framework for ingesting incidents from external security platforms.  
  
Requirements:  
- plugin architecture  
- connector interface  
- polling scheduler  
- retry logic  
- rate limiting  
  
Create example connector:  
- XSIAM connector mock  
  
Flow:  
connector → queue → normalization service

---

# 🧱 PHASE 6 — Event Queue System

## 🎯 Goal

Enterprise async processing.

## 🤖 AI PROMPT

Implement asynchronous event processing.  
  
Use Redis queue (BullMQ or Celery).  
  
Pipeline:  
connector → queue → normalization → incident service  
  
Include:  
- worker services  
- retry mechanism  
- dead letter queue  
- logging

---

# 🧱 PHASE 7 — Incident Management API

## 🎯 Goal

SOC backend brain.

## 🤖 AI PROMPT

Create incident management microservice.  
  
Features:  
- store normalized incidents  
- incident status updates  
- analyst assignment  
- timeline tracking  
- filtering & pagination  
  
Endpoints:  
GET /incidents  
GET /incident/{id}  
PATCH /incident/status  
POST /incident/comment  
  
Tenant isolation mandatory.

---

# 🧱 PHASE 8 — SOC Console UI

## 🎯 Goal

Analyst dashboard.

## 🤖 AI PROMPT

Build an enterprise SOC console UI using Next.js.  
  
Screens:  
- Incident dashboard  
- Incident detail view  
- analyst assignment  
- severity filters  
- customer switcher (admin only)  
  
Requirements:  
- dark SOC theme  
- websocket live updates  
- role-based visibility

---

# 🧱 PHASE 9 — API Gateway

## 🎯 Goal

Single control plane entry.

## 🤖 AI PROMPT

Create API gateway service.  
  
Responsibilities:  
- route requests to services  
- validate JWT  
- inject tenant context  
- rate limiting  
- centralized logging  
  
Use reverse proxy pattern.

---

# 🧱 PHASE 10 — Observability Stack

## 🎯 Goal

Enterprise monitoring.

## 🤖 AI PROMPT

Add observability stack.  
  
Include:  
- Prometheus metrics  
- Grafana dashboards  
- centralized logging  
- service health monitoring  
  
Expose metrics endpoints in all services.

---

# 🧱 PHASE 11 — Security Hardening

## 🎯 Goal

Enterprise-grade security.

## 🤖 AI PROMPT

Harden platform security.  
  
Implement:  
- HTTPS enforcement  
- secrets management  
- audit logs  
- API throttling  
- input validation  
- secure headers  
  
Follow OWASP API Top 10.

---

# 🧱 PHASE 12 — Docker Productionization

## 🎯 Goal

Enterprise containerization.

## 🤖 AI PROMPT

Optimize Docker setup for production.  
  
Requirements:  
- multi-stage builds  
- small images  
- health checks  
- restart policies  
- environment separation  
  
Create production docker-compose.

---

# 🧱 PHASE 13 — GCP Deployment Preparation

## 🎯 Goal

Cloud readiness.

## 🤖 AI PROMPT

Prepare platform for Google Cloud deployment.  
  
Generate:  
- Kubernetes manifests  
- environment configs  
- secret manager integration  
- Cloud SQL connectivity  
- Pub/Sub adapter  
  
Target: Google Kubernetes Engine (GKE).

---

# 🧱 PHASE 14 — Kubernetes Deployment

## 🎯 Goal

Enterprise scaling.

## 🤖 AI PROMPT

Create Kubernetes deployment configuration.  
  
For each service:  
- Deployment  
- Service  
- HPA autoscaling  
- ConfigMaps  
- Secrets  
  
Enable rolling updates and zero downtime deployment.

---

# 🧱 PHASE 15 — Multi-Customer Scaling

## 🎯 Goal

20+ customer production readiness.

## 🤖 AI PROMPT

Optimize architecture for 20+ tenants.  
  
Implement:  
- connector per tenant scaling  
- workload isolation  
- horizontal scaling rules  
- resource quotas  
- tenant monitoring dashboards