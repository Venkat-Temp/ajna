# Ajna — Mobile Device Intelligence & Fraud Risk Accelerator

## Project Overview

Real-time mobile fraud detection platform. Device telemetry is ingested via a REST API, scored by a risk engine, and streamed live to a fraud-operations console over WebSocket. Backed by Redis Streams + PubSub, PostgreSQL (case/decision persistence), Neo4j identity graph, and Google Gemini AI for risk explanations and an analyst copilot.

**Three-layer device-intelligence model** (the product's organizing principle — *collect · understand · act*):
- **Layer 1 — Collect:** the Android SDK gathers device-integrity signals and behavioral biometrics (touch, keystroke, swipe, device-motion, session timing).
- **Layer 2 — Understand:** the scoring engine (`backend/scoring.py`) combines device intelligence, behavioral velocity, a *learned per-user behavioral baseline* (deviation-from-self), a *known-fraud behavioral signature*, the Neo4j identity graph, and fraud-ring detection. Exposed via an intelligence API (`/entities/.../profile`, `/rings`).
- **Layer 3 — Act:** real-time inline decisioning (`POST /api/v1/decide` → ALLOW / REVIEW / CHALLENGE / BLOCK), an AI fraud-analyst copilot (`/copilot`), and an outcome feedback loop (`/cases/{id}/outcome`) that reinforces device reputation and the known-fraud signature so the system learns.

**Monorepo layout:**
```
traci/
├── backend/          # Python FastAPI API server + risk engine worker + scoring engine
├── frontend/         # Next.js 16 fraud-ops console (React 19, Tailwind v4, shadcn/ui)
├── sdk/              # Android SDK (ajna-sdk) + Kotlin demo app
└── docker-compose.yml
```

---

## Architecture & Data Flow

There are **two scoring paths**, both calling the same `scoring.evaluate_risk()`:

**Async (fire-and-forget) — `POST /api/v1/events`:**
```
Android SDK → POST /api/v1/events
                  ↓
            Redis Stream (fraud_events)
                  ↓
         risk_engine.py (worker process) → scoring.evaluate_risk()
                  ↓
         Redis PubSub (risk_updates)
                  ↓
         main.py listener → WebSocket broadcast + PostgreSQL upsert + webhook delivery
                  ↓
         Next.js console (ws://localhost:8000/ws)
```

**Synchronous (inline decisioning) — `POST /api/v1/decide`:**
```
Calling app → POST /api/v1/decide → scoring.decide() (in-request, via asyncio.to_thread)
                  ↓
         returns verdict { decision, trust, why, reason_codes } to the caller
                  ↓
         also persists + broadcasts the case (RISK_UPDATE) so it appears on the console
```

The **backend is two separate processes** — the FastAPI server and the risk engine worker must both be running:
- `main.py` — HTTP/WebSocket server (uvicorn); also serves the synchronous `/decide` path
- `risk_engine.py` — blocking Redis Streams consumer; run as a separate process
- `scoring.py` — shared scoring engine imported by both; **single source of truth for `evaluate_risk()`**

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

Scores are computed in `backend/scoring.py:evaluate_risk()` (shared by `risk_engine.py` and `main.py`) and capped at 100. Signal weights are driven by `threshold_engine.py` (configurable at runtime via `/api/v1/thresholds`) and the policy engine.

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

**Learned behavioral baseline — deviation-from-self (Layer 2):**
- Per user, an EMA mean + variance is maintained for each behavioral feature (`tap_cadence_variance`, `touch_pressure_avg`, `touch_area_avg`) in Redis (`behprofile:user:{id}`, 90-day TTL).
- After `behavioral_min_samples` (5) observations, a session whose behavior is ≥ `behavioral_deviation_sigma` (3σ) from this user's own normal: +35. A severe departure (≥ `behavioral_severe_sigma` = 6σ): +25 more (35+25 → Challenge) — flagged as possible account takeover.
- This catches the case heuristics miss: a clean-looking session (right device, right credentials) that simply doesn't behave like *this* user. Deviation is read **before** the profile is updated.

**Known-fraud behavioral signature (Layer 2):**
- Confirmed-fraud outcomes fold their behavioral vector into a shared centroid (`knownbad:behavioral`). Once ≥ `known_bad_min_samples` (3) are recorded, a new session ≥ `known_bad_similarity_min` (0.85) similar to it: +30 — catches bot rings / scripted abusers even on a thin per-user baseline.

**Device trust history (Redis):**
- Known high-risk device (≥3 fraud events, trust score >65): +15

**Session-aware signals (Redis `session:{id}`, derived from user+device+time-slot):**
- Session escalated from safe to suspicious/fraud: +15
- Multiple high-risk events in session (≥2): +20
- Repeated fraud events in this session: +10

AI explanation (Gemini, `gemini-2.5-flash`) is only called for Suspicious and Fraud events; a grounded mock string is used when `GEMINI_API_KEY` is absent.

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
| `POST`   | `/api/v1/events`                      | Ingest device telemetry, async/fire-and-forget (soft API key auth) |
| `POST`   | `/api/v1/decide`                      | **Layer 3** — score in-request, return inline verdict (ALLOW/REVIEW/CHALLENGE/BLOCK) + 0-1 trust + reason codes |
| `GET`    | `/api/v1/entities/{type}/{id}/profile`| **Layer 2 intelligence API** — learned behavioral baseline (+ trust history for devices); `type` ∈ `user`,`device` |
| `GET`    | `/api/v1/cases`                       | List evaluated cases (DB-backed, paginated)          |
| `POST`   | `/api/v1/cases/{case_id}/action`      | Submit analyst decision (Allow/Monitor/Challenge/Block) |
| `POST`   | `/api/v1/cases/{case_id}/outcome`     | **Feedback loop** — record ground truth (`confirmed_fraud`/`false_positive`/`legit`); confirmed fraud reinforces trust + known-fraud signature |
| `GET`    | `/api/v1/decisions`                   | Audit log of all analyst decisions                   |
| `GET`    | `/api/v1/devices/{device_id}/trust`   | Per-device trust profile from Redis                  |
| `GET`    | `/api/v1/graph/{device_id}`           | Identity-cluster nodes + edges around a device       |
| `GET`    | `/api/v1/rings?min_accounts=<n>`      | Fraud-ring detection — accounts converging on a shared device/email |
| `POST`   | `/api/v1/copilot`                     | AI fraud-analyst copilot — NL Q&A grounded in a case's signals/deviation/trust |
| `GET`    | `/api/v1/policies`                    | List configurable risk signal policies               |
| `POST`   | `/api/v1/policies/{policy_id}`        | Update a policy (enabled, score_delta, etc.)         |
| `GET`    | `/api/v1/thresholds`                  | List configurable scoring thresholds                 |
| `POST`   | `/api/v1/thresholds`                  | Update threshold(s); broadcasts `THRESHOLD_UPDATED`  |
| `POST`   | `/api/v1/thresholds/reset`            | Reset all thresholds to defaults                     |
| `GET`    | `/api/v1/reports/summary`             | Aggregated stats: by category/action, signal freq, outcomes, precision, exposure blocked, behavioral catches |
| `GET`    | `/api/v1/webhooks`                    | List registered webhook endpoints                    |
| `POST`   | `/api/v1/webhooks`                    | Register a new webhook (url, secret)                 |
| `DELETE` | `/api/v1/webhooks/{webhook_id}`       | Remove a webhook                                     |
| `POST`   | `/api/v1/admin/keys`                  | Provision a new API key                              |
| `POST`   | `/api/v1/scenarios/run?scenario=<n>`  | Trigger simulation scenario                          |
| `WS`     | `/ws`                                 | Real-time event/risk stream                          |
| `GET`    | `/`                                   | Health check                                         |

WebSocket broadcasts six message types: `NEW_EVENT`, `RISK_UPDATE`, `CASE_UPDATED`, `DECISION_LOGGED`, `POLICY_UPDATED`, `THRESHOLD_UPDATED`.

---

## Frontend Notes

- **Next.js 16.2.6 with React 19** — this is a cutting-edge version with breaking API changes from prior Next.js versions. Before editing `frontend/`, read `frontend/AGENTS.md` for the warning and check `node_modules/next/dist/docs/` for current API docs. Do not rely on training-data knowledge of Next.js conventions.
- The dashboard is now a **multi-page fraud-ops console**, not a single page. Routes live under the `(console)` route group:
  - `src/app/page.tsx` — redirects to `/feed`.
  - `src/app/(console)/layout.tsx` — shell: `<AjnaProvider>` + `<Sidebar>` + `<Topbar>` + `<CopilotDock>` + `<EntityDialog>`.
  - One `page.tsx` per route: `/feed`, `/live`, `/devices`, `/accounts`, `/graph`, `/rings`, `/history`, `/policies`, `/impact`.
- **UI kit:** shadcn/ui components in `src/components/ui/` (Radix-based), shell in `src/components/shell/`, feature components (`identity-graph`, `risk-trajectory`, `risk-card`, `theme-*`) in `src/components/`. Charts use **recharts**. Theming via **next-themes** (default `dark`, toggle in topbar). Class helpers: `clsx` + `tailwind-merge` via `cn()` in `src/lib/utils.ts`.
- **Global state & WebSocket** live in `src/lib/store.tsx` (`AjnaProvider` / `useAjna()`). It owns the single WebSocket connection (auto-reconnect), derives `deviceProfiles`/`accountProfiles`/`stats`, and exposes all actions (`runScenario`, `submitAction`, `submitOutcome`, `togglePolicy`, `updateThreshold`, `loadGraph`, `refreshRings`, `refreshSummary`, `openEntity`, `askCopilot`, …). Types in `src/lib/types.ts`.
- Tailwind v4 is used — configuration is via `postcss.config.mjs`, not `tailwind.config.js`.
- API base + WebSocket URL come from `src/lib/utils.ts` (`API`, `WS_URL`, default `localhost:8000`) — change there if deploying.
- Lint: `npm run lint` (ESLint 9 flat config via `eslint.config.mjs`).

**Console routes (sidebar, grouped Monitor / Investigate / Configure):**
- **Monitor** — `/feed` (Live Risk Feed: real-time case cards + analyst action buttons + outcome labeling), `/live` (Session Monitor), `/devices` (score ≥31, integrity flags + trust badge), `/accounts` (score ≥31)
- **Investigate** — `/graph` (interactive Neo4j identity graph), `/rings` (fraud-ring clusters), `/history` (audit trail / decision log, CSV export)
- **Configure** — `/policies` (live toggle of each signal → `POST /api/v1/policies/{id}`), `/impact` (report summary: precision, exposure blocked, behavioral catches)
- **Copilot dock + entity dialog** are global (mounted in the console layout): the copilot answers grounded questions via `/api/v1/copilot`; clicking an entity opens its learned behavioral profile via `/api/v1/entities/.../profile`.

**Signal categorization in RiskCard:**
- **Device Intelligence** (red): hardware flags, app cloning, no sensors
- **Behavioral** (amber): velocity, OTP/login failures, bot-like timing, cadence variance, deviation-from-self, known-fraud match
- **Identity Network** (indigo): graph-based signals (device farm, ATO, email sharing, subnet)

---

## Backend Notes

- Python 3.9+. Use the venv: `source backend/venv/bin/activate`.
- Dependencies: `fastapi`, `uvicorn`, `redis`, `neo4j`, `google-genai`, `asyncpg`, `httpx`. Install with `pip install -r requirements.txt` or install individually. (Note: scoring uses the newer `from google import genai` client, not `google-generativeai`.)
- `scoring.py` is the **shared scoring engine** — `evaluate_risk()` (full pipeline) and `decide()` (Layer-3 verdict wrapper). All Redis access here is **synchronous**; async callers (`main.py`) invoke it via `asyncio.to_thread(...)`. Also owns the behavioral-baseline helpers (`get_behavioral_profile`, `_update_behavioral_profile`) and known-fraud centroid (`record_known_bad_behavioral`).
- `risk_engine.py` is a **blocking worker** (infinite loop with `xreadgroup`). It no longer holds scoring logic — it imports `scoring.evaluate_risk` and re-exports it for backward compatibility. Run it as a standalone process.
- `threshold_engine.py` — stores scoring thresholds as JSON in Redis (`get_thresholds()` / `save_thresholds()`); `DEFAULT_THRESHOLDS` is the fallback. Includes behavioral-baseline + known-fraud thresholds. Editable live via `/api/v1/thresholds`.
- `graph_engine.py` exports a module-level singleton `graph_engine`. Neo4j connection failure is handled gracefully (returns 0 risk score). Supports `:Email` nodes with `USES_EMAIL` relationships, IP subnet queries, `get_identity_graph()` (cluster nodes/edges), and `get_fraud_rings()` (device/email hubs linked to ≥ N accounts).
- **Behavioral profiles** (Layer 2): per-user EMA mean/variance per feature in Redis `behprofile:user:{id}` (90-day TTL); the known-fraud centroid is `knownbad:behavioral`. Deviation is computed **before** the profile update so a session is never compared against itself.
- **Outcome feedback loop:** `POST /api/v1/cases/{id}/outcome` records ground truth. `confirmed_fraud` bumps the device's `fraud_count` + trust score and folds the case's behavioral vector into the known-fraud centroid — closing the learning loop.
- **Sessions:** `scoring.py` derives a session id from `user+device+time-slot` (no client change needed); session aggregates live in Redis `session:{id}` and drive escalation/repeat signals.
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
- `AjnaSDK.kt` — Singleton entry point; `init()` + `getDeviceId()` + `logEvent(eventType, userId)` and an overload `logEvent(eventType, userId, context: Map<String, Any>?)` for free-form business context (amount, currency, merchant_id…) emitted under a top-level `context` key. `init()` starts passive motion capture; call `stopBehavioralCapture()` from `Activity.onStop/onDestroy` to release sensor listeners.
- `DeviceIntelligence.kt` — Collects device signals; `getPersistentDeviceId()` generates a SHA-256 fingerprint from hardware constants (survives reinstall); `isAppCloned()` checks for parallel-space packages; `fingerprintTampered()` flags hardware-constant tampering.
- `BehavioralIntelligence.kt` — Passive behavioral-biometric collector. Feed it: `recordTouchEvent(MotionEvent)`, `recordKeyEvent(downMs, upMs)` (keystroke dwell/flight, no content captured), `recordSwipe(MotionEvent)` (swipe velocity/curvature), `recordAction()`, and `startMotionCapture(context)`/`stopMotionCapture()` (accel + gyro). `collectBehavioralTelemetry()` snapshots + resets the accumulators before each `logEvent()`.

**Device payload fields:** `os`, `os_version`, `model`, `manufacturer`, `fingerprint`, `rooted`, `emulator`, `vpn`, `gps_spoofed`, `app_tamper`, `debug_mode`, `app_cloned`, `has_sensors`, `fingerprint_tampered`

**Behavioral payload fields (under `"behavioral"` key):**
- *Baseline contract — fixed names/types the backend keys its per-user baseline on:* `tap_cadence_variance`, `touch_pressure_avg`, `touch_area_avg`, `interaction_count`, `has_sensors`
- *Additive features:* keystroke (`key_dwell_avg`, `key_flight_avg`, `key_event_count`), swipe (`swipe_velocity_avg`, `swipe_curvature_avg`, `swipe_count`), device-motion (`motion_accel_variance`, `motion_gyro_variance`, `motion_sample_count`), session timing (`session_hour`, `action_interval_avg`, `action_count`)

**Business context (under `"context"` key):** free-form map (e.g. `amount`, `currency`, `merchant_id`, `role`) — used by the combo penalty, `exposure_blocked` reporting, and the copilot. Never put PII (plaintext email/phone) here.

**Device ID strategy:** Reads `device_id_v2` from SharedPreferences. On first run, computes `SHA-256(ANDROID_ID|BOARD|HARDWARE|MANUFACTURER|MODEL|SERIAL)`. Falls back to a persisted UUID if hardware constants are unavailable. Old `device_id` key (plain UUID) is untouched for backwards compatibility.

---

## What Not To Do

- Do not change risk score thresholds (31/46/61/100) without understanding the full scoring pipeline — thresholds affect category assignment, recommended action, AI explanation triggering, and UI coloring.
- Do not remove the `time.sleep(0.15)` in `simulation_engine.py` — it ensures sequential event arrival on the dashboard.
- Do not store plaintext emails — only accept `email_hash` (SHA-256 of email) in `EventPayload`.
- Do not skip the `source venv/bin/activate` step before running backend — `asyncpg` and `httpx` are installed in the venv only.
