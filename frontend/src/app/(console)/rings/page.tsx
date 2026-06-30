"use client";

import * as React from "react";
import { Layers, Loader2, Server, Mail, ArrowRight } from "lucide-react";
import { useAjna } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function RingsPage() {
  const { rings, ringsLoading, refreshRings, openEntity } = useAjna();

  React.useEffect(() => { refreshRings(); }, [refreshRings]);

  return (
    <div className="space-y-4 p-4 md:p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Clusters of accounts converging on one device or email — the signature of farms and coordinated abuse.
        </p>
        <Button variant="outline" size="sm" onClick={refreshRings} disabled={ringsLoading}>
          {ringsLoading ? <Loader2 className="size-4 animate-spin" /> : <Layers className="size-4" />} Refresh
        </Button>
      </div>

      {ringsLoading && rings.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Detecting rings…
        </div>
      ) : rings.length === 0 ? (
        <Card className="grid place-items-center py-20 text-center text-muted-foreground">
          <div>
            <Layers className="mx-auto mb-3 size-10 opacity-30" />
            <p className="text-sm">No fraud rings detected (≥3 shared accounts).</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rings.slice().sort((a, b) => b.size - a.size).map((r, i) => (
            <Card key={`${r.hub_type}:${r.hub}:${i}`} className="p-4">
              <div className="flex items-center gap-2">
                <div className="grid size-9 place-items-center rounded-lg bg-fraud/10 text-fraud">
                  {r.hub_type === "device" ? <Server className="size-4.5" /> : <Mail className="size-4.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="fraud">{r.size} accounts</Badge>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      shared {r.hub_type}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-sm">{r.hub}</div>
                </div>
                {r.hub_type === "device" && (
                  <Button variant="ghost" size="sm" onClick={() => openEntity("device", r.hub)}>
                    Entity 360 <ArrowRight className="size-3.5" />
                  </Button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.accounts.slice(0, 12).map(a => (
                  <button
                    key={a}
                    onClick={() => openEntity("user", a)}
                    className="rounded border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40"
                  >
                    {a.slice(0, 18)}
                  </button>
                ))}
                {r.accounts.length > 12 && (
                  <span className="px-2 py-0.5 text-[11px] text-muted-foreground">+{r.accounts.length - 12} more</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
