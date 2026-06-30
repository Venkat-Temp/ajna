"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Server, Search, Network, Fingerprint, ChevronDown, Cpu, ShieldAlert, Wifi, MapPin, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAjna } from "@/lib/store";
import { type DeviceProfile, timeAgo, categoryVariant } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function DevicesPage() {
  const { highRiskDevices, deviceTrustScores, fetchDeviceTrust, loadGraph, openEntity, now } = useAjna();
  const router = useRouter();
  const [query, setQuery] = React.useState("");

  const ids = highRiskDevices.map(d => d.device_id).join(",");
  React.useEffect(() => {
    if (ids) fetchDeviceTrust(ids.split(","));
  }, [ids, fetchDeviceTrust]);

  const filtered = query.trim()
    ? highRiskDevices.filter(d => d.device_id.toLowerCase().includes(query.toLowerCase()))
    : highRiskDevices;

  const viewGraph = (id: string) => { loadGraph(id); router.push("/graph"); };

  return (
    <div className="space-y-4 p-4 md:p-5">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search device id…" className="pl-8" />
      </div>

      {filtered.length === 0 ? (
        <Card className="grid place-items-center py-20 text-center text-muted-foreground">
          <div><Inbox className="mx-auto mb-3 size-10 opacity-30" /><p className="text-sm">No high-risk devices yet.</p></div>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(d => (
            <DeviceRow
              key={d.device_id}
              d={d}
              trust={deviceTrustScores[d.device_id]}
              now={now}
              onGraph={() => viewGraph(d.device_id)}
              onEntity={() => openEntity("device", d.device_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceRow({ d, trust, now, onGraph, onEntity }: {
  d: DeviceProfile;
  trust?: { trust_score: number; event_count: number; fraud_count: number; last_category: string };
  now: number;
  onGraph: () => void;
  onEntity: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const flags = [
    d.isEmulator && { label: "Emulator", icon: Cpu },
    d.isRooted && { label: "Rooted", icon: ShieldAlert },
    d.hasVPN && { label: "VPN", icon: Wifi },
    d.isGPSSpoofed && { label: "GPS spoof", icon: MapPin },
    d.hasAppTamper && { label: "Tampered", icon: ShieldAlert },
  ].filter(Boolean) as { label: string; icon: typeof Cpu }[];

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/40">
        <div className="grid size-9 place-items-center rounded-lg bg-muted">
          <Server className="size-4.5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium">{d.device_id}</span>
            <Badge variant={categoryVariant(d.lastCategory)}>{d.lastCategory}</Badge>
            {trust && (
              <Badge variant="muted" className="gap-1">
                <Fingerprint className="size-3" /> risk {Math.round(trust.trust_score)}
                {trust.fraud_count > 0 && <span className="text-fraud"> · {trust.fraud_count} fraud</span>}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
            <span>{d.totalEvents} events</span>
            <span>{d.linkedUsers.length} accounts</span>
            <span>{timeAgo(d.lastSeen, now)}</span>
          </div>
        </div>
        <div className="hidden items-center gap-1.5 sm:flex">
          {flags.slice(0, 4).map(f => (
            <span key={f.label} className="inline-flex items-center gap-1 rounded border border-fraud/20 bg-fraud/10 px-1.5 py-0.5 text-[10px] text-fraud">
              <f.icon className="size-3" />{f.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("text-lg font-bold tabular-nums", d.maxRisk >= 61 ? "text-fraud" : "text-suspicious")}>{d.maxRisk}</span>
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onGraph}><Network className="size-3.5" /> View graph</Button>
            <Button variant="outline" size="sm" onClick={onEntity}><Fingerprint className="size-3.5" /> Entity 360</Button>
          </div>
          {d.topReasons.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.topReasons.map((r, i) => (
                <span key={i} className="rounded border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">{r}</span>
              ))}
            </div>
          )}
          {d.linkedUsers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.linkedUsers.slice(0, 12).map(u => (
                <span key={u} className="rounded bg-secondary px-2 py-0.5 font-mono text-[11px]">{u.slice(0, 18)}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
