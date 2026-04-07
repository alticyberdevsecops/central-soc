# Central SOC — Integration Guide

Bidirectional ticket sync between Central SOC and third-party ITSM platforms.
When an incident is created or updated in Central SOC it is automatically mirrored to the connected ITSM tool, and vice versa.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Database Migration](#database-migration)
4. [Freshservice Integration](#freshservice-integration)
   - [Step 1 — Configure in Marketplace](#freshservice-step-1--configure-in-marketplace)
   - [Step 2 — Set Up Webhook in Freshservice](#freshservice-step-2--set-up-webhook-in-freshservice)
   - [Step 3 — Verify Bidirectional Sync](#freshservice-step-3--verify-bidirectional-sync)
5. [Freshdesk Integration](#freshdesk-integration)
   - [Step 1 — Configure in Marketplace](#freshdesk-step-1--configure-in-marketplace)
   - [Step 2 — Set Up Webhook in Freshdesk](#freshdesk-step-2--set-up-webhook-in-freshdesk)
   - [Step 3 — Verify Bidirectional Sync](#freshdesk-step-3--verify-bidirectional-sync)
6. [ServiceNow Integration](#servicenow-integration)
   - [Step 1 — Configure in Marketplace](#servicenow-step-1--configure-in-marketplace)
   - [Step 2 — Create a ServiceNow Integration User](#servicenow-step-2--create-a-servicenow-integration-user)
   - [Step 3 — Set Up Business Rule Webhook in ServiceNow](#servicenow-step-3--set-up-business-rule-webhook-in-servicenow)
   - [Step 4 — Verify Bidirectional Sync](#servicenow-step-4--verify-bidirectional-sync)
7. [Field Mappings Reference](#field-mappings-reference)
8. [Troubleshooting](#troubleshooting)

---

## Overview

| Integration | Auth Method | Outbound (SOC → ITSM) | Inbound (ITSM → SOC) |
|---|---|---|---|
| **Freshservice** | API Key (Basic auth) | POST `/api/v2/tickets` | Workflow Automator webhook |
| **Freshdesk** | API Key (Basic auth) | POST `/api/v2/tickets` | Automation (Observer) webhook |
| **ServiceNow** | Username + Password (Basic auth) | POST/PATCH `/api/now/table/incident` | Business Rule + Script Action |

Both integrations are **fire-and-forget outbound** — SOC never fails because an ITSM tool is unreachable.
Inbound sync is handled via public webhook endpoints that require no JWT token.

---

## Prerequisites

- Central SOC is running (`docker compose up -d`)
- You are logged in as **super_admin** or **customer_admin**
- The integration tables have been created (see [Database Migration](#database-migration))
- Network access between the ITSM tool and the SOC API gateway (port `8012` by default)

---

## Database Migration

If this is a fresh deployment, or if you have not run the integration migration yet, run the following command once:

```bash
docker compose exec incident-service python migrate_integrations.py
```

Expected output:
```
✓ CREATE TABLE IF NOT EXISTS public.integration_configs …
✓ CREATE TABLE IF NOT EXISTS public.integration_ticket_mappings …
✓ CREATE INDEX IF NOT EXISTS idx_integration_configs_tenant …
✓ CREATE INDEX IF NOT EXISTS idx_itm_external …
✓ CREATE INDEX IF NOT EXISTS idx_itm_soc_incident …
✓ DO $do$ …

✅ Integration tables created successfully.
```

> **Note:** This is a no-op on subsequent runs (`IF NOT EXISTS` guards are in place).

---

## Freshservice Integration

### Freshservice Step 1 — Configure in Marketplace

1. Log in to Central SOC as **super_admin** or **customer_admin**.
2. Click **Marketplace** in the left sidebar.
3. Locate the **Freshservice** card and click **Configure**.

**Super Admin view:**
- A list of all tenants is shown.
- Select one or more tenants using the checkboxes.
- Use the **Enable / Disable** bulk action bar to toggle multiple tenants at once.
- Click **Configure ▸** next to any tenant to open its config form.

**Customer Admin view:**
- Only your own tenant is shown. The config form opens directly.

4. Fill in the config form:

   | Field | Description | Example |
   |---|---|---|
   | **Freshservice Domain** | Your Freshservice subdomain | `acmecorp` → `acmecorp.freshservice.com` |
   | **API Key** | Found in Freshservice → Profile → API Key | `abc123xyz...` |
   | **Requester Email** | The email tickets will be created under | `soc@acmecorp.com` |

5. Toggle **Enable Freshservice Sync** to ON.
6. Click **Save & Apply**.

> After saving, a **Webhook URL** will appear in the form. Copy it — you will need it in the next step.

---

### Freshservice Step 2 — Set Up Webhook in Freshservice

This step tells Freshservice to notify Central SOC whenever a ticket is updated.

1. Log in to your Freshservice admin portal.
2. Go to **Admin → Workflow Automator**.
3. Click **New Automator** (or **New Rule** depending on your version).
4. Set the following:

   - **Name:** `Central SOC Bidirectional Sync`
   - **Trigger:** `Ticket is updated`
   - **Condition:** Tag → contains → `central-soc`
     *(This tag is auto-applied by Central SOC when creating tickets, preventing sync loops.)*

5. Add an **Action:**
   - Action type: **Trigger Webhook**
   - Method: `POST`
   - URL: paste the **Webhook URL** copied from the Marketplace
   - Content type: `JSON`
   - Content: **All Ticket Properties**

6. Click **Save** then **Activate** the rule.

> **Webhook URL format:**
> ```
> https://<your-soc-host>:8012/incidents/webhooks/freshservice?tenant_id=<tenant-uuid>
> ```

---

### Freshservice Step 3 — Verify Bidirectional Sync

**Outbound (SOC → Freshservice):**
1. Create a new incident in Central SOC for the configured tenant.
2. Within a few seconds, a new ticket should appear in Freshservice with:
   - Subject starting with `[SOC]`
   - Tags: `central-soc` and the SOC ticket ID (e.g., `SOC-0042`)
   - Priority matching the SOC severity

**Inbound (Freshservice → SOC):**
1. In Freshservice, find the ticket created above.
2. Change its status (e.g., Resolved or Closed).
3. The Workflow Automator fires the webhook.
4. Open the incident in Central SOC — its status should update within seconds.

---

---

## Freshdesk Integration

Freshdesk is a customer support platform by Freshworks. The integration uses the same v2 REST API and Basic auth pattern as Freshservice but targets `freshdesk.com` and uses Freshdesk's **Automation (Observer)** rules for inbound webhooks.

> **Freshdesk vs Freshservice:** Freshdesk is for external customer support; Freshservice is for internal IT service management. Both have identical API shapes and are configured separately in the Marketplace.

### Freshdesk Step 1 — Configure in Marketplace

1. Log in to Central SOC as **super_admin** or **customer_admin**.
2. Click **Marketplace** in the left sidebar.
3. Locate the **Freshdesk** card and click **Configure**.
4. Fill in the config form:

   | Field | Description | Example |
   |---|---|---|
   | **Freshdesk Domain** | Your Freshdesk subdomain | `acmecorp` → `acmecorp.freshdesk.com` |
   | **API Key** | Found under Profile Settings → Your API Key | `abc123xyz...` |
   | **Requester Email** | The email tickets will be created under | `soc@acmecorp.com` |

5. Toggle **Enable Freshdesk Sync** to ON.
6. Click **Save & Apply**.

> After saving, a **Webhook URL** appears. Copy it — you'll use it in the next step.

---

### Freshdesk Step 2 — Set Up Webhook in Freshdesk

This tells Freshdesk to notify Central SOC whenever a ticket is updated.

1. Log in to your Freshdesk admin portal.
2. Go to **Admin → Automation → Ticket Updates** (this is the "Observer" section).
3. Click **New Rule**.
4. Set the following:

   - **Rule Name:** `Central SOC Bidirectional Sync`
   - **When any of these events occur:** Ticket is updated (any action)
   - **On tickets with these properties:** Tag → Contains → `central-soc`
     *(This tag is auto-applied by Central SOC on ticket creation, preventing sync loops.)*

5. Under **Perform these actions:**
   - Action: **Trigger Webhook**
   - Request type: `POST`
   - URL: paste the **Webhook URL** copied from the Marketplace
   - Encoding: `JSON`
   - Content: **All Ticket Properties**

6. Click **Save**.

> **Webhook URL format:**
> ```
> https://<your-soc-host>:8012/incidents/webhooks/freshdesk?tenant_id=<tenant-uuid>
> ```

**Finding your API Key in Freshdesk:**
1. Click your avatar (top-right) → **Profile Settings**
2. Your API key is shown on the right side of the page under **Your API Key**
3. Click the key icon to reveal it

---

### Freshdesk Step 3 — Verify Bidirectional Sync

**Outbound (SOC → Freshdesk):**
1. Create a new incident in Central SOC for the configured tenant.
2. Within a few seconds, a new ticket should appear in Freshdesk with:
   - Subject starting with `[SOC]`
   - Tags: `central-soc` and the SOC ticket ID (e.g., `SOC-0042`)
   - Priority matching the SOC severity

**Inbound (Freshdesk → SOC):**
1. In Freshdesk, open the ticket created above.
2. Change its status (e.g., Resolved or Closed).
3. The Observer automation fires the webhook.
4. Open the incident in Central SOC — its status should update within seconds.

---

## ServiceNow Integration

### ServiceNow Step 1 — Configure in Marketplace

1. Log in to Central SOC as **super_admin** or **customer_admin**.
2. Click **Marketplace** in the left sidebar.
3. Locate the **ServiceNow** card and click **Configure**.
4. Fill in the config form:

   | Field | Description | Example |
   |---|---|---|
   | **ServiceNow Instance** | Your ServiceNow subdomain | `acmecorp` → `acmecorp.service-now.com` |
   | **Username** | The integration user created in Step 2 | `soc_integration` |
   | **Password** | The integration user's password | `••••••••••` |
   | **Caller sys_id** | *(Optional)* sys_id of a default caller user | `abc123...` |

5. Toggle **Enable ServiceNow Sync** to ON.
6. Click **Save & Apply**.

> After saving, a **Webhook URL** will appear. Copy it — you will need it in Step 3.

---

### ServiceNow Step 2 — Create a ServiceNow Integration User

It is strongly recommended to use a dedicated service account rather than your admin credentials.

1. In ServiceNow, go to **User Administration → Users → New**.
2. Fill in:
   - **User ID:** `soc_integration`
   - **First name / Last name:** `SOC Integration`
   - **Email:** `soc@yourcompany.com`
   - **Password:** set a strong password
3. Under **Roles**, assign the following roles:
   - `itil` — allows creating and updating incidents
   - `rest_api_explorer` — allows REST API access (optional, for testing)
4. Click **Submit**.

> Use this user's credentials in the Marketplace config form (Step 1).

---

### ServiceNow Step 3 — Set Up Business Rule Webhook in ServiceNow

ServiceNow does not have native webhook toggles. You need to create a **Business Rule** that fires a **REST call** to Central SOC when an incident is updated.

1. In ServiceNow, navigate to **System Definition → Business Rules**.
2. Click **New**.
3. Fill in the header:
   - **Name:** `Central SOC Bidirectional Sync`
   - **Table:** `Incident [incident]`
   - **When:** `after`
   - **Update:** ✅ checked
   - **Active:** ✅ checked

4. Click the **Advanced** tab and enable **Advanced**.
5. Paste the following script into the **Script** field, replacing the webhook URL:

```javascript
(function executeRule(current, previous) {

    var webhookUrl = 'https://<your-soc-host>:8012/incidents/webhooks/servicenow?tenant_id=<tenant-uuid>';

    var body = {
        "sys_id": current.sys_id.toString(),
        "state":  current.state.toString(),
        "number": current.number.toString()
    };

    var request = new sn_ws.RESTMessageV2();
    request.setEndpoint(webhookUrl);
    request.setHttpMethod('POST');
    request.setRequestHeader('Content-Type', 'application/json');
    request.setRequestBody(JSON.stringify(body));

    try {
        var response = request.execute();
        gs.info('Central SOC webhook response: ' + response.getStatusCode());
    } catch (ex) {
        gs.warn('Central SOC webhook failed: ' + ex.getMessage());
    }

})(current, previous);
```

6. Replace the two placeholders:
   - `<your-soc-host>` — the IP or hostname of your Central SOC server
   - `<tenant-uuid>` — the Tenant UUID (visible in the Marketplace webhook URL)

7. *(Optional)* Add a **Condition** to filter only relevant incidents, e.g.:
   ```javascript
   current.short_description.startsWith('[SOC]')
   ```
   This prevents the rule from firing on every single incident in ServiceNow.

8. Click **Submit**.

> **Webhook URL format:**
> ```
> https://<your-soc-host>:8012/incidents/webhooks/servicenow?tenant_id=<tenant-uuid>
> ```

---

### ServiceNow Step 4 — Verify Bidirectional Sync

**Outbound (SOC → ServiceNow):**
1. Create a new incident in Central SOC for the configured tenant.
2. The incident should appear in ServiceNow within a few seconds with:
   - Short description starting with `[SOC]`
   - Category: `security`
   - Urgency and Impact set according to severity (see [Field Mappings](#field-mappings-reference))

**Inbound (ServiceNow → SOC):**
1. In ServiceNow, find the incident created above.
2. Change its **State** (e.g., set to `Resolved` or `In Progress`).
3. The Business Rule fires and POSTs to the Central SOC webhook.
4. Open the incident in Central SOC — its status should update in real time.

---

## Field Mappings Reference

### Freshservice

#### Severity → Priority

| SOC Severity | Freshservice Priority |
|---|---|
| critical | 4 — Urgent |
| high | 3 — High |
| medium | 2 — Medium |
| low | 1 — Low |
| informational | 1 — Low |

#### Status Mappings (bidirectional)

| SOC Status | Freshservice Status |
|---|---|
| new / triaging / ai triaging / in_progress / escalated | 2 — Open |
| sent to customer / customer response received | 3 — Pending |
| resolved | 4 — Resolved |
| false_positive | 5 — Closed |

---

---

### Freshdesk

#### Severity → Priority

| SOC Severity | Freshdesk Priority |
|---|---|
| critical | 4 — Urgent |
| high | 3 — High |
| medium | 2 — Medium |
| low | 1 — Low |
| informational | 1 — Low |

#### Status Mappings (bidirectional)

| SOC Status | Freshdesk Status |
|---|---|
| new / triaging / ai triaging / in_progress / escalated | 2 — Open |
| sent to customer / customer response received | 3 — Pending |
| resolved | 4 — Resolved |
| false_positive | 5 — Closed |

---

### ServiceNow

#### Severity → Urgency + Impact (ServiceNow auto-calculates Priority)

| SOC Severity | Urgency | Impact | → Priority |
|---|---|---|---|
| critical | 1 — High | 1 — High | 1 — Critical |
| high | 1 — High | 2 — Medium | 2 — High |
| medium | 2 — Medium | 2 — Medium | 3 — Moderate |
| low | 3 — Low | 3 — Low | 4 — Low |
| informational | 3 — Low | 3 — Low | 4 — Low |

#### Status Mappings (bidirectional)

| SOC Status | ServiceNow State |
|---|---|
| new / triaging / ai triaging | 1 — New |
| in_progress / escalated / customer response received | 2 — In Progress |
| sent to customer | 3 — On Hold |
| resolved | 6 — Resolved |
| false_positive | 7 — Closed |

| ServiceNow State | SOC Status |
|---|---|
| 1 — New | triaging |
| 2 — In Progress | in_progress |
| 3 — On Hold | sent to customer |
| 6 — Resolved | resolved |
| 7 — Closed | false_positive |
| 8 — Canceled | false_positive |

---

## Troubleshooting

### Tickets not appearing in Freshservice / ServiceNow

1. Check incident-service logs:
   ```bash
   docker compose logs incident-service --tail=50
   ```
2. Look for lines like:
   ```
   WARNING  incidents.freshservice - Freshservice push failed for SOC-0042: ...
   WARNING  incidents.freshdesk    - Freshdesk push failed for SOC-0042: ...
   WARNING  incidents.servicenow   - ServiceNow push failed for SOC-0042: ...
   ```
3. Common causes:
   - Invalid API key or wrong instance/domain name
   - The integration is saved but **not enabled** (toggle is OFF)
   - Network firewall blocking outbound requests from the Docker container

---

### Inbound webhook not triggering status updates

1. Confirm the webhook URL is reachable from the ITSM tool:

   **Freshservice / Freshdesk:**
   ```bash
   curl -X POST "https://<soc-host>:8012/incidents/webhooks/freshservice?tenant_id=<uuid>" \
     -H "Content-Type: application/json" \
     -d '{"freshdesk_webhook": {"ticket_id": "999", "ticket_status": "Resolved"}}'
   ```
   ```bash
   curl -X POST "https://<soc-host>:8012/incidents/webhooks/freshdesk?tenant_id=<uuid>" \
     -H "Content-Type: application/json" \
     -d '{"freshdesk_webhook": {"ticket_id": "999", "ticket_status": "Resolved"}}'
   ```

   **ServiceNow:**
   ```bash
   curl -X POST "https://<soc-host>:8012/incidents/webhooks/servicenow?tenant_id=<uuid>" \
     -H "Content-Type: application/json" \
     -d '{"sys_id": "abc123", "state": "6"}'
   ```
   Expected response for all: `{"status": "ok", "soc_incident_id": null}`

2. Check that `tenant_id` in the webhook URL matches the tenant UUID exactly.
3. For ServiceNow: check the Business Rule is **Active** and the script has the correct URL.
4. For Freshservice: check the Workflow Automator rule is **Activated** (not just saved).

---

### Checking sync status in the database

```bash
docker compose exec postgres psql -U soc_user -d central_soc -c \
  "SELECT integration, soc_incident_id, external_ticket_id, sync_status, last_synced_at
   FROM public.integration_ticket_mappings
   ORDER BY last_synced_at DESC LIMIT 20;"
```

| sync_status | Meaning |
|---|---|
| `synced` | Successfully pushed to ITSM tool |
| `error` | Push failed — check logs for the reason |

---

### Re-running the database migration

If the integration tables are missing:

```bash
docker compose exec incident-service python migrate_integrations.py
```

---

### Viewing integration configs

```bash
docker compose exec postgres psql -U soc_user -d central_soc -c \
  "SELECT tenant_id, integration, is_enabled, config->'instance' AS instance, updated_at
   FROM public.integration_configs;"
```

> API keys and passwords are stored as-is in the `config` JSONB column. Ensure your database is appropriately secured.
