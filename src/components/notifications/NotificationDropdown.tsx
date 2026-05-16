"use client";

import * as React from "react";
import { useEffect, useRef } from "react";
import { NotificationItem, type Notification } from "./NotificationItem";

interface NotificationDropdownProps {
  notifications: Notification[];
  loading: boolean;
  onClose: () => void;
  onMarkAll: () => void;
  onItemClick: (id: number) => void;
}

export function NotificationDropdown({
  notifications,
  loading,
  onClose,
  onMarkAll,
  onItemClick,
}: NotificationDropdownProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onClose]);

  const noneUnread =
    notifications.length === 0 || notifications.every((n) => n.is_read === 1);

  return (
    <div
      ref={wrapperRef}
      role="dialog"
      aria-label="Notifications"
      className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-xs font-semibold text-slate-700">Notifications</span>
        <button
          type="button"
          onClick={onMarkAll}
          disabled={noneUnread}
          className="text-[11px] font-medium text-indigo-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
        >
          Mark all as read
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
        {loading && notifications.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-400">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-400">No notifications yet.</div>
        ) : (
          notifications.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              onClick={() => {
                onItemClick(n.id);
                onClose();
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
