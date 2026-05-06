export const REALTIME_EVENTS = {
  WHATSAPP_MESSAGE: "whatsapp.message",
  WHATSAPP_UNLINKED: "whatsapp.unlinked",
} as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];
