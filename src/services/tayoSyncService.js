/**
 * src/services/tayoSyncService.js
 *
 * Syncs the latest outbound transfers from the DataField / TayoTransfer
 * provider API and updates the local `transfers` table with the provider's
 * reference number (rmtNo → data_field_id).
 *
 * Required environment variables (.env.local):
 *   TAYO_BASIC_AUTH   – Base64-encoded "username:password" for Basic Auth
 *
 * Flow:
 *   1. Obtain a session token  (POST /api/Token)
 *   2. Build & encrypt the date-range payload
 *   3. Fetch the remittance list  (POST /api/RemittanceList)
 *   4. Decrypt the response and upsert data_field_id into transfers
 */

const { encrypt, decrypt } = require("../utils/tayoCrypto");
const axios = require("axios");

const TOKEN_URL = "http://efuluusprod.tayotransfer.com/api/Token";
const LIST_URL  = "http://efuluusprod.tayotransfer.com/api/RemittanceList";

// Proxy is optional — set TAYO_PROXY_HOST in .env.local for environments
// that require routing through a specific IP (e.g. local dev).
const PROXY = process.env.TAYO_PROXY_HOST
  ? { host: process.env.TAYO_PROXY_HOST, port: Number(process.env.TAYO_PROXY_PORT ?? 808), protocol: "http" }
  : false;

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns FrDate (yesterday) and ToDate (today) in M/D/YYYY format,
 * matching the format expected by the TayoTransfer API.
 */
function getDateRange() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const fmt = (d) =>
    `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  return { frDate: fmt(yesterday), toDate: fmt(today) };
}

// ─── Main service function ────────────────────────────────────────────────────

/**
 * Syncs the latest TayoTransfer remittances and writes rmtNo → data_field_id.
 *
 * @param {import('mysql2/promise').Pool} pool  Shared mysql2 promise pool
 * @returns {Promise<{ total: number, updated: number }>}
 */
async function syncLatestTransfers(pool) {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  if (!basicAuth) {
    throw new Error("Missing TAYO_BASIC_AUTH environment variable");
  }

  // ── Step 1: Authenticate and retrieve session token ──────────────────────
  const authRes = await axios.post(TOKEN_URL, null, {
    headers: { Authorization: `Basic ${basicAuth}` },
    proxy: PROXY,
  });
  const token = authRes.data?.Token;
  if (!token) {
    throw new Error(
      `TayoTransfer auth response did not include a Token. HTTP ${authRes.status}. Body: ${JSON.stringify(authRes.data).slice(0, 200)}`
    );
  }

  // ── Step 2: Build and encrypt the request payload ────────────────────────
  const { frDate, toDate } = getDateRange();
  const plainPayload = JSON.stringify({
    ClientId: "fEuluus",
    FrDate: frDate,
    ToDate: toDate,
  });
  const encryptedPayload = encrypt(plainPayload);

  // ── Step 3: Fetch the remittance list ────────────────────────────────────
  const dataRes = await axios.post(
    LIST_URL,
    { jsonstring: encryptedPayload },
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Efuluusrodp2025: token,
        "Content-Type": "application/json",
      },
      proxy: PROXY,
      responseType: "text",
      transformResponse: (r) => r, // prevent axios from auto-parsing
    }
  );

  // The API returns an encrypted string (plain text body)
  const encryptedResponse = dataRes.data;

  // ── Step 4: Parse the response ──────────────────────────────────────────
  // The API returns a JSON object { RemittanceList: [...] }
  let parsed;
  try {
    parsed = JSON.parse(encryptedResponse);
  } catch {
    throw new Error("TayoTransfer response is not valid JSON");
  }
  /** @type {Array<{ wsTransId: string, Rmtno: string, [key: string]: unknown }>} */
  const transfers = parsed.RemittanceList ?? parsed;

  if (!Array.isArray(transfers)) {
    throw new Error("Unexpected TayoTransfer response: expected an array");
  }

  // Only process transfers originating from sub-agent EFU
  const efuTransfers = transfers.filter((t) => t.Frsubagent === "EFU");

  // ── Update data_field_id in the transfers table ──────────────────────────
  let updated = 0;
  const conn = await pool.getConnection();
  try {
    for (const t of efuTransfers) {
      if (!t.Wstransid) continue;
      const [result] = await conn.execute(
        "UPDATE transfers SET data_field_id = ?, data_field_status = ? WHERE transaction_ref = ?",
        [t.Rmtno ?? null, t.Status ?? null, t.Wstransid]
      );
      if (result.affectedRows > 0) updated++;
    }
  } finally {
    conn.release();
  }

  return { total: efuTransfers.length, updated };
}

module.exports = { syncLatestTransfers };
