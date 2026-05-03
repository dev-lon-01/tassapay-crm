import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/src/lib/auth";
import {
  recordVoiceDiagnostic,
  type VoiceDiagSeverity,
} from "@/src/lib/voiceDiagnostics";

const ALLOWED_SEVERITIES: VoiceDiagSeverity[] = ["info", "warn", "error"];
const ALLOWED_DIRECTIONS = ["inbound", "outbound"] as const;

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = typeof body.eventType === "string" ? body.eventType : null;
  const severity = typeof body.severity === "string" ? body.severity : null;
  if (!eventType || !severity) {
    return NextResponse.json(
      { error: "eventType and severity are required" },
      { status: 400 }
    );
  }
  if (!ALLOWED_SEVERITIES.includes(severity as VoiceDiagSeverity)) {
    return NextResponse.json({ error: "Invalid severity" }, { status: 400 });
  }

  const direction =
    typeof body.direction === "string" &&
    (ALLOWED_DIRECTIONS as readonly string[]).includes(body.direction)
      ? (body.direction as "inbound" | "outbound")
      : null;

  recordVoiceDiagnostic({
    source: "client",
    eventType: eventType.slice(0, 40),
    severity: severity as VoiceDiagSeverity,
    agentId: auth.id,
    callSid: typeof body.callSid === "string" ? body.callSid.slice(0, 64) : null,
    direction,
    errorCode:
      typeof body.errorCode === "string" || typeof body.errorCode === "number"
        ? body.errorCode
        : null,
    message: typeof body.message === "string" ? body.message : null,
    userAgent: req.headers.get("user-agent"),
    connectionType:
      typeof body.connectionType === "string" ? body.connectionType : null,
    phoneMasked:
      typeof body.phoneMasked === "string" ? body.phoneMasked : null,
    payload: body.payload ?? null,
  });

  return NextResponse.json({ ok: true });
}
