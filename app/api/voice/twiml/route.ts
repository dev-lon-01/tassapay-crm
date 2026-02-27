import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { pool } from "@/src/lib/db";
import type { RowDataPacket } from "mysql2";

const { VoiceResponse } = twilio.twiml;

export async function POST(req: NextRequest) {
  // Parse Twilio's form-encoded body
  const text = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text).entries()) {
    params[k] = v;
  }

  // Validate Twilio request signature
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const baseUrl   = process.env.APP_BASE_URL!;
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const url       = `${baseUrl}/api/voice/twiml`;

  const isDev = process.env.NODE_ENV === "development";
  const isValid = isDev || twilio.validateRequest(authToken, signature, url, params);
  if (!isValid) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const twiml = new VoiceResponse();
  const toParam = params["To"] ?? "";
  const statusCallbackUrl = `${baseUrl}/api/voice/status-callback`;
  const dialOptions = {
    record: "record-from-answer" as const,
    recordingStatusCallback: statusCallbackUrl,
    recordingStatusCallbackMethod: "POST" as const,
    action: statusCallbackUrl,
    method: "POST" as const,
  };

  if (toParam.startsWith("+")) {
    // Outbound call — dial the customer's number
    const dial = twiml.dial({ ...dialOptions, callerId: process.env.TWILIO_PHONE_NUMBER! });
    dial.number({}, toParam);
  } else {
    // Inbound call — route to first available agent
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM users WHERE voice_available = 1 ORDER BY id ASC LIMIT 1"
    );
    if (rows.length > 0) {
      const dial = twiml.dial(dialOptions);
      dial.client(`agent_${rows[0].id}`);
    } else {
      twiml.say("Thank you for calling TassaPay. All agents are currently unavailable. Please try again later.");
      twiml.hangup();
    }
  }

  return new NextResponse(twiml.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
