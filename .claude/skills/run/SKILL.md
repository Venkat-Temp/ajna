---
description: Launch Ajna (Docker infra + FastAPI backend + risk engine + Next.js frontend) and verify all services are up
---

# Run — Ajna Mobile Fraud Detection Demo

Starts four things in order: Docker infrastructure, FastAPI server, risk engine worker, and Next.js dev server.

## Prerequisites

- Docker Desktop running
- `backend/venv` activated
- `backend/.env.sh` present (contains `GEMINI_API_KEY`, `NEO4J_*`)
- `frontend/node_modules` present (run `npm install` if missing)

## 1 — Docker infrastructure

```bash
cd /Users/venkat/Documents/traci
docker-compose up -d
```

Wait for healthy containers (PostgreSQL, Redis, Neo4j):

```bash
for i in {1..20}; do
  docker-compose ps | grep -qE "(healthy|Up)" && break
  sleep 2
done
docker-compose ps
```

## 2 — FastAPI server (background)

```bash
cd /Users/venkat/Documents/traci/backend
source venv/bin/activate
source .env.sh
uvicorn main:app --reload --port 8000 &> /tmp/ajna-api.log &
UVICORN_PID=$!

for i in {1..30}; do
  curl -sf http://localhost:8000/ > /dev/null && break
  sleep 1
done
curl http://localhost:8000/
```

Health check returns `{"status": "healthy", ...}`.

Logs: `/tmp/ajna-api.log`

## 3 — Risk engine worker (background)

```bash
cd /Users/venkat/Documents/traci/backend
source venv/bin/activate
source .env.sh
python risk_engine.py &> /tmp/ajna-risk-engine.log &
RISK_ENGINE_PID=$!
sleep 2
# Verify it started (no immediate crash)
kill -0 $RISK_ENGINE_PID && echo "risk_engine running" || echo "risk_engine FAILED"
```

Logs: `/tmp/ajna-risk-engine.log`

## 4 — Next.js frontend (background)

```bash
cd /Users/venkat/Documents/traci/frontend
npm run dev &> /tmp/ajna-frontend.log &
FRONTEND_PID=$!

for i in {1..30}; do
  curl -sf http://localhost:3000/ > /dev/null && break
  sleep 1
done
echo "Frontend up"
```

Logs: `/tmp/ajna-frontend.log`

## 5 — Smoke test

```bash
# Health check
curl http://localhost:8000/

# Send a test event (event_id, device_id, timestamp are required)
curl -s -X POST http://localhost:8000/api/v1/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "smoke-evt-001",
    "event_type": "login",
    "user_id": "smoke-user-001",
    "device_id": "smoke-device-001",
    "timestamp": "2026-06-06T10:15:30Z",
    "device": {
      "device_id": "smoke-device-001",
      "os": "Android",
      "os_version": "13",
      "model": "Pixel 7",
      "manufacturer": "Google",
      "fingerprint": "smoke-fp-001",
      "rooted": false,
      "emulator": false,
      "vpn": false,
      "gps_spoofed": false,
      "app_tamper": false,
      "debug_mode": false,
      "app_cloned": false,
      "has_sensors": true
    }
  }' | python3 -m json.tool

# Check cases list
curl -s http://localhost:8000/api/v1/cases | python3 -m json.tool
```

## Stop all

```bash
pkill -f "uvicorn main:app"
pkill -f "risk_engine.py"
pkill -f "next-server"
docker-compose stop
```

## Ports

| Service     | URL                          |
|-------------|------------------------------|
| FastAPI     | http://localhost:8000        |
| WebSocket   | ws://localhost:8000/ws       |
| Next.js     | http://localhost:3000        |
| Neo4j UI    | http://localhost:7474        |

## Notes

- The risk engine is a **separate process** — missing it means events are ingested but never scored.
- If `GEMINI_API_KEY` is absent, risk engine uses a mock AI explanation — still functional.
- Dashboard at `http://localhost:3000` connects to `ws://localhost:8000/ws` automatically.
- To test fraud scenarios after startup: `curl -X POST "http://localhost:8000/api/v1/scenarios/run?scenario=emulator_farm"`
