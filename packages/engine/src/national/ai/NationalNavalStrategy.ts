/**
 * NATIONAL AI naval decision boundary. This module cannot access Game, Player,
 * terrain, enemy destinations, unit registries, or any non-observed vessel.
 * The caller supplies only its OWN current ports, not foreign positions.
 */
import { deriveNationalWarSides } from "./NationalPlanner";
import type { NationalObservation } from "../observation/NationalObservation";

export interface OwnNavalPort {
  readonly x: number;
  readonly y: number;
}

export interface ObservedNavalTarget {
  readonly vesselId: string;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  /** Ranking heuristic only; never authority or a statement of water access. */
  readonly nearestOwnPortDistanceSquared: number;
}

/**
 * A currently sighted enemy merchant is evidence of actual commercial traffic,
 * not a guessed hidden port or a remembered/inferred route.
 *
 * Return the 24 closest visible war-enemy merchants. The authoritative caller
 * must independently verify current WAR, player protections, water component,
 * affordability and actual construction/navigation at dispatch time.
 */
export function planObservedNationalNavalTargets(
  observation: NationalObservation,
  ownPorts: readonly OwnNavalPort[],
): readonly ObservedNavalTarget[] {
  if (ownPorts.length === 0) return [];
  const sides = deriveNationalWarSides(
    observation.wars,
    observation.observerId,
  );
  if (sides.enemies.size === 0) return [];
  const ports = ownPorts.slice(0, 32);
  const targets: ObservedNavalTarget[] = [];
  for (const asset of observation.visibleAssets) {
    if (
      asset.kind !== "trade-ship" ||
      !sides.enemies.has(asset.ownerId) ||
      sides.allies.has(asset.ownerId) ||
      asset.ownerId === observation.observerId ||
      !Number.isSafeInteger(asset.x) ||
      !Number.isSafeInteger(asset.y)
    ) continue;
    let nearest = Infinity;
    for (const port of ports) {
      const dx = asset.x - port.x;
      const dy = asset.y - port.y;
      nearest = Math.min(nearest, dx * dx + dy * dy);
    }
    if (!Number.isFinite(nearest)) continue;
    targets.push({
      vesselId: asset.id,
      ownerId: asset.ownerId,
      x: asset.x,
      y: asset.y,
      nearestOwnPortDistanceSquared: nearest,
    });
  }
  targets.sort(
    (a, b) =>
      a.nearestOwnPortDistanceSquared - b.nearestOwnPortDistanceSquared ||
      (a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0) ||
      (a.vesselId < b.vesselId ? -1 : a.vesselId > b.vesselId ? 1 : 0),
  );
  return targets.slice(0, 24);
}
