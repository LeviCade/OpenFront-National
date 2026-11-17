import type { GameUpdates } from "@openfront/engine-api/game/GameTypes";
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
import {
  packUnitUpdates,
  unpackUnitUpdates,
} from "@openfront/engine-lib/game/PackedUnitUpdates";
import type { Game } from "../../game/Game";
import type { LiveNationalObservation } from "./LiveObservation";
import {
  advanceLastKnown,
  type NationalSightMemory,
} from "./NationalObservation";
import type { OutboundFounderResult } from "./NationalPoliticalPacket";

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
      if (!visibleTiles.has(tile)) continue;
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
    const orderedVisible = [...visibleAssetIds].sort((a, b) => a - b);
    for (const id of orderedVisible) {
      const unit = game.unit(id);
      if (!unit) continue;
      const raw =
        rawUnits.get(id) ??
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
      this.previousUnits.set(id, outgoing);
    }

    // Revoke sight using the LAST VISIBLE position, never the now-hidden
    // authoritative position/strength. A loss of empire membership is
    // reflected immediately by absence from the fresh verified sight set.
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
      data as GameUpdateViewData & {
        nationalCommandResults?: readonly OutboundFounderResult[];
      }
    ).nationalCommandResults;
    // A second independent scope check prevents an accidental caller from
    // attaching the E1 journal for another actor to this viewer's packet.
    const recipientResults =
      this.observerId === null
        ? []
        : (proposedResults ?? []).filter(
            (item) =>
              item.recipientId === this.observerId &&
              item.actorId === this.observerId,
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
      ...("nationalPolitics" in data && data.nationalPolitics !== null
        ? { nationalPolitics: data.nationalPolitics }
        : {}),
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
    };
  }
}
