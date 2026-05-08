import type { LookupRequest, LookupResult } from "./types";
import { fetchTayoToken } from "./tayoToken";
// CommonJS module exporting { encrypt, decrypt } — same pattern used by
// src/services/tayoSyncService.js for the RemittanceList endpoint.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { encrypt } = require("@/src/utils/tayoCrypto") as {
  encrypt: (plain: string) => string;
};

const LOOKUP_URL = "http://efuluusprod.tayotransfer.com/api/AccountLookup";

interface TayoLookupBody {
  Result?: Array<{ Message?: string; Code?: string }>;
  Response?: string | null;
  ResponseDescription?: string | null;
  InstitutionId?: string | null;
  InstitutionName?: string | null;
  AccountNumber?: string | null;
  AccountName?: string | null;
}

/**
 * Calls Tayo's AccountLookup endpoint.
 *
 * Auth: HTTP Basic + `Efuluusrodp2025: <session-token>` (token from /api/Token).
 * Body: AES-encrypted JSON `{ accountnumber, bankname }` wrapped as
 * `{ jsonstring: <encrypted> }` — same envelope used by /api/RemittanceList.
 *
 * Response shape (capitalized keys, NOT the camelCase shape originally documented):
 *   { Result: [{ Message: "success"|"failed", Code: "200"|"201" }],
 *     Response: "000"|"999"|null, ResponseDescription, InstitutionName,
 *     AccountNumber, AccountName, ... }
 */
export async function tayoEthiopiaLookup(req: LookupRequest): Promise<LookupResult> {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  if (!basicAuth) {
    return errorResult("Missing TAYO_BASIC_AUTH environment variable");
  }

  let token: string;
  try {
    ({ token } = await fetchTayoToken());
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }

  const encrypted = encrypt(
    JSON.stringify({
      accountnumber: req.accountNumber,
      bankname: req.methodCode,
    })
  );

  let res: Response;
  try {
    res = await fetch(LOOKUP_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Efuluusrodp2025: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonstring: encrypted }),
    });
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }

  // Tayo returns 200 for both success and "failed" outcomes on this endpoint.
  // 400 was the original spec; keep accepting it defensively.
  if (res.status !== 200 && res.status !== 400) {
    const text = await res.text().catch(() => "");
    return errorResult(`Unexpected upstream status ${res.status}`, text);
  }

  let body: TayoLookupBody;
  try {
    body = (await res.json()) as TayoLookupBody;
  } catch (e) {
    return errorResult(`Malformed upstream JSON: ${(e as Error).message}`);
  }

  const message = body.Result?.[0]?.Message;
  if (message === "success" && body.AccountName) {
    return {
      status: "success",
      accountName: body.AccountName,
      responseCode: body.Response ?? null,
      responseDescription: body.ResponseDescription ?? null,
      raw: body,
    };
  }

  return {
    status: "failed",
    accountName: null,
    responseCode: body.Response ?? null,
    responseDescription: body.ResponseDescription ?? null,
    raw: body,
  };
}

function errorResult(message: string, raw?: unknown): LookupResult {
  return {
    status: "error",
    accountName: null,
    responseCode: null,
    responseDescription: message,
    raw: raw ?? { error: message },
  };
}
