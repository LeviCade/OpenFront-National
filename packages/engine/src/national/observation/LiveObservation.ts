import type { TileRef } from "@openfront/engine-api/game/GameMap";
/**
 * NATIONAL live observation adapter. Authoritative engine references enter
 * only here; the planner and packet consumers receive copied whitelisted data.
 *
 * P4 is still OPEN. The sight radius is intentionally limited to territory
 * already owned plus one cardinal tile from a real border. This is a
 * conservative, verifiable subset, not an invented 100/200-tile policy.
 */
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import type { Game, Player } from "../../game/Game";
import {
  projectNationalObservation,
  type AssetKind,
  type NationalObservation,
  type NationalWorld,
  type SovereignStatus,
} from "./NationalObservation";

interface PoliticalReadFacade {
  empireOf(id: string): string | null;
  emperorOf(id: string): string | null;
  membersOf(id: string): readonly string[];
}

type GameWithReadFacade = Game & {
  nationalPoliticalAuthority?: () => PoliticalReadFacade | null;
};

/**
 * Structural read-only bridge to E1's Game-owned E2 WarLedger.
 * No local war registry, no client assertions and no synthetic hostility.
 * The bridge remains null until the canonical E1/E2 runtime is merged.
 */
export interface LiveWarAuthority {
  authorizeOffensiveAction(attackerId: string, targetId: string | null): boolean;
  snapshot(): {
    readonly wars: {
      readonly layers: readonly {
        readonly id: string;
        readonly scope: "national" | "imperial";
        readonly first: { readonly kind: "nation" | "empire"; readonly id: string };
        readonly second: { readonly kind: "nation" | "empire"; readonly id: string };
        readonly startedTick: number;
        readonly endedTick: number | null;
      }[];
    };
  };
}

type GameWithWarFacade = Game & {
  nationalWarAuthority?: () => LiveWarAuthority | null;
};

export function liveNationalWarAuthority(game: Game): LiveWarAuthority | null {
  const candidate = (game as GameWithWarFacade).nationalWarAuthority;
  return typeof candidate === "function" ? candidate.call(game) : null;
}

export interface LiveNationalObservation {
  readonly observation: NationalObservation;
  /** Tiles with trusted live ownership or adjacent-border sight. */
  readonly visibleTiles: ReadonlySet<TileRef>;
}

function getFacade(game: Game): PoliticalReadFacade | null {
  const candidate = (game as GameWithReadFacade).nationalPoliticalAuthority;
  return typeof candidate === "function" ? candidate.call(game) : null;
}

function kind(type: UnitType): AssetKind {
  switch (type) {
    case UnitType.Warship:
      return "warship";
    case UnitType.TransportShip:
      return "transport";
    case UnitType.TradeShip:
      return "trade-ship";
    case UnitType.City:
    case UnitType.Port:
    case UnitType.Factory:
    case UnitType.DefensePost:
    case UnitType.MissileSilo:
    case UnitType.SAMLauncher:
      return "structure";
    default:
      return "army";
  }
}

function activeEmpireMembers(
  authority: PoliticalReadFacade | null,
  observer: Player,
): { empire: string | null; members: readonly string[] } {
  const empire = authority?.empireOf(observer.id()) ?? null;
  if (empire === null) return { empire: null, members: [observer.id()] };
  const members = authority?.membersOf(empire) ?? [];
  // A missing/inconsistent read must fail closed. Do not infer access from
  // a client-provided, cached or historic membership list.
  if (!members.includes(observer.id())) {
    return { empire: null, members: [observer.id()] };
  }
  // Trust reciprocal, current membership for every contributor, not only
  // the observer. A stale/forged roster cannot grant another nation's sight.
  return {
    empire,
    members: [...new Set(members)]
      .filter((id) => authority?.empireOf(id) === empire)
      .sort(),
  };
}

/** Recomputes sight directly from the *current* game at a tick boundary. */
export function collectLiveNationalObservation(
  game: Game,
  observerId: string,
): LiveNationalObservation {
  if (!game.config().nationalMode()) {
    throw new Error("NATIONAL observation requested in a legacy game");
  }
  const observer = game.player(observerId);
  if (!observer.isPlayer()) throw new Error("Invalid observation principal");
  const authority = getFacade(game);
  const warAuthority = liveNationalWarAuthority(game);
  const { members } = activeEmpireMembers(authority, observer);
  const allowedPrincipals = new Set(members);
  const visibleTiles = new Set<TileRef>();
  // Record the ACTUAL sight contributor. Crediting a member's sight to the
  // requesting observer would make inherited sightings survive an empire split.
  const sightOrigin = new Map<TileRef, string>();
  const markVisible = (tile: TileRef, memberId: string): void => {
    visibleTiles.add(tile);
    if (!sightOrigin.has(tile)) sightOrigin.set(tile, memberId);
  };
  const frontierKeys = new Set<string>();
  const frontiers: NationalWorld["frontiers"][number][] = [];
  let unownedFrontier = false;

  // Do not enumerate globally owned tiles just to discover enemies. Every
  // seed is a current authenticated member's actual territory.
  // Own sight takes precedence when the same tile is visible to several
  // members. Thus a direct sighting remains valid after a membership split.
  const sightOrder = [
    observerId,
    ...[...allowedPrincipals].filter((id) => id !== observerId).sort(),
  ];
  for (const memberId of sightOrder) {
    if (!game.hasPlayer(memberId)) continue;
    const member = game.player(memberId);
    for (const tile of member.tiles()) markVisible(tile, memberId);
    for (const tile of member.borderTiles()) {
      markVisible(tile, memberId);
      game.forEachNeighbor(tile, (neighbor) => {
        markVisible(neighbor, memberId);
        const owner = game.owner(neighbor);
        if (!owner.isPlayer()) {
          if (memberId === observerId && game.isLand(neighbor)) {
            unownedFrontier = true;
          }
          return;
        }
        if (memberId !== observerId || owner.id() === observerId) return;
        const key = owner.id() + "/land";
        if (frontierKeys.has(key)) return;
        frontierKeys.add(key);
        frontiers.push({
          observerId,
          targetId: owner.id(),
          access: "land",
        });
      });
    }
  }

  const players = game.allPlayers();
  const nations = players.map((p) => {
    const empire = authority?.empireOf(p.id()) ?? null;
    let status: SovereignStatus = "independent";
    if (!p.isAlive()) status = "eliminated";
    else if (empire !== null) {
      status = authority?.emperorOf(empire) === p.id() ? "imperial" : "member";
    }
    return {
      id: p.id(),
      name: p.displayName(),
      alive: p.isAlive(),
      landPercent:
        game.totalLandTiles() > 0
          ? (100 * p.numTilesOwned()) / game.totalLandTiles()
          : 0,
      status,
      controllerKind:
        p.type() === PlayerType.Human ? ("human" as const) : ("ai" as const),
      troops: p.troops(),
      treasury: Number(p.gold()),
    };
  });

  // E1's facade supplies only current memberships and protection queries.
  // No private pacts/terms may be inferred from legacy alliance structures.
  const coalitionIds = new Set<string>();
  const coalitions: NationalWorld["coalitions"][number][] = [];
  if (authority)
    for (const player of players) {
      const id = authority.empireOf(player.id());
      if (id === null || coalitionIds.has(id)) continue;
      coalitionIds.add(id);
      const leader = authority.emperorOf(id);
      if (leader === null) continue;
      coalitions.push({
        id,
        kind: "empire",
        leaderId: leader,
        members: [...authority.membersOf(id)],
        terms: {}, // No E1 permission to read treaty clauses.
      });
    }

  const assets: NationalWorld["assets"][number][] = [];
  const sightGrants: NationalWorld["sightGrants"][number][] = [];
  const tick = game.ticks();
  for (const unit of game.units()) {
    const tile = unit.tile();
    const ownerId = unit.owner().id();
    assets.push({
      id: String(unit.id()),
      ownerId,
      kind: kind(unit.type()),
      x: game.x(tile),
      y: game.y(tile),
      strength: unit.troops(),
    });
    if (!allowedPrincipals.has(ownerId) && visibleTiles.has(tile)) {
      sightGrants.push({
        observerId: sightOrigin.get(tile) ?? observerId,
        assetId: String(unit.id()),
        source: "border",
        observedAtTick: tick,
        expiresAtTick: tick,
      });
    }
  }

  // Public war IDs/sides come ONLY from the current Game-owned canonical
  // ledger. Never copy private peace motions, levy spending or declaredBy.
  // A stale empire roster cannot resurrect a departed member's war rights.
  const activeSide = (side: {
    readonly kind: "nation" | "empire";
    readonly id: string;
  }): readonly string[] => {
    if (side.kind === "nation") {
      return game.hasPlayer(side.id) && game.player(side.id).isAlive()
        ? [side.id]
        : [];
    }
    return [...(authority?.membersOf(side.id) ?? [])]
      .filter(
        (id) =>
          game.hasPlayer(id) &&
          game.player(id).isAlive() &&
          authority?.empireOf(id) === side.id,
      )
      .sort();
  };
  const wars: NationalWorld["wars"][number][] = [];
  if (authority && warAuthority) {
    for (const layer of warAuthority.snapshot().wars.layers) {
      if (layer.endedTick !== null) continue;
      const firstMembers = activeSide(layer.first);
      const secondMembers = activeSide(layer.second);
      if (firstMembers.length === 0 || secondMembers.length === 0) continue;
      wars.push({
        id: layer.id,
        scope: layer.scope,
        first: {
          kind: layer.first.kind,
          stableId: layer.first.id,
          activeMemberIds: firstMembers,
        },
        second: {
          kind: layer.second.kind,
          stableId: layer.second.id,
          activeMemberIds: secondMembers,
        },
        startedTick: layer.startedTick,
      });
    }
    wars.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const world: NationalWorld = {
    tick,
    nations,
    coalitions,
    wars,
    invitations: [],
    assets,
    sightGrants,
    frontiers,
    diplomaticEvents: [],
    unownedFrontier,
  };
  return {
    observation: projectNationalObservation(world, observerId),
    visibleTiles,
  };
}
