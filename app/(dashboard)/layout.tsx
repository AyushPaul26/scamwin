import { Suspense } from "react";
import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-sidebar";
import { CreatureMotionProvider } from "@/components/creatures/creature-motion";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="dark dashboard-theme min-h-svh bg-background" aria-label="Loading workspace" />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}

async function DashboardShell({ children }: { children: React.ReactNode }) {
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <TooltipProvider>
      <CreatureMotionProvider>
        <SidebarProvider defaultOpen={defaultOpen} className="dark dashboard-theme bg-background text-foreground" style={{ "--sidebar-width": "17rem", "--sidebar-width-icon": "4rem" } as React.CSSProperties}>
          <AppSidebar defaultOpen={defaultOpen} />
          <div className="relative flex min-w-0 flex-1 flex-col">
            <SidebarTrigger className="absolute top-4 left-4 z-10 md:hidden" />
            {children}
          </div>
        </SidebarProvider>
      </CreatureMotionProvider>
    </TooltipProvider>
  );
}
