import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import {
  buildExpectedWebhookUrl,
  extractClientIdentity,
  extractE164FromSip,
  findAgentIdByIdentity,
  findCustomerIdByPhone,
  isValidE164,
  parseTwilioFormBody,
  upsertCallInteraction,
  validateTwilioWebhook,
} from "@/src/lib/voiceCallState";

const { VoiceResponse } = twilio.twiml;

function xmlResponse(body = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>') {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function parseOptionalNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getCanonicalCallSid(params: Record<string, string>): string | null {
  return (
    params["ParentCallSid"] ||
    params["CallSid"] ||
    params["RecordingCallSid"] ||
    params["DialCallSid"] ||
    null
  );
}

function buildOutcome(flow: "inbound" | "outbound", status: string, isAction: boolean): string | undefined {
  if (!status) return undefined;

  if (flow === "outbound") {
    switch (status) {
      case "initiated":
        return "Outbound Call — Initiated";
      case "ringing":
        return "Outbound Call — Ringing";
      case "answered":
        return "Outbound Call — Answered";
      case "completed":
        return "Outbound Call";
      case "busy":
        return "Outbound Call — Busy";
      case "no-answer":
        return "Outbound Call — No Answer";
      case "failed":
        return "Outbound Call — Failed";
      case "canceled":
        return isAction ? "Outbound Call — Canceled" : undefined;
      default:
        return `Outbound Call — ${status}`;
    }
  }

  switch (status) {
    case "initiated":
    case "ringing":
      return "Inbound Call — Ringing";
    case "answered":
      return "Inbound Call — Answered";
    case "completed":
      return "Inbound Call";
    case "busy":
    case "no-answer":
    case "failed":
    case "canceled":
      return isAction ? "Missed Inbound Call" : undefined;
    default:
      return isAction ? `Inbound Call — ${status}` : undefined;
  }
}

function buildNote(
  flow: "inbound" | "outbound",
  status: string,
  from: string,
  to: string,
  leg: string | null,
  isAction: boolean
): string | undefined {
  if (flow === "outbound") {
    if (!to) return undefined;
    if (isAction) return `Outbound to ${to} — ${status || "completed"}`;
    return `Outbound to ${to}${status ? ` — ${status}` : ""}`;
  }

  if (!from) return undefined;
  if (isAction) return `Inbound from ${from} — ${status || "completed"}`;
  if (leg === "browser" || leg === "sip") {
    return `Inbound from ${from} — ${leg} leg ${status || "updated"}`;
  }
  return `Inbound from ${from}${status ? ` — ${status}` : ""}`;
}

function buildVoicemailResponse(baseUrl: string) {
  const twiml = new VoiceResponse();
  twiml.say(
    { voice: "alice" },
    "Sorry we missed your call. Please leave a message after the tone and press hash when done."
  );
  twiml.record({
    maxLength: 120,
    finishOnKey: "#",
    recordingStatusCallback: `${baseUrl}/api/voice/call-completed?source=recording&flow=inbound&leg=voicemail`,
    recordingStatusCallbackMethod: "POST",
    transcribe: false,
  });
  twiml.say({ voice: "alice" }, "We did not receive a recording. Goodbye.");
  twiml.hangup();
  return xmlResponse(twiml.toString());
}

export async function POST(req: NextRequest) {
  const text = await req.text();
  const params = parseTwilioFormBody(text);

  const signature = req.headers.get("x-twilio-signature") ?? "";
  const url = buildExpectedWebhookUrl(`${req.nextUrl.pathname}${req.nextUrl.search}`);
  const isValid = validateTwilioWebhook(signature, url, params);
  if (!isValid) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const baseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const source = req.nextUrl.searchParams.get("source");
  const flow = (req.nextUrl.searchParams.get("flow") === "outbound" ? "outbound" : "inbound") as
    | "inbound"
    | "outbound";
  const leg = req.nextUrl.searchParams.get("leg");
  const isAction = source === "dial-action" || Boolean(params["DialCallStatus"]);
  const rawStatus = params["DialCallStatus"] ?? params["CallStatus"] ?? params["RecordingStatus"] ?? "";

  const canonicalSid = getCanonicalCallSid(params);
  const lookupSids = [
    canonicalSid,
    params["CallSid"] ?? "",
    params["ParentCallSid"] ?? "",
    params["DialCallSid"] ?? "",
    params["RecordingCallSid"] ?? "",
  ].filter((value): value is string => Boolean(value));

  const from = params["From"] ?? params["Caller"] ?? "";
  const to = params["To"] ?? params["Called"] ?? "";
  const customerPhone = flow === "outbound"
    ? (extractE164FromSip(to) ?? (isValidE164(to) ? to : null))
    : (from || null);
  const customerId = await findCustomerIdByPhone(customerPhone);

  const queryAgentId = parseOptionalNumber(req.nextUrl.searchParams.get("agentId"));
  const candidateAgentIdentity =
    flow === "outbound"
      ? from
      : to.startsWith("client:") || to.startsWith("sip:")
        ? to
        : extractClientIdentity(params["AnsweredBy"] ?? "")
          ? `client:${params["AnsweredBy"]}`
          : null;
  const agentId = queryAgentId ?? await findAgentIdByIdentity(candidateAgentIdentity);

  const duration = parseOptionalNumber(params["DialCallDuration"] ?? params["CallDuration"] ?? null);
  const recordingUrl = params["RecordingUrl"]
    ? (params["RecordingUrl"].endsWith(".mp3") ? params["RecordingUrl"] : `${params["RecordingUrl"]}.mp3`)
    : undefined;

  const metadata = {
    source: source ?? null,
    flow,
    leg: leg ?? null,
    status: rawStatus || null,
    from: from || null,
    to: to || null,
    callSid: params["CallSid"] || null,
    parentCallSid: params["ParentCallSid"] || null,
    dialCallSid: params["DialCallSid"] || null,
    recordingCallSid: params["RecordingCallSid"] || null,
    recordingSid: params["RecordingSid"] || null,
    recordingStatus: params["RecordingStatus"] || null,
    answeredBy: params["AnsweredBy"] || null,
    twilioDirection: params["Direction"] || null,
  };

  if (recordingUrl) {
    await upsertCallInteraction({
      lookupSids,
      twilioCallSid: canonicalSid,
      customerId: customerId ?? undefined,
      agentId: agentId ?? undefined,
      direction: flow,
      callDurationSeconds: duration ?? undefined,
      recordingUrl,
      metadata,
    });
    return xmlResponse();
  }

  const isCanceledSiblingLeg = flow === "inbound" && (leg === "browser" || leg === "sip") && rawStatus === "canceled";
  const outcome = isCanceledSiblingLeg ? undefined : buildOutcome(flow, rawStatus, isAction);
  const note = isCanceledSiblingLeg ? undefined : buildNote(flow, rawStatus, from, to, leg, isAction);

  await upsertCallInteraction({
    lookupSids,
    twilioCallSid: canonicalSid,
    customerId: customerId ?? undefined,
    agentId: agentId ?? undefined,
    outcome,
    note,
    direction: flow,
    callDurationSeconds: duration ?? undefined,
    metadata,
  });

  if (
    flow === "inbound" &&
    isAction &&
    ["busy", "no-answer", "failed", "canceled"].includes(rawStatus)
  ) {
    return buildVoicemailResponse(baseUrl);
  }

  return xmlResponse();
}