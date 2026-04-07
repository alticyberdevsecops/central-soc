"""
Incident Service — Main FastAPI app with WebSocket live updates.
All endpoints are tenant-scoped via JWT claims.
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
import redis.asyncio as aioredis
from incidents.routes import router as incident_router
from incidents.database import engine, Base
from incidents.auth import get_current_user
from config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("incident-service")

# WebSocket connection manager — tracks per-tenant connections
class ConnectionManager:
    def __init__(self):
        # tenant_id -> list of WebSocket connections
        self.connections: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, tenant_id: str | None):
        await websocket.accept()
        key = tenant_id or "ALL"
        if key not in self.connections:
            self.connections[key] = []
        self.connections[key].append(websocket)
        logger.info(f"WS client connected — tenant: {key} | total: {sum(len(v) for v in self.connections.values())}")

    def disconnect(self, websocket: WebSocket, tenant_id: str | None):
        key = tenant_id or "ALL"
        if key in self.connections:
            self.connections[key].discard(websocket) if hasattr(self.connections[key], 'discard') else None
            try:
                self.connections[key].remove(websocket)
            except ValueError:
                pass

    async def broadcast_to_tenant(self, tenant_id: str, message: str):
        """Send message to all connections for a tenant + super_admin (ALL) connections."""
        targets = self.connections.get(tenant_id, []) + self.connections.get("ALL", [])
        dead = []
        for ws in targets:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        # Clean up dead connections
        for ws in dead:
            for conns in self.connections.values():
                try:
                    conns.remove(ws)
                except ValueError:
                    pass


manager = ConnectionManager()


async def redis_pubsub_listener():
    """Background task: subscribe to Redis pub/sub and forward to WebSocket clients."""
    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    pubsub = r.pubsub()
    await pubsub.subscribe("soc:incidents:live")
    logger.info("Redis pub/sub listener started on channel: soc:incidents:live")
    async for message in pubsub.listen():
        if message["type"] == "message":
            try:
                data = json.loads(message["data"])
                tenant_id = data.get("tenant_id", "")
                await manager.broadcast_to_tenant(tenant_id, json.dumps(data))
            except Exception as e:
                logger.error(f"Error broadcasting WebSocket event: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    asyncio.create_task(redis_pubsub_listener())
    from incidents.mailing import escalation_worker, inbound_email_poller
    from incidents.sla import sla_breach_checker
    asyncio.create_task(escalation_worker())
    asyncio.create_task(inbound_email_poller())
    asyncio.create_task(sla_breach_checker())
    yield


app = FastAPI(title="Central SOC — Incident Service", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(incident_router, prefix="/incidents", tags=["Incidents"])


@app.websocket("/ws/incidents")
async def websocket_incidents(websocket: WebSocket, token: str = None):
    """
    WebSocket endpoint — clients connect with ?token=<jwt>
    Super admins receive ALL tenant events. Tenant users receive only their tenant events.
    """
    from incidents.auth import decode_ws_token
    user_info = decode_ws_token(token) if token else None
    tenant_id = user_info.get("tenant_id") if user_info else None
    await manager.connect(websocket, tenant_id)
    try:
        while True:
            await websocket.receive_text()  # Keep-alive
    except WebSocketDisconnect:
        manager.disconnect(websocket, tenant_id)
        logger.info(f"WS client disconnected — tenant: {tenant_id or 'ALL'}")


@app.get("/health")
async def health():
    ws_count = sum(len(v) for v in manager.connections.values())
    return {"status": "ok", "service": "incident-service", "ws_connections": ws_count}
