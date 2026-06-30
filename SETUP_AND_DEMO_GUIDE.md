# Ajna — Mobile Device Intelligence & Fraud Risk Accelerator
## Complete Setup, SDK Usage & Live Demo Guide

---

## 1. Prerequisites

Before starting, ensure the following are installed on your machine:

| Tool | Version | Purpose |
|---|---|---|
| Docker Desktop | Latest | Runs Redis, PostgreSQL, Neo4j |
| Python | 3.9+ | Backend API & Risk Engine |
| Node.js & npm | v18+ | Frontend Dashboard |
| Android Studio | Hedgehog 2023.1.1+ | Mobile Demo App (optional) |
| Gemini API Key | — | AI Risk Explanations |

### Installing Docker Desktop (macOS)

Docker Desktop is **required** — it runs all three databases as containers so you don't need to install Redis, Neo4j, or PostgreSQL manually.

1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop/
2. Open the `.dmg` file and drag Docker to your Applications folder.
3. Launch Docker Desktop and wait for the status bar to show **"Docker Desktop is running"**.
4. Verify installation:
   ```bash
   docker --version
   docker compose version
   ```

---

## 2. Infrastructure: Starting All Databases

All three databases are defined in `docker-compose.yml`. A single command pulls the images and starts all services.

```bash
cd /Users/venkat/Documents/traci
docker-compose up -d
```

> `docker-compose up -d` does the following:
> - **Pulls** the official images for PostgreSQL 15, Redis 7, and Neo4j 5 from Docker Hub (first run only).
> - **Starts** all three as background containers (`-d` = detached mode).
> - **Persists data** to named Docker volumes so data survives restarts.

### Service Details & Credentials

#### PostgreSQL (Relational Storage)
| Setting | Value |
|---|---|
| Container | `fraud_postgres` |
| Host | `localhost:5432` |
| Database | `fraud_db` |
| Username | `fraud_admin` |
| Password | `fraud_password` |

#### Redis (Streams & PubSub)
| Setting | Value |
|---|---|
| Container | `fraud_redis` |
| Host | `localhost:6379` |
| Auth | None (no password) |

#### Neo4j (Identity Graph)
| Setting | Value |
|---|---|
| Container | `fraud_neo4j` |
| Bolt (Backend) | `localhost:7687` |
| Browser UI | http://localhost:7474 |
| Username | `neo4j` |
| Password | `fraud_password` |

### Verifying All Services Are Running

```bash
# Check all containers are "Up"
docker-compose ps

# Test Redis connection
docker exec fraud_redis redis-cli ping
# Expected: PONG

# Test PostgreSQL connection
docker exec fraud_postgres psql -U fraud_admin -d fraud_db -c "SELECT 1;"
# Expected: ?column? = 1
```

To verify Neo4j, open http://localhost:7474 in your browser, log in with `neo4j` / `fraud_password`.

### Stopping & Restarting Services

```bash
docker-compose stop          # stop all services (keeps data)
docker-compose down          # stop and remove containers (keeps volumes)
docker-compose down -v       # full reset — wipes all data
```

---

## 3. Backend Setup (FastAPI + Risk Engine)

The backend is **two separate processes** that must both be running simultaneously:

- **FastAPI Server** (`main.py`) — accepts events, manages case state, serves WebSocket to the dashboard.
- **Risk Engine Worker** (`risk_engine.py`) — consumes the Redis Stream, scores events, queries Neo4j, calls Gemini AI.

### Step 1 — Set Up Python Environment

```bash
cd /Users/venkat/Documents/traci/backend
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn redis websockets google-genai neo4j pydantic
```

### Step 2 — Configure Environment Variables

A `.env.sh` file is pre-configured in the backend directory. Source it before starting either process:

```bash
source .env.sh
```

It sets:

```bash
export GEMINI_API_KEY="..."       # AI risk explanations
export NEO4J_URI="bolt://localhost:7687"
export NEO4J_USER="neo4j"
export NEO4J_PASSWORD="fraud_password"
```

> If `GEMINI_API_KEY` is absent, the risk engine falls back to a descriptive mock explanation — the rest of the pipeline works normally.

### Step 3 — Start the Risk Engine Worker (Terminal 1)

```bash
cd /Users/venkat/Documents/traci/backend
source venv/bin/activate && source .env.sh
python risk_engine.py
```

Expected output: `Risk Engine started. Waiting for events...`

### Step 4 — Start the FastAPI Server (Terminal 2)

```bash
cd /Users/venkat/Documents/traci/backend
source venv/bin/activate && source .env.sh
uvicorn main:app --reload --port 8000
```

Expected output: `Uvicorn running on http://0.0.0.0:8000`

**Verify the API is up:**
- Interactive docs: http://localhost:8000/docs
- Health check: http://localhost:8000 → `{"status": "ok", "service": "Ajna"}`

### API Endpoints Reference

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/events` | Ingest a device event (async, fire-and-forget) |
| `POST` | `/api/v1/decide` | Real-time inline decisioning — returns a verdict (ALLOW/REVIEW/CHALLENGE/BLOCK) + trust score in the response |
| `GET` | `/api/v1/entities/{type}/{id}/profile` | Learned behavioral baseline (+ trust history for devices) |
| `POST` | `/api/v1/scenarios/run?scenario=<name>` | Trigger a simulation scenario |
| `POST` | `/api/v1/cases/{case_id}/action` | Submit analyst decision (Allow/Monitor/Challenge/Block) |
| `POST` | `/api/v1/cases/{case_id}/outcome` | Record ground-truth outcome (confirmed_fraud / false_positive / legit) — feeds the learning loop |
| `GET` | `/api/v1/cases` | List all evaluated cases |
| `GET` | `/api/v1/decisions` | Audit log of analyst decisions |
| `GET` | `/api/v1/rings?min_accounts=<n>` | Fraud-ring detection (shared device/email hubs) |
| `POST` | `/api/v1/copilot` | AI fraud-analyst copilot (grounded NL Q&A about a case) |
| `GET` `POST` | `/api/v1/thresholds` | List / update configurable scoring thresholds |
| `GET` | `/api/v1/reports/summary` | Aggregated stats (precision, exposure blocked, behavioral catches…) |
| `WS` | `/ws` | WebSocket stream for real-time console updates |

> **Note:** Cases/decisions are persisted to PostgreSQL when available, with an in-memory cache. If PostgreSQL is down the server falls back to in-memory only (resets on restart). The full endpoint list is in `CLAUDE.md` and the interactive docs at `/docs`.

---

## 4. Frontend Dashboard Setup (Next.js)

```bash
cd /Users/venkat/Documents/traci/frontend
npm install
npm run dev
```

Open the console: **http://localhost:3000** (the root `/` redirects to `/feed`).

The connection indicator in the topbar turns **green** ("Live Stream Active") once the WebSocket connects to the backend. Opening the page while the backend is already running will replay the last 50 evaluated cases immediately so the console is never empty on refresh. The theme defaults to **dark**; toggle light/dark from the topbar.

### Console Layout

The dashboard is a **multi-page fraud-ops console** with a persistent left sidebar (grouped Monitor / Investigate / Configure), a topbar (live KPIs, theme toggle, copilot button), and a global AI **copilot dock** + **entity drill-down dialog**.

```
┌── Sidebar ──┬── Topbar (KPIs · theme · copilot) ───────────────────┐
│  Monitor    │                                                       │
│   Live Feed │   <route content>                                     │
│   Sessions  │                                                       │
│   Devices   │   e.g. /feed → real-time risk cards with categorised  │
│   Accounts  │         signals, Gemini analysis, recommended-action  │
│  Investigate│         badge, analyst action + outcome-labeling      │
│   Graph     │                                                       │
│   Rings     │                                                       │
│   Audit     │                                              [Copilot]│
│  Configure  │                                              [ dock ] │
│   Policies  │                                                       │
│   Impact    │                                                       │
└─────────────┴───────────────────────────────────────────────────────┘
```

**Routes:**

| Route | Shows |
|---|---|
| `/feed` | **Live Risk Feed** — every evaluated event as a risk card (pending/reviewed), analyst actions, outcome labeling |
| `/live` | **Session Monitor** — activity grouped by session |
| `/devices` | Devices with risk score ≥ 31 — integrity flags, linked account count, top signals, trust badge |
| `/accounts` | Accounts with risk score ≥ 31 — linked device count and risk history |
| `/graph` | **Identity Graph** — interactive Neo4j cluster around a device (users / devices / IPs / emails) |
| `/rings` | **Fraud Rings** — clusters of accounts converging on a shared device or email |
| `/history` | **Audit Trail** — chronological log of every analyst decision, with CSV export |
| `/policies` | **Risk Policies** — live enable/disable toggle per signal (broadcasts `POLICY_UPDATED`) |
| `/impact` | **Impact** — report summary: detection precision, exposure blocked, behavioral catches |

**Global tools:** the **Copilot** answers grounded natural-language questions about any case (signals, behavioral deviation, device history). Clicking an entity anywhere opens the **entity dialog** showing its learned behavioral baseline.

---

## 5. Android SDK Usage Guide

The `ajna-sdk` is a native Android Kotlin library that captures real hardware-level signals and sends them to the backend.

### Opening the Demo App in Android Studio

The SDK project at `sdk/` is a complete, Gradle-based Android project.

1. Open Android Studio → **File → Open** → select `/Users/venkat/Documents/traci/sdk/`
2. Android Studio finds `settings.gradle.kts`, downloads Gradle 8.6, and syncs the project.
3. Select the **`demo-app`** run configuration and press **Run** on an emulator or physical device.

The demo app connects to `http://10.0.2.2:8000` — the Android emulator's standard alias for the Mac's `localhost`. Ensure the backend is running before tapping buttons.

### Integrating the SDK into Another Android Project

1. Copy `sdk/ajna-sdk/` into your Android project root.
2. In your root `settings.gradle.kts`:
   ```kotlin
   include(":ajna-sdk")
   ```
3. In your app module's `build.gradle.kts`:
   ```kotlin
   dependencies {
       implementation(project(":ajna-sdk"))
   }
   ```

### Initialization

Initialize once in `Application.onCreate()` or your launcher `Activity.onCreate()`. The SDK is a Kotlin singleton (`object`) — call `init()` once, then `logEvent()` anywhere:

```kotlin
import com.ajna.sdk.AjnaSDK

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Initialize once — persists a stable device_id across sessions
        AjnaSDK.init(
            context = this,
            key = "your-api-key",
            url = "http://10.0.2.2:8000/api/v1/events"   // emulator → localhost
        )
    }
}
```

### Logging Events

Call `logEvent(eventType, userId)` at critical journey checkpoints. The SDK automatically bundles the full device telemetry payload with every call:

```kotlin
// Authentication
AjnaSDK.logEvent("signup",           userId)
AjnaSDK.logEvent("login",            userId)
AjnaSDK.logEvent("otp_failure",      userId)
AjnaSDK.logEvent("login_failure",    userId)
AjnaSDK.logEvent("account_recovery", userId)

// Financial
AjnaSDK.logEvent("wallet_transfer",  userId)
AjnaSDK.logEvent("payment_attempt",  userId)
AjnaSDK.logEvent("referral_claim",   userId)
AjnaSDK.logEvent("checkout",         userId)
```

### What the SDK Detects Automatically

Every event payload includes the following device intelligence signals, collected from real Android APIs — no configuration required:

| Signal | Method | What It Detects |
|---|---|---|
| `rooted` | Checks for `su` binary in common paths | Device has been rooted |
| `emulator` | Inspects `Build.FINGERPRINT`, `Build.MODEL`, hardware properties | App is running in an Android emulator |
| `vpn` | Scans active `NetworkInterface` names for `tun`/`ppp`/`pptp` | VPN or proxy is active |
| `gps_spoofed` | Reads `Settings.Secure.ALLOW_MOCK_LOCATION` | Mock location injection is enabled |
| `app_tamper` | Checks `PackageManager` installer source | App was not installed from the Play Store |
| `debug_mode` | Checks `ApplicationInfo.FLAG_DEBUGGABLE` | App is running a debug build |
| `app_cloned` | Inspects process name / data path for parallel-space packages | App is running in a clone/dual-space environment |
| `fingerprint_tampered` | Compares hardware constants against the persisted fingerprint | Device hardware identifiers have been spoofed |

### Behavioral Biometrics (Layer 1 → learned baseline)

`BehavioralIntelligence` passively captures behavioral biometrics that the backend uses to learn each user's *normal* and flag deviation-from-self (possible account takeover). Wire these into your UI, then call `collectBehavioralTelemetry()` before `logEvent()`:

```kotlin
// In Activity.onCreate (or once per session): start passive motion capture
AjnaSDK.init(this, "your-api-key", "http://10.0.2.2:8000/api/v1/events")  // starts motion capture

// On user interactions:
BehavioralIntelligence.recordTouchEvent(motionEvent)        // touch pressure / size / cadence
BehavioralIntelligence.recordKeyEvent(downTimeMs, upTimeMs) // keystroke dwell + flight (no content)
BehavioralIntelligence.recordSwipe(motionEvent)             // swipe velocity + path curvature
BehavioralIntelligence.recordAction()                       // pacing of discrete actions

// On Activity.onStop/onDestroy: release accelerometer + gyroscope listeners
AjnaSDK.stopBehavioralCapture()
```

Captured features: touch cadence/pressure/size, keystroke dwell/flight, swipe velocity/curvature, device-motion (accelerometer + gyroscope variance), and session timing. No typed content or key identity is ever captured.

### Attaching Business Context

Pass free-form business context with any event so the engine can apply combo penalties, compute *exposure blocked*, and ground the copilot. **Never put PII here** — hash any identifiers first.

```kotlin
AjnaSDK.logEvent("payment_attempt", userId, mapOf(
    "amount" to 4999,
    "currency" to "USD",
    "merchant_id" to "m_8842"
))
```

---

## 6. Live Demo Setup & Execution

### Quick Pre-Demo Checklist

```
[ ] docker-compose ps           →  3 containers: Up
[ ] Terminal 1: risk_engine.py  →  "Risk Engine started. Waiting for events..."
[ ] Terminal 2: uvicorn         →  "Uvicorn running on http://0.0.0.0:8000"
[ ] http://localhost:8000       →  {"status": "ok"}
[ ] http://localhost:3000       →  Dashboard loads, header indicator = green
[ ] http://localhost:7474       →  Neo4j Browser accessible (optional)
```

---

### Demo Scenario A: Web-Based Simulation (No Phone Needed)

Best for remote audiences or when no physical device is available.

1. Open the Dashboard at **http://localhost:3000**.
2. In the **Simulation Engine** panel (left column), click any scenario:

| Scenario | What It Simulates | Key Signals to Point Out |
|---|---|---|
| **Emulator Farm** | 25 accounts created from one emulator device | "Emulator detected" + Neo4j: "Device linked to 25 accounts (Farm suspected)" → FRAUD |
| **OTP Attack** | 8 rapid OTP failures on one account | OTP velocity counter hits critical threshold → "Brute-force attack" FRAUD |
| **Referral Abuse** | 1 device claims referrals for 10 accounts | "Referral abuse: 10 claims from this device in 5 min" → FRAUD |
| **Rooted Wallet** | High-value wallet transfer from a rooted device | "Rooted device + high-value action on compromised device" → FRAUD |
| **GPS Spoofing** | Login from a spoofed/mock GPS location | "GPS location spoofed" → SUSPICIOUS / FRAUD depending on combo signals |
| **Account Sharing** | 1 user logs in from 4 different devices | Neo4j: "User active on 4 devices (ATO risk)" → SUSPICIOUS |
| **Account Takeover** | Credential stuffing: 1 user + 5 devices, repeated login failures | Login velocity + Neo4j ATO flag → FRAUD |
| **Checkout Fraud** | Rooted device + VPN attempting wallet transfer + payment | Three-signal combo: rooted + VPN + high-value action → FRAUD, score 65+ |

3. **Walk through a Risk Card:**
   - **Header row** — Case ID, risk category badge, recommended action badge (e.g., `→ Block`), score out of 100.
   - **Signal groups** — Reasons are grouped as **Device Intelligence** (hardware flags), **Behavioral** (velocity patterns), and **Identity Network** (Neo4j graph signals). Each group has a distinct colour and icon.
   - **Gemini AI Analysis** — Two-sentence explanation: what fraud pattern this is, what business impact it poses, and why the recommended action was chosen.
   - **Analyst Actions** — Click **Allow**, **Monitor**, **Challenge**, or **Block**. The button shows a spinner while the decision is POSTed to the backend. Once confirmed, the buttons are replaced by a "Reviewed by analyst_01 — BLOCKED" banner.

4. **Switch tabs to tell the full story:**
   - **High-Risk Devices** — After Emulator Farm, show the single device with 25 linked accounts and the EMULATOR flag badge.
   - **High-Risk Accounts** — After Account Takeover, show accounts linked to multiple devices.
   - **Audit Trail** — Show the chronological log of every analyst decision — case ID, action taken, risk score, event type, account ID.

5. **Risk Trend Chart** — Point to the SVG chart in the left panel. Safe (green), Suspicious (amber), and Fraud (red) lines update every 5 seconds, showing the pattern of attacks as they arrive.

---

### Demo Scenario B: Physical Mobile Demo (Real Hardware Signals)

Best for proving the SDK captures genuine device signals, not just synthetic data.

1. Open Android Studio → **File → Open** → select `sdk/`.
2. Build and run the **`demo-app`** module on an Android Emulator or Physical Device.
3. Tap any button. The full pipeline runs:

```
[Android App]
    → AjnaSDK.logEvent()
    → POST /api/v1/events  (real device telemetry bundled)
    → Redis Stream
    → Risk Engine  (device signals scored, Neo4j updated, Gemini called)
    → Redis PubSub
    → WebSocket broadcast
    → [Dashboard — Live Risk Feed]
```

**Scenarios to demonstrate:**

| What to do | What the dashboard shows |
|---|---|
| Run on Android Studio Emulator, tap **Trigger Signup** | "Emulator/virtual device detected" signal, FRAUD risk card |
| Run on a rooted device, tap **Wallet Transfer** | "Rooted device detected" + "High-value action on compromised device" |
| Tap **Trigger Login** on both the emulator AND a physical phone using the same `mockUserId` | Neo4j detects the multi-device pattern → "User active on 2 devices (ATO risk)" |
| Tap **Trigger OTP Failure** 6+ times rapidly | OTP velocity alert: "Critical OTP velocity: 6 failures in 2 min — brute-force attack" |

---

## 7. Neo4j Identity Graph — Exploring the Data

During a demo you can show the live Neo4j graph to visually reinforce the identity intelligence layer.

1. Open the Neo4j Browser: **http://localhost:7474**
2. Login: `neo4j` / `fraud_password`
3. See the full identity graph (all devices, users, IPs and their relationships):
   ```cypher
   MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 100
   ```
4. After running the **Emulator Farm** scenario, query the device farm:
   ```cypher
   MATCH (u:User)-[:LOGGED_IN_FROM]->(d:Device)
   WITH d, count(u) AS account_count
   WHERE account_count > 2
   RETURN d.id AS device, account_count
   ORDER BY account_count DESC
   ```
5. After running the **Account Takeover** scenario, find multi-device accounts:
   ```cypher
   MATCH (u:User)-[:LOGGED_IN_FROM]->(d:Device)
   WITH u, count(d) AS device_count
   WHERE device_count > 2
   RETURN u.id AS user, device_count
   ORDER BY device_count DESC
   ```

---

## 8. Risk Scoring Reference

| Score Range | Category | Recommended Action |
|---|---|---|
| 0 – 30 | **Safe** | Allow |
| 31 – 45 | **Suspicious** | Monitor |
| 46 – 60 | **Suspicious** | Challenge |
| 61 – 100 | **Fraud** | Block |

**Signal weights (key signals):**

| Signal | Points | Source |
|---|---|---|
| Emulator detected | +35 | SDK / device flags |
| GPS location spoofed | +35 | SDK / device flags |
| Rooted device | +30 | SDK / device flags |
| High-value action on compromised device (combo) | +25 | Risk engine |
| App integrity check failed | +25 | SDK / device flags |
| OTP brute-force (≥6 failures / 2 min) | +65 | Behavioral velocity |
| Device linked to >5 accounts (farm) | +50 | Neo4j graph |
| Behavior deviates from this user's baseline (≥3σ; +25 more at ≥6σ) | +35 → +60 | Learned behavioral baseline (Layer 2) |
| Matches known-fraud behavioral signature (≥0.85 similar) | +30 | Learned known-fraud centroid (Layer 2) |
| Debug mode active | +15 | SDK / device flags |
| VPN active | +10 | SDK / device flags |
| Referral abuse (≥5 claims / 5 min) | +45 | Behavioral velocity |

> Signal weights are configurable at runtime via `POST /api/v1/thresholds` (and from the **Policies** page). See `backend/threshold_engine.py` for the full default set.

---

## 9. Troubleshooting

| Issue | Fix |
|---|---|
| Dashboard shows "Connecting…" | Ensure `uvicorn main:app` is running and Redis is up |
| Risk cards don't appear | Ensure `risk_engine.py` is running in a separate terminal |
| "AI Explanation temporarily unavailable" | Check `GEMINI_API_KEY` is exported in the risk engine terminal |
| Neo4j graph not updating | Check `NEO4J_PASSWORD` env var matches `fraud_password` |
| Docker containers won't start | Ensure Docker Desktop is running first |
| Cases/decisions gone after restart | Cases persist to PostgreSQL when it's up; if the `fraud_postgres` container is down the server falls back to in-memory only and resets on restart — re-run scenarios to repopulate |
| Copilot replies "Couldn't reach the copilot" | Ensure the FastAPI server is running and reachable at `localhost:8000`; check `GEMINI_API_KEY` for full (non-mock) answers |
| Android Studio can't sync the SDK project | Ensure Android Studio version is Hedgehog 2023.1.1 or later; check internet access for Gradle download |
| Demo app can't reach backend | Ensure the backend is running; emulator uses `10.0.2.2` for host machine's `localhost` |
| Analyst action buttons stay loading | Check browser console — backend may have restarted and lost the case from memory |
