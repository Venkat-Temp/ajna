"use client";

import * as React from "react";
import { Loader2, Fingerprint, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAjna } from "@/lib/store";
import { friendlyFeature, riskText } from "@/lib/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export function EntityDialog() {
  const { entityOpen, setEntityOpen, entityLoading, entityProfile } = useAjna();
  const features = entityProfile?.behavioral?.features ?? {};
  const featureKeys = Object.keys(features);

  return (
    <Dialog open={entityOpen} onOpenChange={setEntityOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fingerprint className="size-4 text-primary" /> Entity 360
          </DialogTitle>
          <DialogDescription>
            {entityProfile ? `${entityProfile.entity_type} · ${entityProfile.entity_id}` : "Loading profile…"}
          </DialogDescription>
        </DialogHeader>

        {entityLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" /> Loading profile…
          </div>
        ) : !entityProfile ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No profile available.</div>
        ) : (
          <div className="space-y-4">
            {/* Risk history (devices) */}
            {entityProfile.trust && (
              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Gauge className="size-3.5" /> Risk history
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Risk score</div>
                    <div className={cn("font-semibold tabular-nums", riskText(entityProfile.trust.trust_score))}>
                      {Math.round(entityProfile.trust.trust_score)}
                      <span className="text-[10px] font-normal text-muted-foreground"> / 100</span>
                    </div>
                  </div>
                  <Stat label="Events" value={entityProfile.trust.event_count} />
                  <Stat label="Fraud events" value={entityProfile.trust.fraud_count} />
                  <Stat label="Last category" value={entityProfile.trust.last_category} />
                </div>
                <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                  Smoothed 0–100 risk level for this device (higher = riskier). “Last category” is its most recent event.
                </p>
              </div>
            )}

            {/* Learned behavioral baseline — tracked per account, not per device */}
            {entityProfile.entity_type === "user" && (
              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Behavioral baseline
                  </span>
                  <Badge variant="muted">{entityProfile.behavioral?.sample_count ?? 0} samples</Badge>
                </div>
                {featureKeys.length === 0 ? (
                  <p className="text-xs leading-snug text-muted-foreground">
                    No baseline yet — it builds from this account&apos;s touch &amp; typing biometrics as the SDK reports them
                    (≥5 sessions needed before it&apos;s used to spot impostors).
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {featureKeys.map(k => (
                      <div key={k} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{friendlyFeature(k)}</span>
                        <span className="font-mono text-xs tabular-nums">
                          avg {features[k].mean} <span className="text-muted-foreground">± {features[k].std}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
