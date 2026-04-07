# 🎫 Central SOC: Incident-as-a-Ticket Roadmap

In the Central SOC architecture, we treat every **Incident** as a **Ticket**. This eliminates the need for a redundant ticketing layer and leverages our existing multi-tenant, multi-database infrastructure.

---

## ✅ 1. Existing Features (The Foundation)
*These features are already implemented or partially present in the current codebase.*

- **Multi-Tenant Isolation**: Incidents are fetched and stored in customer-specific databases, ensuring complete data segregation.
- **Incident Lifecycle Tracking**: Status mapping (New, Investigating, Resolved) is already integrated into the UI.
- **Investigation Log (Evidence Commits)**: Analysts can add investigative notes (comments) to the incident timeline.
- **Stitched Evidence/Artifacts**: Automatic grouping of alerts, file hashes, and network metadata under a single incident ID.
- **One-Click AI Analysis**: Integration with the Agentic SOC swarm to perform autonomous triage of a specific incident.
- **Role-Based Visibility**: Incident access is governed by the tenant context.

---

## 🚀 2. Planned Enhancements (Treating Incidents as Tickets)
*New capabilities to be layered on top of the existing incident structure.*

- **🏷️ Unified Ticket ID Format**:
    - Implement a standardized ID: `<4char_tenant_prefix>-<incident_id> <incident_name>`
    - Example: `RELA-1234 Unauthorized Login Attempt`
- **📍 SLA & Response Timers**: 
    - Add `response_due_at` and `resolution_due_at` timestamps to the incident schema.
    - Implement visual countdowns on the incident detail page.
- **🏷️ Smart Tagging & Priority Overrides**:
    - Allow analysts to manually override AI-assigned priority with justification.
    - Implement "Custom Labels" for easier filtering (e.g., `VIP-User`, `Critical-System`, `False-Positive-Testing`).
- **🔐 Forensic Chain of Custody**:
    - Automatically generate SHA-256 hashes for all uploaded evidence/artifacts.
    - Implement an "evidence lock" feature to prevent deletion of forensic data.
- **⚙️ Workflow Triggers (SOAR Integrations)**:
    - Add "Quick Actions" button on the incident page for remediation (e.g., `Block IP on Firewall`, `Disable User in AD`).
- **📧 Customer Communication Bridge**:
    - Allow analysts to "Share with Customer" specific comments or summaries, making them visible in a client portal or sending them via email/Slack.
- **� Analyst Performance Metrics**:
    - Track "Time-on-Incident" to measure Mean Time to Respond (MTTR) and individual analyst efficiency.

---

## 🗄️ 3. Data Strategy
- **Incident Store**: Continue using the per-tenant database strategy to avoid data leakage.
- **Centralized Metrics**: A minimal "Aggregator" database that tracks non-sensitive metadata (e.g., Incident counts, SLA breaches) for global SOC reporting.
- **Audit Logs**: Every status change or comment commit is timestamped and attributed to an analyst.

---

> [!IMPORTANT]
> **Paradigm Shift**: By treating the incident as the ticket, we ensure that forensic data and administrative metadata live in the same record. This provides a "Single Source of Truth" for both the analyst and the auditor.
