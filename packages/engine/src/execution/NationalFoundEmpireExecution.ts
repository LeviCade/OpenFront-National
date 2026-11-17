import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import type { Execution, Game, Player } from "../game/Game";
import type { NationalCommand } from "../national/NationalRuntime";
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
    /** Optional E1-owned political command; legacy founding remains valid. */
    private politicalCommand: NationalCommand | null = null,
    private requestId: string | null = null,
  ) {}

  init(game: Game): void {
    this.game = game;
  }

  tick(): void {
    this.active = false;
    if (this.game === null) throw new Error("NATIONAL command not initialized");
    try {
      if (
        this.politicalCommand === null ||
        this.politicalCommand.kind === "found-empire"
      ) {
        const result = this.game.performNationalFoundEmpireWithOutcome(
          this.actor,
          this.politicalCommand?.empireId ?? this.empireId,
          this.requestId,
        );
        if (!result.accepted)
          console.warn("NATIONAL founding rejected:", result.reason);
      } else {
        this.game.performNationalCommand(this.actor, this.politicalCommand);
      }
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
      politicalCommand: this.politicalCommand,
      requestId: this.requestId,
    });
  }

  restoreSnapshot(s: NationalFoundEmpireState, r: SnapshotReader): void {
    this.active = s.active;
    this.game = s.initialized ? r.game : null;
    this.actor = r.player(s.actor);
    this.empireId = s.empireId;
    this.politicalCommand = s.politicalCommand;
    this.requestId = s.requestId;
  }
}

const NationalFoundEmpireStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  actor: zPlayerRef(),
  empireId: z.string(),
  politicalCommand: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("found-empire"), empireId: z.string() }),
      z.object({
        kind: z.literal("offer-empire"),
        empireId: z.string(),
        candidateId: z.string(),
      }),
      z.object({
        kind: z.literal("accept-empire"),
        empireId: z.string(),
        candidateId: z.string(),
      }),
      z.object({
        kind: z.literal("transfer-crown"),
        empireId: z.string(),
        successorId: z.string(),
      }),
      z.object({
        kind: z.literal("found-pact"),
        pactId: z.string(),
        name: z.string(),
        pactKind: z.enum(["NAP", "MDA"]),
        terms: z.object({
          admission: z.enum(["leader", "unanimous"]),
          expulsion: z.enum(["leader", "unanimous", "forbidden"]),
        }),
      }),
      z.object({
        kind: z.literal("invite-pact"),
        pactId: z.string(),
        candidateId: z.string(),
      }),
      z.object({ kind: z.literal("accept-pact"), pactId: z.string() }),
      z.object({ kind: z.literal("betray-pact"), pactId: z.string() }),
      z.object({
        kind: z.literal("expel-pact"),
        pactId: z.string(),
        memberId: z.string(),
        approvingIds: z.array(z.string()).optional(),
      }),
    ])
    .nullable(),
  requestId: z.string().min(1).max(256).nullable(),
});
type NationalFoundEmpireState = z.infer<typeof NationalFoundEmpireStateSchema>;

export const NationalFoundEmpireExecutionSnapshot = execSnapshotType({
  name: "NationalFoundEmpire",
  version: 3,
  schema: NationalFoundEmpireStateSchema,
  migrations: {
    1: (old: { empireId: string }) => ({ ...old, politicalCommand: null }),
    2: (old: { politicalCommand: NationalCommand | null }) => ({
      ...old,
      requestId: null,
    }),
  },
  cls: () => NationalFoundEmpireExecution,
});
