import { GameType, PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  type ClientID,
  NationalIssueSanctionIntentSchema,
  NationalRespondSanctionIntentSchema,
  NationalResolveSanctionIntentSchema,
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
  NationalIssueSanctionIntentSchema,
  NationalRespondSanctionIntentSchema,
  NationalResolveSanctionIntentSchema,
]);
type Command = z.infer<typeof commandSchema>;
const phaseSchema = z.enum([
  "pending",
  "decision-required",
  "satisfied",
  "enforced",
  "backed-down",
  "expired",
]);
const recipientSchema = z.object({
  id: z.string(),
  response: z.enum(["none", "comply", "refuse"]),
  noncompliant: z.boolean(),
  // Only actual paid external trade events; no private balance snapshots.
  continuedTrade: z.boolean(),
});
const demandSchema = z.object({
  id: z.string(),
  issuer: z.string(),
  empire: z.string().nullable(),
  target: z.string(),
  recipients: z.array(recipientSchema).min(1).max(16),
  deadline: z.number().int().nonnegative(),
  phase: phaseSchema,
  trigger: z.literal("continuing-trade"),
  threat: z.literal("embargo"),
});
type Demand = z.infer<typeof demandSchema>;
const stateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  actor: zPlayerRef(),
  command: commandSchema,
  clientId: z.string().nullable(),
  demand: demandSchema.nullable(),
});
type State = z.infer<typeof stateSchema>;

// Provisional OPEN 13 tuning, not constitutional law. Retaining terminal
// records prevents duplicate issuance and makes explicit retreat observable.
const MAX_DEMANDS = 128;
const MAX_PER_ISSUER = 16;
const RESOLUTION_WINDOW = 300;

function living(game: Game, id: string): Player | null {
  if (!game.hasPlayer(id)) return null;
  const p = game.player(id);
  return p.isAlive() && p.hasSpawned() ? p : null;
}

export function validEconomicActor(
  game: Game,
  actor: Player,
  clientId: ClientID | null,
): boolean {
  if (
    game.nationalWarAuthority() === null ||
    game.inSpawnPhase() ||
    living(game, actor.id()) !== actor
  ) {
    return false;
  }
  if (clientId !== null) {
    return (
      actor.type() === PlayerType.Human &&
      actor.clientID() === clientId &&
      game.playerByClientID(clientId) === actor
    );
  }
  return (
    actor.type() !== PlayerType.Human ||
    game.config().gameConfig().gameType !== GameType.Private
  );
}

/**
 * Durable demands are active deterministic executions, not a second trade
 * policy ledger: only the real Player.addEmbargo mutates actual permission.
 * Terminal records are bounded and retained for replay/idempotency.
 */
export class NationalSanctionExecution implements Execution {
  private active = true;
  private game: Game | null = null;
  private demand: Demand | null = null;

  constructor(
    private actor: Player,
    private command: Command,
    private clientId: ClientID | null = null,
  ) {}

  init(game: Game): void {
    this.game = game;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private static records(game: Game): NationalSanctionExecution[] {
    return game.executions().filter(
      (e): e is NationalSanctionExecution =>
        e instanceof NationalSanctionExecution && e.demand !== null,
    );
  }

  private controllingIssuer(): Player | null {
    const game = this.game!;
    const d = this.demand!;
    const politics = game.nationalPoliticalAuthority();
    if (!politics) return null;
    if (d.empire !== null) {
      const emperor = politics.emperorOf(d.empire);
      return emperor === null ? null : living(game, emperor);
    }
    return politics.empireOf(d.issuer) === null
      ? living(game, d.issuer)
      : null;
  }

  private recipient(id: string): Player | null {
    // Local responses are independently sovereign only until E1 supplies
    // delegated/centralized trade policy for external imperial demands.
    const game = this.game!;
    return game.nationalPoliticalAuthority()?.empireOf(id) === null
      ? living(game, id)
      : null;
  }

  private advance(tick: number): void {
    const d = this.demand!;
    const game = this.game!;
    if (d.phase !== "pending" && d.phase !== "decision-required") return;
    const issuer = this.controllingIssuer();
    const target = living(game, d.target);
    // Accession, dissolution and elimination cannot produce new internal
    // sanctions or leave an expired issuer with authority.
    if (
      !issuer ||
      !target ||
      issuer === target ||
      (d.empire !== null &&
        game.nationalPoliticalAuthority()?.empireOf(d.target) === d.empire)
    ) {
      d.phase = "expired";
      return;
    }
    if (d.phase === "pending" && tick >= d.deadline) {
      for (const row of d.recipients) {
        const p = this.recipient(row.id);
        row.noncompliant =
          p !== null && (p.canTrade(target) || row.continuedTrade);
      }
      d.phase = d.recipients.some((row) => row.noncompliant)
        ? "decision-required"
        : "satisfied";
    }
    if (d.phase === "decision-required" && tick >= d.deadline + RESOLUTION_WINDOW) {
      d.phase = "expired";
    }
  }

  private issue(command: Extract<Command, { type: "national_issue_sanction" }>, tick: number): void {
    const game = this.game!;
    const politics = game.nationalPoliticalAuthority()!;
    const actor = this.actor.id();
    const empire = politics.empireOf(actor);
    if (
      (command.scope === "national" && empire !== null) ||
      (command.scope === "imperial" &&
        (empire === null || politics.emperorOf(empire) !== actor))
    ) return;
    const target = living(game, command.targetId);
    if (
      !target ||
      target === this.actor ||
      (empire !== null && politics.empireOf(target.id()) === empire)
    ) return;
    const ids = [...new Set(command.recipientIds)].sort();
    if (
      ids.length !== command.recipientIds.length ||
      ids.some((id) =>
        id === actor || id === target.id() ||
        politics.empireOf(id) !== null || living(game, id) === null
      )
    ) return;
    const records = NationalSanctionExecution.records(game);
    const scopeRecords = records.filter((e) =>
      empire !== null ? e.demand!.empire === empire :
        e.demand!.empire === null && e.demand!.issuer === actor
    );
    if (
      records.length >= MAX_DEMANDS ||
      scopeRecords.length >= MAX_PER_ISSUER ||
      records.some((e) =>
        e.actor.id() === actor && e.command.requestId === command.requestId
      )
    ) return;
    const ordinal = game.executions().indexOf(this);
    if (ordinal < 0) return;
    const id = `sanction-${tick}-${this.actor.smallID()}-${ordinal}`;
    if (records.some((e) => e.demand!.id === id)) return;
    this.demand = {
      id,
      issuer: actor,
      empire: command.scope === "imperial" ? empire : null,
      target: target.id(),
      recipients: ids.map((id) => ({
        id,
        response: "none",
        noncompliant: false,
        continuedTrade: false,
      })),
      deadline: tick + command.durationTicks,
      phase: "pending",
      trigger: "continuing-trade",
      threat: "embargo",
    };
    this.active = true;
  }

  private respond(actor: Player, decision: "comply" | "refuse"): void {
    const d = this.demand!;
    if (d.phase !== "pending" || this.recipient(actor.id()) !== actor) return;
    const row = d.recipients.find((r) => r.id === actor.id());
    const target = living(this.game!, d.target);
    if (!row || !target || row.response !== "none") return;
    // Only this recipient's explicit voluntary command changes its policy.
    if (decision === "comply") actor.addEmbargo(target, false);
    row.response = decision;
  }

  private resolve(actor: Player, decision: "enforce" | "back-down"): void {
    const d = this.demand!;
    const game = this.game!;
    if (d.phase !== "decision-required" || this.controllingIssuer() !== actor) return;
    if (decision === "back-down") {
      d.phase = "backed-down";
      return;
    }
    const owners = d.empire === null
      ? [actor]
      : (game.nationalPoliticalAuthority()?.membersOf(d.empire) ?? [])
          .map((id) => living(game, id))
          .filter((p): p is Player => p !== null);
    let imposed = false;
    for (const row of d.recipients) {
      if (!row.noncompliant) continue;
      const recipient = this.recipient(row.id);
      if (!recipient) continue;
      for (const owner of owners) {
        if (owner === recipient) continue;
        owner.addEmbargo(recipient, false);
        imposed = true;
      }
    }
    d.phase = imposed ? "enforced" : "expired";
  }

  tick(tick: number): void {
    if (this.demand !== null) {
      this.advance(tick);
      return;
    }
    this.active = false;
    const game = this.game;
    if (!game || !validEconomicActor(game, this.actor, this.clientId)) return;
    const parsed = commandSchema.safeParse(this.command);
    if (!parsed.success) return;
    const command = parsed.data;
    if (command.type === "national_issue_sanction") {
      this.issue(command, tick);
      return;
    }
    const record = NationalSanctionExecution.records(game).find(
      (e) => e.demand!.id === command.sanctionId,
    );
    if (!record) return;
    record.advance(tick);
    if (command.type === "national_respond_sanction") {
      record.respond(this.actor, command.decision);
    } else {
      record.resolve(this.actor, command.decision);
    }
  }

  /** Canonical demand state participates in NATIONAL replay hash. */
  static stateHash(game: Game): number {
    const records = this.records(game);
    if (records.length === 0) return 0;
    return simpleHash(
      JSON.stringify(
        records.map((e) => ({
          demand: e.demand,
          requestId: e.command.requestId,
        })),
      ),
    );
  }

  /** Host-only read; projection must bind the real authenticated observer. */
  static viewFor(game: Game, observer: Player) {
    if (living(game, observer.id()) !== observer) return [];
    return this.records(game).flatMap((e) => {
      const d = e.demand!;
      const isIssuer = e.controllingIssuer() === observer;
      const own = d.recipients.find((row) => row.id === observer.id());
      if (!isIssuer && (!own || e.recipient(observer.id()) !== observer)) {
        return [];
      }
      return [{
        id: d.id,
        issuer: d.issuer,
        authorityId: e.controllingIssuer()?.id() ?? null,
        empire: d.empire,
        role: isIssuer ? ("issuer" as const) : ("recipient" as const),
        recipientIds: isIssuer
          ? d.recipients.map((row) => row.id)
          : [observer.id()],
        target: d.target,
        deadline: d.deadline,
        phase: d.phase,
        trigger: d.trigger,
        threat: d.threat,
        // Never expose transaction existence or another recipient's response.
        response: own?.response ?? null,
        requestId: isIssuer ? e.command.requestId : null,
      }];
    });
  }

  /** Trusted payout hook: only a real completed external trade event. */
  static paidTrade(game: Game, a: Player, b: Player): void {
    if (game.nationalWarAuthority() === null || a === b) return;
    for (const e of this.records(game)) {
      const d = e.demand!;
      // No grace-period transaction is a violation. Deadline evaluation uses
      // live permission, with actual post-deadline transactions as evidence.
      if (game.ticks() < d.deadline) continue;
      e.advance(game.ticks());
      if (
        (d.phase !== "decision-required" && d.phase !== "satisfied") ||
        game.ticks() >= d.deadline + RESOLUTION_WINDOW
      ) continue;
      const other = d.target === a.id() ? b.id() :
        d.target === b.id() ? a.id() : null;
      const row = d.recipients.find((r) => r.id === other);
      if (row && e.recipient(row.id)) {
        row.continuedTrade = true;
        row.noncompliant = true;
        d.phase = "decision-required";
      }
    }
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return NationalSanctionExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      actor: w.player(this.actor),
      command: commandSchema.parse(this.command),
      clientId: this.clientId,
      demand: this.demand,
    });
  }

  restoreSnapshot(s: State, r: SnapshotReader): void {
    this.active = s.active;
    this.game = s.initialized ? r.game : null;
    this.actor = r.player(s.actor);
    this.command = s.command;
    this.clientId = s.clientId;
    this.demand = s.demand;
  }
}

export type NationalEconomicDemandView = ReturnType<
  typeof NationalSanctionExecution.viewFor
>[number];

export const NationalSanctionExecutionSnapshot = execSnapshotType({
  name: "NationalSanction",
  version: 1,
  schema: stateSchema,
  cls: () => NationalSanctionExecution,
});
