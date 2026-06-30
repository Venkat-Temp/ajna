"use client";

import * as React from "react";
import { Activity, ShieldCheck, ShieldQuestion, ShieldAlert, Server, Users, Search, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAjna } from "@/lib/store";
import { RiskCard } from "@/components/risk-card";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type RiskFilter = "all" | "fraud" | "suspicious" | "safe";
type DateFilter = "all" | "30m" | "1h" | "today";

export default function FeedPage() {
  const { riskUpdates, stats, now } = useAjna();
  const [riskFilter, setRiskFilter] = React.useState<RiskFilter>("all");
  const [dateFilter, setDateFilter] = React.useState<DateFilter>("all");
  const [deviceFilter, setDeviceFilter] = React.useState("");
  const [clearedAt, setClearedAt] = React.useState<number | null>(null);

  const filtered = React.useMemo(() => riskUpdates.filter(u => {
    if (clearedAt !== null && u.timestamp * 1000 <= clearedAt) return false;
    if (riskFilter !== "all" && u.category.toLowerCase() !== riskFilter) return false;
    if (dateFilter === "30m" && (now - u.timestamp * 1000) > 30 * 60 * 1000) return false;
    if (dateFilter === "1h" && (now - u.timestamp * 1000) > 60 * 60 * 1000) return false;
    if (dateFilter === "today") {
      const d = new Date(u.timestamp * 1000), t = new Date(now);
      if (d.toDateString() !== t.toDateString()) return false;
    }
    if (deviceFilter.trim() && !u.device_id.toLowerCase().includes(deviceFilter.toLowerCase())) return false;
    return true;
  }), [riskUpdates, riskFilter, dateFilter, deviceFilter, clearedAt, now]);

  const kpis = [
    { label: "Events", value: stats.total, icon: Activity, cls: "text-foreground" },
    { label: "Safe", value: stats.safe, icon: ShieldCheck, cls: "text-safe" },
    { label: "Suspicious", value: stats.suspicious, icon: ShieldQuestion, cls: "text-suspicious" },
    { label: "Fraud", value: stats.fraud, icon: ShieldAlert, cls: "text-fraud" },
    { label: "Devices", value: stats.devices, icon: Server, cls: "text-foreground" },
    { label: "Accounts", value: stats.users, icon: Users, cls: "text-foreground" },
  ];

  return (
    <div className="space-y-4 p-4 md:p-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map(k => (
          <Card key={k.label} className="p-3">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <k.icon className="size-3.5" /> {k.label}
            </div>
            <div className={cn("mt-1 text-2xl font-bold tabular-nums", k.cls)}>{k.value}</div>
          </Card>
        ))}
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border p-0.5">
          {(["all", "fraud", "suspicious", "safe"] as RiskFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setRiskFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                riskFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-border p-0.5">
          {(["all", "30m", "1h", "today"] as DateFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setDateFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                dateFilter === f ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "all" ? "All time" : f}
            </button>
          ))}
        </div>
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={deviceFilter}
            onChange={e => setDeviceFilter(e.target.value)}
            placeholder="Filter by device id…"
            className="pl-8"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setClearedAt(Date.now())}>Clear feed</Button>
      </div>

      {/* Feed */}
      {filtered.length === 0 ? (
        <Card className="grid place-items-center py-20 text-center text-muted-foreground">
          <div>
            <Inbox className="mx-auto mb-3 size-10 opacity-30" />
            <p className="text-sm">No matching events yet.</p>
            <p className="text-xs">Run a simulation from the top bar to generate live traffic.</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {filtered.map(u => <RiskCard key={u.case_id} u={u} />)}
        </div>
      )}
    </div>
  );
}
