/**
 * Country name ? ITU dial code (no + prefix, no leading zeros)
 * Covers all countries present in the TassaPay customer base.
 */
const COUNTRY_DIAL_CODES: Record<string, string> = {
  "United Kingdom": "44",
  "Germany": "49",
  "France": "33",
  "Italy": "39",
  "Austria": "43",
  "Netherlands": "31",
  "Belgium": "32",
  "Ireland": "353",
  "Finland": "358",
};

/**
 * Normalises a raw phone number to E.164 format.
 *
 * Rules (applied in order):
 *  1. Already starts with "+"  -> return trimmed as-is
 *  2. Starts with "00"         -> replace 00 with +
 *  3. Country code known       -> strip the leading "0" (if any), prepend +{dialCode}
 *  4. Fallback                 -> prepend "+" and hope for the best
 */
export function normalizePhone(
  phone: string,
  country?: string | null
): string {
  const p = phone.trim();

  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return "+" + p.slice(2);

  const dialCode = country ? COUNTRY_DIAL_CODES[country] : undefined;
  if (!dialCode) return "+" + p;

  // Strip the leading trunk "0" before prepending the international code
  const local = p.startsWith("0") ? p.slice(1) : p;
  return `+${dialCode}${local}`;
}

export function normalizePhoneValue(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  return digits.length > 0 ? digits : null;
}

export function getPhoneLast9(phone: string | null | undefined): string | null {
  const normalized = normalizePhoneValue(phone);
  if (!normalized) return null;
  return normalized.slice(-9);
}

export function getPhoneLookupParts(phone: string | null | undefined): {
  normalized: string | null;
  last9: string | null;
} {
  const normalized = normalizePhoneValue(phone);
  return {
    normalized,
    last9: normalized ? normalized.slice(-9) : null,
  };
}

