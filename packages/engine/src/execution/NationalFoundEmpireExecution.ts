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
 * M0 authenticated NATIONAL command path.
 * Executor looks up actor by server-stamped clientID; a client cannot supply
 * another player's ID in this command. The live game rechecks identity.
 */
export class NationalFoundEmpireExecution implements Execution {
  private active = true;
  private game: Game | null = null;

  constructor(
    private actor: Player,
    private empireId: string,
  ) {}

  init(game: Game): void {
    this.game = game;
  }

  tick(): void {
    this.active = false;
    if (this.game === null) throw new Error("NATIONAL command not initialized");
    try {
      this.game.performNationalCommand(this.actor, {
        kind: "found-empire",
        empireId: this.empireId,
      });
    } catch (err) {
      // A malicious, duplicate or now-illegal command is a deterministic
      // rejection, not a fatal worker crash and never a partial mutation.
      console.warn("NATIONAL political command rejected:", String(err));
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return NationalFoundEmpireExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      actor: w.player(this.actor),
      empireId: this.empireId,
    });
  }

  restoreSnapshot(s: NationalFoundEmpireState, r: SnapshotReader): void {
    this.active = s.active;
    this.game = s.initialized ? r.game : null;
    this.actor = r.player(s.actor);
    this.empireId = s.empireId;
  }
}

const NationalFoundEmpireStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  actor: zPlayerRef(),
  empireId: z.string(),
});
type NationalFoundEmpireState = z.infer<typeof NationalFoundEmpireStateSchema>;

export const NationalFoundEmpireExecutionSnapshot = execSnapshotType({
  name: "NationalFoundEmpire",
  version: 1,
  schema: NationalFoundEmpireStateSchema,
  cls: () => NationalFoundEmpireExecution,
});
