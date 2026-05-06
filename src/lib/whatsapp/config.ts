import path from "path";

export interface WhatsAppConfig {
  verifyToken: string;
  appSecret: string;
  accessToken: string;
  graphVersion: string;
  mediaDir: string;
  systemUserId: number;
}

let cached: WhatsAppConfig | null = null;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env var is required for WhatsApp integration`);
  return v;
}

export function getWhatsAppConfig(): WhatsAppConfig {
  if (cached) return cached;
  const systemUserIdRaw = process.env.SYSTEM_USER_ID ?? "";
  const systemUserId = parseInt(systemUserIdRaw, 10);
  cached = {
    verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
    appSecret: required("WHATSAPP_APP_SECRET"),
    accessToken: required("WHATSAPP_ACCESS_TOKEN"),
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0",
    mediaDir:
      process.env.WHATSAPP_MEDIA_DIR ?? path.join(process.cwd(), "media", "whatsapp"),
    systemUserId: Number.isInteger(systemUserId) && systemUserId > 0 ? systemUserId : 0,
  };
  return cached;
}
