import * as React from "react";
import { tokenizeMentions } from "@/src/lib/mentions";

interface RenderTextProps {
  text: string | null | undefined;
  className?: string;
}

/**
 * Render text that may contain @[Name](user:N) mention tokens.
 * Mentions become styled pills; text segments render as-is.
 *
 * This is the ONLY correct way to render any text that may contain
 * mentions. Plain {text} interpolation would show the raw token.
 */
export function RenderText({ text, className }: RenderTextProps) {
  if (!text) return null;
  const tokens = tokenizeMentions(text);
  return (
    <span className={className}>
      {tokens.map((t, i) =>
        t.type === "mention" ? (
          <span
            key={i}
            className="inline-flex items-center rounded-full bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200"
          >
            @{t.text}
          </span>
        ) : (
          <React.Fragment key={i}>{t.text}</React.Fragment>
        )
      )}
    </span>
  );
}
