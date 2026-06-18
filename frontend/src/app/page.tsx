"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
  Activity, ShieldAlert, ShieldCheck, Smartphone, Shield,
  ActivitySquare, AlertTriangle, Fingerprint, Sparkles,
  CheckCircle2, Eye, ShieldQuestion, Ban, Play, Users, MapPin,
  Share2, Loader2, CreditCard, Network, Cpu, Zap, ClipboardList,
  History, TrendingUp, User, Server, Download, Settings, Bot,
  Copy, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, Clock, ArrowRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Policy {
  id: string;
  name: string;
  signal: string;
  operator: string;
  value: boolean | number | string;
  score_delta: number;
  enabled: boolean;
}

interface DeviceTrust {
  trust_score: number;
  event_count: number;
  fraud_count: number;
  last_category: string;
}

interface RiskUpdate {
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
  status?: "pending" | "reviewed";
  analyst_action?: string;
  analyst?: string;
  decided_at?: number;
}

interface DevEvent {
  event_id: string;
  user_id: string;
  device_id: string;
  event_type: string;
  timestamp: string;
  device?: { rooted?: boolean; emulator?: boolean; vpn?: boolean; gps_spoofed?: boolean; model?: string };
}

interface TrendPoint { t: number; safe: number; suspicious: number; fraud: number }

interface DecisionEntry {
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

interface DeviceProfile {
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

interface AccountProfile {
  user_id: string;
  maxRisk: number;
  totalEvents: number;
  linkedDevices: string[];
  lastCategory: string;
  lastSeen: number;
  topReasons: string[];
}

type Tab = "feed" | "devices" | "accounts" | "history" | "policies" | "graph";

type GraphNode = { id: string; type: "device" | "user" | "ip" | "email"; label: string };
type GraphEdge = { source: string; target: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatFeedTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
         d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function riskColor(score: number) {
  if (score >= 61) return "text-rose-600";
  if (score >= 31) return "text-amber-600";
  return "text-emerald-600";
}

function categoryBg(category: string) {
  if (category === "Fraud") return "bg-rose-50 text-rose-700 border-rose-200";
  if (category === "Suspicious") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function actionColors(action?: string) {
  switch (action) {
    case "Allow":     return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "Monitor":   return "bg-blue-50 text-blue-700 border-blue-200";
    case "Challenge": return "bg-amber-50 text-amber-700 border-amber-200";
    case "Block":     return "bg-rose-50 text-rose-700 border-rose-200";
    default:          return "bg-gray-100 text-gray-600 border-gray-200";
  }
}

function categorizeReasons(reasons: string[]) {
  const device: string[] = [], behavioral: string[] = [], identity: string[] = [];
  for (const r of reasons) {
    const l = r.toLowerCase();
    if (l.includes("account") || l.includes("farm") || l.includes("ato") || l.includes("linked") || l.includes("devices") || l.includes("email") || l.includes("subnet")) {
      identity.push(r);
    } else if (l.includes("otp") || l.includes("velocity") || l.includes("referral") || l.includes("credential") || l.includes("login fail") || l.includes("bot") || l.includes("automated") || l.includes("cadence") || l.includes("timing")) {
      behavioral.push(r);
    } else {
      device.push(r);
    }
  }
  return { device, behavioral, identity };
}

function exportCSV(data: Record<string, unknown>[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => {
      const v = row[h];
      const s = Array.isArray(v) ? v.join("; ") : String(v ?? "");
      return `"${s.replace(/"/g, '""')}"`;
    }).join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
}

// ─── Simulation Scenarios Config ─────────────────────────────────────────────

const SCENARIOS = [
  { id: "emulator_farm",     label: "Emulator Farm",     icon: Smartphone,    desc: "25 accounts · 1 device" },
  { id: "otp_attack",        label: "OTP Attack",         icon: ShieldAlert,   desc: "8 OTP failures (brute-force)" },
  { id: "referral_abuse",    label: "Referral Abuse",     icon: Users,         desc: "10 claims · same device" },
  { id: "rooted_wallet",     label: "Rooted Wallet",      icon: Shield,        desc: "Transfer on rooted device" },
  { id: "gps_spoofing",      label: "GPS Spoofing",       icon: MapPin,        desc: "Spoofed location login" },
  { id: "account_sharing",   label: "Account Sharing",    icon: Share2,        desc: "1 user · 4 devices" },
  { id: "account_takeover",  label: "Account Takeover",   icon: AlertTriangle, desc: "Cred stuffing + ATO" },
  { id: "checkout_fraud",    label: "Checkout Fraud",     icon: CreditCard,    desc: "Rooted + VPN payment" },
  { id: "bot_farm",          label: "Bot Farm",           icon: Bot,           desc: "Automated bots · uniform cadence" },
  { id: "app_cloning_abuse", label: "App Cloning Abuse",  icon: Copy,          desc: "Cloned app · multi-account" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ title, value, icon, colorClass, border, bg, onClick }: {
  title: string; value: number; icon: React.ReactNode;
  colorClass: string; border: string; bg: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`relative p-5 rounded-2xl border ${border} ${bg} flex items-center justify-between group hover:scale-[1.02] transition-all duration-200
        ${onClick ? "cursor-pointer hover:shadow-md" : ""}`}
    >
      <div>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">{title}</p>
        <p className={`text-3xl font-bold tabular-nums ${colorClass}`}>{value}</p>
      </div>
      <div className="p-3 bg-white rounded-xl border border-gray-200 shadow-sm">{icon}</div>
      {onClick && (
        <span className="absolute bottom-2 right-3 text-[9px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity font-semibold flex items-center gap-0.5">
          View all <ArrowRight className="w-2.5 h-2.5" />
        </span>
      )}
    </div>
  );
}

function FlagChip({ show, label, color }: { show: boolean; label: string; color: string }) {
  if (!show) return null;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${color}`}>{label}</span>;
}

function RiskBar({ score }: { score: number }) {
  const barColor = score >= 61 ? "bg-rose-500" : score >= 31 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="w-full bg-gray-200 rounded-full h-1 mt-1.5">
      <div className={`h-1 rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${score}%` }} />
    </div>
  );
}

function RiskTrendChart({ data }: { data: TrendPoint[] }) {
  const W = 300, H = 72;
  const [pl, pr, pt, pb] = [4, 4, 6, 4];
  const cW = W - pl - pr, cH = H - pt - pb;

  const allVals = data.flatMap(d => [d.safe, d.suspicious, d.fraud]);
  const maxVal = Math.max(...allVals, 1);
  const n = data.length;

  const gx = (i: number) => pl + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
  const gy = (v: number) => pt + cH - (v / maxVal) * cH;

  const line = (key: keyof Omit<TrendPoint, "t">) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${gx(i).toFixed(1)},${gy(d[key]).toFixed(1)}`).join(" ");

  const area = (key: keyof Omit<TrendPoint, "t">) => {
    if (data.length < 2) return "";
    const pts = data.map((d, i) => `${gx(i).toFixed(1)},${gy(d[key]).toFixed(1)}`).join(" L");
    return `M${pl},${pt + cH} L${pts} L${gx(n - 1).toFixed(1)},${pt + cH} Z`;
  };

  if (data.length < 2) {
    return (
      <div className="h-18 flex items-center justify-center text-gray-400 text-xs py-6">
        Waiting for events…
      </div>
    );
  }

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 72 }}>
        <path d={area("safe")}       fill="rgba(52,211,153,0.12)" />
        <path d={area("suspicious")} fill="rgba(251,191,36,0.12)" />
        <path d={area("fraud")}      fill="rgba(248,113,113,0.15)" />
        <path d={line("safe")}       fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={line("suspicious")} fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={line("fraud")}      fill="none" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex items-center gap-4 mt-2">
        {[["#34d399", "Safe"], ["#fbbf24", "Suspicious"], ["#f87171", "Fraud"]].map(([c, l]) => (
          <div key={l} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: c }} />
            <span className="text-[10px] text-gray-500">{l}</span>
          </div>
        ))}
        <span className="ml-auto text-[10px] text-gray-400">5s buckets</span>
      </div>
    </div>
  );
}

function ActionButton({ label, action, caseId, icon, styleClass, isPending, isDisabled, onAction }: {
  label: string; action: string; caseId: string; icon: React.ReactNode;
  styleClass: string; isPending: boolean; isDisabled: boolean;
  onAction: (caseId: string, action: string) => void;
}) {
  return (
    <button
      onClick={() => onAction(caseId, action)}
      disabled={isDisabled}
      className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-semibold border transition-all
        ${styleClass} ${isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
      {isPending ? "…" : label}
    </button>
  );
}

function RiskCard({ update, pendingAction, onAction }: {
  update: RiskUpdate;
  pendingAction: { caseId: string; action: string } | null;
  onAction: (caseId: string, action: string, notes?: string) => void;
}) {
  const [noteText, setNoteText] = useState("");
  const handleAction = (caseId: string, action: string) => onAction(caseId, action, noteText || undefined);
  const isFraud = update.category === "Fraud";
  const isSuspicious = update.category === "Suspicious";
  const isNonSafe = isFraud || isSuspicious;

  const borderColor = isFraud ? "border-rose-200" : isSuspicious ? "border-amber-200" : "border-emerald-200";
  const bgGlow     = isFraud ? "bg-rose-50/50"   : isSuspicious ? "bg-amber-50/50"   : "bg-emerald-50/50";
  const { device: deviceReasons, behavioral, identity } = categorizeReasons(update.reasons);
  const isReviewed = update.status === "reviewed";
  const isPendingThisCase = pendingAction?.caseId === update.case_id;

  return (
    <div className={`rounded-xl border ${borderColor} ${bgGlow} p-4 flex flex-col gap-3 transition-all`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Fingerprint className={`w-4 h-4 shrink-0 ${isFraud ? "text-rose-500" : isSuspicious ? "text-amber-500" : "text-emerald-500"}`} />
          <span className="font-mono text-[11px] text-gray-500">{update.case_id}</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${categoryBg(update.category)}`}>
            {update.category.toUpperCase()}
          </span>
          {update.recommended_action && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${actionColors(update.recommended_action)}`}>
              → {update.recommended_action}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className={`text-xl font-bold tabular-nums ${riskColor(update.risk_score)}`}>{update.risk_score}</span>
          <span className="text-[10px] text-gray-400">/100</span>
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
        <span className="px-2 py-0.5 rounded bg-gray-100 border border-gray-200 font-medium text-gray-600">{update.event_type}</span>
        <span className="truncate max-w-[120px]" title={update.user_id}>{update.user_id}</span>
        <span className="text-gray-300">·</span>
        <span className="truncate max-w-[120px]" title={update.device_id}>{update.device_id}</span>
        <span className="ml-auto text-gray-400">{formatFeedTime(update.timestamp)}</span>
      </div>

      {/* Signals */}
      {(deviceReasons.length > 0 || behavioral.length > 0 || identity.length > 0) && (
        <div className="space-y-2">
          {deviceReasons.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Cpu className="w-3 h-3 text-rose-500" />
                <span className="text-[10px] uppercase font-semibold tracking-wider text-rose-600">Device Intelligence</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {deviceReasons.map((r, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-800">{r}</span>
                ))}
              </div>
            </div>
          )}
          {behavioral.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Zap className="w-3 h-3 text-amber-500" />
                <span className="text-[10px] uppercase font-semibold tracking-wider text-amber-600">Behavioral</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {behavioral.map((r, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800">{r}</span>
                ))}
              </div>
            </div>
          )}
          {identity.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Network className="w-3 h-3 text-indigo-500" />
                <span className="text-[10px] uppercase font-semibold tracking-wider text-indigo-600">Identity Network</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {identity.map((r, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-800">{r}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Explanation */}
      {update.explanation && update.explanation !== "Device and behavioral signals are within normal parameters. No action required." && (
        <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200">
          <div className="flex items-center gap-1.5 mb-1.5 text-indigo-600">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Gemini AI Analysis</span>
          </div>
          <p className="text-[12px] text-indigo-700 leading-relaxed">{update.explanation}</p>
        </div>
      )}

      {/* Action area */}
      {isReviewed ? (
        <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-gray-50 border border-gray-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="text-xs text-gray-600">
              Reviewed by <span className="text-gray-800 font-medium">{update.analyst}</span>
              {" — "}
              <span className={`font-bold ${actionColors(update.analyst_action).split(" ")[1]}`}>
                {update.analyst_action?.toUpperCase()}
              </span>
            </span>
            {update.decided_at && (
              <span className="ml-auto text-[10px] text-gray-400 shrink-0">{formatTime(update.decided_at * 1000)}</span>
            )}
          </div>
          {(update as RiskUpdate & { notes?: string }).notes && (
            <p className="text-[11px] text-gray-500 italic pl-6">&ldquo;{(update as RiskUpdate & { notes?: string }).notes}&rdquo;</p>
          )}
        </div>
      ) : isNonSafe ? (
        <div className="flex flex-col gap-1.5 pt-1">
          <textarea
            rows={2}
            placeholder="Add analyst notes (optional)…"
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-indigo-400 resize-none"
          />
          <div className="flex items-center gap-1.5">
            <ActionButton label="Allow"     action="Allow"     caseId={update.case_id} icon={<CheckCircle2   className="w-3 h-3" />} styleClass="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" isPending={isPendingThisCase && pendingAction?.action === "Allow"}     isDisabled={!!isPendingThisCase} onAction={handleAction} />
            <ActionButton label="Monitor"   action="Monitor"   caseId={update.case_id} icon={<Eye            className="w-3 h-3" />} styleClass="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"             isPending={isPendingThisCase && pendingAction?.action === "Monitor"}   isDisabled={!!isPendingThisCase} onAction={handleAction} />
            <ActionButton label="Challenge" action="Challenge" caseId={update.case_id} icon={<ShieldQuestion className="w-3 h-3" />} styleClass="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"           isPending={isPendingThisCase && pendingAction?.action === "Challenge"} isDisabled={!!isPendingThisCase} onAction={handleAction} />
            <ActionButton label="Block"     action="Block"     caseId={update.case_id} icon={<Ban            className="w-3 h-3" />} styleClass="bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"               isPending={isPendingThisCase && pendingAction?.action === "Block"}     isDisabled={!!isPendingThisCase} onAction={handleAction} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IdentityGraph({ nodes, edges, focalId }: { nodes: GraphNode[]; edges: GraphEdge[]; focalId: string }) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    if (nodes.length === 0) return;
    const W = 560, H = 360, cx = W / 2, cy = H / 2;
    // deterministic seed based on node ids (no Math.random)
    const pos: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * 2 * Math.PI;
      pos[n.id] = { x: cx + 140 * Math.cos(angle), y: cy + 120 * Math.sin(angle), vx: 0, vy: 0 };
    });
    // focal node centered
    if (pos[focalId]) { pos[focalId].x = cx; pos[focalId].y = cy; }

    for (let iter = 0; iter < 120; iter++) {
      // repulsion
      const ids = Object.keys(pos);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos[ids[i]], b = pos[ids[j]];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const f = 4000 / (dist * dist);
          a.vx += (dx / dist) * f; a.vy += (dy / dist) * f;
          b.vx -= (dx / dist) * f; b.vy -= (dy / dist) * f;
        }
      }
      // attraction along edges
      for (const e of edges) {
        const a = pos[e.source], b = pos[e.target];
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const f = (dist - 100) * 0.04;
        a.vx += (dx / dist) * f; a.vy += (dy / dist) * f;
        b.vx -= (dx / dist) * f; b.vy -= (dy / dist) * f;
      }
      // centering + dampen
      for (const id of ids) {
        const n = pos[id];
        n.vx += (cx - n.x) * 0.01; n.vy += (cy - n.y) * 0.01;
        n.x += n.vx * 0.6; n.y += n.vy * 0.6;
        n.vx *= 0.5; n.vy *= 0.5;
        n.x = Math.max(30, Math.min(W - 30, n.x));
        n.y = Math.max(24, Math.min(H - 24, n.y));
      }
    }
    const final: Record<string, { x: number; y: number }> = {};
    for (const id of Object.keys(pos)) final[id] = { x: pos[id].x, y: pos[id].y };
    setPositions(final);
  }, [nodes, edges, focalId]);

  const nodeColor = (type: GraphNode["type"]) => {
    if (type === "device") return "#6366f1";
    if (type === "user")   return "#0ea5e9";
    if (type === "ip")     return "#f97316";
    return "#10b981";
  };

  if (Object.keys(positions).length === 0) return <div className="h-full flex items-center justify-center text-gray-400 text-xs">Laying out graph…</div>;

  return (
    <div className="w-full h-full flex flex-col">
      <svg viewBox="0 0 560 360" className="flex-1 w-full">
        {edges.map((e, i) => {
          const a = positions[e.source], b = positions[e.target];
          if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e2e8f0" strokeWidth="1.5" />;
        })}
        {nodes.map(n => {
          const p = positions[n.id];
          if (!p) return null;
          const isFocal = n.id === focalId;
          const r = isFocal ? 22 : 16;
          const color = nodeColor(n.type);
          return (
            <g key={n.id}>
              {isFocal && <circle cx={p.x} cy={p.y} r={r + 5} fill="none" stroke={color} strokeWidth="2" strokeOpacity="0.3" />}
              <circle cx={p.x} cy={p.y} r={r} fill={color} />
              <text x={p.x} y={p.y + r + 11} textAnchor="middle" fontSize="9" fill="#6b7280">{n.label.slice(0, 14)}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-4 px-3 pb-2">
        {([["device","#6366f1","Device"],["user","#0ea5e9","User"],["ip","#f97316","IP"],["email","#10b981","Email"]] as const).map(([,c,l]) => (
          <div key={l} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c }} />
            <span className="text-[10px] text-gray-500">{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeviceRow({ device, trust, isExpanded, onToggle, onViewGraph, riskUpdates }: {
  device: DeviceProfile; trust?: DeviceTrust;
  isExpanded: boolean; onToggle: () => void;
  onViewGraph: () => void;
  riskUpdates: RiskUpdate[];
}) {
  const scoreColor  = device.maxRisk >= 61 ? "text-rose-600"  : device.maxRisk >= 31 ? "text-amber-600"  : "text-emerald-600";
  const borderColor = device.maxRisk >= 61 ? "border-rose-200"  : device.maxRisk >= 31 ? "border-amber-200"  : "border-emerald-200";
  const accentColor = device.maxRisk >= 61 ? "#e11d48" : device.maxRisk >= 31 ? "#d97706" : "#059669";

  const timelineEvents = riskUpdates
    .filter(r => r.device_id === device.device_id)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-10);
  const lastAnomalousIdx = timelineEvents
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.category !== "Safe")
    .map(({ i }) => i).at(-1) ?? -1;

  return (
    <div className={`rounded-xl border ${borderColor} overflow-hidden`} style={{ borderLeftWidth: "3px", borderLeftColor: accentColor }}>
      {/* Clickable header */}
      <div className="p-4 flex items-start gap-3 cursor-pointer hover:bg-gray-50/60 transition-colors" onClick={onToggle}>
        <div className="shrink-0 pt-0.5">
          <div className={`text-xl font-bold tabular-nums ${scoreColor}`}>{device.maxRisk}</div>
          <RiskBar score={device.maxRisk} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="font-mono text-[11px] text-gray-700 truncate">{device.device_id}</span>
            {trust && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold border ${trust.trust_score >= 65 ? "bg-rose-50 text-rose-700 border-rose-200" : trust.trust_score >= 40 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                TRUST {Math.round(trust.trust_score)} · {trust.fraud_count} fraud
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            <FlagChip show={device.isEmulator}   label="EMULATOR"  color="bg-amber-50 text-amber-700 border-amber-200" />
            <FlagChip show={device.isRooted}     label="ROOTED"    color="bg-rose-50 text-rose-700 border-rose-200" />
            <FlagChip show={device.hasVPN}       label="VPN"       color="bg-blue-50 text-blue-700 border-blue-200" />
            <FlagChip show={device.isGPSSpoofed} label="GPS SPOOF" color="bg-orange-50 text-orange-700 border-orange-200" />
            <FlagChip show={device.hasAppTamper} label="TAMPERED"  color="bg-red-50 text-red-700 border-red-200" />
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
            <span>{device.totalEvents} events</span>
            <span className="text-gray-300">·</span>
            <span className={device.linkedUsers.length > 2 ? "text-rose-600 font-semibold" : ""}>{device.linkedUsers.length} linked account{device.linkedUsers.length !== 1 ? "s" : ""}</span>
            <span className="text-gray-300">·</span>
            <span>{timeAgo(device.lastSeen)}</span>
            <button
              onClick={e => { e.stopPropagation(); onViewGraph(); }}
              className="text-[10px] px-2 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors shrink-0"
            >
              View Graph
            </button>
          </div>
          {device.topReasons.slice(0, 2).map((r, i) => (
            <div key={i} className="mt-1 text-[11px] text-gray-400 truncate">• {r}</div>
          ))}
        </div>
        <div className="shrink-0 self-center pl-1">
          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {/* Timeline expansion */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-2">
          {timelineEvents.length === 0 ? (
            <p className="text-[11px] text-gray-400 italic">No events in current feed</p>
          ) : (
            <>
              <div className="flex items-center gap-1.5 mb-3 text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                <Clock className="w-3 h-3" /> Device Timeline · Last {timelineEvents.length} events
              </div>
              <div className="relative pl-5">
                <div className="absolute left-[7px] top-0 bottom-0 border-l-2 border-dashed border-gray-200" />
                {timelineEvents.map((ev, i) => {
                  const isLast = i === lastAnomalousIdx;
                  const dotColor = ev.category === "Fraud" ? "bg-rose-500" : ev.category === "Suspicious" ? "bg-amber-400" : "bg-emerald-400";
                  return (
                    <div key={ev.case_id} className={`relative flex items-center gap-2 py-1.5 px-1.5 mb-0.5 rounded-lg ${isLast ? "bg-rose-50/60 border border-rose-100" : ""}`}>
                      <div className={`absolute left-[-13px] top-[9px] w-2.5 h-2.5 rounded-full border-2 border-white ${dotColor}`} />
                      <span className="text-[10px] text-gray-400 font-mono shrink-0 w-16">
                        {new Date(ev.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className={`text-[11px] font-bold tabular-nums shrink-0 w-6 ${riskColor(ev.risk_score)}`}>{ev.risk_score}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${categoryBg(ev.category)}`}>
                        {ev.category.toUpperCase()}
                      </span>
                      <div className="flex flex-wrap gap-1 min-w-0">
                        {ev.reasons.slice(0, 3).map((r, ri) => (
                          <span key={ri} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200 text-gray-600 truncate max-w-[90px]">{r}</span>
                        ))}
                        {ev.reasons.length > 3 && <span className="text-[9px] text-gray-400">+{ev.reasons.length - 3}</span>}
                      </div>
                      {isLast && <span className="ml-auto text-[9px] text-rose-500 font-bold shrink-0 whitespace-nowrap">Latest anomaly</span>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AccountRow({ account }: { account: AccountProfile }) {
  const scoreColor  = account.maxRisk >= 61 ? "text-rose-600"   : account.maxRisk >= 31 ? "text-amber-600"   : "text-emerald-600";
  const borderColor = account.maxRisk >= 61 ? "border-rose-200 bg-rose-50/40" : account.maxRisk >= 31 ? "border-amber-200 bg-amber-50/40" : "border-emerald-200 bg-emerald-50/40";
  const accentColor = account.maxRisk >= 61 ? "#e11d48" : account.maxRisk >= 31 ? "#d97706" : "#059669";

  return (
    <div
      className={`p-4 rounded-xl border ${borderColor} flex items-start gap-3`}
      style={{ borderLeftWidth: "3px", borderLeftColor: accentColor }}
    >
      <div className="shrink-0 pt-0.5">
        <div className={`text-xl font-bold tabular-nums ${scoreColor}`}>{account.maxRisk}</div>
        <RiskBar score={account.maxRisk} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span className="font-mono text-[11px] text-gray-700 truncate">{account.user_id}</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span>{account.totalEvents} events</span>
          <span className="text-gray-300">·</span>
          <span className={account.linkedDevices.length > 2 ? "text-amber-600 font-semibold" : ""}>{account.linkedDevices.length} device{account.linkedDevices.length !== 1 ? "s" : ""}</span>
          <span className="text-gray-300">·</span>
          <span className={`font-medium ${categoryBg(account.lastCategory).split(" ")[1]}`}>{account.lastCategory}</span>
          <span className="text-gray-300">·</span>
          <span>{timeAgo(account.lastSeen)}</span>
        </div>
        {account.topReasons.slice(0, 2).map((r, i) => (
          <div key={i} className="mt-1 text-[11px] text-gray-400 truncate">• {r}</div>
        ))}
      </div>
    </div>
  );
}

function DecisionRow({ entry }: { entry: DecisionEntry }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-[10px] text-gray-400 font-mono shrink-0 w-[58px]">{formatTime(entry.timestamp * 1000)}</span>
      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border shrink-0 ${actionColors(entry.action)}`}>{entry.action.toUpperCase()}</span>
      <span className={`text-[11px] font-bold tabular-nums shrink-0 w-6 ${riskColor(entry.risk_score)}`}>{entry.risk_score}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200 text-gray-600 shrink-0">{entry.event_type}</span>
      <span className="text-[11px] text-gray-500 truncate min-w-0 flex-1" title={entry.user_id}>{entry.user_id}</span>
    </div>
  );
}

function TelemetryRow({ event }: { event: DevEvent }) {
  const device = event.device || {};
  const ts = parseInt(event.timestamp);
  return (
    <div className="p-3 rounded-xl border border-gray-100 bg-white hover:bg-gray-50 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Smartphone className="w-4 h-4 text-cyan-500 shrink-0" />
          <span className="text-xs font-medium text-gray-700 truncate">{event.event_type}</span>
          {device.rooted   && <span className="text-[10px] text-rose-600 font-bold">ROOTED</span>}
          {device.emulator && <span className="text-[10px] text-amber-600 font-bold">EMU</span>}
        </div>
        <span className="text-[10px] text-gray-400 font-mono shrink-0">{isNaN(ts) ? "--" : formatTime(ts)}</span>
      </div>
      <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
        <span className="truncate max-w-[130px]" title={event.device_id}>{event.device_id}</span>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [events, setEvents]               = useState<DevEvent[]>([]);
  const [riskUpdates, setRiskUpdates]     = useState<RiskUpdate[]>([]);
  const [decisions, setDecisions]         = useState<DecisionEntry[]>([]);
  const [isConnected, setIsConnected]     = useState(false);
  const [activeTab, setActiveTab]         = useState<Tab>("feed");
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ caseId: string; action: string } | null>(null);
  const [trendData, setTrendData]         = useState<TrendPoint[]>([]);
  const trendBucket = useRef({ safe: 0, suspicious: 0, fraud: 0 });
  const [policies, setPolicies]           = useState<Policy[]>([]);
  const [deviceTrustScores, setDeviceTrustScores] = useState<Record<string, DeviceTrust>>({});
  const [thresholds, setThresholds]       = useState<Record<string, number>>({});
  const [riskFilter, setRiskFilter]       = useState<"all" | "fraud" | "suspicious" | "safe">("all");
  const [searchQuery, setSearchQuery]     = useState("");
  const [expandedDevice, setExpandedDevice]   = useState<string | null>(null);
  const [feedClearedAt, setFeedClearedAt]     = useState<number | null>(null);
  const [dateFilter, setDateFilter]           = useState<"all" | "30m" | "1h" | "today">("all");
  const [feedDeviceFilter, setFeedDeviceFilter] = useState("");
  const [graphDeviceId, setGraphDeviceId]     = useState("");
  const [graphData, setGraphData]             = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [graphLoading, setGraphLoading]       = useState(false);

  // ── Derived state ────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const deviceIds = new Set<string>();
    const userIds   = new Set<string>();
    let safe = 0, suspicious = 0, fraud = 0;
    for (const u of riskUpdates) {
      if (u.device_id) deviceIds.add(u.device_id);
      if (u.user_id)   userIds.add(u.user_id);
      if (u.category === "Safe") safe++;
      else if (u.category === "Suspicious") suspicious++;
      else if (u.category === "Fraud") fraud++;
    }
    return { total: riskUpdates.length, safe, suspicious, fraud, devices: deviceIds.size, users: userIds.size };
  }, [riskUpdates]);

  const deviceProfiles = useMemo((): DeviceProfile[] => {
    const map: Record<string, DeviceProfile> = {};
    for (const u of riskUpdates) {
      if (!u.device_id) continue;
      if (!map[u.device_id]) {
        map[u.device_id] = {
          device_id: u.device_id, maxRisk: 0, totalEvents: 0, linkedUsers: [],
          lastCategory: "Safe", lastSeen: 0, topReasons: [],
          isEmulator: false, isRooted: false, hasVPN: false, isGPSSpoofed: false, hasAppTamper: false,
        };
      }
      const d = map[u.device_id];
      d.maxRisk = Math.max(d.maxRisk, u.risk_score);
      d.totalEvents++;
      if (!d.linkedUsers.includes(u.user_id)) d.linkedUsers.push(u.user_id);
      if (u.timestamp > d.lastSeen) { d.lastCategory = u.category; d.lastSeen = u.timestamp; }
      for (const r of u.reasons) {
        if (!d.topReasons.includes(r) && d.topReasons.length < 5) d.topReasons.push(r);
        if (r.includes("Emulator") || r.includes("emulator")) d.isEmulator = true;
        if (r.includes("Rooted")   || r.includes("rooted"))   d.isRooted   = true;
        if (r.includes("VPN")      || r.includes("vpn"))      d.hasVPN     = true;
        if (r.includes("GPS")      || r.includes("gps"))      d.isGPSSpoofed  = true;
        if (r.includes("tamper")   || r.includes("Tamper"))   d.hasAppTamper  = true;
      }
    }
    return Object.values(map).sort((a, b) => b.maxRisk - a.maxRisk);
  }, [riskUpdates]);

  const accountProfiles = useMemo((): AccountProfile[] => {
    const map: Record<string, AccountProfile> = {};
    for (const u of riskUpdates) {
      if (!u.user_id) continue;
      if (!map[u.user_id]) {
        map[u.user_id] = {
          user_id: u.user_id, maxRisk: 0, totalEvents: 0, linkedDevices: [],
          lastCategory: "Safe", lastSeen: 0, topReasons: [],
        };
      }
      const a = map[u.user_id];
      a.maxRisk = Math.max(a.maxRisk, u.risk_score);
      a.totalEvents++;
      if (!a.linkedDevices.includes(u.device_id)) a.linkedDevices.push(u.device_id);
      if (u.timestamp > a.lastSeen) { a.lastCategory = u.category; a.lastSeen = u.timestamp; }
      for (const r of u.reasons) {
        if (!a.topReasons.includes(r) && a.topReasons.length < 4) a.topReasons.push(r);
      }
    }
    return Object.values(map).sort((a, b) => b.maxRisk - a.maxRisk);
  }, [riskUpdates]);

  const highRiskDevices  = useMemo(() => deviceProfiles.filter(d => d.maxRisk >= 31),  [deviceProfiles]);
  const highRiskAccounts = useMemo(() => accountProfiles.filter(a => a.maxRisk >= 31), [accountProfiles]);

  const filteredRiskUpdates = useMemo(() => {
    const now = Date.now();
    return riskUpdates.filter(u => {
      if (feedClearedAt !== null && u.timestamp * 1000 <= feedClearedAt) return false;
      if (riskFilter !== "all" && u.category.toLowerCase() !== riskFilter) return false;
      if (dateFilter === "30m" && (now - u.timestamp * 1000) > 30 * 60 * 1000) return false;
      if (dateFilter === "1h"  && (now - u.timestamp * 1000) > 60 * 60 * 1000) return false;
      if (dateFilter === "today") {
        const d = new Date(u.timestamp * 1000), t = new Date();
        if (d.getDate() !== t.getDate() || d.getMonth() !== t.getMonth() || d.getFullYear() !== t.getFullYear()) return false;
      }
      if (feedDeviceFilter.trim() && !u.device_id.toLowerCase().includes(feedDeviceFilter.toLowerCase())) return false;
      return true;
    });
  }, [riskUpdates, riskFilter, feedClearedAt, dateFilter, feedDeviceFilter]);

  const filteredDevices = useMemo(() => {
    if (!searchQuery.trim()) return highRiskDevices;
    const q = searchQuery.toLowerCase();
    return highRiskDevices.filter(d => d.device_id.toLowerCase().includes(q));
  }, [highRiskDevices, searchQuery]);

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return highRiskAccounts;
    const q = searchQuery.toLowerCase();
    return highRiskAccounts.filter(a => a.user_id.toLowerCase().includes(q));
  }, [highRiskAccounts, searchQuery]);

  // ── WebSocket ────────────────────────────────────────────────────────────────

  useEffect(() => {
    let ws: WebSocket;
    const connect = () => {
      ws = new WebSocket("ws://localhost:8000/ws");
      ws.onopen  = () => setIsConnected(true);
      ws.onclose = () => { setIsConnected(false); setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "NEW_EVENT") {
          setEvents(prev => [msg.data, ...prev].slice(0, 150));
        } else if (msg.type === "RISK_UPDATE") {
          const cat = (msg.data.category as string).toLowerCase() as "safe" | "suspicious" | "fraud";
          trendBucket.current[cat] = (trendBucket.current[cat] || 0) + 1;
          setRiskUpdates(prev => {
            const idx = prev.findIndex(u => u.case_id === msg.data.case_id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], ...msg.data };
              return next;
            }
            return [msg.data, ...prev].slice(0, 300);
          });
        } else if (msg.type === "CASE_UPDATED") {
          setRiskUpdates(prev => prev.map(u => u.case_id === msg.data.case_id ? { ...u, ...msg.data } : u));
          setPendingAction(null);
        } else if (msg.type === "DECISION_LOGGED") {
          setDecisions(prev => [msg.data, ...prev].slice(0, 300));
        } else if (msg.type === "THRESHOLD_UPDATED") {
          setThresholds(msg.data);
        }
      };
    };
    connect();
    return () => ws?.close();
  }, []);

  useEffect(() => {
    fetch("http://localhost:8000/api/v1/policies")
      .then(r => r.json())
      .then(d => setPolicies(d.policies ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("http://localhost:8000/api/v1/thresholds")
      .then(r => r.json())
      .then(d => setThresholds(d.thresholds ?? {}))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab !== "devices") return;
    const ids = highRiskDevices.map(d => d.device_id).slice(0, 20);
    ids.forEach(id => {
      fetch(`http://localhost:8000/api/v1/devices/${encodeURIComponent(id)}/trust`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setDeviceTrustScores(prev => ({ ...prev, [id]: d })); })
        .catch(() => {});
    });
  }, [activeTab, highRiskDevices]);

  const updateThreshold = useCallback(async (key: string, value: number) => {
    const updated = { ...thresholds, [key]: value };
    setThresholds(updated);
    await fetch("http://localhost:8000/api/v1/thresholds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    }).catch(() => {});
  }, [thresholds]);

  const togglePolicy = useCallback(async (policyId: string, enabled: boolean) => {
    await fetch(`http://localhost:8000/api/v1/policies/${policyId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => {});
    setPolicies(prev => prev.map(p => p.id === policyId ? { ...p, enabled } : p));
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const { safe, suspicious, fraud } = trendBucket.current;
      setTrendData(prev => [...prev.slice(-19), { t: Date.now(), safe, suspicious, fraud }]);
      trendBucket.current = { safe: 0, suspicious: 0, fraud: 0 };
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const runScenario = useCallback(async (scenario: string) => {
    setRunningScenario(scenario);
    try {
      await fetch(`http://localhost:8000/api/v1/scenarios/run?scenario=${scenario}`, { method: "POST" });
      setTimeout(() => setRunningScenario(null), 4000);
    } catch {
      setRunningScenario(null);
    }
  }, []);

  const submitAction = useCallback(async (caseId: string, action: string, notes?: string) => {
    setPendingAction({ caseId, action });
    try {
      await fetch(`http://localhost:8000/api/v1/cases/${caseId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, analyst: "analyst_01", notes: notes ?? null }),
      });
    } catch {
      setPendingAction(null);
    }
  }, []);

  const fetchGraph = useCallback(async (deviceId: string) => {
    if (!deviceId.trim()) return;
    setGraphLoading(true);
    try {
      const res = await fetch(`http://localhost:8000/api/v1/graph/${encodeURIComponent(deviceId)}`);
      const data = await res.json();
      setGraphData(data);
    } catch { setGraphData(null); }
    finally { setGraphLoading(false); }
  }, []);

  const tabs = [
    { id: "feed"     as Tab, label: "Live Risk Feed",     icon: Activity,  count: riskUpdates.filter(u => u.category !== "Safe").length },
    { id: "devices"  as Tab, label: "High-Risk Devices",  icon: Server,    count: highRiskDevices.length },
    { id: "accounts" as Tab, label: "High-Risk Accounts", icon: Users,     count: highRiskAccounts.length },
    { id: "history"  as Tab, label: "Audit Trail",        icon: History,   count: decisions.length },
    { id: "policies" as Tab, label: "Risk Policies",      icon: Settings,  count: policies.filter(p => p.enabled).length },
    { id: "graph"    as Tab, label: "Identity Graph",     icon: Network,   count: 0 },
  ];

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 selection:bg-indigo-200/60">

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur-xl px-6 xl:px-10 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-xl border border-indigo-100">
            <Shield className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-indigo-600 to-blue-500 bg-clip-text text-transparent leading-none">
              Ajna
            </h1>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold mt-0.5">
              Mobile Device Intelligence
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-4 text-[11px] text-gray-500">
            <span>{stats.total} evaluations</span>
            <span className="text-gray-300">|</span>
            <span>{stats.devices} devices</span>
            <span className="text-gray-300">|</span>
            <span>{stats.users} accounts</span>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium
            ${isConnected
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : "bg-gray-100 border-gray-200 text-gray-500"}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-gray-400"}`} />
            {isConnected ? "Live Stream Active" : "Connecting…"}
          </div>
        </div>
      </header>

      <main className="px-4 xl:px-8 py-6 max-w-[1600px] mx-auto">

        {/* ── KPI Bar ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
          <StatCard title="Total Evaluations" value={stats.total}      icon={<ActivitySquare className="w-5 h-5 text-blue-500" />}    colorClass="text-gray-900"    border="border-blue-200"    bg="bg-blue-50"    onClick={() => { setActiveTab("feed"); setRiskFilter("all"); }} />
          <StatCard title="Safe Sessions"      value={stats.safe}       icon={<ShieldCheck    className="w-5 h-5 text-emerald-500" />} colorClass="text-emerald-600" border="border-emerald-200" bg="bg-emerald-50" onClick={() => { setActiveTab("feed"); setRiskFilter("safe"); }} />
          <StatCard title="Suspicious"         value={stats.suspicious} icon={<AlertTriangle  className="w-5 h-5 text-amber-500" />}   colorClass="text-amber-600"   border="border-amber-200"   bg="bg-amber-50"   onClick={() => { setActiveTab("feed"); setRiskFilter("suspicious"); }} />
          <StatCard title="Fraud Blocked"      value={stats.fraud}      icon={<ShieldAlert    className="w-5 h-5 text-rose-500" />}    colorClass="text-rose-600"    border="border-rose-200"    bg="bg-rose-50"    onClick={() => { setActiveTab("feed"); setRiskFilter("fraud"); }} />
          <StatCard title="Unique Devices"     value={stats.devices}    icon={<Smartphone     className="w-5 h-5 text-cyan-500" />}    colorClass="text-cyan-600"    border="border-cyan-200"    bg="bg-cyan-50"    onClick={() => setActiveTab("devices")} />
          <StatCard title="Unique Accounts"    value={stats.users}      icon={<User           className="w-5 h-5 text-violet-500" />}  colorClass="text-violet-600"  border="border-violet-200"  bg="bg-violet-50"  onClick={() => setActiveTab("accounts")} />
        </div>

        {/* ── Three-column grid ── */}
        <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr_268px] gap-5">

          {/* ── Left Panel ── */}
          <div className="space-y-5">

            {/* Simulation Engine */}
            <div className="bg-white border border-gray-200 shadow-sm rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-purple-50 to-transparent">
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-purple-600" />
                  <h3 className="font-semibold text-sm text-gray-800">Simulation Engine</h3>
                </div>
                <span className="text-[10px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full border border-purple-200 font-bold">LIVE DEMO</span>
              </div>
              <div className="p-4 grid grid-cols-2 gap-2">
                {SCENARIOS.map(({ id, label, icon: Icon, desc }) => {
                  const isRunning = runningScenario === id;
                  return (
                    <button
                      key={id}
                      onClick={() => runScenario(id)}
                      disabled={!!runningScenario}
                      className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all
                        ${isRunning
                          ? "border-purple-400 bg-purple-50 shadow-sm"
                          : "border-gray-200 bg-gray-50 hover:border-purple-300 hover:bg-purple-50"}
                        ${runningScenario && !isRunning ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <div className="flex items-center gap-1.5">
                        {isRunning
                          ? <Loader2 className="w-3.5 h-3.5 text-purple-600 animate-spin" />
                          : <Icon className="w-3.5 h-3.5 text-gray-400" />}
                        <span className="text-[11px] font-semibold text-gray-800">{label}</span>
                      </div>
                      <span className="text-[10px] text-gray-500">{desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Risk Trend Chart */}
            <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-indigo-500" />
                <h3 className="font-semibold text-sm text-gray-800">Risk Trend</h3>
                <span className="ml-auto text-[10px] text-gray-400">Rolling 100s</span>
              </div>
              <RiskTrendChart data={trendData} />
            </div>
          </div>

          {/* ── Center Panel ── */}
          <div className="bg-white border border-gray-200 shadow-sm rounded-2xl overflow-hidden flex flex-col" style={{ height: 740 }}>

            {/* Tab bar */}
            <div className="flex items-center gap-0 border-b border-gray-200 bg-gray-50/80 overflow-x-auto shrink-0">
              {tabs.map(({ id, label, icon: Icon, count }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors shrink-0
                    ${activeTab === id
                      ? "border-indigo-500 text-indigo-600 bg-indigo-50"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  {count > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold
                      ${activeTab === id ? "bg-indigo-100 text-indigo-700" : "bg-gray-200 text-gray-600"}`}>
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">

              {/* ── Live Risk Feed ── */}
              {activeTab === "feed" && (
                <div className="p-4 space-y-3">
                  {/* Filter pills + Clear Feed */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {(["all", "fraud", "suspicious", "safe"] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setRiskFilter(f)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors
                          ${riskFilter === f
                            ? f === "fraud"       ? "bg-rose-100 text-rose-700 border-rose-300"
                            : f === "suspicious"  ? "bg-amber-100 text-amber-700 border-amber-300"
                            : f === "safe"        ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                            :                       "bg-indigo-100 text-indigo-700 border-indigo-300"
                            : "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200"
                          }`}
                      >
                        {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                    {riskUpdates.length > 0 && (
                      <button
                        onClick={() => setFeedClearedAt(Date.now())}
                        className="ml-auto px-3 py-1 rounded-full text-xs font-semibold border bg-gray-100 text-gray-500 border-gray-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors"
                      >
                        Clear Feed
                      </button>
                    )}
                    {feedClearedAt !== null && (() => {
                      const n = riskUpdates.filter(u => u.timestamp * 1000 <= feedClearedAt).length;
                      return (
                        <button onClick={() => setFeedClearedAt(null)}
                          className="px-3 py-1 rounded-full text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 transition-colors">
                          Show All ({n} hidden)
                        </button>
                      );
                    })()}
                  </div>

                  {/* Date + device filter row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    {(["all", "30m", "1h", "today"] as const).map(d => (
                      <button key={d} onClick={() => setDateFilter(d)}
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border transition-colors
                          ${dateFilter === d ? "bg-indigo-100 text-indigo-700 border-indigo-300" : "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200"}`}>
                        {d === "all" ? "All Time" : d === "today" ? "Today" : d}
                      </button>
                    ))}
                    <div className="relative ml-auto">
                      <input type="text" placeholder="Filter by device…" value={feedDeviceFilter}
                        onChange={e => setFeedDeviceFilter(e.target.value)}
                        className="pl-7 pr-2 py-1 text-[11px] border border-gray-200 rounded-lg bg-white text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-indigo-400 w-36" />
                      <Smartphone className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                    </div>
                  </div>

                  {riskUpdates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-56 text-gray-400">
                      <Activity className="w-12 h-12 mb-4 opacity-20" />
                      <p className="text-sm">Run a simulation scenario to see live risk evaluations</p>
                    </div>
                  ) : filteredRiskUpdates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                      <Activity className="w-10 h-10 mb-3 opacity-20" />
                      <p className="text-sm">No events match the current filters</p>
                      {feedClearedAt !== null && (
                        <button onClick={() => setFeedClearedAt(null)}
                          className="mt-2 text-xs text-indigo-500 hover:text-indigo-700 underline underline-offset-2">
                          Show cleared events
                        </button>
                      )}
                    </div>
                  ) : (
                    filteredRiskUpdates.map((u, i) => (
                      <RiskCard key={u.case_id || i} update={u} pendingAction={pendingAction} onAction={submitAction} />
                    ))
                  )}
                </div>
              )}

              {/* ── High-Risk Devices ── */}
              {activeTab === "devices" && (
                <div className="p-4 space-y-2">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search by device ID…"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-indigo-400"
                    />
                    <Server className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  </div>
                  {highRiskDevices.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-56 text-gray-400">
                      <Server className="w-12 h-12 mb-4 opacity-20" />
                      <p className="text-sm">No high-risk devices detected yet</p>
                    </div>
                  ) : filteredDevices.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                      <Server className="w-10 h-10 mb-3 opacity-20" />
                      <p className="text-sm">No devices match &ldquo;{searchQuery}&rdquo;</p>
                    </div>
                  ) : (
                    filteredDevices.map(d => (
                      <DeviceRow
                        key={d.device_id}
                        device={d}
                        trust={deviceTrustScores[d.device_id]}
                        isExpanded={expandedDevice === d.device_id}
                        onToggle={() => setExpandedDevice(expandedDevice === d.device_id ? null : d.device_id)}
                        onViewGraph={() => { setGraphDeviceId(d.device_id); setActiveTab("graph"); fetchGraph(d.device_id); }}
                        riskUpdates={riskUpdates}
                      />
                    ))
                  )}
                </div>
              )}

              {/* ── High-Risk Accounts ── */}
              {activeTab === "accounts" && (
                <div className="p-4 space-y-2">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search by user ID…"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-indigo-400"
                    />
                    <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  </div>
                  {highRiskAccounts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-56 text-gray-400">
                      <Users className="w-12 h-12 mb-4 opacity-20" />
                      <p className="text-sm">No high-risk accounts detected yet</p>
                    </div>
                  ) : filteredAccounts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                      <Users className="w-10 h-10 mb-3 opacity-20" />
                      <p className="text-sm">No accounts match &ldquo;{searchQuery}&rdquo;</p>
                    </div>
                  ) : (
                    filteredAccounts.map(a => <AccountRow key={a.user_id} account={a} />)
                  )}
                </div>
              )}

              {/* ── Audit Trail ── */}
              {activeTab === "history" && (
                <div className="p-4">
                  {decisions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                      <ClipboardList className="w-12 h-12 mb-4 opacity-20" />
                      <p className="text-sm">No analyst decisions recorded yet</p>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-3 pb-2 mb-1 text-[10px] uppercase tracking-wider text-gray-400 font-semibold border-b border-gray-200">
                        <span className="w-[58px]">Time</span>
                        <span className="w-20">Action</span>
                        <span className="w-6">Risk</span>
                        <span>Event</span>
                        <span className="flex-1">Account</span>
                        <button
                          onClick={() => exportCSV(decisions as unknown as Record<string, unknown>[], "ajna_audit_trail.csv")}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-100 border border-gray-200 hover:bg-gray-200 text-gray-600 text-[10px] font-semibold transition-colors"
                        >
                          <Download className="w-3 h-3" />
                          Export CSV
                        </button>
                      </div>
                      {decisions.map((d, i) => <DecisionRow key={d.case_id + i} entry={d} />)}
                    </div>
                  )}
                </div>
              )}

              {/* ── Risk Policies ── */}
              {activeTab === "policies" && (
                <div className="p-4 space-y-5 overflow-y-auto" style={{ maxHeight: 680 }}>

                  <div>
                    <p className="text-[11px] text-gray-500 mb-3">Toggle signals on/off. Changes take effect on the next evaluated event.</p>
                    {policies.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-28 text-gray-400">
                        <Settings className="w-8 h-8 mb-2 opacity-20" />
                        <p className="text-xs">Loading policies…</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {policies.map(p => (
                          <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${p.enabled ? "border-indigo-200 bg-indigo-50" : "border-gray-200 bg-gray-50 opacity-60"}`}>
                            <button onClick={() => togglePolicy(p.id, !p.enabled)} className="shrink-0">
                              {p.enabled
                                ? <ToggleRight className="w-5 h-5 text-indigo-600" />
                                : <ToggleLeft  className="w-5 h-5 text-gray-300" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] font-semibold text-gray-800">{p.name}</div>
                              <div className="text-[10px] text-gray-500 font-mono">{p.signal}</div>
                            </div>
                            <div className="shrink-0 text-right">
                              <span className={`text-[11px] font-bold tabular-nums ${p.score_delta >= 25 ? "text-rose-600" : p.score_delta >= 15 ? "text-amber-600" : "text-blue-600"}`}>
                                +{p.score_delta}
                              </span>
                              <div className="text-[9px] text-gray-400 uppercase">pts</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {Object.keys(thresholds).length > 0 && (() => {
                    const groups: { label: string; keys: string[] }[] = [
                      { label: "Scoring Thresholds", keys: ["category_suspicious","category_fraud","action_challenge","action_block"] },
                      { label: "OTP Velocity",        keys: ["otp_window_secs","otp_tier1_count","otp_tier1_delta","otp_tier2_count","otp_tier2_delta"] },
                      { label: "Login Velocity",      keys: ["login_window_secs","login_tier1_count","login_tier1_delta","login_tier2_count","login_tier2_delta"] },
                      { label: "Referral Velocity",   keys: ["referral_window_secs","referral_tier1_count","referral_tier1_delta","referral_tier2_count","referral_tier2_delta"] },
                      { label: "Bot Detection",       keys: ["bot_cadence_variance_max","bot_timing_variance_max","bot_timing_avg_delta_max"] },
                      { label: "Session Signals",     keys: ["session_window_secs","session_escalation_delta","session_repeat_delta","session_spike_delta"] },
                    ];
                    return (
                      <div className="border-t border-gray-200 pt-4 space-y-4">
                        <p className="text-[11px] text-gray-500">Edit scoring thresholds. Changes take effect on the next evaluated event.</p>
                        {groups.map(g => (
                          <div key={g.label}>
                            <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-2">{g.label}</div>
                            <div className="space-y-1">
                              {g.keys.filter(k => k in thresholds).map(k => (
                                <div key={k} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
                                  <span className="flex-1 text-[11px] font-mono text-gray-600">{k}</span>
                                  <input
                                    type="number"
                                    defaultValue={thresholds[k]}
                                    key={`${k}-${thresholds[k]}`}
                                    onBlur={e => {
                                      const v = parseFloat(e.target.value);
                                      if (!isNaN(v) && v !== thresholds[k]) updateThreshold(k, v);
                                    }}
                                    className="w-20 text-right text-[11px] tabular-nums bg-white border border-gray-300 rounded px-2 py-1 text-gray-800 focus:outline-none focus:border-indigo-400"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                        <button
                          onClick={() => fetch("http://localhost:8000/api/v1/thresholds/reset", { method: "POST" }).then(r => r.json()).then(d => setThresholds(d.thresholds ?? {})).catch(() => {})}
                          className="text-[11px] text-gray-400 hover:text-rose-600 transition-colors underline underline-offset-2"
                        >
                          Reset all to defaults
                        </button>
                      </div>
                    );
                  })()}

                </div>
              )}
            </div>
          </div>

          {/* ── Right Panel — Device Telemetry ── */}
          <div className="bg-white border border-gray-200 shadow-sm rounded-2xl overflow-hidden flex flex-col" style={{ height: 740 }}>
            <div className="px-4 py-3.5 border-b border-gray-200 flex items-center gap-2 bg-gray-50 shrink-0">
              <Smartphone className="w-4 h-4 text-cyan-500" />
              <h3 className="font-semibold text-sm text-gray-800">Device Telemetry</h3>
              <span className="ml-auto text-[10px] text-gray-400">{events.length} events</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                  <Smartphone className="w-12 h-12 mb-4 opacity-20" />
                  <p className="text-xs text-center">Waiting for device signals…</p>
                </div>
              ) : (
                events.map((ev, i) => <TelemetryRow key={ev.event_id || i} event={ev} />)
              )}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-[10px] text-gray-400 pb-4">
          Ajna — Mobile Device Intelligence &amp; Fraud Risk Accelerator · All data is synthetic and for demonstration purposes only
        </div>
      </main>
    </div>
  );
}
