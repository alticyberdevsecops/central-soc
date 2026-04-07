import logging
from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from scheduler import load_and_schedule_connectors

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("ingestion-service")

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Ingestion service starting — loading connector schedules...")
    try:
        load_and_schedule_connectors(scheduler)
    except Exception as e:
        logger.warning(f"Could not load connectors from DB (may not exist yet): {e}")
    scheduler.start()
    yield
    scheduler.shutdown()
    logger.info("Ingestion service shut down.")


app = FastAPI(title="Central SOC — Ingestion Service", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    jobs = [{"id": j.id, "next_run": str(j.next_run_time)} for j in scheduler.get_jobs()]
    return {"status": "ok", "service": "ingestion-service", "active_connectors": len(jobs), "jobs": jobs}


@app.post("/connectors/reload")
async def reload_connectors():
    """Hot-reload connector schedules from DB (call after adding a new tenant/connector)."""
    scheduler.remove_all_jobs()
    try:
        load_and_schedule_connectors(scheduler)
    except Exception as e:
        return {"status": "error", "error": str(e)}
    return {"status": "reloaded", "active_connectors": len(scheduler.get_jobs())}
