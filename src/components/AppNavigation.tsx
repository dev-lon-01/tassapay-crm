"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart2, Bell, Bot, CheckSquare, FileText, LayoutDashboard, LogOut, RefreshCw, ShieldAlert, Users, UsersRound } from "lucide-react";
import { useAuth } from "@/src/context/AuthContext";

type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

const navItems: NavItem[] = [
  { label: "Dashboard",  href: "/dashboard",  icon: LayoutDashboard },
  { label: "Directory",  href: "/directory",  icon: Users },
  { label: "My Tasks",   href: "/my-tasks",   icon: CheckSquare },
  { label: "QA",        href: "/qa-transfers", icon: ShieldAlert },
  { label: "Templates",  href: "/templates",  icon: FileText },
  { label: "Automations", href: "/automations", icon: Bot },
];

const adminItems: NavItem[] = [
  { label: "Analytics",  href: "/analytics",       icon: BarChart2    },
  { label: "Team",       href: "/team",             icon: UsersRound   },
  { label: "Sync",       href: "/sync",             icon: RefreshCw    },
  { label: "Alerts",     href: "/settings/alerts",  icon: Bell         },
];

export function AppNavigation() {
  const pathname = usePathname();
  const { user, logout }  = useAuth();

  return (
    <>
      <aside className="fixed inset-x-0 bottom-3 z-50 px-3 md:hidden">
        <nav className="grid h-16 grid-cols-6 rounded-2xl border border-slate-200/80 bg-white/95 p-1.5 shadow-2xl shadow-slate-900/10 backdrop-blur-xl">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition ${
                  isActive
                    ? "bg-gradient-to-b from-emerald-50 to-cyan-50 text-emerald-700 ring-1 ring-emerald-100"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <aside className="fixed bottom-0 top-[73px] hidden w-64 px-3 pb-3 md:block">
        <div className="flex h-full flex-col">
          <nav className="h-full space-y-2 rounded-3xl border border-slate-200/70 bg-white/85 p-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Navigation
            </p>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? "bg-gradient-to-r from-emerald-50 to-cyan-50 text-emerald-700 ring-1 ring-emerald-100"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon className="h-4 w-4 transition group-hover:scale-105" />
                  <span>{item.label}</span>
                </Link>
              );
            })}

            {user?.role === "Admin" && (
              <>
                <p className="mt-2 px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Admin
                </p>
                {adminItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
                        isActive
                          ? "bg-gradient-to-r from-amber-50 to-orange-50 text-amber-700 ring-1 ring-amber-100"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      <Icon className="h-4 w-4 transition group-hover:scale-105" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </>
            )}

            <div className="mt-auto space-y-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Workspace
                </p>
                <p className="mt-1 text-sm font-medium text-slate-800">TassaPay Operations</p>
                <p className="text-xs text-slate-500">EU + UK Region</p>
              </div>
              <button
                onClick={logout}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <LogOut className="h-4 w-4" />
                <span>Log out</span>
              </button>
            </div>
          </nav>
        </div>
      </aside>
    </>
  );
}