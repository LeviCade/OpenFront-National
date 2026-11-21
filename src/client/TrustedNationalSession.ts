/**
 * Reader for E3's authenticated per-recipient NATIONAL view ONLY.
 * This module never runs a GameRunner, simulates turns or loads private state.
 */
import {
  GameUpdateType,
  type GameUpdateViewData,
  type GameUpdates,
} from "@openfront/engine-api/game/GameUpdates";
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
const permittedUpdates = new Set<number>([
  GameUpdateType.Player,
  GameUpdateType.GamePaused,
  GameUpdateType.SpawnPhaseEnd,
]);

export interface TrustedNationalProjection {
  readonly tick: number;
  readonly [key: string]: unknown;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numericArray(
  value: unknown,
  maxItems: number,
  unsigned = false,
): number[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    !value.every(
      (v) =>
        typeof v === "number" &&
        Number.isFinite(v) &&
        (!unsigned || (Number.isSafeInteger(v) && v >= 0 && v <= 0xffffffff)),
    )
  ) {
    throw new Error("NATIONAL invalid projected numeric lanes");
  }
  return value as number[];
}

export function parseTrustedNationalProjection(
  payload: string,
  expectedTick: number,
): TrustedNationalProjection {
  if (payload.length > 2_000_000) throw new Error("NATIONAL oversized projection");
  const parsed: unknown = JSON.parse(payload);
  if (
    !record(parsed) ||
    !Number.isSafeInteger(expectedTick) ||
    expectedTick < 0 ||
    parsed.tick !== expectedTick ||
    !Object.keys(parsed).every((key) => allowedFields.has(key)) ||
    !Array.isArray(parsed.packedTileUpdates) ||
    !record(parsed.updates) ||
    !Object.entries(parsed.updates).every(
      ([key, entries]) => permittedUpdates.has(Number(key)) && Array.isArray(entries),
    )
  ) {
    throw new Error("NATIONAL invalid recipient projection");
  }
  return parsed as TrustedNationalProjection;
}

/**
 * Materialize numeric lanes and empty enum buckets required by the existing
 * GameView/WebGL renderer. Empty buckets represent NO E3-delivered update;
 * they never recreate unseen opponent data or local simulation.
 *
 * Reject mismatched ticks, backward/replayed projections and invalid lanes.
 */
export function materializeTrustedNationalUpdate(
  packet: TrustedNationalProjection,
  previousTick: number,
): GameUpdateViewData {
  if (
    !Number.isSafeInteger(packet.tick) ||
    packet.tick < 0 ||
    packet.tick <= previousTick ||
    !record(packet.updates)
  ) {
    throw new Error("NATIONAL stale or malformed projected tick");
  }
  const safeUpdates = Array.from(
    { length: GameUpdateType.DonateEvent + 1 },
    () => [],
  ) as GameUpdates;
  for (const [key, entries] of Object.entries(packet.updates)) {
    const index = Number(key);
    if (!permittedUpdates.has(index) || !Array.isArray(entries)) {
      throw new Error("NATIONAL unauthorized engine update bucket");
    }
    safeUpdates[index] = entries as GameUpdates[typeof index];
  }

  const tiles = numericArray(packet.packedTileUpdates, 1_048_576, true);
  if (tiles === undefined || tiles.length % 2 !== 0)
    throw new Error("NATIONAL invalid projected tile pairs");
  const units = numericArray(packet.packedUnitUpdates, 210_000);
  if (units !== undefined && units.length % 21 !== 0)
    throw new Error("NATIONAL invalid projected unit stride");
  const players = numericArray(packet.packedPlayerUpdates, 25_000);
  if (players !== undefined && players.length % 5 !== 0)
    throw new Error("NATIONAL invalid projected player stride");
  const missiles = numericArray(packet.packedMissileTimers, 80_000, true);

  return {
    tick: packet.tick,
    updates: safeUpdates,
    packedTileUpdates: Uint32Array.from(tiles),
    ...(units === undefined ? {} : { packedUnitUpdates: Float64Array.from(units) }),
    ...(players === undefined
      ? {}
      : { packedPlayerUpdates: Float64Array.from(players) }),
    ...(missiles === undefined
      ? {}
      : { packedMissileTimers: Uint32Array.from(missiles) }),
    ...(packet.playerNameViewData === undefined
      ? {}
      : { playerNameViewData: packet.playerNameViewData }),
    ...(packet.nationalPolitics === undefined
      ? {}
      : { nationalPolitics: packet.nationalPolitics }),
    ...(packet.nationalConflicts === undefined
      ? {}
      : { nationalConflicts: packet.nationalConflicts }),
    ...(packet.nationalCommandResults === undefined
      ? {}
      : { nationalCommandResults: packet.nationalCommandResults }),
    ...(packet.nationalAccessionOffers === undefined
      ? {}
      : { nationalAccessionOffers: packet.nationalAccessionOffers }),
  } as GameUpdateViewData;
}

export class TrustedNationalStartedEvent implements GameEvent {
  constructor(public readonly start: ServerNationalStartMessage) {}
}

export class TrustedNationalProjectionEvent implements GameEvent {
  constructor(public readonly projection: TrustedNationalProjection) {}
}
