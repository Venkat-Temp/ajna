"use client";

import * as React from "react";
import { Sparkles, Send, X, Loader2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAjna } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CopilotDock() {
  const { copilotOpen, setCopilotOpen, copilotBusy, copilotMessages, copilotCaseId, askCopilot } = useAjna();
  const [q, setQ] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [copilotMessages, copilotBusy]);

  if (!copilotOpen) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() || copilotBusy) return;
    askCopilot(q.trim(), copilotCaseId);
    setQ("");
  };

  return (
    <div className="fixed bottom-0 right-0 z-40 m-4 flex h-[min(560px,80vh)] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="grid place-items-center size-7 rounded-md bg-ai/15">
          <Sparkles className="size-4 text-ai" />
        </div>
        <div className="flex-1 leading-tight">
          <div className="text-sm font-semibold">Fraud Analyst Copilot</div>
          <div className="text-[10px] text-muted-foreground">
            {copilotCaseId ? `Grounded on ${copilotCaseId}` : "Grounded in live case evidence"}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => setCopilotOpen(false)} aria-label="Close copilot">
          <X className="size-4" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {copilotMessages.length === 0 && (
          <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
            <div>
              <Sparkles className="mx-auto mb-2 size-6 opacity-30" />
              Ask why a case was flagged, what the behavioral signals mean,<br />or what action to take.
            </div>
          </div>
        )}
        {copilotMessages.map((m, i) => (
          <div key={i} className={cn("flex gap-2", m.role === "user" && "flex-row-reverse")}>
            <div className={cn(
              "grid size-6 shrink-0 place-items-center rounded-md",
              m.role === "user" ? "bg-secondary" : "bg-ai/15"
            )}>
              {m.role === "user" ? <User className="size-3.5" /> : <Sparkles className="size-3.5 text-ai" />}
            </div>
            <div className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed",
              m.role === "user" ? "bg-secondary text-secondary-foreground" : "bg-muted text-foreground"
            )}>
              {m.text}
              {m.grounded_on && (
                <div className="mt-1.5 text-[10px] text-muted-foreground">grounded on {m.grounded_on}</div>
              )}
            </div>
          </div>
        ))}
        {copilotBusy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Analyzing…
          </div>
        )}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-border p-3">
        <Input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Ask the copilot…"
          className="h-9"
        />
        <Button type="submit" size="icon" disabled={copilotBusy || !q.trim()} aria-label="Send">
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
