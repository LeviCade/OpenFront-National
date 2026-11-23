import type { ClientID } from "@openfront/engine-api/Schemas";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import type { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

export class NationalAssessmentExecution implements Execution {
  private active = true;
  private game: Game | null = null;
  constructor(
    private actor: Player,
    private targetId: string,
    private requestId: string,
    private authenticatedClientID: ClientID,
  ) {}
  init(game: Game): void {
    this.game = game;
  }
  tick(): void {
    this.active = false;
    if (this.game === null)
      throw new Error("NATIONAL assessment execution not initialized");
    try {
      this.game.performNationalAssessment(
        this.actor,
        this.targetId,
        this.requestId,
        this.authenticatedClientID,
      );
    } catch {
      console.warn("NATIONAL assessment rejected");
    }
  }
  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  snapshot(w: SnapshotWriter): ExecRecord {
    return NationalAssessmentExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      actor: w.player(this.actor),
      targetId: this.targetId,
      requestId: this.requestId,
      authenticatedClientID: this.authenticatedClientID,
    });
  }
  restoreSnapshot(
    s: NationalAssessmentExecutionState,
    r: SnapshotReader,
  ): void {
    this.active = s.active;
    this.game = s.initialized ? r.game : null;
    this.actor = r.player(s.actor);
    this.targetId = s.targetId;
    this.requestId = s.requestId;
    this.authenticatedClientID = s.authenticatedClientID;
  }
}
const NationalAssessmentExecutionStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  actor: zPlayerRef(),
  targetId: z.string().min(1).max(256),
  requestId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  authenticatedClientID: z.string().min(1).max(256),
});
type NationalAssessmentExecutionState = z.infer<
  typeof NationalAssessmentExecutionStateSchema
>;
export const NationalAssessmentExecutionSnapshot = execSnapshotType({
  name: "NationalAssessment",
  version: 1,
  schema: NationalAssessmentExecutionStateSchema,
  cls: () => NationalAssessmentExecution,
});
