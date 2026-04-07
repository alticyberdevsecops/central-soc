# Central SOC — Ticketing System Feature Roadmap

## Phase 1: Core Ticketing (Must Have)

### 1. Ticket Lifecycle Management
- Custom status workflow: `New → Assigned → Investigating → Escalated → Resolved → Closed`
- Configurable status transitions (e.g., can't skip from "New" to "Closed" without resolution)
- Required fields per status (e.g., must add resolution comment before marking Resolved)
- Priority levels separate from severity (`P1 / P2 / P3 / P4`)
- Due dates per incident

### 2. Assignment & Ownership
- Assign incidents to specific analysts (assignee field)
- Reassign between analysts
- Workload view — show how many open tickets each analyst has
- Escalation chains: `Analyst → Lead → Manager → CISO`
- Auto-assignment rules (e.g., all critical incidents → senior analyst team)
- On-call rotation integration

### 3. SLA Timers & Breach Alerts
- Define SLA policies per severity:
  - Critical: Triage within 15 min, Resolve within 4 hours
  - High: Triage within 1 hour, Resolve within 8 hours
  - Medium: Triage within 4 hours, Resolve within 24 hours
  - Low: Triage within 8 hours, Resolve within 72 hours
- Visual SLA countdown timer on each incident
- SLA breach indicator (red badge when breached)
- SLA breach notifications (in-app + email)

### 4. Tags & Labels
- Custom tags per incident (e.g., `phishing`, `ransomware`, `insider-threat`, `false-alarm`)
- Colour-coded labels for quick visual scanning
- Tag-based filtering on monitoring page
- Predefined tag categories (Attack Type, Response Action, Compliance)
- Bulk tagging support

### 5. Audit Trail
- Full history of every change to an incident (who changed what, when)
- Auto-logged actions:
  - "Status changed from New → Triaging by analyst_john"
  - "Assigned to security_team_lead by admin"
  - "SLA breached — no response within 15 min"
  - "Tag added: ransomware"
- Immutable audit log (cannot be deleted or modified)
- Exportable audit log for compliance

---

## Phase 2: Collaboration Features

### 6. Investigation Log Enhancements
- Timestamped comments (already exists via `incident_comments`)
- Internal notes vs. external notes (private vs. shareable with tenant)
- @mentions to tag other analysts in comments
- File attachments (screenshots, PCAP files, email samples, IOC lists)
- Rich text / markdown support in comments

### 7. Linked Incidents
- Link related incidents together:
  - "Related to" — similar incidents
  - "Duplicate of" — merge candidates
  - "Caused by" — root cause linking
  - "Part of" — campaign grouping
- Parent/child relationships (a campaign → multiple child incidents)
- Merge duplicate incidents into a single ticket
- Visual relationship graph

### 8. Playbooks & Checklists
- Attach response playbooks to incident types
- Checklist-style tasks within an incident:
  - [ ] Isolate affected host
  - [ ] Reset compromised credentials
  - [ ] Collect forensic artifacts
  - [ ] Notify management
  - [ ] Update firewall rules
- Track task completion percentage
- Auto-attach playbook based on incident category/tags
- Playbook library management (CRUD)

### 9. Templates
- Incident response templates (pre-filled investigation steps)
- Resolution templates:
  - "False positive — vendor patch applied"
  - "True positive — host isolated, credentials rotated"
  - "Duplicate — merged with INC-XXXX"
- Quick-close templates for known false positives
- Custom template creation per tenant

---

## Phase 3: Bulk Operations & Efficiency

### 10. Bulk Operations
- Multi-select incidents on monitoring page
- Bulk actions:
  - Bulk assign to analyst
  - Bulk change status
  - Bulk add tags
  - Bulk change severity/priority
  - Bulk close as false positive (with single resolution note)
- Select all matching current filter
- Undo bulk operation (within 30 seconds)

### 11. Saved Filters & Views
- Save custom filter combinations as named views
- Personal views per analyst
- Shared team views
- Examples:
  - "My Open Tickets" — assigned to me, not resolved
  - "Critical Unassigned" — critical severity, no assignee
  - "SLA Breached" — past due date
  - "Pending AI Analysis" — ai_status = pending

### 12. Quick Actions
- Right-click context menu on incident rows
- Keyboard shortcuts:
  - `A` — Assign
  - `S` — Change status
  - `T` — Add tag
  - `E` — Escalate
- Inline status change (click status badge to cycle)
- One-click escalate button

---

## Phase 4: Notifications & Integrations

### 13. Notification System
- In-app notification bell with unread count
- Notification types:
  - New incident assigned to you
  - Status change on your incidents
  - Comment/mention on your incidents
  - SLA breach warning (approaching + breached)
  - AI analysis completed
- Email notifications (configurable per user)
- Webhook notifications to Slack / Microsoft Teams
- Daily digest email (summary of open incidents)

### 14. External Integrations
- Bidirectional sync with:
  - Jira (create Jira issue from incident, sync status back)
  - ServiceNow (ITSM ticket creation)
  - PagerDuty (on-call alerting)
- SOAR integration (trigger automated response playbooks)
- Threat Intel enrichment:
  - Auto-lookup IOCs against VirusTotal
  - AbuseIPDB reputation check
  - Shodan host enrichment
  - AlienVault OTX pulse matching
- Email integration (send/receive updates via email)

---

## Phase 5: Reporting & Analytics

### 15. SLA Dashboard
- Mean Time to Detect (MTTD)
- Mean Time to Respond (MTTR)
- Mean Time to Resolve
- SLA compliance percentage per severity
- SLA breach count by severity, analyst, tenant
- Trend charts (improving or degrading over time)

### 16. Analyst Performance Metrics
- Incidents resolved per analyst per day/week/month
- Average resolution time per analyst
- Workload distribution chart
- First response time per analyst
- Leaderboard / gamification (optional)

### 17. Export & Compliance Reports
- Export incidents to CSV / PDF / JSON
- Scheduled reports:
  - Weekly incident summary
  - Monthly SLA compliance report
  - Quarterly trend analysis
- Compliance-ready reports:
  - SOC 2 Type II evidence
  - ISO 27001 incident management records
  - NIST CSF response metrics
- Custom report builder (select fields, date range, filters)

---

## Phase 6: Advanced Features (Nice to Have)

### 18. Knowledge Base
- Wiki for documenting recurring incident types
- Link KB articles to incidents
- "Similar incidents" suggestion based on title, IOCs, MITRE techniques
- Resolution history — what worked before for similar incidents
- Searchable knowledge base

### 19. Customer / Stakeholder Portal
- External-facing view for tenant admins
- Limited visibility (no internal notes, no raw data)
- Status updates without exposing investigation details
- Tenant can add comments / provide context
- Email notifications to tenant on status changes

### 20. AI-Powered Features
- Auto-triage suggestions based on historical data
- Recommended playbook based on incident type
- Similar incident matching (find past incidents with same IOCs/techniques)
- Auto-generated executive summary
- Predicted severity based on alert patterns
- Natural language search ("show me all phishing incidents from last week")

### 21. Workflow Automation Rules
- IF/THEN rule engine:
  - IF severity = critical AND source = XSIAM THEN assign to senior_team AND set priority P1
  - IF tag contains "phishing" THEN attach phishing_playbook
  - IF no response in 10 min THEN escalate to team_lead
  - IF resolved AND severity = critical THEN require manager approval
- Rule library with enable/disable toggle
- Rule execution log

---

## Implementation Priority (Recommended Order)

| Priority | Feature | Impact | Effort |
|----------|---------|--------|--------|
| 1 | Assignee & Assignment | High | Low |
| 2 | Tags & Labels | High | Low |
| 3 | Audit Trail | High | Medium |
| 4 | SLA Timers | High | Medium |
| 5 | Bulk Operations | High | Medium |
| 6 | Notification System | High | Medium |
| 7 | Investigation Log Enhancements | Medium | Low |
| 8 | Playbooks & Checklists | Medium | Medium |
| 9 | Linked Incidents | Medium | Medium |
| 10 | Templates | Medium | Low |
| 11 | Saved Filters & Views | Medium | Low |
| 12 | SLA Dashboard & Analytics | Medium | Medium |
| 13 | External Integrations | Medium | High |
| 14 | Export & Compliance Reports | Medium | Medium |
| 15 | Knowledge Base | Low | High |
| 16 | Customer Portal | Low | High |
| 17 | AI-Powered Features | Low | High |
| 18 | Workflow Automation Rules | Low | High |
