"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "@/src/lib/apiFetch";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DropdownRow {
  id:         number;
  category:   string;
  label:      string;
  sort_order: number;
  is_active:  number; // 0 | 1 from MySQL TINYINT
}

interface DropdownsContextValue {
  callOutcomes:  string[];
  focusOutcomes: string[];
  noteOutcomes:  string[];
  loading:       boolean;
  reload:        () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const DropdownsContext = createContext<DropdownsContextValue>({
  callOutcomes:  [],
  focusOutcomes: [],
  noteOutcomes:  [],
  loading:       true,
  reload:        () => undefined,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DropdownsProvider({ children }: { children: ReactNode }) {
  const [rows, setRows]       = useState<DropdownRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  function fetchDropdowns() {
    // Only fetch when the user is authenticated (token present in localStorage)
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("tp_crm_token")
        : null;
    if (!token) return;

    setLoading(true);
    apiFetch("/api/settings/dropdowns")
      .then((r) => r.json())
      .then((data: DropdownRow[]) => {
        if (Array.isArray(data)) setRows(data);
      })
      .catch(() => {/* silently degrade — hardcoded fallbacks via empty arrays */})
      .finally(() => {
        setLoading(false);
        setFetched(true);
      });
  }

  // Fetch once after mount (the token will exist if the user is logged in)
  useEffect(() => {
    if (!fetched) fetchDropdowns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(category: string): string[] {
    return rows
      .filter((r) => r.category === category && r.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => r.label);
  }

  const value: DropdownsContextValue = {
    callOutcomes:  pick("call_outcome"),
    focusOutcomes: pick("focus_outcome"),
    noteOutcomes:  pick("note_outcome"),
    loading,
    reload:        fetchDropdowns,
  };

  return (
    <DropdownsContext.Provider value={value}>
      {children}
    </DropdownsContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDropdowns(): DropdownsContextValue {
  return useContext(DropdownsContext);
}
