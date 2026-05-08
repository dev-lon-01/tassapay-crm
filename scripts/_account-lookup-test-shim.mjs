/**
 * Test-only shim. Re-implements tayoEthiopiaLookup in plain ESM so the
 * verification script can run without a TS toolchain.
 * Keep this file in lockstep with src/lib/accountLookup/tayoEthiopia.ts.
 *
 * NOTE: Uses axios + the TAYO_PROXY_HOST/PORT proxy because Tayo's API is
 * IP-allowlisted and only accepts traffic via the project's egress proxy
 * (mirrors src/services/tayoSyncService.js). Node's global fetch does not
 * accept axios-style `proxy` config, so we use axios here for parity with
 * the existing Tayo caller.
 */

import axios from "axios";

const TOKEN_URL = "http://efuluusprod.tayotransfer.com/api/Token";
const LOOKUP_URL =
  "http://efuluusprod.tayotransfer.com/api/remittance/accountlookupAuthentication";

const PROXY = process.env.TAYO_PROXY_HOST
  ? {
      host: process.env.TAYO_PROXY_HOST,
      port: Number(process.env.TAYO_PROXY_PORT ?? 808),
      protocol: "http",
    }
  : false;

async function fetchToken() {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  if (!basicAuth) throw new Error("Missing TAYO_BASIC_AUTH");
  const res = await axios.post(TOKEN_URL, null, {
    headers: { Authorization: `Basic ${basicAuth}` },
    proxy: PROXY,
    validateStatus: () => true,
  });
  if (res.status !== 200) throw new Error(`Token HTTP ${res.status}`);
  if (!res.data?.Token) throw new Error("No Token in response");
  return res.data.Token;
}

export async function tayoEthiopiaLookupForTests(req) {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  const token = await fetchToken();

  const res = await axios.post(
    LOOKUP_URL,
    {
      accountNumber: req.accountNumber,
      bankName: req.methodCode,
    },
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Efuluusrodp2025: token,
        "Content-Type": "application/json",
      },
      proxy: PROXY,
      // Don't throw on 4xx — Tayo signals "failed" outcomes via 400.
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
