/**
 * Event bridge for the authenticated, server-owned NATIONAL projection wire.
 * This is NOT a client GameRunner. E4 can consume these snapshots into a
 * read-only view without importing the authoritative engine into the browser.
 */
import type { GameEvent } from "@openfront/shared/EventBus";
import type { ServerNationalStartMessage } from "@openfront/shared/WireSchemas";

const allowedFields = new Set([
  "tick",
  "updates",
  "packedTileUpdates",
  "packedUnitUpdates",
  "packedMissileTimers",
  "packedPlayerUpdates",
  "playerNameViewData",
  "nationalPolitics",
  "nationalConflicts",
  "nationalCommandResults",
  "nationalAccessionOffers",
]);

export interface TrustedNationalProjection {
  readonly tick: number;
  readonly [key: string]: unknown;
}

export function parseTrustedNationalProjection(
  payload: string,
  expectedTick: number,
): TrustedNationalProjection {
  if (payload.length > 2_000_000)
    throw new Error("NATIONAL oversized projection");
  const parsed: unknown = JSON.parse(payload);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as { tick?: unknown }).tick !== expectedTick ||
    !Object.keys(parsed).every((key) => allowedFields.has(key)) ||
    !Array.isArray(
      (parsed as { packedTileUpdates?: unknown }).packedTileUpdates,
    )
  )
    throw new Error("NATIONAL invalid recipient projection");
  return parsed as TrustedNationalProjection;
}

export class TrustedNationalStartedEvent implements GameEvent {
  constructor(public readonly start: ServerNationalStartMessage) {}
}

export class TrustedNationalProjectionEvent implements GameEvent {
  constructor(public readonly projection: TrustedNationalProjection) {}
}
