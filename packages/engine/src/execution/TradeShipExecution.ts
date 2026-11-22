import { TileRef } from "@openfront/engine-api/game/GameMap";
import { MessageType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { findClosestBy } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import {
  nearestReturnPort,
  neutralBlockader,
} from "../national/conflict/NationalMaritime";
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

import { NationalSanctionExecution } from "./NationalSanctionExecution";

export class TradeShipExecution implements Execution {
  private active = true;
  private mg: Game;
  private tradeShip: Unit | undefined;
  private wasCaptured = false;
  // A failed neutral journey remains revenue-ineligible even after peace.
  private returningHome = false;
  private failedReturnPorts: number[] = [];
  private pathFinder: WaterPathFinder;
  private tilesTraveled = 0;
  private motionPlanId = 1;
  private motionPlanDst: TileRef | null = null;

  constructor(
    private origOwner: Player,
    private srcPort: Unit,
    private _dstPort: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const stagger = mg.nextShipStagger("tradeShip");
    this.pathFinder = new WaterPathFinder(mg, stagger, true); // memoized: port tile to port tile repeats
  }

  tick(ticks: number): void {
    if (this.pathFinder.rebuilt) {
      this.motionPlanDst = null; // Force motion plan re-recording
    }

    if (this.tradeShip === undefined) {
      if (
        this.mg.nationalWarAuthority() !== null &&
        (!this.srcPort.isActive() ||
          this.srcPort.isMarkedForDeletion() ||
          this.srcPort.isUnderConstruction() ||
          this.srcPort.owner() !== this.origOwner ||
          !this._dstPort.isActive() ||
          this._dstPort.isMarkedForDeletion() ||
          this._dstPort.isUnderConstruction() ||
          !this.origOwner.canTrade(this._dstPort.owner()))
      ) {
        this.active = false;
        return;
      }
      const spawn = this.origOwner.canBuild(
        UnitType.TradeShip,
        this.srcPort.tile(),
      );
      if (spawn === false) {
        console.warn(`cannot build trade ship`);
        this.active = false;
        return;
      }
      this.tradeShip = this.origOwner.buildUnit(UnitType.TradeShip, spawn, {
        targetUnit: this._dstPort,
        lastSetSafeFromPirates: ticks,
      });
      this.mg.stats().boatSendTrade(this.origOwner, this._dstPort.owner());
    }

    if (!this.tradeShip.isActive()) {
      this.active = false;
      return;
    }

    const national = this.mg.nationalWarAuthority() !== null;
    const tradeShipOwner = this.tradeShip.owner();
    const dstPortOwner = this._dstPort.owner();
    if (this.wasCaptured !== true && this.origOwner !== tradeShipOwner) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
      this.mg.displayMessage(
        "events_display.trade_ship_captured",
        MessageType.UNIT_DESTROYED,
        this.origOwner.id(),
        undefined,
        { name: tradeShipOwner.displayName() },
        this.tradeShip.id(),
        tradeShipOwner.id(),
      );
    }

    // Legacy capture logic remains unchanged. In NATIONAL, losing the home
    // port cancels a commercial voyage but lets the existing hull return
    // via another eligible owned port instead of paying its new owner.
    if (
      national &&
      !this.returningHome &&
      !this.wasCaptured &&
      (!this.srcPort.isActive() ||
        this.srcPort.isMarkedForDeletion() ||
        this.srcPort.isUnderConstruction() ||
        this.srcPort.owner() !== this.origOwner)
    ) {
      this.returningHome = true;
      if (!this.chooseReturnPort()) return;
    }
    if (
      !this.returningHome &&
      (!national || !this.wasCaptured) &&
      dstPortOwner.id() === this.srcPort.owner().id()
    ) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (
      !this.returningHome &&
      !this.wasCaptured &&
      (!this._dstPort.isActive() ||
        (national &&
          (this._dstPort.isMarkedForDeletion() ||
            this._dstPort.isUnderConstruction())) ||
        !tradeShipOwner.canTrade(dstPortOwner))
    ) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    const curTile = this.tradeShip.tile();

    if (
      national &&
      !this.returningHome &&
      !this.wasCaptured &&
      neutralBlockader(this.mg, this.tradeShip, this._dstPort)
    ) {
      this.returningHome = true;
      if (!this.chooseReturnPort()) return;
    }

    if (this.returningHome) {
      // Ownership or construction status can change after the interception.
      if (
        this._dstPort.owner() !== tradeShipOwner ||
        !this._dstPort.isActive() ||
        this._dstPort.isMarkedForDeletion() ||
        this._dstPort.isUnderConstruction()
      ) {
        if (!this.chooseReturnPort()) return;
      }
    } else if (
      this.wasCaptured &&
      (tradeShipOwner !== dstPortOwner || !this._dstPort.isActive())
    ) {
      const myComponent = this.mg.getWaterComponent(curTile);
      const nearestPort = findClosestBy(
        tradeShipOwner.units(UnitType.Port),
        (port) => this.mg.manhattanDist(port.tile(), curTile),
        (port) =>
          port.isActive() &&
          !port.isMarkedForDeletion() &&
          !port.isUnderConstruction() &&
          myComponent !== null &&
          this.mg.hasWaterComponent(port.tile(), myComponent),
      );
      if (nearestPort === null) {
        this.tradeShip.delete(false);
        this.active = false;
        return;
      } else {
        this._dstPort = nearestPort;
        this.tradeShip.setTargetUnit(this._dstPort);
        // Plan-driven units don't emit per-tick unit updates, so force a sync for the new target.
        this.tradeShip.touch();
      }
    }

    if (curTile === this.dstPort()) {
      this.complete();
      return;
    }

    const dst = this._dstPort.tile();
    const result = this.pathFinder.next(curTile, dst);

    switch (result.status) {
      case PathStatus.NEXT:
        if (dst !== this.motionPlanDst) {
          this.motionPlanId++;
          const from = result.node;
          const path = this.pathFinder.pathForTraversal(from, dst);

          this.mg.recordMotionPlan({
            kind: "grid",
            unitId: this.tradeShip.id(),
            planId: this.motionPlanId,
            startTick: ticks + 1,
            ticksPerStep: 1,
            path,
          });
          this.motionPlanDst = dst;
        }
        // Update safeFromPirates status
        if (this.mg.isWater(result.node) && this.mg.isShoreline(result.node)) {
          this.tradeShip.setSafeFromPirates();
        }
        this.tradeShip.move(result.node);
        this.tilesTraveled++;
        break;
      case PathStatus.COMPLETE:
        if (this.returningHome && result.node !== dst) {
          this.failedReturnPorts.push(this._dstPort.id());
          this.chooseReturnPort();
          return;
        }
        if (this.returningHome && curTile !== dst) this.tradeShip.move(dst);
        this.complete();
        return;
      case PathStatus.NOT_FOUND:
        if (this.returningHome) {
          // At most one attempt per port ID for this journey; never bounce
          // between unreachable ports or resume the blocked commercial leg.
          this.failedReturnPorts.push(this._dstPort.id());
          this.chooseReturnPort();
          return;
        }
        console.warn("captured trade ship cannot find route");
        if (this.tradeShip.isActive()) {
          this.tradeShip.delete(false);
        }
        this.active = false;
        return;
    }
  }

  private chooseReturnPort(): boolean {
    const port =
      this.failedReturnPorts.length >= 8
        ? undefined
        : nearestReturnPort(this.mg, this.tradeShip!, this.failedReturnPorts);
    if (port === undefined) {
      // OPEN 5: no reachable owned home remains. Retire the voyage without
      // a captor, combat event, refund, or any trade/piracy credit.
      this.tradeShip!.delete(false);
      this.active = false;
      return false;
    }
    this._dstPort = port;
    this.tradeShip!.setTargetUnit(port);
    this.tradeShip!.touch();
    this.pathFinder.invalidate();
    this.motionPlanDst = null;
    return true;
  }

  private complete() {
    this.active = false;
    this.tradeShip!.delete(false);
    if (this.returningHome) return;
    if (
      this.mg.nationalWarAuthority() !== null &&
      !this.wasCaptured &&
      (!this.srcPort.isActive() ||
        this.srcPort.isMarkedForDeletion() ||
        this.srcPort.isUnderConstruction() ||
        this.srcPort.owner() !== this.origOwner ||
        !this._dstPort.isActive() ||
        this._dstPort.isMarkedForDeletion() ||
        this._dstPort.isUnderConstruction() ||
        !this.origOwner.canTrade(this._dstPort.owner()))
    ) {
      return;
    }
    const gold = this.mg
      .config()
      .tradeShipGold(this.tilesTraveled, this.tradeShip!.owner());

    if (this.wasCaptured && this.tradeShip!.owner() === this.origOwner) {
      // Retaken by its original owner: the payout stands, but nobody pirated it.
      this.origOwner.addGold(gold, this._dstPort.tile());
    } else if (this.wasCaptured) {
      this.tradeShip!.owner().addGold(gold, this._dstPort.tile());
      this.tradeShip!.owner().addPiracyGold(gold);
      this.mg.displayMessage(
        "events_display.received_gold_from_captured_ship",
        MessageType.CAPTURED_ENEMY_UNIT,
        this.tradeShip!.owner().id(),
        gold,
        {
          gold: renderNumber(gold),
          name: this.origOwner.displayName(),
        },
        undefined,
        this.origOwner.id(),
      );
      // Record stats
      this.mg
        .stats()
        .boatCapturedTrade(this.tradeShip!.owner(), this.origOwner, gold);
    } else {
      this.srcPort.owner().addGold(gold, this.srcPort.tile());
      this._dstPort.owner().addGold(gold, this._dstPort.tile());
      this.srcPort.owner().addTradeGold(gold);
      this._dstPort.owner().addTradeGold(gold);
      if (gold > 0n) {
        NationalSanctionExecution.paidTrade(
          this.mg,
          this.srcPort.owner(),
          this._dstPort.owner(),
        );
      }
      // Record stats
      this.mg
        .stats()
        .boatArriveTrade(this.srcPort.owner(), this._dstPort.owner(), gold);
    }
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstPort(): TileRef {
    return this._dstPort.tile();
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return TradeShipExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      tradeShip: this.tradeShip === undefined ? null : w.unit(this.tradeShip),
      wasCaptured: this.wasCaptured,
      returningHome: this.returningHome,
      failedReturnPorts: [...this.failedReturnPorts],
      pathFinder:
        this.pathFinder === undefined
          ? null
          : waterPathFinderState(this.pathFinder),
      tilesTraveled: this.tilesTraveled,
      motionPlanId: this.motionPlanId,
      motionPlanDst: this.motionPlanDst,
      origOwner: w.player(this.origOwner),
      srcPort: w.unit(this.srcPort),
      dstPort: w.unit(this._dstPort),
    });
  }

  restoreSnapshot(s: TradeShipExecutionState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.tradeShip = s.tradeShip === null ? undefined : r.unit(s.tradeShip);
    this.wasCaptured = s.wasCaptured;
    this.returningHome = s.returningHome;
    this.failedReturnPorts = [...s.failedReturnPorts];
    if (s.pathFinder !== null) {
      this.pathFinder = restoreWaterPathFinder(r.game, s.pathFinder);
    }
    this.tilesTraveled = s.tilesTraveled;
    this.motionPlanId = s.motionPlanId;
    this.motionPlanDst = s.motionPlanDst;
    this.origOwner = r.player(s.origOwner);
    this.srcPort = r.unit(s.srcPort);
    this._dstPort = r.unit(s.dstPort);
  }
}

const TradeShipExecutionStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  tradeShip: zRef().nullable(),
  wasCaptured: z.boolean(),
  returningHome: z.boolean(),
  failedReturnPorts: z.array(zInt()),
  /** Null before init(). */
  pathFinder: WaterPathFinderSchema.nullable(),
  tilesTraveled: zInt(),
  motionPlanId: zInt(),
  motionPlanDst: zTile().nullable(),
  origOwner: zPlayerRef(),
  srcPort: zRef(),
  dstPort: zRef(),
});
type TradeShipExecutionState = z.infer<typeof TradeShipExecutionStateSchema>;

export const TradeShipExecutionSnapshot = execSnapshotType({
  name: "TradeShip",
  version: 2,
  migrations: {
    1: (data: unknown) => ({
      ...(data as Record<string, unknown>),
      returningHome: false,
      failedReturnPorts: [],
    }),
  },
  schema: TradeShipExecutionStateSchema,
  cls: () => TradeShipExecution,
});
