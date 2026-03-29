const fs = require("fs/promises");
const path = require("path");
const mysql = require("mysql2/promise");
const Papa = require("papaparse");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const PROVIDERS = ["volume", "emerchantpay", "paycross"];
const BASE_DIR = path.resolve(__dirname, "../data/payments");

const TRANSFER_LOOKUP_SQL = `
  SELECT id, send_amount FROM transfers WHERE transaction_ref = ? LIMIT 1
`;

const UPSERT_SQL = `
  INSERT INTO payments (
    provider,
    provider_payment_id,
    transfer_ref,
    payment_type,
    payment_method,
    amount,
    currency,
    status,
    provider_status,
    payment_date,
    raw_data,
    is_reconciled,
    reconciliation_note
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    transfer_ref = VALUES(transfer_ref),
    payment_type = VALUES(payment_type),
    payment_method = VALUES(payment_method),
    amount = VALUES(amount),
    currency = VALUES(currency),
    status = VALUES(status),
    provider_status = VALUES(provider_status),
    payment_date = VALUES(payment_date),
    raw_data = VALUES(raw_data),
    is_reconciled = VALUES(is_reconciled),
    reconciliation_note = VALUES(reconciliation_note),
    updated_at = CURRENT_TIMESTAMP
`;

function timestampSuffix() {
  return String(Math.floor(Date.now() / 1000));
}

async function ensureDirectories() {
  for (const provider of PROVIDERS) {
    await fs.mkdir(path.join(BASE_DIR, provider, "done"), { recursive: true });
  }
}

async function parseCsv(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  const parsed = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => String(header ?? "").trim(),
  });

  if (parsed.errors.length > 0) {
    const fatalErrors = parsed.errors.filter((error) => error.code !== "UndetectableDelimiter");
    if (fatalErrors.length > 0) {
      throw new Error(fatalErrors.map((error) => error.message).join("; "));
    }
  }

  return parsed.data;
}

async function processFile(pool, provider, fileName, normalizePaymentRow) {
  const sourcePath = path.join(BASE_DIR, provider, fileName);
  const doneDir = path.join(BASE_DIR, provider, "done");
  const rows = await parseCsv(sourcePath);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const conn = await pool.getConnection();
  try {
    for (const row of rows) {
      try {
        const payment = normalizePaymentRow(provider, row);

        // Only process success or refunded rows
        if (payment.status !== "success" && payment.status !== "refunded") {
          skipped += 1;
          continue;
        }

        await conn.beginTransaction();
        try {
          let isReconciled = false;
          let reconciliationNote = null;

          // Lookup transfer by ref (with Volume suffix fallback)
          let effectiveRef = payment.transfer_ref;
          let [transferRows] = effectiveRef
            ? await conn.execute(TRANSFER_LOOKUP_SQL, [effectiveRef])
            : [[]];

          // If no match and we have a stripped ref, try that
          if (transferRows.length === 0 && payment.transfer_ref_stripped) {
            const [strippedRows] = await conn.execute(TRANSFER_LOOKUP_SQL, [payment.transfer_ref_stripped]);
            if (strippedRows.length > 0) {
              transferRows = strippedRows;
              effectiveRef = payment.transfer_ref_stripped;
              payment.transfer_ref = effectiveRef;
            }
          }
          const transfer = transferRows[0] ?? null;

          if (!transfer) {
            // Orphan: transfer not found
            isReconciled = false;
            reconciliationNote = "Orphan: Transfer ID not found";
          } else if (payment.payment_type === "refund") {
            // Refund row — mark reconciled, update transfer status
            isReconciled = true;
            reconciliationNote = null;
            await conn.execute(
              `UPDATE transfers SET status = 'Refunded' WHERE id = ?`,
              [transfer.id],
            );
          } else {
            const transferAmount = Number(transfer.send_amount ?? 0);
            const paymentAmount = Number(payment.amount ?? 0);

            if (transferAmount > 0 && paymentAmount > 0 && Math.abs(paymentAmount - transferAmount) > 0.009) {
              // Amount mismatch
              isReconciled = false;
              reconciliationNote = "Amount Mismatch";
              await conn.execute(
                `UPDATE transfers SET reconciliation_status = 'mismatch' WHERE id = ?`,
                [transfer.id],
              );
            } else {
              // Perfect match
              isReconciled = true;
              reconciliationNote = null;
            }
          }

          const [result] = await conn.execute(UPSERT_SQL, [
            payment.provider,
            payment.provider_payment_id,
            payment.transfer_ref,
            payment.payment_type,
            payment.payment_method,
            payment.amount,
            payment.currency,
            payment.status,
            payment.provider_status,
            payment.payment_date,
            JSON.stringify(payment.raw_data),
            isReconciled,
            reconciliationNote,
          ]);

          // For perfect match, set primary_payment_id on the transfer
          if (transfer && isReconciled && payment.payment_type !== "refund") {
            const paymentId = result.insertId || null;
            if (paymentId) {
              await conn.execute(
                `UPDATE transfers SET primary_payment_id = ?, reconciliation_status = 'matched' WHERE id = ?`,
                [paymentId, transfer.id],
              );
            }
          }

          // Handle Volume synthetic refund row
          if (payment.refund) {
            let refundIsReconciled = false;
            let refundNote = null;

            if (transfer) {
              refundIsReconciled = true;
              refundNote = null;
              await conn.execute(
                `UPDATE transfers SET status = 'Refunded' WHERE id = ?`,
                [transfer.id],
              );
            } else {
              refundIsReconciled = false;
              refundNote = "Orphan: Transfer ID not found";
            }

            await conn.execute(UPSERT_SQL, [
              payment.provider,
              payment.refund.provider_payment_id,
              payment.transfer_ref,
              "refund",
              payment.payment_method,
              payment.refund.amount,
              payment.currency,
              "refunded",
              payment.provider_status,
              payment.refund.payment_date,
              JSON.stringify(payment.raw_data),
              refundIsReconciled,
              refundNote,
            ]);
          }

          await conn.commit();

          if (result.affectedRows === 1) inserted += 1;
          else if (result.affectedRows >= 2) updated += 1;
        } catch (txError) {
          await conn.rollback();
          throw txError;
        }
      } catch (error) {
        skipped += 1;
        console.error(`[payments:${provider}] Skipping row in ${fileName}:`, error.message);
      }
    }
  } finally {
    conn.release();
  }

  const parsedName = path.parse(fileName);
  const doneName = `${parsedName.name}.${timestampSuffix()}${parsedName.ext}`;
  try {
    await fs.rename(sourcePath, path.join(doneDir, doneName));
  } catch (archiveError) {
    console.warn(`[payments:${provider}] Could not archive ${fileName}: ${archiveError.message}`);
  }

  console.log(
    `[payments:${provider}] ${fileName} processed -- ${inserted} inserted, ${updated} updated, ${skipped} skipped`,
  );
}

async function run() {
  const { normalizePaymentRow } = await import("../src/services/paymentImport.mjs");

  const pool = mysql.createPool({
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "tassapay_crm",
    waitForConnections: true,
    connectionLimit: 5,
  });

  try {
    await ensureDirectories();

    for (const provider of PROVIDERS) {
      const providerDir = path.join(BASE_DIR, provider);
      const entries = await fs.readdir(providerDir, { withFileTypes: true });
      const csvFiles = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
        .map((entry) => entry.name)
        .sort();

      if (csvFiles.length === 0) {
        console.log(`[payments:${provider}] No CSV files found`);
        continue;
      }

      for (const fileName of csvFiles) {
        await processFile(pool, provider, fileName, normalizePaymentRow);
      }
    }
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error("Payment worker failed:", error.message);
  process.exit(1);
});
