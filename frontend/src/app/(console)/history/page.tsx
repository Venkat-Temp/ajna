"use client";

import * as React from "react";
import { Download, History } from "lucide-react";
import { useAjna } from "@/lib/store";
import { formatClock, categoryVariant } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function HistoryPage() {
  const { decisions } = useAjna();

  const exportCsv = () => {
    const header = ["timestamp", "case_id", "action", "analyst", "category", "risk_score", "user_id", "device_id", "event_type", "reasons"];
    const rows = decisions.map(d => [
      new Date(d.timestamp * 1000).toISOString(), d.case_id, d.action, d.analyst, d.category,
      d.risk_score, d.user_id, d.device_id, d.event_type, `"${(d.reasons ?? []).join("; ")}"`,
    ].join(","));
    const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ajna-audit-trail.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 p-4 md:p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{decisions.length} analyst decisions logged this session.</p>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={decisions.length === 0}>
          <Download className="size-4" /> Export CSV
        </Button>
      </div>

      {decisions.length === 0 ? (
        <Card className="grid place-items-center py-20 text-center text-muted-foreground">
          <div><History className="mx-auto mb-3 size-10 opacity-30" /><p className="text-sm">No decisions logged yet.</p></div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Score</th>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Device</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Analyst</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d, i) => (
                  <tr key={`${d.case_id}-${i}`} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatClock(d.timestamp)}</td>
                    <td className="px-3 py-2"><Badge variant="outline">{d.action}</Badge></td>
                    <td className="px-3 py-2"><Badge variant={categoryVariant(d.category)}>{d.category}</Badge></td>
                    <td className="px-3 py-2 font-medium tabular-nums">{d.risk_score}</td>
                    <td className="px-3 py-2 font-mono text-xs">{d.user_id}</td>
                    <td className="px-3 py-2 font-mono text-xs">{d.device_id}</td>
                    <td className="px-3 py-2 font-mono text-xs">{d.event_type}</td>
                    <td className="px-3 py-2 text-muted-foreground">{d.analyst}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
