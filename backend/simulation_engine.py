import time
import uuid
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter
import redis

router = APIRouter()
r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
executor = ThreadPoolExecutor(max_workers=4)


def inject_event(event_type, user_id, device_id, device_flags=None, ip="49.x.x.x"):
    if not device_flags:
        device_flags = {}

    event = {
        "event_id": f"sim_{uuid.uuid4().hex[:8]}",
        "user_id": user_id,
        "device_id": device_id,
        "event_type": event_type,
        "ip": ip,
        "timestamp": str(int(time.time() * 1000)),
        "device": {
            "rooted": device_flags.get("rooted", False),
            "emulator": device_flags.get("emulator", False),
            "vpn": device_flags.get("vpn", False),
            "gps_spoofed": device_flags.get("gps_spoofed", False),
            "app_tamper": device_flags.get("app_tamper", False),
            "debug_mode": device_flags.get("debug_mode", False),
        }
    }
    r.xadd('fraud_events', {'payload': json.dumps(event)})
    time.sleep(0.15)  # sequential arrival on dashboard


def run_scenario_sync(scenario: str):
    base_user = f"usr_sim_{uuid.uuid4().hex[:4]}"
    base_device = f"dev_sim_{uuid.uuid4().hex[:4]}"

    if scenario == "emulator_farm":
        # 25 fake accounts created from one emulator — device farm pattern
        for i in range(25):
            inject_event("signup", f"{base_user}_{i}", base_device, {"emulator": True})

    elif scenario == "otp_attack":
        # Brute-force: 8 OTP failures in rapid succession
        for _ in range(8):
            inject_event("otp_failure", base_user, base_device)

    elif scenario == "referral_abuse":
        # 10 referral claims from the same device across different accounts
        for i in range(10):
            inject_event("referral_claim", f"{base_user}_ref_{i}", base_device)

    elif scenario == "rooted_wallet":
        # Rooted device attempting a wallet transfer
        inject_event("wallet_transfer", base_user, base_device, {"rooted": True})

    elif scenario == "gps_spoofing":
        # Spoofed GPS on login (geo-inconsistency indicator)
        inject_event("login", base_user, base_device, {"gps_spoofed": True})

    elif scenario == "account_sharing":
        # One user logging in from 4 different devices — Neo4j ATO detection
        for i in range(4):
            inject_event("login", base_user, f"{base_device}_{i}")

    elif scenario == "account_takeover":
        # Credential stuffing: 1 user hitting 5 devices, each with login failures
        # Triggers Neo4j ATO risk (user on >3 devices) + login velocity
        for i in range(5):
            dev = f"{base_device}_ato_{i}"
            inject_event("login", base_user, dev)
            inject_event("login_failure", base_user, dev)
            inject_event("login_failure", base_user, dev)

    elif scenario == "checkout_fraud":
        # Rooted device + VPN attempting high-value transactions
        # Triggers: rooted (+30) + vpn (+10) + high-value on compromised device (+25) = FRAUD
        flags = {"rooted": True, "vpn": True}
        inject_event("wallet_transfer", base_user, base_device, flags)
        inject_event("payment_attempt", base_user, base_device, flags)
        inject_event("checkout", base_user, base_device, flags)


@router.post("/run")
async def run_scenario(scenario: str):
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, run_scenario_sync, scenario)
    return {"status": "success", "scenario": scenario, "message": "Synthetic events injected."}
