/**
 * Fetches a session token from Tayo using HTTP Basic Auth.
 * Mirrors the flow in src/services/tayoSyncService.js so we don't import
 * from JS service code into TS lib code.
 *
 * The returned token must be sent on subsequent calls in the
 * `Efuluusrodp2025` header alongside Basic Auth.
 */

const TOKEN_URL = "http://efuluusprod.tayotransfer.com/api/Token";

export interface TayoToken {
  token: string;
}

export async function fetchTayoToken(): Promise<TayoToken> {
  const basicAuth = process.env.TAYO_BASIC_AUTH;
  if (!basicAuth) {
    throw new Error("Missing TAYO_BASIC_AUTH environment variable");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}` },
  });

  if (!res.ok) {
    throw new Error(`Tayo token request failed: HTTP ${res.status}`);
  }

  const body = (await res.json().catch(() => null)) as { Token?: string } | null;
  if (!body?.Token) {
    throw new Error("Tayo token response did not include a Token field");
  }

  return { token: body.Token };
}
