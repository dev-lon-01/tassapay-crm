import { NextResponse } from "next/server";
import { getCredentials } from "@/src/lib/tassapayApi";

/**
 * GET /api/health-check
 *
 * Verifies that the required env vars are present.
 * Returns their names (not values) so you can confirm .env.local is being read.
 */
export async function GET() {
  try {
    getCredentials(); // throws if any var is missing

    return NextResponse.json({
      ok: true,
      env: {
        TASSAPAY_USERNAME: "✓ set",
        TASSAPAY_PASSWORD: "✓ set",
        TASSAPAY_BRANCH_KEY: "✓ set",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
