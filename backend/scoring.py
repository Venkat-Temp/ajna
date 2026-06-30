"""Core risk scoring — Layer 2/3 of the Ajna fraud intelligence platform.

This module holds the scoring logic so it can be called from BOTH:
  - risk_engine.py  (the blocking Redis Streams worker, async pipeline)
  - main.py         (the synchronous POST /api/v1/decide endpoint)

It is the single source of truth for `evaluate_risk()`. `decide()` wraps it to
produce an inline, app-facing verdict (trust score + decision + human-readable
"why"). All Redis access here uses the synchronous client; callers in async
contexts should invoke via `asyncio.to_thread(...)`.
"""

import hashlib
import math
import redis
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

HIGH_VALUE_EVENTS = {'wallet_transfer', 'payment_attempt', 'withdrawal', 'checkout'}
REFERRAL_EVENTS = {'referral_claim', 'promo_redeem'}

# Policy names that mark a device as "risky" for the combo penalty.
# Disabling any of these policies also disables the combo penalty for that flag.
RISKY_DEVICE_POLICY_NAMES = {"Rooted Device", "Emulator Detected", "GPS Spoofed", "App Tampered"}

# Continuous behavioral-biometric features used to learn a per-user baseline.
# These come from the Android SDK's behavioral payload (BehavioralIntelligence.kt).
BEHAVIORAL_FEATURES = ("tap_cadence_variance", "touch_pressure_avg", "touch_area_avg")

# Plain-English names for behavioral features, so analysts and business users never
# have to read raw sensor field names. Covers current baseline features plus the
# richer SDK features for when they're baselined later.
FEATURE_LABELS = {
    "tap_cadence_variance": "Tapping rhythm",
    "touch_pressure_avg":   "Touch pressure",
    "touch_area_avg":       "Touch size",
    "key_dwell_avg":        "Key-press duration",
    "key_flight_avg":       "Typing speed",
    "swipe_velocity_avg":   "Swipe speed",
    "swipe_curvature_avg":  "Swipe path shape",
    "motion_accel_variance": "How the device is held",
    "motion_gyro_variance":  "Device rotation",
    "action_interval_avg":  "Action pacing",
    "session_hour":         "Time of day",
}


def _friendly_label(feature: str) -> str:
    return FEATURE_LABELS.get(feature, feature.replace("_", " ").capitalize())


def _severity_phrase(sigma: float, t: dict) -> str:
    """Translate a sigma value into a word a human understands."""
    if sigma >= float(t["behavioral_severe_sigma"]):
        return "drastically different"
    midpoint = (float(t["behavioral_deviation_sigma"]) + float(t["behavioral_severe_sigma"])) / 2
    if sigma >= midpoint:
        return "very different"
    return "noticeably different"
BEHAVIORAL_EMA_ALPHA = 0.3
BEHAVIORAL_PROFILE_TTL = 86400 * 90  # 90 days


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


# ── Layer 2: Per-entity behavioral baseline ("learn normal") ─────────────────
# We maintain, per user, an exponential-moving-average mean and variance for each
# behavioral-biometric feature. Deviation-from-self is the signal heuristics miss:
# a genuine-looking session (clean device, right credentials) that simply does not
# behave like THIS user — the "exact moment a good user turns bad".

def _behavioral_key(entity_type: str, entity_id: str) -> str:
    return f"behprofile:{entity_type}:{entity_id}"


def _extract_behavioral_features(behavioral: dict) -> dict:
    """Pull the numeric biometric features that are actually present in the payload."""
    features = {}
    for f in BEHAVIORAL_FEATURES:
        if behavioral.get(f) is not None:
            try:
                features[f] = float(behavioral[f])
            except (TypeError, ValueError):
                continue
    return features


def get_behavioral_profile(entity_type: str, entity_id: str) -> dict:
    """Return the learned behavioral baseline for an entity (for the intelligence API)."""
    raw = r.hgetall(_behavioral_key(entity_type, entity_id))
    if not raw:
        return {"sample_count": 0, "features": {}}
    features = {}
    for f in BEHAVIORAL_FEATURES:
        if f"{f}_mean" in raw:
            features[f] = {
                "mean": round(float(raw[f"{f}_mean"]), 4),
                "std": round(math.sqrt(float(raw.get(f"{f}_var", 0.0))), 4),
            }
    return {
        "sample_count": int(raw.get("sample_count", 0)),
        "last_seen": float(raw.get("last_seen", 0.0)),
        "features": features,
    }


def _behavioral_deviation(entity_type: str, entity_id: str, features: dict, t: dict):
    """Compare current features against the learned baseline (READ before update).

    Returns (max_sigma, deviating[]) where each deviating entry names the feature
    and how many standard deviations it sits from this entity's own normal.
    """
    if not features:
        return 0.0, []
    raw = r.hgetall(_behavioral_key(entity_type, entity_id))
    sample_count = int(raw.get("sample_count", 0)) if raw else 0
    if sample_count < int(t["behavioral_min_samples"]):
        return 0.0, []  # not enough history to know this user's "normal" yet

    sigma_threshold = float(t["behavioral_deviation_sigma"])
    max_sigma = 0.0
    deviating = []
    for f, x in features.items():
        mean_raw = raw.get(f"{f}_mean")
        if mean_raw is None:
            continue
        mean = float(mean_raw)
        std = math.sqrt(float(raw.get(f"{f}_var", 0.0)))
        # Relative floor: ignore trivial drift on a near-constant baseline (avoids
        # flagging a 0.01 change as 10σ just because historical variance was ~0),
        # while still catching a genuinely large departure from the user's normal.
        std = max(std, 0.05 * abs(mean), 1e-6)
        sigma = min(abs(x - mean) / std, 10.0)  # cap for sane reporting
        if sigma > max_sigma:
            max_sigma = sigma
        if sigma >= sigma_threshold:
            label = _friendly_label(f)
            severity = _severity_phrase(sigma, t)
            direction = "higher than usual" if x > mean else "lower than usual"
            deviating.append({
                "feature": f,                       # raw field (for analysts/API)
                "label": label,                     # plain-English name
                "description": f"{label} is {severity} from this user's normal "
                               f"({direction})",
                "severity": severity,
                "sigma": round(sigma, 1),
                "observed": round(x, 2),
                "baseline": round(mean, 2),
            })
    # surface the strongest deviation first
    deviating.sort(key=lambda d: d["sigma"], reverse=True)
    return round(max_sigma, 1), deviating


# ── Layer 2: similarity-to-known-bad (learned fraud signatures) ──────────────
# Outcomes labeled "confirmed_fraud" fold their behavioral vector into a shared
# centroid. A new session whose behavior closely matches that centroid is flagged
# even if it doesn't deviate from the user's own (possibly thin) baseline. This is
# the "match to a known-bad pattern" signal — bot rings, scripted abusers.

KNOWN_BAD_KEY = "knownbad:behavioral"


def record_known_bad_behavioral(features: dict):
    """Fold a confirmed-fraud session's behavioral vector into the known-bad centroid."""
    if not features:
        return
    raw = r.hgetall(KNOWN_BAD_KEY)
    alpha = BEHAVIORAL_EMA_ALPHA
    mapping = {}
    for f, x in features.items():
        old = float(raw.get(f"{f}_mean", x))
        mapping[f"{f}_mean"] = alpha * x + (1 - alpha) * old
    mapping["count"] = int(raw.get("count", 0)) + 1
    r.hset(KNOWN_BAD_KEY, mapping=mapping)


def _known_bad_similarity(features: dict, t: dict) -> float:
    """Return 0-1 similarity of the current behavior to the known-fraud centroid."""
    if not features:
        return 0.0
    raw = r.hgetall(KNOWN_BAD_KEY)
    if int(raw.get("count", 0)) < int(t["known_bad_min_samples"]):
        return 0.0
    sims = []
    for f, x in features.items():
        m = raw.get(f"{f}_mean")
        if m is None:
            continue
        m = float(m)
        denom = abs(m) + 1e-6
        sims.append(max(0.0, 1.0 - min(1.0, abs(x - m) / denom)))
    if not sims:
        return 0.0
    return sum(sims) / len(sims)


def _update_behavioral_profile(entity_type: str, entity_id: str, features: dict):
    """Fold the current features into the entity's EMA baseline (called AFTER scoring)."""
    if not features:
        return
    key = _behavioral_key(entity_type, entity_id)
    raw = r.hgetall(key)
    alpha = BEHAVIORAL_EMA_ALPHA
    mapping = {}
    for f, x in features.items():
        old_mean = float(raw.get(f"{f}_mean", x))
        new_mean = alpha * x + (1 - alpha) * old_mean
        old_var = float(raw.get(f"{f}_var", 0.0))
        new_var = alpha * (x - new_mean) ** 2 + (1 - alpha) * old_var
        mapping[f"{f}_mean"] = new_mean
        mapping[f"{f}_var"] = new_var
    mapping["sample_count"] = int(raw.get("sample_count", 0)) + 1
    mapping["last_seen"] = time.time()
    r.hset(key, mapping=mapping)
    r.expire(key, BEHAVIORAL_PROFILE_TTL)


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

    # ── Behavioral Deviation From Self (Layer 2 — learned baseline) ──────────
    # The signal global thresholds cannot catch: behavior that is fine in the
    # abstract but abnormal for THIS specific user. Read deviation before update.
    bio_features = _extract_behavioral_features(behavioral)
    behavioral_sigma, behavioral_deviations = (0.0, [])
    if user_id and bio_features:
        behavioral_sigma, behavioral_deviations = _behavioral_deviation(
            "user", user_id, bio_features, t
        )
        if behavioral_deviations:
            score += int(t["behavioral_deviation_delta"])
            top = behavioral_deviations[0]  # strongest deviation (list is pre-sorted)
            if behavioral_sigma >= float(t["behavioral_severe_sigma"]):
                score += int(t["behavioral_severe_delta"])
                reasons.append(
                    f"Behavior doesn't match this user — {top['label'].lower()} is "
                    f"{top['severity']} from normal (possible account takeover)"
                )
            else:
                reasons.append(
                    f"Unusual behavior for this user — {top['label'].lower()} is "
                    f"{top['severity']} from normal"
                )

        # Similarity to the learned known-fraud behavioral signature.
        known_bad_sim = _known_bad_similarity(bio_features, t)
        if known_bad_sim >= float(t["known_bad_similarity_min"]):
            score += int(t["known_bad_delta"])
            reasons.append(
                f"Matches known-fraud behavioral pattern ({round(known_bad_sim * 100)}% similar)"
            )

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
        "behavioral_sigma":  behavioral_sigma,
        "behavioral_deviations": behavioral_deviations,
        "behavioral_features": bio_features,
        "context":           event_data.get('context') or {},
    }

    if device_id:
        _update_device_trust(device_id, score, category)
    if session_id:
        _update_session(session_id, score, category, int(t["session_window_secs"]))
    if user_id and bio_features:
        _update_behavioral_profile("user", user_id, bio_features)

    return result


# ── Layer 3: app-facing decision wrapper ─────────────────────────────────────

# Maps the analyst-facing recommended_action onto the integrator-facing verdict.
_DECISION_MAP = {
    "Allow": "ALLOW",
    "Monitor": "REVIEW",
    "Challenge": "CHALLENGE",
    "Block": "BLOCK",
}

# Default step-up to request when a CHALLENGE verdict is returned. Customers can
# override downstream; this is a sensible inline default.
_CHALLENGE_ACTION = {"type": "otp", "ttl_seconds": 120}


def _reason_code(reason: str) -> str:
    """Derive a stable-ish machine code from a human reason string."""
    base = reason.split("(")[0].split(":")[0].strip()
    return "_".join(base.upper().split())[:48]


def decide(event_data) -> dict:
    """Score an event and return an inline, app-facing verdict.

    This is what POST /api/v1/decide returns: a verdict the calling app branches
    on, a 0-1 trust score, the human-readable "why", and machine reason codes.
    Side effects (trust/session/behavioral updates, persistence) are identical to
    the async path because it runs the same evaluate_risk().
    """
    result = evaluate_risk(event_data)
    verdict = _DECISION_MAP.get(result["recommended_action"], "REVIEW")
    decision = {
        "decision_id": f"dec_{uuid.uuid4().hex[:8]}",
        "case_id": result["case_id"],
        "event_id": result["event_id"],
        "trust": round(max(0.0, 1.0 - result["risk_score"] / 100.0), 3),
        "decision": verdict,
        "risk_score": result["risk_score"],
        "category": result["category"],
        "why": result["reasons"],
        "reason_codes": [_reason_code(x) for x in result["reasons"]],
        "explanation": result["explanation"],
        "behavioral_sigma": result["behavioral_sigma"],
    }
    if verdict == "CHALLENGE":
        decision["action"] = _CHALLENGE_ACTION
    # Carry the full case so the caller (main.py) can persist/broadcast it.
    decision["_case"] = result
    return decision
