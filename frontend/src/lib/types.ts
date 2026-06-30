// Shared domain types for the Ajna console + small pure helpers.

export interface Policy {
  id: string;
  name: string;
  signal: string;
  operator: string;
  value: boolean | number | string;
  score_delta: number;
  enabled: boolean;
}

export interface DeviceTrust {
  trust_score: number;
  event_count: number;
  fraud_count: number;
  last_category: string;
}

export interface BehavioralDeviation {
  feature: string;
  label?: string;
  description?: string;
  severity?: string;
  sigma: number;
  observed: number;
  baseline: number;
}

export type OutcomeLabel = "confirmed_fraud" | "false_positive" | "legit";

export interface RiskUpdate {
  case_id: string;
  event_id: string;
  user_id: string;
  device_id: string;
  event_type: string;
  risk_score: number;
  category: "Safe" | "Suspicious" | "Fraud";
  recommended_action: string;
  reasons: string[];
  explanation: string;
  timestamp: number;
  session_id?: string;
  status?: "pending" | "reviewed";
  analyst_action?: string;
  analyst?: string;
  decided_at?: number;
  notes?: string;
  behavioral_sigma?: number;
  behavioral_deviations?: BehavioralDeviation[];
  context?: Record<string, unknown>;
  outcome?: OutcomeLabel;
  outcome_source?: string;
}

export interface EntityProfile {
  entity_type: string;
  entity_id: string;
  behavioral?: {
    sample_count: number;
    last_seen?: number;
    features?: Record<string, { mean: number; std: number }>;
  };
  trust?: {
    trust_score: number;
    event_count: number;
    fraud_count: number;
    last_category: string;
  };
}

export interface FraudRing {
  hub: string;
  hub_type: "device" | "email";
  accounts: string[];
  size: number;
}

export interface ReportSummary {
  total_events?: number;
  by_category?: Record<string, number>;
  by_recommended_action?: Record<string, number>;
  top_signals?: { signal: string; count: number }[] | [string, number][] | Record<string, number>;
  outcomes?: { confirmed_fraud: number; false_positive: number; legit: number; unlabeled: number };
  precision?: number | null;
  exposure_blocked?: number;
  behavioral_catches?: number;
}

export interface CopilotResponse {
  answer: string;
  grounded_on: string | null;
}

export interface CopilotMessage {
  role: "user" | "assistant";
  text: string;
  grounded_on?: string | null;
}

export interface DevEvent {
  event_id: string;
  user_id: string;
  device_id: string;
  event_type: string;
  timestamp: string;
  device?: { rooted?: boolean; emulator?: boolean; vpn?: boolean; gps_spoofed?: boolean; model?: string };
}

export interface TrendPoint { t: number; safe: number; suspicious: number; fraud: number }

export interface DecisionEntry {
  case_id: string;
  action: string;
  analyst: string;
  notes?: string;
  timestamp: number;
  risk_score: number;
  category: string;
  user_id: string;
  device_id: string;
  event_type: string;
  reasons: string[];
  recommended_action?: string;
}

export interface DeviceProfile {
  device_id: string;
  maxRisk: number;
  totalEvents: number;
  linkedUsers: string[];
  lastCategory: string;
  lastSeen: number;
  topReasons: string[];
  isEmulator: boolean;
  isRooted: boolean;
  hasVPN: boolean;
  isGPSSpoofed: boolean;
  hasAppTamper: boolean;
}

export interface AccountProfile {
  user_id: string;
  maxRisk: number;
  totalEvents: number;
  linkedDevices: string[];
  lastCategory: string;
  lastSeen: number;
  topReasons: string[];
}

export type Category = "Safe" | "Suspicious" | "Fraud";

// ── Pure presentation helpers (take `now` so they stay render-pure) ──────────

export function timeAgo(unixSeconds: number, nowMs: number): string {
  const diff = nowMs / 1000 - unixSeconds;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatClock(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/** Map a risk category to a Badge variant. */
export function categoryVariant(category: string): "safe" | "suspicious" | "fraud" {
  if (category === "Fraud") return "fraud";
  if (category === "Suspicious") return "suspicious";
  return "safe";
}

/** Token text color class for a risk score. */
export function riskText(score: number): string {
  if (score >= 61) return "text-fraud";
  if (score >= 31) return "text-suspicious";
  return "text-safe";
}

export function actionTone(action?: string): "safe" | "suspicious" | "fraud" | "default" | "muted" {
  switch (action) {
    case "Allow": return "safe";
    case "Monitor": return "default";
    case "Challenge": return "suspicious";
    case "Block": return "fraud";
    default: return "muted";
  }
}

export function currency(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(n);
}

// Plain-English names for behavioral biometric features, so the UI never shows
// raw field names like `tap_cadence_variance`. Mirrors the backend FEATURE_LABELS,
// and acts as a fallback for older cases scored before labels were emitted.
export const FEATURE_LABELS: Record<string, string> = {
  tap_cadence_variance: "Tapping rhythm",
  touch_pressure_avg: "Touch pressure",
  touch_area_avg: "Touch size",
  key_dwell_avg: "Key-press duration",
  key_flight_avg: "Typing speed",
  swipe_velocity_avg: "Swipe speed",
  swipe_curvature_avg: "Swipe path shape",
  motion_accel_variance: "How the device is held",
  motion_gyro_variance: "Device rotation",
  action_interval_avg: "Action pacing",
  session_hour: "Time of day",
};

export function friendlyFeature(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/** Plain word for how far a session sits from this user's own normal. */
export function severityWord(sigma: number): string {
  if (sigma >= 6) return "drastically different";
  if (sigma >= 4.5) return "very different";
  return "noticeably different";
}
