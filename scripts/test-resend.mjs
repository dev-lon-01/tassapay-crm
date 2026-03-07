import https from "https";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
const envLines = readFileSync(resolve(__dirname, "../.env.local"), "utf8").split("\n");
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const [key, ...rest] = trimmed.split("=");
  if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
}

const API_KEY = process.env.RESEND_API_KEY;
if (!API_KEY) { console.error("RESEND_API_KEY not set"); process.exit(1); }

const payload = JSON.stringify({
  from: "TassaPay <onboarding@resend.dev>",
  to: ["info@tassapay.com"],
  subject: "Resend migration test — TassaPay CRM",
  html: "<p style=\"font-family:sans-serif;line-height:1.6\">This is a test email confirming the TassaPay CRM has successfully migrated from SendGrid to <strong>Resend</strong>. If you receive this, the integration is working correctly.</p>",
});

const options = {
  hostname: "api.resend.com",
  path: "/emails",
  method: "POST",
  headers: {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  },
};

const req = https.request(options, (res) => {
  let body = "";
  res.on("data", (chunk) => (body += chunk));
  res.on("end", () => {
    const parsed = JSON.parse(body);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`SUCCESS (HTTP ${res.statusCode}) — Resend message id: ${parsed.id}`);
    } else {
      console.error(`FAILED (HTTP ${res.statusCode}):`, JSON.stringify(parsed, null, 2));
      process.exit(1);
    }
  });
});

req.on("error", (e) => { console.error("Request error:", e.message); process.exit(1); });
req.write(payload);
req.end();

