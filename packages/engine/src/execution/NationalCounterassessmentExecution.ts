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

export class NationalCounterassessmentExecution implements Execution {
  private active = true;
  private game: Game | null = null;
  constructor(
    private actor: Player,
    private requestId: string,
    private authenticatedClientID: ClientID,
  ) {}
  init(game: Game): void {
    this.game = game;
  }
  tick(): void {
    this.active = false;
    if (this.game === null)
      throw new Error("NATIONAL counterassessment execution not initialized");
    try {
      this.game.performNationalCounterassessment(
        this.actor,
        this.requestId,
        this.authenticatedClientID,
      );
    } catch {
      console.warn("NATIONAL counterassessment rejected");
    }
  }
  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  snapshot(w: SnapshotWriter): ExecRecord {
    return NationalCounterassessmentExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      actor: w.player(this.actor),
      requestId: this.requestId,
      authenticatedClientID: this.authenticatedClientID,
    });
  }
  restoreSnapshot(
    s: NationalCounterassessmentExecutionState,
    r: SnapshotReader,
  ): void {
    this.active = s.active;
    this.game = s.initialized ? r.game : null;
    this.actor = r.player(s.actor);
    this.requestId = s.requestId;
    this.authenticatedClientID = s.authenticatedClientID;
  }
}
const NationalCounterassessmentExecutionStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  actor: zPlayerRef(),
  requestId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  authenticatedClientID: z.string().min(1).max(256),
});
type NationalCounterassessmentExecutionState = z.infer<
  typeof NationalCounterassessmentExecutionStateSchema
>;
export const NationalCounterassessmentExecutionSnapshot = execSnapshotType({
  name: "NationalCounterassessment",
  version: 1,
  schema: NationalCounterassessmentExecutionStateSchema,
  cls: () => NationalCounterassessmentExecution,
});
