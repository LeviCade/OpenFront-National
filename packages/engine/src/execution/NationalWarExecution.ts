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
) & { readonly requestId?: string };

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
  /**
   * E1 keeps this existing method name while upgrading its return to an
   * authenticated, snapshotted WAR outcome. The unmerged baseline returns
   * void, so E2 does not infer any receipt until the read port also exists.
   */
  performNationalWarCommand(
    actor: Player,
    command: CanonicalWarCommand,
    requestId?: string | null,
  ): unknown;
  nationalWarCommandResults?(observer: Player): readonly unknown[];
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

  constructor(
    private actor: Player,
    private command: NationalWarCommand,
    // Optional E4 click correlation. E1's journal owns acceptance/idempotency.
    private requestId: string | null = null,
  ) {}

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(game: Game): void {
    this.game = game;
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
    const hasOutcomePort =
      typeof port.nationalWarCommandResults === "function";
    if (
      !hasOutcomePort &&
      (!game.hasPlayer(this.actor.id()) ||
        game.player(this.actor.id()) !== this.actor ||
        !this.actor.hasSpawned() ||
        !this.actor.isAlive())
    )
      return;
    if (!hasOutcomePort && !port.nationalWarState?.()) return;
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
          !hasOutcomePort &&
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

    // E1's Game-owned result service is the ONLY authority for accepted and
    // rejected WAR/peace clicks. Request IDs are correlation, not credentials.
    // E3 may project its authenticated journal; E2 never emits an outcome.
    if (hasOutcomePort) {
      const result = port.performNationalWarCommand(
        this.actor,
        this.requestId === null
          ? command
          : { ...command, requestId: this.requestId },
        this.requestId,
      );
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
    port.performNationalWarCommand(
      this.actor,
      this.requestId === null
        ? command
        : { ...command, requestId: this.requestId },
    );
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return NationalWarExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      actor: w.player(this.actor),
      command: this.command,
      requestId: this.requestId,
    });
  }

  restoreSnapshot(state: State, reader: SnapshotReader): void {
    this.active = state.active;
    this.game = state.initialized ? reader.game : null;
    this.actor = reader.player(state.actor);
    this.command = state.command;
    this.requestId = state.requestId;
  }
}

export const NationalWarExecutionSnapshot = execSnapshotType({
  name: "NationalWar",
  version: 2,
  schema: stateSchema,
  migrations: {
    1: (old: object) => ({ ...old, requestId: null }),
  },
  cls: () => NationalWarExecution,
});
