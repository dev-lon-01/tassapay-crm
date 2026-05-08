import { NextRequest, NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2";
import { requireAuth } from "@/src/lib/auth";
import { jsonError } from "@/src/lib/httpResponses";
import { pool } from "@/src/lib/db";
import {
  findMethod,
  isSupportedCountry,
  lookupAccount,
  type CountryCode,
  type MethodType,
} from "@/src/lib/accountLookup";

// ─── per-agent in-memory rate limiter (30 / minute) ──────────────────────────
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const buckets = new Map<number, { count: number; resetAt: number }>();

function rateLimit(agentId: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(agentId);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(agentId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_MAX) return false;
  bucket.count += 1;
  return true;
}

interface RequestBody {
  country?: string;
  methodType?: string;
  methodCode?: string;
  accountNumber?: string;
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (!rateLimit(auth.id)) {
    return jsonError("Rate limit exceeded — try again in a minute", 429);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const country = (body.country ?? "").trim();
  const methodType = (body.methodType ?? "").trim();
  const methodCode = (body.methodCode ?? "").trim();
  const accountNumber = (body.accountNumber ?? "").trim();

  if (!isSupportedCountry(country)) {
    return jsonError(`Unsupported country: ${country || "(missing)"}`, 400);
  }
  if (methodType !== "bank" && methodType !== "wallet") {
    return jsonError(`Invalid methodType: ${methodType || "(missing)"}`, 400);
  }
  if (!accountNumber) {
    return jsonError("accountNumber is required", 400);
  }
  const method = findMethod(country as CountryCode, methodCode);
  if (!method) {
    return jsonError(`Unknown methodCode for ${country}: ${methodCode || "(missing)"}`, 400);
  }
  if (method.type !== (methodType as MethodType)) {
    return jsonError(
      `methodType '${methodType}' does not match the registered type '${method.type}' for code '${methodCode}'`,
      400
    );
  }

  const result = await lookupAccount({
    country: country as CountryCode,
    methodType: methodType as MethodType,
    methodCode,
    accountNumber,
  });

  let lookupId: number | null = null;
  try {
    const [insertResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO account_lookups
         (agent_id, country_code, provider, method_type, method_code,
          account_number, status, account_name, response_code,
          response_description, raw_response)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auth.id,
        country,
        "tayo",
        methodType,
        methodCode,
        accountNumber,
        result.status,
        result.accountName,
        result.responseCode,
        result.responseDescription,
        result.raw == null ? null : JSON.stringify(result.raw),
      ]
    );
    lookupId = insertResult.insertId;
  } catch (e) {
    console.error("[POST /api/account-lookup] audit insert failed:",
      e instanceof Error ? e.message : String(e));
  }

  if (result.status === "error") {
    return NextResponse.json(
      {
        lookupId,
        status: result.status,
        accountName: null,
        responseCode: result.responseCode,
        responseDescription: result.responseDescription,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    lookupId,
    status: result.status,
    accountName: result.accountName,
    responseCode: result.responseCode,
    responseDescription: result.responseDescription,
  });
}
