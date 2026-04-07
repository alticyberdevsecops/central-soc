"""SentinelOne Connector — REST API v2.1"""
import uuid, random, httpx
from datetime import datetime, timezone
from typing import Optional
from connectors.base import ConnectorBase, ConnectorCredentials, NormalizedIncident


class SentinelOneConnector(ConnectorBase):
    VENDOR = "sentinelone"

    async def fetch_incidents(self, since: Optional[datetime] = None) -> list[NormalizedIncident]:
        api_token = self.credentials.get("api_token")
        base_url = self.credentials.get("base_url", "")
        if not api_token or not base_url:
            return self._mock_incidents()
        try:
            headers = {"Authorization": f"ApiToken {api_token}", "Content-Type": "application/json"}
            params = {"limit": 100, "sortBy": "createdAt", "sortOrder": "desc"}
            if since:
                params["createdAt__gt"] = since.strftime("%Y-%m-%dT%H:%M:%S.000000Z")
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(f"{base_url.rstrip('/')}/web/api/v2.1/threats", headers=headers, params=params)
                r.raise_for_status()
                threats = r.json().get("data", [])
                return [self._map_threat(t) for t in threats]
        except Exception as e:
            self.logger.error(f"SentinelOne fetch error: {e}")
            return []

    def _map_threat(self, t: dict) -> NormalizedIncident:
        agent = t.get("agentDetectionInfo", {})
        file_info = t.get("threatInfo", {})
        iocs = []
        if file_info.get("sha256"):
            iocs.append({"type": "file_hash_sha256", "value": file_info["sha256"], "context": "Threat file"})
        return NormalizedIncident(
            tenant_id=self.tenant_id,
            source_vendor="sentinelone",
            vendor_incident_id=t.get("id", ""),
            title=file_info.get("threatName", "SentinelOne Threat"),
            description=f"Classification: {file_info.get('classification', 'Unknown')}. Confidence: {file_info.get('confidenceLevel', 'N/A')}",
            severity=self._normalize_severity(t.get("riskScore", "medium")),
            status=self._normalize_status(file_info.get("incidentStatus", "unresolved")),
            affected_hosts=[{"hostname": agent.get("agentComputerName", ""), "ip": agent.get("agentIpV4", ""), "os": agent.get("agentOsName", "")}],
            iocs=iocs,
            raw_payload=t,
            source_created_at=t.get("createdAt"),
        )

    def _mock_incidents(self) -> list[NormalizedIncident]:
        data = [
            ("Fileless Malware Executed in Memory", "critical", "APP-SRV-012"),
            ("Trojan Dropper Quarantined", "high", "KIOSK-003"),
            ("Suspicious Registry Modification", "medium", "ADMIN-WS-01"),
        ]
        return [NormalizedIncident(
            tenant_id=self.tenant_id,
            source_vendor="sentinelone",
            vendor_incident_id=f"S1-MOCK-{uuid.uuid4().hex[:8].upper()}",
            title=title,
            description=f"[Mock] {title}. Blocked by SentinelOne Endpoint AI.",
            severity=severity,
            status="new",
            affected_hosts=[{"hostname": host, "ip": f"172.16.{random.randint(1,20)}.{random.randint(1,254)}"}],
            iocs=[{"type": "file_hash_sha256", "value": "c" * 64, "context": "Malware"}],
            raw_payload={"mock": True, "vendor": "sentinelone", "title": title},
            source_created_at=datetime.now(timezone.utc).isoformat(),
        ) for title, severity, host in data]


class DefenderConnector(ConnectorBase):
    """Microsoft Defender for Endpoint / M365 Defender Connector — Graph Security API"""
    VENDOR = "defender"
    _access_token: str = None
    _token_expires: float = 0

    async def _get_token(self) -> str:
        import time
        if self._access_token and time.time() < self._token_expires:
            return self._access_token
        tenant_id = self.credentials.get("tenant_id")
        client_id = self.credentials.get("client_id")
        client_secret = self.credentials.get("client_secret")
        if not all([tenant_id, client_id, client_secret]):
            return ""
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "scope": "https://graph.microsoft.com/.default",
                    "grant_type": "client_credentials",
                },
            )
            r.raise_for_status()
            d = r.json()
            self._access_token = d["access_token"]
            self._token_expires = time.time() + d.get("expires_in", 3600) - 60
        return self._access_token

    async def fetch_incidents(self, since: Optional[datetime] = None) -> list[NormalizedIncident]:
        if not self.credentials.get("client_id"):
            return self._mock_incidents()
        try:
            token = await self._get_token()
            headers = {"Authorization": f"Bearer {token}"}
            url = "https://graph.microsoft.com/v1.0/security/incidents"
            params = {"$top": 100, "$orderby": "createdDateTime desc"}
            if since:
                params["$filter"] = f"createdDateTime ge {since.isoformat()}Z"
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(url, headers=headers, params=params)
                r.raise_for_status()
                incidents = r.json().get("value", [])
                return [self._map_incident(i) for i in incidents]
        except Exception as e:
            self.logger.error(f"Defender fetch error: {e}")
            return []

    def _map_incident(self, inc: dict) -> NormalizedIncident:
        hosts = [{"hostname": a.get("hostName", ""), "ip": a.get("ipInterfaces", [""])[0] if a.get("ipInterfaces") else ""} for a in inc.get("alerts", [])]
        return NormalizedIncident(
            tenant_id=self.tenant_id,
            source_vendor="defender",
            vendor_incident_id=inc.get("id", ""),
            title=inc.get("displayName", "Defender Incident"),
            description=inc.get("description", ""),
            severity=self._normalize_severity(inc.get("severity", "medium")),
            status=self._normalize_status(inc.get("status", "new")),
            affected_hosts=hosts[:5],
            mitre_tactics=[t.get("@odata.type", "") for t in inc.get("techniques", [])],
            raw_payload=inc,
            source_created_at=inc.get("createdDateTime"),
        )

    def _mock_incidents(self) -> list[NormalizedIncident]:
        data = [
            ("BEC Attack — Finance Email Compromise", "critical", "OUTLOOK-FIN"),
            ("Azure AD Sign-In from Impossible Location", "high", "M365-CLOUD"),
            ("Macro-Enabled Document Execution", "high", "MGMT-WS-007"),
        ]
        return [NormalizedIncident(
            tenant_id=self.tenant_id,
            source_vendor="defender",
            vendor_incident_id=f"DEF-MOCK-{uuid.uuid4().hex[:8].upper()}",
            title=title,
            description=f"[Mock] {title}. Detected by Microsoft Defender XDR.",
            severity=severity,
            status="new",
            affected_hosts=[{"hostname": host, "ip": f"10.10.{random.randint(1,50)}.{random.randint(1,254)}"}],
            iocs=[{"type": "email", "value": "attacker@evil.com", "context": "Source email"}],
            raw_payload={"mock": True, "vendor": "defender", "title": title},
            source_created_at=datetime.now(timezone.utc).isoformat(),
        ) for title, severity, host in data]
