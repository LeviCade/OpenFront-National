/**
 * NATIONAL live observation adapter. Authoritative engine references enter
 * only here; the planner and packet consumers receive copied whitelisted data.
 *
 * P4 is still OPEN. The sight radius is intentionally limited to territory
 * already owned plus one cardinal tile from a real border. This is a
 * conservative, verifiable subset, not an invented 100/200-tile policy.
 */
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import type { TileRef } from "@openfront/engine-api/game/GameMap";
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

interface GameWithReadFacade extends Game {
  nationalPoliticalAuthority?(): PoliticalReadFacade | null;
}

export interface LiveNationalObservation {
  readonly observation: NationalObservation;
  /** Tiles with trusted live ownership or adjacent-border sight. */
  readonly visibleTiles: ReadonlySet<TileRef>;
}

function getFacade(game: Game): PoliticalReadFacade | null {
  const candidate = (game as GameWithReadFacade).nationalPoliticalAuthority;
  return typeof candidate === "function"
    ? candidate.call(game)
    : null;
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
  return { empire, members };
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
  const { members } = activeEmpireMembers(authority, observer);
  const allowedPrincipals = new Set(members);
  const visibleTiles = new Set<TileRef>();
  const frontierKeys = new Set<string>();
  const frontiers: NationalWorld["frontiers"][number][] = [];
  let unownedFrontier = false;

  // Do not enumerate globally owned tiles just to discover enemies. Every
  // seed is a current authenticated member's actual territory.
  for (const memberId of [...allowedPrincipals].sort()) {
    if (!game.hasPlayer(memberId)) continue;
    const member = game.player(memberId);
    for (const tile of member.tiles()) visibleTiles.add(tile);
    for (const tile of member.borderTiles()) {
      visibleTiles.add(tile);
      game.forEachNeighbor(tile, (neighbor) => {
        visibleTiles.add(neighbor);
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
          observerId, targetId: owner.id(), access: "land",
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
      status = authority?.emperorOf(empire) === p.id()
        ? "imperial" : "member";
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
      controllerKind: p.type() === "human" ? "human" as const : "ai" as const,
      troops: p.troops(),
      treasury: Number(p.gold()),
    };
  });

  // E1's facade supplies only current memberships and protection queries.
  // No private pacts/terms may be inferred from legacy alliance structures.
  const coalitionIds = new Set<string>();
  const coalitions: NationalWorld["coalitions"][number][] = [];
  if (authority) for (const player of players) {
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
        observerId,
        assetId: String(unit.id()),
        source: "border",
        observedAtTick: tick,
        expiresAtTick: tick,
      });
    }
  }

  // The E2 canonical scoped war read-port has not yet been merged. Intentionally
  // no guessed war records or arbitrary alliances from Game. Foreign combat
  // remains disabled until a conductor-owned E2 adapter supplies active wars.
  const world: NationalWorld = {
    tick,
    nations,
    coalitions,
    wars: [],
    invitations: [],
    assets,
    sightGrants,
    frontiers,
    diplomaticEvents: [],
    unownedFrontier,
  };
  return { observation: projectNationalObservation(world, observerId), visibleTiles };
}
