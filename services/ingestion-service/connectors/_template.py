"""
╔══════════════════════════════════════════════════════════════════════════════╗
║          CENTRAL SOC — CONNECTOR SDK TEMPLATE                               ║
║  Copy this file to: connectors/my_vendor_name.py                            ║
║  Set VENDOR = "my_vendor_name"  (must match connector_configs.vendor in DB) ║
║  The scheduler will automatically discover and use it — zero other changes. ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""
import httpx
import uuid
from datetime import datetime, timezone
from typing import Optional
from connectors.base import ConnectorBase, ConnectorCredentials, NormalizedIncident


class MyVendorConnector(ConnectorBase):
    """
    Replace 'MyVendor' with your vendor name.
    Required class attribute: VENDOR  (string, lowercase, matches DB vendor column)
    """

    # ── REQUIRED: must match the `vendor` value in connector_configs DB table ──
    VENDOR = "my_vendor"

    # ──────────────────────────────────────────────────────────────────────────
    # STEP 1: Fetch incidents from your vendor API
    # This method is called by the scheduler on every poll interval.
    # `since` is the last poll timestamp — only fetch new/updated incidents after it.
    # ──────────────────────────────────────────────────────────────────────────
    async def fetch_incidents(self, since: Optional[datetime] = None) -> list[NormalizedIncident]:
        # Read credentials stored per-tenant in connector_configs.credentials JSONB
        api_key = self.credentials.get("api_key")
        base_url = self.credentials.get("base_url", "https://api.myvendor.com")

        # If no credentials are configured, fall back to mock data for demo/dev
        if not api_key:
            self.logger.warning(f"No API key for {self.VENDOR}, returning mock data")
            return self._mock_incidents()

        try:
            headers = {"Authorization": f"Bearer {api_key}"}
            params = {}
            if since:
                params["updated_after"] = since.isoformat()

            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get(f"{base_url}/api/v1/incidents", headers=headers, params=params)
                response.raise_for_status()
                raw_incidents = response.json().get("incidents", [])  # Adjust to your API shape
                return [self._map_incident(inc) for inc in raw_incidents]

        except Exception as e:
            self.logger.error(f"Failed to fetch from {self.VENDOR}: {e}")
            return []

    # ──────────────────────────────────────────────────────────────────────────
    # STEP 2: Map your vendor's raw incident fields to NormalizedIncident
    # Use self._normalize_severity() and self._normalize_status() helpers from base.
    # ──────────────────────────────────────────────────────────────────────────
    def _map_incident(self, raw: dict) -> NormalizedIncident:
        return NormalizedIncident(
            tenant_id=self.tenant_id,
            source_vendor=self.VENDOR,

            # ── Required fields ───────────────────────────────────────────────
            vendor_incident_id=str(raw.get("id", uuid.uuid4().hex)),
            title=raw.get("title", "Untitled Incident"),
            severity=self._normalize_severity(raw.get("severity", "medium")),  # uses base helper
            status=self._normalize_status(raw.get("status", "open")),           # uses base helper

            # ── Optional enrichment ───────────────────────────────────────────
            description=raw.get("description", ""),
            affected_hosts=[
                {"hostname": h.get("hostname", ""), "ip": h.get("ip", "")}
                for h in raw.get("hosts", [])
            ],
            affected_users=[
                {"username": u.get("username", "")}
                for u in raw.get("users", [])
            ],
            iocs=[
                {"type": ioc.get("type", "ip"), "value": ioc.get("value", ""), "context": ioc.get("context", "")}
                for ioc in raw.get("iocs", [])
            ],
            mitre_tactics=raw.get("mitre_tactics", []),
            mitre_techniques=raw.get("mitre_techniques", []),
            tags=raw.get("tags", []),
            vendor_url=raw.get("url"),

            # ── Always store raw payload for audit ────────────────────────────
            raw_payload=raw,
            source_created_at=raw.get("created_at"),  # ISO 8601 string
        )

    # ──────────────────────────────────────────────────────────────────────────
    # STEP 3: (Optional) Mock incidents for dev/demo mode (no real API key)
    # ──────────────────────────────────────────────────────────────────────────
    def _mock_incidents(self) -> list[NormalizedIncident]:
        return [
            NormalizedIncident(
                tenant_id=self.tenant_id,
                source_vendor=self.VENDOR,
                vendor_incident_id=f"MOCK-{uuid.uuid4().hex[:8].upper()}",
                title="Mock Incident from My Vendor",
                description="This is a mock incident for development/demo purposes.",
                severity="medium",
                status="new",
                affected_hosts=[{"hostname": "MOCK-HOST-01", "ip": "10.0.0.1"}],
                iocs=[{"type": "ip", "value": "1.2.3.4", "context": "Mock IOC"}],
                raw_payload={"mock": True, "vendor": self.VENDOR},
                source_created_at=datetime.now(timezone.utc).isoformat(),
            )
        ]


# ══════════════════════════════════════════════════════════════════════════════
# HOW TO ONBOARD A NEW CUSTOMER TOOL
# ══════════════════════════════════════════════════════════════════════════════
#
# 1. Copy this file to: connectors/<vendor_name>.py
# 2. Set VENDOR = "<vendor_name>" (e.g. "qradar", "splunk", "elastic", "vectra")
# 3. Implement fetch_incidents() + _map_incident()
# 4. Add a connector_config row to the DB for that tenant:
#
#    INSERT INTO connector_configs
#      (tenant_id, vendor, label, credentials, poll_interval_sec)
#    VALUES
#      ('<tenant-uuid>', '<vendor_name>', 'Customer Label',
#       '{"api_key": "...", "base_url": "https://..."}', 300);
#
# 5. Call POST /connectors/reload — the scheduler picks it up LIVE.
#    No restart needed. No changes to any other service.
#
# THAT'S IT. Nothing else changes.
# ══════════════════════════════════════════════════════════════════════════════
