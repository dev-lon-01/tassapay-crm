import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { requireAuth } from "@/src/lib/auth";
import { jsonError } from "@/src/lib/httpResponses";
import {
  VOICE_AGENT_TTL_SECONDS,
  VOICE_HEARTBEAT_INTERVAL_SECONDS,
  VOICE_TOKEN_TTL_SECONDS,
} from "@/src/lib/voiceRuntime";

const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const apiKey = process.env.TWILIO_API_KEY!;
    const apiSecret = process.env.TWILIO_API_SECRET!;
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID!;

    if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
      return jsonError("Twilio Voice env vars not configured", 503);
    }

    const identity = `agent_${auth.id}`;
    const now = Math.floor(Date.now() / 1000);

    const token = new AccessToken(accountSid, apiKey, apiSecret, {
      identity,
      ttl: VOICE_TOKEN_TTL_SECONDS,
    });

    const grant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
    });

    token.addGrant(grant);

    return NextResponse.json({
      token: token.toJwt(),
      identity,
      ttlSeconds: VOICE_TOKEN_TTL_SECONDS,
      expiresAt: (now + VOICE_TOKEN_TTL_SECONDS) * 1000,
      heartbeatIntervalSeconds: VOICE_HEARTBEAT_INTERVAL_SECONDS,
      agentTtlSeconds: VOICE_AGENT_TTL_SECONDS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[GET /api/voice/token]", message);
    return jsonError(message, 500);
  }
}

