# Central SOC - Local Login Guide

This guide contains the credentials and URLs needed to access the various interfaces of your local Central SOC deployment.

## 1. Main SOC Dashboard (Frontend UI)

This is the primary user interface for operating the SOC, onboarding customers, and viewing alerts.

*   **URL:** [http://localhost:8011](http://localhost:8011)
*   **Super Admin Email:** `superadmin@admin.com`
*   **Super Admin Password:** `superadmin`

> **Note:** This is the master account created during the database reset. Use this account to log in and onboard new customer tenants.

---

## 2. Database Administration (pgAdmin 4 UI)

This interface provides direct visual access to the underlying PostgreSQL database to view tables, schemas (tenants), and raw data.

*   **URL:** [http://localhost:8019](http://localhost:8019)
*   **Default Email:** `admin@admin.com`
*   **Default Password:** `admin`

### Database Connection Details (PostgreSQL)
*   **Host:** `postgres` (internal) or `localhost` (external mapping)
*   **Port:** `5432`
*   **Username:** `soc_admin`
*   **Password:** `soc_secret_2024`
*   **Database:** `central_soc`

> **Tip:** You can use this UI to verify that new customer schemas (`tenant_<id>`) are automatically created when you onboard them through the main SOC dashboard. In pgAdmin, you will need to "Register Server" and use the credentials above.
