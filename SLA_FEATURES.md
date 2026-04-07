# SLA Features — Central SOC Platform

A comprehensive list of SLA (Service Level Agreement) features that can be implemented across different stakeholder perspectives.

---

## Currently Implemented ✅

- **Per-Tenant SLA Configuration** — Configurable targets for first response, resolution, customer reply, and escalation response times
- **Per-Severity SLA Targets** — Different first response and resolution targets per severity level (Critical/High/Medium/Low/Informational) with admin UI
- **SLA Event Logging** — Every significant action (status change, email sent/received, assignment, escalation, comment) is recorded in `sla_events`
- **First Response Tracking** — Automatic detection of the first analyst action on an incident (severity-aware)
- **Automatic Breach Detection** — Background worker checks for SLA breaches every 60 seconds using per-severity targets
- **Breach Flags on Incidents** — `sla_first_response_breached` and `sla_resolution_breached` materialized on incident records
- **SLA Countdown Timer** — Live countdown on incident detail showing time remaining before first response and resolution SLA breach
- **Approaching Breach Warnings** — Yellow/orange warning indicators at 75%+ SLA time elapsed, red at breach. Shown in incident table and detail page
- **SLA Breach Email Notifications** — Automatic email to assigned analyst when SLA breach occurs or is approaching (75%+ elapsed)
- **SLA Compliance Widget** — Dashboard overview showing compliance %, avg first response, breach counts
- **Analyst Performance Table** — Per-analyst metrics with incident count, avg response times, breach counts, compliance %
- **Analyst Drill-Down** — Click an analyst to see their individual incident breakdown
- **SLA Timeline on Incident Detail** — Vertical timeline of all SLA events with breach/warning events highlighted
- **SLA Breach Indicators** — Red warning icons on incident rows when breached, orange clock icon when approaching breach
- **SLA Settings Tab** — Admin UI with per-severity target grid and general SLA configuration

---

## Analyst SLA Features 🧑‍💻

### Response Time SLA
- [x] **Per-Severity SLA Targets** — Different first response and resolution targets based on incident severity (Critical: 15min, High: 30min, Medium: 2hr, Low: 8hr)
- [ ] **Work Hours Awareness** — SLA clock pauses outside of business hours (configurable per tenant: 9am-6pm, timezone-aware)
- [ ] **Pause/Resume SLA Clock** — Allow analysts to pause SLA when waiting on external dependencies (e.g., vendor response, customer info)
- [x] **SLA Countdown Timer** — Live countdown on incident detail page showing time remaining before breach
- [x] **Approaching Breach Warnings** — Yellow warning when >75% of SLA time has elapsed, orange at >90%

### Assignment & Acknowledgement
- [ ] **Acknowledgement SLA** — Time limit for analyst to acknowledge (click "Accept") an assigned incident
- [ ] **Auto-Reassignment on SLA Breach** — Automatically reassign to next available analyst if acknowledgement SLA is breached
- [ ] **Round-Robin with SLA Load Balancing** — Assign new incidents to analysts with the best current SLA compliance scores
- [ ] **Skill-Based Routing with SLA Multiplier** — Different SLA targets based on analyst skill level (Junior: 2x time, Senior: 1x)

### Analyst Performance Metrics
- [ ] **Personal SLA Dashboard** — Each analyst sees their own SLA stats, compliance trend, and breach history
- [ ] **SLA Streak Tracking** — "Days without a breach" counter per analyst for gamification
- [ ] **Weekly/Monthly SLA Report Per Analyst** — Automated email digest with personal SLA performance
- [ ] **Analyst Ranking / Leaderboard** — Rank analysts by compliance score with anonymized or visible leaderboard
- [ ] **MTTR (Mean Time to Resolve)** — Track average resolution time per analyst, per severity
- [ ] **MTTA (Mean Time to Acknowledge)** — Track average acknowledgement time per analyst

### Notifications
- [x] **SLA Breach Email to Analyst** — Send notification to the assigned analyst when their incident breaches SLA
- [x] **Approaching Breach Notification** — Warn analyst (email/in-app) when SLA is about to breach (configurable: 10min, 5min before)
- [ ] **Escalation Notification Chain** — If first response SLA breaches, notify team lead; if resolution SLA breaches, notify manager
- [ ] **In-App SLA Toast Alerts** — Real-time browser notifications for SLA events

---

## Customer SLA Features 👤

### Customer Response SLA
- [ ] **Customer Reply SLA** — Track time taken to respond after customer sends a message/email
- [ ] **Customer Notification SLA** — Ensure customers are notified of incident status changes within X minutes
- [ ] **Customer Update Frequency SLA** — Require periodic updates to the customer (e.g., every 4 hours for critical incidents)
- [ ] **Acknowledgement Email SLA** — Time to send the first automated acknowledgement email to customer after they report an incident

### Customer-Facing SLA Dashboard
- [ ] **Customer Portal SLA View** — Allow customers to see SLA status of their incidents (read-only)
- [ ] **SLA Compliance Report Export** — Generate PDF/CSV SLA compliance reports per customer/tenant for a date range
- [ ] **Monthly SLA Report Email** — Automated monthly SLA summary email sent to customer admins
- [ ] **SLA Violation Apology Templates** — Pre-configured email templates triggered on SLA breach to apologize and set expectations

### Customer Satisfaction
- [ ] **CSAT Survey on Resolution** — Automatically send a customer satisfaction survey after incident resolution
- [ ] **SLA Credit/Penalty Tracking** — Log SLA violations and calculate credits/penalties per tenant contract
- [ ] **Customer Feedback Loop** — Allow customers to rate their experience; correlate with SLA compliance

---

## Escalation SLA Features ⬆️

- [ ] **Multi-Tier Escalation SLA** — Different SLA targets per escalation level (L1 → L2 → L3)
- [ ] **Escalation Response SLA** — Track time for escalated team to pick up the incident
- [ ] **Auto-Escalation on Breach** — Automatically escalate to next tier when current tier's SLA is breached
- [ ] **Manager Override / Priority Bump** — Allow managers to override SLA targets for specific high-profile incidents
- [ ] **Escalation Reason Tracking** — Log why each escalation happened (SLA breach, complexity, customer request)
- [ ] **De-Escalation SLA** — Track time for high-priority incidents to be de-escalated back to normal flow

---

## Operational & Management SLA Features 📊

### Reporting & Analytics
- [ ] **SLA Trend Charts** — Weekly/monthly line charts showing compliance % over time
- [ ] **Breach Heatmap** — Calendar heatmap showing breach frequency by day of week / time of day
- [ ] **SLA by Severity Report** — Compliance breakdown per severity level
- [ ] **SLA by Source/Vendor Report** — See which alert sources have the worst SLA compliance
- [ ] **Tenant Comparison Dashboard** — Super admin view comparing SLA across all tenants
- [ ] **Incident Age Distribution** — Histogram showing how long incidents have been open relative to SLA targets
- [ ] **Breach Root Cause Analysis** — Tag breaches with root causes (staffing, complexity, tooling, etc.)

### Alerts & Automation
- [ ] **SLA Breach Webhook** — Send webhook notifications to external systems (Slack, Teams, PagerDuty) on SLA breaches
- [ ] **Slack/Teams Integration** — Post SLA alerts to configured channels
- [ ] **Daily SLA Digest** — Morning email to team leads summarizing overnight SLA status
- [ ] **SLA-Based Incident Prioritization** — Automatically bump priority of incidents approaching SLA breach
- [ ] **Auto-Resolution on Inactivity** — Automatically resolve incidents with no activity after X days (configurable)

### Configuration & Flexibility
- [ ] **Holiday Calendar** — Define holidays when SLA clock is paused
- [x] **Per-Severity SLA Overrides** — Override default SLA targets for specific severity levels
- [ ] **Per-Customer SLA Agreements** — Custom SLA targets per customer (override tenant defaults)
- [ ] **SLA Policy Versioning** — Track changes to SLA configurations over time (who changed what, when)
- [ ] **SLA Exclusion Rules** — Exclude certain incident types or sources from SLA tracking
- [ ] **Grace Period Configuration** — Allow a configurable grace period before SLA clock starts (e.g., 5 min after creation)

---

## Advanced SLA Features 🚀

### AI & Predictive
- [ ] **SLA Breach Prediction** — ML model predicting which open incidents are likely to breach SLA based on historical data
- [ ] **Smart Staffing Recommendations** — Recommend shift adjustments based on SLA breach patterns
- [ ] **Auto-Triage SLA** — Track time for AI triaging to complete, with fallback to manual if AI SLA breaches

### Compliance & Audit
- [ ] **SLA Audit Trail** — Complete audit log of all SLA configuration changes, breach acknowledgements, and overrides
- [ ] **SLA Compliance Certification** — Generate formal compliance certificates for regulatory requirements
- [ ] **SLA Freeze Periods** — During maintenance windows or planned outages, freeze SLA clock globally
- [ ] **External SLA Integration** — Sync SLA data with external ITSM tools (ServiceNow, Jira Service Management)

### Multi-Channel SLA
- [ ] **Email SLA** — Separate SLA targets for email-reported incidents
- [ ] **Portal SLA** — Separate SLA targets for web-portal-reported incidents
- [ ] **Phone/Chat SLA** — If phone/chat channels are added, track SLA per channel
- [ ] **Cross-Channel SLA** — Unified view of SLA compliance across all reporting channels

---

## Implementation Priority Recommendation

### Phase 1 — Quick Wins ✅ COMPLETED
1. ~~Per-Severity SLA Targets~~
2. ~~SLA Countdown Timer on incident detail~~
3. ~~Approaching Breach Warnings (yellow/red indicators)~~
4. ~~SLA Breach Email Notifications to analyst~~

### Phase 2 — Customer Experience (2-3 weeks)
1. Customer Reply SLA tracking
2. Customer Update Frequency SLA
3. Monthly SLA Report Export (PDF)
4. CSAT Survey on Resolution

### Phase 3 — Operational Excellence (3-4 weeks)
1. Work Hours Awareness (business hours SLA clock)
2. Holiday Calendar
3. SLA Trend Charts
4. Breach Heatmap
5. Slack/Teams Webhook Integration

### Phase 4 — Advanced (4-6 weeks)
1. Multi-Tier Escalation SLA
2. Auto-Reassignment on Breach
3. SLA Breach Prediction (AI)
4. External ITSM Integration
