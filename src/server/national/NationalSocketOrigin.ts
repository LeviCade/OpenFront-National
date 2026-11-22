/**
 * A NATIONAL player's browser must originate on this deployment's own page
 * or game host, or the fixed desktop app origin. The Origin header is not a
 * substitute for JWT/account validation: non-browser clients can forge it.
 * The TLS reverse proxy must additionally restrict direct backend access.
 */
import { GameEnv } from "@openfront/shared/configuration/Env";
import type WebSocket from "ws";
import { DESKTOP_APP_ORIGIN } from "../GameApiCors";
import { ServerEnv } from "../ServerEnv";

export const LOCAL_NATIONAL_ORIGINS = [
  "http://localhost:9000",
  "http://localhost:3000",
] as const;

/** Exact string comparison: never trust arbitrary sibling subdomains,
 * comma-separated proxies, wildcard DNS suffixes or opaque origins. */
export function matchesNationalSocketOrigin(
  origin: string | undefined,
  allowed: readonly string[],
): boolean {
  return (
    typeof origin === "string" &&
    origin.length > 0 &&
    origin.length <= 512 &&
    origin !== "null" &&
    origin.trim() === origin &&
    !origin.includes(",") &&
    allowed.includes(origin)
  );
}

export function nationalHostedSocketOrigins(
  siteHost: string | undefined,
  gameHost: string | undefined,
  pageHost: string | undefined,
): string[] {
  return [
    DESKTOP_APP_ORIGIN,
    ...[siteHost, gameHost, pageHost]
      .filter((host): host is string => !!host)
      .map((host) => `https://${host}`),
  ];
}

/** No browser-supplied Host, forwarded proto, accountId or URL parameter
 * participates in the allowlist. In Dev, the isolated localhost operator
 * harness uses two known origins, and no external host is admitted.
 */
export function isAllowedNationalSocketOrigin(
  origin: string | undefined,
): boolean {
  if (ServerEnv.env() === GameEnv.Dev) {
    return matchesNationalSocketOrigin(origin, LOCAL_NATIONAL_ORIGINS);
  }
  const gameHost = ServerEnv.publicHost();
  return matchesNationalSocketOrigin(
    origin,
    nationalHostedSocketOrigins(
      ServerEnv.siteHost(),
      gameHost,
      gameHost ? ServerEnv.pageHostFor(gameHost) : undefined,
    ),
  );
}

/** Provenance belongs to one PHYSICAL socket; never reuse a Client's past approval after reconnect. */
const eligibleNationalSockets = new WeakSet<WebSocket>();

export function registerNationalSocketOrigin(
  socket: WebSocket,
  origin: string | undefined,
): void {
  if (isAllowedNationalSocketOrigin(origin)) eligibleNationalSockets.add(socket);
}

export function hasTrustedNationalSocketOrigin(socket: WebSocket): boolean {
  return eligibleNationalSockets.has(socket);
}
