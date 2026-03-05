/**
 * Seed the 4 app-push / marketing email templates (ids 7–10).
 * Safe to rerun — uses INSERT IGNORE, skips any id that already exists.
 * Run: node scripts/seed-email-templates.mjs
 */
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 2,
});

const WA  = "https://api.whatsapp.com/send?phone=%20+447836%20695516&text=Hello%20There,%20I%20would%20like%20to%20enquire%20about%20money%20transfer.";
const APP = "http://lnkz.app/feay";

const waLink  = `<a href="${WA}">contact us on WhatsApp</a>`;
const appLink = (label) => `<a href="${APP}">${label}</a>`;

const templates = [
  {
    id:      7,
    name:    "Beneficiary Issue - App Push",
    channel: "Email",
    subject: "Action Required: Update to your recent TassaPay Transfer",
    body: [
      "Dear {{customerName}},",
      "",
      "We are reaching out regarding your recent transfer. Unfortunately, we have encountered an issue with the beneficiary details provided, and the receiving provider has temporarily halted the transaction.",
      "",
      "To ensure your funds are delivered as quickly as possible, please verify and update the recipient's name, account number, or phone number directly in our app.",
      "",
      appLink("Tap here to open the TassaPay app and resolve this issue."),
      "",
      `For further information, ${waLink}.`,
      "",
      "Thank you,",
      "",
      "The TassaPay Team",
    ].join("\n"),
  },
  {
    id:      8,
    name:    "Lead Follow-Up - New Prospect",
    channel: "Email",
    subject: "Welcome to TassaPay! Send money securely today.",
    body: [
      "Hi {{customerName}},",
      "",
      "Thank you for your interest in TassaPay! We offer some of the most competitive exchange rates and fastest delivery times on the market.",
      "",
      "To see today's live rates and track your transfers in real-time, the best way to get started is by downloading our mobile app. You can set up your account and send money in just a few minutes.",
      "",
      appLink("Tap here to get the app and make your first transfer."),
      "",
      `For further information, ${waLink}.`,
      "",
      "Best,",
      "",
      "The TassaPay Team",
    ].join("\n"),
  },
  {
    id:      9,
    name:    "Customer Onboarding - Welcome",
    channel: "Email",
    subject: "Welcome to TassaPay, {{customerName}}! Let's get started.",
    body: [
      "Dear {{customerName}},",
      "",
      "Welcome to TassaPay! Your account is now fully active.",
      "",
      "Making your first secure, fast, and low-cost money transfer is just a tap away. With our app, you can save your favourite recipients, track your money in real-time, and access exclusive exchange rates.",
      "",
      appLink("Open the app now to send your first transfer."),
      "",
      `For further information, ${waLink}.`,
      "",
      "Thank you for choosing TassaPay.",
      "",
      "The TassaPay Team",
    ].join("\n"),
  },
  {
    id:      10,
    name:    "Promo - Zero Fees",
    channel: "Email",
    subject: "Enjoy ZERO Fees on Your Next Transfer! 🚀",
    body: [
      "Hi {{customerName}},",
      "",
      "Great news! For a limited time, we are offering absolutely ZERO FEES on your next money transfer.",
      "",
      "Whether you are sending money to family or paying for business, you keep more of your money with TassaPay. Don't miss out on this offer—it gets applied automatically when you use the app.",
      "",
      appLink("Tap here to open the app and claim your fee-free transfer today."),
      "",
      `For further information, ${waLink}.`,
      "",
      "Best,",
      "",
      "The TassaPay Team",
    ].join("\n"),
  },
];

const conn = await pool.getConnection();
try {
  for (const t of templates) {
    const [result] = await conn.execute(
      "INSERT IGNORE INTO templates (id, name, channel, subject, body) VALUES (?, ?, ?, ?, ?)",
      [t.id, t.name, t.channel, t.subject, t.body]
    );
    const tag = result.affectedRows ? "INSERTED" : "SKIPPED ";
    console.log(`[${tag}] id=${t.id}  ${t.name}`);
  }
  console.log("\nDone.");
} finally {
  conn.release();
  await pool.end();
}
