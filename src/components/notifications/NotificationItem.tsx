"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AtSign, ArrowRight, MessageSquare, RefreshCw } from "lucide-react";
import { formatTimeAgo } from "@/src/lib/timeAgo";

export type NotificationType =
  | "mention"
  | "task_assigned"
  | "task_reassigned"
  | "comment_on_assigned";

export interface Notification {
  id: number;
  type: NotificationType;
  task_id: number;
  task_title: string | null;
  actor_name: string | null;
  excerpt: string | null;
  is_read: number;
  created_at: string;
}

interface NotificationItemProps {
  notification: Notification;
  onClick: () => void;
}

function summarize(n: Notification): string {
  const actor = n.actor_name ?? "A teammate";
  const title = n.task_title ?? `task #${n.task_id}`;
  switch (n.type) {
    case "mention":
      return `${actor} mentioned you on "${title}"`;
    case "task_assigned":
      return `${actor} assigned you "${title}"`;
    case "task_reassigned":
      return `${actor} reassigned "${title}" to you`;
    case "comment_on_assigned":
      return `${actor} commented on "${title}"`;
  }
}

function iconFor(type: NotificationType) {
  switch (type) {
    case "mention":              return <AtSign size={14} className="text-indigo-600" />;
    case "task_assigned":        return <ArrowRight size={14} className="text-emerald-600" />;
    case "task_reassigned":      return <RefreshCw size={14} className="text-amber-600" />;
    case "comment_on_assigned":  return <MessageSquare size={14} className="text-slate-600" />;
  }
}

export function NotificationItem({ notification, onClick }: NotificationItemProps) {
  const router = useRouter();

  function handleClick() {
    onClick();
    router.push(`/to-do?taskId=${notification.task_id}`);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`w-full px-3 py-2.5 text-left transition hover:bg-slate-50 ${
        notification.is_read === 0 ? "bg-indigo-50/30" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{iconFor(notification.type)}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-slate-800 line-clamp-2">
            {summarize(notification)}
          </p>
          {notification.excerpt && (
            <p className="mt-0.5 text-[11px] text-slate-500 line-clamp-2">
              {notification.excerpt}
            </p>
          )}
          <p className="mt-1 text-[10px] text-slate-400">
            {formatTimeAgo(notification.created_at)}
          </p>
        </div>
        {notification.is_read === 0 && (
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
        )}
      </div>
    </button>
  );
}
