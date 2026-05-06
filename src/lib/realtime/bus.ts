import { EventEmitter } from "events";

const CHANNEL = "realtime:event";

const globalAny = globalThis as unknown as { __tp_realtime_bus?: EventEmitter };

function getEmitter(): EventEmitter {
  if (!globalAny.__tp_realtime_bus) {
    const e = new EventEmitter();
    e.setMaxListeners(0);
    globalAny.__tp_realtime_bus = e;
  }
  return globalAny.__tp_realtime_bus;
}

export interface RealtimeEnvelope {
  event: string;
  data: unknown;
  ts: string;
}

export function publish(event: string, data: unknown): void {
  const env: RealtimeEnvelope = { event, data, ts: new Date().toISOString() };
  getEmitter().emit(CHANNEL, env);
}

export function subscribe(handler: (env: RealtimeEnvelope) => void): () => void {
  const emitter = getEmitter();
  emitter.on(CHANNEL, handler);
  return () => emitter.off(CHANNEL, handler);
}
