import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { requireAuth } from "@/src/lib/auth";
import { findMediaByWamid } from "@/src/lib/whatsapp/storage";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { wamid: string } }
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const wamid = decodeURIComponent(params.wamid);
  if (!/^[A-Za-z0-9._:=\-]+$/.test(wamid)) {
    return NextResponse.json({ error: "invalid wamid" }, { status: 400 });
  }

  const found = findMediaByWamid(wamid);
  if (!found) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const buf = fs.readFileSync(found.fullPath);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": found.mimeType,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
