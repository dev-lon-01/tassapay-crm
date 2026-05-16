"use client";

import { useAuth } from "@/src/context/AuthContext";
import { NotificationBell } from "@/src/components/notifications/NotificationBell";

export function AppHeader() {
  const { user, isLoading } = useAuth();

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "...";

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 px-4 py-3 backdrop-blur-xl md:px-6">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-cyan-600 shadow-lg shadow-emerald-500/25">
            <span className="text-sm font-black tracking-tight text-white">TP</span>
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-lime-300" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold text-slate-900 md:text-base">TassaPay CRM</p>
            <p className="text-xs text-slate-500">Fintech Control Center</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 sm:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-semibold text-emerald-700">System Healthy</span>
          </div>
          <NotificationBell />
          <div className="hidden text-right sm:block">
            {isLoading ? (
              <>
                <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
                <div className="mt-1 h-3 w-16 animate-pulse rounded bg-slate-100" />
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-800">{user?.name ?? "-"}</p>
                <p className="text-xs text-slate-500">{user?.role ?? "-"}</p>
              </>
            )}
          </div>
          <div className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-gradient-to-b from-slate-700 to-slate-950 text-sm font-semibold text-white shadow-sm">
            {initials}
          </div>
        </div>
      </div>
    </header>
  );
}