"""
API Gateway — Single entry point. Routes all requests to downstream services.
Validates JWT, injects X-Tenant-ID header, enforces rate limiting.
"""
import logging
import httpx
import asyncio
from fastapi import FastAPI, Request, Response, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import websockets
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from jose import JWTError, jwt
from config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("api-gateway")

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Central SOC — API Gateway", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",   # Allow any origin (LAN IPs, localhost, etc.)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws/incidents")
async def websocket_proxy(websocket: WebSocket):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001)
        return
    try:
        verify_jwt(token)
    except:
        await websocket.close(code=4002)
        return
    
    await websocket.accept()
    ws_url = settings.incident_service_url.replace("http", "ws").rstrip('/') + f"/ws/incidents?token={token}"
    
    try:
        async with websockets.connect(ws_url) as upstream_ws:
            async def forward_to_client():
                async for message in upstream_ws:
                    await websocket.send_text(message)
            async def forward_to_upstream():
                while True:
                    msg = await websocket.receive_text()
                    await upstream_ws.send(msg)
            await asyncio.gather(forward_to_client(), forward_to_upstream())
    except Exception as e:
        logger.error(f"WS Proxy Error: {e}")
    finally:
        try: await websocket.close()
        except: pass

# Routes config — maps path prefix to upstream service URL
ROUTES = {
    "/auth": settings.auth_service_url,
    "/incidents": settings.incident_service_url,
    "/tenants": settings.tenant_service_url,
    "/teams": settings.tenant_service_url,
    "/levels": settings.tenant_service_url,
    "/mailing-configs": settings.tenant_service_url,
    "/connectors": settings.ingestion_service_url,
    "/automations": settings.automation_service_url,
}

# Public paths that don't require JWT
PUBLIC_PATHS = {"/auth/login", "/auth/refresh", "/health", "/incidents/webhooks/autonomous-report", "/incidents/webhooks/freshservice", "/incidents/webhooks/servicenow", "/incidents/webhooks/freshdesk"}


def verify_jwt(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        return payload
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


def get_upstream(path: str) -> str:
    for prefix, url in ROUTES.items():
        if path.startswith(prefix):
            return url
    return None


async def proxy_request(request: Request, upstream_url: str, user_info: dict = None) -> Response:
    url = upstream_url.rstrip("/") + request.url.path
    if request.url.query:
        url += f"?{request.url.query}"

    headers = dict(request.headers)
    headers.pop("host", None)

    # Inject user context headers for downstream services
    if user_info:
        headers["X-User-ID"] = user_info.get("sub", "")
        headers["X-User-Email"] = user_info.get("email", "")
        headers["X-User-Role"] = user_info.get("role", "")
        # Multi-tenant: comma-separated list of assigned tenant IDs
        tenant_ids = user_info.get("tenant_ids") or []
        headers["X-Tenant-IDs"] = ",".join(tenant_ids) if tenant_ids else ""
        # Primary tenant: use explicit tenant_id, or fall back to first from tenant_ids
        primary_tid = user_info.get("tenant_id") or ""
        if not primary_tid and tenant_ids:
            primary_tid = tenant_ids[0]
        headers["X-Tenant-ID"] = primary_tid
        
        logger.info(f"PROXIED REQUEST: {request.method} {url} | User: {user_info.get('email')} | Role: {user_info.get('role')} | Primary: {primary_tid} | Assigned: {tenant_ids}")

    body = await request.body()
    # Write operations (PATCH/POST/PUT) can involve DB merges, ITSM syncs,
    # Redis publishes etc. — give them much more time than reads.
    timeout = httpx.Timeout(
        connect=10.0,
        read=120.0 if request.method in ("POST", "PUT", "PATCH") else 30.0,
        write=30.0,
        pool=10.0,
    )
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=url,
                headers=headers,
                content=body,
            )
            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=dict(resp.headers),
                media_type=resp.headers.get("content-type"),
            )
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail=f"Upstream service unavailable: {upstream_url}")
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Upstream service timeout")


@app.get("/health")
async def health():
    service_statuses = {}
    async with httpx.AsyncClient(timeout=5) as client:
        for name, url in {
            "auth": settings.auth_service_url,
            "incident": settings.incident_service_url,
            "tenant": settings.tenant_service_url,
            "ingestion": settings.ingestion_service_url,
            "automation": settings.automation_service_url,
        }.items():
            try:
                r = await client.get(f"{url}/health")
                service_statuses[name] = "ok" if r.status_code == 200 else "degraded"
            except Exception:
                service_statuses[name] = "unreachable"

    overall = "ok" if all(v == "ok" for v in service_statuses.values()) else "degraded"
    return {"status": overall, "service": "api-gateway", "upstream_services": service_statuses}





@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
@limiter.limit("200/minute")
async def gateway(request: Request, path: str):
    full_path = f"/{path}"

    upstream = get_upstream(full_path)
    if not upstream:
        raise HTTPException(status_code=404, detail="Route not found")

    user_info = None
    if full_path not in PUBLIC_PATHS:
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing Authorization header")
        token = auth_header.split(" ", 1)[1]
        user_info = verify_jwt(token)

    return await proxy_request(request, upstream, user_info)
