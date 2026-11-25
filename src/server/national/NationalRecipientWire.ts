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
import { validateNationalAssessmentPacket } from "@openfront/engine-api/game/NationalAssessmentView";
import { validateNationalImperialPacket } from "@openfront/engine-api/game/NationalImperialView";
import { validateNationalPactPacket } from "@openfront/engine-api/game/NationalPactView";
import { validateNationalSettlementPacket } from "@openfront/engine-api/game/NationalSettlementView";
import {
  NATIONAL_OBSERVER_MAX_TILES,
  NATIONAL_OBSERVER_MAX_UNITS,
  NATIONAL_OBSERVER_MAP_VERSION,
  validNationalObserverPageProgress,
  type NationalObserverMapV1,
  type NationalPublicConflictView,
} from "@openfront/engine-api/game/NationalRecipientView";
import { validateNationalObserverNativeLanes } from "@openfront/shared/NationalObserverNativeWire";
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
    nationalConflicts?: NationalPublicConflictView;
    nationalObserverMap?: NationalObserverMapV1;
  };
  const map = politics.nationalObserverMap;
  const conflicts = politics.nationalConflicts;
  validateNationalSettlementPacket(
    filtered.nationalSettlements,
    map?.observerId ?? null,
    filtered.tick,
    map?.streamId,
  );
  validateNationalAssessmentPacket(
    filtered.nationalAssessments,
    map?.observerId ?? null,
    filtered.tick,
  );
  validateNationalImperialPacket(
    filtered.nationalImperialAdministration,
    filtered.nationalPolitics,
    map?.observerId ?? null,
    filtered.tick,
    map?.streamId,
  );
  validateNationalPactPacket(
    filtered.nationalPolitics,
    filtered.nationalPactDisclosure,
    map?.observerId ?? null,
    filtered.tick,
    map?.streamId,
  );
  if (map !== undefined) {
    if (
      map.version !== NATIONAL_OBSERVER_MAP_VERSION ||
      map.tick !== filtered.tick ||
      !Number.isSafeInteger(map.width) ||
      map.width <= 0 ||
      !Number.isSafeInteger(map.height) ||
      map.height <= 0 ||
      typeof map.streamId !== "string" ||
      map.streamId.length < 1 ||
      map.streamId.length > 128 ||
      !Number.isSafeInteger(map.sweepId) ||
      map.sweepId < 1 ||
      !Number.isSafeInteger(map.sweepTick) ||
      map.sweepTick < 0 ||
      map.sweepTick > filtered.tick ||
      typeof map.reset !== "boolean" ||
      !Number.isSafeInteger(map.cursor) ||
      map.cursor < 0 ||
      !validNationalObserverPageProgress(map) ||
      !Array.isArray(map.tileRemovedRefs) ||
      map.tileRemovedRefs.length > NATIONAL_OBSERVER_MAX_TILES ||
      (map.reset && map.tileRemovedRefs.length !== 0) ||
      map.tileRemovedRefs.some(
        (ref, i) =>
          !Number.isSafeInteger(ref) ||
          ref < 0 ||
          ref >= map.width * map.height ||
          (i > 0 && ref <= map.tileRemovedRefs[i - 1]),
      ) ||
      !Number.isSafeInteger(map.unitCursor) ||
      map.unitCursor < 0 ||
      !Number.isSafeInteger(map.unitSweepId) ||
      map.unitSweepId < 1 ||
      typeof map.unitReset !== "boolean" ||
      typeof map.unitOverflow !== "boolean" ||
      !Array.isArray(map.unitRemovedIds) ||
      map.unitRemovedIds.length > NATIONAL_OBSERVER_MAX_UNITS ||
      map.unitRemovedIds.some(
        (id) => !Number.isSafeInteger(id) || id < 0 || id > 0xffffffff,
      ) ||
      (map.nextCursor !== null &&
        (!Number.isSafeInteger(map.nextCursor) ||
          map.nextCursor < map.cursor)) ||
      map.tiles.length > NATIONAL_OBSERVER_MAX_TILES ||
      map.units.length > NATIONAL_OBSERVER_MAX_UNITS ||
      (map.unitNextCursor !== null &&
        (!Number.isSafeInteger(map.unitNextCursor) ||
          map.unitNextCursor <= map.unitCursor)) ||
      (map.unitReset && map.unitRemovedIds.length !== 0) ||
      map.units.some(
        (unit) => unit.ownerId !== map.observerId && unit.troops !== undefined,
      ) ||
      (filtered.nationalAccessionOffers !== undefined &&
        filtered.nationalAccessionOffers.recipientId !== map.observerId) ||
      (filtered.nationalCommandResults ?? []).some(
        (result) =>
          result.actorId !== map.observerId ||
          result.recipientId !== map.observerId,
      )
    )
      throw new Error("NATIONAL invalid bounded observer-map v1");
    validateNationalObserverNativeLanes(filtered, map);
  }
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
    ...(filtered.nationalImperialAdministration === undefined
      ? {}
      : {
          nationalImperialAdministration:
            filtered.nationalImperialAdministration,
        }),
    ...(filtered.nationalPactDisclosure === undefined
      ? {}
      : { nationalPactDisclosure: filtered.nationalPactDisclosure }),
    ...(filtered.nationalAccessionOffers === undefined
      ? {}
      : { nationalAccessionOffers: filtered.nationalAccessionOffers }),
    ...(filtered.nationalSettlements === undefined
      ? {}
      : { nationalSettlements: filtered.nationalSettlements }),
    ...(filtered.nationalAssessments === undefined
      ? {}
      : {
          nationalAssessments: {
            version: 1 as const,
            recipientId: filtered.nationalAssessments.recipientId,
            items: filtered.nationalAssessments.items.map((r) => ({
              targetId: r.targetId,
              paidBy: r.paidBy,
              confidence: r.confidence,
              effectiveTick: r.effectiveTick,
              expiresAtTick: r.expiresAtTick,
              treasuryGoldBand: { ...r.treasuryGoldBand },
              militaryTroopsBand: { ...r.militaryTroopsBand },
            })),
          },
        }),
    ...(conflicts === undefined
      ? {}
      : {
          nationalConflicts: {
            version: 1 as const,
            recipientId: conflicts.recipientId,
            layers: conflicts.layers.map((layer) => ({
              id: layer.id,
              scope: layer.scope,
              first: { kind: layer.first.kind, id: layer.first.id },
              second: { kind: layer.second.kind, id: layer.second.id },
              declaredBy: layer.declaredBy,
              startedTick: layer.startedTick,
              endedTick: layer.endedTick,
            })),
            motions: conflicts.motions.map((motion) => ({
              id: motion.id,
              layerId: motion.layerId,
              proposedBy: motion.proposedBy,
              proposingSide: motion.proposingSide,
              proposedTick: motion.proposedTick,
              acceptedTick: motion.acceptedTick,
              acceptedBy: motion.acceptedBy,
            })),
          },
        }),
    ...(map === undefined
      ? {}
      : {
          nationalObserverMap: {
            version: NATIONAL_OBSERVER_MAP_VERSION,
            tick: map.tick,
            observerId: map.observerId,
            observerSmallId: map.observerSmallId,
            streamId: map.streamId,
            sweepId: map.sweepId,
            sweepTick: map.sweepTick,
            width: map.width,
            height: map.height,
            reset: map.reset,
            cursor: map.cursor,
            nextCursor: map.nextCursor,
            tilePageSlots: map.tilePageSlots,
            tileSweepSlots: map.tileSweepSlots,
            tileRemovedRefs: [...map.tileRemovedRefs],
            tilePartial: map.tilePartial,
            tiles: map.tiles.map(([tile, state, terrain, borderMask]) => [
              tile,
              state,
              terrain,
              borderMask,
            ]),
            units: map.units.map((unit) => ({
              id: unit.id,
              ownerId: unit.ownerId,
              nativeOwnerSmallId: unit.nativeOwnerSmallId,
              nativeType: unit.nativeType,
              kind: unit.kind,
              tile: unit.tile,
              ...(unit.troops === undefined ? {} : { troops: unit.troops }),
            })),
            unitCursor: map.unitCursor,
            unitNextCursor: map.unitNextCursor,
            unitSweepId: map.unitSweepId,
            unitPageSlots: map.unitPageSlots,
            unitSweepSlots: map.unitSweepSlots,
            unitPartial: map.unitPartial,
            unitReset: map.unitReset,
            unitRemovedIds: [...map.unitRemovedIds],
            unitsTruncated: map.unitsTruncated,
            unitOverflow: map.unitOverflow,
            visibleBorders: map.visibleBorders.map((frontier) => ({
              targetId: frontier.targetId,
              access: frontier.access,
            })),
            ownResources: {
              troops: map.ownResources.troops,
              treasury: map.ownResources.treasury,
            },
            countries: map.countries.map((country) => ({
              id: country.id,
              name: country.name,
              alive: country.alive,
              landPercent: country.landPercent,
              status: country.status,
            })),
          },
        }),
  };
  // Political and player DTOs may contain bigint currency fields; only
  // inside this E3-filtered whitelist do we normalize them to JSON strings.
  const json = JSON.stringify(allowed, replacer);
  if (
    new TextEncoder().encode(json).byteLength > MAX_NATIONAL_PROJECTION_BYTES
  ) {
    throw new Error("NATIONAL recipient packet exceeds bounded wire limit");
  }
  return json;
}
