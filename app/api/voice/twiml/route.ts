import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { pool } from "@/src/lib/db";
import {
  buildExpectedWebhookUrl,
  extractE164FromSip,
  findCustomerIdByPhone,
  isValidE164,
  parseTwilioFormBody,
  upsertCallInteraction,
  validateTwilioWebhook,
} from "@/src/lib/voiceCallState";
import type { RowDataPacket } from "mysql2";

const { VoiceResponse } = twilio.twiml;

export async function POST(req: NextRequest) {
  const text = await req.text();
  const params = parseTwilioFormBody(text);

  const baseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const url = buildExpectedWebhookUrl(`${req.nextUrl.pathname}${req.nextUrl.search}`);
  const isValid = validateTwilioWebhook(signature, url, params);
  if (!isValid) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const twiml = new VoiceResponse();
  const fromParam = params["From"] ?? "";
  const toParam = params["To"] ?? "";
  const callSid = params["CallSid"] ?? "";
  const callWebhookBase = `${baseUrl}/api/voice/call-completed`;
  const recordingStatusCallback = `${callWebhookBase}?source=recording`;
  const dialOptions = {
    record: "record-from-answer" as const,
    recordingStatusCallback,
    recordingStatusCallbackMethod: "POST" as const,
    method: "POST" as const,
  };

  const isSipAgent = fromParam.startsWith("sip:");
  const isBrowserAgent = fromParam.startsWith("client:");
  const sipOutboundNumber = isSipAgent ? extractE164FromSip(toParam) : null;
  const browserOutboundNumber = isBrowserAgent && isValidE164(toParam) ? toParam : null;

  if (isSipAgent && !sipOutboundNumber) {
    twiml.say({ voice: "alice" }, "Please enter a valid phone number and try again.");
    twiml.hangup();
  } else if (sipOutboundNumber || browserOutboundNumber) {
    const targetNumber = sipOutboundNumber ?? browserOutboundNumber!;
    const actionUrl = `${callWebhookBase}?source=dial-action&flow=outbound&leg=parent`;
    const pstnStatusUrl = `${callWebhookBase}?source=leg-status&flow=outbound&leg=pstn`;
    const dial = twiml.dial({
      ...dialOptions,
      callerId: process.env.TWILIO_PHONE_NUMBER!,
      action: actionUrl,
    });
    dial.number(
      {
        statusCallback: pstnStatusUrl,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      },
      targetNumber
    );
  } else if (isBrowserAgent) {
    twiml.say({ voice: "alice" }, "Please enter a valid phone number and try again.");
    twiml.hangup();
  } else {
    const sipDomain = process.env.TWILIO_SIP_DOMAIN?.trim() ?? "";
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT id, sip_username FROM users WHERE voice_available = 1 ORDER BY id ASC LIMIT 1"
    );
    if (rows.length > 0) {
      const agentId  = rows[0].id as number;
      const sipUser  = (rows[0].sip_username as string | null)?.trim() || `agent_${agentId}`;
      const actionUrl = `${callWebhookBase}?source=dial-action&flow=inbound&leg=parent&agentId=${agentId}`;
      const dial = twiml.dial({ ...dialOptions, action: actionUrl });
      dial.client(
        {
          statusCallback: `${callWebhookBase}?source=leg-status&flow=inbound&leg=browser&agentId=${agentId}`,
          statusCallbackMethod: "POST",
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        },
        `agent_${agentId}`
      );
      if (sipDomain) {
        dial.sip(
          {
            statusCallback: `${callWebhookBase}?source=leg-status&flow=inbound&leg=sip&agentId=${agentId}`,
            statusCallbackMethod: "POST",
            statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
          },
          `sip:${sipUser}@${sipDomain}`
        );
      }
    } else {
      const customerId = await findCustomerIdByPhone(fromParam);
      if (callSid) {
        await upsertCallInteraction({
          lookupSids: [callSid],
          twilioCallSid: callSid,
          customerId,
          agentId: null,
          direction: "inbound",
          outcome: "Missed Inbound Call",
          note: `Inbound from ${fromParam || "Unknown"} — no agents available`,
          metadata: {
            flow: "inbound",
            leg: "voicemail",
            source: "twiml-no-agent",
            from: fromParam || null,
            to: toParam || null,
            noAgentsAvailable: true,
          },
        });
      }
      twiml.say(
        { voice: "alice" },
        "Thank you for calling TassaPay. All agents are currently unavailable. Please leave a message after the tone and we will get back to you."
      );
      twiml.record({
        maxLength: 120,
        finishOnKey: "#",
        recordingStatusCallback: `${recordingStatusCallback}&flow=inbound&leg=voicemail`,
        recordingStatusCallbackMethod: "POST",
        transcribe: false,
      });
      twiml.say({ voice: "alice" }, "We did not receive a recording. Goodbye.");
      twiml.hangup();
    }
  }

  return new NextResponse(twiml.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
