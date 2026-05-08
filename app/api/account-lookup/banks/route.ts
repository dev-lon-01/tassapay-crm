import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth";
import { jsonError } from "@/src/lib/httpResponses";
import { getSupportedMethods, isSupportedCountry } from "@/src/lib/accountLookup";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const country = searchParams.get("country") ?? "";

  if (!isSupportedCountry(country)) {
    return jsonError(`Unsupported country: ${country || "(missing)"}`, 400);
  }

  return NextResponse.json({
    country,
    methods: getSupportedMethods(country),
  });
}
