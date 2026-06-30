"use client";

import * as React from "react";
import { Settings, SlidersHorizontal } from "lucide-react";
import { useAjna } from "@/lib/store";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const THRESHOLD_FIELDS: { key: string; label: string }[] = [
  { key: "category_suspicious", label: "Suspicious ≥" },
  { key: "category_fraud", label: "Fraud ≥" },
  { key: "action_challenge", label: "Challenge ≥" },
  { key: "action_block", label: "Block ≥" },
  { key: "behavioral_deviation_sigma", label: "Behavioral σ flag" },
  { key: "behavioral_severe_sigma", label: "Severe σ (takeover)" },
  { key: "behavioral_deviation_delta", label: "Behavioral score" },
  { key: "known_bad_similarity_min", label: "Known-bad match" },
];

export default function PoliciesPage() {
  const { policies, togglePolicy, thresholds, updateThreshold } = useAjna();

  return (
    <div className="grid gap-4 p-4 md:p-5 lg:grid-cols-3">
      {/* Signal policies */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Settings className="size-4 text-primary" /> Detection signals</CardTitle>
          <CardDescription>Toggle each device-intelligence signal. Changes apply live across the engine.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {policies.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Loading policies…</p>}
          {policies.map(p => (
            <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <Badge variant="muted" className="font-mono">+{p.score_delta}</Badge>
                </div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">{p.signal}</div>
              </div>
              <Switch checked={p.enabled} onCheckedChange={(v) => togglePolicy(p.id, v)} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-primary" /> Thresholds</CardTitle>
          <CardDescription>Risk boundaries and behavioral sensitivity.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {THRESHOLD_FIELDS.map(f => (
            <div key={f.key} className="flex items-center justify-between gap-2">
              <label className="text-sm text-muted-foreground" htmlFor={f.key}>{f.label}</label>
              <Input
                id={f.key}
                type="number"
                step="any"
                defaultValue={thresholds[f.key] ?? ""}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!Number.isNaN(v) && v !== thresholds[f.key]) updateThreshold(f.key, v);
                }}
                className="h-8 w-24 text-right font-mono"
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
