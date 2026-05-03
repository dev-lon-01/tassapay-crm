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
  persistVoiceWebhookEvent,
  upsertCallInteraction,
  validateTwilioWebhook,
} from "@/src/lib/voiceCallState";
import { recordVoiceDiagnostic } from "@/src/lib/voiceDiagnostics";

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
    params.ParentCallSid ||
    params.CallSid ||
    params.RecordingCallSid ||
    params.DialCallSid ||
    null
  );
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
    if (isAction) return `Outbound to ${to} - ${status || "completed"}`;
    return `Outbound to ${to}${status ? ` - ${status}` : ""}`;
  }

  if (!from) return undefined;
  if (isAction) return `Inbound from ${from} - ${status || "completed"}`;
  if (leg === "browser" || leg === "sip") {
    return `Inbound from ${from} - ${leg} leg ${status || "updated"}`;
  }
  return `Inbound from ${from}${status ? ` - ${status}` : ""}`;
}

function buildVoicemailResponse(baseUrl: string, parentCallSid?: string | null) {
  const twiml = new VoiceResponse();
  twiml.say(
    { voice: "alice" },
    "Sorry we missed your call. Please leave a message after the tone and press hash when done."
  );
  const qs = parentCallSid
    ? `?source=recording&flow=inbound&leg=voicemail&parentCallSid=${encodeURIComponent(parentCallSid)}`
    : `?source=recording&flow=inbound&leg=voicemail`;
  twiml.record({
    maxLength: 120,
    finishOnKey: "#",
    recordingStatusCallback: `${baseUrl}/api/voice/call-completed${qs}`,
    recordingStatusCallbackMethod: "POST",
    transcribe: false,
  });
  twiml.say({ voice: "alice" }, "We did not receive a recording. Goodbye.");
  twiml.hangup();
  return xmlResponse(twiml.toString());
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const params = parseTwilioFormBody(rawBody);

    const signature = req.headers.get("x-twilio-signature") ?? "";
    const url = buildExpectedWebhookUrl(`${req.nextUrl.pathname}${req.nextUrl.search}`);
    if (!validateTwilioWebhook(signature, url, params)) {
      recordVoiceDiagnostic({
        source: "server",
        eventType: "call_completed_signature_failed",
        severity: "error",
        callSid: params.CallSid ?? null,
        message: "Twilio webhook signature validation failed",
        payload: {
          url,
          host: req.headers.get("host"),
          hasSignature: Boolean(signature),
        },
      });
      return new NextResponse("Forbidden", { status: 403 });
    }

    const baseUrl = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
    const source = req.nextUrl.searchParams.get("source") ?? "unknown";
    const flow = (req.nextUrl.searchParams.get("flow") === "outbound" ? "outbound" : "inbound") as
      | "inbound"
      | "outbound";
    const leg = req.nextUrl.searchParams.get("leg");
    const rawStatus = params.DialCallStatus ?? params.CallStatus ?? params.RecordingStatus ?? "";
    const isAction = source === "dial-action" || Boolean(params.DialCallStatus);
    const canonicalSid = getCanonicalCallSid(params);

    await persistVoiceWebhookEvent({
      source,
      canonicalSid,
      eventType: rawStatus ? `${source}:${rawStatus}` : source,
      payload: {
        query: Object.fromEntries(req.nextUrl.searchParams.entries()),
        params,
      },
    });

    const queryParentCallSid = req.nextUrl.searchParams.get("parentCallSid") ?? "";
    const lookupSids = [
      canonicalSid,
      params.CallSid ?? "",
      params.ParentCallSid ?? "",
      params.DialCallSid ?? "",
      params.RecordingCallSid ?? "",
      queryParentCallSid,
    ].filter((value): value is string => Boolean(value));

    // When parentCallSid is explicitly provided in the URL, prefer it as the
    // canonical SID so the upsert always targets the original parent record.
    const effectiveCallSid = queryParentCallSid || canonicalSid;

    const from = params.From ?? params.Caller ?? "";
    const to = params.To ?? params.Called ?? "";
    const customerPhone = flow === "outbound"
      ? (extractE164FromSip(to) ?? (isValidE164(to) ? to : null))
      : (from || null);
    const customerId = await findCustomerIdByPhone(customerPhone);

    const queryAgentId = parseOptionalNumber(req.nextUrl.searchParams.get("agentId"));
    const candidateAgentIdentity = flow === "outbound"
      ? from
      : to.startsWith("client:") || to.startsWith("sip:")
        ? to
        : extractClientIdentity(params.AnsweredBy ?? "")
          ? `client:${params.AnsweredBy}`
          : null;
    const agentId = queryAgentId ?? await findAgentIdByIdentity(candidateAgentIdentity);

    const duration = parseOptionalNumber(params.DialCallDuration ?? params.CallDuration ?? null);
    const recordingUrl = params.RecordingUrl
      ? (params.RecordingUrl.endsWith(".mp3") ? params.RecordingUrl : `${params.RecordingUrl}.mp3`)
      : undefined;

    const metadata = {
      source,
      flow,
      leg: leg ?? null,
      status: rawStatus || null,
      from: from || null,
      to: to || null,
      callSid: params.CallSid || null,
      parentCallSid: params.ParentCallSid || null,
      dialCallSid: params.DialCallSid || null,
      recordingCallSid: params.RecordingCallSid || null,
      recordingSid: params.RecordingSid || null,
      recordingStatus: params.RecordingStatus || null,
      answeredBy: params.AnsweredBy || null,
      twilioDirection: params.Direction || null,
    };

    if (recordingUrl) {
      await upsertCallInteraction({
        lookupSids,
        twilioCallSid: effectiveCallSid,
        customerId: customerId ?? undefined,
        agentId: agentId ?? undefined,
        direction: flow,
        callDurationSeconds: duration ?? undefined,
        recordingUrl,
        metadata,
      });
      return xmlResponse();
    }

    // ALL leg-status events should only merge metadata — not create visible notes
    // or overwrite final call status.  The dial-action callback provides the
    // authoritative final outcome for the call.
    const suppressNote = source === "leg-status";

    await upsertCallInteraction({
      lookupSids,
      twilioCallSid: effectiveCallSid,
      customerId: customerId ?? undefined,
      agentId: agentId ?? undefined,
      callStatus: suppressNote ? undefined : (rawStatus || undefined),
      note: suppressNote ? undefined : buildNote(flow, rawStatus, from, to, leg, isAction),
      direction: flow,
      callDurationSeconds: duration ?? undefined,
      metadata,
    });

    if (
      flow === "inbound" &&
      isAction &&
      ["busy", "no-answer", "failed", "canceled"].includes(rawStatus)
    ) {
      return buildVoicemailResponse(baseUrl, effectiveCallSid);
    }

    return xmlResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/voice/call-completed]", message);
    recordVoiceDiagnostic({
      source: "server",
      eventType: "call_completed_handler_error",
      severity: "error",
      message,
    });
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

