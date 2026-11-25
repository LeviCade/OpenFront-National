import type { TileRef } from "@openfront/engine-api/game/GameMap";
/**
 * NATIONAL live observation adapter. Authoritative engine references enter
 * only here; the planner and packet consumers receive copied whitelisted data.
 *
 * FOG-03/04: actual owned borders, coastal fronts and active owned warships
 * produce current-tick grants. Foreign position/strength never becomes a
 * substitute for a legitimate sensor; reciprocal empire sharing is mandatory.
 */
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import type { Game, Player } from "../../game/Game";
import type { NationalRecipientDiplomacy } from "../politics/PoliticalAuthorityAdapter";
import { projectLiveNationalAssessments } from "./NationalAssessment";
import {
  projectNationalObservation,
  type AssetKind,
  type NationalObservation,
  type ObservedPeaceNegotiation,
  type NationalWorld,
  type SovereignStatus,
} from "./NationalObservation";
import { projectNationalPublicConflict } from "./NationalOutbound";

interface PoliticalReadFacade {
  empireOf(id: string): string | null;
  emperorOf(id: string): string | null;
  membersOf(id: string): readonly string[];
  recipientDiplomacy(observerId: string): NationalRecipientDiplomacy;
  maySettleNational(memberId: string): boolean;
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
  authorizeOffensiveAction(
    attackerId: string,
    targetId: string | null,
  ): boolean;
  snapshot(): {
    readonly wars: {
      readonly layers: readonly {
        readonly id: string;
        readonly scope: "national" | "imperial";
        readonly first: {
          readonly kind: "nation" | "empire";
          readonly id: string;
        };
        readonly second: {
          readonly kind: "nation" | "empire";
          readonly id: string;
        };
        readonly startedTick: number;
        readonly endedTick: number | null;
        /** Public declarer is in the canonical Game-owned WAR layer. */
        readonly declaredBy: string;
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

/** A sole, reciprocal membership rule feeds BOTH sensors and projections. */
function reciprocalEmpireMembers(
  authority: PoliticalReadFacade,
  empireId: string,
): readonly string[] {
  return [...new Set(authority.membersOf(empireId))]
    .filter((id) => authority.empireOf(id) === empireId)
    .sort();
}

function activeEmpireMembers(
  authority: PoliticalReadFacade | null,
  observer: Player,
): { empire: string | null; members: readonly string[] } {
  const empire = authority?.empireOf(observer.id()) ?? null;
  if (empire === null || authority === null)
    return { empire: null, members: [observer.id()] };
  const members = reciprocalEmpireMembers(authority, empire);
  // An inconsistent current read must fail closed, not reuse a historic list.
  if (!members.includes(observer.id())) {
    return { empire: null, members: [observer.id()] };
  }
  return { empire, members };
}

/**
 * Geographic sight is measured in MAP TILES, never land percentage or
 * unverified client coordinates. The bucket index avoids a global
 * O(foreign units * nation border length) distance scan on large maps.
 *
 * 100-tile border structure/army radius and 200-tile coastline/observing
 * warship radius are D-017's conservative initial NATIONAL defaults.
 */
const BORDER_SIGHT_RADIUS = 100;
const NAVAL_SIGHT_RADIUS = 200;
const SIGHT_BUCKET_SIZE = 100;

interface SightAnchor {
  readonly x: number;
  readonly y: number;
  readonly contributorId: string;
}

type SightIndex = Map<string, SightAnchor[]>;

function sightBucket(x: number, y: number): string {
  return (
    Math.floor(x / SIGHT_BUCKET_SIZE) + ":" + Math.floor(y / SIGHT_BUCKET_SIZE)
  );
}

function addSightAnchor(
  index: SightIndex,
  x: number,
  y: number,
  contributorId: string,
): void {
  const key = sightBucket(x, y);
  const entries = index.get(key) ?? [];
  entries.push({ x, y, contributorId });
  index.set(key, entries);
}

/** Returns ONLY the sight-granting real owner, never a hidden asset. */
function nearestSightContributor(
  index: SightIndex,
  x: number,
  y: number,
  radius: number,
): string | null {
  let source: string | null = null;
  let distance = radius * radius + 1;
  const bucketX = Math.floor(x / SIGHT_BUCKET_SIZE);
  const bucketY = Math.floor(y / SIGHT_BUCKET_SIZE);
  const bucketReach = Math.ceil(radius / SIGHT_BUCKET_SIZE);
  for (let bx = bucketX - bucketReach; bx <= bucketX + bucketReach; bx++) {
    for (let by = bucketY - bucketReach; by <= bucketY + bucketReach; by++) {
      for (const anchor of index.get(bx + ":" + by) ?? []) {
        const deltaX = x - anchor.x;
        const deltaY = y - anchor.y;
        const squared = deltaX * deltaX + deltaY * deltaY;
        if (
          squared <= radius * radius &&
          (squared < distance ||
            (squared === distance &&
              (source === null || anchor.contributorId < source)))
        ) {
          distance = squared;
          source = anchor.contributorId;
        }
      }
    }
  }
  return source;
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
  const borderSight = new Map<string, SightAnchor[]>();
  const coastSight = new Map<string, SightAnchor[]>();
  const warshipSight = new Map<string, SightAnchor[]>();
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
      addSightAnchor(borderSight, game.x(tile), game.y(tile), memberId);
      let coastal = false;
      game.forEachNeighbor(tile, (neighbor) => {
        if (!game.isLand(neighbor)) coastal = true;
        markVisible(neighbor, memberId);
        const owner = game.owner(neighbor);
        if (!owner.isPlayer()) {
          if (
            memberId === observerId &&
            game.isLand(neighbor) &&
            !game.isImpassable(neighbor)
          ) {
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
      if (coastal) {
        addSightAnchor(coastSight, game.x(tile), game.y(tile), memberId);
      }
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
      troops: p.id() === observerId ? p.troops() : 0,
      treasury: p.id() === observerId ? Number(p.gold()) : 0,
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
        // A stale membersOf roster is NOT authorization to disclose a
        // departed nation's units, ships or troops in the projection.
        members: reciprocalEmpireMembers(authority, id),
        terms: {}, // No E1 permission to read treaty clauses.
      });
    }

  // All diplomacy is whitelisted by the same Game authority for humans/bots.
  const diplomacy = authority?.recipientDiplomacy?.(observerId);
  const invitations: NationalWorld["invitations"][number][] = [];
  for (const pact of diplomacy?.pacts ?? []) {
    if (coalitionIds.has(pact.id)) continue;
    coalitionIds.add(pact.id);
    coalitions.push({
      id: pact.id,
      kind: pact.kind === "NAP" ? "nap" : "mda",
      leaderId: pact.leaderId,
      members: [...pact.members],
      terms:
        pact.terms === undefined
          ? {}
          : {
              admission: pact.terms.admission,
              expulsion: pact.terms.expulsion,
              ...(pact.constitutionVersion === undefined
                ? {}
                : { constitutionVersion: pact.constitutionVersion }),
            },
      ...(pact.pendingInvitees === undefined
        ? {}
        : { pendingInvitees: [...pact.pendingInvitees] }),
    });
    if (pact.invited)
      invitations.push({ coalitionId: pact.id, recipientId: observerId });
  }

  // Purchases are read ONLY from this observer's current real empire.
  // Target-indexed envelopes avoid a scan of all purchases per foreign asset.
  const purchasedByTarget = new Map<
    string,
    { payerId: string; x: number; y: number; radius: number; expiry: number }[]
  >();
  for (const contributorId of sightOrder) {
    for (const grant of game.nationalReconnaissanceFor(contributorId)) {
      if (
        grant.effectiveTick > game.ticks() ||
        game.ticks() >= grant.expiresAtTick ||
        !game.hasPlayer(grant.targetId)
      )
        continue;
      const list = purchasedByTarget.get(grant.targetId) ?? [];
      list.push({
        payerId: contributorId,
        x: grant.centerX,
        y: grant.centerY,
        radius: grant.radius,
        expiry: grant.expiresAtTick,
      });
      purchasedByTarget.set(grant.targetId, list);
    }
  }
  // A satellite scans the current geographic positions of structures and
  // vessels worldwide, not every map cell or any confidential unit field.
  // One reciprocal living payer is enough; own/ordinary sight takes priority.
  const satellitePayer = observer.isAlive()
    ? sightOrder.find((id) => game.nationalSatelliteFor(id) !== null)
    : undefined;
  const assets: NationalWorld["assets"][number][] = [];
  const sightGrants: NationalWorld["sightGrants"][number][] = [];
  const tick = game.ticks();
  const allUnits = game.units();
  // Freeze actual terrain/adjacent-border sight BEFORE unit discoveries.
  // Otherwise a recon-sighted target could reveal any co-located stranger.
  const geographicVisibleTiles = new Set(visibleTiles);
  // An observing warship is itself legitimate first-party (or current
  // empire-shared) intelligence. Never use an enemy warship as a sensor.
  for (const unit of allUnits) {
    if (
      unit.type() !== UnitType.Warship ||
      !allowedPrincipals.has(unit.owner().id())
    )
      continue;
    const tile = unit.tile();
    addSightAnchor(warshipSight, game.x(tile), game.y(tile), unit.owner().id());
  }
  for (const unit of allUnits) {
    const tile = unit.tile();
    const ownerId = unit.owner().id();
    assets.push({
      id: String(unit.id()),
      ownerId,
      kind: kind(unit.type()),
      x: game.x(tile),
      y: game.y(tile),
      // Foreign troop counts must not even be read by the observer adapter.
      strength: allowedPrincipals.has(ownerId) ? unit.troops() : undefined,
    });
    if (!allowedPrincipals.has(ownerId)) {
      const x = game.x(tile);
      const y = game.y(tile);
      // FOG-03 extends visibility of BORDER STRUCTURES, not armies or
      // hidden transports. FOG-05 forbids granting an unseen invasion
      // force a free 100-tile detection radius just because its tile is
      // near a country's distant frontier.
      const fromBorder = geographicVisibleTiles.has(tile)
        ? (sightOrigin.get(tile) ?? observerId)
        : kind(unit.type()) === "structure"
          ? nearestSightContributor(borderSight, x, y, BORDER_SIGHT_RADIUS)
          : null;
      const isShip =
        unit.type() === UnitType.Warship ||
        unit.type() === UnitType.TransportShip ||
        unit.type() === UnitType.TradeShip;
      const fromCoast =
        fromBorder === null && isShip
          ? nearestSightContributor(coastSight, x, y, NAVAL_SIGHT_RADIUS)
          : null;
      const fromWarship =
        fromBorder === null && fromCoast === null && isShip
          ? nearestSightContributor(warshipSight, x, y, NAVAL_SIGHT_RADIUS)
          : null;
      // Military and structures are seen ONLY inside the paid circle of
      // the requested target nation. Moving ships are checked at each tick.
      const recon =
        fromBorder === null && fromCoast === null && fromWarship === null
          ? (purchasedByTarget.get(ownerId) ?? []).find((lease) => {
              const dx = x - lease.x;
              const dy = y - lease.y;
              return dx * dx + dy * dy <= lease.radius * lease.radius;
            })
          : undefined;
      const satellite =
        (isShip || kind(unit.type()) === "structure") &&
        fromBorder === null &&
        fromCoast === null &&
        fromWarship === null &&
        recon === undefined
          ? satellitePayer
          : undefined;
      const contributorId =
        fromBorder ??
        fromCoast ??
        fromWarship ??
        recon?.payerId ??
        satellite ??
        null;
      if (contributorId !== null) {
        // The same independently verified visible tile feeds BOTH AI's
        // NationalObservation and the human GameRunner's packet whitelist.
        // No sight grant survives a removed empire contributor.
        markVisible(tile, contributorId);
        sightGrants.push({
          observerId: contributorId,
          assetId: String(unit.id()),
          source:
            fromBorder !== null
              ? "border"
              : fromCoast !== null
                ? "coast"
                : fromWarship !== null
                  ? "warship"
                  : satellite === undefined
                    ? "recon"
                    : "satellite",
          observedAtTick: tick,
          expiresAtTick: recon?.expiry ?? tick,
        });
      }
    }
  }

  // Every currently authorized first-party or reciprocal-empire unit is a
  // legitimate point observation even outside national territory. In
  // particular, an isolated owned warship must appear in the native map
  // while sailing in the open ocean with no foreign target nearby.
  //
  // Defer these point grants until AFTER foreign asset attribution. Otherwise
  // a foreign ship sharing an owned warship's tile could be misclassified as
  // a land-border sighting instead of a real "warship" observation.
  // No new radius, remote terrain sweep, enemy reconnaissance or stale
  // empire membership is introduced by this final point-sight pass.
  for (const unit of allUnits) {
    const memberId = unit.owner().id();
    if (allowedPrincipals.has(memberId)) markVisible(unit.tile(), memberId);
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
  // Only canonical public WAR *layer* transitions are diplomatic events.
  // No treaty clauses, peace motions, proposer/acceptor IDs or secret plans
  // are inspected. A bounded window is enough for event-driven replanning.
  const diplomaticEvents: NationalWorld["diplomaticEvents"][number][] = [];
  const DIPLOMACY_WINDOW_TICKS = 120;
  if (warAuthority) {
    for (const layer of warAuthority.snapshot().wars.layers) {
      if (
        layer.startedTick <= tick &&
        tick - layer.startedTick <= DIPLOMACY_WINDOW_TICKS
      ) {
        diplomaticEvents.push({
          id: `war:0:started:${layer.id}`,
          tick: layer.startedTick,
          actorId: layer.declaredBy,
          kind: "war-started",
          public: true,
        });
      }
      if (
        layer.endedTick !== null &&
        layer.endedTick <= tick &&
        tick - layer.endedTick <= DIPLOMACY_WINDOW_TICKS
      ) {
        diplomaticEvents.push({
          id: `war:1:ended:${layer.id}`,
          tick: layer.endedTick,
          // The declarer identifies the public WAR record, not the
          // confidential recipient/acceptor of any peace motion.
          actorId: layer.declaredBy,
          kind: "war-ended",
          public: true,
        });
      }
    }
  }
  // Reuse the same recipient-filtered motion projector as the human wire.
  // Capability is scoped to the current crown/delegation, not membership.
  const peaceNegotiations: ObservedPeaceNegotiation[] = [];
  if (authority && wars.length > 0 && observer.isAlive()) {
    // Most viewers are not negotiating any of the world's wars. Do not
    // build a second global projection for those viewers.
    let conflict: ReturnType<typeof projectNationalPublicConflict> | null =
      null;
    for (const war of wars) {
      const canNegotiate = (side: typeof war.first): boolean => {
        if (war.scope === "imperial") {
          return side.kind === "nation"
            ? side.stableId === observerId
            : authority.emperorOf(side.stableId) === observerId;
        }
        if (side.kind !== "nation") return false;
        const empire = authority.empireOf(side.stableId);
        return empire === null
          ? side.stableId === observerId
          : authority.emperorOf(empire) === observerId ||
              (side.stableId === observerId &&
                authority.maySettleNational(observerId));
      };
      const side = canNegotiate(war.first)
        ? 0
        : canNegotiate(war.second)
          ? 1
          : null;
      if (side === null) continue;
      if (conflict === null)
        conflict = projectNationalPublicConflict(game, observerId, tick);
      if (
        !conflict?.layers.some(
          (layer) => layer.id === war.id && layer.endedTick === null,
        )
      )
        continue;
      const pending = conflict.motions.filter(
        (motion) => motion.layerId === war.id && motion.acceptedTick === null,
      );
      peaceNegotiations.push({
        warId: war.id,
        side,
        incomingMotionIds: pending
          .filter((motion) => motion.proposingSide !== side)
          .map((motion) => motion.id)
          .sort(),
        outgoingPending: pending.some(
          (motion) => motion.proposingSide === side,
        ),
      });
    }
  }
  const world: NationalWorld = {
    tick,
    nations,
    coalitions,
    wars,
    invitations,
    imperialOffers: diplomacy?.empireOffers ?? [],
    assets,
    sightGrants,
    frontiers,
    diplomaticEvents,
    unownedFrontier,
  };
  return {
    observation: {
      ...projectNationalObservation(world, observerId),
      assessments: projectLiveNationalAssessments(game, observerId),
      ...(peaceNegotiations.length === 0 ? {} : { peaceNegotiations }),
    },
    visibleTiles,
  };
}
