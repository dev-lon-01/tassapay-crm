import crypto from "crypto";

export interface BackofficeSignatureResult {
  enforce: boolean;
  valid: boolean;
  reason: "ok" | "missing-secret" | "missing-signature" | "invalid-signature";
}

function isEnforced(): boolean {
  return (process.env.ENFORCE_BACKOFFICE_WEBHOOK_AUTH ?? "false").toLowerCase() === "true";
}

export function validateBackofficeSignature(
  rawBody: string,
  signatureHeader: string | null
): BackofficeSignatureResult {
  const secret = process.env.BACKOFFICE_WEBHOOK_SECRET ?? "";
  const enforce = isEnforced();

  if (!secret) {
    return { enforce, valid: !enforce, reason: "missing-secret" };
  }

  if (!signatureHeader?.trim()) {
    return { enforce, valid: !enforce, reason: "missing-signature" };
  }

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.trim().toLowerCase();
  const valid =
    expected.length === provided.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));

  return {
    enforce,
    valid,
    reason: valid ? "ok" : "invalid-signature",
  };
}

