"use client";

import * as React from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from "recharts";
import { DollarSign, Target, Brain, Activity, Loader2, TrendingUp } from "lucide-react";
import { useAjna } from "@/lib/store";
import { currency } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

// Fixed, theme-agnostic chart palette (reads well on dark + light).
const C = { primary: "#38BDF8", safe: "#34D399", suspicious: "#FBBF24", fraud: "#FB7185", violet: "#A78BFA" };
const CAT_COLOR: Record<string, string> = { Safe: C.safe, Suspicious: C.suspicious, Fraud: C.fraud };

export default function ImpactPage() {
  const { summary, summaryLoading, refreshSummary, trendData } = useAjna();
  React.useEffect(() => { refreshSummary(); }, [refreshSummary]);

  if (summaryLoading && !summary) {
    return <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground"><Loader2 className="size-5 animate-spin" /> Loading impact metrics…</div>;
  }
  if (!summary) {
    return <div className="grid place-items-center py-24 text-center text-muted-foreground"><div><TrendingUp className="mx-auto mb-3 size-10 opacity-30" /><p className="text-sm">No summary available.</p></div></div>;
  }

  const o = summary.outcomes ?? { confirmed_fraud: 0, false_positive: 0, legit: 0, unlabeled: 0 };
  const catData = Object.entries(summary.by_category ?? {}).map(([name, value]) => ({ name, value }));
  const actionData = Object.entries(summary.by_recommended_action ?? {}).map(([name, value]) => ({ name, value }));

  // top_signals can arrive as [{signal,count}], [name,count][], or {name:count}
  const rawSignals = summary.top_signals;
  const normalized: { name: string; value: number }[] = Array.isArray(rawSignals)
    ? rawSignals.map((s) =>
        Array.isArray(s)
          ? { name: String(s[0]), value: Number(s[1]) }
          : { name: String(s.signal), value: Number(s.count) }
      )
    : Object.entries(rawSignals ?? {}).map(([name, value]) => ({ name, value: Number(value) }));
  const signalData = normalized
    .slice(0, 8)
    .map(({ name, value }) => ({ name: name.length > 34 ? name.slice(0, 34) + "…" : name, value }));
  const outcomeData = [
    { name: "Confirmed fraud", value: o.confirmed_fraud, color: C.fraud },
    { name: "False positive", value: o.false_positive, color: C.suspicious },
    { name: "Legit", value: o.legit, color: C.safe },
    { name: "Unlabeled", value: o.unlabeled, color: "#94a3b8" },
  ];

  const kpis = [
    { label: "Exposure blocked", value: currency(summary.exposure_blocked ?? 0), icon: DollarSign, cls: "text-safe" },
    { label: "Precision", value: summary.precision == null ? "—" : `${Math.round(summary.precision * 100)}%`, icon: Target, cls: "text-primary" },
    { label: "Behavioral catches", value: summary.behavioral_catches ?? 0, icon: Brain, cls: "text-ai" },
    { label: "Total events", value: summary.total_events ?? 0, icon: Activity, cls: "text-foreground" },
  ];

  const axis = { fontSize: 11, stroke: "currentColor", opacity: 0.5 };
  const tooltipStyle = {
    background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
    borderRadius: 8, fontSize: 12, color: "hsl(var(--popover-foreground))",
  };

  return (
    <div className="space-y-4 p-4 md:p-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(k => (
          <Card key={k.label} className="p-4">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <k.icon className="size-3.5" /> {k.label}
            </div>
            <div className={`mt-1 text-2xl font-bold tabular-nums ${k.cls}`}>{k.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Live trend */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Live risk trend</CardTitle></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ left: -20, right: 8, top: 4 }}>
                <defs>
                  {(["fraud", "suspicious", "safe"] as const).map(k => (
                    <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C[k]} stopOpacity={0.5} />
                      <stop offset="95%" stopColor={C[k]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.08} />
                <XAxis dataKey="t" tick={false} {...axis} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} {...axis} />
                <RTooltip contentStyle={tooltipStyle} labelFormatter={() => ""} />
                <Area type="monotone" dataKey="fraud" stroke={C.fraud} fill="url(#g-fraud)" />
                <Area type="monotone" dataKey="suspicious" stroke={C.suspicious} fill="url(#g-suspicious)" />
                <Area type="monotone" dataKey="safe" stroke={C.safe} fill="url(#g-safe)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Outcomes */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Decision outcomes</CardTitle></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={outcomeData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {outcomeData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <RTooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-3 text-[11px]">
              {outcomeData.map(d => (
                <span key={d.name} className="inline-flex items-center gap-1 text-muted-foreground">
                  <span className="size-2 rounded-full" style={{ background: d.color }} /> {d.name} ({d.value})
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* By category */}
        <Card>
          <CardHeader><CardTitle className="text-sm">By category</CardTitle></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={catData} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.08} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} {...axis} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} {...axis} />
                <RTooltip contentStyle={tooltipStyle} cursor={{ fill: "currentColor", opacity: 0.05 }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {catData.map((d, i) => <Cell key={i} fill={CAT_COLOR[d.name] ?? C.primary} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recommended actions */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Recommended actions</CardTitle></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={actionData} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.08} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} {...axis} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} {...axis} />
                <RTooltip contentStyle={tooltipStyle} cursor={{ fill: "currentColor", opacity: 0.05 }} />
                <Bar dataKey="value" fill={C.primary} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top signals */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Most frequent signals</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={signalData} margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.08} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} {...axis} />
              <YAxis type="category" dataKey="name" width={220} tick={{ fontSize: 11 }} {...axis} />
              <RTooltip contentStyle={tooltipStyle} cursor={{ fill: "currentColor", opacity: 0.05 }} />
              <Bar dataKey="value" fill={C.violet} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
