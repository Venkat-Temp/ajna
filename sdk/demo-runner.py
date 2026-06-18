#!/usr/bin/env python3
"""
Ajna Demo Runner — interactive scenario automation via ADB + UIAutomator
Usage:
  python sdk/demo-runner.py list
  python sdk/demo-runner.py run otp_attack
  python sdk/demo-runner.py run emulator_farm --record
  python sdk/demo-runner.py sequence rooted_wallet checkout_fraud
  python sdk/demo-runner.py fullshow
  python sdk/demo-runner.py reset
  python sdk/demo-runner.py status

How it works:
  Each scenario launches the interactive app screen, then this script types
  into the real EditText fields and taps the real buttons via ADB input commands.
  The emulator shows a real user typing and submitting — events fire on each tap.
"""

import subprocess
import sys
import shutil
import time
import os
import signal
import re
import xml.etree.ElementTree as ET
import tempfile

APP_PACKAGE     = "com.scalex.frauddemo"
RUNNER_ACTIVITY = f"{APP_PACKAGE}/.DemoRunnerActivity"
INTENT_ACTION   = f"{APP_PACKAGE}.RUN_SCENARIO"
BACKEND_URL     = "http://localhost:8000"
UI_DUMP_PATH    = "/sdcard/ajna_ui.xml"

# Per-scenario step definitions for the Python script.
# Each step describes what to type and which button to tap.
# field keys match android:contentDescription values in the layouts.
SCENARIO_SCRIPTS = {
    "emulator_farm": {
        "steps": [{"tap": "action_button", "wait": 0.9}] * 25,
        "description": "Tap 'Create Account' 25 times — each creates a new account"
    },
    "otp_attack": {
        "steps": [
            {"type": {"otp_input": "000000"}, "tap": "action_button", "wait": 1.8}
        ] * 8,
        "description": "Type wrong OTP and tap Verify — 8 times"
    },
    "referral_abuse": {
        "steps": [
            {"type": {"referral_input": "AJNA500"}, "tap": "action_button", "wait": 1.0}
        ] * 10,
        "description": "Fill referral code and tap Create Account — 10 times"
    },
    "rooted_wallet": {
        "steps": [
            # Step 1: Login
            {"type": {"username_input": "wallet_victim", "password_input": "Pass1234"},
             "tap": "action_button", "wait": 2.0},
            # Step 2: Wallet transfer
            {"type": {"recipient_input": "attacker@upi", "amount_input": "15000"},
             "tap": "action_button", "wait": 2.0},
            # Step 3: Payment confirmation
            {"tap": "action_button", "wait": 2.0},
        ],
        "description": "Login → fill wallet transfer → confirm payment (all with rooted=true)"
    },
    "gps_spoofing": {
        "steps": [
            {"type": {"username_input": "geo_victim", "password_input": "Pass1234"},
             "tap": "action_button", "wait": 2.0},
            {"type": {"username_input": "geo_victim", "password_input": "NewPass"},
             "tap": "action_button", "wait": 2.0},
        ],
        "description": "Login twice with spoofed GPS location"
    },
    "account_sharing": {
        "steps": [
            {"type": {"username_input": "shared_user", "password_input": "Pass1234"},
             "tap": "action_button", "wait": 2.0},
        ] * 4,
        "description": "Same user logs in from 4 different devices"
    },
    "account_takeover": {
        "steps": (
            [
                {"type": {"username_input": "ato_victim", "password_input": "attempt"},
                 "tap": "action_button", "wait": 1.0},
            ] * 3
        ) * 5,
        "description": "Credential stuffing: 1 user, 5 devices, login failures"
    },
    "checkout_fraud": {
        "steps": [
            {"type": {"recipient_input": "fraud@upi", "amount_input": "8499"},
             "tap": "action_button", "wait": 2.0},
            {"tap": "action_button", "wait": 2.0},
            {"tap": "action_button", "wait": 2.0},
        ],
        "description": "Wallet transfer → payment → checkout (rooted + VPN)"
    },
    "bot_farm": {
        "steps": [{"tap": "action_button", "wait": 0.4}] * 10,
        "description": "Tap 'Register Next Bot' 10 times — bot-like timing flags"
    },
    "app_cloning_abuse": {
        "steps": [{"tap": "action_button", "wait": 1.0}] * 5,
        "description": "Create 5 accounts from a cloned app instance"
    },
}


# ── ADB helpers ──────────────────────────────────────────────────────────────

def adb(*args, capture=False, check=False):
    cmd = ["adb"] + list(args)
    if capture:
        r = subprocess.run(cmd, capture_output=True, text=True)
        return r.stdout.strip()
    subprocess.run(cmd, check=check)


def check_adb():
    if not shutil.which("adb"):
        print("ERROR: 'adb' not found. Install Android SDK Platform Tools.")
        sys.exit(1)


def emulator_running():
    out = adb("devices", capture=True)
    return any("emulator" in l and "device" in l for l in out.splitlines())


# ── UIAutomator element finder ────────────────────────────────────────────────

def dump_ui():
    """Dump the current UI hierarchy from the emulator into a temp file."""
    adb("shell", "uiautomator", "dump", "--compressed", UI_DUMP_PATH)
    time.sleep(0.4)
    local = tempfile.mktemp(suffix=".xml")
    adb("pull", UI_DUMP_PATH, local)
    return local


def find_element(xml_path: str, content_desc: str):
    """Return (cx, cy) center of first node matching content-description."""
    try:
        tree = ET.parse(xml_path)
    except ET.ParseError:
        return None
    for node in tree.iter("node"):
        if node.get("content-desc", "") == content_desc:
            bounds = node.get("bounds", "")
            m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
            if m:
                cx = (int(m.group(1)) + int(m.group(3))) // 2
                cy = (int(m.group(2)) + int(m.group(4))) // 2
                return cx, cy
    return None


def tap_element(content_desc: str, retries=3) -> bool:
    """Find an element by content-description and tap its center."""
    for attempt in range(retries):
        xml = dump_ui()
        pos = find_element(xml, content_desc)
        os.unlink(xml)
        if pos:
            adb("shell", "input", "tap", str(pos[0]), str(pos[1]))
            return True
        time.sleep(0.5)
    print(f"  ⚠  Element not found: '{content_desc}' (tried {retries}x)")
    return False


def type_into(content_desc: str, text: str) -> bool:
    """Tap an EditText field and type text into it."""
    if not tap_element(content_desc):
        return False
    time.sleep(0.3)
    # Select all existing text and delete
    adb("shell", "input", "keyevent", "KEYCODE_CTRL_A")
    time.sleep(0.1)
    adb("shell", "input", "keyevent", "KEYCODE_DEL")
    time.sleep(0.1)
    # Android adb input text doesn't handle spaces well — encode them
    encoded = text.replace(" ", "%s").replace("&", "\\&")
    adb("shell", "input", "text", encoded)
    time.sleep(0.2)
    return True


# ── Scenario runner ────────────────────────────────────────────────────────────

def launch_scenario(scenario_id: str):
    adb(
        "shell", "am", "start",
        "-n", RUNNER_ACTIVITY,
        "-a", INTENT_ACTION,
        "--es", "SCENARIO", scenario_id
    )
    print("   Waiting for app to load…")
    time.sleep(2.5)


def run_step(step: dict, step_num: int, total: int):
    print(f"   Step {step_num}/{total}", end="", flush=True)

    # Type into any fields first
    for field_desc, text in step.get("type", {}).items():
        if type_into(field_desc, text):
            print(f"  typed '{text}' → {field_desc}", end="", flush=True)
        time.sleep(0.3)

    # Tap the action button
    if tap_element(step["tap"]):
        print("  ✓ tapped", flush=True)
    else:
        print("  ✗ button not found", flush=True)

    time.sleep(step.get("wait", 1.5))


def run_scenario(scenario_id: str, record: bool = False):
    if scenario_id not in SCENARIO_SCRIPTS:
        print(f"Unknown scenario '{scenario_id}'. Run 'list' to see options.")
        sys.exit(1)

    script = SCENARIO_SCRIPTS[scenario_id]
    steps  = script["steps"]
    total  = len(steps)
    print(f"\n▶  {scenario_id}  ({total} steps)")
    print(f"   {script['description']}\n")

    check_adb()
    if not emulator_running():
        print("ERROR: No Android emulator detected. Start one via Android Studio.")
        sys.exit(1)

    rec_proc, rec_remote = (None, None)
    if record:
        rec_remote = f"/sdcard/ajna_{scenario_id}.mp4"
        print("   Recording screen…")
        rec_proc = subprocess.Popen(
            ["adb", "shell", "screenrecord", rec_remote],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        time.sleep(0.8)

    launch_scenario(scenario_id)

    for i, step in enumerate(steps):
        run_step(step, i + 1, total)

    if rec_proc and rec_remote:
        rec_proc.send_signal(signal.SIGINT)
        time.sleep(1.5)
        local = f"ajna_{scenario_id}.mp4"
        adb("pull", rec_remote, local)
        print(f"\n   Recording saved → {local}")

    print(f"\n   ✓ {scenario_id} complete — check dashboard at http://localhost:3000")


# ── Other commands ────────────────────────────────────────────────────────────

def cmd_list():
    print("\nAvailable scenarios:\n")
    print(f"  {'ID':<22} {'STEPS':<7} DESCRIPTION")
    print("  " + "─" * 65)
    for sid, info in SCENARIO_SCRIPTS.items():
        n = len(info["steps"])
        print(f"  {sid:<22} {n:<7} {info['description'][:42]}")
    print()


def cmd_status():
    check_adb()
    out = adb("devices", capture=True)
    print(f"\nADB:\n  {out}")
    print("  " + ("✓ emulator detected" if emulator_running() else "✗ no emulator"))
    try:
        r = subprocess.run(
            ["curl", "-s", "--connect-timeout", "2", f"{BACKEND_URL}/"],
            capture_output=True, text=True
        )
        print(f"\nBackend:\n  {'✓ reachable' if r.returncode == 0 else '✗ not reachable'}")
    except Exception:
        print("\nBackend:\n  ✗ curl not available")


def cmd_reset():
    print("Clearing Redis trust + rate-limit keys…")
    for pattern in ("trust:*", "ratelimit:*"):
        r = subprocess.run(
            ["docker", "exec", "traci-redis-1", "redis-cli", "--scan", "--pattern", pattern],
            capture_output=True, text=True
        )
        keys = [k for k in r.stdout.splitlines() if k]
        if keys:
            subprocess.run(["docker", "exec", "traci-redis-1", "redis-cli", "del"] + keys)
            print(f"  Deleted {len(keys)} key(s) matching {pattern}")
    print("  Done — next run starts fresh")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd  = sys.argv[1]
    rest = sys.argv[2:]

    if cmd == "list":
        cmd_list()

    elif cmd == "run":
        ids    = [a for a in rest if not a.startswith("--")]
        record = "--record" in rest
        if not ids:
            print("Usage: demo-runner.py run <scenario_id> [--record]")
            sys.exit(1)
        run_scenario(ids[0], record=record)

    elif cmd == "sequence":
        ids    = [a for a in rest if not a.startswith("--")]
        record = "--record" in rest
        for sid in ids:
            run_scenario(sid, record=record)
            time.sleep(2)

    elif cmd == "fullshow":
        record = "--record" in rest
        for sid in SCENARIO_SCRIPTS:
            run_scenario(sid, record=record)
            time.sleep(3)

    elif cmd == "reset":
        cmd_reset()

    elif cmd == "status":
        cmd_status()

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
