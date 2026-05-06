export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  field: string;
  value: WhatsAppValue;
}

export interface WhatsAppValue {
  messaging_product: string;
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: WhatsAppMessage[];
  statuses?: unknown[];
}

export interface WhatsAppMedia {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
}

export interface WhatsAppMessage {
  from: string; // E.164 without leading +
  id: string; // WAMID
  timestamp: string; // unix epoch (string)
  type: string;
  text?: { body: string };
  image?: WhatsAppMedia;
  document?: WhatsAppMedia & { filename?: string };
  audio?: WhatsAppMedia;
  video?: WhatsAppMedia;
  sticker?: WhatsAppMedia;
}
