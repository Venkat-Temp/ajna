import redis
import json
import logging
import os

logger = logging.getLogger(__name__)

r = redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)

THRESHOLDS_KEY = "fraud_thresholds"

DEFAULT_THRESHOLDS = {
    # Category / action boundaries
    "category_suspicious":       31,
    "category_fraud":            61,
    "action_challenge":          46,
    "action_block":              61,

    # Velocity: OTP failures
    "otp_base_delta":            10,
    "otp_tier1_count":           3,
    "otp_tier1_delta":           30,
    "otp_tier2_count":           6,
    "otp_tier2_delta":           55,
    "otp_window_secs":           120,

    # Velocity: login failures
    "login_base_delta":          8,
    "login_tier1_count":         3,
    "login_tier1_delta":         15,
    "login_tier2_count":         5,
    "login_tier2_delta":         30,
    "login_window_secs":         120,

    # Velocity: referral abuse
    "referral_base_delta":       10,
    "referral_tier1_count":      2,
    "referral_tier1_delta":      15,
    "referral_tier2_count":      5,
    "referral_tier2_delta":      35,
    "referral_window_secs":      300,

    # Velocity: general event rate
    "velocity_window_secs":      60,
    "velocity_max_count":        3,
    "velocity_delta":            20,

    # Bot detection (server-side timing)
    "bot_timing_variance_max":   100,
    "bot_timing_avg_delta_max":  500,
    "bot_cadence_variance_max":  10,

    # Device trust penalty
    "trust_fraud_count_min":     3,
    "trust_score_threshold":     65,
    "trust_penalty_delta":       15,

    # Combo penalty (high-value event on risky device)
    "combo_penalty_delta":       25,

    # Session-aware signals
    "session_window_secs":       1800,
    "session_escalation_delta":  15,
    "session_repeat_delta":      20,
    "session_spike_delta":       10,

    # Behavioral deviation-from-self (Layer 2 — learned per-user baseline)
    "behavioral_min_samples":    5,    # observations needed before we trust a baseline
    "behavioral_deviation_sigma": 3.0, # std-devs from the user's normal to flag (moderate)
    "behavioral_deviation_delta": 35,  # score for a moderate deviation from self
    "behavioral_severe_sigma":   6.0,  # std-devs that mean "this is not the same person"
    "behavioral_severe_delta":   25,   # extra score on a severe deviation (35+25 → Challenge)

    # Similarity-to-known-bad (learned fraud signatures from confirmed outcomes)
    "known_bad_min_samples":     3,    # confirmed-fraud sessions needed before the centroid is usable
    "known_bad_similarity_min":  0.85, # 0-1 closeness to the fraud centroid that flags
    "known_bad_delta":           30,   # score added on a known-fraud behavioral match
}


def get_thresholds() -> dict:
    """Load thresholds from Redis; seed defaults on first call.
    New keys added to DEFAULT_THRESHOLDS are merged in so old stored values
    don't lose new fields after an upgrade.
    """
    raw = r.get(THRESHOLDS_KEY)
    if raw:
        stored = json.loads(raw)
        return {**DEFAULT_THRESHOLDS, **stored}
    r.set(THRESHOLDS_KEY, json.dumps(DEFAULT_THRESHOLDS))
    return dict(DEFAULT_THRESHOLDS)


def save_thresholds(thresholds: dict):
    r.set(THRESHOLDS_KEY, json.dumps(thresholds))
