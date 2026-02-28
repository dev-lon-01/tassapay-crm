"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users,
  Plus,
  Pencil,
  Loader2,
  KeyRound,
  ShieldCheck,
  UserCircle2,
  AlertCircle,
} from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { useAuth } from "@/src/context/AuthContext";
import { Modal } from "@/src/components/Modal";

// ─── types ────────────────────────────────────────────────────────────────────

interface StaffUser {
  id: number;
  name: string;
  email: string;
  role: string;
  is_active: number;
  sip_username: string | null;
  allowed_regions: string[] | string;
  can_view_dashboard: number | boolean;
  created_at: string;
}

const ROLES    = ["Admin", "Agent"] as const;
const REGIONS  = ["UK", "EU"] as const;
type Role = (typeof ROLES)[number];

// ─── role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    Admin: "bg-purple-100 text-purple-700",
    Agent: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        map[role] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {role}
    </span>
  );
}

// ─── status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ active }: { active: number }) {
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-600">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
      Inactive
    </span>
  );
}

// ─── modal ───────────────────────────────────────────────────────────────────

interface ModalProps {
  user: StaffUser | null; // null = creating new
  onClose: () => void;
  onSaved: () => void;
}

function UserModal({ user, onClose, onSaved }: ModalProps) {
  const isEdit = !!user;

  // Parse allowed_regions — may arrive as a JSON string from MySQL
  const initialRegions: string[] = (() => {
    if (!user?.allowed_regions) return ["UK", "EU"];
    if (Array.isArray(user.allowed_regions)) return user.allowed_regions as string[];
    try { return JSON.parse(user.allowed_regions as string); } catch { return ["UK", "EU"]; }
  })();

  const [name, setName]                     = useState(user?.name ?? "");
  const [email, setEmail]                   = useState(user?.email ?? "");
  const [role, setRole]                     = useState<Role>((user?.role as Role) ?? "Agent");
  const [isActive, setIsActive]             = useState(user?.is_active !== 0);
  const [sipUsername, setSipUsername]       = useState(user?.sip_username ?? "");
  const [allowedRegions, setAllowedRegions] = useState<string[]>(initialRegions);
  const [canViewDash, setCanViewDash]       = useState(Boolean(user?.can_view_dashboard));
  const [password, setPassword]             = useState("");
  const [saving, setSaving]                 = useState(false);
  const [error, setError]                   = useState("");

  // reset-password sub-prompt
  const [showResetPw, setShowResetPw]   = useState(false);
  const [newPw, setNewPw]               = useState("");
  const [resetting, setResetting]       = useState(false);
  const [resetMsg, setResetMsg]         = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    if (allowedRegions.length === 0) {
      setError("At least one region must be selected");
      setSaving(false);
      return;
    }

    try {
      const body = isEdit
        ? { name, email, role, is_active: isActive, sip_username: sipUsername.trim() || null, allowed_regions: allowedRegions, can_view_dashboard: canViewDash }
        : { name, email, role, password, sip_username: sipUsername.trim() || null, allowed_regions: allowedRegions, can_view_dashboard: canViewDash };

      const res = await apiFetch(
        isEdit ? `/api/users/${user!.id}` : "/api/users",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Something went wrong");
        setSaving(false);
        return;
      }

      onSaved();
    } catch {
      setError("Network error");
      setSaving(false);
    }
  }

  async function handleResetPassword() {
    if (!newPw.trim()) return;
    setResetting(true);
    setResetMsg("");
    try {
      const res = await apiFetch(`/api/users/${user!.id}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: newPw }),
      });
      if (!res.ok) {
        const data = await res.json();
        setResetMsg(data.error ?? "Failed");
      } else {
        setResetMsg("Password updated successfully.");
        setNewPw("");
        setShowResetPw(false);
      }
    } catch {
      setResetMsg("Network error");
    } finally {
      setResetting(false);
    }
  }

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          {isEdit ? (
            <Pencil className="h-4 w-4 text-indigo-500" />
          ) : (
            <Plus className="h-4 w-4 text-emerald-500" />
          )}
          <span>{isEdit ? "Edit Team Member" : "New Team Member"}</span>
        </div>
      }
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <button
          type="submit"
          form="team-user-form"
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? "Save Changes" : "Create User"}
        </button>
      }
    >
      <form id="team-user-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Full Name
          </label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="Jane Smith"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Email
          </label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="jane@tassapay.com"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Role
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        {/* SIP Username */}
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            SIP Username
          </label>
          <input
            type="text"
            value={sipUsername}
            onChange={(e) => setSipUsername(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="e.g. abdi (leave blank if not using SIP)"
          />
        </div>

        {/* Allowed Regions */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Allowed Regions
          </label>
          <div className="flex gap-4">
            {REGIONS.map((r) => (
              <label key={r} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowedRegions.includes(r)}
                  onChange={() =>
                    setAllowedRegions((prev) =>
                      prev.includes(r)
                        ? prev.filter((x) => x !== r)
                        : [...prev, r]
                    )
                  }
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
                />
                <span className="text-sm font-medium text-slate-700">{r}</span>
              </label>
            ))}
          </div>
          {allowedRegions.length === 0 && (
            <p className="text-xs text-rose-500">At least one region must be selected</p>
          )}
        </div>

        {/* Manager Dashboard Access toggle */}
        <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
          <div>
            <span className="text-sm font-medium text-slate-700">Manager Dashboard Access</span>
            <p className="text-xs text-slate-400">Grants access to the live command-centre dashboard</p>
          </div>
          <button
            type="button"
            onClick={() => setCanViewDash((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              canViewDash ? "bg-indigo-500" : "bg-slate-300"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                canViewDash ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {/* password — only on create */}
        {!isEdit && (          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Temporary Password
            </label>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="Min. 8 characters"
            />
          </div>
        )}

        {/* active toggle — only on edit */}
        {isEdit && (
          <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
            <span className="text-sm font-medium text-slate-700">Active Status</span>
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isActive ? "bg-emerald-500" : "bg-slate-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  isActive ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        )}
      </form>

      {/* reset-password section — edit only */}
      {isEdit && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          {!showResetPw ? (
            <button
              type="button"
              onClick={() => setShowResetPw(true)}
              className="flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-indigo-600"
            >
              <KeyRound className="h-4 w-4" />
              Reset Password
            </button>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                New Password
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  minLength={8}
                  placeholder="Min. 8 characters"
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={resetting}
                  className="flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-900 disabled:opacity-60"
                >
                  {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Set"}
                </button>
              </div>
              {resetMsg && (
                <p className={`text-xs ${resetMsg.includes("success") ? "text-emerald-600" : "text-rose-600"}`}>
                  {resetMsg}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { user } = useAuth();
  const [users, setUsers]         = useState<StaffUser[]>([]);
  const [loading, setLoading]     = useState(true);
  const [modalUser, setModalUser] = useState<StaffUser | null | undefined>(undefined); // undefined = closed

  const load = useCallback(() => {
    setLoading(true);
    apiFetch("/api/users")
      .then((r) => r.json())
      .then((data) => {
        setUsers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Admin guard
  if (!user) return null;
  if (user.role !== "Admin") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <AlertCircle className="h-10 w-10 text-rose-400" />
        <p className="text-lg font-bold text-slate-800">Access Restricted</p>
        <p className="text-sm text-slate-500">This page is available to Admins only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Team</h1>
          <p className="mt-1 text-sm text-slate-500">
            {loading ? "Loading…" : `${users.length} staff member${users.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={() => setModalUser(null)}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          Add Member
        </button>
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading team…</span>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Users className="h-8 w-8 text-slate-200" />
            <p className="text-sm font-semibold text-slate-500">No team members yet</p>
          </div>
        ) : (
          <>
            {/* desktop table */}
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="transition hover:bg-slate-50/50">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-xs font-bold text-white">
                          {u.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <span className="font-medium text-slate-900">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">{u.email}</td>
                    <td className="px-5 py-3.5"><RoleBadge role={u.role} /></td>
                    <td className="px-5 py-3.5"><StatusBadge active={u.is_active} /></td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => setModalUser(u)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* mobile cards */}
            <div className="divide-y divide-slate-100 md:hidden">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-xs font-bold text-white">
                      {u.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{u.name}</p>
                      <p className="text-xs text-slate-400">{u.email}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <RoleBadge role={u.role} />
                        <StatusBadge active={u.is_active} />
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setModalUser(u)}
                    className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* modal */}
      {modalUser !== undefined && (
        <UserModal
          user={modalUser}
          onClose={() => setModalUser(undefined)}
          onSaved={() => { setModalUser(undefined); load(); }}
        />
      )}
    </div>
  );
}
