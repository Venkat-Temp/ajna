import redis
import json
import logging
import time
import uuid
import os
from google import genai
from graph_engine import graph_engine
from policy_engine import evaluate_policies

logger = logging.getLogger(__name__)

r = redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)

STREAM_KEY = 'fraud_events'
GROUP_NAME = 'risk_evaluators'
CONSUMER_NAME = 'worker_1'

HIGH_VALUE_EVENTS = {'wallet_transfer', 'payment_attempt', 'withdrawal', 'checkout'}
REFERRAL_EVENTS = {'referral_claim', 'promo_redeem'}


def setup_stream():
    try:
        r.xgroup_create(STREAM_KEY, GROUP_NAME, id='0', mkstream=True)
        logger.info("Created consumer group %s on stream %s", GROUP_NAME, STREAM_KEY)
    except redis.exceptions.ResponseError as e:
        if "BUSYGROUP" in str(e):
            logger.info("Consumer group %s already exists.", GROUP_NAME)
        else:
            raise e


def _update_device_trust(device_id: str, risk_score: int, category: str):
    key = f"trust:{device_id}"
    existing = r.hgetall(key)
    old_score = float(existing.get('trust_score', 50))
    event_count = int(existing.get('event_count', 0)) + 1
    fraud_count = int(existing.get('fraud_count', 0)) + (1 if category == 'Fraud' else 0)
    # EMA: alpha=0.3; higher trust_score = more risky history
    new_trust = round(0.3 * risk_score + 0.7 * old_score, 2)
    r.hset(key, mapping={
        'trust_score': new_trust,
        'event_count': event_count,
        'fraud_count': fraud_count,
        'last_seen': time.time(),
        'last_category': category,
    })
    r.expire(key, 86400 * 30)


def evaluate_risk(event_data):
    score = 0
    reasons = []

    device = event_data.get('device', {}) or {}
    behavioral = event_data.get('behavioral', {}) or {}
    user_id = event_data.get('user_id')
    device_id = event_data.get('device_id')
    event_type = event_data.get('event_type', '')

    # ── Device Intelligence (policy-engine-driven) ────────────────────────────
    # Scores and enables/disables are controlled via /api/v1/policies — toggling
    # a policy in the dashboard takes effect immediately on the next event.
    policy_delta, policy_reasons = evaluate_policies(event_data)
    score += policy_delta
    reasons.extend(policy_reasons)

    # ── High-Value Event on Risky Device (combo penalty) ─────────────────────
    device_is_risky = (device.get('rooted') or device.get('emulator')
                       or device.get('gps_spoofed') or device.get('app_tamper'))
    if event_type in HIGH_VALUE_EVENTS and device_is_risky:
        score += 25
        reasons.append(f"High-value action ({event_type}) on compromised device")

    # ── Behavioral Biometrics (from Android SDK) ──────────────────────────────
    tap_variance = float(behavioral.get('tap_cadence_variance', 999))
    interaction_count = int(behavioral.get('interaction_count', 0))
    if interaction_count >= 3 and tap_variance < 10:
        score += 20
        reasons.append(f"Bot-like touch pattern (cadence variance: {round(tap_variance, 1)}ms)")

    if behavioral.get('has_sensors') is False:
        score += 10
        reasons.append("No sensor data in behavioral payload (automated environment)")

    # ── Server-side Bot Timing Detection ─────────────────────────────────────
    if device_id:
        timing_key = f"vel:timing:{device_id}"
        now_ms = int(time.time() * 1000)
        r.rpush(timing_key, now_ms)
        r.ltrim(timing_key, -5, -1)
        r.expire(timing_key, 60)
        timestamps = [int(t) for t in r.lrange(timing_key, 0, -1)]
        if len(timestamps) >= 4:
            deltas = [timestamps[i+1] - timestamps[i] for i in range(len(timestamps)-1)]
            avg_delta = sum(deltas) / len(deltas)
            if avg_delta > 0:
                variance = sum((d - avg_delta)**2 for d in deltas) / len(deltas)
                # Very regular sub-500ms intervals = likely automated
                if variance < 100 and avg_delta < 500:
                    score += 20
                    reasons.append(f"Automated request timing (variance: {round(variance, 1)}ms²)")

    # ── Behavioral Velocity ───────────────────────────────────────────────────
    if user_id:
        otp_key = f"vel:otp:{user_id}"
        login_key = f"vel:login:{user_id}"
        general_key = f"vel:user:{user_id}"

        count = int(r.incr(general_key) or 0)
        if r.ttl(general_key) == -1:
            r.expire(general_key, 60)
        if count > 3:
            score += 20
            reasons.append(f"High event velocity ({count} events in 60s)")

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

    # ── Device Trust History ──────────────────────────────────────────────────
    if device_id:
        trust_data = r.hgetall(f"trust:{device_id}")
        if trust_data:
            existing_trust = float(trust_data.get('trust_score', 50))
            existing_fraud = int(trust_data.get('fraud_count', 0))
            if existing_fraud >= 3 and existing_trust > 65:
                score += 15
                reasons.append(
                    f"Known high-risk device (trust score: {round(existing_trust)}, "
                    f"fraud events: {existing_fraud})"
                )

    # ── Graph Intelligence (Neo4j) ────────────────────────────────────────────
    ip_address = event_data.get('ip')
    email_hash = event_data.get('email_hash')
    if user_id and device_id:
        graph_engine.update_identity_graph(user_id, device_id, ip_address, email_hash)
        graph_score, graph_reasons = graph_engine.get_graph_risk(user_id, device_id)
        if graph_score > 0:
            score += graph_score
            reasons.extend(graph_reasons)
        subnet_score, subnet_reasons = graph_engine.get_subnet_risk(ip_address)
        if subnet_score > 0:
            score += subnet_score
            reasons.extend(subnet_reasons)

    score = min(score, 100)

    # ── Risk Category ─────────────────────────────────────────────────────────
    if score >= 61:
        category = "Fraud"
    elif score >= 31:
        category = "Suspicious"
    else:
        category = "Safe"

    # ── Structured Recommended Action ─────────────────────────────────────────
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
            logger.error("Gemini error: %s", e)
            explanation = (
                f"Risk signals detected: {', '.join(reasons[:3])}. "
                f"Recommended: {recommended_action}."
            )

    result = {
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

    if device_id:
        _update_device_trust(device_id, score, category)

    return result


def start_worker():
    setup_stream()
    logger.info("Risk Engine started. Waiting for events...")

    while True:
        try:
            messages = r.xreadgroup(GROUP_NAME, CONSUMER_NAME, {STREAM_KEY: '>'}, count=10, block=2000)

            for stream, message_list in messages:
                for message_id, message in message_list:
                    event_data = json.loads(message['payload'])
                    eid = event_data.get('event_id', 'unknown')
                    etype = event_data.get('event_type', 'unknown')
                    logger.info("Evaluating event: %s [%s]", eid, etype)

                    risk_result = evaluate_risk(event_data)
                    logger.info(
                        "Score: %s (%s) | Action: %s | Reasons: %s",
                        risk_result['risk_score'], risk_result['category'],
                        risk_result['recommended_action'], risk_result['reasons']
                    )

                    r.publish("risk_updates", json.dumps(risk_result))
                    r.xack(STREAM_KEY, GROUP_NAME, message_id)

        except Exception as e:
            logger.error("Error processing messages: %s", e)
            time.sleep(1)


if __name__ == "__main__":
    start_worker()
