from fastapi import FastAPI, Request, BackgroundTasks
import httpx
import time
import uuid
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mock-soc")

app = FastAPI()

@app.post("/api/analyze")
async def analyze(request: Request, background_tasks: BackgroundTasks):
    data = await request.json()
    incident = data.get("incident")
    callback_url = data.get("callback_url")
    ticket_id = data.get("ticket_id")
    
    logger.info(f"Received analysis request for {ticket_id}")
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    
    # Simulate analysis delay and callback
    background_tasks.add_task(send_report, callback_url, ticket_id)
    
    return {"status": "queued", "job_id": job_id}

async def send_report(callback_url: str, ticket_id: str):
    logger.info("Starting analysis simulation...")
    time.sleep(10) # Wait 10 seconds
    
    report = {
        "incident_id": "original-id",
        "ticket_id": ticket_id,
        "status": "completed",
        "analysis_report": "### ANALYSIS REPORT\n\n**Verdict**: TRUE_POSITIVE\n\n**Summary**: This incident involves a known malware hash `224e58b68...` targeting a financial workstation. Host isolation is recommended.\n\n**Recommendation**: Isolate FIN-WS-001 immediately.",
        "timestamp": "2026-03-06T00:00:00Z"
    }
    
    # Inside docker network, we need to map the callback URL correctly.
    # If callback_url is http://localhost:8012/... it won't work from another container.
    # The incident-service sends its own perceived base URL.
    
    async with httpx.AsyncClient() as client:
        try:
            logger.info(f"Sending report back to {callback_url}")
            resp = await client.post(callback_url, json=report)
            logger.info(f"Callback status: {resp.status_code} | Body: {resp.text}")
        except Exception as e:
            logger.error(f"Callback failed: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
