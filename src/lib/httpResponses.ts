import { NextResponse } from "next/server";

export interface ErrorDetail {
  field?: string;
  message: string;
  index?: number;
}

export function jsonError(
  error: string,
  status: number,
  details?: ErrorDetail[] | Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    details ? { error, details } : { error },
    { status }
  );
}

export function xmlResponse(
  body = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  status = 200
): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

