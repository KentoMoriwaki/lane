import { COLOCATED_SERVER_REQUEST_HEADER } from "@/lib/team-api";

export type TeamApiRequestRecord = {
  method: string;
  origin: "browser" | "server";
  path: string;
  sequence: number;
};

const diagnosticsEnabled =
  process.env.TEAM_API_REQUEST_DIAGNOSTICS === "1" ||
  process.env.TEAM_API_REQUEST_DIAGNOSTICS === "true";

let sequence = 0;
let records: TeamApiRequestRecord[] = [];

/**
 * A deterministic E2E probe for the embedded API's actual source work.
 *
 * Browser network events cannot see requests issued by the co-located Next
 * server, so the production Playwright suite enables this in-memory log. The
 * endpoint exposing it is unavailable unless the explicit test env flag is set.
 */
export function recordTeamApiRequest(request: {
  header: (name: string) => string | undefined;
  method: string;
  url: string;
}) {
  if (!diagnosticsEnabled) {
    return;
  }

  const url = new URL(request.url);
  if (url.pathname === "/api/_diagnostics/requests") {
    return;
  }

  records.push({
    method: request.method,
    origin: request.header(COLOCATED_SERVER_REQUEST_HEADER)
      ? "server"
      : "browser",
    path: `${url.pathname}${url.search}`,
    sequence: ++sequence,
  });
}

export function readTeamApiRequestRecords(): TeamApiRequestRecord[] | null {
  return diagnosticsEnabled ? [...records] : null;
}

export function resetTeamApiRequestRecords(): boolean {
  if (!diagnosticsEnabled) {
    return false;
  }

  records = [];
  sequence = 0;
  return true;
}
