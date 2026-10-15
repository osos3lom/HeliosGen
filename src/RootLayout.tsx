import { Outlet } from "react-router";
import { AppSidebar } from "@/components/AppSidebar";
import GlobalModals from "@/components/GlobalModals";
import KieBanner from "@/components/KieBanner";
import UpdateBanner from "@/components/UpdateBanner";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DragDropGuard } from "@/components/DragDropGuard";

// Formerly a server read via next/headers `cookies()`; the cookie is written
// by components/ui/sidebar.tsx, so it is readable client-side too.
function readSidebarOpen(): boolean {
  return !document.cookie.split("; ").includes("sidebar_state=false");
}

export default function RootLayout() {
  return (
    <>
      <TooltipProvider>
        <SidebarProvider defaultOpen={readSidebarOpen()} className="h-full">
          <AppSidebar />
          <SidebarInset style={{ backgroundColor: "transparent" }} className="flex flex-col min-h-0 min-w-0 border-l border-r border-t border-white/[0.08] mx-2 mt-2 rounded-tl-xl rounded-tr-xl">
            <KieBanner />
            <UpdateBanner />
            <div className="md:hidden flex items-center h-10 px-3 border-b border-white/[0.08] shrink-0">
              <SidebarTrigger className="text-white/50 hover:text-white hover:bg-white/[0.05] transition-colors rounded-lg p-1.5 [&_svg]:size-4" />
            </div>
            <DragDropGuard />
            <Outlet />
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
      <GlobalModals />
    </>
  );
}
