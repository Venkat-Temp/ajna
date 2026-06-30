"use client";

import * as React from "react";
import { API, WS_URL } from "@/lib/utils";
import type {
  Policy, DeviceTrust, RiskUpdate, EntityProfile, FraudRing, ReportSummary,
  CopilotResponse, CopilotMessage, DevEvent, TrendPoint, DecisionEntry,
  DeviceProfile, AccountProfile, OutcomeLabel,
} from "@/lib/types";

interface AjnaState {
  // live data
  isConnected: boolean;
  now: number;
  events: DevEvent[];
  riskUpdates: RiskUpdate[];
  decisions: DecisionEntry[];
  policies: Policy[];
  thresholds: Record<string, number>;
  deviceTrustScores: Record<string, DeviceTrust>;
  trendData: TrendPoint[];
  rings: FraudRing[];
  ringsLoading: boolean;
  summary: ReportSummary | null;
  summaryLoading: boolean;

  // derived
  stats: { total: number; safe: number; suspicious: number; fraud: number; devices: number; users: number };
  deviceProfiles: DeviceProfile[];
  accountProfiles: AccountProfile[];
  highRiskDevices: DeviceProfile[];
  highRiskAccounts: AccountProfile[];

  // transient action state
  runningScenario: string | null;
  pendingAction: { caseId: string; action: string } | null;

  // graph
  graphDeviceId: string;
  graphData: { nodes: { id: string; type: "device" | "user" | "ip" | "email"; label: string }[]; edges: { source: string; target: string }[] } | null;
  graphLoading: boolean;

  // entity modal
  entityOpen: boolean;
  entityLoading: boolean;
  entityProfile: EntityProfile | null;

  // copilot
  copilotOpen: boolean;
  copilotBusy: boolean;
  copilotCaseId: string | null;
  copilotMessages: CopilotMessage[];

  // actions
  runScenario: (s: string) => void;
  submitAction: (caseId: string, action: string, notes?: string) => void;
  submitOutcome: (caseId: string, label: OutcomeLabel) => void;
  togglePolicy: (id: string, enabled: boolean) => void;
  updateThreshold: (key: string, value: number) => void;
  fetchDeviceTrust: (ids: string[]) => void;
  loadGraph: (deviceId: string) => void;
  refreshRings: () => void;
  refreshSummary: () => void;
  openEntity: (type: "user" | "device", id: string) => void;
  setEntityOpen: (open: boolean) => void;
  openCopilot: (caseId?: string | null) => void;
  setCopilotOpen: (open: boolean) => void;
  askCopilot: (question: string, caseId?: string | null) => void;
  askCopilotForCase: (caseId: string) => void;
}

const AjnaContext = React.createContext<AjnaState | null>(null);

export function useAjna(): AjnaState {
  const ctx = React.useContext(AjnaContext);
  if (!ctx) throw new Error("useAjna must be used within <AjnaProvider>");
  return ctx;
}

export function AjnaProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const [events, setEvents] = React.useState<DevEvent[]>([]);
  const [riskUpdates, setRiskUpdates] = React.useState<RiskUpdate[]>([]);
  const [decisions, setDecisions] = React.useState<DecisionEntry[]>([]);
  const [policies, setPolicies] = React.useState<Policy[]>([]);
  const [thresholds, setThresholds] = React.useState<Record<string, number>>({});
  const [deviceTrustScores, setDeviceTrustScores] = React.useState<Record<string, DeviceTrust>>({});
  const [trendData, setTrendData] = React.useState<TrendPoint[]>([]);
  const trendBucket = React.useRef({ safe: 0, suspicious: 0, fraud: 0 });
  const [rings, setRings] = React.useState<FraudRing[]>([]);
  const [ringsLoading, setRingsLoading] = React.useState(false);
  const [summary, setSummary] = React.useState<ReportSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = React.useState(false);

  const [runningScenario, setRunningScenario] = React.useState<string | null>(null);
  const [pendingAction, setPendingAction] = React.useState<{ caseId: string; action: string } | null>(null);

  const [graphDeviceId, setGraphDeviceId] = React.useState("");
  const [graphData, setGraphData] = React.useState<AjnaState["graphData"]>(null);
  const [graphLoading, setGraphLoading] = React.useState(false);

  const [entityOpen, setEntityOpen] = React.useState(false);
  const [entityLoading, setEntityLoading] = React.useState(false);
  const [entityProfile, setEntityProfile] = React.useState<EntityProfile | null>(null);

  const [copilotOpen, setCopilotOpen] = React.useState(false);
  const [copilotBusy, setCopilotBusy] = React.useState(false);
  const [copilotCaseId, setCopilotCaseId] = React.useState<string | null>(null);
  const [copilotMessages, setCopilotMessages] = React.useState<CopilotMessage[]>([]);

  // ── WebSocket ──────────────────────────────────────────────────────────
  React.useEffect(() => {
    let ws: WebSocket;
    let closed = false;
    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setIsConnected(true);
      ws.onclose = () => { setIsConnected(false); if (!closed) setTimeout(connect, 3000); };
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
        } else if (msg.type === "POLICY_UPDATED") {
          setPolicies(prev => prev.map(p => p.id === msg.data.id ? { ...p, ...msg.data } : p));
        }
      };
    };
    connect();
    return () => { closed = true; ws?.close(); };
  }, []);

  // ticking clock for render-pure relative times
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // trend sampler
  React.useEffect(() => {
    const id = setInterval(() => {
      const { safe, suspicious, fraud } = trendBucket.current;
      setTrendData(prev => [...prev.slice(-23), { t: Date.now(), safe, suspicious, fraud }]);
      trendBucket.current = { safe: 0, suspicious: 0, fraud: 0 };
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // initial fetches
  React.useEffect(() => {
    fetch(`${API}/api/v1/policies`).then(r => r.json()).then(d => setPolicies(d.policies ?? [])).catch(() => {});
    fetch(`${API}/api/v1/thresholds`).then(r => r.json()).then(d => setThresholds(d.thresholds ?? {})).catch(() => {});
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────
  const stats = React.useMemo(() => {
    const deviceIds = new Set<string>(), userIds = new Set<string>();
    let safe = 0, suspicious = 0, fraud = 0;
    for (const u of riskUpdates) {
      if (u.device_id) deviceIds.add(u.device_id);
      if (u.user_id) userIds.add(u.user_id);
      if (u.category === "Safe") safe++;
      else if (u.category === "Suspicious") suspicious++;
      else if (u.category === "Fraud") fraud++;
    }
    return { total: riskUpdates.length, safe, suspicious, fraud, devices: deviceIds.size, users: userIds.size };
  }, [riskUpdates]);

  const deviceProfiles = React.useMemo((): DeviceProfile[] => {
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
        if (/emulator/i.test(r)) d.isEmulator = true;
        if (/rooted/i.test(r)) d.isRooted = true;
        if (/vpn/i.test(r)) d.hasVPN = true;
        if (/gps/i.test(r)) d.isGPSSpoofed = true;
        if (/tamper/i.test(r)) d.hasAppTamper = true;
      }
    }
    return Object.values(map).sort((a, b) => b.maxRisk - a.maxRisk);
  }, [riskUpdates]);

  const accountProfiles = React.useMemo((): AccountProfile[] => {
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

  const highRiskDevices = React.useMemo(() => deviceProfiles.filter(d => d.maxRisk >= 31), [deviceProfiles]);
  const highRiskAccounts = React.useMemo(() => accountProfiles.filter(a => a.maxRisk >= 31), [accountProfiles]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const runScenario = React.useCallback((s: string) => {
    setRunningScenario(s);
    fetch(`${API}/api/v1/scenarios/run?scenario=${s}`, { method: "POST" })
      .finally(() => setTimeout(() => setRunningScenario(null), 4000));
  }, []);

  const submitAction = React.useCallback((caseId: string, action: string, notes?: string) => {
    setPendingAction({ caseId, action });
    fetch(`${API}/api/v1/cases/${caseId}/action`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, analyst: "analyst_01", notes: notes ?? null }),
    }).catch(() => setPendingAction(null));
  }, []);

  const submitOutcome = React.useCallback((caseId: string, label: OutcomeLabel) => {
    setRiskUpdates(prev => prev.map(u => u.case_id === caseId ? { ...u, outcome: label, outcome_source: "manual" } : u));
    fetch(`${API}/api/v1/cases/${caseId}/outcome`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, source: "manual" }),
    }).catch(() => {});
  }, []);

  const togglePolicy = React.useCallback((id: string, enabled: boolean) => {
    setPolicies(prev => prev.map(p => p.id === id ? { ...p, enabled } : p));
    fetch(`${API}/api/v1/policies/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => {});
  }, []);

  const updateThreshold = React.useCallback((key: string, value: number) => {
    setThresholds(prev => ({ ...prev, [key]: value }));
    fetch(`${API}/api/v1/thresholds`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    }).catch(() => {});
  }, []);

  const fetchDeviceTrust = React.useCallback((ids: string[]) => {
    ids.slice(0, 20).forEach(id => {
      fetch(`${API}/api/v1/devices/${encodeURIComponent(id)}/trust`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setDeviceTrustScores(prev => ({ ...prev, [id]: d })); })
        .catch(() => {});
    });
  }, []);

  const loadGraph = React.useCallback((deviceId: string) => {
    if (!deviceId.trim()) return;
    setGraphDeviceId(deviceId);
    setGraphLoading(true);
    fetch(`${API}/api/v1/graph/${encodeURIComponent(deviceId)}`)
      .then(r => r.json())
      .then(d => setGraphData(d))
      .catch(() => setGraphData(null))
      .finally(() => setGraphLoading(false));
  }, []);

  const refreshRings = React.useCallback(() => {
    setRingsLoading(true);
    fetch(`${API}/api/v1/rings?min_accounts=3`)
      .then(r => r.json())
      .then(d => setRings(d.rings ?? []))
      .catch(() => setRings([]))
      .finally(() => setRingsLoading(false));
  }, []);

  const refreshSummary = React.useCallback(() => {
    setSummaryLoading(true);
    fetch(`${API}/api/v1/reports/summary`)
      .then(r => r.json())
      .then(d => setSummary(d))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false));
  }, []);

  const openEntity = React.useCallback((type: "user" | "device", id: string) => {
    setEntityOpen(true);
    setEntityLoading(true);
    setEntityProfile(null);
    fetch(`${API}/api/v1/entities/${type}/${encodeURIComponent(id)}/profile`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setEntityProfile(d))
      .catch(() => setEntityProfile(null))
      .finally(() => setEntityLoading(false));
  }, []);

  const askCopilot = React.useCallback((question: string, caseId?: string | null) => {
    setCopilotMessages(prev => [...prev, { role: "user", text: question }]);
    setCopilotBusy(true);
    // Gemini-backed; give it room (up to 60s) before giving up.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    (async () => {
      try {
        const res = await fetch(`${API}/api/v1/copilot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, case_id: caseId ?? undefined }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`backend responded ${res.status}`);
        const data: CopilotResponse = await res.json();
        setCopilotMessages(prev => [...prev, { role: "assistant", text: data.answer, grounded_on: data.grounded_on }]);
      } catch (err) {
        const reason = err instanceof DOMException && err.name === "AbortError"
          ? "the request timed out"
          : err instanceof Error ? err.message : "network error";
        console.error("Copilot request failed:", err);
        setCopilotMessages(prev => [...prev, {
          role: "assistant",
          text: `Couldn't reach the copilot (${reason}). Confirm the backend is running at ${API}.`,
          grounded_on: null,
        }]);
      } finally {
        clearTimeout(timer);
        setCopilotBusy(false);
      }
    })();
  }, []);

  const openCopilot = React.useCallback((caseId?: string | null) => {
    setCopilotCaseId(caseId ?? null);
    setCopilotOpen(true);
  }, []);

  const askCopilotForCase = React.useCallback((caseId: string) => {
    setCopilotCaseId(caseId);
    setCopilotOpen(true);
    askCopilot("Why was this case flagged, and what should the analyst do?", caseId);
  }, [askCopilot]);

  const value: AjnaState = {
    isConnected, now, events, riskUpdates, decisions, policies, thresholds,
    deviceTrustScores, trendData, rings, ringsLoading, summary, summaryLoading,
    stats, deviceProfiles, accountProfiles, highRiskDevices, highRiskAccounts,
    runningScenario, pendingAction,
    graphDeviceId, graphData, graphLoading,
    entityOpen, entityLoading, entityProfile,
    copilotOpen, copilotBusy, copilotCaseId, copilotMessages,
    runScenario, submitAction, submitOutcome, togglePolicy, updateThreshold,
    fetchDeviceTrust, loadGraph, refreshRings, refreshSummary,
    openEntity, setEntityOpen, openCopilot, setCopilotOpen, askCopilot, askCopilotForCase,
  };

  return <AjnaContext.Provider value={value}>{children}</AjnaContext.Provider>;
}
