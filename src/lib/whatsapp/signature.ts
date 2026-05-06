import crypto from "crypto";

/**
 * Verifies the X-Hub-Signature-256 header against the raw request body.
 * Header format: "sha256=<hex>"
 */
export function verifyWhatsAppSignature(
  rawBody: string,
  header: string | null,
  appSecret: string
): boolean {
  if (!header || !appSecret) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
