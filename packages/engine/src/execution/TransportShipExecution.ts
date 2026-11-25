import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  MessageType,
  PlayerType,
  TerraNullius,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { renderTroops } from "@openfront/engine-lib/Format";
import { MotionPlanRecord } from "@openfront/engine-lib/game/MotionPlans";
import {
  zInt,
  zNum,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { targetTransportTile } from "../game/TransportShipUtils";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import {
  restoreWaterPathFinder,
  WaterPathFinderSchema,
  waterPathFinderState,
} from "../snapshot/PathfinderSnapshots";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { AttackExecution } from "./AttackExecution";
import { authorizeNationalAttack } from "./NationalWarExecution";

const malusForRetreat = 25;

export class TransportShipExecution implements Execution {
  private active = true;

  // TODO: make this configurable
  private ticksPerMove = 1;
  private lastMove: number;

  private mg: Game;
  private target: Player | TerraNullius;
  private pathFinder: WaterPathFinder;

  private dst: TileRef | null;
  private src: TileRef | null;
  private retreatDst: TileRef | false | null = null;
  private boat: Unit;
  private motionPlanId = 1;
  private motionPlanDst: TileRef | null = null;
  /** WAR-11: peace landing is committed at most once; survivors sail home. */
  private peaceReturn = false;

  private originalOwner: Player;

  constructor(
    private attacker: Player,
    private ref: TileRef,
    private troops: number,
  ) {
    this.originalOwner = this.attacker;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  /** Atomic command-time launch: validate the real voyage, debit the pool,
   * and embark before acknowledging. The ordinary execution then owns the
   * paid vessel, including snapshot, combat, peace return and dissolution. */
  static launchImperial(
    mg: Game,
    member: Player,
    ref: TileRef,
    troops: number,
    fund: () => void,
  ): void {
    const execution = new TransportShipExecution(member, ref, troops);
    execution.init(mg, mg.ticks(), fund);
    if (!execution.active || !execution.boat)
      throw new Error("NATIONAL: no lawful imperial transport route");
    mg.addExecution(execution);
  }

  init(mg: Game, ticks: number, fund?: () => void) {
    // A command-time launch is already initialized when the scheduler admits
    // it. This also handles a snapshot taken between admission and that tick.
    if (this.boat !== undefined) return;
    // Do not allow a subordinate to bypass central military control by sea.
    // Boats that already launched keep their existing, paid in-flight state.
    const military = mg.nationalImperialAdministrationFor(this.attacker);
    if (!fund && military?.armyMode === "centralized" && !military.canAmend) {
      this.active = false;
      return;
    }
    if (!mg.isValidRef(this.ref)) {
      console.warn(`TransportShipExecution: ref ${this.ref} not valid`);
      this.active = false;
      return;
    }

    this.lastMove = ticks;
    this.mg = mg;
    this.target = mg.owner(this.ref);
    const stagger = fund ? 0 : mg.nextShipStagger("transportShip");
    this.pathFinder = new WaterPathFinder(mg, stagger);

    if (
      this.attacker.unitCount(UnitType.TransportShip) >=
      mg.config().boatMaxNumber()
    ) {
      mg.displayMessage(
        "events_display.no_boats_available",
        MessageType.ATTACK_FAILED,
        this.attacker.id(),
        undefined,
        { max: mg.config().boatMaxNumber() },
      );
      this.active = false;
      return;
    }

    // The naval voyage is a new offensive action at departure. Reject an
    // undeclared or post-peace launch BEFORE building a ship or spending troops.
    // Once built, the vessel has a separately grandfathered landing rule.
    if (
      mg.nationalPoliticalAuthority() !== null &&
      (!mg.hasPlayer(this.attacker.id()) ||
        mg.player(this.attacker.id()) !== this.attacker ||
        !this.attacker.isAlive() ||
        !authorizeNationalAttack(
          mg,
          this.attacker.id(),
          this.target.isPlayer() ? this.target.id() : null,
        ))
    ) {
      this.active = false;
      return;
    }

    if (this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (
        targetPlayer.type() !== PlayerType.Bot &&
        this.attacker.type() !== PlayerType.Bot
      ) {
        if (!fund) this.rejectIncomingAllianceRequests(targetPlayer);
      }
    }

    if (this.target === this.attacker) {
      this.active = false;
      return;
    }

    if (this.target.isPlayer() && !this.attacker.canAttackPlayer(this.target)) {
      this.active = false;
      return;
    }

    this.troops ??= this.mg
      .config()
      .boatAttackAmount(this.attacker, this.target);
    if (!fund) this.troops = Math.min(this.troops, this.attacker.troops());
    if (
      mg.nationalPoliticalAuthority() !== null &&
      (!Number.isFinite(this.troops) || this.troops < 1)
    ) {
      this.active = false;
      return;
    }
    if (mg.nationalPoliticalAuthority() !== null)
      this.troops = Math.floor(this.troops);

    this.dst = targetTransportTile(this.mg, this.attacker, this.ref);

    if (this.dst === null) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find target tile`,
      );
      this.active = false;
      return;
    }

    const src = this.attacker.canBuild(UnitType.TransportShip, this.dst);

    if (src === false) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find start tile`,
      );
      this.active = false;
      return;
    }

    this.src = src;
    // A pooled order never debits reserves for a disconnected/failed route.
    // The ordinary FFA fallback remains unchanged.
    const preflightPath = fund ? this.pathFinder.findPath(src, this.dst) : null;
    if (fund && (!preflightPath || preflightPath.length === 0)) {
      this.active = false;
      return;
    }
    fund?.();
    if (fund) this.pathFinder = new WaterPathFinder(mg, mg.nextShipStagger("transportShip"));
    if (
      fund &&
      this.target.isPlayer() &&
      this.target.type() !== PlayerType.Bot &&
      this.attacker.type() !== PlayerType.Bot
    )
      this.rejectIncomingAllianceRequests(this.target);

    this.boat = this.attacker.buildUnit(UnitType.TransportShip, this.src, {
      troops: this.troops,
      targetTile: this.dst,
    });

    const fullPath = preflightPath ??
      this.pathFinder.findPath(this.src, this.dst) ?? [this.src];
    if (fullPath.length === 0 || fullPath[0] !== this.src) {
      fullPath.unshift(this.src);
    }

    const motionPlan: MotionPlanRecord = {
      kind: "grid",
      unitId: this.boat.id(),
      planId: this.motionPlanId,
      startTick: ticks + this.ticksPerMove,
      ticksPerStep: this.ticksPerMove,
      path: fullPath,
    };
    this.mg.recordMotionPlan(motionPlan);
    this.motionPlanDst = this.dst;

    // Notify the target player about the incoming naval invasion
    if (this.target.isPlayer()) {
      mg.displayIncomingUnit(
        this.boat.id(),
        "events_display.naval_invasion_inbound",
        MessageType.NAVAL_INVASION_INBOUND,
        this.target.id(),
      );
    }

    // Record stats
    this.mg
      .stats()
      .boatSendTroops(this.attacker, this.target, this.boat.troops());
  }

  tick(ticks: number) {
    if (this.dst === null) {
      this.active = false;
      return;
    }
    if (!this.active) {
      return;
    }
    if (!this.boat.isActive()) {
      this.active = false;
      return;
    }
    if (ticks - this.lastMove < this.ticksPerMove) {
      return;
    }
    this.lastMove = ticks;

    // Team mate can conquer disconnected player and get their ships
    // captureUnit has changed the owner of the unit, now update attacker
    const boatOwner = this.boat.owner();
    if (
      this.originalOwner.isDisconnected() &&
      boatOwner !== this.originalOwner &&
      boatOwner.isOnSameTeam(this.originalOwner)
    ) {
      this.attacker = boatOwner;
      this.originalOwner = boatOwner; // for when this owner disconnects too
    }

    if (this.pathFinder.rebuilt) {
      this.motionPlanDst = null; // Force motion plan re-recording
    }

    // Auto-retreat if destination was destroyed by nuke (turned to water)
    // Checked every tick (not just on graph rebuild) because graph rebuilds
    // are throttled and the tile may already be water before the version bumps.
    if (this.dst !== null && this.mg.isWater(this.dst)) {
      if (!this.boat.transportShipState().isRetreating) {
        this.boat.updateTransportShipState({ isRetreating: true });
      }
      // Reset cached retreat destination so it's recomputed from current position
      this.retreatDst = null;
    }

    if (this.boat.transportShipState().isRetreating) {
      // Resolve retreat destination once, based on current boat location when retreat begins.
      this.retreatDst ??= this.attacker.bestTransportShipSpawn(
        this.boat.tile(),
      );

      if (this.retreatDst === false) {
        console.warn(
          `TransportShipExecution: retreating but no retreat destination found`,
        );
        this.attacker.addTroops(this.boat.troops());
        this.boat.delete(false);
        this.active = false;
        return;
      } else {
        this.dst = this.retreatDst;

        if (this.boat.targetTile() !== this.dst) {
          this.boat.setTargetTile(this.dst);
        }
      }
    }

    const result = this.pathFinder.next(this.boat.tile(), this.dst);
    switch (result.status) {
      case PathStatus.COMPLETE: {
        if (this.mg.owner(this.dst) === this.attacker) {
          // A peace-forced return is not a player's costly tactical retreat.
          const deaths = this.peaceReturn
            ? 0
            : this.boat.troops() * (malusForRetreat / 100);
          const survivors = this.boat.troops() - deaths;
          this.attacker.addTroops(survivors);
          this.boat.delete(false);
          this.active = false;

          // Record stats
          this.mg
            .stats()
            .boatArriveTroops(this.attacker, this.target, survivors);
          if (deaths) {
            this.mg.displayMessage(
              "events_display.attack_cancelled_retreat",
              MessageType.ATTACK_CANCELLED,
              this.attacker.id(),
              undefined,
              { troops: renderTroops(deaths) },
            );
          }
          return;
        }
        // WAR-11: a vessel launched while at war may finish its committed
        // journey after peace, seize at most its initial landing tile, then
        // return the remaining troops by sea. No inland AttackExecution is
        // created and no second levy/hostility is accidentally triggered.
        // Also refuse to seize a third party's newly owned landing tile when
        // no applicable war authorizes it.
        const landingOwner = this.mg.owner(this.dst);
        const nationalMode = this.mg.nationalPoliticalAuthority() !== null;
        const originalTargetAtWar =
          this.target.isPlayer() &&
          authorizeNationalAttack(
            this.mg,
            this.attacker.id(),
            this.target.id(),
          );
        const thirdPartyProtected =
          nationalMode &&
          landingOwner.isPlayer() &&
          landingOwner !== this.target &&
          !authorizeNationalAttack(
            this.mg,
            this.attacker.id(),
            landingOwner.id(),
          );
        if (
          nationalMode &&
          (thirdPartyProtected ||
            (this.target.isPlayer() && !originalTargetAtWar))
        ) {
          if (
            !thirdPartyProtected &&
            landingOwner === this.target &&
            this.target.isPlayer() &&
            !this.attacker.isFriendly(this.target)
          ) {
            this.attacker.conquer(this.dst);
          }
          this.peaceReturn = true;
          this.boat.updateTransportShipState({ isRetreating: true });
          this.retreatDst = null;
          return;
        }
        this.attacker.conquer(this.dst);
        if (this.target.isPlayer() && this.attacker.isFriendly(this.target)) {
          this.attacker.addTroops(this.boat.troops());
        } else {
          this.mg.addExecution(
            new AttackExecution(
              this.boat.troops(),
              this.attacker,
              this.target.id(),
              this.dst,
              false,
            ),
          );
        }
        this.boat.delete(false);
        this.active = false;

        // Record stats
        this.mg
          .stats()
          .boatArriveTroops(this.attacker, this.target, this.boat.troops());
        return;
      }
      case PathStatus.NEXT:
        this.boat.move(result.node);
        break;
      case PathStatus.NOT_FOUND: {
        // TODO: add to poisoned port list
        const map = this.mg.map();
        const boatTile = this.boat.tile();
        console.warn(
          `TransportShip path not found: boat@(${map.x(boatTile)},${map.y(boatTile)}) -> dst@(${map.x(this.dst)},${map.y(this.dst)}), attacker=${this.attacker.id()}, target=${this.target.id()}`,
        );
        this.attacker.addTroops(this.boat.troops());
        this.boat.delete(false);
        this.active = false;
        return;
      }
    }

    if (this.dst !== null && this.dst !== this.motionPlanDst) {
      this.motionPlanId++;
      const fullPath = this.pathFinder.findPath(this.boat.tile(), this.dst) ?? [
        this.boat.tile(),
      ];
      if (fullPath.length === 0 || fullPath[0] !== this.boat.tile()) {
        fullPath.unshift(this.boat.tile());
      }

      this.mg.recordMotionPlan({
        kind: "grid",
        unitId: this.boat.id(),
        planId: this.motionPlanId,
        startTick: ticks + this.ticksPerMove,
        ticksPerStep: this.ticksPerMove,
        path: fullPath,
      });
      this.motionPlanDst = this.dst;
    }
  }

  owner(): Player {
    return this.attacker;
  }

  isActive(): boolean {
    return this.active;
  }

  private rejectIncomingAllianceRequests(target: Player) {
    const request = this.attacker
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === target);
    if (request !== undefined) {
      request.reject();
    }
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    // Fields init() leaves unset on an early return are stored as undefined.
    return TransportShipExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      ticksPerMove: this.ticksPerMove,
      lastMove: this.lastMove,
      target: this.target === undefined ? undefined : w.owner(this.target),
      pathFinder:
        this.pathFinder === undefined
          ? undefined
          : waterPathFinderState(this.pathFinder),
      dst: this.dst,
      src: this.src,
      retreatDst: this.retreatDst,
      boat: this.boat === undefined ? undefined : w.unit(this.boat),
      motionPlanId: this.motionPlanId,
      motionPlanDst: this.motionPlanDst,
      peaceReturn: this.peaceReturn,
      originalOwner: w.player(this.originalOwner),
      attacker: w.player(this.attacker),
      ref: this.ref,
      troops: this.troops,
    });
  }

  restoreSnapshot(s: TransportShipExecutionState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.ticksPerMove = s.ticksPerMove;
    if (s.lastMove !== undefined) this.lastMove = s.lastMove;
    if (s.target !== undefined) this.target = r.owner(s.target);
    if (s.pathFinder !== undefined) {
      this.pathFinder = restoreWaterPathFinder(r.game, s.pathFinder);
    }
    if (s.dst !== undefined) this.dst = s.dst;
    if (s.src !== undefined) this.src = s.src;
    this.retreatDst = s.retreatDst;
    if (s.boat !== undefined) this.boat = r.unit(s.boat);
    this.motionPlanId = s.motionPlanId;
    this.motionPlanDst = s.motionPlanDst;
    this.peaceReturn = s.peaceReturn ?? false;
    this.originalOwner = r.player(s.originalOwner);
    this.attacker = r.player(s.attacker);
    this.ref = s.ref;
    this.troops = s.troops;
  }
}

const TransportShipExecutionStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  ticksPerMove: zInt(),
  lastMove: zInt().optional(),
  target: zPlayerRef().optional(),
  pathFinder: WaterPathFinderSchema.optional(),
  dst: zTile().nullable().optional(),
  src: zTile().nullable().optional(),
  /** Unresolved (null), none found (false), or the retreat tile. */
  retreatDst: z.union([zTile(), z.literal(false)]).nullable(),
  boat: zRef().optional(),
  motionPlanId: zInt(),
  motionPlanDst: zTile().nullable(),
  /** Optional so older snapshots restore to the original pre-peace behavior. */
  peaceReturn: z.boolean().optional(),
  originalOwner: zPlayerRef(),
  attacker: zPlayerRef(),
  // Unvalidated until init() checks it.
  ref: zInt(),
  troops: zNum(),
});
type TransportShipExecutionState = z.infer<
  typeof TransportShipExecutionStateSchema
>;

export const TransportShipExecutionSnapshot = execSnapshotType({
  name: "TransportShip",
  version: 1,
  schema: TransportShipExecutionStateSchema,
  cls: () => TransportShipExecution,
});
