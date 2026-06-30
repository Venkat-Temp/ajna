"use client";

import * as React from "react";
import {
  Search, Server, Sparkles, Clock, Zap, Activity, Inbox, Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAjna } from "@/lib/store";
import {
  type RiskUpdate, timeAgo, formatClock, categoryVariant, riskText, friendlyFeature, severityWord, currency,
} from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RiskTrajectory, RiskSparkline } from "@/components/risk-trajectory";

const LIVE_WINDOW_MS = 45_000;

function cadence(events: RiskUpdate[]) {
  if (events.length < 3) return null;
  const ts = events.map(e => e.timestamp).sort((a, b) => a - b);
  const gaps = ts.slice(1).map((t, i) => t - ts[i]).filter(g => g >= 0);
  if (!gaps.length) return null;
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((a, b) => a + (b - avg) ** 2, 0) / gaps.length;
  const cv = avg > 0 ? Math.sqrt(variance) / avg : 1; // coefficient of variation
  const burst = avg < 1.5 && cv < 0.5; // tight + uniform → automation tell
  return { avg, perMin: avg > 0 ? 60 / avg : 0, burst };
}

export default function LivePage() {
  const { riskUpdates, deviceProfiles, now, askCopilotForCase } = useAjna();
  const [query, setQuery] = React.useState("");
  const [pickedDevice, setPickedDevice] = React.useState<string | null>(null);
  const [selectedCase, setSelectedCase] = React.useState<string | null>(null);

  // active devices, most-recent first
  const devices = React.useMemo(
    () => deviceProfiles.slice().sort((a, b) => b.lastSeen - a.lastSeen),
    [deviceProfiles]
  );
  const filtered = query.trim()
    ? devices.filter(d => d.device_id.toLowerCase().includes(query.toLowerCase()))
    : devices;

  // Derive selection (no effect): the user's pick, else the most-recent device.
  const selectedDevice = pickedDevice ?? devices[0]?.device_id ?? null;
  const setSelectedDevice = setPickedDevice;
  const profile = devices.find(d => d.device_id === selectedDevice) ?? null;
  const deviceEvents = React.useMemo(
    () => (selectedDevice ? riskUpdates.filter(r => r.device_id === selectedDevice) : []),
    [riskUpdates, selectedDevice]
  );
  const ordered = React.useMemo(
    () => deviceEvents.slice().sort((a, b) => b.timestamp - a.timestamp),
    [deviceEvents]
  );
  const latest = ordered[0];
  const selectedEvent = ordered.find(e => e.case_id === selectedCase) ?? latest;
  const cad = cadence(deviceEvents);
  const isLive = (d: { lastSeen: number }) => now - d.lastSeen * 1000 < LIVE_WINDOW_MS;
  // selectedEvent falls back to `latest` when the picked case isn't in this device's
  // events (e.g. after switching devices), so no reset effect is needed.

  return (
    <div className="flex h-full">
      {/* ── Left: active devices ─────────────────────────────────────── */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search devices…" className="h-8 pl-8 text-xs" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="grid place-items-center py-16 text-center text-xs text-muted-foreground">
              <div><Inbox className="mx-auto mb-2 size-7 opacity-30" />No active devices.<br />Run a simulation.</div>
            </div>
          ) : filtered.map(d => {
            const active = d.device_id === selectedDevice;
            const live = isLive(d);
            return (
              <button
                key={d.device_id}
                onClick={() => setSelectedDevice(d.device_id)}
                className={cn(
                  "mb-1 flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors",
                  active ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted/60"
                )}
              >
                <span className="relative flex size-2 shrink-0">
                  {live && <span className="absolute inline-flex size-2 rounded-full bg-safe ajna-pulse" />}
                  <span className={cn("relative inline-flex size-2 rounded-full", live ? "bg-safe" : "bg-muted-foreground/40")} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs">{d.device_id}</div>
                  <div className="text-[10px] text-muted-foreground">{d.totalEvents} events · {timeAgo(d.lastSeen, now)}</div>
                </div>
                <RiskSparkline events={riskUpdates.filter(r => r.device_id === d.device_id)} className="h-6 w-12 shrink-0" />
                <span className={cn("w-6 text-right text-sm font-bold tabular-nums", riskText(d.maxRisk))}>{d.maxRisk}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: session monitor ───────────────────────────────────── */}
      {!profile ? (
        <div className="grid flex-1 place-items-center text-center text-muted-foreground">
          <div><Activity className="mx-auto mb-3 size-10 opacity-30" /><p className="text-sm">Select a device to watch its session live.</p></div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4 md:p-5">
          {/* Detail header */}
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <Server className="size-4 text-muted-foreground" />
              <span className="font-mono text-sm font-medium">{profile.device_id}</span>
              {isLive(profile) ? (
                <Badge variant="safe" className="gap-1"><span className="size-1.5 rounded-full bg-safe ajna-pulse" /> Live</Badge>
              ) : (
                <Badge variant="muted">Idle</Badge>
              )}
            </div>
            <HeaderStat label="Current risk" value={latest ? latest.risk_score : "—"} cls={latest ? riskText(latest.risk_score) : ""} />
            <HeaderStat label="Peak" value={profile.maxRisk} cls={riskText(profile.maxRisk)} />
            <HeaderStat label="Events" value={profile.totalEvents} />
            <HeaderStat label="Accounts" value={profile.linkedUsers.length} />
            {cad && (
              <div className="flex items-center gap-1.5 text-xs">
                <Clock className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">{cad.perMin >= 1 ? `${cad.perMin.toFixed(0)}/min` : `${cad.avg.toFixed(1)}s gap`}</span>
                {cad.burst && <Badge variant="fraud" className="gap-1"><Zap className="size-3" /> Burst</Badge>}
              </div>
            )}
            {latest?.session_id && (
              <span className="text-[11px] text-muted-foreground">session <span className="font-mono">{latest.session_id.slice(0, 10)}</span></span>
            )}
          </div>

          {/* Device flags */}
          {(profile.isEmulator || profile.isRooted || profile.hasVPN || profile.isGPSSpoofed || profile.hasAppTamper) && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {profile.isEmulator && <Badge variant="fraud">Emulator</Badge>}
              {profile.isRooted && <Badge variant="fraud">Rooted</Badge>}
              {profile.hasVPN && <Badge variant="suspicious">VPN</Badge>}
              {profile.isGPSSpoofed && <Badge variant="suspicious">GPS spoof</Badge>}
              {profile.hasAppTamper && <Badge variant="fraud">Tampered</Badge>}
            </div>
          )}

          {/* HERO — risk trajectory */}
          <Card className="mb-4 p-3">
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Activity className="size-3.5" /> Risk trajectory · watch the session escalate
            </div>
            <div className="h-64">
              <RiskTrajectory events={deviceEvents} selectedCaseId={selectedEvent?.case_id} onSelect={setSelectedCase} />
            </div>
          </Card>

          {/* Synced: event list + selected detail */}
          <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            {/* compact event list */}
            <Card className="overflow-hidden">
              <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Session events ({ordered.length})
              </div>
              <div className="max-h-72 overflow-y-auto">
                {ordered.map((e, i) => {
                  const sel = e.case_id === selectedEvent?.case_id;
                  return (
                    <button
                      key={e.case_id}
                      onClick={() => setSelectedCase(e.case_id)}
                      className={cn(
                        "flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left text-xs transition-colors last:border-0",
                        sel ? "bg-primary/5" : "hover:bg-muted/50",
                        i === 0 && "animate-in fade-in slide-in-from-top-1"
                      )}
                    >
                      <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">{formatClock(e.timestamp)}</span>
                      <span className={cn("w-6 shrink-0 text-right font-bold tabular-nums", riskText(e.risk_score))}>{e.risk_score}</span>
                      <Badge variant={categoryVariant(e.category)} className="shrink-0">{e.category}</Badge>
                      <span className="truncate font-mono text-[11px]">{e.event_type}</span>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* selected event detail */}
            <Card className="p-4">
              {!selectedEvent ? (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">No event selected.</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-2xl font-bold tabular-nums", riskText(selectedEvent.risk_score))}>{selectedEvent.risk_score}</span>
                    <Badge variant={categoryVariant(selectedEvent.category)}>{selectedEvent.category}</Badge>
                    <span className="font-mono text-sm">{selectedEvent.event_type}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{formatClock(selectedEvent.timestamp)}</span>
                  </div>

                  {/* behavioral deviation */}
                  {(selectedEvent.behavioral_deviations?.length ?? 0) > 0 && (
                    <div className="rounded-lg border border-ai/30 bg-ai/5 p-2.5">
                      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ai">
                        <Brain className="size-3.5" /> Behavioral deviation
                      </div>
                      <ul className="space-y-0.5">
                        {selectedEvent.behavioral_deviations!.slice(0, 4).map((d, i) => (
                          <li key={i} className="text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground">{d.label ?? friendlyFeature(d.feature)}</span>{" is "}
                            {d.severity ?? severityWord(d.sigma)} from normal
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* signals */}
                  {selectedEvent.reasons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedEvent.reasons.map((r, i) => (
                        <span key={i} className="rounded border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">{r}</span>
                      ))}
                    </div>
                  )}

                  {/* business context */}
                  {selectedEvent.context && Object.keys(selectedEvent.context).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(selectedEvent.context).map(([k, v]) => (
                        <span key={k} className="rounded border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                          {k}: <span className="text-foreground">{k === "amount" && typeof v === "number" ? currency(v) : String(v)}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* AI explanation */}
                  {selectedEvent.explanation && selectedEvent.category !== "Safe" && (
                    <div className="rounded-lg bg-muted/50 p-2.5 text-[12px] leading-relaxed text-muted-foreground">
                      <Sparkles className="mr-1 inline size-3 text-ai" />{selectedEvent.explanation}
                    </div>
                  )}

                  <Button variant="outline" size="sm" onClick={() => askCopilotForCase(selectedEvent.case_id)}>
                    <Sparkles className="size-3.5 text-ai" /> Ask AI about this event
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function HeaderStat({ label, value, cls }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-bold tabular-nums", cls)}>{value}</div>
    </div>
  );
}
