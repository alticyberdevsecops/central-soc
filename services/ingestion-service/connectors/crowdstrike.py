"""
CrowdStrike Falcon Connector
Uses OAuth2 client credentials + incidents/queries API.
Returns RawIncident objects — normalization is done by crowdstrike_parser in the normalization-service.
"""
import uuid
import httpx
from datetime import datetime, timezone
from typing import Optional
from connectors.base import ConnectorBase, ConnectorCredentials, RawIncident


class CrowdStrikeConnector(ConnectorBase):
    VENDOR = "crowdstrike"
    _access_token: str = None
    _token_expires: float = 0

    async def _get_access_token(self) -> str:
        import time
        if self._access_token and time.time() < self._token_expires:
            return self._access_token
        client_id = self.credentials.get("client_id")
        client_secret = self.credentials.get("client_secret")
        base_url = self.credentials.get("base_url", "https://api.crowdstrike.com")
        if not client_id or not client_secret:
            return ""
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{base_url}/oauth2/token",
                data={"client_id": client_id, "client_secret": client_secret},
            )
            r.raise_for_status()
            data = r.json()
            self._access_token = data["access_token"]
            self._token_expires = time.time() + data.get("expires_in", 1800) - 60
        return self._access_token

    async def fetch_incidents(self, since: Optional[datetime] = None) -> list[RawIncident]:
        client_id = self.credentials.get("client_id")
        if not client_id:
            return self._mock_incidents()
        try:
            token = await self._get_access_token()
            base_url = self.credentials.get("base_url", "https://api.crowdstrike.com")
            headers = {"Authorization": f"Bearer {token}"}
            params = {"limit": 100, "sort": "created_timestamp.desc"}
            if since:
                params["filter"] = f"created_timestamp:>'{since.isoformat()}'"
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(f"{base_url}/incidents/queries/incidents/v1", headers=headers, params=params)
                r.raise_for_status()
                ids = r.json().get("resources", [])
                if not ids:
                    return []
                r2 = await client.post(f"{base_url}/incidents/entities/incidents/GET/v1", headers=headers, json={"ids": ids})
                r2.raise_for_status()
                raw_incidents = r2.json().get("resources", [])
                return [
                    RawIncident(
                        tenant_id=self.tenant_id,
                        source_vendor=self.VENDOR,
                        vendor_incident_id=str(inc.get("incident_id", "")),
                        raw_payload=inc,
                        source_created_at=inc.get("created"),
                    )
                    for inc in raw_incidents
                ]
        except Exception as e:
            self.logger.error(f"CrowdStrike fetch error: {e}")
            raise

    def _mock_incidents(self) -> list[RawIncident]:
        """Return mock RawIncidents for testing when no credentials are configured."""
        data = [
            ("Falcon Complete: Credential Dumping Detected", "critical", ["WIN-SRV-2022"], "T1003", "TA0006"),
            ("Suspicious Network Connection from Endpoint", "high", ["SALES-LT-88"], "T1071", "TA0011"),
            ("Process Injection via APC Queue Technique", "high", ["IT-WS-042"], "T1055", "TA0005"),
            ("USB Exfiltration Attempt Blocked", "medium", ["CFO-LT-001"], "T1052", "TA0010"),
        ]
        results = []
        for title, severity, hosts, technique, tactic in data:
            mock_id = f"CS-MOCK-{uuid.uuid4().hex[:8].upper()}"
            results.append(RawIncident(
                tenant_id=self.tenant_id,
                source_vendor=self.VENDOR,
                vendor_incident_id=mock_id,
                raw_payload={
                    "incident_id": mock_id,
                    "name": title,
                    "description": f"[Mock] {title}. Detected by CrowdStrike Falcon Next-Gen SIEM.",
                    "max_severity": {"critical": 80, "high": 60, "medium": 40, "low": 20}.get(severity, 40),
                    "status": "20",
                    "hosts": [{"hostname": h, "local_ip": "192.168.1.10"} for h in hosts],
                    "users": [],
                    "tactics": [{"tactic": tactic}],
                    "techniques": [{"technique": technique}],
                    "created": datetime.now(timezone.utc).isoformat(),
                },
                source_created_at=datetime.now(timezone.utc).isoformat(),
            ))
        return results
