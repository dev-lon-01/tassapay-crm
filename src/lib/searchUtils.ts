export function looksLikeTransferReference(value: string | null | undefined): boolean {
  if (!value) return false;
  const term = value.trim();
  if (term.length < 5 || /\s/.test(term)) return false;
  const hasLetter = /[A-Za-z]/.test(term);
  const hasDigit = /\d/.test(term);
  return hasLetter && hasDigit;
}

export function buildReferenceSearchPatterns(value: string): {
  exact: string;
  prefix: string;
} {
  const normalized = value.trim();
  return {
    exact: normalized,
    prefix: `${normalized}%`,
  };
}

