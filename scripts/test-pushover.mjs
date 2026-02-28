/**
 * scripts/test-pushover.mjs
 * Quick test — sends a sample SLA breach notification via Pushover.
 * Usage: node scripts/test-pushover.mjs <YOUR_PUSHOVER_USER_KEY>
 */
import { readFileSync } from "fs";
import https from "https";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const token   = env.PUSHOVER_APP_TOKEN;
const userKey = process.argv[2];

if (!token) { console.error("PUSHOVER_APP_TOKEN not set in .env.local"); process.exit(1); }
if (!userKey) { console.error("Usage: node scripts/test-pushover.mjs <YOUR_PUSHOVER_USER_KEY>"); process.exit(1); }

const body = {
  token,
  user:     userKey,
  title:    "TassaPay SLA Breach",
  message:  "🚨 SLA Breach: Transfer TXN-TEST-001 is delayed. Amount: 500 GBP.",
  priority: 1,
  sound:    "siren",
};

console.log("Sending test Pushover notification...");

const payload = JSON.stringify(body);
await new Promise((resolve, reject) => {
  const req = https.request(
    { hostname: "api.pushover.net", path: "/1/messages.json", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
    (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        const parsed = JSON.parse(data);
        if (parsed.status === 1) {
          console.log("✓ Pushover notification sent successfully!");
          console.log("  Request ID:", parsed.request);
        } else {
          console.error("✗ Pushover API error:", JSON.stringify(parsed));
        }
        resolve(null);
      });
    }
  );
  req.on("error", reject);
  req.write(payload);
  req.end();
});
