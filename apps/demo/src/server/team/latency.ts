const serverCacheReadDelayMs = readMilliseconds(
  process.env.TEAM_API_SERVER_CACHE_READ_DELAY_MS,
  40,
);

/**
 * Keep a small, visible cold-cache delay without carrying the deliberately slow
 * client-demo latency into a server cache fill.
 */
export function capServerCacheReadDelay(
  milliseconds: number,
  cacheReadHeader: string | undefined,
) {
  return isEnabled(cacheReadHeader)
    ? Math.min(milliseconds, serverCacheReadDelayMs)
    : milliseconds;
}

export async function delay(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function readMilliseconds(
  value: string | undefined,
  fallback: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isEnabled(value: string | undefined) {
  return value === "1" || value === "true";
}
