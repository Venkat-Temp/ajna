import redis
import json
import time
import uuid
import os
from google import genai
from graph_engine import graph_engine

r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

STREAM_KEY = 'fraud_events'
GROUP_NAME = 'risk_evaluators'
CONSUMER_NAME = 'worker_1'

HIGH_VALUE_EVENTS = {'wallet_transfer', 'payment_attempt', 'withdrawal', 'checkout'}
REFERRAL_EVENTS = {'referral_claim', 'promo_redeem'}


def setup_stream():
    try:
        r.xgroup_create(STREAM_KEY, GROUP_NAME, id='0', mkstream=True)
        print(f"Created consumer group {GROUP_NAME} on stream {STREAM_KEY}")
    except redis.exceptions.ResponseError as e:
        if "BUSYGROUP" in str(e):
            print(f"Consumer group {GROUP_NAME} already exists.")
        else:
            raise e


def evaluate_risk(event_data):
    score = 0
    reasons = []

    device = event_data.get('device', {}) or {}
    user_id = event_data.get('user_id')
    device_id = event_data.get('device_id')
    event_type = event_data.get('event_type', '')

    # ── Device Intelligence ───────────────────────────────────────────────────
    if device.get('rooted'):
        score += 30
        reasons.append("Rooted device detected")

    if device.get('emulator'):
        score += 35
        reasons.append("Emulator/virtual device detected")

    if device.get('vpn'):
        score += 10
        reasons.append("VPN/proxy active")

    if device.get('gps_spoofed'):
        score += 35
        reasons.append("GPS location spoofed")

    if device.get('app_tamper'):
        score += 25
        reasons.append("App integrity check failed (tampered)")

    if device.get('debug_mode'):
        score += 15
        reasons.append("App running in debug mode")

    # ── High-Value Event on Risky Device (combo penalty) ─────────────────────
    device_is_risky = device.get('rooted') or device.get('emulator') or device.get('gps_spoofed') or device.get('app_tamper')
    if event_type in HIGH_VALUE_EVENTS and device_is_risky:
        score += 25
        reasons.append(f"High-value action ({event_type}) on compromised device")

    # ── Behavioral Intelligence ───────────────────────────────────────────────
    if user_id:
        otp_key = f"vel:otp:{user_id}"
        login_key = f"vel:login:{user_id}"
        general_key = f"vel:user:{user_id}"

        r.incr(general_key)
        if r.ttl(general_key) == -1:
            r.expire(general_key, 60)

        if event_type == 'otp_failure':
            otp_count = int(r.incr(otp_key) or 0)
            if r.ttl(otp_key) == -1:
                r.expire(otp_key, 120)

            score += 10
            if otp_count >= 6:
                score += 55
                reasons.append(f"Critical OTP velocity: {otp_count} failures in 2 min — brute-force attack")
            elif otp_count >= 3:
                score += 30
                reasons.append(f"High OTP velocity: {otp_count} failures in 2 min")
            else:
                reasons.append(f"OTP failure (#{otp_count} in window)")

        if event_type == 'login_failure':
            login_count = int(r.incr(login_key) or 0)
            if r.ttl(login_key) == -1:
                r.expire(login_key, 120)

            score += 8
            if login_count >= 5:
                score += 30
                reasons.append(f"Credential stuffing suspected: {login_count} login failures in 2 min")
            elif login_count >= 3:
                score += 15
                reasons.append(f"Repeated login failures: {login_count} in 2 min")

        if event_type in REFERRAL_EVENTS and device_id:
            ref_key = f"vel:referral:{device_id}"
            ref_count = int(r.incr(ref_key) or 0)
            if r.ttl(ref_key) == -1:
                r.expire(ref_key, 300)

            score += 10
            if ref_count >= 5:
                score += 35
                reasons.append(f"Referral abuse: {ref_count} claims from this device in 5 min")
            elif ref_count >= 2:
                score += 15
                reasons.append(f"Multiple referral claims: {ref_count} from same device")

    # ── Graph Intelligence (Neo4j) ────────────────────────────────────────────
    ip_address = event_data.get('ip')
    if user_id and device_id:
        graph_engine.update_identity_graph(user_id, device_id, ip_address)
        graph_score, graph_reasons = graph_engine.get_graph_risk(user_id, device_id)
        if graph_score > 0:
            score += graph_score
            reasons.extend(graph_reasons)

    score = min(score, 100)

    # ── Risk Category ─────────────────────────────────────────────────────────
    if score >= 61:
        category = "Fraud"
    elif score >= 31:
        category = "Suspicious"
    else:
        category = "Safe"

    # ── Structured Recommended Action (always present, not dependent on AI) ───
    if score >= 61:
        recommended_action = "Block"
    elif score >= 46:
        recommended_action = "Challenge"
    elif score >= 31:
        recommended_action = "Monitor"
    else:
        recommended_action = "Allow"

    # ── Gemini AI Explanation (Suspicious and Fraud only) ─────────────────────
    explanation = "Device and behavioral signals are within normal parameters. No action required."
    if score >= 31:
        try:
            api_key = os.environ.get("GEMINI_API_KEY")
            if api_key:
                client = genai.Client(api_key=api_key)
                prompt = (
                    f"You are a fraud operations AI analyst. A mobile session was flagged as "
                    f"'{category}' with a fraud risk score of {score}/100. "
                    f"Detected signals: {', '.join(reasons)}. "
                    f"Write exactly 2 sentences: first explain what fraudulent pattern this indicates "
                    f"and what business impact it could cause; then state the recommended action "
                    f"({recommended_action}) and the specific reason why."
                )
                response = client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=prompt,
                )
                explanation = response.text.strip()
            else:
                explanation = (
                    f"[Mock AI] This {category.lower()} session (score {score}/100) shows: "
                    f"{'; '.join(reasons[:3])}. "
                    f"Recommended action: {recommended_action} — "
                    f"{'Immediate action required to prevent financial loss.' if score >= 61 else 'Monitor closely for escalation.'}"
                )
        except Exception as e:
            print(f"Gemini error: {e}")
            explanation = (
                f"Risk signals detected: {', '.join(reasons[:3])}. "
                f"Recommended: {recommended_action}."
            )

    return {
        "case_id": f"case_{uuid.uuid4().hex[:8]}",
        "event_id": event_data.get('event_id'),
        "user_id": user_id,
        "device_id": device_id,
        "event_type": event_type,
        "risk_score": score,
        "category": category,
        "recommended_action": recommended_action,
        "reasons": reasons,
        "explanation": explanation,
        "timestamp": time.time(),
    }


def start_worker():
    setup_stream()
    print("Risk Engine started. Waiting for events...")

    while True:
        try:
            messages = r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {STREAM_KEY: '>'}, count=10, block=2000)

            for stream, message_list in messages:
                for message_id, message in message_list:
                    event_data = json.loads(message['payload'])
                    eid = event_data.get('event_id', 'unknown')
                    etype = event_data.get('event_type', 'unknown')
                    print(f"Evaluating event: {eid} [{etype}]")

                    risk_result = evaluate_risk(event_data)
                    print(
                        f"  → Score: {risk_result['risk_score']} "
                        f"({risk_result['category']}) | "
                        f"Action: {risk_result['recommended_action']} | "
                        f"Reasons: {risk_result['reasons']}"
                    )

                    r.publish("risk_updates", json.dumps(risk_result))
                    r.xack(STREAM_KEY, GROUP_NAME, message_id)

        except Exception as e:
            print(f"Error processing messages: {e}")
            time.sleep(1)


if __name__ == "__main__":
    start_worker()
