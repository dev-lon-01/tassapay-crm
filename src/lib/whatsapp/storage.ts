import fs from "fs";
import path from "path";
import { getWhatsAppConfig } from "./config";

const MAX_BYTES = 25 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
};

const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXT).map(([k, v]) => [v, k])
);

function safeWamidComponent(wamid: string): string {
  // Allow letters, digits, dot, dash, colon, equals, underscore. Strip the rest.
  return wamid.replace(/[^A-Za-z0-9._:=-]/g, "_");
}

function extFor(mime: string): string {
  return MIME_EXT[mime.toLowerCase()] ?? "bin";
}

export interface SavedMedia {
  relativePath: string;
  servedUrl: string;
}

export function saveMedia(wamid: string, buffer: Buffer, mimeType: string): SavedMedia {
  if (buffer.length > MAX_BYTES) {
    throw new Error(`media too large: ${buffer.length} bytes`);
  }
  const cfg = getWhatsAppConfig();
  const safe = safeWamidComponent(wamid);
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dir = path.join(cfg.mediaDir, yyyy, mm);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${safe}.${extFor(mimeType)}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return {
    relativePath: path.join(yyyy, mm, filename),
    servedUrl: `/api/whatsapp/media/${encodeURIComponent(wamid)}`,
  };
}

export interface FoundMedia {
  fullPath: string;
  mimeType: string;
}

export function findMediaByWamid(wamid: string): FoundMedia | null {
  const cfg = getWhatsAppConfig();
  const safe = safeWamidComponent(wamid);
  if (!fs.existsSync(cfg.mediaDir)) return null;

  function walk(dir: string): string | null {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = walk(p);
        if (found) return found;
      } else if (entry.name.startsWith(`${safe}.`)) {
        return p;
      }
    }
    return null;
  }

  const fullPath = walk(cfg.mediaDir);
  if (!fullPath) return null;
  const ext = path.extname(fullPath).slice(1).toLowerCase();
  return { fullPath, mimeType: EXT_MIME[ext] ?? "application/octet-stream" };
}
