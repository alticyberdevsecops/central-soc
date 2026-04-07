# SOCFlow Automation Builder — Feature Specification

> A visual drag-and-drop workflow automation engine for SOC operations, inspired by **Tines** and **n8n**.

---

## Table of Contents

1. [Vision](#vision)
2. [Core Concepts](#core-concepts)
3. [Node Types (Action Library)](#node-types-action-library)
4. [Trigger Nodes](#trigger-nodes)
5. [Logic & Flow Control Nodes](#logic--flow-control-nodes)
6. [SOC Action Nodes](#soc-action-nodes)
7. [Communication Nodes](#communication-nodes)
8. [Enrichment & Threat Intel Nodes](#enrichment--threat-intel-nodes)
9. [Transformation & Data Nodes](#transformation--data-nodes)
10. [Integration Nodes](#integration-nodes)
11. [AI / LLM Nodes](#ai--llm-nodes)
12. [Response & Remediation Nodes](#response--remediation-nodes)
13. [Canvas & Builder UI](#canvas--builder-ui)
14. [Workflow Management](#workflow-management)
15. [Template Library (Pre-built Playbooks)](#template-library-pre-built-playbooks)
16. [Execution Engine](#execution-engine)
17. [Variables & Expressions](#variables--expressions)
18. [Audit & Compliance](#audit--compliance)
19. [Architecture](#architecture)
20. [Database Schema](#database-schema)
21. [API Endpoints](#api-endpoints)
22. [Implementation Phases](#implementation-phases)

---

## Vision

Build a **no-code / low-code automation engine** directly into the SOCFlow platform, allowing analysts to:

- Automate repetitive incident response tasks
- Build custom playbooks with drag-and-drop
- Chain together internal SOC actions + external integrations
- Reduce MTTR (Mean Time To Respond) by 60-80%
- Ensure consistent, auditable response procedures

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Workflow** | A complete automation pipeline (like a Tines "Story" or n8n "Workflow") |
| **Node** | A single action/step in the workflow (like a Tines "Action" or n8n "Node") |
| **Edge** | Connection between nodes defining execution flow |
| **Trigger** | The event that starts a workflow (webhook, schedule, incident event, manual) |
| **Execution** | A single run of a workflow with its input data |
| **Variable** | Dynamic data passed between nodes using `{{node_name.output.field}}` syntax |
| **Credential** | Stored secret (API key, OAuth token) referenced by nodes |
| **Playbook** | A workflow template designed for a specific incident type |
| **Sub-workflow** | A workflow called from within another workflow (reusable components) |

---

## Node Types (Action Library)

### Trigger Nodes

These start the workflow when a condition is met.

| Node | Description | Configuration |
|------|-------------|---------------|
| **Incident Created** | Fires when a new incident is created | Filters: severity, source, title pattern, tenant |
| **Incident Updated** | Fires when an incident field changes | Filters: field name, old/new value, severity |
| **Status Changed** | Fires when incident status transitions | Filters: from_status → to_status |
| **SLA Approaching** | Fires when SLA hits warning threshold | Filters: threshold %, severity, SLA type |
| **SLA Breached** | Fires when any SLA target is breached | Filters: SLA type (first_response, resolution) |
| **Email Received** | Fires when an inbound email arrives | Filters: from address, subject pattern, has attachment |
| **Webhook** | External HTTP POST triggers the workflow | Custom URL, auth method, payload schema |
| **Schedule (Cron)** | Runs on a schedule | Cron expression, timezone |
| **Manual Trigger** | Analyst clicks "Run" from incident or dashboard | Input form fields |
| **Escalation Trigger** | Fires when incident is escalated | Filters: escalation level, team |
| **Assignment Changed** | Fires when incident is reassigned | Filters: from/to analyst, team |
| **Customer Reply** | Fires when customer sends a reply email | Filters: sentiment, keywords |
| **IOC Detected** | Fires when a new IOC is extracted from incident | Filters: IOC type (IP, hash, domain, URL) |
| **Threat Intel Match** | Fires when an IOC matches a threat feed | Filters: feed name, confidence score |

---

### Logic & Flow Control Nodes

| Node | Description | Example |
|------|-------------|---------|
| **If / Condition** | Branch based on true/false condition | `if severity == "critical"` → branch A, else → branch B |
| **Switch / Router** | Multi-way branch (like switch-case) | Route by severity: critical → path1, high → path2, etc. |
| **Loop / For Each** | Iterate over a list | For each IOC in `{{extract_iocs.output.iocs}}` |
| **Merge** | Combine outputs from parallel branches | Wait for all branches, merge results |
| **Wait / Delay** | Pause execution for specified time | Wait 5 minutes before checking again |
| **Wait for Event** | Pause until a specific event occurs | Wait for analyst approval, wait for customer reply |
| **Parallel** | Execute multiple branches simultaneously | Enrich IP + Check hash + Query domain in parallel |
| **Try / Catch** | Error handling wrapper | Try enrichment → catch failure → fallback action |
| **Stop / End** | Terminate the workflow | Stop with status: success / failure / skipped |
| **Sub-workflow** | Call another workflow as a step | Call "IOC Enrichment" sub-workflow |
| **Approval Gate** | Pause and wait for human approval | Send approval request to analyst/manager |
| **Rate Limiter** | Throttle execution rate | Max 10 API calls per minute |
| **Dedup** | Skip if same input was processed recently | Dedup window: 1 hour, key: `{{ioc.value}}` |

---

### SOC Action Nodes

Core actions within the SOCFlow platform.

| Node | Description | Inputs | Outputs |
|------|-------------|--------|---------|
| **Create Incident** | Create a new incident | title, severity, description, source | incident_id, created_at |
| **Update Incident** | Modify incident fields | incident_id, fields to update | updated_incident |
| **Change Status** | Transition incident status | incident_id, new_status | old_status, new_status |
| **Assign Incident** | Assign to analyst or team | incident_id, analyst_id or team_id | assignment_details |
| **Auto-Assign (Round Robin)** | Auto-assign based on workload | incident_id, team_id, strategy | assigned_analyst |
| **Escalate Incident** | Escalate to higher tier | incident_id, escalation_level, reason | escalation_details |
| **Add Comment** | Add internal note to incident | incident_id, comment, author | comment_id |
| **Add Tags** | Tag an incident | incident_id, tags[] | updated_tags |
| **Link Incidents** | Link related incidents | incident_id_1, incident_id_2, relationship | link_id |
| **Merge Incidents** | Merge duplicate incidents | primary_id, duplicate_ids[] | merged_incident |
| **Close Incident** | Resolve and close | incident_id, resolution_note, root_cause | closed_at |
| **Extract IOCs** | Parse IOCs from incident data | text / email body / attachment | iocs[]: {type, value, context} |
| **Search Incidents** | Query past incidents | search query, filters, date range | matching_incidents[] |
| **Get Incident Details** | Fetch full incident data | incident_id | full_incident_object |
| **Calculate Risk Score** | Compute dynamic risk score | incident_id, factors | risk_score (0-100) |
| **Set SLA Override** | Override SLA for specific incident | incident_id, new_targets | updated_sla |
| **Record SLA Event** | Log custom SLA event | incident_id, event_type, metadata | event_id |

---

### Communication Nodes

| Node | Description | Configuration |
|------|-------------|---------------|
| **Send Email** | Send email via tenant's SMTP | to, cc, bcc, subject, body (HTML/text), attachments |
| **Send Reply** | Reply to incident's customer email thread | incident_id, body, include_history |
| **Slack Message** | Post to Slack channel or DM | channel/user, message, blocks (rich formatting) |
| **Slack Thread Reply** | Reply in existing Slack thread | thread_ts, channel, message |
| **Teams Message** | Post to Microsoft Teams | channel, adaptive card / text |
| **Teams Notification** | Send Teams notification | webhook_url, card_payload |
| **PagerDuty Alert** | Create/update PagerDuty incident | service, severity, title, details |
| **PagerDuty Resolve** | Resolve PagerDuty incident | incident_key |
| **OpsGenie Alert** | Create OpsGenie alert | message, priority, teams, tags |
| **SMS / WhatsApp** | Send SMS via Twilio/etc | phone_number, message |
| **Webhook (Outgoing)** | Send HTTP request to any endpoint | URL, method, headers, body, auth |
| **Push Notification** | In-app notification to analyst | user_id, title, message, action_url |
| **Create Ticket (Ext)** | Create ticket in external system | system (Jira/ServiceNow/etc), fields |

---

### Enrichment & Threat Intel Nodes

| Node | Description | Input | Output |
|------|-------------|-------|--------|
| **VirusTotal Lookup** | Check IP/domain/hash on VT | ioc_value, ioc_type | score, detections, report_url |
| **AbuseIPDB Check** | Check IP reputation | ip_address | abuse_score, reports, country |
| **Shodan Lookup** | Query Shodan for IP intel | ip_address | open_ports, vulns, org, os |
| **GreyNoise Check** | Check if IP is internet noise | ip_address | classification, noise, riot |
| **AlienVault OTX** | Query OTX pulse data | ioc_value, ioc_type | pulses, tags, adversaries |
| **MISP Lookup** | Search MISP instance | ioc_value | events, attributes, galaxies |
| **URLhaus Check** | Check URL against URLhaus | url | status, threat_type, tags |
| **MalwareBazaar** | Check file hash | hash (MD5/SHA256) | malware_family, signature, tags |
| **Whois Lookup** | Domain/IP whois | domain or ip | registrar, dates, nameservers, org |
| **DNS Resolve** | Forward/reverse DNS | domain or ip | records (A, AAAA, MX, TXT, CNAME) |
| **GeoIP Lookup** | Geolocate IP address | ip_address | country, city, lat/lng, asn |
| **Censys Search** | Censys host/certificate search | query | hosts, certificates, services |
| **Have I Been Pwned** | Check email in breaches | email_address | breaches[], pastes[] |
| **CrowdStrike Intel** | Query CrowdStrike threat intel | ioc_value | actors, malware, reports |
| **Recorded Future** | Recorded Future intel lookup | ioc_value | risk_score, rules, references |
| **Custom Feed Lookup** | Check against custom threat feeds | ioc_value, feed_name | match, context, confidence |
| **MITRE ATT&CK Map** | Map to ATT&CK techniques | description or indicators | techniques[], tactics[] |
| **CVE Lookup** | Check CVE details | cve_id | cvss_score, description, references |
| **Sandbox Submit** | Submit file to sandbox | file_hash or file_url | analysis_id, status |
| **Sandbox Results** | Get sandbox analysis results | analysis_id | verdict, behaviors, indicators |

---

### Transformation & Data Nodes

| Node | Description | Example |
|------|-------------|---------|
| **Set Variable** | Define/overwrite a variable | `enriched_ip = {{virustotal.output.score}}` |
| **JSON Parse** | Parse JSON string to object | Parse webhook body |
| **JSON Build** | Construct JSON from fields | Build API request payload |
| **Regex Extract** | Extract data using regex | Extract IPs from email body: `\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b` |
| **Regex Match** | Test if string matches pattern | Check if subject matches phishing pattern |
| **Text Template** | Render text with variables | Build email body with incident details |
| **HTML to Text** | Strip HTML to plain text | Clean email body for analysis |
| **Base64 Encode/Decode** | Encode or decode Base64 | Decode suspicious attachment |
| **Hash Compute** | Compute MD5/SHA1/SHA256 | Hash file for IOC comparison |
| **Date/Time Format** | Parse and format timestamps | Convert UTC to local time |
| **Math Expression** | Calculate numeric values | `risk_score = (severity_weight * 0.4) + (ioc_count * 0.3) + (exposure * 0.3)` |
| **Array Filter** | Filter list by condition | Keep only IOCs with VT score > 5 |
| **Array Map** | Transform each item in list | Extract just IP values from IOC objects |
| **Array Sort** | Sort list by field | Sort IOCs by risk score descending |
| **Aggregate** | Reduce list to single value | Count total high-risk IOCs |
| **Split Text** | Split string into array | Split comma-separated emails |
| **Concatenate** | Join strings/arrays | Combine enrichment results |
| **Lookup Table** | Map values using a table | Map severity to priority number |
| **Code (JavaScript)** | Run custom JS code | Custom transformation logic |
| **Code (Python)** | Run custom Python code | Advanced data manipulation |
| **HTTP Request** | Generic HTTP call | Call any REST API |
| **XML Parse** | Parse XML to JSON | Process STIX/TAXII feeds |

---

### Integration Nodes

#### SIEM / Log Management
| Node | Description |
|------|-------------|
| **Splunk Search** | Run SPL query, return results |
| **Splunk Alert** | Create/update Splunk notable event |
| **Elastic Search** | Query Elasticsearch / ELK |
| **QRadar Offense** | Get/update QRadar offenses |
| **Sentinel Query** | Run KQL in Microsoft Sentinel |
| **Chronicle Search** | Query Google Chronicle |
| **Sumo Logic Query** | Run Sumo Logic log search |

#### EDR / Endpoint
| Node | Description |
|------|-------------|
| **CrowdStrike Contain** | Isolate host via CrowdStrike |
| **CrowdStrike RTR** | Run Real Time Response command |
| **SentinelOne Isolate** | Network isolate endpoint |
| **SentinelOne Threat** | Get/mitigate S1 threat |
| **Carbon Black Isolate** | Isolate endpoint in CBC |
| **Carbon Black Query** | Search CB processes/events |
| **Defender Isolate** | Isolate machine via MS Defender |
| **Defender Scan** | Trigger AV scan on endpoint |

#### Firewall / Network
| Node | Description |
|------|-------------|
| **Palo Alto Block IP** | Add IP to PAN block list |
| **Palo Alto Block URL** | Add URL to PAN URL block list |
| **Fortinet Block** | Block IP/domain on FortiGate |
| **Cisco ASA Rule** | Add/remove firewall rule |
| **Zscaler Block** | Add to Zscaler blocklist |
| **Cloudflare WAF** | Create/update WAF rule |

#### Identity / IAM
| Node | Description |
|------|-------------|
| **Active Directory Disable** | Disable AD user account |
| **Active Directory Reset** | Force password reset |
| **Active Directory Groups** | Add/remove group membership |
| **Okta Suspend User** | Suspend Okta user |
| **Okta Clear Sessions** | Clear all active sessions |
| **Azure AD Revoke** | Revoke Azure AD tokens |
| **Azure AD MFA** | Force MFA re-enrollment |

#### Ticketing / ITSM
| Node | Description |
|------|-------------|
| **Jira Create Issue** | Create Jira ticket |
| **Jira Update Issue** | Update Jira fields/status |
| **Jira Add Comment** | Add comment to Jira issue |
| **ServiceNow Create** | Create ServiceNow incident |
| **ServiceNow Update** | Update SNOW record |
| **Zendesk Create** | Create Zendesk ticket |
| **Freshdesk Create** | Create Freshdesk ticket |

#### Cloud
| Node | Description |
|------|-------------|
| **AWS Security Hub** | Get/update Security Hub findings |
| **AWS GuardDuty** | Get GuardDuty findings |
| **AWS IAM** | Disable access keys, detach policies |
| **AWS S3** | Read/write S3 objects |
| **AWS Lambda** | Invoke Lambda function |
| **Azure Security Center** | Get/dismiss alerts |
| **GCP Security Command** | Get SCC findings |

#### Vulnerability Management
| Node | Description |
|------|-------------|
| **Qualys Scan** | Launch/get Qualys scan |
| **Nessus Scan** | Launch/get Nessus scan |
| **Rapid7 InsightVM** | Query vulnerability data |

---

### AI / LLM Nodes

| Node | Description | Configuration |
|------|-------------|---------------|
| **AI Classify** | Auto-classify incident type | Model, prompt template, categories |
| **AI Summarize** | Generate incident summary | Model, input fields, max length |
| **AI Sentiment** | Analyze customer email sentiment | Model, text input |
| **AI Extract IOCs** | AI-powered IOC extraction | Model, text/email body |
| **AI Suggest Actions** | Recommend response actions | Model, incident context, playbook library |
| **AI Draft Response** | Draft customer reply email | Model, incident context, tone |
| **AI Triage** | Auto-triage with severity recommendation | Model, incident data, historical patterns |
| **AI Correlate** | Find related incidents using AI | Model, incident details, search scope |
| **AI Root Cause** | Suggest root cause analysis | Model, incident timeline, enrichment data |
| **Custom LLM Prompt** | Run any custom prompt | Model, system prompt, user prompt, temperature |

---

### Response & Remediation Nodes

| Node | Description |
|------|-------------|
| **Block IOC** | Add IOC to platform's global blocklist |
| **Unblock IOC** | Remove IOC from blocklist |
| **Isolate Host** | Trigger host isolation (routes to configured EDR) |
| **Unisolate Host** | Remove host isolation |
| **Disable User** | Disable user account (routes to configured IAM) |
| **Reset Password** | Force password reset |
| **Revoke Sessions** | Kill all active sessions for user |
| **Quarantine Email** | Remove malicious email from mailboxes |
| **Block Sender** | Add sender to email blocklist |
| **Snapshot VM** | Take VM snapshot before remediation |
| **Rollback VM** | Restore VM from snapshot |

---

## Canvas & Builder UI

### Visual Editor Features

```
┌─────────────────────────────────────────────────────────┐
│  Workflow: Phishing Response Playbook         [▶ Run] [💾] │
│  ┌──────────┐                                            │
│  │ Node     │   ┌─────────────────────────────────────┐  │
│  │ Library  │   │                                     │  │
│  │          │   │          CANVAS AREA                 │  │
│  │ 🔍 Search│   │                                     │  │
│  │          │   │   [Trigger] ──→ [Condition]         │  │
│  │ Triggers │   │                  ↙      ↘           │  │
│  │ Logic    │   │         [Enrich]    [Close]         │  │
│  │ SOC      │   │            ↓                        │  │
│  │ Comms    │   │      [Block IP]                     │  │
│  │ Enrich   │   │            ↓                        │  │
│  │ Transform│   │      [Send Email]                   │  │
│  │ Integrate│   │                                     │  │
│  │ AI       │   │                                     │  │
│  │ Response │   └─────────────────────────────────────┘  │
│  └──────────┘   [Execution Log] [Variables] [Settings]   │
└─────────────────────────────────────────────────────────┘
```

### Canvas Capabilities

| Feature | Description |
|---------|-------------|
| **Drag & Drop** | Drag nodes from library onto canvas |
| **Connect Nodes** | Click output port → drag to input port to create edge |
| **Multi-select** | Shift+click or drag-select multiple nodes |
| **Group / Frame** | Group related nodes with a labeled frame |
| **Copy / Paste** | Duplicate nodes or groups |
| **Undo / Redo** | Full undo/redo history (Ctrl+Z / Ctrl+Shift+Z) |
| **Zoom & Pan** | Scroll to zoom, click+drag to pan |
| **Minimap** | Bottom-right minimap for large workflows |
| **Snap to Grid** | Nodes snap to grid for alignment |
| **Auto-layout** | Auto-arrange nodes (dagre/ELK algorithm) |
| **Search Nodes** | Search node library by name/category |
| **Sticky Notes** | Add text annotations on canvas |
| **Color Coding** | Color-code nodes and edges by category |
| **Execution Path** | Highlight executed path during/after run |
| **Error Indicators** | Red border on nodes that failed |
| **Node Preview** | Hover to see last execution output |

### Node Configuration Panel

When a node is selected, a right panel slides in:

```
┌──────────────────────────────┐
│  VirusTotal Lookup           │
│  ─────────────────────────── │
│                              │
│  IOC Type:  [IP Address ▼]   │
│  Value:     {{extract.ip}}   │
│                              │
│  API Key:   [VT Credential▼] │
│                              │
│  ── Advanced ──              │
│  Timeout:   [30] seconds     │
│  Retry:     [3] times        │
│  On Error:  [Continue ▼]     │
│                              │
│  ── Output ──                │
│  score: number               │
│  detections: object          │
│  report_url: string          │
│                              │
│  [Test Node] [Delete]        │
└──────────────────────────────┘
```

### Expression Editor

For dynamic values in node inputs:

```
┌──────────────────────────────────────┐
│  Expression Editor                    │
│  ──────────────────────────────────── │
│                                       │
│  {{incident.severity}}                │
│  {{virustotal.output.score}}          │
│  {{IF(vt.score > 5, "malicious",     │
│       "benign")}}                     │
│                                       │
│  Available Variables:                 │
│  ├── trigger                          │
│  │   ├── incident_id                  │
│  │   ├── severity                     │
│  │   └── title                        │
│  ├── extract_iocs                     │
│  │   └── output                       │
│  │       ├── ips[]                    │
│  │       ├── domains[]                │
│  │       └── hashes[]                 │
│  └── virustotal                       │
│      └── output                       │
│          ├── score                     │
│          └── detections               │
└──────────────────────────────────────┘
```

---

## Workflow Management

### Workflow States

| State | Description |
|-------|-------------|
| **Draft** | Being edited, not active |
| **Active** | Published and running on triggers |
| **Paused** | Temporarily disabled |
| **Archived** | No longer in use, kept for history |
| **Error** | Disabled due to repeated failures |

### Version Control

- Every save creates a new version
- View diff between versions
- Rollback to any previous version
- Branch workflows for testing (clone → modify → promote)

### Permissions

| Role | Can View | Can Edit | Can Run | Can Publish | Can Delete |
|------|----------|----------|---------|-------------|------------|
| Analyst | ✅ | ❌ | ✅ (manual) | ❌ | ❌ |
| Senior Analyst | ✅ | ✅ | ✅ | ❌ | ❌ |
| Team Lead | ✅ | ✅ | ✅ | ✅ | ❌ |
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| Super Admin | ✅ | ✅ | ✅ | ✅ | ✅ |

### Execution History

| Column | Description |
|--------|-------------|
| Execution ID | Unique run identifier |
| Trigger | What started this run |
| Started At | Timestamp |
| Duration | Total execution time |
| Status | Success / Failed / Running / Cancelled |
| Nodes Run | X of Y nodes executed |
| Incident | Linked incident (if applicable) |

Click into any execution to see:
- Per-node input/output data
- Per-node execution time
- Error details for failed nodes
- Execution path highlighted on canvas

---

## Template Library (Pre-built Playbooks)

### Phishing Response

```
Email Received → Extract IOCs → Parallel [
    VirusTotal (URLs) + AbuseIPDB (IPs) + URLhaus (URLs)
] → If malicious:
    → Block sender
    → Quarantine email from all mailboxes
    → Escalate to Tier 2
    → Send notification to affected user
    → Update incident (status: investigating, add enrichment notes)
→ Else:
    → Add comment "No threats found"
    → Close incident
```

### Malware Containment

```
Incident Created (severity: critical, source: EDR) →
    Get Host Details → Isolate Host →
    Snapshot VM → Extract IOCs from alert →
    Parallel [
        Sandbox Submit + VT Lookup + MalwareBazaar
    ] → AI Summarize findings →
    Assign to Malware Team →
    Send Slack alert to #incident-response →
    PagerDuty Alert
```

### Brute Force Response

```
Incident Created (title matches "brute force") →
    Extract source IP → AbuseIPDB + GreyNoise →
    If abuse score > 80:
        → Block IP on firewall
        → Disable target user account
        → Force password reset
        → Send email to user about locked account
        → Update incident with actions taken
    Else:
        → Add comment with enrichment
        → Assign to Tier 1 for review
```

### Suspicious Login

```
Incident Created (type: suspicious_login) →
    Get user details from AD →
    GeoIP lookup on login IP →
    If country != user's usual country:
        → Revoke all sessions
        → Force MFA re-enrollment
        → Send SMS verification to user
        → Wait for user confirmation (approval gate)
        → If confirmed legitimate: restore access, close
        → If not confirmed: escalate, investigate
```

### Vulnerability Response

```
Schedule (daily 9am) →
    Qualys Scan Results → Filter critical vulns →
    For each vuln:
        → Search existing incidents for this CVE
        → If no existing incident:
            → Create incident (severity from CVSS)
            → Assign to vulnerability team
            → Add CVE details and affected hosts
            → If CVSS >= 9.0: PagerDuty alert
        → Else:
            → Update existing incident with new findings
```

### Data Exfiltration Response

```
Incident Created (type: data_exfiltration) →
    Get source host → Isolate host →
    Get user sessions → Revoke all sessions →
    Parallel [
        Query SIEM for related events (last 24h),
        Get DLP alerts for user,
        Get recent file access logs
    ] → AI Correlate & Summarize →
    Create executive incident report →
    Escalate to CISO → Send Teams notification to legal
```

### Customer Ticket Auto-Triage

```
Incident Created (source: email) →
    AI Classify incident type →
    AI Triage (suggest severity) →
    Extract IOCs (if any) →
    Switch by classification:
        → Phishing: run Phishing Response sub-workflow
        → Malware: run Malware Containment sub-workflow
        → Access Issue: assign to IAM team
        → Information Request: AI Draft Response → send auto-reply
        → Unknown: assign to Tier 1 for manual review
```

### SLA Escalation Workflow

```
SLA Approaching (75% elapsed) →
    Send push notification to assigned analyst →
    Wait 15 minutes →
    If still not responded:
        → Send email reminder to analyst
        → Send Slack DM to analyst
    → Wait until SLA breached or resolved →
    If SLA Breached:
        → Reassign to team lead
        → Send escalation email
        → PagerDuty alert (if critical)
        → Record escalation event
```

### Recurring Threat Hunt

```
Schedule (weekly Monday 8am) →
    Fetch latest IOCs from threat feeds →
    For each IOC batch:
        → Splunk search across all logs (last 7 days)
        → Elastic search across all indices
    → Aggregate matches →
    If matches found:
        → Create incident per unique threat
        → Enrich each IOC → Assign to threat hunt team
        → Generate weekly threat hunt report
    → Send report to #threat-intel Slack channel
```

### Incident Post-Mortem

```
Status Changed (to: closed) → Wait 24 hours →
    Get full incident timeline →
    Get all comments and actions →
    AI Summarize incident (root cause, actions, timeline) →
    AI Suggest improvements →
    Create post-mortem document →
    If severity was critical or high:
        → Schedule review meeting (calendar invite)
        → Send post-mortem to leadership
    → Archive incident data
```

---

## Execution Engine

### Engine Architecture

```
┌─────────────────────────────────────────────┐
│              Event Bus (Redis/Kafka)          │
│  incidents.created | incidents.updated | ...  │
└──────┬──────────────────────────────┬────────┘
       │                              │
┌──────▼──────┐               ┌──────▼──────┐
│  Trigger    │               │  Trigger    │
│  Evaluator  │               │  Evaluator  │
│  (Worker 1) │               │  (Worker N) │
└──────┬──────┘               └──────┬──────┘
       │ matched                     │
┌──────▼─────────────────────────────▼────────┐
│            Execution Queue (Redis)           │
└──────┬──────────────────────────────┬────────┘
       │                              │
┌──────▼──────┐               ┌──────▼──────┐
│  Executor   │               │  Executor   │
│  Worker 1   │               │  Worker N   │
│  ┌────────┐ │               │  ┌────────┐ │
│  │ Node   │ │               │  │ Node   │ │
│  │ Runner │ │               │  │ Runner │ │
│  └────────┘ │               │  └────────┘ │
└─────────────┘               └─────────────┘
```

### Execution Modes

| Mode | Description |
|------|-------------|
| **Automatic** | Triggered by events, runs unattended |
| **Manual** | Analyst clicks "Run" with optional input |
| **Scheduled** | Cron-based execution |
| **Debug** | Step-by-step execution with breakpoints |
| **Dry Run** | Execute without side effects (simulate) |
| **Replay** | Re-run a previous execution with same or modified input |

### Error Handling

| Strategy | Description |
|----------|-------------|
| **Retry** | Retry failed node X times with exponential backoff |
| **Continue** | Skip failed node, continue workflow |
| **Stop** | Halt entire workflow on failure |
| **Fallback** | Execute alternate branch on failure |
| **Alert** | Stop and notify admin |
| **Dead Letter** | Move failed execution to DLQ for manual review |

### Resource Limits

| Limit | Default | Configurable |
|-------|---------|-------------|
| Max nodes per workflow | 100 | ✅ |
| Max execution time | 30 minutes | ✅ |
| Max concurrent executions | 50 per tenant | ✅ |
| Max loop iterations | 1000 | ✅ |
| Max data size per node | 10 MB | ✅ |
| Max webhook payload | 5 MB | ✅ |
| API rate limit per node | 60/minute | ✅ per integration |

---

## Variables & Expressions

### Variable Syntax

```javascript
// Access trigger data
{{trigger.incident.id}}
{{trigger.incident.severity}}
{{trigger.incident.title}}

// Access node output
{{node_name.output.field}}
{{virustotal_lookup.output.score}}
{{extract_iocs.output.ips[0]}}

// Built-in variables
{{$workflow.id}}
{{$workflow.name}}
{{$execution.id}}
{{$execution.started_at}}
{{$now}}                    // Current ISO timestamp
{{$today}}                  // Current date
{{$tenant.id}}
{{$tenant.name}}
{{$user.id}}                // Analyst who triggered
{{$user.email}}

// Expression functions
{{IF(condition, true_value, false_value)}}
{{CONTAINS(string, substring)}}
{{REGEX_MATCH(string, pattern)}}
{{LENGTH(array)}}
{{JOIN(array, separator)}}
{{UPPER(string)}}
{{LOWER(string)}}
{{TRIM(string)}}
{{FORMAT_DATE(date, format)}}
{{DIFF_MINUTES(date1, date2)}}
{{JSON_STRINGIFY(object)}}
{{JSON_PARSE(string)}}
{{LOOKUP(table_name, key)}}
{{RANDOM(min, max)}}
{{SHA256(string)}}
{{BASE64_ENCODE(string)}}
{{BASE64_DECODE(string)}}
```

---

## Audit & Compliance

### Audit Trail

Every workflow action is logged:

```json
{
    "timestamp": "2026-03-14T10:30:00Z",
    "workflow_id": "wf_abc123",
    "execution_id": "exec_xyz789",
    "node_id": "node_5",
    "node_type": "block_ip",
    "action": "Block IP on firewall",
    "input": {"ip": "192.168.1.100"},
    "output": {"success": true, "rule_id": "fw_rule_456"},
    "actor": "automation",
    "incident_id": "INC-2026-001",
    "tenant_id": "tenant_abc",
    "duration_ms": 1250
}
```

### Compliance Features

| Feature | Description |
|---------|-------------|
| **Immutable Logs** | Execution logs cannot be modified or deleted |
| **Data Retention** | Configurable retention per tenant (30/60/90/365 days) |
| **PII Masking** | Auto-mask sensitive fields in logs |
| **Export** | Export audit logs to SIEM or external storage |
| **RBAC** | Role-based access to workflows and executions |
| **Approval Workflows** | Require human approval for destructive actions |
| **Change History** | Full version history for all workflow modifications |

---

## Architecture

### Tech Stack

| Component | Technology |
|-----------|------------|
| **Canvas UI** | React Flow (xyflow) — mature, MIT-licensed, React-native |
| **State Management** | Zustand (lightweight, already pattern in codebase) |
| **Backend Engine** | Python (FastAPI) — new `automation-service` |
| **Queue** | Redis (BullMQ-style) or Celery |
| **Event Bus** | Redis Pub/Sub or Kafka (future) |
| **Node Executor** | Python async (asyncio) with timeout/retry |
| **Expression Parser** | Custom parser or Jinja2 templates |
| **Storage** | PostgreSQL (workflow definitions + execution history) |
| **Secrets** | Encrypted credentials table (Fernet/AES-256) |
| **Sandbox** | Docker containers for custom code nodes (optional) |

### Service Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  ui-console │────▶│ automation-service │────▶│   Redis     │
│  (React)    │     │   (FastAPI)       │     │  (Queue +   │
│             │     │                    │     │   PubSub)   │
│  React Flow │     │  - Workflow CRUD   │     └──────┬──────┘
│  Canvas     │     │  - Trigger Eval    │            │
│             │     │  - Executor Pool   │     ┌──────▼──────┐
└─────────────┘     │  - Credential Mgr  │     │  Workers    │
                    └────────┬───────────┘     │  (Celery/   │
                             │                 │   asyncio)  │
                    ┌────────▼───────────┐     └─────────────┘
                    │   PostgreSQL       │
                    │  - workflows       │
                    │  - workflow_nodes  │
                    │  - workflow_edges  │
                    │  - executions      │
                    │  - execution_logs  │
                    │  - credentials     │
                    │  - templates       │
                    └────────────────────┘
```

---

## Database Schema

### Core Tables

```sql
-- Workflow definitions
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'draft',  -- draft, active, paused, archived, error
    version INT DEFAULT 1,
    canvas_data JSONB,                   -- React Flow viewport, zoom, position
    settings JSONB DEFAULT '{}',         -- timeout, retry policy, etc.
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, name, version)
);

-- Individual nodes in a workflow
CREATE TABLE workflow_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    node_type VARCHAR(100) NOT NULL,     -- e.g., "virustotal_lookup"
    category VARCHAR(50),                -- trigger, logic, soc, comms, enrich, etc.
    label VARCHAR(255),
    config JSONB DEFAULT '{}',           -- node-specific configuration
    position_x FLOAT,
    position_y FLOAT,
    credential_id UUID,                  -- linked credential (nullable)
    error_handling VARCHAR(20) DEFAULT 'stop',
    retry_count INT DEFAULT 0,
    retry_delay_sec INT DEFAULT 5,
    timeout_sec INT DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Edges connecting nodes
CREATE TABLE workflow_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    source_node_id UUID REFERENCES workflow_nodes(id) ON DELETE CASCADE,
    target_node_id UUID REFERENCES workflow_nodes(id) ON DELETE CASCADE,
    condition JSONB,                     -- for conditional edges (if/switch)
    label VARCHAR(100),
    edge_type VARCHAR(20) DEFAULT 'default',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workflow execution records
CREATE TABLE workflow_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id),
    workflow_version INT,
    tenant_id VARCHAR(100) NOT NULL,
    trigger_type VARCHAR(50),            -- event, manual, schedule, webhook
    trigger_data JSONB,                  -- input data that started the run
    status VARCHAR(20) DEFAULT 'pending', -- pending, running, success, failed, cancelled, timeout
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INT,
    nodes_total INT,
    nodes_executed INT,
    nodes_failed INT,
    error_message TEXT,
    incident_id UUID,                    -- linked incident (nullable)
    triggered_by VARCHAR(100),           -- user or "system"
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-node execution log
CREATE TABLE execution_node_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
    node_id UUID REFERENCES workflow_nodes(id),
    node_type VARCHAR(100),
    status VARCHAR(20),                  -- pending, running, success, failed, skipped
    input_data JSONB,
    output_data JSONB,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INT,
    retry_attempt INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stored credentials for integrations
CREATE TABLE automation_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50),                    -- api_key, oauth2, basic_auth, bearer
    encrypted_data BYTEA NOT NULL,       -- AES-256 encrypted credential JSON
    integration VARCHAR(100),            -- virustotal, crowdstrike, etc.
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

-- Workflow templates (pre-built playbooks)
CREATE TABLE workflow_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50),                -- phishing, malware, brute_force, etc.
    workflow_data JSONB NOT NULL,         -- full workflow definition (nodes + edges)
    tags TEXT[],
    is_official BOOLEAN DEFAULT false,
    usage_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook endpoints for external triggers
CREATE TABLE workflow_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    node_id UUID REFERENCES workflow_nodes(id),
    path VARCHAR(255) UNIQUE NOT NULL,   -- /webhooks/{path}
    auth_type VARCHAR(20) DEFAULT 'none', -- none, api_key, hmac
    auth_config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API Endpoints

### Workflow CRUD

```
GET    /automations/workflows                    — List all workflows (filterable)
POST   /automations/workflows                    — Create new workflow
GET    /automations/workflows/{id}               — Get workflow with nodes & edges
PUT    /automations/workflows/{id}               — Update workflow
DELETE /automations/workflows/{id}               — Delete (archive) workflow
POST   /automations/workflows/{id}/publish       — Activate workflow
POST   /automations/workflows/{id}/pause         — Pause workflow
POST   /automations/workflows/{id}/clone         — Clone workflow
GET    /automations/workflows/{id}/versions      — List versions
GET    /automations/workflows/{id}/versions/{v}  — Get specific version
```

### Execution

```
POST   /automations/workflows/{id}/execute       — Manual trigger
GET    /automations/executions                    — List executions (filterable)
GET    /automations/executions/{id}               — Get execution details + node logs
POST   /automations/executions/{id}/cancel        — Cancel running execution
POST   /automations/executions/{id}/replay        — Replay execution
GET    /automations/executions/{id}/nodes/{nid}   — Get specific node execution details
```

### Templates

```
GET    /automations/templates                     — List available templates
GET    /automations/templates/{id}                — Get template details
POST   /automations/templates/{id}/use            — Create workflow from template
```

### Credentials

```
GET    /automations/credentials                   — List credentials (no secrets)
POST   /automations/credentials                   — Create credential
PUT    /automations/credentials/{id}              — Update credential
DELETE /automations/credentials/{id}              — Delete credential
POST   /automations/credentials/{id}/test         — Test credential connectivity
```

### Webhooks

```
POST   /webhooks/{path}                           — External webhook trigger
GET    /automations/webhooks                      — List webhook endpoints
```

---

## Implementation Phases

### Phase 1 — Foundation (3-4 weeks)

**Goal:** Core canvas, basic node execution, 5-10 essential nodes

| Task | Details | Priority |
|------|---------|----------|
| Database tables | Create all schema tables above | P0 |
| automation-service | New FastAPI service with workflow CRUD | P0 |
| React Flow canvas | Drag-and-drop editor with node library | P0 |
| Basic nodes | Trigger (incident_created), If/Condition, Set Variable, Add Comment, Change Status | P0 |
| Simple executor | Sequential node execution with variable passing | P0 |
| Execution history | View past runs with per-node logs | P0 |
| Workflow activate/pause | Toggle workflows on/off | P1 |
| Manual trigger | Run workflow on demand | P1 |

### Phase 2 — Essential Nodes (2-3 weeks)

**Goal:** SOC-specific actions and basic enrichment

| Task | Details | Priority |
|------|---------|----------|
| SOC Action nodes | Create/Update Incident, Assign, Escalate, Close, Extract IOCs | P0 |
| Communication nodes | Send Email, Push Notification, Webhook (outgoing) | P0 |
| Enrichment nodes | VirusTotal, AbuseIPDB, Whois, DNS, GeoIP | P0 |
| Logic nodes | Switch/Router, Loop, Parallel, Merge | P1 |
| Credential manager | Encrypted storage + UI for managing API keys | P1 |
| Expression editor | Variable browser + autocomplete | P1 |

### Phase 3 — Templates & Advanced Flow (2-3 weeks)

**Goal:** Pre-built playbooks and advanced execution features

| Task | Details | Priority |
|------|---------|----------|
| Template library | 5-8 pre-built playbooks (Phishing, Malware, Brute Force, etc.) | P0 |
| Error handling | Try/Catch, retry, fallback branches | P0 |
| Approval gates | Human-in-the-loop approval steps | P1 |
| Wait for event | Pause execution until external event | P1 |
| Sub-workflows | Call workflow from workflow | P1 |
| Debug mode | Step-by-step execution with breakpoints | P2 |
| Dry run | Simulate without side effects | P2 |

### Phase 4 — Integrations (3-4 weeks)

**Goal:** Connect to external security tools

| Task | Details | Priority |
|------|---------|----------|
| Slack integration | Message, thread reply, interactive buttons | P0 |
| Teams integration | Message, adaptive cards | P0 |
| Jira integration | Create/update issues | P0 |
| PagerDuty | Create/resolve alerts | P1 |
| EDR integration | CrowdStrike / SentinelOne / Defender | P1 |
| Firewall integration | Palo Alto / Fortinet block lists | P1 |
| IAM integration | AD / Okta / Azure AD user actions | P2 |
| SIEM integration | Splunk / Elastic search queries | P2 |

### Phase 5 — AI & Analytics (2-3 weeks)

**Goal:** AI-powered automation and workflow analytics

| Task | Details | Priority |
|------|---------|----------|
| AI Classify node | Auto-classify incident type | P0 |
| AI Summarize node | Generate incident summaries | P0 |
| AI Triage node | Auto-triage with severity suggestion | P1 |
| AI Draft Response | Draft customer reply | P1 |
| Custom Code nodes | JavaScript/Python execution sandbox | P1 |
| Workflow analytics | Dashboard with success rate, avg duration, most used | P2 |
| Usage metrics | Node popularity, failure rates, bottleneck detection | P2 |

### Phase 6 — Enterprise (4-6 weeks)

**Goal:** Enterprise-grade features

| Task | Details | Priority |
|------|---------|----------|
| Workflow marketplace | Share workflows across tenants | P1 |
| Advanced RBAC | Per-workflow permissions | P1 |
| Data retention policies | Auto-purge old executions | P1 |
| High availability | Multi-worker execution pool | P2 |
| Event-driven scaling | Auto-scale workers based on queue depth | P2 |
| API rate limiting | Per-tenant, per-integration rate limits | P2 |
| SSO for credentials | OAuth2 flows for integrations | P2 |
| Mobile notifications | Push to mobile app | P3 |

---

## Summary

| Metric | Count |
|--------|-------|
| **Total Node Types** | 120+ |
| **Trigger Types** | 14 |
| **Logic Nodes** | 13 |
| **SOC Action Nodes** | 17 |
| **Communication Nodes** | 13 |
| **Enrichment Nodes** | 20+ |
| **Transform Nodes** | 20+ |
| **Integration Nodes** | 35+ |
| **AI Nodes** | 10 |
| **Pre-built Templates** | 9 |
| **Implementation Phases** | 6 |
| **Estimated Total Time** | 16-23 weeks |

---

*This document serves as the complete specification for the SOCFlow Automation Builder. Each phase builds on the previous, delivering value incrementally while working toward a full-featured SOAR (Security Orchestration, Automation and Response) platform.*
