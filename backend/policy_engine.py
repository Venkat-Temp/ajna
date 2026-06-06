import redis
import json
import logging
import os

logger = logging.getLogger(__name__)

r = redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)

POLICIES_KEY = "fraud_policies"

DEFAULT_POLICIES = [
    {"id": "p_rooted",      "name": "Rooted Device",        "signal": "device.rooted",       "operator": "eq", "value": True,  "score_delta": 30, "enabled": True},
    {"id": "p_emulator",    "name": "Emulator Detected",    "signal": "device.emulator",     "operator": "eq", "value": True,  "score_delta": 35, "enabled": True},
    {"id": "p_vpn",         "name": "VPN Usage",            "signal": "device.vpn",          "operator": "eq", "value": True,  "score_delta": 10, "enabled": True},
    {"id": "p_gps_spoof",   "name": "GPS Spoofed",          "signal": "device.gps_spoofed",  "operator": "eq", "value": True,  "score_delta": 35, "enabled": True},
    {"id": "p_app_tamper",  "name": "App Tampered",         "signal": "device.app_tamper",   "operator": "eq", "value": True,  "score_delta": 25, "enabled": True},
    {"id": "p_debug_mode",  "name": "Debug Mode",           "signal": "device.debug_mode",   "operator": "eq", "value": True,  "score_delta": 15, "enabled": True},
    {"id": "p_app_cloned",  "name": "App Cloned",           "signal": "device.app_cloned",   "operator": "eq", "value": True,  "score_delta": 25, "enabled": True},
    {"id": "p_no_sensors",  "name": "No Hardware Sensors",  "signal": "device.has_sensors",  "operator": "eq", "value": False, "score_delta": 10, "enabled": True},
]


def get_policies():
    """Load policies from Redis; seed defaults on first call."""
    raw = r.get(POLICIES_KEY)
    if raw:
        return json.loads(raw)
    r.set(POLICIES_KEY, json.dumps(DEFAULT_POLICIES))
    return DEFAULT_POLICIES


def save_policies(policies):
    r.set(POLICIES_KEY, json.dumps(policies))


def evaluate_policies(event_data):
    """Evaluate all enabled policies against event_data. Returns (score_delta, reasons)."""
    policies = get_policies()
    total_delta = 0
    reasons = []

    device = event_data.get('device', {}) or {}

    for policy in policies:
        if not policy.get('enabled'):
            continue

        signal = policy.get('signal', '')
        value = policy.get('value')
        operator = policy.get('operator', 'eq')
        score_delta = int(policy.get('score_delta', 0))

        # Resolve the actual field value from event_data using the signal namespace
        actual = None
        if signal.startswith('device.'):
            actual = device.get(signal[len('device.'):])
        elif signal.startswith('event.'):
            actual = event_data.get(signal[len('event.'):])

        if actual is None:
            continue

        matched = False
        if operator == 'eq':
            matched = actual == value
        elif operator == 'gt':
            try:
                matched = float(actual) > float(value)
            except (TypeError, ValueError):
                pass
        elif operator == 'lt':
            try:
                matched = float(actual) < float(value)
            except (TypeError, ValueError):
                pass

        if matched:
            total_delta += score_delta
            reasons.append(policy.get('name', signal))

    return total_delta, reasons
