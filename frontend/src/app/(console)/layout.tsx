"use client";

import { AjnaProvider } from "@/lib/store";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CopilotDock } from "@/components/shell/copilot-dock";
import { EntityDialog } from "@/components/shell/entity-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <AjnaProvider>
      <TooltipProvider delayDuration={200}>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col bg-canvas">
            <Topbar />
            <main className="bg-grid flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
        <CopilotDock />
        <EntityDialog />
      </TooltipProvider>
    </AjnaProvider>
  );
}
