import { getWhatsAppConfig } from "./config";

export interface MediaMetadata {
  url: string;
  mime_type: string;
  file_size?: number;
  sha256?: string;
}

export async function getMediaMetadata(mediaId: string): Promise<MediaMetadata> {
  const cfg = getWhatsAppConfig();
  const res = await fetch(
    `https://graph.facebook.com/${cfg.graphVersion}/${encodeURIComponent(mediaId)}`,
    { headers: { Authorization: `Bearer ${cfg.accessToken}` } }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`getMediaMetadata ${mediaId}: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as MediaMetadata;
}

export async function downloadMedia(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cfg = getWhatsAppConfig();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.accessToken}` },
  });
  if (!res.ok) throw new Error(`downloadMedia: ${res.status}`);
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const ab = await res.arrayBuffer();
  return { buffer: Buffer.from(ab), mimeType };
}
