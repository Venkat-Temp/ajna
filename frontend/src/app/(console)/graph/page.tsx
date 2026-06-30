"use client";

import * as React from "react";
import { Network, Search, Loader2 } from "lucide-react";
import { useAjna } from "@/lib/store";
import { IdentityGraph } from "@/components/identity-graph";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function GraphPage() {
  const { graphData, graphLoading, graphDeviceId, loadGraph, highRiskDevices } = useAjna();
  const [q, setQ] = React.useState(graphDeviceId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) loadGraph(q.trim());
  };

  return (
    <div className="space-y-4 p-4 md:p-5">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Enter a device id…" className="pl-8 font-mono" />
        </div>
        <Button type="submit" disabled={graphLoading}>
          {graphLoading ? <Loader2 className="size-4 animate-spin" /> : <Network className="size-4" />} Build graph
        </Button>
        {highRiskDevices.slice(0, 4).map(d => (
          <Button key={d.device_id} variant="outline" size="sm" className="font-mono" onClick={() => { setQ(d.device_id); loadGraph(d.device_id); }}>
            {d.device_id.slice(0, 14)}
          </Button>
        ))}
      </form>

      <Card className="h-[560px] overflow-hidden p-2">
        {graphLoading ? (
          <div className="grid h-full place-items-center gap-2 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : !graphData || graphData.nodes.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-muted-foreground">
            <div>
              <Network className="mx-auto mb-3 size-10 opacity-30" />
              <p className="text-sm">{graphDeviceId ? "No identity links found for this device." : "Enter a device id (or pick one above) to map its identity network."}</p>
            </div>
          </div>
        ) : (
          <IdentityGraph nodes={graphData.nodes} edges={graphData.edges} focalId={graphDeviceId} />
        )}
      </Card>
    </div>
  );
}
