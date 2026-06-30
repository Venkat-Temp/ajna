"use client";

import * as React from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  ReferenceLine, Tooltip as RTooltip, LineChart,
} from "recharts";
import type { RiskUpdate } from "@/lib/types";
import { formatClock } from "@/lib/types";

const CAT_COLOR: Record<string, string> = { Safe: "#34D399", Suspicious: "#FBBF24", Fraud: "#FB7185" };
const PRIMARY = "#38BDF8";

function colorFor(score: number) {
  if (score >= 61) return CAT_COLOR.Fraud;
  if (score >= 31) return CAT_COLOR.Suspicious;
  return CAT_COLOR.Safe;
}

type Point = { t: number; risk: number; category: string; case_id: string; event_type: string };

function toPoints(events: RiskUpdate[]): Point[] {
  return events
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(e => ({ t: e.timestamp, risk: e.risk_score, category: e.category, case_id: e.case_id, event_type: e.event_type }));
}

/** Full live risk-trajectory chart for one device's session. */
export function RiskTrajectory({
  events,
  selectedCaseId,
  onSelect,
}: {
  events: RiskUpdate[];
  selectedCaseId?: string | null;
  onSelect?: (caseId: string) => void;
}) {
  const data = React.useMemo(() => toPoints(events), [events]);
  const lastIdx = data.length - 1;

  if (data.length === 0) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">No events yet for this device.</div>;
  }

  const renderDot = (props: { cx?: number; cy?: number; index?: number; payload?: Point }) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null || !payload) return <g key={index} />;
    const c = colorFor(payload.risk);
    const isSelected = payload.case_id === selectedCaseId;
    const isLast = index === lastIdx;
    return (
      <g key={payload.case_id} style={{ cursor: "pointer" }} onClick={() => onSelect?.(payload.case_id)}>
        {isLast && <circle cx={cx} cy={cy} r={9} fill="none" stroke={c} strokeWidth={2} className="ajna-pulse" />}
        <circle cx={cx} cy={cy} r={isSelected ? 6 : 4} fill={c} stroke="hsl(var(--card))" strokeWidth={isSelected ? 2 : 1.5} />
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.28} />
            <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* threshold bands */}
        <ReferenceLine y={31} stroke={CAT_COLOR.Suspicious} strokeDasharray="4 4" strokeOpacity={0.6}
          label={{ value: "Suspicious", position: "insideTopLeft", fill: CAT_COLOR.Suspicious, fontSize: 10 }} />
        <ReferenceLine y={61} stroke={CAT_COLOR.Fraud} strokeDasharray="4 4" strokeOpacity={0.6}
          label={{ value: "Fraud", position: "insideTopLeft", fill: CAT_COLOR.Fraud, fontSize: 10 }} />

        <XAxis
          dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="linear"
          tickFormatter={(v: number) => formatClock(v)}
          tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.5} minTickGap={48}
        />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.5} width={28} />
        <RTooltip
          contentStyle={{
            background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))",
            borderRadius: 8, fontSize: 12, color: "hsl(var(--popover-foreground))",
          }}
          labelFormatter={(v) => formatClock(Number(v))}
          formatter={(val) => [`${val}`, "risk"] as [string, string]}
        />
        <Area type="monotone" dataKey="risk" stroke="none" fill="url(#riskFill)" isAnimationActive={false} />
        <Line type="monotone" dataKey="risk" stroke={PRIMARY} strokeWidth={2} isAnimationActive={false}
          dot={renderDot} activeDot={{ r: 6 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Tiny inline sparkline of a device's recent risk — for list rows / header. */
export function RiskSparkline({ events, className }: { events: RiskUpdate[]; className?: string }) {
  const data = React.useMemo(() => toPoints(events).slice(-24), [events]);
  if (data.length < 2) return <div className={className} />;
  const stroke = colorFor(data[data.length - 1].risk);
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, bottom: 3, left: 0, right: 0 }}>
          <YAxis domain={[0, 100]} hide />
          <Line type="monotone" dataKey="risk" stroke={stroke} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
