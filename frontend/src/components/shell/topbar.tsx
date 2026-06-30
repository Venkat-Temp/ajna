"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Play, Loader2, Sparkles, ChevronDown, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAjna } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/feed": { title: "Live Risk Feed", subtitle: "Real-time scored sessions as they arrive" },
  "/live": { title: "Session Monitor", subtitle: "Watch a device's risk escalate in real time" },
  "/devices": { title: "High-Risk Devices", subtitle: "Devices scoring 31+ with trust history" },
  "/accounts": { title: "High-Risk Accounts", subtitle: "Accounts scoring 31+ across devices" },
  "/graph": { title: "Identity Graph", subtitle: "Devices, accounts, IPs and emails linked together" },
  "/rings": { title: "Fraud Rings", subtitle: "Clusters of accounts sharing a device or email" },
  "/history": { title: "Audit Trail", subtitle: "Every analyst decision, logged" },
  "/policies": { title: "Risk Policies", subtitle: "Tune detection signals and thresholds live" },
  "/impact": { title: "Impact", subtitle: "Precision, exposure blocked, and outcomes" },
};

const SCENARIOS: { id: string; label: string }[] = [
  { id: "emulator_farm", label: "Emulator farm" },
  { id: "otp_attack", label: "OTP brute-force" },
  { id: "referral_abuse", label: "Referral abuse" },
  { id: "rooted_wallet", label: "Rooted wallet transfer" },
  { id: "gps_spoofing", label: "GPS spoofing" },
  { id: "account_sharing", label: "Account sharing" },
  { id: "account_takeover", label: "Account takeover" },
  { id: "checkout_fraud", label: "Checkout fraud" },
  { id: "bot_farm", label: "Bot farm" },
  { id: "app_cloning_abuse", label: "App cloning abuse" },
];

export function Topbar() {
  const pathname = usePathname();
  const { isConnected, runScenario, runningScenario, openCopilot } = useAjna();
  const meta = TITLES[pathname] ?? { title: "Ajna", subtitle: "Mobile fraud intelligence" };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-5 backdrop-blur-xl">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold tracking-tight">{meta.title}</h1>
        <p className="truncate text-xs text-muted-foreground">{meta.subtitle}</p>
      </div>

      <div
        className={cn(
          "hidden sm:flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
          isConnected ? "border-safe/30 bg-safe/10 text-safe" : "border-fraud/30 bg-fraud/10 text-fraud"
        )}
      >
        {isConnected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
        <span className={cn("size-1.5 rounded-full", isConnected ? "bg-safe ajna-pulse" : "bg-fraud")} />
        {isConnected ? "Live" : "Reconnecting"}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={!!runningScenario}>
            {runningScenario ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            <span className="hidden sm:inline">{runningScenario ? "Running…" : "Simulate"}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-80 overflow-y-auto">
          {SCENARIOS.map(s => (
            <DropdownMenuItem key={s.id} onSelect={() => runScenario(s.id)}>
              {s.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        size="sm"
        onClick={() => openCopilot(null)}
        className="bg-ai text-ai-foreground hover:bg-ai/90"
      >
        <Sparkles className="size-4" />
        <span className="hidden sm:inline">Ask AI</span>
      </Button>

      <ThemeToggle />
    </header>
  );
}
