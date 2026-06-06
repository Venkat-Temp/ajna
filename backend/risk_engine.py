import hashlib
import math
import redis
import json
import logging
import time
import uuid
import os
from google import genai
from graph_engine import graph_engine
from policy_engine import evaluate_policies
from threshold_engine import get_thresholds

logger = logging.getLogger(__name__)

r = redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)

STREAM_KEY = 'fraud_events'
GROUP_NAME = 'risk_evaluators'
CONSUMER_NAME = 'worker_1'

HIGH_VALUE_EVENTS = {'wallet_transfer', 'payment_attempt', 'withdrawal', 'checkout'}
REFERRAL_EVENTS = {'referral_claim', 'promo_redeem'}

# Policy names that mark a device as "risky" for the combo penalty.
# Disabling any of these policies also disables the combo penalty for that flag.
RISKY_DEVICE_POLICY_NAMES = {"Rooted Device", "Emulator Detected", "GPS Spoofed", "App Tampered"}


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
    new_trust = round(0.3 * risk_score + 0.7 * old_score, 2)
    r.hset(key, mapping={
        'trust_score': new_trust,
        'event_count': event_count,
        'fraud_count': fraud_count,
        'last_seen': time.time(),
        'last_category': category,
    })
    r.expire(key, 86400 * 30)


def _compute_session_id(user_id: str, device_id: str, timestamp: float, window_secs: int) -> str:
    """Derive a session ID from user+device+time-slot. No client change needed."""
    slot = math.floor(timestamp / window_secs)
    raw = f"{user_id}:{device_id}:{slot}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _get_session_context(session_id: str) -> dict:
    data = r.hgetall(f"session:{session_id}")
    if not data:
        return {"event_count": 0, "score_sum": 0.0, "max_score": 0,
                "fraud_count": 0, "suspicious_count": 0}
    return {
        "event_count":      int(data.get("event_count", 0)),
        "score_sum":        float(data.get("score_sum", 0.0)),
        "max_score":        int(data.get("max_score", 0)),
        "fraud_count":      int(data.get("fraud_count", 0)),
        "suspicious_count": int(data.get("suspicious_count", 0)),
    }


def _update_session(session_id: str, risk_score: int, category: str, window_secs: int):
    key = f"session:{session_id}"
    existing = r.hgetall(key)
    event_count      = int(existing.get("event_count", 0)) + 1
    score_sum        = float(existing.get("score_sum", 0.0)) + risk_score
    max_score        = max(int(existing.get("max_score", 0)), risk_score)
    fraud_count      = int(existing.get("fraud_count", 0)) + (1 if category == "Fraud" else 0)
    suspicious_count = int(existing.get("suspicious_count", 0)) + (1 if category in ("Fraud", "Suspicious") else 0)
    first_seen       = existing.get("first_seen", str(time.time()))
    r.hset(key, mapping={
        "event_count":      event_count,
        "score_sum":        score_sum,
        "max_score":        max_score,
        "fraud_count":      fraud_count,
        "suspicious_count": suspicious_count,
        "first_seen":       first_seen,
    })
    r.expire(key, window_secs + 300)


def evaluate_risk(event_data):
    score = 0
    reasons = []
    t = get_thresholds()  # load once per event — single Redis GET

    device    = event_data.get('device', {}) or {}
    behavioral = event_data.get('behavioral', {}) or {}
    user_id   = event_data.get('user_id')
    device_id = event_data.get('device_id')
    event_type = event_data.get('event_type', '')
    event_ts  = time.time()

    # ── Session Context (read BEFORE scoring, update AFTER) ──────────────────
    session_id = None
    session_ctx = {"event_count": 0, "score_sum": 0.0, "max_score": 0,
                   "fraud_count": 0, "suspicious_count": 0}
    if user_id and device_id:
        session_id = _compute_session_id(user_id, device_id, event_ts, int(t["session_window_secs"]))
        session_ctx = _get_session_context(session_id)

    # ── Device Intelligence (policy-engine-driven) ────────────────────────────
    policy_delta, policy_reasons = evaluate_policies(event_data)
    score += policy_delta
    reasons.extend(policy_reasons)

    # ── High-Value Event on Risky Device (combo penalty) ─────────────────────
    # Uses policy_reasons so disabling a device policy also disables this combo.
    device_is_risky = bool(RISKY_DEVICE_POLICY_NAMES & set(policy_reasons))
    if event_type in HIGH_VALUE_EVENTS and device_is_risky:
        score += int(t["combo_penalty_delta"])
        reasons.append(f"High-value action ({event_type}) on compromised device")

    # ── Behavioral Biometrics (from Android SDK) ──────────────────────────────
    tap_variance = float(behavioral.get('tap_cadence_variance', 999))
    interaction_count = int(behavioral.get('interaction_count', 0))
    if interaction_count >= 3 and tap_variance < float(t["bot_cadence_variance_max"]):
        score += 20
        reasons.append(f"Bot-like touch pattern (cadence variance: {round(tap_variance, 1)}ms)")

    if behavioral.get('has_sensors') is False:
        score += 10
        reasons.append("No sensor data in behavioral payload (automated environment)")

    # ── Server-side Bot Timing Detection ─────────────────────────────────────
    if device_id:
        timing_key = f"vel:timing:{device_id}"
        now_ms = int(event_ts * 1000)
        r.rpush(timing_key, now_ms)
        r.ltrim(timing_key, -5, -1)
        r.expire(timing_key, 60)
        timestamps = [int(ts) for ts in r.lrange(timing_key, 0, -1)]
        if len(timestamps) >= 4:
            deltas = [timestamps[i+1] - timestamps[i] for i in range(len(timestamps)-1)]
            avg_delta = sum(deltas) / len(deltas)
            if avg_delta > 0:
                variance = sum((d - avg_delta)**2 for d in deltas) / len(deltas)
                if variance < float(t["bot_timing_variance_max"]) and avg_delta < float(t["bot_timing_avg_delta_max"]):
                    score += 20
                    reasons.append(f"Automated request timing (variance: {round(variance, 1)}ms²)")

    # ── Behavioral Velocity ───────────────────────────────────────────────────
    if user_id:
        general_key = f"vel:user:{user_id}"
        count = int(r.incr(general_key) or 0)
        if r.ttl(general_key) == -1:
            r.expire(general_key, int(t["velocity_window_secs"]))
        if count > int(t["velocity_max_count"]):
            score += int(t["velocity_delta"])
            reasons.append(f"High event velocity ({count} events in {int(t['velocity_window_secs'])}s)")

        if event_type == 'otp_failure':
            otp_key = f"vel:otp:{user_id}"
            otp_count = int(r.incr(otp_key) or 0)
            if r.ttl(otp_key) == -1:
                r.expire(otp_key, int(t["otp_window_secs"]))
            score += int(t["otp_base_delta"])
            if otp_count >= int(t["otp_tier2_count"]):
                score += int(t["otp_tier2_delta"])
                reasons.append(f"Critical OTP velocity: {otp_count} failures in {int(t['otp_window_secs'])}s — brute-force attack")
            elif otp_count >= int(t["otp_tier1_count"]):
                score += int(t["otp_tier1_delta"])
                reasons.append(f"High OTP velocity: {otp_count} failures in {int(t['otp_window_secs'])}s")
            else:
                reasons.append(f"OTP failure (#{otp_count} in window)")

        if event_type == 'login_failure':
            login_key = f"vel:login:{user_id}"
            login_count = int(r.incr(login_key) or 0)
            if r.ttl(login_key) == -1:
                r.expire(login_key, int(t["login_window_secs"]))
            score += int(t["login_base_delta"])
            if login_count >= int(t["login_tier2_count"]):
                score += int(t["login_tier2_delta"])
                reasons.append(f"Credential stuffing suspected: {login_count} login failures in {int(t['login_window_secs'])}s")
            elif login_count >= int(t["login_tier1_count"]):
                score += int(t["login_tier1_delta"])
                reasons.append(f"Repeated login failures: {login_count} in {int(t['login_window_secs'])}s")

        if event_type in REFERRAL_EVENTS and device_id:
            ref_key = f"vel:referral:{device_id}"
            ref_count = int(r.incr(ref_key) or 0)
            if r.ttl(ref_key) == -1:
                r.expire(ref_key, int(t["referral_window_secs"]))
            score += int(t["referral_base_delta"])
            if ref_count >= int(t["referral_tier2_count"]):
                score += int(t["referral_tier2_delta"])
                reasons.append(f"Referral abuse: {ref_count} claims from this device in {int(t['referral_window_secs'])}s")
            elif ref_count >= int(t["referral_tier1_count"]):
                score += int(t["referral_tier1_delta"])
                reasons.append(f"Multiple referral claims: {ref_count} from same device")

    # ── Device Trust History ──────────────────────────────────────────────────
    if device_id:
        trust_data = r.hgetall(f"trust:{device_id}")
        if trust_data:
            existing_trust = float(trust_data.get('trust_score', 50))
            existing_fraud = int(trust_data.get('fraud_count', 0))
            if existing_fraud >= int(t["trust_fraud_count_min"]) and existing_trust > float(t["trust_score_threshold"]):
                score += int(t["trust_penalty_delta"])
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

    # ── Session-Aware Signals (after all others, before cap) ─────────────────
    # pre_session_score is used for all three checks to avoid compounding.
    if session_ctx["event_count"] > 0:
        pre_session_score = score
        session_avg = session_ctx["score_sum"] / session_ctx["event_count"]
        high_risk_in_session = session_ctx["fraud_count"] + session_ctx["suspicious_count"]

        if session_avg < 20 and pre_session_score >= int(t["category_suspicious"]):
            score += int(t["session_escalation_delta"])
            reasons.append("Session escalated from safe to suspicious/fraud")

        if high_risk_in_session >= 2:
            score += int(t["session_repeat_delta"])
            reasons.append(f"Multiple high-risk events in session ({high_risk_in_session} total)")

        if pre_session_score >= int(t["category_fraud"]) and session_ctx["fraud_count"] >= 1:
            score += int(t["session_spike_delta"])
            reasons.append("Repeated fraud events in this session")

    score = min(score, 100)

    # ── Risk Category ─────────────────────────────────────────────────────────
    if score >= int(t["category_fraud"]):
        category = "Fraud"
    elif score >= int(t["category_suspicious"]):
        category = "Suspicious"
    else:
        category = "Safe"

    # ── Recommended Action ────────────────────────────────────────────────────
    if score >= int(t["action_block"]):
        recommended_action = "Block"
    elif score >= int(t["action_challenge"]):
        recommended_action = "Challenge"
    elif score >= int(t["category_suspicious"]):
        recommended_action = "Monitor"
    else:
        recommended_action = "Allow"

    # ── Gemini AI Explanation ─────────────────────────────────────────────────
    explanation = "Device and behavioral signals are within normal parameters. No action required."
    if score >= int(t["category_suspicious"]):
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
                    f"{'Immediate action required to prevent financial loss.' if score >= int(t['category_fraud']) else 'Monitor closely for escalation.'}"
                )
        except Exception as e:
            logger.error("Gemini error: %s", e)
            explanation = (
                f"Risk signals detected: {', '.join(reasons[:3])}. "
                f"Recommended: {recommended_action}."
            )

    result = {
        "case_id":           f"case_{uuid.uuid4().hex[:8]}",
        "event_id":          event_data.get('event_id'),
        "user_id":           user_id,
        "device_id":         device_id,
        "event_type":        event_type,
        "risk_score":        score,
        "category":          category,
        "recommended_action": recommended_action,
        "reasons":           reasons,
        "explanation":       explanation,
        "timestamp":         event_ts,
        "session_id":        session_id,
    }

    if device_id:
        _update_device_trust(device_id, score, category)
    if session_id:
        _update_session(session_id, score, category, int(t["session_window_secs"]))

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
                        "Score: %s (%s) | Action: %s | Session: %s | Reasons: %s",
                        risk_result['risk_score'], risk_result['category'],
                        risk_result['recommended_action'], risk_result.get('session_id'),
                        risk_result['reasons']
                    )

                    r.publish("risk_updates", json.dumps(risk_result))
                    r.xack(STREAM_KEY, GROUP_NAME, message_id)

        except Exception as e:
            logger.error("Error processing messages: %s", e)
            time.sleep(1)


if __name__ == "__main__":
    start_worker()
