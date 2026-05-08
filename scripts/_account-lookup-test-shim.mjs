/**
 * Test-only shim. Mirrors src/lib/accountLookup/tayoEthiopia.ts in plain ESM
 * so the verification script can run without a TS toolchain.
 *
 * Uses axios + optional TAYO_PROXY_HOST/PORT (mirrors src/services/tayoSyncService.js)
 * so the test can run from dev environments behind the project's egress proxy.
 * The production handler uses bare fetch — production has direct IP allowlist
 * and doesn't need the proxy.
 *
 * Body shape: AES-encrypted `{ accountnumber, bankname }` wrapped as
 * `{ jsonstring: <encrypted> }`. Response keys are capitalized.
 * Keep in lockstep with tayoEthiopia.ts.
 */

import axios from "axios";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { encrypt } = require("../src/utils/tayoCrypto");

const TOKEN_URL = "http://efuluusprod.tayotransfer.com/api/Token";
const LOOKUP_URL = "http://efuluusprod.tayotransfer.com/api/AccountLookup";

// Read at call time, not module load time — env vars are loaded by dotenv
// in the test script after this module is imported.
function getProxy() {
  return process.env.TAYO_PROXY_HOST
    ? {
        host: process.env.TAYO_PROXY_HOST,
        port: Number(process.env.TAYO_PROXY_PORT ?? 808),
        protocol: "http",
      }
    : false;
}

async function fetchToken() {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  if (!basicAuth) throw new Error("Missing TAYO_BASIC_AUTH");
  const res = await axios.post(TOKEN_URL, null, {
    headers: { Authorization: `Basic ${basicAuth}` },
    proxy: getProxy(),
    validateStatus: () => true,
  });
  if (res.status !== 200) throw new Error(`Token HTTP ${res.status}`);
  if (!res.data?.Token) throw new Error("No Token in response");
  return res.data.Token;
}

export async function tayoEthiopiaLookupForTests(req) {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  const token = await fetchToken();

  const encrypted = encrypt(
    JSON.stringify({
      accountnumber: req.accountNumber,
      bankname: req.methodCode,
    })
  );

  const res = await axios.post(
    LOOKUP_URL,
    { jsonstring: encrypted },
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Efuluusrodp2025: token,
        "Content-Type": "application/json",
      },
      proxy: getProxy(),
      validateStatus: () => true,
    },
  );

  if (res.status !== 200 && res.status !== 400) {
    return {
      status: "error",
      accountName: null,
      responseCode: null,
      responseDescription: `HTTP ${res.status}`,
      raw: res.data,
    };
  }

  const body = res.data ?? {};
  const message = body?.Result?.[0]?.Message;
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
    responseCode: body?.Response ?? null,
    responseDescription: body?.ResponseDescription ?? null,
    raw: body,
  };
}
