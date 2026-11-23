import { GameType, PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  type ClientID,
  NationalIssueUltimatumIntentSchema,
  NationalRespondUltimatumIntentSchema,
  NationalResolveUltimatumIntentSchema,
} from "@openfront/engine-api/Schemas";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import type { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

const commandSchema = z.discriminatedUnion("type", [
  NationalIssueUltimatumIntentSchema,
  NationalRespondUltimatumIntentSchema,
  NationalResolveUltimatumIntentSchema,
]);
type Command = z.infer<typeof commandSchema>;
const phaseSchema = z.enum([
  "pending",
  "consented",
  "decision-required",
  "acceded",
  "enforced",
  "backed-down",
  "withdrawn",
  "expired",
]);
const recordSchema = z.object({
  id: z.string(),
  issuer: z.string(),
  empire: z.string(),
  target: z.string(),
  threat: z.enum(["embargo", "imperial-war"]),
  issuedTick: z.number().int().nonnegative(),
  // Crown WAR-policy epoch changes on succession and authority revocation.
  authorityVersion: z.number().int().nonnegative(),
  deadline: z.number().int().nonnegative(),
  phase: phaseSchema,
  response: z.enum(["none", "accept", "refuse"]),
  version: z.number().int().positive(),
  credibility: z.enum(["pending", "kept", "broken", "void"]),
  actions: z
    .array(z.object({ actorId: z.string(), requestId: z.string() }))
    .max(64),
  imposedMembers: z.array(z.string()),
  warId: z.string().nullable(),
});
type Record = z.infer<typeof recordSchema>;
const stateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  actor: zPlayerRef(),
  command: commandSchema,
  clientId: z.string().nullable(),
  admissionEmpire: z.string().nullable(),
  admissionPolicyVersion: z.number().int().nonnegative().nullable(),
  record: recordSchema.nullable(),
});
type State = z.infer<typeof stateSchema>;

const MAX_RECORDS = 128;
const MAX_PER_EMPIRE = 16;
const RESOLVE_TICKS = 300;

function living(game: Game, id: string): Player | null {
  if (!game.hasPlayer(id)) return null;
  const player = game.player(id);
  return player.isAlive() && player.hasSpawned() ? player : null;
}

function authentic(
  game: Game,
  actor: Player,
  clientId: ClientID | null,
): boolean {
  if (
    game.nationalWarAuthority() === null ||
    game.inSpawnPhase() ||
    living(game, actor.id()) !== actor
  )
    return false;
  if (clientId !== null)
    return (
      actor.type() === PlayerType.Human &&
      actor.clientID() === clientId &&
      game.playerByClientID(clientId) === actor
    );
  return (
    actor.type() !== PlayerType.Human ||
    game.config().gameConfig().gameType !== GameType.Private
  );
}

/** A demand records choice but creates no autonomous war, treaty, currency or accession. */
export class NationalUltimatumExecution implements Execution {
  private active = true;
  private game: Game | null = null;
  private record: Record | null = null;
  private admissionEmpire: string | null = null;
  private admissionPolicyVersion: number | null = null;

  constructor(
    private actor: Player,
    private command: Command,
    private clientId: ClientID | null = null,
  ) {}

  init(game: Game): void {
    this.game = game;
    const politics = game.nationalPoliticalAuthority();
    this.admissionEmpire = politics?.empireOf(this.actor.id()) ?? null;
    this.admissionPolicyVersion =
      politics?.warPolicyVersionFor(this.actor.id()) ?? null;
  }

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private static records(game: Game): NationalUltimatumExecution[] {
    return game
      .executions()
      .filter(
        (e): e is NationalUltimatumExecution =>
          e instanceof NationalUltimatumExecution && e.record !== null,
      );
  }

  private currentEmperor(): Player | null {
    const game = this.game!;
    const row = this.record!;
    const politics = game.nationalPoliticalAuthority();
    return politics?.emperorOf(row.empire) === row.issuer &&
      politics?.warPolicyVersionFor(row.issuer) === row.authorityVersion
      ? living(game, row.issuer)
      : null;
  }

  private advance(tick: number): void {
    const row = this.record!;
    if (
      ["acceded", "enforced", "backed-down", "withdrawn", "expired"].includes(
        row.phase,
      )
    )
      return;
    const game = this.game!;
    const politics = game.nationalPoliticalAuthority();
    // A crown change invalidates the prior emperor's offer even if the
    // target joins later; stale success must never be resurrected on replay.
    if (
      !this.currentEmperor() ||
      !living(game, row.target) ||
      (politics?.empireOf(row.target) !== null &&
        politics?.empireOf(row.target) !== row.empire)
    ) {
      row.phase = "expired";
      row.credibility = "void";
      row.version++;
      return;
    }
    if (politics?.empireOf(row.target) === row.empire) {
      row.phase = "acceded";
      row.credibility = "kept";
      row.version++;
      return;
    }
    if (
      (row.phase === "pending" || row.phase === "consented") &&
      tick >= row.deadline
    ) {
      row.phase = "decision-required";
      row.version++;
    }
    if (
      row.phase === "decision-required" &&
      tick >= row.deadline + RESOLVE_TICKS
    ) {
      row.phase = "backed-down";
      row.credibility = "broken";
      row.version++;
    }
  }

  private alreadyUsed(game: Game, actorId: string, requestId: string): boolean {
    return NationalUltimatumExecution.records(game).some(
      (e) =>
        (e.actor.id() === actorId && e.command.requestId === requestId) ||
        e.record!.actions.some(
          (action) =>
            action.actorId === actorId && action.requestId === requestId,
        ),
    );
  }

  private issue(
    command: Extract<Command, { type: "national_issue_ultimatum" }>,
    tick: number,
  ): void {
    const game = this.game!;
    const politics = game.nationalPoliticalAuthority();
    if (
      !politics ||
      this.admissionEmpire !== command.empireId ||
      politics.emperorOf(command.empireId) !== this.actor.id() ||
      politics.warPolicyVersionFor(this.actor.id()) !== this.admissionPolicyVersion
    )
      return;
    const target = living(game, command.targetId);
    if (
      !target ||
      target === this.actor ||
      politics.empireOf(target.id()) !== null
    )
      return;
    const records = NationalUltimatumExecution.records(game);
    if (
      records.length >= MAX_RECORDS ||
      records.filter((e) => e.record!.empire === command.empireId).length >=
        MAX_PER_EMPIRE ||
      this.alreadyUsed(game, this.actor.id(), command.requestId)
    )
      return;
    const ordinal = game.executions().indexOf(this);
    if (ordinal < 0) return;
    const id = "ultimatum-" + tick + "-" + this.actor.smallID() + "-" + ordinal;
    if (records.some((e) => e.record!.id === id)) return;
    this.record = {
      id,
      issuer: this.actor.id(),
      empire: command.empireId,
      target: target.id(),
      threat: command.threat,
      issuedTick: tick,
      authorityVersion: this.admissionPolicyVersion!,
      deadline: tick + command.durationTicks,
      phase: "pending",
      response: "none",
      version: 1,
      credibility: "pending",
      actions: [],
      imposedMembers: [],
      warId: null,
    };
    this.active = true;
  }

  private respond(
    actor: Player,
    decision: "accept" | "refuse",
    tick: number,
  ): boolean {
    const row = this.record!;
    const game = this.game!;
    if (
      (row.phase !== "pending" && row.phase !== "consented") ||
      tick >= row.deadline ||
      actor.id() !== row.target ||
      living(game, row.target) !== actor ||
      game.nationalPoliticalAuthority()?.empireOf(actor.id()) !== null ||
      !this.currentEmperor() ||
      row.response === decision
    )
      return false;
    row.response = decision;
    row.phase = decision === "accept" ? "consented" : "decision-required";
    // Two-sided political offer + accept-empire must still execute separately.
    row.version++;
    return true;
  }

  private resolve(
    actor: Player,
    decision: "enforce" | "back-down" | "withdraw",
    tick: number,
    admittedEmpire: string | null,
    admittedPolicyVersion: number | null,
    authenticatedClientId: ClientID | null,
  ): boolean {
    const row = this.record!;
    const game = this.game!;
    if (
      this.currentEmperor() !== actor ||
      admittedEmpire !== row.empire ||
      game.nationalPoliticalAuthority()?.warPolicyVersionFor(actor.id()) !==
        admittedPolicyVersion
    )
      return false;
    if (decision === "withdraw") {
      if (row.phase !== "pending" && row.phase !== "consented") return false;
      row.phase = "withdrawn";
      row.credibility = "broken";
      row.version++;
      return true;
    }
    if (row.phase !== "decision-required") return false;
    if (decision === "back-down") {
      row.phase = "backed-down";
      row.credibility = "broken";
      row.version++;
      return true;
    }
    const target = living(game, row.target);
    if (
      !target ||
      game.nationalPoliticalAuthority()?.empireOf(row.target) !== null
    )
      return false;
    if (row.threat === "embargo") {
      const ids =
        game.nationalPoliticalAuthority()?.membersOf(row.empire) ?? [];
      const members = ids
        .map((id) => living(game, id))
        .filter((p): p is Player => p !== null);
      if (members.length === 0) return false;
      for (const member of members) member.addEmbargo(target, false);
      row.imposedMembers = members.map((m) => m.id());
      row.phase = "enforced";
      row.credibility = "kept";
      row.version++;
      return true;
    }
    // Only the existing sovereign WAR journal/WarLedger may declare hostility.
    const ordinal = game.executions().indexOf(this);
    if (ordinal < 0) return false;
    const id = "ultimatum-war-" + tick + "-" + actor.smallID() + "-" + ordinal;
    try {
      const result = game.performNationalWarCommandWithOutcome(
        actor,
        {
          kind: "declare-imperial",
          warId: id,
          aggressor: { kind: "empire", id: row.empire },
          target: { kind: "nation", id: row.target },
          admissionEmpireId: admittedEmpire,
          policyVersion: admittedPolicyVersion,
        },
        id,
        authenticatedClientId ?? undefined,
      );
      if (
        result.accepted !== true ||
        game.nationalWarAuthority()?.atWar(actor.id(), target.id()) !== true
      ) {
        row.phase = "backed-down";
        row.credibility = "broken";
        row.version++;
        return true;
      }
      row.warId = id;
      row.phase = "enforced";
      row.credibility = "kept";
      row.version++;
      return true;
    } catch {
      row.phase = "backed-down";
      row.credibility = "broken";
      row.version++;
      return true;
    }
  }

  tick(tick: number): void {
    if (this.record !== null) {
      this.advance(tick);
      return;
    }
    this.active = false;
    const game = this.game;
    if (!game || !authentic(game, this.actor, this.clientId)) return;
    const parsed = commandSchema.safeParse(this.command);
    if (!parsed.success) return;
    const command = parsed.data;
    if (command.type === "national_issue_ultimatum") {
      this.issue(command, tick);
      return;
    }
    const owner = NationalUltimatumExecution.records(game).find(
      (e) => e.record!.id === command.ultimatumId,
    );
    if (!owner || owner.alreadyUsed(game, this.actor.id(), command.requestId))
      return;
    owner.advance(tick);
    let accepted = false;
    if (command.type === "national_respond_ultimatum") {
      accepted = owner.respond(this.actor, command.decision, tick);
    } else {
      accepted = owner.resolve(
        this.actor,
        command.decision,
        tick,
        this.admissionEmpire,
        this.admissionPolicyVersion,
        this.clientId,
      );
    }
    if (accepted && owner.record!.actions.length < 64) {
      owner.record!.actions.push({
        actorId: this.actor.id(),
        requestId: command.requestId,
      });
    }
  }

  static stateHash(game: Game): number {
    const records = this.records(game);
    return records.length === 0
      ? 0
      : simpleHash(
          JSON.stringify(
            records.map((e) => ({
              record: e.record,
              issueRequestId: e.command.requestId,
            })),
          ),
        );
  }

  /** Narrow E6 contract: only per-principal terms; never the underlying ledger. */
  static viewFor(
    game: Game,
    observer: Player,
  ): readonly NationalUltimatumObservation[] {
    if (living(game, observer.id()) !== observer) return [];
    return this.records(game).flatMap((e) => {
      const row = e.record!;
      const issuer =
        e.currentEmperor() === observer && row.issuer === observer.id();
      const recipient = row.target === observer.id();
      if (!issuer && !recipient) return [];
      return [
        {
          id: row.id,
          issuerId: row.issuer,
          empireId: row.empire,
          targetId: row.target,
          role: issuer ? ("issuer" as const) : ("recipient" as const),
          threat: row.threat,
          issuedTick: row.issuedTick,
          deadlineTick: row.deadline,
          phase: row.phase,
          response: row.response,
          credibility: row.credibility,
          version: row.version,
          warId: row.warId,
          imposedMembers: issuer ? [...row.imposedMembers] : [],
          requestId:
            issuer &&
            (e.clientId === null || e.clientId === observer.clientID())
              ? e.command.requestId
              : null,
        },
      ];
    });
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return NationalUltimatumExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      actor: w.player(this.actor),
      command: commandSchema.parse(this.command),
      clientId: this.clientId,
      admissionEmpire: this.admissionEmpire,
      admissionPolicyVersion: this.admissionPolicyVersion,
      record: this.record,
    });
  }

  restoreSnapshot(s: State, reader: SnapshotReader): void {
    this.active = s.active;
    this.game = s.initialized ? reader.game : null;
    this.actor = reader.player(s.actor);
    this.command = s.command;
    this.clientId = s.clientId;
    this.admissionEmpire = s.admissionEmpire;
    this.admissionPolicyVersion = s.admissionPolicyVersion;
    this.record = s.record;
  }
}

export interface NationalUltimatumObservation {
  readonly id: string;
  readonly issuerId: string;
  readonly empireId: string;
  readonly targetId: string;
  readonly role: "issuer" | "recipient";
  readonly threat: "embargo" | "imperial-war";
  readonly issuedTick: number;
  readonly deadlineTick: number;
  readonly phase: z.infer<typeof phaseSchema>;
  readonly response: "none" | "accept" | "refuse";
  readonly credibility: "pending" | "kept" | "broken" | "void";
  readonly version: number;
  readonly warId: string | null;
  readonly imposedMembers: readonly string[];
  readonly requestId: string | null;
}

export const NationalUltimatumExecutionSnapshot = execSnapshotType({
  name: "NationalUltimatum",
  version: 1,
  schema: stateSchema,
  cls: () => NationalUltimatumExecution,
});
