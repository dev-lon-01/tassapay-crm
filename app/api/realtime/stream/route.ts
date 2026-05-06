import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { subscribe, type RealtimeEnvelope } from "@/src/lib/realtime/bus";

export const dynamic = "force-dynamic";

interface SseClaims {
  id: number;
  sse?: boolean;
  aud?: string;
}

export async function GET(req: NextRequest) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return new NextResponse("JWT_SECRET not set", { status: 500 });
  }

  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return new NextResponse("Missing token", { status: 401 });
  }

  let claims: SseClaims;
  try {
    claims = jwt.verify(token, secret, { audience: "sse" }) as SseClaims;
  } catch {
    return new NextResponse("Invalid token", { status: 401 });
  }
  if (!claims.sse || !claims.id) {
    return new NextResponse("Invalid token", { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeWrite = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          /* stream closed */
        }
      };

      safeWrite(`: connected ${new Date().toISOString()}\n\n`);

      unsubscribe = subscribe((env: RealtimeEnvelope) => {
        const payload =
          `event: ${env.event}\n` +
          `data: ${JSON.stringify({ ...env, _audience: "all" })}\n\n`;
        safeWrite(payload);
      });

      heartbeat = setInterval(() => safeWrite(`: ping\n\n`), 25_000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
