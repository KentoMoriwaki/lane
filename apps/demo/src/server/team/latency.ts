const browserTransportDelayMs = readMilliseconds(
  process.env.TEAM_API_BROWSER_TRANSPORT_DELAY_MS,
  80,
);

const colocatedServerTransportDelayMs = readMilliseconds(
  process.env.TEAM_API_SERVER_TRANSPORT_DELAY_MS,
  5,
);

/** Transport varies by caller location; endpoint source work does not. */
export function requestTransportDelay(
  colocatedServerHeader: string | undefined,
) {
  return isEnabled(colocatedServerHeader)
    ? colocatedServerTransportDelayMs
    : browserTransportDelayMs;
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
