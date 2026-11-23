import type { ClientID } from "@openfront/engine-api/Schemas";
/**
 * NATIONAL authenticated diplomacy commands + attack adapter to E1's
 * ONE GameImpl-owned, snapshotted WarLedger/DefenseLevyLedger service.
 *
 * No transient duplicate mutable war registry, WeakMap, or client-supplied
 * campaign/war authority. This compiles against the pre-E1-bridge integration
 * baseline, failing CLOSED until E1's published Game port is integrated.
 */
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import type { Execution, Game, Player } from "../game/Game";
import type {
  DefenseResult,
  IncomingDefense,
  TroopSource,
} from "../national/conflict/DefenseLevy";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

export type NationalWarCommand =
  | { kind: "declare-national"; nationId: string; targetId: string }
  | {
      kind: "declare-imperial";
      targetKind: "nation" | "empire";
      targetId: string;
    }
  | { kind: "propose-peace"; warId: string }
  | { kind: "accept-peace"; motionId: string };

const warCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("declare-national"),
    nationId: z.string(),
    targetId: z.string(),
  }),
  z.object({
    kind: z.literal("declare-imperial"),
    targetKind: z.enum(["nation", "empire"]),
    targetId: z.string(),
  }),
  z.object({ kind: z.literal("propose-peace"), warId: z.string() }),
  z.object({ kind: z.literal("accept-peace"), motionId: z.string() }),
]);

const stateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  actor: zPlayerRef(),
  command: warCommandSchema,
  // Historic v1 execution states are migrated to null, never invent a click.
  requestId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullable(),
  authenticatedClientID: z.string().min(1).max(256).nullable(),
  /** Optional only for snapshots predating C5 policy-epoch admission. */
  admissionEmpireId: z.string().nullable().optional(),
  admissionPolicyVersion: z.number().int().nonnegative().nullable().optional(),
});
type State = z.infer<typeof stateSchema>;

type WarParty = { kind: "nation" | "empire"; id: string };
type CanonicalWarCommand = (
  | {
      kind: "declare-national";
      warId: string;
      aggressorId: string;
      targetId: string;
    }
  | {
      kind: "declare-imperial";
      warId: string;
      aggressor: WarParty;
      target: WarParty;
    }
  | { kind: "propose-peace"; motionId: string; warId: string }
  | { kind: "accept-peace"; motionId: string }
) & {
  readonly requestId?: string;
  /** Server-stamped by this execution; never from browser intent. */
  readonly admissionEmpireId?: string | null;
  readonly policyVersion?: number | null;
};

/**
 * Exactly E1's Round Four canonical Game port, included structurally here
 * while E1's E1-owned branch is unmerged. No parallel war implementation.
 */
interface WarGamePort {
  nationalWarAuthority(): {
    authorizeOffensiveAction(
      attackerId: string,
      targetId: string | null,
    ): boolean;
    atWar(a: string, b: string): boolean;
  } | null;
  nationalWarState(): {
    wars: {
      layers: readonly { id: string }[];
      motions: readonly { id: string }[];
    };
  } | null;
  /** Existing legacy WAR callers preserve their throwing/void semantics. */
  performNationalWarCommand(
    actor: Player,
    command: CanonicalWarCommand,
    authenticatedClientID?: ClientID,
  ): void;
  /** E1's *separate* authoritative typed outcome + Game journal port. */
  performNationalWarCommandWithOutcome?(
    actor: Player,
    command: CanonicalWarCommand,
    requestId?: string | null,
    authenticatedClientID?: ClientID,
  ): unknown;
  nationalWarCommandResults?(observer: Player): readonly unknown[];
  /** Real GameImpl attack-time defense entry; supersedes the legacy MDA adapter. */
  interceptNationalIncomingAttack?(
    attackId: string,
    attackerId: string,
    defenderId: string,
    troops: number,
  ): DefenseResult;
  nationalLevySource(nationId: string): TroopSource | null;
  applyNationalDefenseLevy(
    attacks: readonly IncomingDefense[],
  ): readonly DefenseResult[];
  /** Pending E1 read-only bridge; absent = no fabricated MDA contributors. */
  nationalMdaAllies?(defenderId: string): readonly string[];
}

function canonicalWarPort(game: Game): Partial<WarGamePort> {
  return game as Partial<WarGamePort>;
}

export function authorizeNationalAttack(
  game: Game,
  attackerId: string,
  targetId: string | null,
): boolean {
  const politics = game.nationalPoliticalAuthority();
  if (politics === null) return true; // EXACT original FFA path.
  if (!politics.nationAlive(attackerId)) return false;
  const authority = canonicalWarPort(game).nationalWarAuthority?.() ?? null;
  // Until E1's canonical bridge is present, fail CLOSED on hostile targets.
  return authority
    ? authority.authorizeOffensiveAction(attackerId, targetId)
    : targetId === null;
}

/**
 * One accepted attack in actual Game, delegated to E1's canonical snapshot
 * ledger and E1's independently verified real-Player troop transaction.
 */
export function interceptNationalAttack(
  game: Game,
  attackId: string,
  attackerId: string,
  defenderId: string,
  troops: number,
): DefenseResult | null {
  const politics = game.nationalPoliticalAuthority();
  if (politics === null) return null;
  const port = canonicalWarPort(game);
  if (
    !port
      .nationalWarAuthority?.()
      ?.authorizeOffensiveAction(attackerId, defenderId) ||
    typeof port.applyNationalDefenseLevy !== "function"
  )
    throw new Error("NATIONAL: missing authorized canonical war/levy service");

  if (typeof port.interceptNationalIncomingAttack === "function") {
    return port.interceptNationalIncomingAttack(
      attackId,
      attackerId,
      defenderId,
      Math.floor(troops),
    );
  }

  // A canonical war cannot silently bypass the defender's MDA obligations.
  // Until E1 installs its authenticated donor roster, fail CLOSED.
  if (typeof port.nationalMdaAllies !== "function")
    throw new Error("NATIONAL: missing authoritative MDA contributors");
  const candidateIds = port.nationalMdaAllies(defenderId);
  // The E1 port promises a COMPLETE, sorted, unique live MDA roster. Never
  // silently drop a contributor: that would evade a treaty's defensive duty.
  if (!Array.isArray(candidateIds))
    throw new Error("NATIONAL: invalid authoritative MDA roster");
  for (let i = 0; i < candidateIds.length; i++) {
    const id = candidateIds[i];
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id === defenderId ||
      id === attackerId ||
      (i > 0 && candidateIds[i - 1] >= id) ||
      !politics.nationAlive(id) ||
      !game.hasPlayer(id) ||
      !game.player(id).isAlive() ||
      !game.player(id).hasSpawned()
    )
      throw new Error("NATIONAL: invalid authoritative MDA donor identity");
  }
  const eligible = candidateIds.map((id) => {
    const source = port.nationalLevySource?.(id);
    if (
      !source ||
      source.nationId !== id ||
      !Number.isSafeInteger(source.troops()) ||
      source.troops() !== game.player(id).troops()
    )
      throw new Error("NATIONAL: missing authoritative MDA troop source");
    return {
      source,
      troopCapacity: Math.floor(game.config().maxTroops(game.player(id))),
      maximumFraction: 0.1,
      protectedCapacityFraction: 0.3,
    };
  });
  const request: IncomingDefense = {
    attackId,
    confirmedAccepted: true,
    // Server-derived non-refreshing belligerent-pair campaign while P1 has no
    // approved window: no client action ID can replenish this allowance.
    campaignId: `national:${attackerId.length}:${attackerId}:${defenderId.length}:${defenderId}`,
    attackerId,
    defenderId,
    attackingTroops: Math.floor(troops),
    eligible,
  };
  return port.applyNationalDefenseLevy([request])[0];
}

/** Queueable and versioned diplomatic command; ALL mutable state is E1-owned. */
export class NationalWarExecution implements Execution {
  private active = true;
  private game: Game | null = null;
  private admissionEmpireId: string | null | undefined = undefined;
  private admissionPolicyVersion: number | null | undefined = undefined;

  constructor(
    private actor: Player,
    private command: NationalWarCommand,
    // Optional E4 click correlation. E1's journal owns acceptance/idempotency.
    private requestId: string | null = null,
    /** Original authenticated admission, not the mutable Player.clientID(). */
    private authenticatedClientID: ClientID | null = null,
  ) {}

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(game: Game): void {
    this.game = game;
    // Snapshot admission identity/policy BEFORE any queued political execution
    // changes the crown or a subordinate's revocable authority this tick.
    const political = game.nationalPoliticalAuthority();
    this.admissionEmpireId = political?.empireOf(this.actor.id()) ?? null;
    this.admissionPolicyVersion =
      political?.warPolicyVersionFor(this.actor.id()) ?? null;
  }

  tick(tick: number): void {
    this.active = false;
    const game = this.game;
    const port = game === null ? null : canonicalWarPort(game);
    if (!game || !port?.performNationalWarCommand) return;
    const political = game.nationalPoliticalAuthority();
    if (!political) return; // FFA does not have NATIONAL command results.

    // Only E1 may decide or journal a canonical rejection. Once its outcome
    // port exists, even inactive actors and invalid sovereign claims reach it.
    // The older void port remains for integration baseline compatibility.
    const withOutcome = port.performNationalWarCommandWithOutcome;
    const hasJournal =
      typeof withOutcome === "function" &&
      typeof port.nationalWarCommandResults === "function";
    if (
      !hasJournal &&
      (!game.hasPlayer(this.actor.id()) ||
        game.player(this.actor.id()) !== this.actor ||
        !this.actor.hasSpawned() ||
        !this.actor.isAlive())
    )
      return;
    if (!hasJournal && !port.nationalWarState?.()) return;
    // An execution's engine tick + registered ordinal is deterministic across
    // snapshot/replay and cannot reuse an ID when peace deletes stale motions.
    // Unlike a client action ID, neither value is controlled by the request.
    const ordinal = game.executions().indexOf(this);
    if (ordinal < 0) return;
    const id = `national-${tick}-${this.actor.smallID()}-${ordinal}`;
    let command: CanonicalWarCommand;
    switch (this.command.kind) {
      case "declare-national":
        command = {
          kind: "declare-national",
          warId: id,
          aggressorId: this.command.nationId,
          targetId: this.command.targetId,
        };
        break;
      case "declare-imperial": {
        const empire = political.empireOf(this.actor.id());
        if (
          !hasJournal &&
          (empire === null || political.emperorOf(empire) !== this.actor.id())
        )
          return;
        command = {
          kind: "declare-imperial",
          warId: id,
          // An unaffiliated actor is intentionally invalid. E1 must record
          // the rejection rather than E2 silently losing the click.
          aggressor: { kind: "empire", id: empire ?? this.actor.id() },
          target: { kind: this.command.targetKind, id: this.command.targetId },
        };
        break;
      }
      case "propose-peace":
        command = {
          kind: "propose-peace",
          motionId: id,
          warId: this.command.warId,
        };
        break;
      case "accept-peace":
        command = { kind: "accept-peace", motionId: this.command.motionId };
        break;
    }

    // Never let an execution minted before accession, revocation, transfer,
    // or dissolution inherit the new political regime's permissions.
    const stampedCommand: CanonicalWarCommand =
      this.admissionEmpireId === undefined
        ? command
        : {
            ...command,
            admissionEmpireId: this.admissionEmpireId,
            policyVersion: this.admissionPolicyVersion ?? null,
          };

    // E1's Game-owned result service is the ONLY authority for accepted and
    // rejected WAR/peace clicks. Request IDs are correlation, not credentials.
    // E3 may project its authenticated journal; E2 never emits an outcome.
    if (hasJournal) {
      let result: unknown;
      try {
        result = withOutcome.call(
          port,
          this.actor,
          this.requestId === null
            ? stampedCommand
            : { ...stampedCommand, requestId: this.requestId },
          this.requestId,
          this.authenticatedClientID ?? undefined,
        );
      } catch (error) {
        // A reused token already belongs to another immutable E1 receipt.
        // Never let that expected, unauthorized click terminate a Game tick.
        // Returning without a receipt is fail-closed; NEVER claim acceptance.
        if (
          error instanceof Error &&
          (error.message ===
            "NATIONAL command journal: reused foreign request ID" ||
            error.message === "NATIONAL: stale authenticated actor session" ||
            error.message === "NATIONAL: missing authenticated actor session" ||
            error.message === "NATIONAL: stale sovereign replay authority")
        )
          return;
        throw error;
      }
      // Never interpret non-throwing or void execution as acceptance. E1's
      // verified recipient-bound journal is the only source of WAR outcomes.
      if (
        typeof result !== "object" ||
        result === null ||
        !("accepted" in result) ||
        typeof result.accepted !== "boolean" ||
        !("actorId" in result) ||
        result.actorId !== this.actor.id() ||
        !("recipientId" in result) ||
        result.recipientId !== this.actor.id() ||
        !("requestId" in result) ||
        typeof result.requestId !== "string" ||
        (this.requestId !== null && result.requestId !== this.requestId)
      )
        throw new Error("NATIONAL WAR: invalid canonical E1 outcome");
      return;
    }

    // Temporary compatibility with the already-integrated void E1 port.
    // It cannot produce a trustworthy receipt: E4 must keep the click pending.
    // Avoid throwing on an explicitly forged national initiator while older
    // Game implementations still lack the outcome journal.
    if (
      command.kind === "declare-national" &&
      command.aggressorId !== this.actor.id()
    )
      return;

    // No console.warn suppression: unexpected authority failures are errors,
    // never implicit acceptance. The new E1 result port handles rule denials.
    try {
      port.performNationalWarCommand(
        this.actor,
        this.requestId === null
          ? stampedCommand
          : { ...stampedCommand, requestId: this.requestId },
        this.authenticatedClientID ?? undefined,
      );
    } catch (error) {
      // Before E1's authoritative receipt port is merged, an ordinary
      // same-side peace rejection must not crash the Game tick.
      // Never fabricate an acceptance or swallow unexpected engine errors.
      if (
        command.kind === "accept-peace" &&
        error instanceof Error &&
        error.message === "other belligerent must accept peace"
      )
        return;
      throw error;
    }
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return NationalWarExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      actor: w.player(this.actor),
      command: this.command,
      requestId: this.requestId,
      authenticatedClientID: this.authenticatedClientID,
      admissionEmpireId: this.admissionEmpireId,
      admissionPolicyVersion: this.admissionPolicyVersion,
    });
  }

  restoreSnapshot(state: State, reader: SnapshotReader): void {
    this.active = state.active;
    this.game = state.initialized ? reader.game : null;
    this.actor = reader.player(state.actor);
    this.command = state.command;
    this.requestId = state.requestId;
    this.authenticatedClientID = state.authenticatedClientID;
    this.admissionEmpireId = state.admissionEmpireId;
    this.admissionPolicyVersion = state.admissionPolicyVersion;
  }
}

export const NationalWarExecutionSnapshot = execSnapshotType({
  name: "NationalWar",
  version: 4,
  schema: stateSchema,
  migrations: {
    1: (old: object) => ({ ...old, requestId: null }),
    2: (old: object) => ({ ...old, authenticatedClientID: null }),
    3: (old: object) => ({ ...old }),
  },
  cls: () => NationalWarExecution,
});
