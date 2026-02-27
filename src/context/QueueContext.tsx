"use client";

import { createContext, useContext, useState, useCallback } from "react";

// ─── types ────────────────────────────────────────────────────────────────────

export type TaskStatus = "uncontacted" | "follow-up" | "closed";
export type QueueTab = "uncontacted" | "follow-up" | "closed";

export interface QueueCustomer {
  customer_id: string;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
  country: string | null;
  registration_date: string | null;
  kyc_completion_date: string | null;
  risk_status: string | null;
  total_transfers: number;
  last_transfer_date: string | null;
}

interface QueueContextValue {
  rawCustomers: QueueCustomer[];
  setRawCustomers: (customers: QueueCustomer[]) => void;
  taskStatusMap: Record<string, TaskStatus>;
  setTaskStatus: (id: string, status: TaskStatus) => void;
  activeTab: QueueTab;
  setActiveTab: (tab: QueueTab) => void;
  sortedQueue: (tab: QueueTab) => QueueCustomer[];
  queuePosition: (id: string) => { index: number; total: number } | null;
}

// ─── sort logic ───────────────────────────────────────────────────────────────

function smartSort(customers: QueueCustomer[]): QueueCustomer[] {
  const priority = (c: QueueCustomer): number => {
    // P1 — Pending KYC
    if (c.kyc_completion_date === null) return 0;
    // P2 — KYC complete, 0 transfers, registered < 30 days ago
    const regMs = c.registration_date
      ? new Date(c.registration_date).getTime()
      : 0;
    const ageDays = (Date.now() - regMs) / 86_400_000;
    if (c.total_transfers === 0 && ageDays < 30) return 1;
    // P3 — Dormant (0 transfers, > 30 days)
    return 2;
  };
  return [...customers].sort((a, b) => priority(a) - priority(b));
}

// ─── context ──────────────────────────────────────────────────────────────────

const QueueContext = createContext<QueueContextValue | null>(null);

export function QueueProvider({ children }: { children: React.ReactNode }) {
  const [rawCustomers, setRawCustomers] = useState<QueueCustomer[]>([]);
  const [taskStatusMap, setTaskStatusMapState] = useState<
    Record<string, TaskStatus>
  >({});
  const [activeTab, setActiveTab] = useState<QueueTab>("uncontacted");

  const setTaskStatus = useCallback((id: string, status: TaskStatus) => {
    setTaskStatusMapState((prev) => ({ ...prev, [id]: status }));
  }, []);

  const sortedQueue = useCallback(
    (tab: QueueTab): QueueCustomer[] => {
      const filtered = rawCustomers.filter(
        (c) => (taskStatusMap[c.customer_id] ?? "uncontacted") === tab
      );
      return tab === "uncontacted" ? smartSort(filtered) : filtered;
    },
    [rawCustomers, taskStatusMap]
  );

  const queuePosition = useCallback(
    (id: string): { index: number; total: number } | null => {
      const queue = sortedQueue(activeTab);
      const index = queue.findIndex((c) => c.customer_id === id);
      if (index === -1) return null;
      return { index: index + 1, total: queue.length };
    },
    [sortedQueue, activeTab]
  );

  return (
    <QueueContext.Provider
      value={{
        rawCustomers,
        setRawCustomers,
        taskStatusMap,
        setTaskStatus,
        activeTab,
        setActiveTab,
        sortedQueue,
        queuePosition,
      }}
    >
      {children}
    </QueueContext.Provider>
  );
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("useQueue must be used within QueueProvider");
  return ctx;
}
