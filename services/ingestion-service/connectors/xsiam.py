"""
Palo Alto XSIAM / Cortex XDR Connector
Fetches incidents via the XSIAM REST API using advanced auth headers.
"""
import string
import secrets
import time
import asyncio
import httpx
from datetime import datetime, timezone
from typing import Optional
from connectors.base import ConnectorBase, ConnectorCredentials, RawIncident


class XSIAMConnector(ConnectorBase):
    VENDOR = "xsiam"

    def _build_auth_headers(self) -> dict:
        """
        XSIAM Standard key authentication:
        The Authorization header contains the raw api_key directly.
        (Advanced key auth would SHA-256 hash key+nonce+timestamp — 
         but Standard keys send the raw key value.)
        """
        api_key = self.credentials.get("api_key", "")
        api_key_id = self.credentials.get("api_key_id", "")
        nonce = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(64))
        timestamp = str(int(time.time() * 1000))
        return {
            "x-xdr-auth-id": str(api_key_id),
            "x-xdr-nonce": nonce,
            "x-xdr-timestamp": timestamp,
            "Authorization": api_key,        # Standard key: raw value, no hash
            "Content-Type": "application/json",
        }


    def _get_base_url(self) -> str:
        url = self.credentials.get("base_url", "").rstrip("/")
        if not url:
            return ""
        if "://" in url:
            scheme, domain_path = url.split("://", 1)
            domain = domain_path.split("/", 1)[0]
            if "xdr." in domain and not domain.startswith("api-"):
                url = url.replace(f"://{domain}", f"://api-{domain}", 1)
        return url

    async def fetch_incidents(self, since: Optional[datetime] = None) -> list[RawIncident]:
        base_url = self._get_base_url()
        if not base_url or not self.credentials.get("api_key"):
            self.logger.warning("XSIAM connector: missing credentials, returning empty list (mock data removed for raw connector)")
            return []

        try:
            filters = []
            effective_since = since
            if not effective_since:
                from datetime import timedelta
                # Use a very large lookback (3 years) for the initial discovery sync
                effective_since = datetime.now(timezone.utc) - timedelta(days=1095)
                self.logger.info(f"FORCE SYNC: using 3-year lookback to discover all open incidents (since {effective_since})")

            ts_ms = int(effective_since.timestamp() * 1000)
            
            # Fetch any incident modified since the last poll, regardless of status.
            filters.append({"field": "modification_time", "operator": "gte", "value": ts_ms})

            all_results = []
            search_from = 0
            batch_size = 100  # XSIAM API hard limit is 100
            max_total = 100   # Set to 100 as requested

            async with httpx.AsyncClient(timeout=30) as client:
                while search_from < max_total:
                    payload = {
                        "request_data": {
                            "filters": filters,
                            "sort": {"field": "modification_time", "keyword": "desc"},
                            "search_from": search_from,
                            "search_to": search_from + batch_size,
                        }
                    }
                    
                    response = await client.post(
                        f"{base_url}/public_api/v1/incidents/get_incidents/",
                        json=payload,
                        headers=self._build_auth_headers(),
                    )
                    
                    if response.status_code != 200:
                        self.logger.error(f"XSIAM fetch failed at offset {search_from} ({response.status_code}): {response.text}")
                        response.raise_for_status()
                    
                    data = response.json()
                    reply = data.get("reply")
                    if not reply or "incidents" not in reply:
                        break
                    
                    incidents_raw = reply.get("incidents") or []
                    if not incidents_raw:
                        break
                        
                    self.logger.info(f"XSIAM: Fetched {len(incidents_raw)} incidents (offset {search_from})")
                    
                    # Fetch extra_data (alerts, artifacts) for all incidents in this
                    # batch concurrently, but cap at 10 parallel requests via a
                    # semaphore to avoid overwhelming the XSIAM API connection pool.
                    incident_ids = [str(inc.get("incident_id")) for inc in incidents_raw]
                    semaphore = asyncio.Semaphore(10)

                    async def _fetch_with_semaphore(iid: str) -> dict:
                        async with semaphore:
                            return await self._fetch_extra_data(iid, client)

                    extra_data_list = await asyncio.gather(
                        *[_fetch_with_semaphore(iid) for iid in incident_ids],
                        return_exceptions=False
                    )

                    for inc, extra_data in zip(incidents_raw, extra_data_list):
                        ts = inc.get("creation_time")
                        if ts:
                            import pytz
                            utc_dt = datetime.fromtimestamp(ts / 1000, tz=pytz.UTC)
                            ist_tz = pytz.timezone('Asia/Kolkata')
                            ist_dt = utc_dt.astimezone(ist_tz)
                            source_ts = ist_dt.isoformat()
                        else:
                            source_ts = None

                        all_results.append(RawIncident(
                            tenant_id=self.tenant_id,
                            source_vendor=self.VENDOR,
                            vendor_incident_id=str(inc.get("incident_id")),
                            raw_payload={"incident": inc, "extra_data": extra_data},
                            source_created_at=source_ts
                        ))
                    
                    if len(incidents_raw) < batch_size:
                        break  # No more results
                    
                    search_from += batch_size

                self.logger.info(f"XSIAM: Returning {len(all_results)} total incidents from {search_from // batch_size + 1} pages")
                return all_results
        except Exception as e:
            self.logger.error(f"XSIAM fetch error: {e}", exc_info=True)
            raise e # Re-raise to let scheduler record the error

    async def _fetch_extra_data(self, incident_id: str, client: httpx.AsyncClient | None = None) -> dict:
        """Fetch alerts and artifacts for a specific incident.

        Accepts an optional shared AsyncClient so the caller can reuse a single
        connection pool across concurrent requests (avoids spawning a new TCP
        connection per incident when called via asyncio.gather).

        Uses a dedicated 60 s timeout (instead of the shared client's 30 s) because
        heavy incidents with many alerts can take longer for the XSIAM server to
        serialise.  One automatic retry is attempted on ReadTimeout before giving up.
        """
        base_url = self._get_base_url()
        payload = {
            "request_data": {
                "incident_id": incident_id,
                "alerts_limit": 1000
            }
        }
        # Use a generous per-request timeout; extra_data payloads can be large.
        extra_data_timeout = httpx.Timeout(connect=10, read=60, write=10, pool=10)

        async def _do_request() -> dict:
            # Always use a fresh, dedicated client for extra_data so the
            # per-request timeout is applied cleanly regardless of the shared
            # client's settings.
            async with httpx.AsyncClient(timeout=extra_data_timeout) as c:
                response = await c.post(
                    f"{base_url.rstrip('/')}/public_api/v1/incidents/get_incident_extra_data/",
                    json=payload,
                    headers=self._build_auth_headers(),
                )
                response.raise_for_status()
                return response.json().get("reply", {})

        # One retry on timeout — large-payload incidents occasionally need it.
        for attempt in range(2):
            try:
                return await _do_request()
            except httpx.ReadTimeout:
                if attempt == 0:
                    self.logger.warning(
                        f"ReadTimeout fetching extra data for incident {incident_id} — retrying once..."
                    )
                    await asyncio.sleep(2)
                    continue
                self.logger.error(
                    f"ReadTimeout fetching extra data for incident {incident_id} after retry — skipping alerts"
                )
                return {}
            except Exception as e:
                self.logger.error(
                    f"Failed to fetch extra data for incident {incident_id}: {e}", exc_info=True
                )
                return {}
        return {}  # unreachable, satisfies type checker
