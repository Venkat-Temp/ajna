"use client";

import * as React from "react";

type GNode = { id: string; type: "device" | "user" | "ip" | "email"; label: string };
type GEdge = { source: string; target: string };

const NODE_CLASS: Record<GNode["type"], string> = {
  device: "fill-primary",
  user: "fill-chart-5",
  ip: "fill-suspicious",
  email: "fill-safe",
};

export function IdentityGraph({ nodes, edges, focalId }: { nodes: GNode[]; edges: GEdge[]; focalId: string }) {
  // Layout is a pure, deterministic function of the props → useMemo (no effect/setState).
  const positions = React.useMemo<Record<string, { x: number; y: number }>>(() => {
    if (nodes.length === 0) return {};
    const W = 760, H = 460, cx = W / 2, cy = H / 2;
    const pos: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * 2 * Math.PI;
      pos[n.id] = { x: cx + 180 * Math.cos(angle), y: cy + 150 * Math.sin(angle), vx: 0, vy: 0 };
    });
    if (pos[focalId]) { pos[focalId].x = cx; pos[focalId].y = cy; }

    for (let iter = 0; iter < 140; iter++) {
      const ids = Object.keys(pos);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos[ids[i]], b = pos[ids[j]];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const f = 6000 / (dist * dist);
          a.vx += (dx / dist) * f; a.vy += (dy / dist) * f;
          b.vx -= (dx / dist) * f; b.vy -= (dy / dist) * f;
        }
      }
      for (const e of edges) {
        const a = pos[e.source], b = pos[e.target];
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const f = (dist - 110) * 0.04;
        a.vx += (dx / dist) * f; a.vy += (dy / dist) * f;
        b.vx -= (dx / dist) * f; b.vy -= (dy / dist) * f;
      }
      for (const id of ids) {
        const n = pos[id];
        n.vx += (cx - n.x) * 0.012; n.vy += (cy - n.y) * 0.012;
        n.x += n.vx * 0.6; n.y += n.vy * 0.6;
        n.vx *= 0.5; n.vy *= 0.5;
        n.x = Math.max(36, Math.min(W - 36, n.x));
        n.y = Math.max(28, Math.min(H - 28, n.y));
      }
    }
    const final: Record<string, { x: number; y: number }> = {};
    for (const id of Object.keys(pos)) final[id] = { x: pos[id].x, y: pos[id].y };
    return final;
  }, [nodes, edges, focalId]);

  if (Object.keys(positions).length === 0) {
    return <div className="grid h-full place-items-center text-xs text-muted-foreground">Laying out graph…</div>;
  }

  return (
    <div className="flex h-full w-full flex-col">
      <svg viewBox="0 0 760 460" className="flex-1 w-full">
        {edges.map((e, i) => {
          const a = positions[e.source], b = positions[e.target];
          if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-border" strokeWidth="1.5" />;
        })}
        {nodes.map(n => {
          const p = positions[n.id];
          if (!p) return null;
          const focal = n.id === focalId;
          const r = focal ? 22 : 15;
          return (
            <g key={n.id}>
              {focal && <circle cx={p.x} cy={p.y} r={r + 6} className="fill-none stroke-primary" strokeWidth="2" strokeOpacity="0.35" />}
              <circle cx={p.x} cy={p.y} r={r} className={NODE_CLASS[n.type]} />
              <text x={p.x} y={p.y + r + 12} textAnchor="middle" fontSize="10" className="fill-muted-foreground">
                {n.label.slice(0, 16)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-4 px-3 pb-1 pt-2">
        {([["device", "fill-primary", "Device"], ["user", "fill-chart-5", "Account"], ["ip", "fill-suspicious", "IP"], ["email", "fill-safe", "Email"]] as const).map(([, c, l]) => (
          <div key={l} className="flex items-center gap-1.5">
            <svg width="10" height="10"><circle cx="5" cy="5" r="5" className={c} /></svg>
            <span className="text-[11px] text-muted-foreground">{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
