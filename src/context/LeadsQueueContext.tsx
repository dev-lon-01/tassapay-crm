"use client";

import { createContext, useContext, useState } from "react";

interface LeadsQueueContextValue {
  queue: string[]; // ordered customer_ids matching current Kanban view
  setQueue: (ids: string[]) => void;
}

const LeadsQueueContext = createContext<LeadsQueueContextValue>({
  queue: [],
  setQueue: () => {},
});

export function LeadsQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<string[]>([]);
  return (
    <LeadsQueueContext.Provider value={{ queue, setQueue }}>
      {children}
    </LeadsQueueContext.Provider>
  );
}

export function useLeadsQueue() {
  return useContext(LeadsQueueContext);
}
