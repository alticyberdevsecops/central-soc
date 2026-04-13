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

async def main():
    tenant_id = "c025bc21-d309-4d01-bb3d-129f8244e24e"
    credentials = {"api_key": "6Lc3wdsRZIxOBVW5tPlVkS6rB73YtU8dGnufGDCzTHywBIv9u88HEkKbBz3diVPYryjkyaVudgB4MVeXS7yDD2RcrayjGPxE8N0YnSCPB686pP59niqsbDAlS9gRwgrY", "base_url": "https://api-atpl-nfr.xdr.in.paloaltonetworks.com", "api_key_id": "1"}

    api_key = credentials.get("api_key", "")
    api_key_id = credentials.get("api_key_id", "")
    nonce = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(64))
    timestamp = str(int(time.time() * 1000))
    headers = {
        "x-xdr-auth-id": str(api_key_id),
        "x-xdr-nonce": nonce,
        "x-xdr-timestamp": timestamp,
        "Authorization": api_key,        
        "Content-Type": "application/json",
    }

    base_url = "https://api-atpl-nfr.xdr.in.paloaltonetworks.com"

    since = datetime.now(timezone.utc) - timedelta(days=90)
    ts_ms = int(since.timestamp() * 1000)
    
    # 1. Total incidents with creation_time >= 90 days ago
    payload1 = {
        "request_data": {
            "filters": [{"field": "creation_time", "operator": "gte", "value": ts_ms}],
            "search_from": 0,
            "search_to": 1,
        }
    }
    
    # 2. Total incidents entirely
    payload2 = {
        "request_data": {
            "filters": [],
            "search_from": 0,
            "search_to": 1,
        }
    }

    async with httpx.AsyncClient(timeout=10) as client:
        resp1 = await client.post(f"{base_url}/public_api/v1/incidents/get_incidents/", json=payload1, headers=headers)
        if resp1.status_code == 200:
            data1 = resp1.json()
            print("With creation_time >= 90 days:", data1.get("reply", {}).get("total_count", "No total_count"))
            print("Received items:", len(data1.get("reply", {}).get("incidents", [])))
        else:
            print("Error 1:", resp1.text)

        resp2 = await client.post(f"{base_url}/public_api/v1/incidents/get_incidents/", json=payload2, headers=headers)
        if resp2.status_code == 200:
            data2 = resp2.json()
            print("Without filters:", data2.get("reply", {}).get("total_count", "No total_count"))
            print("Received items:", len(data2.get("reply", {}).get("incidents", [])))
        else:
            print("Error 2:", resp2.text)

if __name__ == "__main__":
    asyncio.run(main())
