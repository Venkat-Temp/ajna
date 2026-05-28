# Ajna — Mobile Device Intelligence & Fraud Risk Accelerator

## Project Overview

Real-time mobile fraud detection platform. Device telemetry is ingested via a REST API, scored by a risk engine, and streamed live to a dashboard over WebSocket. Backed by Redis Streams + PubSub, Neo4j identity graph, and Google Gemini AI for risk explanations.

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
         main.py listener → WebSocket broadcast
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

**Signal weights:**
- Emulator detected: +35
- GPS spoofed: +35
- Rooted device: +30
- High-value event on compromised device (combo penalty): +25
- VPN usage: +10
- OTP failures: +10 base, +30 at ≥3, +55 at ≥6 (2-min window)
- Referral velocity: +10 base, +15 at ≥2, +35 at ≥5 (5-min window)
- Graph signals (Neo4j): device shared across >2 accounts (+20), >5 accounts (+50); user on >3 devices (+15)

AI explanation (Gemini) is only called for Suspicious and Fraud events.

---

## Simulation Scenarios

Triggered via `POST /api/v1/scenarios/run?scenario=<name>`. Injects synthetic events directly into the Redis Stream.

| Scenario           | What it simulates                             |
|--------------------|-----------------------------------------------|
| `emulator_farm`    | 25 signups from same emulator device          |
| `otp_attack`       | 8 OTP failures → brute-force detection        |
| `referral_abuse`   | 10 referral claims from same device           |
| `rooted_wallet`    | Wallet transfer on rooted device              |
| `gps_spoofing`     | Login with GPS spoofed                        |
| `account_sharing`  | 1 user across 4 devices → ATO risk            |
| `account_takeover` | Credential stuffing: 1 user + 5 devices       |
| `checkout_fraud`   | Rooted + VPN → wallet_transfer + payment      |

---

## Frontend Notes

- **Next.js 16.2.6 with React 19** — this is a cutting-edge version with breaking API changes from prior Next.js versions. Before editing `frontend/`, read `frontend/AGENTS.md` for the warning and check `node_modules/next/dist/docs/` for current API docs. Do not rely on training-data knowledge of Next.js conventions.
- All frontend is a single page at `frontend/src/app/page.tsx` (App Router, `"use client"`).
- Tailwind v4 is used — configuration is via `postcss.config.mjs`, not `tailwind.config.js`.
- The WebSocket URL is hardcoded to `ws://localhost:8000/ws` — change if deploying.
- Lint: `npm run lint` (ESLint 9 flat config via `eslint.config.mjs`).

---

## Backend Notes

- Python 3.9+. Use the venv: `source backend/venv/bin/activate`.
- `risk_engine.py` is a **blocking worker** (infinite loop with `xreadgroup`). It is not imported by `main.py`; run it as a standalone process.
- `graph_engine.py` exports a module-level singleton `graph_engine`. Neo4j connection failure is handled gracefully (returns 0 risk score).
- CORS is currently set to `allow_origins=["*"]` — acceptable for local dev/demo only.
- `event.json()` in `main.py` uses Pydantic v1-style serialization; if upgrading Pydantic, switch to `event.model_dump_json()`.
- REST API: `POST /api/v1/cases/{case_id}/action` (analyst decision), `GET /api/v1/decisions` (audit log), `GET /api/v1/cases`.
- `cases_store` and `decisions_log` are in-memory (reset on restart) — acceptable for demo; use Redis Hashes/Lists for persistence.
- New risk signals: `app_tamper` (+25), `debug_mode` (+15), `login_failure` velocity (credential stuffing, +8–38).
- `recommended_action` is now a structured field in every risk result (Block ≥61, Challenge ≥46, Monitor ≥31, Allow <31).
- WebSocket broadcasts four message types: `NEW_EVENT`, `RISK_UPDATE`, `CASE_UPDATED`, `DECISION_LOGGED`.

---

## Android SDK

Located in `sdk/fraud-guard-sdk/` (Kotlin, Gradle). Demo app at `sdk/demo-app/`. Requires Android Studio. The SDK sends device telemetry to `POST /api/v1/events`.

---

## What Not To Do

- Do not add PostgreSQL integration — it is defined in `docker-compose.yml` but not yet used by any backend code. Don't wire it up unless explicitly requested.
- Do not change risk score thresholds without understanding the scoring pipeline end-to-end — thresholds affect all three categories and downstream UI coloring.
- Do not remove the `time.sleep(0.15)` in `simulation_engine.py` — it ensures sequential event arrival on the dashboard.
