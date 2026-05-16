/**
 * Mention token format: @[Full Name](user:42)
 * The bracketed name is the display name captured at mention time.
 * The user:N segment is the source of truth for dispatch.
 */
export const MENTION_RE = /@\[([^\]]+)\]\(user:(\d+)\)/g;

export function extractMentionedUserIds(text: string | null | undefined): number[] {
  if (!text) return [];
  const ids = new Set<number>();
  for (const match of text.matchAll(MENTION_RE)) {
    const id = Number(match[2]);
    if (Number.isFinite(id)) ids.add(id);
  }
  return [...ids];
}

export interface MentionToken {
  type: "text" | "mention";
  text: string;
  userId?: number;
}

export function tokenizeMentions(text: string | null | undefined): MentionToken[] {
  if (!text) return [];
  const tokens: MentionToken[] = [];
  let lastIndex = 0;
  // Fresh regex per call (g flag is stateful otherwise).
  const re = new RegExp(MENTION_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ type: "text", text: text.slice(lastIndex, m.index) });
    }
    tokens.push({ type: "mention", text: m[1], userId: Number(m[2]) });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: "text", text: text.slice(lastIndex) });
  }
  return tokens;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the surrounding text for an email body. Mentions become
 * bolded inline `@Name`; plain text is HTML-escaped.
 */
export function mentionsToEmailHtml(text: string | null | undefined): string {
  if (!text) return "";
  return tokenizeMentions(text)
    .map((t) =>
      t.type === "mention"
        ? `<strong>@${escapeHtml(t.text)}</strong>`
        : escapeHtml(t.text)
    )
    .join("");
}
