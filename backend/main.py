from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import json
import asyncio
import time
import redis.asyncio as redis_async
from simulation_engine import router as sim_router

app = FastAPI(title="Ajna", version="1.0.0")
redis_client = redis_async.Redis(host='localhost', port=6379, db=0, decode_responses=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(sim_router, prefix="/api/v1/scenarios")

# In-memory stores — Redis-backed persistence is straightforward to add for production
cases_store: dict = {}
decisions_log: list = []


class EventPayload(BaseModel):
    event_id: str
    user_id: str
    device_id: str
    event_type: str
    timestamp: str
    ip: Optional[str] = None
    device: Optional[dict] = None
    network: Optional[dict] = None


class ActionRequest(BaseModel):
    action: str          # Allow | Monitor | Challenge | Block
    analyst: str = "analyst_01"
    notes: Optional[str] = None


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Replay the last 50 evaluated cases so new tabs are immediately populated
        for case in list(cases_store.values())[-50:]:
            try:
                await websocket.send_text(json.dumps({"type": "RISK_UPDATE", "data": case}))
            except Exception:
                break

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead = []
        for conn in self.active_connections:
            try:
                await conn.send_text(json.dumps(message))
            except Exception:
                dead.append(conn)
        for conn in dead:
            self.active_connections.remove(conn)


manager = ConnectionManager()


@app.get("/")
def read_root():
    return {"status": "ok", "service": "Ajna", "version": "1.0.0"}


@app.post("/api/v1/events")
async def ingest_event(event: EventPayload):
    await redis_client.xadd('fraud_events', {'payload': event.json()})
    await manager.broadcast({"type": "NEW_EVENT", "data": event.dict()})
    return {"status": "received", "event_id": event.event_id}


@app.post("/api/v1/cases/{case_id}/action")
async def submit_case_action(case_id: str, payload: ActionRequest):
    if case_id not in cases_store:
        raise HTTPException(status_code=404, detail="Case not found")

    now = time.time()
    cases_store[case_id].update({
        "analyst_action": payload.action,
        "analyst": payload.analyst,
        "notes": payload.notes,
        "decided_at": now,
        "status": "reviewed",
    })

    entry = {
        "case_id": case_id,
        "action": payload.action,
        "analyst": payload.analyst,
        "notes": payload.notes,
        "timestamp": now,
        "risk_score": cases_store[case_id].get("risk_score"),
        "category": cases_store[case_id].get("category"),
        "user_id": cases_store[case_id].get("user_id"),
        "device_id": cases_store[case_id].get("device_id"),
        "event_type": cases_store[case_id].get("event_type"),
        "reasons": cases_store[case_id].get("reasons", []),
        "recommended_action": cases_store[case_id].get("recommended_action"),
    }
    decisions_log.append(entry)

    await manager.broadcast({"type": "CASE_UPDATED", "data": cases_store[case_id]})
    await manager.broadcast({"type": "DECISION_LOGGED", "data": entry})
    return {"status": "ok", "case_id": case_id, "action": payload.action}


@app.get("/api/v1/decisions")
def get_decisions(limit: int = 100):
    return {"decisions": list(reversed(decisions_log))[:limit]}


@app.get("/api/v1/cases")
def get_cases(limit: int = 200):
    return {"cases": list(cases_store.values())[-limit:]}


async def redis_listener():
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("risk_updates")
    print("Listening for risk updates...")
    async for message in pubsub.listen():
        if message["type"] == "message":
            risk_data = json.loads(message["data"])
            case_id = risk_data.get("case_id")
            if case_id:
                cases_store[case_id] = {**risk_data, "status": "pending"}
            await manager.broadcast({"type": "RISK_UPDATE", "data": risk_data})


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(redis_listener())


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
