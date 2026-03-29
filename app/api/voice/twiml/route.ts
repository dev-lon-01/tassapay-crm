import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import {
  buildExpectedWebhookUrl,
  extractE164FromSip,
  findAgentIdByIdentity,
  findCustomerIdByPhone,
  getFreshVoiceAgentRows,
  isValidE164,
  parseTwilioFormBody,
  upsertCallInteraction,
  validateTwilioWebhook,
} from "@/src/lib/voiceCallState";
import { VOICE_AGENT_TTL_SECONDS } from "@/src/lib/voiceRuntime";

const { VoiceResponse } = twilio.twiml;

function xml(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

function invalidDialResponse(message: string): NextResponse {
  const twiml = new VoiceResponse();
  twiml.say({ voice: "alice" }, message);
  twiml.hangup();
  return xml(twiml.toString());
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const params = parseTwilioFormBody(rawBody);
    const signature = req.headers.get("x-twilio-signature") ?? "";
    const url = buildExpectedWebhookUrl(`${req.nextUrl.pathname}${req.nextUrl.search}`);

    if (!validateTwilioWebhook(signature, url, params)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const baseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
    const twiml = new VoiceResponse();
    const fromParam = params.From ?? "";
    const toParam = params.To ?? "";
    const callSid = params.CallSid ?? "";
    const isSipAgent = fromParam.startsWith("sip:");
    const isBrowserAgent = fromParam.startsWith("client:");
    const flow = (isSipAgent || isBrowserAgent) ? "outbound" : "inbound";
    const callWebhookBase = `${baseUrl}/api/voice/call-completed`;
    const recordingStatusCallback = `${callWebhookBase}?source=recording&flow=${flow}&parentCallSid=${encodeURIComponent(callSid)}`;
    const dialOptions = {
      record: "record-from-answer" as const,
      recordingStatusCallback,
      recordingStatusCallbackMethod: "POST" as const,
      method: "POST" as const,
    };

    const sipOutboundNumber = isSipAgent ? extractE164FromSip(toParam) : null;
    const browserOutboundNumber = isBrowserAgent && isValidE164(toParam) ? toParam : null;

    if (isBrowserAgent && (toParam.startsWith("client:") || toParam.startsWith("sip:"))) {
      return invalidDialResponse("Browser calls must dial a phone number, not an internal endpoint.");
    }

    if ((isSipAgent || isBrowserAgent) && !sipOutboundNumber && !browserOutboundNumber) {
      return invalidDialResponse("Please enter a valid phone number and try again.");
    }

    const targetNumber = sipOutboundNumber ?? browserOutboundNumber;
    const customerPhone = flow === "outbound" ? targetNumber : fromParam;
    const customerId = await findCustomerIdByPhone(customerPhone);
    const agentId = flow === "outbound" ? await findAgentIdByIdentity(fromParam) : null;

    if (callSid) {
      await upsertCallInteraction({
        lookupSids: [callSid],
        twilioCallSid: callSid,
        customerId: customerId ?? undefined,
        agentId: agentId ?? undefined,
        direction: flow,
        callStatus: params.CallStatus ?? "initiated",
        note:
          flow === "outbound"
            ? `Outbound to ${targetNumber ?? "unknown"}`
            : `Inbound from ${fromParam || "Unknown"}`,
        metadata: {
          source: "twiml",
          flow,
          from: fromParam || null,
          to: toParam || null,
          callSid: callSid || null,
        },
      });
    }

    if (flow === "outbound") {
      const actionUrl = `${callWebhookBase}?source=dial-action&flow=outbound&leg=parent&parentCallSid=${encodeURIComponent(callSid)}`;
      const pstnStatusUrl = `${callWebhookBase}?source=leg-status&flow=outbound&leg=pstn&parentCallSid=${encodeURIComponent(callSid)}`;
      const dial = twiml.dial({
        ...dialOptions,
        callerId: process.env.TWILIO_PHONE_NUMBER ?? process.env.TWILIO_FROM_NUMBER!,
        action: actionUrl,
      });
      dial.number(
        {
          statusCallback: pstnStatusUrl,
          statusCallbackMethod: "POST",
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        },
        targetNumber!,
      );

      return xml(twiml.toString());
    }

    const availableAgents = await getFreshVoiceAgentRows(VOICE_AGENT_TTL_SECONDS);
    if (availableAgents.length > 0) {
      const selectedAgentId = Number(availableAgents[0].id);
      const sipDomain = process.env.TWILIO_SIP_DOMAIN?.trim() ?? "";
      const sipUser = (availableAgents[0].sip_username as string | null)?.trim() || `agent_${selectedAgentId}`;

      if (callSid) {
        await upsertCallInteraction({
          lookupSids: [callSid],
          twilioCallSid: callSid,
          customerId: customerId ?? undefined,
          agentId: selectedAgentId,
          direction: "inbound",
          callStatus: "ringing",
          note: `Inbound from ${fromParam || "Unknown"} - ringing agent ${selectedAgentId}`,
          metadata: {
            source: "twiml",
            flow: "inbound",
            selectedAgentId,
            from: fromParam || null,
            to: toParam || null,
            callSid: callSid || null,
          },
        });
      }

      const actionUrl = `${callWebhookBase}?source=dial-action&flow=inbound&leg=parent&agentId=${selectedAgentId}&parentCallSid=${encodeURIComponent(callSid)}`;
      const dial = twiml.dial({ ...dialOptions, action: actionUrl });
      dial.client(
        {
          statusCallback: `${callWebhookBase}?source=leg-status&flow=inbound&leg=browser&agentId=${selectedAgentId}&parentCallSid=${encodeURIComponent(callSid)}`,
          statusCallbackMethod: "POST",
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        },
        `agent_${selectedAgentId}`
      );
      if (sipDomain) {
        dial.sip(
          {
            statusCallback: `${callWebhookBase}?source=leg-status&flow=inbound&leg=sip&agentId=${selectedAgentId}&parentCallSid=${encodeURIComponent(callSid)}`,
            statusCallbackMethod: "POST",
            statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
          },
          `sip:${sipUser}@${sipDomain}`
        );
      }

      return xml(twiml.toString());
    }

    if (callSid) {
      await upsertCallInteraction({
        lookupSids: [callSid],
        twilioCallSid: callSid,
        customerId: customerId ?? undefined,
        agentId: null,
        direction: "inbound",
        callStatus: "voicemail-prompted",
        note: `Inbound from ${fromParam || "Unknown"} - no agents available`,
        metadata: {
          source: "twiml-no-agent",
          flow: "inbound",
          from: fromParam || null,
          to: toParam || null,
          callSid: callSid || null,
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
      recordingStatusCallback: `${recordingStatusCallback}&leg=voicemail`,
      recordingStatusCallbackMethod: "POST",
      transcribe: false,
    });
    twiml.say({ voice: "alice" }, "We did not receive a recording. Goodbye.");
    twiml.hangup();

    return xml(twiml.toString());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/voice/twiml]", message);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}


