/**
 * Test-only shim. Re-implements tayoEthiopiaLookup in plain ESM so the
 * verification script can run without a TS toolchain.
 * Keep this file in lockstep with src/lib/accountLookup/tayoEthiopia.ts.
 */

const TOKEN_URL = "http://efuluusprod.tayotransfer.com/api/Token";
const LOOKUP_URL =
  "http://efuluusprod.tayotransfer.com/api/remittance/accountlookupAuthentication";

async function fetchToken() {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  if (!basicAuth) throw new Error("Missing TAYO_BASIC_AUTH");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}` },
  });
  if (!res.ok) throw new Error(`Token HTTP ${res.status}`);
  const body = await res.json();
  if (!body?.Token) throw new Error("No Token in response");
  return body.Token;
}

export async function tayoEthiopiaLookupForTests(req) {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  const token = await fetchToken();

  const res = await fetch(LOOKUP_URL, {
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

  if (res.status !== 200 && res.status !== 400) {
    return { status: "error", accountName: null, responseCode: null,
             responseDescription: `HTTP ${res.status}`, raw: await res.text() };
  }

  const body = await res.json();
  const message = body?.result?.[0]?.message;
  if (res.status === 200 && message === "success" && body.accountName) {
    return {
      status: "success",
      accountName: body.accountName,
      responseCode: body.response ?? null,
      responseDescription: body.responseDescription ?? null,
      raw: body,
    };
  }
  return {
    status: "failed",
    accountName: null,
    responseCode: body?.response ?? null,
    responseDescription: body?.responseDescription ?? null,
    raw: body,
  };
}
