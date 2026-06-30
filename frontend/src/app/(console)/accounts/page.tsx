"use client";

import * as React from "react";
import { Users, Search, Fingerprint, Smartphone, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAjna } from "@/lib/store";
import { timeAgo, categoryVariant } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function AccountsPage() {
  const { highRiskAccounts, openEntity, now } = useAjna();
  const [query, setQuery] = React.useState("");

  const filtered = query.trim()
    ? highRiskAccounts.filter(a => a.user_id.toLowerCase().includes(query.toLowerCase()))
    : highRiskAccounts;

  return (
    <div className="space-y-4 p-4 md:p-5">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search account id…" className="pl-8" />
      </div>

      {filtered.length === 0 ? (
        <Card className="grid place-items-center py-20 text-center text-muted-foreground">
          <div><Inbox className="mx-auto mb-3 size-10 opacity-30" /><p className="text-sm">No high-risk accounts yet.</p></div>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map(a => (
            <Card key={a.user_id} className="p-4">
              <div className="flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded-lg bg-muted">
                  <Users className="size-4.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm font-medium">{a.user_id}</span>
                    <Badge variant={categoryVariant(a.lastCategory)}>{a.lastCategory}</Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Smartphone className="size-3" />{a.linkedDevices.length} devices</span>
                    <span>{a.totalEvents} events</span>
                    <span>{timeAgo(a.lastSeen, now)}</span>
                  </div>
                </div>
                <span className={cn("text-lg font-bold tabular-nums", a.maxRisk >= 61 ? "text-fraud" : "text-suspicious")}>{a.maxRisk}</span>
              </div>

              {a.topReasons.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {a.topReasons.map((r, i) => (
                    <span key={i} className="rounded border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">{r}</span>
                  ))}
                </div>
              )}

              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={() => openEntity("user", a.user_id)}>
                  <Fingerprint className="size-3.5" /> Entity 360
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
