from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Header, Body, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from collections import deque
import json
import logging
import asyncio
import time
import hashlib
import hmac as hmaclib
import secrets
import uuid
import os
import redis.asyncio as redis_async
import httpx
from simulation_engine import router as sim_router
from graph_engine import graph_engine as _graph_engine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

try:
    import asyncpg
    HAS_ASYNCPG = True
except ImportError:
    HAS_ASYNCPG = False

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app = FastAPI(title="Ajna", version="2.0.0")
redis_client = redis_async.Redis.from_url(REDIS_URL, decode_responses=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(sim_router, prefix="/api/v1/scenarios")

cases_store: dict = {}
decisions_log: deque = deque(maxlen=1000)  # capped; fallback only when PostgreSQL unavailable
db_pool = None

DB_DSN = os.environ.get(
    "DATABASE_URL",
    "postgresql://fraud_admin:fraud_password@localhost:5432/postgres"
)


class EventPayload(BaseModel):
    event_id: str
    user_id: str
    device_id: str
    event_type: str
    timestamp: str
    ip: Optional[str] = None
    device: Optional[dict] = None
    network: Optional[dict] = None
    email_hash: Optional[str] = None  # SHA-256 of email — never store plaintext


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
        # Replay last 50 cases from DB if available, else in-memory
        replay_cases = await _load_recent_cases(50)
        for case in replay_cases:
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


async def _load_recent_cases(limit: int) -> list:
    if db_pool:
        try:
            async with db_pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT data FROM cases ORDER BY created_at DESC LIMIT $1", limit
                )
                return [json.loads(r['data']) for r in reversed(rows)]
        except Exception as e:
            logger.error("DB load error: %s", e)
    return list(cases_store.values())[-limit:]


async def _upsert_case(case_id: str, data: dict):
    if db_pool:
        try:
            now = time.time()
            async with db_pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO cases (case_id, data, created_at, updated_at)
                    VALUES ($1, $2::jsonb, $3, $3)
                    ON CONFLICT (case_id) DO UPDATE
                        SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
                    """,
                    case_id, json.dumps(data), now
                )
        except Exception as e:
            logger.error("DB upsert case error: %s", e)


async def _insert_decision(decision_id: str, case_id: str, data: dict):
    if db_pool:
        try:
            async with db_pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO decisions (decision_id, case_id, data, created_at)
                    VALUES ($1, $2, $3::jsonb, $4)
                    ON CONFLICT (decision_id) DO NOTHING
                    """,
                    decision_id, case_id, json.dumps(data), time.time()
                )
        except Exception as e:
            logger.error("DB insert decision error: %s", e)


async def _check_rate_limit(ip: str, limit: int = 100, window: int = 60):
    key = f"ratelimit:events:{ip}"
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, window)
    if count > limit:
        raise HTTPException(status_code=429, detail="Rate limit exceeded — max 100 requests/min per IP")


async def verify_api_key(x_api_key: Optional[str] = Header(None)):
    if x_api_key is None:
        return None
    key_hash = hashlib.sha256(x_api_key.encode()).hexdigest()
    key_data_raw = await redis_client.get(f"apikey:{key_hash}")
    if not key_data_raw:
        raise HTTPException(status_code=401, detail="Invalid API key")
    key_data = json.loads(key_data_raw)
    if not key_data.get('enabled'):
        raise HTTPException(status_code=403, detail="API key disabled")
    return key_data


@app.get("/")
def read_root():
    return {"status": "ok", "service": "Ajna", "version": "2.0.0"}


@app.post("/api/v1/events")
async def ingest_event(event: EventPayload, request: Request, _key=Depends(verify_api_key)):
    await _check_rate_limit(request.client.host)
    await redis_client.xadd('fraud_events', {'payload': event.model_dump_json()})
    await manager.broadcast({"type": "NEW_EVENT", "data": event.model_dump()})
    return {"status": "received", "event_id": event.event_id}


@app.post("/api/v1/cases/{case_id}/action")
async def submit_case_action(case_id: str, payload: ActionRequest):
    # Check in-memory first, then Redis cache, then DB
    case = cases_store.get(case_id)
    if not case and db_pool:
        cached = await redis_client.get(f"cases:{case_id}")
        if cached:
            case = json.loads(cached)
        else:
            try:
                async with db_pool.acquire() as conn:
                    row = await conn.fetchrow("SELECT data FROM cases WHERE case_id=$1", case_id)
                    if row:
                        case = json.loads(row['data'])
            except Exception:
                pass
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    now = time.time()
    case.update({
        "analyst_action": payload.action,
        "analyst": payload.analyst,
        "notes": payload.notes,
        "decided_at": now,
        "status": "reviewed",
    })
    cases_store[case_id] = case

    decision_id = f"dec_{uuid.uuid4().hex[:8]}"
    entry = {
        "decision_id": decision_id,
        "case_id": case_id,
        "action": payload.action,
        "analyst": payload.analyst,
        "notes": payload.notes,
        "timestamp": now,
        "risk_score": case.get("risk_score"),
        "category": case.get("category"),
        "user_id": case.get("user_id"),
        "device_id": case.get("device_id"),
        "event_type": case.get("event_type"),
        "reasons": case.get("reasons", []),
        "recommended_action": case.get("recommended_action"),
    }
    decisions_log.append(entry)

    # Persist both to DB
    await _upsert_case(case_id, case)
    await _insert_decision(decision_id, case_id, entry)
    await redis_client.setex(f"cases:{case_id}", 300, json.dumps(case))

    await manager.broadcast({"type": "CASE_UPDATED", "data": case})
    await manager.broadcast({"type": "DECISION_LOGGED", "data": entry})
    return {"status": "ok", "case_id": case_id, "action": payload.action}


@app.get("/api/v1/decisions")
async def get_decisions(limit: int = 100):
    if db_pool:
        try:
            async with db_pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT data FROM decisions ORDER BY created_at DESC LIMIT $1", limit
                )
                return {"decisions": [json.loads(r['data']) for r in rows]}
        except Exception as e:
            logger.error("DB decisions fetch error: %s", e)
    return {"decisions": list(reversed(decisions_log))[:limit]}


@app.get("/api/v1/cases")
async def get_cases(limit: int = 200):
    if db_pool:
        try:
            async with db_pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT data FROM cases ORDER BY created_at DESC LIMIT $1", limit
                )
                return {"cases": [json.loads(r['data']) for r in rows]}
        except Exception as e:
            logger.error("DB cases fetch error: %s", e)
    return {"cases": list(cases_store.values())[-limit:]}


@app.get("/api/v1/devices/{device_id}/trust")
async def get_device_trust(device_id: str):
    trust_data = await redis_client.hgetall(f"trust:{device_id}")
    if not trust_data:
        raise HTTPException(status_code=404, detail="No trust data for this device")
    return {
        "device_id": device_id,
        "trust_score": float(trust_data.get("trust_score", 50)),
        "event_count": int(trust_data.get("event_count", 0)),
        "fraud_count": int(trust_data.get("fraud_count", 0)),
        "last_seen": float(trust_data.get("last_seen", 0)),
        "last_category": trust_data.get("last_category", "Unknown"),
    }


@app.get("/api/v1/policies")
def get_policies_endpoint():
    from policy_engine import get_policies
    return {"policies": get_policies()}


@app.post("/api/v1/policies/{policy_id}")
async def update_policy(policy_id: str, body: dict = Body(...)):
    from policy_engine import get_policies, save_policies
    policies = get_policies()
    for p in policies:
        if p['id'] == policy_id:
            p.update(body)
            save_policies(policies)
            await manager.broadcast({"type": "POLICY_UPDATED", "data": p})
            return {"status": "ok", "policy": p}
    raise HTTPException(status_code=404, detail="Policy not found")


@app.get("/api/v1/reports/summary")
async def get_report_summary():
    if db_pool:
        try:
            async with db_pool.acquire() as conn:
                rows = await conn.fetch("SELECT data FROM cases")
                cases = [json.loads(r['data']) for r in rows]
        except Exception:
            cases = list(cases_store.values())
    else:
        cases = list(cases_store.values())

    total = len(cases)
    by_category = {"Safe": 0, "Suspicious": 0, "Fraud": 0}
    by_action = {"Allow": 0, "Monitor": 0, "Challenge": 0, "Block": 0}
    signal_freq: dict = {}

    for c in cases:
        cat = c.get("category", "Safe")
        if cat in by_category:
            by_category[cat] += 1
        act = c.get("recommended_action", "Allow")
        if act in by_action:
            by_action[act] += 1
        for reason in c.get("reasons", []):
            signal_freq[reason] = signal_freq.get(reason, 0) + 1

    top_signals = sorted(signal_freq.items(), key=lambda x: x[1], reverse=True)[:10]
    return {
        "total_events": total,
        "by_category": by_category,
        "by_recommended_action": by_action,
        "top_signals": [{"signal": s, "count": c} for s, c in top_signals],
    }


WEBHOOKS_KEY = "webhooks:registry"


def _webhook_signature(secret: str, body: bytes) -> str:
    return "sha256=" + hmaclib.new(secret.encode(), body, "sha256").hexdigest()


async def _deliver_webhooks(risk_data: dict):
    if risk_data.get("risk_score", 0) < 31:
        return
    raw = await redis_client.get(WEBHOOKS_KEY)
    if not raw:
        return
    hooks = json.loads(raw)
    payload = json.dumps(risk_data).encode()
    async with httpx.AsyncClient(timeout=3.0) as client:
        for hook in hooks:
            if not hook.get("enabled", True):
                continue
            sig = _webhook_signature(hook.get("secret", ""), payload)
            for attempt in range(2):
                try:
                    await client.post(
                        hook["url"],
                        content=payload,
                        headers={"Content-Type": "application/json", "X-Ajna-Signature": sig},
                    )
                    break
                except Exception as e:
                    if attempt == 1:
                        logger.error("Webhook delivery failed for %s after 2 attempts: %s", hook["url"], e)


@app.get("/api/v1/webhooks")
async def list_webhooks():
    raw = await redis_client.get(WEBHOOKS_KEY)
    hooks = json.loads(raw) if raw else []
    return {"webhooks": [{"id": h["id"], "url": h["url"], "enabled": h.get("enabled", True)} for h in hooks]}


@app.post("/api/v1/webhooks")
async def register_webhook(url: str, secret: str = ""):
    raw = await redis_client.get(WEBHOOKS_KEY)
    hooks = json.loads(raw) if raw else []
    hook = {"id": f"wh_{uuid.uuid4().hex[:8]}", "url": url, "secret": secret, "enabled": True}
    hooks.append(hook)
    await redis_client.set(WEBHOOKS_KEY, json.dumps(hooks))
    return {"status": "registered", "id": hook["id"]}


@app.delete("/api/v1/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str):
    raw = await redis_client.get(WEBHOOKS_KEY)
    hooks = json.loads(raw) if raw else []
    hooks = [h for h in hooks if h["id"] != webhook_id]
    await redis_client.set(WEBHOOKS_KEY, json.dumps(hooks))
    return {"status": "deleted"}


@app.post("/api/v1/admin/keys")
async def provision_api_key(name: str):
    raw_key = f"ajna_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    await redis_client.set(f"apikey:{key_hash}", json.dumps({"name": name, "enabled": True}))
    return {"api_key": raw_key, "name": name}


async def redis_listener():
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("risk_updates")
    logger.info("Listening for risk updates...")
    async for message in pubsub.listen():
        if message["type"] == "message":
            risk_data = json.loads(message["data"])
            case_id = risk_data.get("case_id")
            if case_id:
                case = {**risk_data, "status": "pending"}
                cases_store[case_id] = case
                await _upsert_case(case_id, case)
                await redis_client.setex(f"cases:{case_id}", 300, json.dumps(case))
            await manager.broadcast({"type": "RISK_UPDATE", "data": risk_data})
            asyncio.create_task(_deliver_webhooks(risk_data))


@app.on_event("startup")
async def startup_event():
    global db_pool
    if HAS_ASYNCPG:
        try:
            db_pool = await asyncpg.create_pool(DB_DSN, min_size=2, max_size=10)
            async with db_pool.acquire() as conn:
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS cases (
                        case_id TEXT PRIMARY KEY,
                        data JSONB NOT NULL,
                        created_at DOUBLE PRECISION NOT NULL,
                        updated_at DOUBLE PRECISION NOT NULL
                    )
                """)
                await conn.execute("""
                    CREATE TABLE IF NOT EXISTS decisions (
                        decision_id TEXT PRIMARY KEY,
                        case_id TEXT NOT NULL,
                        data JSONB NOT NULL,
                        created_at DOUBLE PRECISION NOT NULL
                    )
                """)
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at DESC)"
                )
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at DESC)"
                )
                await conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_decisions_case_id ON decisions(case_id)"
                )
            logger.info("PostgreSQL connected — case/decision persistence enabled")
        except Exception as e:
            logger.warning("PostgreSQL unavailable (%s) — using in-memory storage", e)
            db_pool = None
    else:
        logger.warning("asyncpg not installed — using in-memory storage")

    asyncio.create_task(redis_listener())


@app.get("/health")
async def health_check():
    checks = {}
    try:
        await redis_client.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {e}"
    if db_pool:
        try:
            async with db_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            checks["postgres"] = "ok"
        except Exception as e:
            checks["postgres"] = f"error: {e}"
    else:
        checks["postgres"] = "unavailable"
    checks["neo4j"] = "ok" if _graph_engine.driver else "unavailable"
    healthy = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "healthy" if healthy else "degraded", "checks": checks},
    )


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
