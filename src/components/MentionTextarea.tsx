"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

interface Agent {
  id: number;
  name: string;
}

interface MentionTextareaProps {
  value: string;
  onChange: (next: string) => void;
  agents: Agent[];
  placeholder?: string;
  className?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  onSubmit?: () => void;
}

// Match an @-token that ends at the caret: `@`, `@r`, `@rid…` (no whitespace).
// Requires the `@` to be at start-of-string or after whitespace, so we never
// treat email addresses as mentions.
const TOKEN_AT_CARET_RE = /(?:^|\s)@([^\s@\[]*)$/;

interface ActiveToken {
  start: number;
  end: number;
  query: string;
}

function findActiveToken(value: string, caret: number): ActiveToken | null {
  const upToCaret = value.slice(0, caret);
  const m = upToCaret.match(TOKEN_AT_CARET_RE);
  if (!m) return null;
  const atIndex = m.index! + (m[0].length - m[1].length - 1);
  return {
    start: atIndex,
    end: caret,
    query: m[1],
  };
}

export function MentionTextarea({
  value,
  onChange,
  agents,
  placeholder,
  className,
  rows = 3,
  autoFocus,
  disabled,
  onSubmit,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [activeToken, setActiveToken] = useState<ActiveToken | null>(null);
  const [highlight, setHighlight] = useState(0);

  const filteredAgents = useMemo(() => {
    if (!activeToken) return [];
    const q = activeToken.query.toLowerCase();
    const base = q
      ? agents.filter((a) => a.name.toLowerCase().includes(q))
      : [...agents].sort((a, b) => a.name.localeCompare(b.name));
    return base.slice(0, 8);
  }, [activeToken, agents]);

  useEffect(() => {
    setHighlight(0);
  }, [activeToken?.query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setActiveToken(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    onChange(next);
    const caret = e.target.selectionStart ?? next.length;
    setActiveToken(findActiveToken(next, caret));
  }

  function handleKeyUp(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
      const ta = e.currentTarget;
      const caret = ta.selectionStart ?? ta.value.length;
      setActiveToken(findActiveToken(ta.value, caret));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !activeToken && onSubmit) {
      e.preventDefault();
      onSubmit();
      return;
    }

    if (!activeToken || filteredAgents.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % filteredAgents.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + filteredAgents.length) % filteredAgents.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectAgent(filteredAgents[highlight]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setActiveToken(null);
    }
  }

  function selectAgent(agent: Agent) {
    if (!activeToken) return;
    const before = value.slice(0, activeToken.start);
    const after = value.slice(activeToken.end);
    const token = `@[${agent.name}](user:${agent.id})`;
    const sep = after.startsWith(" ") ? "" : " ";
    const next = before + token + sep + after;
    onChange(next);
    setActiveToken(null);
    const newCaret = before.length + token.length + sep.length;
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(newCaret, newCaret);
    });
  }

  return (
    <div ref={wrapperRef} className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={(e) => {
          const ta = e.currentTarget;
          const caret = ta.selectionStart ?? ta.value.length;
          setActiveToken(findActiveToken(ta.value, caret));
        }}
        placeholder={placeholder}
        rows={rows}
        className={className}
        autoFocus={autoFocus}
        disabled={disabled}
      />
      {activeToken && filteredAgents.length > 0 && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          {filteredAgents.map((a, i) => (
            <button
              type="button"
              key={a.id}
              onMouseDown={(e) => {
                e.preventDefault();
                selectAgent(a);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`block w-full px-3 py-2 text-left text-sm ${
                i === highlight
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="font-medium">@{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
