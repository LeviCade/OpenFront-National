import { UnitType } from "@openfront/engine-api/game/GameTypes";
import type { Game, Player, Unit } from "../../game/Game";

/** The actual controlling nation's authority, never its empire's inferred hostility. */
export function mayAttackAtSea(game: Game, attacker: Player, target: Player): boolean {
  const war = game.nationalWarAuthority();
  if (war === null) return attacker.canAttackPlayer(target, true);
  return (
    attacker.isAlive() &&
    target.isAlive() &&
    attacker.hasSpawned() &&
    target.hasSpawned() &&
    war.authorizeOffensiveAction(attacker.id(), target.id())
  );
}

/** D-015 / OPEN 5: provisional bounded port approach, scaled to existing patrol range. */
export function blockadeRadius(game: Game): number {
  return Math.max(1, Math.floor(game.config().warshipPatrolRange() / 4));
}

/**
 * Read live positions, ownership, health and WAR on each interception. No
 * cached embargo, global port flag or remote economic damage. Only neutral
 * merchants are turned here: hostile merchants use ordinary piracy execution.
 */
export function neutralBlockader(game: Game, merchant: Unit, destination: Unit): Unit | undefined {
  if (
    game.nationalWarAuthority() === null ||
    !merchant.isActive() ||
    !destination.isActive() ||
    destination.isMarkedForDeletion() ||
    destination.isUnderConstruction() ||
    !game.isWater(merchant.tile())
  ) return undefined;
  const component = game.getWaterComponent(merchant.tile());
  if (component === null || !game.hasWaterComponent(destination.tile(), component)) {
    return undefined;
  }
  const radius = blockadeRadius(game);
  const candidates = game.nearbyUnits(merchant.tile(), radius, UnitType.Warship);
  let selected: Unit | undefined;
  for (const { unit } of candidates) {
    if (
      !unit.isActive() ||
      unit.isMarkedForDeletion() ||
      unit.isUnderConstruction() ||
      unit.health() <= 0 ||
      unit.warshipState().state !== "patrolling" ||
      unit.owner() === merchant.owner() ||
      !game.isWater(unit.tile()) ||
      game.getWaterComponent(unit.tile()) !== component ||
      game.euclideanDistSquared(unit.tile(), merchant.tile()) > radius ** 2 ||
      game.euclideanDistSquared(unit.tile(), destination.tile()) > radius ** 2 ||
      !mayAttackAtSea(game, unit.owner(), destination.owner()) ||
      game.nationalWarAuthority()!.atWar(unit.owner().id(), merchant.owner().id())
    ) continue;
    // Stable even when spatial-grid enumeration order differs after restore.
    if (selected === undefined || unit.id() < selected.id()) selected = unit;
  }
  return selected;
}

/** Nearest eligible home port, deterministic tie break and bounded failed-route exclusion. */
export function nearestReturnPort(game: Game, merchant: Unit, failed: readonly number[]): Unit | undefined {
  const tile = merchant.tile();
  const component = game.getWaterComponent(tile);
  return merchant.owner().units(UnitType.Port)
    .filter((port) =>
      port.owner() === merchant.owner() &&
      port.isActive() &&
      !port.isMarkedForDeletion() &&
      !port.isUnderConstruction() &&
      !failed.includes(port.id()) &&
      (port.tile() === tile || (component !== null && game.hasWaterComponent(port.tile(), component))),
    )
    .sort((a, b) =>
      game.manhattanDist(tile, a.tile()) - game.manhattanDist(tile, b.tile()) ||
      a.id() - b.id(),
    )[0];
}
