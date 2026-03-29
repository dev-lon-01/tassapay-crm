const PROVIDER_FIELD_ALIASES = {
  volume: {
    providerPaymentId: ["transaction id", "transaction_id", "payment id", "payment_id", "gateway transaction id", "id"],
    transferRef: ["merchant payment id", "merchant_payment_id", "merchant transaction id", "transfer ref", "transfer reference", "reference", "merchant reference", "order id"],
    paymentType: ["type", "transaction type", "operation", "entry type", "payment type"],
    paymentMethod: ["payment method", "method", "source", "channel"],
    amount: ["amount", "payment amount", "transaction amount", "gross amount", "processed amount"],
    currency: ["currency", "payment currency", "transaction currency"],
    providerStatus: ["status", "transaction status", "payment status", "result"],
    paymentDate: ["creation time utc", "date", "payment date", "transaction date", "processed at", "created at"],
  },
  emerchantpay: {
    providerPaymentId: ["unique id", "unique_id", "transaction id", "transaction_id", "payment id", "payment_id"],
    transferRef: ["merchant transaction id", "merchant_transaction_id", "reference", "order id", "descriptor"],
    paymentType: ["type", "transaction type", "usage", "operation"],
    paymentMethod: ["payment method", "scheme", "channel", "method"],
    amount: ["amount (with decimal mark per currency exponent)", "amount", "transaction amount", "processed amount", "total amount"],
    currency: ["currency", "transaction currency"],
    providerStatus: ["status", "state", "result", "transaction status"],
    paymentDate: ["datetime (utc)", "datetime", "date", "processed at", "timestamp", "created at"],
  },
  paycross: {
    providerPaymentId: ["transactions uid", "payment id", "payment_id", "transaction id", "transaction_id", "invoice id", "id"],
    transferRef: ["tracking id", "transfer ref", "transfer reference", "merchant reference", "reference", "order id"],
    paymentType: ["transaction type", "type", "payment type", "operation", "flow"],
    paymentMethod: ["brand", "method", "payment method", "source", "channel"],
    amount: ["amount", "payment amount", "gross amount", "net amount"],
    currency: ["currency", "payment currency"],
    providerStatus: ["status", "payment status", "state", "result"],
    paymentDate: ["paid at", "date", "payment date", "created at", "processed at"],
  },
};

const GENERIC_ALIASES = {
  providerPaymentId: ["provider payment id", "gateway id", "gateway reference"],
  transferRef: ["transfer ref", "transfer reference", "customer reference"],
  paymentType: ["type", "kind"],
  paymentMethod: ["method", "payment method"],
  amount: ["amount", "value"],
  currency: ["currency", "ccy"],
  providerStatus: ["status", "state"],
  paymentDate: ["date", "created", "created at", "processed at"],
};

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildLookup(row) {
  const lookup = new Map();
  for (const [key, value] of Object.entries(row ?? {})) {
    lookup.set(normalizeHeader(key), value);
  }
  return lookup;
}

function firstValue(lookup, aliases) {
  for (const alias of aliases) {
    const value = lookup.get(normalizeHeader(alias));
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function cleanString(value) {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  return stringValue === "" ? null : stringValue;
}

function parseAmount(value) {
  const raw = cleanString(value);
  if (!raw) return null;
  const normalized = raw.replace(/[,\s]/g, "").replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value) {
  const raw = cleanString(value);
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return toMySqlDate(direct);
  }

  const match = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;

  let [, first, second, year, hours = "00", minutes = "00", seconds = "00"] = match;
  if (year.length === 2) year = `20${year}`;

  const firstNumber = Number(first);
  const secondNumber = Number(second);
  const day = firstNumber > 12 ? first.padStart(2, "0") : second.padStart(2, "0");
  const month = firstNumber > 12 ? second.padStart(2, "0") : first.padStart(2, "0");

  return `${year}-${month}-${day} ${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}:${seconds.padStart(2, "0")}`;
}

function toMySqlDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const sec = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
}

export function normalizePaymentStatus(providerStatus, paymentType) {
  const raw = String(providerStatus ?? "").toLowerCase();
  const type = String(paymentType ?? "").toLowerCase();

  if (type.includes("refund") || /(refund|chargeback|reversal)/.test(raw)) {
    return "refunded";
  }
  if (/(success|succeed|approved|captured|settled|paid|received|complete|processed)/.test(raw)) {
    return "success";
  }
  return "failed";
}

function inferPaymentType(paymentType, providerStatus, amount) {
  const explicit = cleanString(paymentType);
  if (explicit) return explicit.toLowerCase().includes("refund") ? "refund" : explicit.toLowerCase();
  if (String(providerStatus ?? "").toLowerCase().includes("refund")) return "refund";
  if (typeof amount === "number" && amount < 0) return "refund";
  return "payment";
}

export function normalizePaymentRow(provider, rawRow) {
  const aliases = PROVIDER_FIELD_ALIASES[provider];
  if (!aliases) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const lookup = buildLookup(rawRow);
  const providerPaymentId = cleanString(
    firstValue(lookup, [...aliases.providerPaymentId, ...GENERIC_ALIASES.providerPaymentId]),
  );

  if (!providerPaymentId) {
    throw new Error("Missing provider payment id");
  }

  let amount = parseAmount(firstValue(lookup, [...aliases.amount, ...GENERIC_ALIASES.amount]));
  const transferRef = cleanString(firstValue(lookup, [...aliases.transferRef, ...GENERIC_ALIASES.transferRef]));
  const providerStatus = cleanString(firstValue(lookup, [...aliases.providerStatus, ...GENERIC_ALIASES.providerStatus]));
  const paymentType = inferPaymentType(
    firstValue(lookup, [...aliases.paymentType, ...GENERIC_ALIASES.paymentType]),
    providerStatus,
    amount,
  );

  if (typeof amount === "number" && amount < 0) {
    amount = Math.abs(amount);
  }

  // AC 2.3: Emerchantpay currency is always GBP
  const currency =
    provider === "emerchantpay"
      ? "GBP"
      : cleanString(firstValue(lookup, [...aliases.currency, ...GENERIC_ALIASES.currency]))?.toUpperCase() ?? null;

  const DEFAULT_PAYMENT_METHOD = {
    volume: "open-banking",
    emerchantpay: "card",
    paycross: "card",
  };

  // Volume TXN suffix stripping: TXN89712920_1767933245049 -> TXN89712920
  let transferRefStripped = null;
  if (provider === "volume" && transferRef) {
    const suffixMatch = transferRef.match(/^(TXN\d+)_\d+$/);
    if (suffixMatch) {
      transferRefStripped = suffixMatch[1];
    }
  }

  // Volume refund metadata: IS_REFUNDED, AMOUNT_REFUNDED, LAST_REFUND_TIME
  let refund = null;
  if (provider === "volume") {
    const isRefunded = cleanString(rawRow["IS_REFUNDED"] ?? rawRow["is_refunded"]);
    if (isRefunded && isRefunded.toLowerCase() === "true") {
      const refundAmount = parseAmount(rawRow["AMOUNT_REFUNDED"] ?? rawRow["amount_refunded"]);
      const refundDate = parseDate(rawRow["LAST_REFUND_TIME"] ?? rawRow["last_refund_time"]);
      if (refundAmount !== null) {
        refund = {
          provider_payment_id: `${providerPaymentId}-refund`,
          amount: refundAmount,
          payment_date: refundDate,
        };
      }
    }
  }

  const normalized = {
    provider,
    provider_payment_id: providerPaymentId,
    transfer_ref: transferRef,
    transfer_ref_stripped: transferRefStripped,
    payment_type: paymentType,
    payment_method: cleanString(firstValue(lookup, [...aliases.paymentMethod, ...GENERIC_ALIASES.paymentMethod])) ?? DEFAULT_PAYMENT_METHOD[provider] ?? null,
    amount,
    currency,
    provider_status: providerStatus,
    status: normalizePaymentStatus(providerStatus, paymentType),
    payment_date: parseDate(firstValue(lookup, [...aliases.paymentDate, ...GENERIC_ALIASES.paymentDate])),
    raw_data: rawRow,
    refund,
  };

  return normalized;
}
