/**
 * The shared API contract for the demo.
 *
 * This barrel is type-only: it re-exports the domain types and the Hono
 * `AppType` used to type the RPC client. Because every re-export is a `type`,
 * importing this module from a client component pulls in no server runtime
 * (no libSQL, no `node:*`), even though `AppType` is derived from the server
 * app.
 */
export type * from "./team/schema";
export type { AppType } from "./team/app";
