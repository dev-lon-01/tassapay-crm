"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart2, Bell, Bot, CheckSquare, FileText,
  LayoutDashboard, ListFilter, LogOut, Menu, RefreshCw, Activity,
  ShieldAlert, Users, UsersRound, X,
} from "lucide-react";
import { useAuth } from "@/src/context/AuthContext";

type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

const navItems: NavItem[] = [
  { label: "Directory",   href: "/directory",    icon: Users },
  { label: "My Tasks",    href: "/my-tasks",     icon: CheckSquare },
  { label: "QA",          href: "/qa-transfers", icon: ShieldAlert },
  { label: "Templates",   href: "/templates",    icon: FileText },
  { label: "Automations", href: "/automations",  icon: Bot },
  { label: "Activity",    href: "/activity",     icon: Activity },
];

const adminItems: NavItem[] = [
  { label: "Analytics", href: "/analytics",           icon: BarChart2   },
  { label: "Team",      href: "/team",                 icon: UsersRound  },
  { label: "Sync",      href: "/sync",                 icon: RefreshCw   },
  { label: "Alerts",    href: "/settings/alerts",      icon: Bell        },
  { label: "Dropdowns", href: "/settings/dropdowns",   icon: ListFilter  },
];

// Rule of 4: only 3 primary links + "More" button on mobile
const bottomItems: NavItem[] = [
  { label: "My Tasks",  href: "/my-tasks",  icon: CheckSquare },
  { label: "Directory", href: "/directory", icon: Users },
  { label: "Activity",  href: "/activity",  icon: Activity },
];

// All other links live in the More drawer
const drawerItems: NavItem[] = [
  { label: "QA",          href: "/qa-transfers", icon: ShieldAlert },
  { label: "Templates",   href: "/templates",    icon: FileText },
  { label: "Automations", href: "/automations",  icon: Bot },
];

export function AppNavigation() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* ── Mobile bottom bar (Rule of 4) ─────────────────────────────── */}
      <aside className="fixed inset-x-0 bottom-3 z-50 px-3 md:hidden">
        <nav className="grid h-16 grid-cols-4 rounded-2xl border border-slate-200/80 bg-white/95 p-1.5 shadow-2xl shadow-slate-900/10 backdrop-blur-xl">
          {bottomItems.map((item) => {
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
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            <Menu className="h-4 w-4" />
            <span>More</span>
          </button>
        </nav>
      </aside>

      {/* ── Mobile More drawer ────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Sheet */}
          <div className="absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col rounded-t-3xl bg-white shadow-2xl">
            {/* Drag handle */}
            <div className="flex justify-center pb-1 pt-3">
              <div className="h-1 w-10 rounded-full bg-slate-200" />
            </div>

            {/* User profile header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 pb-4 pt-2">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-sm font-bold text-white shadow">
                  {user?.name?.slice(0, 2).toUpperCase() ?? "??"}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{user?.name ?? "Agent"}</p>
                  <p className="text-xs text-slate-500">{user?.email ?? ""}</p>
                  <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    user?.role === "Admin"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}>
                    {user?.role ?? "Agent"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Nav body */}
            <div className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {/* Dashboard — only visible to Admin or users with can_view_dashboard */}
              {(user?.role === "Admin" || user?.can_view_dashboard) && (
                <Link
                  href="/dashboard"
                  onClick={() => setDrawerOpen(false)}
                  className={`flex items-center gap-4 rounded-2xl px-4 py-3.5 text-sm font-medium transition ${
                    pathname === "/dashboard"
                      ? "bg-gradient-to-r from-emerald-50 to-cyan-50 text-emerald-700 ring-1 ring-emerald-100"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <LayoutDashboard className="h-5 w-5 text-slate-400" />
                  <span>Dashboard</span>
                </Link>
              )}
              {drawerItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex items-center gap-4 rounded-2xl px-4 py-3.5 text-sm font-medium transition ${
                      isActive
                        ? "bg-gradient-to-r from-emerald-50 to-cyan-50 text-emerald-700 ring-1 ring-emerald-100"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <Icon className="h-5 w-5 text-slate-400" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              {user?.role === "Admin" && (
                <>
                  <p className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Admin
                  </p>
                  {adminItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setDrawerOpen(false)}
                        className={`flex items-center gap-4 rounded-2xl px-4 py-3.5 text-sm font-medium transition ${
                          isActive
                            ? "bg-gradient-to-r from-amber-50 to-orange-50 text-amber-700 ring-1 ring-amber-100"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <Icon className="h-5 w-5 text-slate-400" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </>
              )}
            </div>

            {/* Logout footer */}
            <div className="border-t border-slate-100 px-3 pb-8 pt-3">
              <button
                onClick={() => { setDrawerOpen(false); logout(); }}
                className="flex w-full items-center gap-4 rounded-2xl bg-rose-50 px-4 py-3.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-100"
              >
                <LogOut className="h-5 w-5" />
                <span>Log out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop sidebar (unchanged) ───────────────────────────────── */}
      <aside className="fixed bottom-0 top-[73px] hidden w-64 px-3 pb-3 md:block">
        <div className="flex h-full flex-col">
          <nav className="h-full space-y-2 rounded-3xl border border-slate-200/70 bg-white/85 p-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Navigation
            </p>
            {/* Dashboard — only visible to Admin or users with can_view_dashboard */}
            {(user?.role === "Admin" || user?.can_view_dashboard) && (
              <Link
                href="/dashboard"
                className={`group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
                  pathname === "/dashboard"
                    ? "bg-gradient-to-r from-emerald-50 to-cyan-50 text-emerald-700 ring-1 ring-emerald-100"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <LayoutDashboard className="h-4 w-4 transition group-hover:scale-105" />
                <span>Dashboard</span>
              </Link>
            )}
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