# Production Architecture & GCP Migration Roadmap

This document outlines the strategic plan for scaling the Autonomous SOC platform from its current local development environment to a high-availability, production-ready infrastructure on Google Cloud Platform (GCP).

## 1. Current vs. Production Architecture

| Component | Local (Current) | GCP Production (Target) |
| :--- | :--- | :--- |
| **Compute** | Docker Compose on Windows | Cloud Run (Serverless) or GKE (Kubernetes) |
| **Database** | Local PostgreSQL Container | **Cloud SQL** (Managed PostgreSQL) |
| **Queue/Cache** | Local Redis Container | **Cloud Memorystore** (Managed Redis) |
| **Ingestion** | Periodic Python Pollers | Cloud Run Jobs or Pub/Sub Triggers |
| **Cold Storage**| Local Disk (Postgres) | **BigQuery** (Warehouse for 1yr+ logs) |
| **Secrets** | `.env` files | **Secret Manager** |

---

## 2. Scaling Strategies for High Volume

As the platform scales to 1,000+ incidents per tenant daily, we will implement the following:

### A. Horizontal Scaling (Workers)
- **Auto-scaling Normalizers**: Deploy the `normalization-service` on Cloud Run. Cloud Run will automatically spin up more instances as the Redis/Pub-Sub queue grows.
- **Concurrency**: Increase the number of concurrent worker threads per instance to handle bursts of incidents during security events.

### B. Database Optimization & Compliance
- **Physical Isolation (BFSI Requirement)**: For customers requiring strict data isolation, we will implement **Schema-per-Tenant** or **Database-per-Tenant** strategies. 
    - **Schema-per-Tenant**: Provides logical isolation at the DB level, allowing for tenant-specific backups and encryption keys while sharing the same DB instance.
    - **Database-per-Tenant**: Provides maximum isolation for high-compliance BFSI clients. Each onboarded tenant gets a dedicated PostgreSQL database.
- **Table Partitioning**: For shared-instance tenants, implement partitioning on the `incidents` table by `tenant_id` and `created_at`.

### C. The "Data Tiering" Flow
To prevent performance degradation over time:
1. **Hot Data (0-30 days)**: Stored in PostgreSQL (Cloud SQL) for immediate dashboard access and agent analysis.
2. **Warm Data (30-90 days)**: Compressed and stored in a "Summary" table in Postgres or Cloud Storage.
3. **Cold Data (90+ days)**: Streamed to **BigQuery**. BigQuery allows the SOC to perform "Threat Hunting" across years of data in seconds without affecting the live app's performance.

---

## 3. High Availability & Disaster Recovery

- **Multi-Zone Deployment**: Cloud SQL and GKE/Cloud Run will be deployed across multiple GCP zones (e.g., `asia-south1-a`, `asia-south1-b`) to ensure 99.99% uptime.
- **Automated Backups**: Continuous Point-in-Time Recovery (PITR) for PostgreSQL, allowing us to restore data down to the specific second.

---

## 4. Migration Phases

### Phase 1: Managed Lift & Shift (Week 1-2)
- Move PostgreSQL to Cloud SQL.
- Move Redis to Memorystore.
- Deploy existing Docker containers to Cloud Run.
- Connect via Private Service Connect (VPC).

### Phase 2: Refactor for Scale (Week 3-4)
- Replace Redis Queue with **GCP Pub/Sub** for guaranteed message delivery.
- Implement **Postgres Partitioning**.
- Integrate **Secret Manager** for API keys.

### Phase 3: Analytics & Intelligence (Week 5+)
- Enable **BigQuery Data Streaming**.
- Implement **Cloud Functions** for ad-hoc tool execution by the Agent Swarm.
- Set up **Cloud Monitoring & Error Reporting** for 24/7 visibility into system health.
