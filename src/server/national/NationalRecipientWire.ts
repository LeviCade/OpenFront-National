/**
 * The ONLY NATIONAL projection serialized by GameServer.
 * Source MUST be the E3 NationalOutboundFilter's recipient-specific result,
 * never GameRunner's unfiltered fullPacket or the canonical Game.
 *
 * Strict top-level whitelist: no raw motion plans, attack buffers, hidden
 * observation caches, GameSnapshots, or other engine state can be forwarded
 * merely by adding a new field to GameUpdateViewData in the future.
 */
import {
  GameUpdateType,
  type GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { replacer } from "@openfront/shared/SharedUtil";

export const MAX_NATIONAL_PROJECTION_BYTES = 2_000_000;

export function encodeNationalRecipientProjection(
  filtered: GameUpdateViewData,
): string {
  if (!Number.isSafeInteger(filtered.tick) || filtered.tick < 0) {
    throw new Error("invalid NATIONAL recipient tick");
  }
  // These buckets are filtered by E3; ALL other buckets are intentionally
  // absent, including enemy attacks, embargoes and private diplomacy.
  const updates = filtered.updates;
  const politics = filtered as GameUpdateViewData & {
    nationalConflicts?: unknown;
  };
  const allowed = {
    tick: filtered.tick,
    updates: {
      [GameUpdateType.Player]: updates[GameUpdateType.Player] ?? [],
      [GameUpdateType.GamePaused]: updates[GameUpdateType.GamePaused] ?? [],
      [GameUpdateType.SpawnPhaseEnd]:
        updates[GameUpdateType.SpawnPhaseEnd] ?? [],
    },
    packedTileUpdates: Array.from(filtered.packedTileUpdates),
    ...(filtered.packedUnitUpdates === undefined
      ? {}
      : { packedUnitUpdates: Array.from(filtered.packedUnitUpdates) }),
    ...(filtered.packedMissileTimers === undefined
      ? {}
      : { packedMissileTimers: Array.from(filtered.packedMissileTimers) }),
    ...(filtered.packedPlayerUpdates === undefined
      ? {}
      : { packedPlayerUpdates: Array.from(filtered.packedPlayerUpdates) }),
    ...(filtered.playerNameViewData === undefined
      ? {}
      : { playerNameViewData: filtered.playerNameViewData }),
    ...(filtered.nationalPolitics === undefined
      ? {}
      : { nationalPolitics: filtered.nationalPolitics }),
    ...(filtered.nationalCommandResults === undefined
      ? {}
      : { nationalCommandResults: filtered.nationalCommandResults }),
    ...(filtered.nationalAccessionOffers === undefined
      ? {}
      : { nationalAccessionOffers: filtered.nationalAccessionOffers }),
    ...(politics.nationalConflicts === undefined
      ? {}
      : { nationalConflicts: politics.nationalConflicts }),
  };
  // Political and player DTOs may contain bigint currency fields; only
  // inside this E3-filtered whitelist do we normalize them to JSON strings.
  const json = JSON.stringify(allowed, replacer);
  if (json.length > MAX_NATIONAL_PROJECTION_BYTES) {
    throw new Error("NATIONAL recipient packet exceeds bounded wire limit");
  }
  return json;
}
