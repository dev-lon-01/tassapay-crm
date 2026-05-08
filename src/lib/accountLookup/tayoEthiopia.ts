import type { LookupRequest, LookupResult } from "./types";
import { fetchTayoToken } from "./tayoToken";

const LOOKUP_URL =
  "http://efuluusprod.tayotransfer.com/api/remittance/accountlookupAuthentication";

interface TayoLookupBody {
  result?: Array<{ message?: string; code?: string }>;
  response?: string;
  responseDescription?: string;
  institutionName?: string;
  accountNumber?: string;
  accountName?: string;
}

/**
 * Calls Tayo's accountlookupAuthentication endpoint.
 *
 * Tayo returns HTTP 400 for the documented "account not found / service
 * unavailable" cases — that is a normal `failed` outcome, NOT a transport
 * error. We read the JSON body in both 200 and 400 cases and read
 * `result[0].message` to decide.
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

  let res: Response;
  try {
    res = await fetch(LOOKUP_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Efuluusrodp2025: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accountNumber: req.accountNumber,
        bankName: req.methodCode,
      }),
    });
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }

  // Anything other than 200 or 400 is a transport-level error.
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

  const message = body.result?.[0]?.message;
  if (res.status === 200 && message === "success" && body.accountName) {
    return {
      status: "success",
      accountName: body.accountName,
      responseCode: body.response ?? null,
      responseDescription: body.responseDescription ?? null,
      raw: body,
    };
  }

  // 200-with-failed or 400 are normal "failed" outcomes.
  return {
    status: "failed",
    accountName: null,
    responseCode: body.response ?? null,
    responseDescription: body.responseDescription ?? null,
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
