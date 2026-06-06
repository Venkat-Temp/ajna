# Ajna — Mobile Device Intelligence & Fraud Risk Accelerator

## Project Overview

Real-time mobile fraud detection platform. Device telemetry is ingested via a REST API, scored by a risk engine, and streamed live to a dashboard over WebSocket. Backed by Redis Streams + PubSub, PostgreSQL (case/decision persistence), Neo4j identity graph, and Google Gemini AI for risk explanations.

**Monorepo layout:**
```
traci/
├── backend/          # Python FastAPI API server + risk engine worker
├── frontend/         # Next.js 16 dashboard (React 19, Tailwind v4)
├── sdk/              # Android SDK (ajna-sdk) + Kotlin demo app
└── docker-compose.yml
```

---

## Architecture & Data Flow

```
Android SDK → POST /api/v1/events
                  ↓
            Redis Stream (fraud_events)
                  ↓
         risk_engine.py (worker process)
                  ↓
         Redis PubSub (risk_updates)
                  ↓
         main.py listener → WebSocket broadcast + PostgreSQL upsert + webhook delivery
                  ↓
         Next.js dashboard (ws://localhost:8000/ws)
```

The **backend is two separate processes** — the FastAPI server and the risk engine worker must both be running:
- `main.py` — HTTP/WebSocket server (uvicorn)
- `risk_engine.py` — blocking Redis Streams consumer; run as a separate process

---

## Starting the Project

### 1. Infrastructure (Docker required)
```bash
docker-compose up -d   # starts PostgreSQL, Redis, Neo4j
```

### 2. Backend — load env then start both processes
```bash
cd backend
source venv/bin/activate
source .env.sh                         # loads GEMINI_API_KEY, NEO4J_* vars
uvicorn main:app --reload --port 8000  # terminal 1
python risk_engine.py                  # terminal 2
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev   # http://localhost:3000
```

---

## Service Ports & Credentials

| Service    | Port  | Credentials                          |
|------------|-------|--------------------------------------|
| FastAPI    | 8000  | —                                    |
| WebSocket  | 8000  | ws://localhost:8000/ws               |
| Next.js    | 3000  | —                                    |
| Redis      | 6379  | no auth                              |
| PostgreSQL | 5432  | fraud_admin / fraud_password         |
| Neo4j      | 7687  | neo4j / fraud_password               |
| Neo4j UI   | 7474  | http://localhost:7474                |

---

## Environment Variables

Set via `backend/.env.sh` (sourced before running backend). **Never commit this file** — it contains a real Gemini API key.

| Variable         | Purpose                    |
|------------------|----------------------------|
| `GEMINI_API_KEY` | Google Gemini AI (required for AI explanations on suspicious/fraud events) |
| `NEO4J_URI`      | bolt://localhost:7687       |
| `NEO4J_USER`     | neo4j                       |
| `NEO4J_PASSWORD` | fraud_password              |

If `GEMINI_API_KEY` is absent, `risk_engine.py` falls back to a mock explanation string — this is intentional and expected.

---

## Risk Scoring

Scores are computed in `backend/risk_engine.py:evaluate_risk()` and capped at 100.

| Category    | Score Range |
|-------------|-------------|
| Safe        | 0 – 30      |
| Suspicious  | 31 – 60     |
| Fraud       | 61 – 100    |

**Device intelligence signals:**
- Emulator detected: +35
- GPS spoofed: +35
- Rooted device: +30
- App tampered (not from Play Store): +25
- App cloned (parallel space / dual space): +25
- Debug mode: +15
- VPN usage: +10
- No hardware sensors (emulator/bot environment): +10
- High-value event on compromised device (combo penalty): +25

**Behavioral & bot signals:**
- OTP failures: +10 base, +30 at ≥3, +55 at ≥6 (2-min window)
- Login failures: +8 base, +15 at ≥3, +30 at ≥5 (2-min window)
- Referral velocity: +10 base, +15 at ≥2, +35 at ≥5 (5-min window)
- High event velocity (>3/min per user): +20
- Bot-like touch pattern (SDK cadence variance < 10ms with ≥3 interactions): +20
- Automated request timing (server-side — variance < 100ms², avg interval < 500ms): +20
- No sensor data in behavioral payload: +10

**Identity graph signals (Neo4j):**
- Device shared across >2 accounts: +20; >5 accounts: +50
- User active on >3 devices (ATO risk): +15
- Email shared across >1 accounts: +10; >3 accounts: +20
- IP subnet (/24) used by >10 accounts: +15

**Device trust history (Redis):**
- Known high-risk device (≥3 fraud events, trust score >65): +15

AI explanation (Gemini) is only called for Suspicious and Fraud events.

---

## Simulation Scenarios

Triggered via `POST /api/v1/scenarios/run?scenario=<name>`. Injects synthetic events directly into the Redis Stream.

| Scenario             | What it simulates                                          |
|----------------------|------------------------------------------------------------|
| `emulator_farm`      | 25 signups from same emulator device                       |
| `otp_attack`         | 8 OTP failures → brute-force detection                     |
| `referral_abuse`     | 10 referral claims from same device                        |
| `rooted_wallet`      | Wallet transfer on rooted device                           |
| `gps_spoofing`       | Login with GPS spoofed                                     |
| `account_sharing`    | 1 user across 4 devices → ATO risk                         |
| `account_takeover`   | Credential stuffing: 1 user + 5 devices                    |
| `checkout_fraud`     | Rooted + VPN → wallet_transfer + payment                   |
| `bot_farm`           | 10 automated bot signups with uniform timing + app cloning |
| `app_cloning_abuse`  | 5 accounts from same cloned app instance                   |

---

## REST API Endpoints

| Method   | Endpoint                              | Purpose                                              |
|----------|---------------------------------------|------------------------------------------------------|
| `POST`   | `/api/v1/events`                      | Ingest device telemetry (soft API key auth)          |
| `GET`    | `/api/v1/cases`                       | List evaluated cases (DB-backed, paginated)          |
| `POST`   | `/api/v1/cases/{case_id}/action`      | Submit analyst decision (Allow/Monitor/Challenge/Block) |
| `GET`    | `/api/v1/decisions`                   | Audit log of all analyst decisions                   |
| `GET`    | `/api/v1/devices/{device_id}/trust`   | Per-device trust profile from Redis                  |
| `GET`    | `/api/v1/policies`                    | List configurable risk signal policies               |
| `POST`   | `/api/v1/policies/{policy_id}`        | Update a policy (enabled, score_delta, etc.)         |
| `GET`    | `/api/v1/reports/summary`             | Aggregated stats (by category, signal frequency)     |
| `GET`    | `/api/v1/webhooks`                    | List registered webhook endpoints                    |
| `POST`   | `/api/v1/webhooks`                    | Register a new webhook (url, secret)                 |
| `DELETE` | `/api/v1/webhooks/{webhook_id}`       | Remove a webhook                                     |
| `POST`   | `/api/v1/admin/keys`                  | Provision a new API key                              |
| `POST`   | `/api/v1/scenarios/run?scenario=<n>`  | Trigger simulation scenario                          |
| `WS`     | `/ws`                                 | Real-time event/risk stream                          |
| `GET`    | `/`                                   | Health check                                         |

WebSocket broadcasts five message types: `NEW_EVENT`, `RISK_UPDATE`, `CASE_UPDATED`, `DECISION_LOGGED`, `POLICY_UPDATED`.

---

## Frontend Notes

- **Next.js 16.2.6 with React 19** — this is a cutting-edge version with breaking API changes from prior Next.js versions. Before editing `frontend/`, read `frontend/AGENTS.md` for the warning and check `node_modules/next/dist/docs/` for current API docs. Do not rely on training-data knowledge of Next.js conventions.
- All frontend is a single page at `frontend/src/app/page.tsx` (App Router, `"use client"`).
- Tailwind v4 is used — configuration is via `postcss.config.mjs`, not `tailwind.config.js`.
- The WebSocket URL is hardcoded to `ws://localhost:8000/ws` — change if deploying.
- Lint: `npm run lint` (ESLint 9 flat config via `eslint.config.mjs`).

**Dashboard tabs:**
1. **Live Risk Feed** — real-time case cards with analyst action buttons
2. **High-Risk Devices** — devices with score ≥31; shows persistent trust score badge (fetched from `/api/v1/devices/{id}/trust` when tab is active)
3. **High-Risk Accounts** — accounts with score ≥31
4. **Audit Trail** — analyst decision log with CSV export button
5. **Risk Policies** — live toggle of each risk signal (enable/disable); changes call `POST /api/v1/policies/{id}` and broadcast `POLICY_UPDATED` via WebSocket

**Signal categorization in RiskCard:**
- **Device Intelligence** (red): hardware flags, app cloning, no sensors
- **Behavioral** (amber): velocity, OTP/login failures, bot-like timing, cadence variance
- **Identity Network** (indigo): graph-based signals (device farm, ATO, email sharing, subnet)

---

## Backend Notes

- Python 3.9+. Use the venv: `source backend/venv/bin/activate`.
- Dependencies: `fastapi`, `uvicorn`, `redis`, `neo4j`, `google-generativeai`, `asyncpg`, `httpx`. Install with `pip install -r requirements.txt` or install individually.
- `risk_engine.py` is a **blocking worker** (infinite loop with `xreadgroup`). It is not imported by `main.py`; run it as a standalone process.
- `graph_engine.py` exports a module-level singleton `graph_engine`. Neo4j connection failure is handled gracefully (returns 0 risk score). Now supports `:Email` nodes with `USES_EMAIL` relationships and IP subnet queries.
- `policy_engine.py` — stores signal policies as JSON in Redis key `fraud_policies`. Call `get_policies()` / `save_policies()` to read/write. `evaluate_policies()` is available but signals are still evaluated directly in `risk_engine.py` for reliability.
- CORS is currently set to `allow_origins=["*"]` — acceptable for local dev/demo only.
- `event.json()` in `main.py` uses Pydantic v1-style serialization; if upgrading Pydantic, switch to `event.model_dump_json()`.
- `cases_store` and `decisions_log` are kept in-memory as a fast cache alongside PostgreSQL persistence. On startup, PostgreSQL creates `cases` and `decisions` tables if they don't exist. If PostgreSQL is unavailable, the server falls back to in-memory only — no crash.
- Device trust scores are stored in Redis hashes at `trust:{device_id}` with a 30-day TTL. EMA (alpha=0.3) is applied per event.
- API key authentication is soft-launched: absent key is accepted, present key must be valid. Provision keys via `POST /api/v1/admin/keys?name=<name>`. Keys stored as `apikey:{sha256_hash}` in Redis.
- Webhooks are stored in Redis key `webhooks:registry` (JSON list). Delivery is async with 2 retries and HMAC-SHA256 signature in `X-Ajna-Signature` header. Only fired for events with score ≥ 31.

---

## Android SDK

Located in `sdk/ajna-sdk/` (Kotlin, Gradle). Demo app at `sdk/demo-app/`. Requires Android Studio. The SDK sends device telemetry to `POST /api/v1/events`.

**Key files:**
- `AjnaSDK.kt` — Singleton entry point; `init()` + `logEvent(eventType, userId)` + `getDeviceId()`
- `DeviceIntelligence.kt` — Collects device signals; `getPersistentDeviceId()` generates a SHA-256 fingerprint from hardware constants (survives reinstall); `isAppCloned()` checks for parallel-space packages
- `BehavioralIntelligence.kt` — Touch analytics; call `recordTouchEvent(MotionEvent)` on user interactions, then `collectBehavioralTelemetry()` before `logEvent()` to include cadence variance in the payload

**Device payload fields:** `os`, `os_version`, `model`, `manufacturer`, `fingerprint`, `rooted`, `emulator`, `vpn`, `gps_spoofed`, `app_tamper`, `debug_mode`, `app_cloned`, `has_sensors`

**Behavioral payload fields (under `"behavioral"` key):** `touch_pressure_avg`, `touch_area_avg`, `tap_cadence_variance`, `interaction_count`

**Device ID strategy:** Reads `device_id_v2` from SharedPreferences. On first run, computes `SHA-256(ANDROID_ID|BOARD|HARDWARE|MANUFACTURER|MODEL|SERIAL)`. Falls back to a persisted UUID if hardware constants are unavailable. Old `device_id` key (plain UUID) is untouched for backwards compatibility.

---

## What Not To Do

- Do not change risk score thresholds (31/46/61/100) without understanding the full scoring pipeline — thresholds affect category assignment, recommended action, AI explanation triggering, and UI coloring.
- Do not remove the `time.sleep(0.15)` in `simulation_engine.py` — it ensures sequential event arrival on the dashboard.
- Do not store plaintext emails — only accept `email_hash` (SHA-256 of email) in `EventPayload`.
- Do not skip the `source venv/bin/activate` step before running backend — `asyncpg` and `httpx` are installed in the venv only.
