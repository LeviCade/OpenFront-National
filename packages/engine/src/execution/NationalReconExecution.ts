import type { ClientID } from "@openfront/engine-api/Schemas";
import type { NationalSatelliteAdmission } from "@openfront/engine-api/game/NationalSatelliteView";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import type { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * A stamped human intent, NOT a free-form scouting permission. Actor comes
 * from Executor's real clientID mapping and GameImpl rechecks that exact
 * original session when executing, including after a queued-turn restore.
 */
export class NationalReconExecution implements Execution {
  private active = true;
  private game: Game | null = null;

  constructor(
    private actor: Player,
    private targetId: string,
    private centerX: number,
    private centerY: number,
    private requestId: string,
    private authenticatedClientID: ClientID,
    private satelliteAdmission?: NationalSatelliteAdmission,
  ) {}

  init(game: Game): void {
    this.game = game;
  }

  tick(): void {
    this.active = false;
    if (this.game === null)
      throw new Error("NATIONAL recon execution not initialized");
    try {
      if (this.satelliteAdmission !== undefined) {
        this.game.performNationalSatellite(
          this.actor,
          this.requestId,
          this.satelliteAdmission,
          this.authenticatedClientID,
        );
        return;
      }
      this.game.performNationalReconnaissance(
        this.actor,
        this.targetId,
        this.centerX,
        this.centerY,
        this.requestId,
        this.authenticatedClientID,
      );
    } catch (error) {
      // Gameplay rejection, never a fatal worker failure or secret packet.
      console.warn("NATIONAL reconnaissance rejected:", String(error));
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return NationalReconExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      actor: w.player(this.actor),
      targetId: this.targetId,
      centerX: this.centerX,
      centerY: this.centerY,
      requestId: this.requestId,
      authenticatedClientID: this.authenticatedClientID,
      ...(this.satelliteAdmission === undefined
        ? {}
        : { satelliteAdmission: this.satelliteAdmission }),
    });
  }

  restoreSnapshot(s: NationalReconExecutionState, r: SnapshotReader): void {
    this.active = s.active;
    this.game = s.initialized ? r.game : null;
    this.actor = r.player(s.actor);
    this.targetId = s.targetId;
    this.centerX = s.centerX;
    this.centerY = s.centerY;
    this.requestId = s.requestId;
    this.authenticatedClientID = s.authenticatedClientID;
    this.satelliteAdmission = s.satelliteAdmission;
  }
}

const NationalReconExecutionStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  actor: zPlayerRef(),
  targetId: z.string().min(1).max(256),
  centerX: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  centerY: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  requestId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  authenticatedClientID: z.string().min(1).max(256),
  satelliteAdmission: z
    .object({
      issuedTick: z.number().int().nonnegative().max(0xffffffff),
      empireId: z.string().min(1).max(256).nullable(),
      policyVersion: z.number().int().nonnegative().nullable(),
    })
    .optional(),
});
type NationalReconExecutionState = z.infer<
  typeof NationalReconExecutionStateSchema
>;

export const NationalReconExecutionSnapshot = execSnapshotType({
  name: "NationalRecon",
  version: 1,
  schema: NationalReconExecutionStateSchema,
  cls: () => NationalReconExecution,
});
