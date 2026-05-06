import { NextRequest, NextResponse } from "next/server";
import { verifyWhatsAppSignature } from "@/src/lib/whatsapp/signature";
import { getWhatsAppConfig } from "@/src/lib/whatsapp/config";
import { processIncomingMessage } from "@/src/lib/whatsapp/ingest";
import type { WhatsAppWebhookPayload } from "@/src/lib/whatsapp/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let cfg;
  try {
    cfg = getWhatsAppConfig();
  } catch (err) {
    console.error("[whatsapp webhook GET] config", err);
    return new NextResponse("Configuration error", { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === cfg.verifyToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  let cfg;
  try {
    cfg = getWhatsAppConfig();
  } catch (err) {
    console.error("[whatsapp webhook POST] config", err);
    return new NextResponse("Configuration error", { status: 500 });
  }

  const rawBody = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  if (!verifyWhatsAppSignature(rawBody, sig, cfg.appSecret)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  // Acknowledge fast; process asynchronously so Meta doesn't retry on slow handlers.
  void processPayload(payload).catch((err) => {
    console.error("[whatsapp webhook] async processing failed", err);
  });

  return NextResponse.json({ ok: true });
}

async function processPayload(payload: WhatsAppWebhookPayload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      for (const msg of value.messages ?? []) {
        try {
          await processIncomingMessage(msg, value);
        } catch (err) {
          console.error("[whatsapp ingest]", msg?.id, err);
        }
      }
    }
  }
}
