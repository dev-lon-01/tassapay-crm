/**
 * scripts/test-mailgun.mjs
 * One-shot Mailgun HTTP API send test — delete after confirming.
 * Usage: node scripts/test-mailgun.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Mailgun = require("mailgun.js");
const formData = require("form-data");

const mg = new Mailgun.default(formData);
const client = mg.client({
  username: "api",
  key: process.env.MAILGUN_API_KEY ?? "",
  url: "https://api.mailgun.net",  // US region
});

const TO = "a.mohamed05@gmail.com";
const DOMAIN = "mg.tassapay.com";

console.log(`Sending test email via Mailgun API → ${TO} ...`);

try {
  const result = await client.messages.create(DOMAIN, {
    from:    "TassaPay <noreply@tassapay.com>",
    to:      [TO],
    subject: "Mailgun API connectivity test",
    text:    "This is a test message from the TassaPay CRM Mailgun API integration check.",
  });
  console.log("✓ Sent successfully. ID:", result.id);
} catch (err) {
  console.error("✗ Send failed:", err.message ?? err);
}
