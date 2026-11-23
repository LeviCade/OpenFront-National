import type {
  NationalObservation,
  VisibleAsset,
} from "../observation/NationalObservation";
import { deriveNationalWarSides } from "./NationalPlanner";

/**
 * Pure, principal-scoped decision. No Game, Player, route registry or hidden
 * enemy lookup is available to this planner.
 */
export interface ObservedNavalEscort {
  readonly merchantId: string;
  readonly merchantOwnerId: string;
  readonly raiderId: string;
  readonly raiderOwnerId: string;
  readonly merchantX: number;
  readonly merchantY: number;
  readonly x: number;
  readonly y: number;
  readonly threatDistance: number;
}

const validPosition = (asset: VisibleAsset): boolean =>
  Number.isSafeInteger(asset.x) &&
  Number.isSafeInteger(asset.y) &&
  asset.x >= 0 &&
  asset.y >= 0;

/**
 * A friendly, currently visible merchant is in immediate danger from a
 * currently visible, actual WAR enemy warship. Never reconstruct routes from
 * ports or stale sightings. Own vessels are always visible; treaty vessels
 * must be actually observed AND authorized by the authoritative caller.
 *
 * Invalid or duplicated asset IDs fail closed rather than accidentally
 * associating an attacker with the wrong unit across a replay.
 */
export function planObservedNationalNavalEscorts(
  observation: NationalObservation,
): readonly ObservedNavalEscort[] {
  const sides = deriveNationalWarSides(
    observation.wars,
    observation.observerId,
  );
  if (sides.enemies.size === 0) return [];

  const allowedOwners = new Set([observation.observerId]);
  for (const coalition of observation.coalitions) {
    if (
      (coalition.kind === "empire" || coalition.kind === "mda") &&
      coalition.members.includes(observation.observerId)
    ) {
      for (const member of coalition.members) allowedOwners.add(member);
    }
  }
  const seen = new Set<string>();
  for (const asset of observation.visibleAssets) {
    if (seen.has(asset.id)) return [];
    seen.add(asset.id);
  }

  const merchants = observation.visibleAssets
    .filter(
      (a) =>
        a.kind === "trade-ship" &&
        allowedOwners.has(a.ownerId) &&
        (a.ownerId === observation.observerId
          ? a.source === "own"
          : a.source !== "own") &&
        validPosition(a),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 64);
  const raiders = observation.visibleAssets
    .filter(
      (a) =>
        a.kind === "warship" &&
        sides.enemies.has(a.ownerId) &&
        !sides.allies.has(a.ownerId) &&
        a.ownerId !== observation.observerId &&
        validPosition(a),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 64);

  const threats: ObservedNavalEscort[] = [];
  for (const merchant of merchants) {
    for (const raider of raiders) {
      const threatDistance =
        Math.abs(merchant.x - raider.x) + Math.abs(merchant.y - raider.y);
      if (threatDistance > 20) continue;
      threats.push({
        merchantId: merchant.id,
        merchantOwnerId: merchant.ownerId,
        raiderId: raider.id,
        raiderOwnerId: raider.ownerId,
        merchantX: merchant.x,
        merchantY: merchant.y,
        x: raider.x,
        y: raider.y,
        threatDistance,
      });
    }
  }
  threats.sort(
    (a, b) =>
      a.threatDistance - b.threatDistance ||
      (a.merchantId < b.merchantId
        ? -1
        : a.merchantId > b.merchantId
          ? 1
          : 0) ||
      (a.raiderId < b.raiderId ? -1 : a.raiderId > b.raiderId ? 1 : 0),
  );
  return threats.slice(0, 24);
}
