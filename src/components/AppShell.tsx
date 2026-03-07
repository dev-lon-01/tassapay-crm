"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppHeader } from "@/src/components/AppHeader";
import { AppNavigation } from "@/src/components/AppNavigation";
import { ProtectedRoute } from "@/src/components/ProtectedRoute";
import { CallWidget } from "@/src/components/CallWidget";
import { PostCallModal } from "@/src/components/PostCallModal";
import { ClientErrorBoundary } from "@/src/components/ClientErrorBoundary";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <ProtectedRoute>
      <div className="relative min-h-screen overflow-x-hidden bg-[#f4f7fb] text-slate-900">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-[-120px] top-[-120px] h-80 w-80 rounded-full bg-emerald-300/25 blur-3xl" />
          <div className="absolute right-[-150px] top-[20px] h-96 w-96 rounded-full bg-cyan-200/25 blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-white/70 to-transparent" />
        </div>
        <AppHeader />
        <AppNavigation />
        <main className="px-4 pb-24 pt-5 md:ml-64 md:px-8 md:pb-10 md:pt-7">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
        <ClientErrorBoundary
          fallback={
            <div className="fixed bottom-6 right-6 z-[70] rounded-xl border border-red-200 bg-white px-4 py-3 text-xs font-medium text-red-600 shadow-lg">
              Voice tools are temporarily unavailable. Refresh the page if the problem persists.
            </div>
          }
        >
          <CallWidget />
          <PostCallModal />
        </ClientErrorBoundary>
      </div>
    </ProtectedRoute>
  );
}

