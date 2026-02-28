"use client";

import { type ReactNode, useEffect } from "react";
import { X } from "lucide-react";

interface ModalProps {
  /** Text or JSX shown in the fixed header */
  title: ReactNode;
  onClose: () => void;
  /** Sticky footer — put Save / Cancel buttons here */
  footer: ReactNode;
  /** Scrollable body — put form fields here */
  children: ReactNode;
  maxWidth?: string;
}

/**
 * Responsive modal shell.
 * – Header and footer are fixed (flex-shrink: 0).
 * – Body scrolls independently (flex-grow: 1, overflow-y: auto).
 * – Total height is capped at 90vh so the modal never overflows on mobile.
 */
export function Modal({ title, onClose, footer, children, maxWidth = "max-w-lg" }: ModalProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center">
      <div
        className={`flex w-full ${maxWidth} flex-col rounded-2xl bg-white shadow-2xl`}
        style={{ maxHeight: "90vh" }}
      >
        {/* Header — never scrolls */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="text-base font-semibold text-slate-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — scrolls */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {/* Footer — sticky, never scrolls */}
        <div className="shrink-0 border-t border-slate-100 bg-white px-6 pb-5 pt-4">
          {footer}
        </div>
      </div>
    </div>
  );
}
