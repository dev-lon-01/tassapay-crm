/**
 * src/services/tayoSyncService.js
 *
 * Syncs the latest outbound transfers from the DataField / TayoTransfer
 * provider API and updates the local `transfers` table with the provider's
 * reference number (rmtNo → data_field_id).
 *
 * Required environment variables (.env.local):
 * TAYO_BASIC_AUTH   – Base64-encoded "username:password" for Basic Auth
 *
 * Optional environment variables for historical backfilling:
 * TAYO_HISTORICAL_SYNC_ENABLED=true
 * TAYO_SYNC_START_DATE=1/1/2026
 * TAYO_SYNC_END_DATE=3/7/2026
 * TAYO_SYNC_INTERVAL_DAYS=2
 */

const { encrypt, decrypt } = require("../utils/tayoCrypto");
const axios = require("axios");

const TOKEN_URL = "http://efuluusprod.tayotransfer.com/api/Token";
const LIST_URL  = "http://efuluusprod.tayotransfer.com/api/RemittanceList";

// Proxy is optional
const PROXY = process.env.TAYO_PROXY_HOST
  ? { host: process.env.TAYO_PROXY_HOST, port: Number(process.env.TAYO_PROXY_PORT ?? 808), protocol: "http" }
  : false;

// ─── Date helpers ─────────────────────────────────────────────────────────────

const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

/**
 * Standard daily sync range (yesterday to today)
 */
function getDateRange() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return { frDate: fmt(yesterday), toDate: fmt(today) };
}

/**
 * Chunks a large date range into smaller arrays of X days
 * Example: 1/1/2026 to 1/5/2026 with 2-day intervals becomes:
 * [{fr: 1/1, to: 1/3}, {fr: 1/4, to: 1/5}]
 */
function getChunkedDateRanges(startDateStr, endDateStr, intervalDays) {
  const ranges = [];
  let currentStart = new Date(startDateStr);
  const finalEnd = new Date(endDateStr);

  while (currentStart <= finalEnd) {
    let currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + intervalDays);

    if (currentEnd > finalEnd) {
      currentEnd = finalEnd;
    }

    ranges.push({
      frDate: fmt(currentStart),
      toDate: fmt(currentEnd)
    });

    // Advance start date to the day after the current chunk's end
    currentStart = new Date(currentEnd);
    currentStart.setDate(currentStart.getDate() + 1);
  }
  return ranges;
}

// ─── Main service function ────────────────────────────────────────────────────

/**
 * Syncs TayoTransfer remittances and writes rmtNo → data_field_id.
 * Handles both daily sync and chunked historical backfilling.
 *
 * @param {import('mysql2/promise').Pool} pool  Shared mysql2 promise pool
 * @returns {Promise<{ total: number, updated: number }>}
 */
async function syncLatestTransfers(pool) {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  if (!basicAuth) {
    throw new Error("Missing TAYO_BASIC_AUTH environment variable");
  }

  // ── Step 1: Authenticate and retrieve session token ONCE ────────────────
  const authRes = await axios.post(TOKEN_URL, null, {
    headers: { Authorization: `Basic ${basicAuth}` },
    proxy: PROXY,
  });
  const token = authRes.data?.Token;
  if (!token) {
    throw new Error(`TayoTransfer auth response did not include a Token. HTTP ${authRes.status}.`);
  }

  // ── Step 2: Determine Date Ranges (Standard vs Historical) ──────────────
  let dateRanges = [];
  if (process.env.TAYO_HISTORICAL_SYNC_ENABLED === 'true') {
    const start = process.env.TAYO_SYNC_START_DATE;
    const end = process.env.TAYO_SYNC_END_DATE;
    const interval = parseInt(process.env.TAYO_SYNC_INTERVAL_DAYS || '2', 10);
    
    if (!start || !end) {
      throw new Error("Historical sync is enabled but missing TAYO_SYNC_START_DATE or TAYO_SYNC_END_DATE in .env");
    }
    dateRanges = getChunkedDateRanges(start, end, interval);
    console.log(`[Sync Worker] Historical sync enabled. Processing ${dateRanges.length} chunks of ${interval} days.`);
  } else {
    // Default 1-day behavior
    dateRanges = [getDateRange()];
  }

  let totalTransfers = 0;
  let totalUpdated = 0;
  const conn = await pool.getConnection();

  try {
    // ── Step 3: Loop through each date chunk and fetch data ───────────────
    for (const { frDate, toDate } of dateRanges) {
      console.log(`[Sync Worker] Fetching Tayo transfers from ${frDate} to ${toDate}`);

      const plainPayload = JSON.stringify({
        ClientId: "fEuluus",
        FrDate: frDate,
        ToDate: toDate,
      });
      const encryptedPayload = encrypt(plainPayload);

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

      const encryptedResponse = dataRes.data;

      // Parse the response
      let parsed;
      try {
        parsed = JSON.parse(encryptedResponse);
      } catch {
        console.error(`[Sync Worker] Error: TayoTransfer response is not valid JSON for range ${frDate}-${toDate}. Skipping to next chunk.`);
        continue;
      }

      const transfers = parsed.RemittanceList ?? parsed;
      if (!Array.isArray(transfers)) {
        console.error(`[Sync Worker] Error: Unexpected Tayo response format for range ${frDate}-${toDate}. Skipping.`);
        continue;
      }

      // Filter EFU sub-agent transfers
      const efuTransfers = transfers.filter((t) => t.Frsubagent === "EFU");
      totalTransfers += efuTransfers.length;

      // ── Step 4: Update data_field_id in the transfers table ───────────────
      for (const t of efuTransfers) {
        if (!t.Wstransid) continue;

        let validDatePaid = null;

        // Clean up the 1900 dummy date and strict-format for MySQL
        if (t.Datepaid && !t.Datepaid.includes('1/1/1900')) {
          const parsedDate = new Date(t.Datepaid);
          if (!isNaN(parsedDate.getTime())) {
            const yyyy = parsedDate.getFullYear();
            const mm = String(parsedDate.getMonth() + 1).padStart(2, '0');
            const dd = String(parsedDate.getDate()).padStart(2, '0');
            const hh = String(parsedDate.getHours()).padStart(2, '0');
            const min = String(parsedDate.getMinutes()).padStart(2, '0');
            const ss = String(parsedDate.getSeconds()).padStart(2, '0');
            
            validDatePaid = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
          }
        }

        const [result] = await conn.execute(
          "UPDATE transfers SET data_field_id = ?, data_field_status = ?, tayo_date_paid = ? WHERE transaction_ref = ?",
          [t.Rmtno ?? null, t.Status ?? null, validDatePaid, t.Wstransid]
        );
        
        if (result.affectedRows > 0) totalUpdated++;
      }
      
      // Safety measure: wait 500ms between API calls so Tayo doesn't rate-limit you
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } finally {
    conn.release();
  }
  
  return { total: totalTransfers, updated: totalUpdated };
}

module.exports = { syncLatestTransfers };