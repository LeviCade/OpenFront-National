import {
  PlayerType,
  type GameUpdates,
} from "@openfront/engine-api/game/GameTypes";
/**
 * NATIONAL per-recipient outbound packet projection.
 *
 * This is applied in GameRunner BEFORE the worker sees any GameUpdateViewData,
 * including run_turns batching, resynchronization and snapshot replay ticks.
 * No raw GameUpdates or packed unit/stat buffers are forwarded in NATIONAL.
 * Legacy mode bypasses this adapter entirely.
 *
 * Only local, authenticated clientID -> PlayerID resolution may select a
 * private view. Unknown clients receive public player identities only.
 * This does NOT make an authoritative in-browser game worker tamper-proof.
 */
import {
  GameUpdateType,
  type GameUpdateViewData,
  type PlayerUpdate,
  type UnitUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import type { NationalObserverMapV1, NationalPublicConflictView } from "@openfront/engine-api/game/NationalRecipientView";
import {
  packUnitUpdates,
  unpackUnitUpdates,
} from "@openfront/engine-lib/game/PackedUnitUpdates";
import type { Game } from "../../game/Game";
import type { NationalPublicPoliticalView } from "../NationalRuntime";
import type { LiveNationalObservation } from "./LiveObservation";
import {
  advanceLastKnown,
  type NationalSightMemory,
} from "./NationalObservation";
import type { OutboundNationalResult } from "./NationalPoliticalPacket";

export type { NationalPublicConflictView } from "@openfront/engine-api/game/NationalRecipientView";

/**
 * Explicit PUBLIC political whitelist. Even an accidentally extended E1
 * projection object must not carry private pacts, treasury, war motions or
 * sight history through the worker. Clone nested arrays before delivery.
 */
function publicPolitics(
  packet: GameUpdateViewData,
): NationalPublicPoliticalView | undefined {
  const source = (
    "nationalPolitics" in packet ? packet.nationalPolitics : undefined
  ) as NationalPublicPoliticalView | null | undefined;
  if (source === null || source === undefined) return undefined;
  return {
    empires: source.empires.map((empire) => ({
      id: empire.id,
      leaderId: empire.leaderId,
      memberIds: [...empire.memberIds],
    })),
    warnings: source.warnings.map((warning) => ({
      empireId: warning.empireId,
      deadlineMs: warning.deadlineMs,
      remainingMs: warning.remainingMs,
      blockedByAssetDisposition: warning.blockedByAssetDisposition,
    })),
    victory:
      source.victory === null
        ? null
        : {
            sovereignPowerCount: source.victory.sovereignPowerCount,
            resolved: source.victory.resolved,
            prizes: source.victory.prizes.map((prize) =>
              prize.kind === "SovereignVictor"
                ? { kind: prize.kind, nationId: prize.nationId }
                : {
                    kind: prize.kind,
                    nationId: prize.nationId,
                    empireId: prize.empireId,
                  },
            ),
          },
  };
}

const publicId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  !Array.from(value).some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127;
  });

const resultTypes = new Set([
  "national_found_empire",
  "national_declare_war",
  "national_propose_peace",
  "national_accept_peace",
  "national_offer_empire",
  "national_accept_empire",
  "national_transfer_crown",
  "national_set_peace_delegation",
  "national_found_pact",
  "national_invite_pact",
  "national_accept_pact",
  "national_propose_pact_amendment",
  "national_approve_pact_amendment",
  "national_betray_pact",
  "national_expel_pact",
]);
const politicalReason = new Set([
  "accepted",
  "actor-inactive",
  "invalid-empire-id",
  "political-rule",
  "invalid-war-command",
  "war-rule",
]);

/**
 * The complete, CURRENT pending accession invitation snapshot for one
 * authenticated GameRunner human. Both constitutional directions are legal:
 * emperor -> candidate, and candidate -> emperor. No raw E1 politics state,
 * pact terms or issuing actor's private command receipt crosses this port.
 *
 * Unlike event receipts, this must be sent each tick, including an empty list:
 * acceptance, crown transfer, elimination and replay can revoke the offer.
 * Spectators/unknown principals have no such field at all.
 */
export interface NationalAccessionOffersView {
  readonly version: 1;
  readonly recipientId: string;
  readonly offers: readonly {
    readonly empireId: string;
    readonly candidateId: string;
    readonly proposerId: string;
    readonly recipientId: string;
  }[];
}

/** Derive offers ONLY from E1's per-Player authority read, never a global
 * political snapshot or a client-requested observerId. */
export function projectNationalAccessionOffers(
  game: Game,
  observerId: string | null,
): NationalAccessionOffersView | undefined {
  if (!game.config().nationalMode() || observerId === null) return undefined;
  if (!game.hasPlayer(observerId)) return undefined;
  const observer = game.player(observerId);
  // A spectator, pre-spawn player or eliminated player cannot hold an
  // actionable invitation, even after a stale GameRunner session restore.
  if (
    observer.type() !== PlayerType.Human ||
    !observer.hasSpawned() ||
    !observer.isAlive()
  )
    return { version: 1, recipientId: observerId, offers: [] };

  // GameImpl independently verifies the exact registry Player object and
  // reports only the still-pending offers for this recipient.
  const offered = game.nationalAccessionOffers(observer);
  const publicRoster = game.nationalPublicPoliticalView();
  if (publicRoster === null)
    throw new Error("NATIONAL private offer: missing public authority");
  const leaders = new Map(
    publicRoster.empires.map((empire) => [empire.id, empire.leaderId]),
  );
  const members = new Set(
    publicRoster.empires.flatMap((empire) => empire.memberIds),
  );
  const unique = new Set<string>();
  const offers: NationalAccessionOffersView["offers"][number][] = [];
  for (const offer of offered) {
    const leaderId = leaders.get(offer.empireId);
    const pairKey = JSON.stringify([offer.empireId, offer.candidateId]);
    if (
      !publicId(offer.empireId) ||
      !publicId(offer.candidateId) ||
      !publicId(offer.proposerId) ||
      !publicId(offer.recipientId) ||
      offer.recipientId !== observerId ||
      leaderId === undefined ||
      members.has(offer.candidateId) ||
      !game.hasPlayer(offer.candidateId) ||
      !game.player(offer.candidateId).isAlive() ||
      // Both consenting-party directions are permitted by E1.
      !(
        (offer.proposerId === leaderId &&
          offer.recipientId === offer.candidateId) ||
        (offer.proposerId === offer.candidateId &&
          offer.recipientId === leaderId)
      ) ||
      unique.has(pairKey)
    )
      throw new Error("NATIONAL private offer: invalid recipient projection");
    unique.add(pairKey);
    offers.push({
      empireId: offer.empireId,
      candidateId: offer.candidateId,
      proposerId: offer.proposerId,
      recipientId: offer.recipientId,
    });
  }
  offers.sort(
    (a, b) =>
      a.empireId.localeCompare(b.empireId) ||
      a.candidateId.localeCompare(b.candidateId),
  );
  return { version: 1, recipientId: observerId, offers };
}

/** Keep end/acceptance proof briefly for the UI, never permanent history. */
const PUBLIC_CONFLICT_RETENTION_TICKS = 240;

/** Only canonical E1/E2 Game WAR state, never an intent, client assertion, or
 * a visible attack animation. The same recipient-bound projection is used by
 * run_turns, replay and live worker packets through GameRunner. */
export function projectNationalPublicConflict(
  game: Game,
  actorId: string | null,
  tick: number,
): NationalPublicConflictView | undefined {
  if (!game.config().nationalMode()) return undefined;
  const snapshot = game.nationalWarState();
  if (snapshot === null) return undefined;
  const layers: NationalPublicConflictView["layers"][number][] = [];
  const visibleLayers = new Map<
    string,
    (typeof snapshot.wars.layers)[number]
  >();
  for (const layer of snapshot.wars.layers) {
    if (
      layer.startedTick > tick ||
      (layer.endedTick !== null &&
        layer.endedTick < tick - PUBLIC_CONFLICT_RETENTION_TICKS)
    )
      continue;
    if (
      !publicId(layer.id) ||
      !publicId(layer.first.id) ||
      !publicId(layer.second.id) ||
      !publicId(layer.declaredBy) ||
      !Number.isSafeInteger(layer.startedTick) ||
      layer.startedTick < 0 ||
      (layer.endedTick !== null &&
        (!Number.isSafeInteger(layer.endedTick) ||
          layer.endedTick < layer.startedTick ||
          layer.endedTick > tick)) ||
      !["national", "imperial"].includes(layer.scope) ||
      !["nation", "empire"].includes(layer.first.kind) ||
      !["nation", "empire"].includes(layer.second.kind) ||
      visibleLayers.has(layer.id)
    )
      throw new Error("NATIONAL malformed public WAR layer");
    visibleLayers.set(layer.id, layer);
    layers.push({
      id: layer.id,
      scope: layer.scope,
      first: { kind: layer.first.kind, id: layer.first.id },
      second: { kind: layer.second.kind, id: layer.second.id },
      declaredBy: layer.declaredBy,
      startedTick: layer.startedTick,
      endedTick: layer.endedTick,
    });
  }
  layers.sort((a, b) => a.id.localeCompare(b.id));

  const authority = game.nationalPoliticalAuthority();
  /** Match the EXACT E2 WarLedger.authorizedSide rules for peace.
   * Membership alone never authorizes seeing confidential peace motions. */
  const canNegotiate = (layer: (typeof snapshot.wars.layers)[number]) => {
    if (
      actorId === null ||
      authority === null ||
      !authority.nationAlive(actorId)
    )
      return false;
    const authorizedSide = (side: {
      readonly kind: "nation" | "empire";
      readonly id: string;
    }): boolean => {
      if (layer.scope === "imperial")
        return side.kind === "nation"
          ? side.id === actorId
          : authority.emperorOf(side.id) === actorId;
      if (side.kind !== "nation") return false;
      const empireId = authority.empireOf(side.id);
      if (empireId === null) return side.id === actorId;
      return (
        authority.emperorOf(empireId) === actorId ||
        (side.id === actorId && authority.maySettleNational(side.id))
      );
    };
    return authorizedSide(layer.first) || authorizedSide(layer.second);
  };
  const motions: NationalPublicConflictView["motions"][number][] = [];
  const motionIds = new Set<string>();
  for (const motion of snapshot.wars.motions) {
    if (
      motion.proposedTick > tick ||
      (motion.acceptedTick !== null &&
        motion.acceptedTick < tick - PUBLIC_CONFLICT_RETENTION_TICKS)
    )
      continue;
    const layer = visibleLayers.get(motion.layerId);
    if (
      !layer ||
      !canNegotiate(layer) ||
      (layer.endedTick !== null && motion.acceptedTick === null)
    )
      continue;
    if (
      !publicId(motion.id) ||
      !publicId(motion.layerId) ||
      !publicId(motion.proposedBy) ||
      !Number.isSafeInteger(motion.proposedTick) ||
      motion.proposedTick < 0 ||
      (motion.proposingSide !== 0 && motion.proposingSide !== 1) ||
      (motion.acceptedTick !== null &&
        (!Number.isSafeInteger(motion.acceptedTick) ||
          motion.acceptedTick < motion.proposedTick ||
          motion.acceptedTick > tick ||
          !publicId(motion.acceptedBy))) ||
      (motion.acceptedTick === null && motion.acceptedBy !== null) ||
      motionIds.has(motion.id)
    )
      throw new Error("NATIONAL malformed recipient peace motion");
    motionIds.add(motion.id);
    motions.push({
      id: motion.id,
      layerId: motion.layerId,
      proposedBy: motion.proposedBy,
      proposingSide: motion.proposingSide,
      proposedTick: motion.proposedTick,
      acceptedTick: motion.acceptedTick,
      acceptedBy: motion.acceptedBy,
    });
  }
  motions.sort((a, b) => a.id.localeCompare(b.id));
  return {
    version: 1,
    recipientId: actorId ?? "",
    layers,
    motions,
  };
}

function publicPlayer(u: PlayerUpdate): PlayerUpdate {
  // Enumerate allowed fields explicitly. The full internal PlayerUpdate
  // contains private gold, troop, income, spawn/attack and treaty information.
  return {
    type: GameUpdateType.Player,
    id: u.id,
    ...(u.name === undefined ? {} : { name: u.name }),
    ...(u.displayName === undefined ? {} : { displayName: u.displayName }),
    ...(u.nationFlag === undefined ? {} : { nationFlag: u.nationFlag }),
    ...(u.playerType === undefined ? {} : { playerType: u.playerType }),
    ...(u.smallID === undefined ? {} : { smallID: u.smallID }),
    ...(u.isAlive === undefined ? {} : { isAlive: u.isAlive }),
    ...(u.tilesOwned === undefined ? {} : { tilesOwned: u.tilesOwned }),
  };
}

function observedUnit(u: UnitUpdate): UnitUpdate {
  // Visual identity and current sighted position only. No troops, health,
  // patrol routes, transport destinations, targets or missile timer queues.
  return {
    type: GameUpdateType.Unit,
    id: u.id,
    unitType: u.unitType,
    troops: 0,
    ownerID: u.ownerID,
    pos: u.pos,
    lastPos: u.pos,
    isActive: u.isActive,
    reachedTarget: false,
    targetable: false,
    markedForDeletion: u.markedForDeletion,
    missileTimerQueue: [],
    level: 0,
    hasTrainStation: false,
  };
}

/** Dedicated per-GameRunner recipient state, never global or cross-principal. */
export class NationalOutboundFilter {
  private readonly previousUnits = new Map<number, UnitUpdate>();
  private readonly observerId: string | null;
  private readonly ownSmallID: number | null;
  private sightMemory: NationalSightMemory | null = null;

  /**
   * Detached, principal-bound serialization for a future Game-owned snapshot
   * port. Never share a cached observer record across clients.
   */
  snapshotSightMemory(): NationalSightMemory | null {
    if (this.sightMemory === null) return null;
    return {
      observerId: this.sightMemory.observerId,
      assets: this.sightMemory.assets.map((asset) => ({ ...asset })),
    };
  }

  restoreSightMemory(memory: NationalSightMemory | null): void {
    if (memory !== null && memory.observerId !== this.observerId) {
      throw new Error("NATIONAL sight restore principal mismatch");
    }
    this.sightMemory =
      memory === null
        ? null
        : {
            observerId: memory.observerId,
            assets: memory.assets.map((asset) => ({ ...asset })),
          };
  }

  constructor(game: Game, observerId: string | null) {
    this.observerId = observerId;
    this.ownSmallID =
      observerId !== null && game.hasPlayer(observerId)
        ? game.player(observerId).smallID()
        : null;
  }

  project(
    game: Game,
    data: GameUpdateViewData,
    verified: LiveNationalObservation | null,
    page?: NationalObserverMapV1,
  ): GameUpdateViewData {
    if (!game.config().nationalMode()) {
      throw new Error("NATIONAL packet projection used in legacy mode");
    }
    if (
      verified?.observation.observerId !== this.observerId &&
      verified !== null
    ) {
      throw new Error("NATIONAL outbound principal mismatch");
    }
    // Human observers use the SAME verified sight history as AI, including
    // sourceNationId for instant expulsion/split revocation. The record is
    // deliberately private to this recipient until E1 snapshots it in Game.
    if (verified === null) {
      this.sightMemory = null;
    } else {
      const advanced = advanceLastKnown(
        verified.observation,
        this.sightMemory,
        60,
      ).memory;
      // E1's canonical GameSnapshot limits one principal to 4096 last-known
      // assets. Favor fresh observations, then stable IDs; never allow a large
      // empire or bot world to crash worker delivery with an oversized write.
      const retained = [...advanced.assets]
        .sort(
          (a, b) =>
            b.lastSeenTick - a.lastSeenTick ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        )
        .slice(0, 4096)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      this.sightMemory = {
        observerId: advanced.observerId,
        assets: retained,
      };
    }
    const visibleTiles = verified?.visibleTiles ?? new Set<number>();
    const visibleAssets = new Map(
      (verified?.observation.visibleAssets ?? []).map((asset) => [
        Number(asset.id),
        asset,
      ]),
    );
    const visibleAssetIds = new Set(visibleAssets.keys());
    const ownID = this.observerId;
    const rawPlayer = data.updates[GameUpdateType.Player] as PlayerUpdate[];
    const players = rawPlayer.map((u) =>
      u.id === ownID ? { ...u } : publicPlayer(u),
    );

    // Never forward an unfiltered enum bucket. This drops hidden diplomatic
    // events, targets, embargoes, ship arrivals, railroad and attack messages.
    const updates = Object.fromEntries(
      Object.keys(data.updates).map((key) => [key, []]),
    ) as unknown as GameUpdates;
    updates[GameUpdateType.Player] = players;
    updates[GameUpdateType.GamePaused] = [
      ...data.updates[GameUpdateType.GamePaused],
    ];
    updates[GameUpdateType.SpawnPhaseEnd] = [
      ...data.updates[GameUpdateType.SpawnPhaseEnd],
    ];

    const packedTile: number[] = [];
    for (let i = 0; i + 1 < data.packedTileUpdates.length; i += 2) {
      const tile = data.packedTileUpdates[i];
      // Private host map tuples are the only ownership lane; Solo retains deltas.
      if (page !== undefined || !visibleTiles.has(tile)) continue;
      packedTile.push(tile, data.packedTileUpdates[i + 1]);
    }

    // New sightings (including static units after resync) must be emitted
    // even if the authoritative engine did not produce a movement delta.
    const rawUnits = new Map<number, UnitUpdate>();
    for (const unit of [
      ...unpackUnitUpdates(data.packedUnitUpdates, data.packedMissileTimers),
      ...(data.updates[GameUpdateType.Unit] as UnitUpdate[]),
    ])
      rawUnits.set(unit.id, unit);

    const unitUpdates: UnitUpdate[] = [];
    const stillVisible = new Set<number>();
    const orderedVisible = page === undefined
      ? [...visibleAssetIds].sort((a, b) => a - b)
      : page.units.map((unit) => unit.id);
    for (const id of orderedVisible) {
      const unit = game.unit(id);
      if (!unit) continue;
      const raw =
        page !== undefined ? unit.toUpdate() : rawUnits.get(id) ??
        (this.previousUnits.has(id) ? null : unit.toUpdate());
      stillVisible.add(id);
      if (raw === null) continue;
      const allied = visibleAssets.get(id);
      // Empire partners may share observed troop strength, but NOT private
      // transport destinations, missile queues or operational targets.
      const outgoing =
        unit.owner().id() === ownID
          ? { ...raw }
          : {
              ...observedUnit(raw),
              ...(allied?.source === "empire" &&
              allied.sourceNationId === allied.ownerId &&
              allied.strength !== undefined
                ? { troops: allied.strength }
                : {}),
            };
      unitUpdates.push(outgoing);
      if (page === undefined) this.previousUnits.set(id, outgoing);
    }

    // Revoke sight using the LAST VISIBLE position, never the now-hidden
    // authoritative position/strength. A loss of empire membership is
    // reflected immediately by absence from the fresh verified sight set.
    // Private host deletion is exclusively the disclosed map tombstone/clear.
    if (page !== undefined) this.previousUnits.clear();
    for (const [id, prior] of this.previousUnits) {
      if (stillVisible.has(id)) continue;
      unitUpdates.push({
        ...observedUnit(prior),
        // Revocation must not replay formerly allied troops or private
        // routing fields. Only the recipient's last visible tile survives.
        isActive: false,
        targetable: false,
        markedForDeletion: data.tick,
        lastPos: prior.pos,
      });
      this.previousUnits.delete(id);
    }
    const packed = unitUpdates.length > 0 ? packUnitUpdates(unitUpdates) : null;
    const packedPlayer: number[] = [];
    if (this.ownSmallID !== null && data.packedPlayerUpdates) {
      const input = data.packedPlayerUpdates;
      for (let i = 0; i + 4 < input.length; i += 5) {
        if (input[i] !== this.ownSmallID) continue;
        for (let k = 0; k < 5; k++) packedPlayer.push(input[i + k]);
      }
    }

    const playerNameViewData =
      ownID !== null && data.playerNameViewData?.[ownID] !== undefined
        ? { [ownID]: data.playerNameViewData[ownID] }
        : undefined;

    const proposedResults = (
      data as unknown as {
        nationalCommandResults?: readonly OutboundNationalResult[];
      }
    ).nationalCommandResults;
    // A second independent scope check prevents an accidental caller from
    // attaching the E1 journal for another actor to this viewer's packet.
    const recipientResults =
      this.observerId === null
        ? []
        : (proposedResults ?? [])
            .filter((item) => {
              if (
                item.recipientId !== this.observerId ||
                item.actorId !== this.observerId ||
                !resultTypes.has(item.type) ||
                typeof item.accepted !== "boolean" ||
                !Number.isSafeInteger(item.sequence) ||
                item.sequence < 0 ||
                !Number.isSafeInteger(item.tick) ||
                item.tick < 0 ||
                item.tick > data.tick ||
                !publicId(item.requestId) ||
                !politicalReason.has(item.reason) ||
                item.accepted !== (item.reason === "accepted")
              )
                return false;
              if (item.type === "national_found_empire")
                return publicId(item.empireId);
              if (item.type === "national_declare_war")
                return (
                  /^[A-Za-z0-9_-]{1,128}$/.test(item.requestId) &&
                  (item.accepted
                    ? publicId(item.warId) && item.motionId === undefined
                    : item.warId === undefined && item.motionId === undefined)
                );
              if (
                item.type === "national_propose_peace" ||
                item.type === "national_accept_peace"
              )
                return (
                  /^[A-Za-z0-9_-]{1,128}$/.test(item.requestId) &&
                  (item.accepted
                    ? publicId(item.warId) && publicId(item.motionId)
                    : item.warId === undefined && item.motionId === undefined)
                );
              return publicId(item.commandTargetId);
            })
            .map((item) => ({
              // A second explicit DTO whitelist; never spread the engine
              // journal (which could hold fingerprints, troops or secrets).
              recipientId: item.recipientId,
              actorId: item.actorId,
              type: item.type,
              accepted: item.accepted,
              tick: item.tick,
              sequence: item.sequence,
              requestId: item.requestId,
              reason: item.reason,
              ...(item.type === "national_found_empire"
                ? { empireId: item.empireId }
                : item.type === "national_declare_war" ||
                    item.type === "national_propose_peace" ||
                    item.type === "national_accept_peace"
                  ? {
                      ...(item.warId === undefined
                        ? {}
                        : { warId: item.warId }),
                      ...(item.motionId === undefined
                        ? {}
                        : { motionId: item.motionId }),
                    }
                  : { commandTargetId: item.commandTargetId }),
            }));

    const publicPoliticalView = publicPolitics(data);
    const publicConflictView = projectNationalPublicConflict(
      game,
      this.observerId,
      data.tick,
    );
    const privateAccessionOffers = projectNationalAccessionOffers(
      game,
      this.observerId,
    );
    // This is a strict packet whitelist, not a shallow spread that could
    // accidentally copy a newly introduced sensitive packed field.
    return {
      ...(recipientResults.length
        ? { nationalCommandResults: recipientResults }
        : {}),
      // E1's public detached DTO is allowed to every honest-client NATIONAL
      // viewer, including reconnect. It must never be synthesized from
      // outbound private PlayerUpdate fields.
      ...(publicPoliticalView === undefined
        ? {}
        : { nationalPolitics: publicPoliticalView }),
      ...(publicConflictView === undefined
        ? {}
        : { nationalConflicts: publicConflictView }),
      ...(privateAccessionOffers === undefined
        ? {}
        : { nationalAccessionOffers: privateAccessionOffers }),
      tick: data.tick,
      updates,
      packedTileUpdates: new Uint32Array(packedTile),
      ...(packedPlayer.length
        ? {
            packedPlayerUpdates: new Float64Array(packedPlayer),
          }
        : {}),
      ...(packed ? { packedUnitUpdates: packed.packedUnitUpdates } : {}),
      ...(packed && packed.packedMissileTimers.length
        ? { packedMissileTimers: packed.packedMissileTimers }
        : {}),
      ...(playerNameViewData ? { playerNameViewData } : {}),
      tickExecutionDuration: data.tickExecutionDuration,
      pendingTurns: data.pendingTurns,
    } as GameUpdateViewData;
  }
}
