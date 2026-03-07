import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { requireAuth } from "@/src/lib/auth";

const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const accountSid  = process.env.TWILIO_ACCOUNT_SID!;
  const apiKey      = process.env.TWILIO_API_KEY!;
  const apiSecret   = process.env.TWILIO_API_SECRET!;
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID!;

  if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
    return NextResponse.json(
      { error: "Twilio Voice env vars not configured" },
      { status: 503 }
    );
  }

  const identity = `agent_${auth.id}`;

  const token = new AccessToken(accountSid, apiKey, apiSecret, {
    identity,
    ttl: 60 * 60 * 8,
  });

  const grant = new VoiceGrant({
    outgoingApplicationSid: twimlAppSid,
    incomingAllow: true,
  });

  token.addGrant(grant);

  return NextResponse.json({ token: token.toJwt(), identity });
}
