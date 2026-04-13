import asyncio
import os
import sys
import string
import secrets
import time
import httpx
from datetime import datetime, timezone, timedelta
import pytz
import json
import dataclasses
import redis

# Define RawIncident if we don't import it
@dataclasses.dataclass
class RawIncident:
    tenant_id: str
    source_vendor: str
    vendor_incident_id: str
    raw_payload: dict
    source_created_at: str | None = None

class XSIAMHistoryFetcher:
    def __init__(self, tenant_id: str, credentials: dict):
        self.tenant_id = tenant_id
        self.credentials = credentials
        self.vendor = "xsiam"

    def _build_auth_headers(self) -> dict:
        api_key = self.credentials.get("api_key", "")
        api_key_id = self.credentials.get("api_key_id", "")
        nonce = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(64))
        timestamp = str(int(time.time() * 1000))
        return {
            "x-xdr-auth-id": str(api_key_id),
            "x-xdr-nonce": nonce,
            "x-xdr-timestamp": timestamp,
            "Authorization": api_key,        
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

    async def _fetch_extra_data(self, incident_id: str) -> dict:
        base_url = self._get_base_url()
        payload = {
            "request_data": {
                "incident_id": incident_id,
                "alerts_limit": 1000
            }
        }
        extra_data_timeout = httpx.Timeout(connect=10, read=90, write=10, pool=10)

        async def _do_request() -> dict:
            async with httpx.AsyncClient(timeout=extra_data_timeout) as c:
                response = await c.post(
                    f"{base_url}/public_api/v1/incidents/get_incident_extra_data/",
                    json=payload,
                    headers=self._build_auth_headers(),
                )
                response.raise_for_status()
                return response.json().get("reply", {})

        for attempt in range(3):
            try:
                return await _do_request()
            except httpx.ReadTimeout:
                print(f"ReadTimeout fetching extra data for incident {incident_id} — retrying...", flush=True)
                await asyncio.sleep(2)
            except Exception as e:
                print(f"Failed extra data {incident_id}: {e}", flush=True)
                return {}
        return {}

    async def fetch_incidents(self):
        base_url = self._get_base_url()
        print(f"Base URL: {base_url}", flush=True)

        # 3 months lookback
        since = datetime.now(timezone.utc) - timedelta(days=90)
        ts_ms = int(since.timestamp() * 1000)
        
        # We want ALL incidents from the last 3 months
        filters = [
            {"field": "creation_time", "operator": "gte", "value": ts_ms}
        ]

        all_results = []
        search_from = 0
        batch_size = 50 # slightly lower batch size to avoid dropping
        
        # Max results to fetch
        MAX_PAGES = 100

        async with httpx.AsyncClient(timeout=30) as client:
            for page in range(MAX_PAGES):
                payload = {
                    "request_data": {
                        "filters": filters,
                        "sort": {"field": "creation_time", "keyword": "desc"},
                        "search_from": search_from,
                        "search_to": search_from + batch_size - 1, 
                    }
                }
                
                print(f"Fetching offset {search_from} to {search_from + batch_size - 1}...", flush=True)
                response = await client.post(
                    f"{base_url}/public_api/v1/incidents/get_incidents/",
                    json=payload,
                    headers=self._build_auth_headers(),
                )
                
                if response.status_code != 200:
                    print(f"XSIAM fetch failed: {response.text}", flush=True)
                    break
                
                data = response.json()
                reply = data.get("reply")
                if not reply or "incidents" not in reply:
                    print("No incidents found or reply format unexpected.", flush=True)
                    break
                
                incidents_raw = reply.get("incidents") or []
                if not incidents_raw:
                    print("Received empty list of incidents.", flush=True)
                    break
                    
                print(f"XSIAM: Fetched {len(incidents_raw)} incidents (offset {search_from})", flush=True)
                
                # Fetch extra data
                incident_ids = [str(inc.get("incident_id")) for inc in incidents_raw]
                semaphore = asyncio.Semaphore(5) # Lower concurrency for safety

                async def _fetch_with_semaphore(iid: str) -> dict:
                    async with semaphore:
                        return await self._fetch_extra_data(iid)

                extra_data_list = await asyncio.gather(
                    *[_fetch_with_semaphore(iid) for iid in incident_ids],
                    return_exceptions=False
                )

                for inc, extra_data in zip(incidents_raw, extra_data_list):
                    ts = inc.get("creation_time")
                    if ts:
                        utc_dt = datetime.fromtimestamp(ts / 1000, tz=pytz.UTC)
                        ist_tz = pytz.timezone('Asia/Kolkata')
                        ist_dt = utc_dt.astimezone(ist_tz)
                        source_ts = ist_dt.isoformat()
                    else:
                        source_ts = None

                    all_results.append(RawIncident(
                        tenant_id=self.tenant_id,
                        source_vendor=self.vendor,
                        vendor_incident_id=str(inc.get("incident_id")),
                        raw_payload={"incident": inc, "extra_data": extra_data},
                        source_created_at=source_ts
                    ))
                
                print(f"Processed batch. Total results so far: {len(all_results)}", flush=True)

                if len(incidents_raw) < batch_size:
                    print("Less than batch_size returned. We are done.", flush=True)
                    break  
                
                search_from += len(incidents_raw)

            return all_results

async def main():
    tenant_id = "c025bc21-d309-4d01-bb3d-129f8244e24e"
    credentials = {"api_key": "6Lc3wdsRZIxOBVW5tPlVkS6rB73YtU8dGnufGDCzTHywBIv9u88HEkKbBz3diVPYryjkyaVudgB4MVeXS7yDD2RcrayjGPxE8N0YnSCPB686pP59niqsbDAlS9gRwgrY", "base_url": "https://api-atpl-nfr.xdr.in.paloaltonetworks.com", "api_key_id": "1"}

    print(f"Starting fetch for tenant {tenant_id} from {credentials['base_url']}...")
    fetcher = XSIAMHistoryFetcher(tenant_id, credentials)
    incidents = await fetcher.fetch_incidents()
    print(f"Total fetched: {len(incidents)}", flush=True)

    if not incidents:
        return

    print("Submitting to Redis...", flush=True)
    # Get REDIS url from environment or default
    redis_url = os.getenv("REDIS_URL", "redis://:redis_secret_2024@soc-redis:6379/0")
    print(f"Connecting to redis at {redis_url}...")
    r = redis.from_url(redis_url, decode_responses=True)
    
    pipe = r.pipeline()
    enqueued = 0
    for inc in incidents:
        dedup_key = f"dedup:{tenant_id}:xsiam:{inc.vendor_incident_id}"
        
        incident_data = inc.raw_payload.get("incident", {})
        dedup_val = json.dumps({
            "alert_count": int(incident_data.get("alert_count", 0) or 0),
            "modification_time": int(incident_data.get("modification_time", 0) or 0),
        })

        pipe.setex(dedup_key, 604800, dedup_val)
        pipe.rpush("soc:raw_incidents:queue", json.dumps(dataclasses.asdict(inc)))
        enqueued += 1
    
    pipe.execute()
    print(f"Enqueued {enqueued} incidents.", flush=True)
    

if __name__ == "__main__":
    asyncio.run(main())
