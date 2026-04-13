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

    async def _fetch_extra_data(self, incident_id: str, client: httpx.AsyncClient) -> dict:
        base_url = self._get_base_url()
        payload = {
            "request_data": {
                "incident_id": incident_id,
                "alerts_limit": 100
            }
        }

        for attempt in range(4):
            try:
                response = await client.post(
                    f"{base_url}/public_api/v1/incidents/get_incident_extra_data/",
                    json=payload,
                    headers=self._build_auth_headers(),
                )
                response.raise_for_status()
                return response.json().get("reply", {})
            except httpx.ReadTimeout:
                print(f"ReadTimeout fetching extra data for incident {incident_id} — retrying...", flush=True)
                await asyncio.sleep(2)
            except Exception as e:
                print(f"Failed extra data {incident_id}: {e}", flush=True)
                await asyncio.sleep(2)
        return {}

    async def fetch_and_enqueue_all(self):
        base_url = self._get_base_url()
        print(f"Base URL: {base_url}", flush=True)

        since = datetime.now(timezone.utc) - timedelta(days=90)
        ts_ms = int(since.timestamp() * 1000)
        filters = [{"field": "creation_time", "operator": "gte", "value": ts_ms}]

        batch_size = 100
        search_from = 0

        redis_url = os.getenv("REDIS_URL", "redis://:redis_secret_2024@redis:6379/0")
        r = redis.from_url(redis_url, decode_responses=True)

        # Timeout settings to handle long connections
        connect_timeout = httpx.Timeout(connect=15, read=120, write=30, pool=30)
        extra_client = httpx.AsyncClient(timeout=connect_timeout, limits=httpx.Limits(max_connections=15, max_keepalive_connections=10))

        total_enqueued = 0

        async with httpx.AsyncClient(timeout=60) as client:
            while True:
                payload = {
                    "request_data": {
                        "filters": filters,
                        "sort": {"field": "creation_time", "keyword": "desc"},
                        "search_from": search_from,
                        "search_to": search_from + batch_size - 1, 
                    }
                }
                
                print(f"Fetching offsets {search_from} to {search_from + batch_size - 1}...", flush=True)
                
                try:
                    response = await client.post(
                        f"{base_url}/public_api/v1/incidents/get_incidents/",
                        json=payload,
                        headers=self._build_auth_headers(),
                    )
                    response.raise_for_status()
                except Exception as e:
                    print(f"XSIAM fetch failed: {e}", flush=True)
                    await asyncio.sleep(5)
                    continue
                
                data = response.json()
                reply = data.get("reply")
                if not reply or "incidents" not in reply:
                    print("No incidents found or reply format unexpected.", flush=True)
                    await asyncio.sleep(5)
                    continue
                
                incidents_raw = reply.get("incidents") or []
                total_count = reply.get("total_count", 0)

                print(f"XSIAM: Page fetched {len(incidents_raw)} incidents (offset {search_from}), Total available: {total_count}", flush=True)
                
                if len(incidents_raw) == 0:
                    if search_from >= total_count:
                        print(f"Successfully processed all {total_count} incidents.", flush=True)
                        break
                    else:
                        print("Returned 0 incidents but haven't reached total_count. Skipping to next batch.", flush=True)
                        search_from += batch_size
                        continue

                incident_ids = [str(inc.get("incident_id")) for inc in incidents_raw]
                semaphore = asyncio.Semaphore(5)

                async def _fetch_with_semaphore(iid: str) -> dict:
                    async with semaphore:
                        return await self._fetch_extra_data(iid, extra_client)

                extra_data_list = await asyncio.gather(
                    *[_fetch_with_semaphore(iid) for iid in incident_ids],
                    return_exceptions=False
                )

                pipe = r.pipeline()
                current_enqueued = 0
                for inc, extra_data in zip(incidents_raw, extra_data_list):
                    ts = inc.get("creation_time")
                    if ts:
                        utc_dt = datetime.fromtimestamp(ts / 1000, tz=pytz.UTC)
                        ist_tz = pytz.timezone('Asia/Kolkata')
                        ist_dt = utc_dt.astimezone(ist_tz)
                        source_ts = ist_dt.isoformat()
                    else:
                        source_ts = None

                    raw_incident = RawIncident(
                        tenant_id=self.tenant_id,
                        source_vendor=self.vendor,
                        vendor_incident_id=str(inc.get("incident_id")),
                        raw_payload={"incident": inc, "extra_data": extra_data},
                        source_created_at=source_ts
                    )
                    
                    dedup_key = f"dedup:{self.tenant_id}:xsiam:{raw_incident.vendor_incident_id}"
                    dedup_val = json.dumps({
                        "alert_count": int(inc.get("alert_count", 0) or 0),
                        "modification_time": int(inc.get("modification_time", 0) or 0),
                    })
                    pipe.setex(dedup_key, 604800, dedup_val)
                    pipe.rpush("soc:raw_incidents:queue", json.dumps(dataclasses.asdict(raw_incident)))
                    current_enqueued += 1

                pipe.execute()
                total_enqueued += current_enqueued
                print(f"Batch inserted. Total enqueued out of {total_count}: {total_enqueued}", flush=True)

                search_from += batch_size
                
                if search_from >= total_count:
                    print(f"Finished processing all {total_count} incidents.", flush=True)
                    break

        await extra_client.aclose()


async def main():
    tenant_id = "c025bc21-d309-4d01-bb3d-129f8244e24e"
    credentials = {"api_key": "6Lc3wdsRZIxOBVW5tPlVkS6rB73YtU8dGnufGDCzTHywBIv9u88HEkKbBz3diVPYryjkyaVudgB4MVeXS7yDD2RcrayjGPxE8N0YnSCPB686pP59niqsbDAlS9gRwgrY", "base_url": "https://api-atpl-nfr.xdr.in.paloaltonetworks.com", "api_key_id": "1"}

    fetcher = XSIAMHistoryFetcher(tenant_id, credentials)
    await fetcher.fetch_and_enqueue_all()


if __name__ == "__main__":
    asyncio.run(main())
