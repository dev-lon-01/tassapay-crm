function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const VOICE_TOKEN_TTL_SECONDS = parsePositiveInt(
  process.env.VOICE_TOKEN_TTL_SECONDS,
  60 * 60 * 8
);

export const VOICE_AGENT_TTL_SECONDS = parsePositiveInt(
  process.env.VOICE_AGENT_TTL_SECONDS,
  45
);

export const VOICE_HEARTBEAT_INTERVAL_SECONDS = parsePositiveInt(
  process.env.VOICE_HEARTBEAT_INTERVAL_SECONDS,
  20
);

