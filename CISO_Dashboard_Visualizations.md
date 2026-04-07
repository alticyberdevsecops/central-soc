# CISO Executive Dashboard: Visualizations & Architecture

This document provides a comprehensive breakdown of all data visualizations used within the CISO Executive Dashboard. It explains the purpose of each component, the underlying calculations and logic, and the exact API endpoints and data sources driving them.

---

## 1. Global Threat Pulse (Ticker)

### What it is
A continuously scrolling ticker tape located at the top of the dashboard, displaying real-time global threat intelligence alerts.

### Why it is used
Provides the CISO with immediate, passive situational awareness regarding new global or industry-specific threats, without consuming significant vertical screen space.

### Calculation & Logic
- Takes the `feed` array from the threat intelligence endpoint.
- Iterates through the array and maps each item to a ticker component.
- Highlights items in **RED** if `severity === 'CRITICAL'`, otherwise **YELLOW**.
- Displays the `[source]`, `title`, and severity color indicator.

### Data Source
- **API Wrapper:** `xsiamApi.getIntel(tenantId)`
- **Backend Endpoint:** `GET /tenants/{tenantId}/xsiam/intel`

---

## 2. Security Posture Index

### What it is
A primary hero component prominently displaying a high-level percentage score (e.g., 85%), a directional trend (e.g., +2.4%), and a risk classification ("RESILIENT" or "MODERATE RISK"). It also includes progress-bar-style breakdown metrics for 4 pillars: Vulnerability Management, Incident Response Logic, Identity & Access, and Exposure Control.

### Why it is used
Provides an immediate answer to the executive's most common question: "Are we secure today compared to yesterday?" It distills complex thousands-of-events data into a single business-level metric and highlights which security pillar requires the most attention.

### Calculation & Logic
- The master score (`posture_score`) is retrieved directly from the backend.
- **Risk Labeling:** If `posture_score > 80`, it displays `RESILIENT` in green. Otherwise, it displays `MODERATE RISK` in yellow.
- **Pillars:**
  - *Vulnerability Management:* Currently hardcoded visually to `85%`.
  - *Incident Response Logic:* Dynamically calculated based on the main posture score. `If posture_score > 60, score = 92, else score = 45`.
  - *Identity & Access:* Currently hardcoded visually to `78%`.
  - *Exposure Control:* Currently hardcoded visually to `94%`.
- (Note: The sub-pillars use hardcoded/conditional values for UI demonstration purposes in the frontend, while the main score is dynamic).

### Data Source
- **API Wrapper:** `xsiamApi.getPosture(tenantId)`
- **Backend Endpoint:** `GET /tenants/{tenantId}/xsiam/posture`

---

## 3. SOC KPI Grid

### What it is
Four prominent Key Performance Indicator (KPI) cards displaying:
1. **Avg MTT-Detect (MTTD)**
2. **Avg MTT-Resolve (MTTR)**
3. **SLA Compliance %**
4. **SLA Breaches**

### Why it is used
Evaluates the operational efficiency of the Security Operations Center (SOC) team. It helps the CISO determine if the team is identifying and mitigating threats quickly enough to satisfy business Service Level Agreements (SLAs).

### Calculation & Logic
- These metrics are direct readouts from the backend analytics engine without frontline manipulation.
- Retrieves `avg_mttd_min`, `avg_mttr_min`, and `sla_compliance` from the SOC performance dataset.
- Retrieves `sla_breaches` from the general posture dataset.

### Data Source
- **API Wrappers:** `xsiamApi.getSocPerformance(tenantId)` & `xsiamApi.getPosture(tenantId)`
- **Backend Endpoints:** `GET /tenants/{tenantId}/xsiam/soc-performance` & `GET /tenants/{tenantId}/xsiam/posture`

---

## 4. Secondary Volume Metrics Strip

### What it is
A horizontal cluster of raw numeral counters:
- **Active Critical:** The number of ongoing high-severity incidents.
- **Open Alerts:** Total number of active alerts.
- **Threat Intel Tier-1:** High-priority intelligence feeds matching the tenant environment.
- **Risky Identities:** Number of user accounts showing anomalous or compromised behavior patterns.

### Why it is used
Provides absolute numbers to ground the percentage-based scores. While percentages show trends, raw numbers (like "5 Active Criticals") illustrate the immediate workload and concrete risk level.

### Calculation & Logic
- **Active Critical:** Uses `posture.active_critical`.
- **Open Alerts:** Uses `posture.total_active`.
- **Threat Intel Tier-1:** Calculates the array length of intel items where `tier === 1`.
- **Risky Identities:** Calculates the total length of the `riskyUsers` array.

### Data Source
- Combines data from:
  - `xsiamApi.getPosture(tenantId)`
  - `xsiamApi.getIntel(tenantId)`
  - `xsiamApi.getRiskyUsers(tenantId)` -> `GET /tenants/{tenantId}/xsiam/risky-users`

---

## 5. Regulatory Compliance & Drift Tracker

### What it is
A checklist-style board displaying various regulatory frameworks (e.g., PCI-DSS, SOC2) and checking what percentage of the organization's infrastructure is compliant. It includes a specific warning for "Configuration Drift."

### Why it is used
Informs governance, risk, and compliance readiness. Prevents the business from facing fines or failing external audits by highlighting configuration drift away from pre-approved secure baselines.

### Calculation & Logic
- Iterates over the `compliance.frameworks` array.
- Colors the compliance percentage dynamically:
  - `>= 90%` -> Green (`#3fb950`)
  - `> 80%` -> Blue (`#2f81f7`)
  - `<= 80%` -> Yellow (`#d29922`)
- Pulls `compliance.drift.critical_assets_drifted` to populate the specific drift anomaly warning card.

### Data Source
- **API Wrapper:** `xsiamApi.getCompliance(tenantId)`
- **Backend Endpoint:** `GET /tenants/{tenantId}/xsiam/compliance`

---

## 6. Peer Benchmarking & ROI

### What it is
Displays how the tenant's threat volume compares to similar companies in the same industry (e.g., "85th Percentile"). Also outlines Automation ROI (Hours saved weekly, and percentage of Tier-1 tickets auto-remediated).

### Why it is used
Provides crucial metrics for budget justification and board reporting. It proves that security automation software is saving money/time, and reveals if the organization is being targeted more heavily than its peers contextually.

### Calculation & Logic
- Maps direct textual fields: `benchmarks.industry_comparison.sector`, `benchmarks.industry_comparison.company_percentile`.
- Maps direct numerical fields for automation ROI: `benchmarks.soc_efficiency.automation_hours_saved_weekly` and `benchmarks.soc_efficiency.auto_remediated_percent`.

### Data Source
- **API Wrapper:** `xsiamApi.getBenchmarks(tenantId)`
- **Backend Endpoint:** `GET /tenants/{tenantId}/xsiam/benchmarks`

---

## 7. "Crown Jewels" Exposure

### What it is
A direct list of the absolute most critical business assets (e.g., Customer Database, Payment Gateway) and their current behavioral security status.

### Why it is used
Abstract percentage scores don't protect the specific databases that keep the business alive. This panel ensures that regardless of the general posture score, the CISO is confident that the most crucial elements are safe.

### Calculation & Logic
- Takes the top 4 assets: `crownJewels.critical_paths.slice(0, 4)`.
- **Assessment:** Checks `anomalous_access > 0`.
  - If greater than 0, flags in RED with `<number> ANOMALIES`.
  - If 0, flags in GREEN as `SECURE`.

### Data Source
- **API Wrapper:** `xsiamApi.getCrownJewels(tenantId)`
- **Backend Endpoint:** `GET /tenants/{tenantId}/xsiam/crown-jewels`

---

## 8. Global Attack Surface Exposure

### What it is
A table-style view displaying externally exposed assets, showing their external hostname, internal mapped IP address, and the volume of access "HITs" or alerts generated against them.

### Why it is used
Highlights the external perimeter. Identifies shadow IT, unsanctioned outward-facing servers, or poorly configured firewalls that expose internal assets to the public internet.

### Calculation & Logic
- Slices the top 5 assets directly from the `attackSurface` array.
- Displays `action_external_hostname` (falling back to 'Unmapped Asset').
- Displays `action_local_ip` (falling back to 'Internal Node').
- Counter logic prioritizes `alert_count`, falling back to `access_count` for "HITs".

### Data Source
- **API Wrapper:** `xsiamApi.getAttackSurface(tenantId)`
- **Backend Endpoint:** `GET /tenants/{tenantId}/xsiam/attack-surface`

---

## 9. XSIAM Direct Query Engine

### What it is
An interactive, full-screen capable console allowing the execution of arbitrary XDR Query Language (XQL) queries directly against Palo Alto XSIAM datalakes. It supports template selection, dynamic variable injection, limit overrides, and timeframe selection.

### Why it is used
Allows senior analysts or CISOs to conduct deep-dive hunting, ad-hoc investigations, or forensic analysis without shifting tools. The resulting dynamic data table brings raw telemetry directly to the executive layer when necessary.

### Calculation & Logic
- Provides a timeframe (`24h`, `7d`, `15d`, `30d`, `90d`) and result limit dropdown.
- When a template is selected, extracts variables (`{var_name}`) and generates input fields via UI state mapping.
- Dynamically injects variables and standardizes the limit parameter (`| limit X`) using Regex (`/\|\s*limit\s+[^{|\s]+/gi`).
- Executes the payload and dynamically generates table headers by mapping `Object.keys()` of the first returned JSON object row.

### Data Source
- **Template Fetch:** `xsiamApi.getQueryTemplates(tenantId)` -> `GET /tenants/{tenantId}/xsiam/query-templates`
- **Execution Payload:** `xsiamApi.runQuery(tenantId, query, timeframe)` -> `POST /tenants/{tenantId}/xsiam/run-query`

---

## 10. Palo Alto XSIAM Active Alerts List

### What it is
A chronological log/table of active security alerts broken down by Severity, Incident Name, Host/Entity context, and Timestamp.

### Why it is used
Serves as the bottom-line reality check. If the KPI metrics look bad, this table provides the immediate "Why" by showing the actual events occurring in the network at that exact moment.

### Calculation & Logic
- Displays a maximum of the 8 most recent incidents (`incidents.slice(0, 8)`).
- **Styling Matrix:** If `severity === 'critical'`, the badge renders intensely red `#f85149`, otherwise it renders a warning yellow `#d29922`.
- Formats timezone information locally to the user's browser: `new Date(inc.ts).toLocaleTimeString()`.
- Maps generic source hosts strings, defaulting to `'External Asset'` if missing.

### Data Source
- **API Wrapper:** `xsiamApi.getIncidents(tenantId)`
- **Backend Endpoint:** `GET /tenants/{tenantId}/xsiam/incidents`
