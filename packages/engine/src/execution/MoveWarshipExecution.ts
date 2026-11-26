import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { zNum, zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

export class MoveWarshipExecution implements Execution {
  constructor(
    private owner: Player,
    private unitIds: number[],
    private position: TileRef,
  ) {}

  /** Called only after the imperial administration journal validates the crown. */
  static moveImperialHull(
    mg: Game,
    member: Player,
    unitId: number,
    position: TileRef,
  ): void {
    const hull = mg.unit(unitId);
    if (
      !hull ||
      hull.owner() !== member ||
      hull.type() !== UnitType.Warship ||
      !hull.isActive() ||
      hull.isMarkedForDeletion() ||
      hull.isUnderConstruction() ||
      hull.health() <= 0 ||
      !mg.isWater(hull.tile()) ||
      !mg.isValidRef(position) ||
      !mg.isWater(position)
    )
      throw new Error("NATIONAL: invalid constituent hull or patrol tile");
    const component = mg.getWaterComponent(position);
    if (component === null || !mg.hasWaterComponent(hull.tile(), component))
      throw new Error("NATIONAL: disconnected imperial patrol destination");
    hull.updateWarshipState({ patrolTile: position });
    hull.setTargetTile(undefined);
  }

  init(mg: Game, _ticks: number): void {
    const military = mg.nationalImperialAdministrationFor(this.owner);
    if (military?.armyMode === "centralized" && !military.canAmend) return;
    if (!mg.isValidRef(this.position)) {
      console.warn(`MoveWarshipExecution: position ${this.position} not valid`);
      return;
    }
    // Get water component of new TargetTile for connectivity check
    const newPatrolTileWaterComponent = mg.getWaterComponent(this.position);
    // Cache warship list and build a lookup map — avoids repeated iteration
    const warshipMap = new Map(
      this.owner.units(UnitType.Warship).map((u) => [u.id(), u]),
    );
    // Deduplicate ids so each warship is only moved once
    for (const unitId of new Set(this.unitIds)) {
      const warship = warshipMap.get(unitId);
      if (!warship) {
        console.warn(`MoveWarshipExecution: warship ${unitId} not found`);
        continue;
      }
      if (!warship.isActive()) {
        console.warn(`MoveWarshipExecution: warship ${unitId} is not active`);
        continue;
      }
      // Do not update the warship's patrolTile if it is in a different Water Component
      if (!mg.hasWaterComponent(warship.tile(), newPatrolTileWaterComponent!)) {
        continue;
      }
      warship.updateWarshipState({
        patrolTile: this.position,
      });
      warship.setTargetTile(undefined);
    }
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return MoveWarshipExecutionSnapshot.write({
      owner: w.player(this.owner),
      unitIds: [...this.unitIds],
      position: this.position,
    });
  }

  restoreSnapshot(s: MoveWarshipState, r: SnapshotReader): void {
    this.owner = r.player(s.owner);
    this.unitIds = s.unitIds;
    this.position = s.position;
  }
}

// position is untrusted intent data (validated in init), so any number.
const MoveWarshipStateSchema = z.object({
  owner: zPlayerRef(),
  unitIds: z.array(zNum()),
  position: zNum(),
});
type MoveWarshipState = z.infer<typeof MoveWarshipStateSchema>;

export const MoveWarshipExecutionSnapshot = execSnapshotType({
  name: "MoveWarship",
  version: 1,
  schema: MoveWarshipStateSchema,
  cls: () => MoveWarshipExecution,
});
