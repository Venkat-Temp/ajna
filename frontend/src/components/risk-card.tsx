"use client";

import * as React from "react";
import {
  Brain, Cpu, Activity, Network, Sparkles, CheckCircle2, Eye, ShieldQuestion,
  Ban, Loader2, ThumbsUp, ThumbsDown, Target, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAjna } from "@/lib/store";
import { type RiskUpdate, type OutcomeLabel, timeAgo, categoryVariant, currency, friendlyFeature, severityWord } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

type SignalKind = "device" | "behavioral" | "identity";

function classify(reason: string): SignalKind {
  if (/farm|account|ATO|email|subnet|ring|shared|linked to \d/i.test(reason)) return "identity";
  if (/rooted|emulator|\bvpn\b|gps|tamper|clone|debug|hardware sensor|compromised device/i.test(reason)) return "device";
  return "behavioral";
}

const KIND_META: Record<SignalKind, { label: string; icon: typeof Cpu; cls: string }> = {
  device: { label: "Device", icon: Cpu, cls: "bg-fraud/10 text-fraud border-fraud/20" },
  behavioral: { label: "Behavioral", icon: Activity, cls: "bg-suspicious/10 text-suspicious border-suspicious/20" },
  identity: { label: "Identity", icon: Network, cls: "bg-primary/10 text-primary border-primary/20" },
};

const ACTIONS: { id: string; label: string; icon: typeof Eye; variant: "secondary" | "outline" | "destructive" }[] = [
  { id: "Allow", label: "Allow", icon: CheckCircle2, variant: "secondary" },
  { id: "Monitor", label: "Monitor", icon: Eye, variant: "outline" },
  { id: "Challenge", label: "Challenge", icon: ShieldQuestion, variant: "outline" },
  { id: "Block", label: "Block", icon: Ban, variant: "destructive" },
];

const OUTCOME_META: Record<OutcomeLabel, { label: string; cls: string }> = {
  confirmed_fraud: { label: "Confirmed fraud", cls: "bg-fraud/15 text-fraud" },
  false_positive: { label: "False positive", cls: "bg-suspicious/15 text-suspicious" },
  legit: { label: "Legit", cls: "bg-safe/15 text-safe" },
};

export function RiskCard({ u }: { u: RiskUpdate }) {
  const { now, submitAction, submitOutcome, askCopilotForCase, pendingAction } = useAjna();
  const sigma = u.behavioral_sigma ?? 0;
  const showBehavioral = sigma >= 3 && (u.behavioral_deviations?.length ?? 0) > 0;
  const severe = sigma >= 6;

  const chips = u.reasons.filter(r => !(showBehavioral && /^(Behavior doesn't match|Unusual behavior for)/i.test(r)));
  const grouped = chips.reduce<Record<SignalKind, string[]>>((acc, r) => {
    (acc[classify(r)] ||= []).push(r);
    return acc;
  }, { device: [], behavioral: [], identity: [] });

  const ctx = u.context ?? {};
  const amount = typeof ctx.amount === "number" ? ctx.amount : undefined;
  const ctxEntries = Object.entries(ctx).filter(([k]) => k !== "amount");
  const decided = u.status === "reviewed" || !!u.analyst_action;
  const isPending = pendingAction?.caseId === u.case_id;

  return (
    <Card className="overflow-hidden transition-all duration-200 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
      {/* top accent by category */}
      <div className={cn("h-0.5 w-full",
        u.category === "Fraud" ? "bg-fraud" : u.category === "Suspicious" ? "bg-suspicious" : "bg-safe")} />

      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={cn(
            "flex min-w-[3.4rem] flex-col items-center justify-center rounded-xl border px-2.5 py-1.5 ring-1",
            u.category === "Fraud" ? "border-fraud/30 bg-fraud/10 ring-fraud/20"
              : u.category === "Suspicious" ? "border-suspicious/30 bg-suspicious/10 ring-suspicious/20"
              : "border-safe/30 bg-safe/10 ring-safe/20"
          )}>
            <span className={cn("text-xl font-bold tabular-nums leading-none",
              u.category === "Fraud" ? "text-fraud" : u.category === "Suspicious" ? "text-suspicious" : "text-safe")}>
              {u.risk_score}
            </span>
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground">risk</span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={categoryVariant(u.category)}>{u.category}</Badge>
              <span className="font-mono text-sm font-medium">{u.event_type}</span>
              {amount !== undefined && (
                <Badge variant="outline" className="font-mono">{currency(amount)}</Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="font-mono">{u.user_id}</span>
              <span className="font-mono">{u.device_id}</span>
              <span className="inline-flex items-center gap-1"><Clock className="size-3" />{timeAgo(u.timestamp, now)}</span>
            </div>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => askCopilotForCase(u.case_id)} aria-label="Ask AI">
                <Sparkles className="size-4 text-ai" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ask the AI copilot about this case</TooltipContent>
          </Tooltip>
        </div>

        {/* Behavioral intelligence callout */}
        {showBehavioral && (
          <div className={cn("rounded-lg border p-3",
            severe ? "border-fraud/30 bg-fraud/5" : "border-ai/30 bg-ai/5")}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <Brain className={cn("size-3.5", severe ? "text-fraud" : "text-ai")} />
              <span className={cn("text-[10px] font-bold uppercase tracking-wider", severe ? "text-fraud" : "text-ai")}>
                Behavioral Intelligence
              </span>
              <Badge variant={severe ? "fraud" : "ai"} className="ml-auto tabular-nums">{sigma.toFixed(1)}σ off baseline</Badge>
            </div>
            <p className={cn("text-[12px] leading-relaxed", severe ? "text-fraud" : "text-foreground")}>
              {severe
                ? "Behavior does not match this user — possible account takeover."
                : "Session behavior deviates from this user's learned baseline."}
            </p>
            <ul className="mt-2 space-y-1">
              {(u.behavioral_deviations ?? []).slice(0, 4).map((d, i) => (
                <li key={i} className="text-[11px] leading-snug text-muted-foreground">
                  <span className="font-medium text-foreground">{d.label ?? friendlyFeature(d.feature)}</span>{" is "}
                  {d.severity ?? severityWord(d.sigma)} from normal
                  <span className="opacity-70"> ({Number(d.observed).toFixed(1)} vs ~{Number(d.baseline).toFixed(1)} typical · {d.sigma?.toFixed(1)}σ)</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Signal chips grouped by category */}
        {(["device", "behavioral", "identity"] as SignalKind[]).map(kind => {
          const items = grouped[kind];
          if (!items.length) return null;
          const { label, icon: Icon, cls } = KIND_META[kind];
          return (
            <div key={kind} className="space-y-1">
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Icon className="size-3" /> {label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {items.map((r, i) => (
                  <span key={i} className={cn("rounded border px-2 py-0.5 text-[11px]", cls)}>{r}</span>
                ))}
              </div>
            </div>
          );
        })}

        {/* Business context */}
        {ctxEntries.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {ctxEntries.map(([k, v]) => (
              <span key={k} className="rounded border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                {k}: <span className="text-foreground">{String(v)}</span>
              </span>
            ))}
          </div>
        )}

        {/* AI explanation */}
        {u.explanation && u.category !== "Safe" && (
          <div className="rounded-lg bg-muted/50 p-2.5 text-[12px] leading-relaxed text-muted-foreground">
            <Sparkles className="mr-1 inline size-3 text-ai" />{u.explanation}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {decided ? (
            <Badge variant="muted" className="gap-1">
              <CheckCircle2 className="size-3" /> {u.analyst_action} · {u.analyst ?? "analyst"}
            </Badge>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {ACTIONS.map(a => (
                <Button
                  key={a.id}
                  size="sm"
                  variant={a.variant}
                  disabled={isPending}
                  onClick={() => submitAction(u.case_id, a.id)}
                >
                  {isPending && pendingAction?.action === a.id ? <Loader2 className="size-3.5 animate-spin" /> : <a.icon className="size-3.5" />}
                  {a.label}
                </Button>
              ))}
            </div>
          )}

          {/* Outcome labeling */}
          <div className="ml-auto flex items-center gap-1.5">
            {u.outcome ? (
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", OUTCOME_META[u.outcome].cls)}>
                <Target className="size-3" /> {OUTCOME_META[u.outcome].label}
              </span>
            ) : (
              <>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Outcome</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="text-fraud" onClick={() => submitOutcome(u.case_id, "confirmed_fraud")} aria-label="Confirmed fraud">
                      <ThumbsDown className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Confirmed fraud</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="text-safe" onClick={() => submitOutcome(u.case_id, "legit")} aria-label="Legit">
                      <ThumbsUp className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Legitimate</TooltipContent>
                </Tooltip>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => submitOutcome(u.case_id, "false_positive")}>
                  False positive
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
