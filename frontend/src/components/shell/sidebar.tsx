"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, Server, Users, Network, Layers, History, Settings, TrendingUp, ShieldCheck, Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAjna } from "@/lib/store";
import { Badge } from "@/components/ui/badge";

export function Sidebar() {
  const pathname = usePathname();
  const { highRiskDevices, highRiskAccounts, decisions, policies, rings, riskUpdates } = useAjna();

  const sections: { heading: string; items: { href: string; label: string; icon: typeof Activity; count: number; alert?: boolean }[] }[] = [
    {
      heading: "Monitor",
      items: [
        { href: "/feed", label: "Live Risk Feed", icon: Activity, count: riskUpdates.filter(u => u.category !== "Safe").length, alert: true },
        { href: "/live", label: "Session Monitor", icon: Radio, count: 0 },
        { href: "/devices", label: "Devices", icon: Server, count: highRiskDevices.length },
        { href: "/accounts", label: "Accounts", icon: Users, count: highRiskAccounts.length },
      ],
    },
    {
      heading: "Investigate",
      items: [
        { href: "/graph", label: "Identity Graph", icon: Network, count: 0 },
        { href: "/rings", label: "Fraud Rings", icon: Layers, count: rings.length },
        { href: "/history", label: "Audit Trail", icon: History, count: decisions.length },
      ],
    },
    {
      heading: "Configure",
      items: [
        { href: "/policies", label: "Risk Policies", icon: Settings, count: policies.filter(p => p.enabled).length },
        { href: "/impact", label: "Impact", icon: TrendingUp, count: 0 },
      ],
    },
  ];

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-5">
        <div className="grid size-9 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/30">
          <ShieldCheck className="size-5 text-primary" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight text-foreground">Ajna</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Fraud Intelligence</div>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
        {sections.map(section => (
          <div key={section.heading} className="space-y-1">
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
              {section.heading}
            </div>
            {section.items.map(({ href, label, icon: Icon, count, alert }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/12 font-medium text-primary"
                      : "text-sidebar-foreground hover:bg-muted/70 hover:text-foreground"
                  )}
                >
                  {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />}
                  <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                  <span className="flex-1 truncate">{label}</span>
                  {count > 0 && (
                    <Badge variant={alert ? "fraud" : active ? "default" : "muted"} className="tabular-nums px-1.5 py-0">
                      {count}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-5 py-3 text-[10px] leading-relaxed text-muted-foreground/70">
        <span className="font-medium text-muted-foreground">3-layer device intelligence</span><br />
        collect · understand · act
      </div>
    </aside>
  );
}
