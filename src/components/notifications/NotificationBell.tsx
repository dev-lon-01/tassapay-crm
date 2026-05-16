"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { apiFetch } from "@/src/lib/apiFetch";
import { NotificationDropdown } from "./NotificationDropdown";
import type { Notification } from "./NotificationItem";

interface FeedResponse {
  unread_count: number;
  data: Notification[];
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchFeed = useCallback(async (): Promise<Notification[]> => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/notifications");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as FeedResponse;
      const list = body.data ?? [];
      setNotifications(list);
      setUnreadCount(body.unread_count ?? 0);
      return list;
    } catch {
      // silent — bell keeps its last-known state
      return notifications;
    } finally {
      setLoading(false);
    }
  }, [notifications]);

  // Initial fetch on mount.
  useEffect(() => {
    fetchFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openDropdown() {
    setOpen(true);
    const list = await fetchFeed();
    const unreadIds = list.filter((n) => n.is_read === 0).map((n) => n.id);
    if (unreadIds.length === 0) return;

    // Optimistic mark-as-read.
    setNotifications((prev) =>
      prev.map((n) => (unreadIds.includes(n.id) ? { ...n, is_read: 1 } : n))
    );
    setUnreadCount(0);

    try {
      const res = await apiFetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: unreadIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Roll back optimistic update on failure.
      setNotifications((later) =>
        later.map((n) => (unreadIds.includes(n.id) ? { ...n, is_read: 0 } : n))
      );
      setUnreadCount(unreadIds.length);
    }
  }

  function close() {
    setOpen(false);
  }

  async function markAll() {
    const prevList = notifications;
    const prevCount = unreadCount;
    setNotifications((list) => list.map((n) => ({ ...n, is_read: 1 })));
    setUnreadCount(0);
    try {
      const res = await apiFetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setNotifications(prevList);
      setUnreadCount(prevCount);
    }
  }

  function handleItemClick(_id: number) {
    // Auto-mark on open already handled state; nothing more to do.
  }

  const badge =
    unreadCount === 0 ? null : unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : openDropdown())}
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
      >
        <Bell size={16} />
        {badge && (
          <span className="absolute -right-1 -top-1 grid min-h-[18px] min-w-[18px] place-items-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <NotificationDropdown
          notifications={notifications}
          loading={loading}
          onClose={close}
          onMarkAll={markAll}
          onItemClick={handleItemClick}
        />
      )}
    </div>
  );
}
