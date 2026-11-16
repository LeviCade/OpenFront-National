/**
 * NATIONAL war command executor and persisted conflict authority.
 *
 * The FIRST valid command becomes a long-lived active execution containing
 * exactly one WarLedger and LevyLedger. Later authenticated commands apply
 * to that execution and expire. The existing registered execution snapshots
 * persist the entire WAR + LEVY + campaign state with PlayerImpl balances at
 * the same Game tick. No global WeakMap, duplicated political projection,
 * or edits to E1 GameImpl/GameSnapshot files.
 */
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import type { Execution, Game, Player } from "../game/Game";
import {
  DefenseLevyLedger,
  type DefenseResult,
  type IncomingDefense,
  type LevyLedgerState,
  type TroopSource,
} from "../national/conflict/DefenseLevy";
import { PlayerTroopDebitAdapter } from "../national/conflict/PlayerTroopDebitAdapter";
import {
  WarLedger,
  type ConflictLedgerState,
  type ConflictParty,
} from "../national/conflict/WarLedger";
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
  root: z.boolean(),
  initialized: z.boolean(),
  actor: zPlayerRef(),
  command: warCommandSchema,
  nextSequence: z.number().int().nonnegative(),
  war: z.unknown().nullable(),
  levy: z.unknown().nullable(),
});
type State = z.infer<typeof stateSchema>;

const noPermission = (): never => {
  throw new Error("NATIONAL: war command requires authenticated live actor");
};

/** The sole game-local, snapshot-backed conflict authority. */
export function nationalConflict(game: Game): NationalWarExecution | null {
  for (const execution of game.executions()) {
    if (
      execution instanceof NationalWarExecution &&
      execution.isRoot() &&
      execution.isActive()
    ) {
      return execution;
    }
  }
  return null;
}

/** Pure, fail-closed legality check, including before first war declaration. */
export function authorizeNationalAttack(
  game: Game,
  attackerId: string,
  targetId: string | null,
): boolean {
  const authority = game.nationalPoliticalAuthority();
  if (authority === null) return true; // EXACT legacy FFA behavior.
  if (!authority.nationAlive(attackerId)) return false;
  const established = nationalConflict(game);
  if (!established) return targetId === null; // no formal war exists yet
  return established.wars().authorizeOffensiveAction(attackerId, targetId);
}

/**
 * Read-only E1 MDA adapter surface: absent until E1 ships its political
 * bridge; fail CLOSED (no invented MDA contributions). At no time can
 * legacy bilateral alliances masquerade as formal MDA memberships.
 */
export function activeMdaDonors(game: Game, defenderId: string): TroopSource[] {
  const authority = game.nationalPoliticalAuthority();
  if (!authority) return [];
  const query = authority as typeof authority & {
    mdaAlliesOf?: (nationId: string) => readonly string[];
  };
  const raw = query.mdaAlliesOf?.(defenderId) ?? [];
  return [...new Set(raw)]
    .sort()
    .filter(
      (id) =>
        id !== defenderId &&
        authority.nationAlive(id) &&
        game.hasPlayer(id) &&
        game.player(id).isAlive(),
    )
    .map((id) => {
      const player = game.player(id);
      return { nationId: id, troops: () => player.troops() };
    });
}

/** Consumes one already-accepted real attack; returned receipt applies once. */
export function interceptNationalAttack(
  game: Game,
  attackId: string,
  attackerId: string,
  defenderId: string,
  troops: number,
): DefenseResult | null {
  if (!game.nationalPoliticalAuthority()) return null;
  const conflict = nationalConflict(game);
  if (!conflict || !conflict.wars().authorizeOffensiveAction(attackerId, defenderId))
    throw new Error("NATIONAL: attack is not authorized by active war");
  const eligible = activeMdaDonors(game, defenderId)
    .filter((source) => source.nationId !== attackerId)
    .map((source) => ({
      source,
      // Use current authoritative cap only as the baseline. E1 will expose
      // immutable per-player capacity when the formal MDA bridge lands.
      troopCapacity: game.config().maxTroops(game.player(source.nationId)),
      maximumFraction: 0.1,
      protectedCapacityFraction: 0.3,
    }));
  const incoming: IncomingDefense = {
    attackId,
    confirmedAccepted: true,
    // P1 remains open: conservative lifetime campaign for this ordered
    // belligerent pair, never refreshed by retries or microattacks.
    campaignId: `national:${attackerId.length}:${attackerId}:${defenderId.length}:${defenderId}`,
    attackerId,
    defenderId,
    attackingTroops: Math.floor(troops),
    eligible,
  };
  return conflict.levies().interceptAcceptedAttacks([incoming])[0];
}

export class NationalWarExecution implements Execution {
  private active = true;
  private root = false;
  private game: Game | null = null;
  private warLedger: WarLedger | null = null;
  private levyLedger: DefenseLevyLedger | null = null;
  private nextSequence = 0;
  private savedWar: ConflictLedgerState | null = null;
  private savedLevy: LevyLedgerState | null = null;

  constructor(
    private actor: Player,
    private command: NationalWarCommand,
  ) {}

  isRoot(): boolean {
    return this.root;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  /** Lazy restoration: GameImpl's NATIONAL runtime may restore after execs. */
  private attachLedgers(): void {
    if (!this.root || this.game === null) throw new Error("NATIONAL: no war root");
    if (this.warLedger && this.levyLedger) return;
    const politics = this.game.nationalPoliticalAuthority();
    if (politics === null) throw new Error("NATIONAL: no political authority");
    this.warLedger = new WarLedger(politics);
    this.levyLedger = new DefenseLevyLedger(new PlayerTroopDebitAdapter(this.game));
    if (this.savedWar !== null) this.warLedger.restoreState(this.savedWar);
    if (this.savedLevy !== null) this.levyLedger.restoreState(this.savedLevy);
    this.savedWar = null;
    this.savedLevy = null;
  }

  wars(): WarLedger {
    this.attachLedgers();
    return this.warLedger!;
  }

  levies(): DefenseLevyLedger {
    this.attachLedgers();
    return this.levyLedger!;
  }

  private perform(actor: Player, command: NationalWarCommand, tick: number): void {
    if (!this.root || this.game === null) throw new Error("NATIONAL: no war root");
    const politics = this.game.nationalPoliticalAuthority();
    if (politics === null) noPermission();
    if (
      !this.game.hasPlayer(actor.id()) ||
      this.game.player(actor.id()) !== actor ||
      !actor.hasSpawned() ||
      !actor.isAlive() ||
      !politics.nationAlive(actor.id())
    ) noPermission();
    const wars = this.wars();
    const id = `national-war-${tick}-${this.nextSequence}`;
    switch (command.kind) {
      case "declare-national":
        wars.declareNational(id, actor.id(), command.nationId, command.targetId, tick);
        break;
      case "declare-imperial": {
        const empire = politics.empireOf(actor.id());
        const first: ConflictParty = empire
          ? { kind: "empire", id: empire }
          : { kind: "nation", id: actor.id() };
        if (empire === null || politics.emperorOf(empire) !== actor.id())
          noPermission();
        wars.declareImperial(
          id,
          actor.id(),
          first,
          { kind: command.targetKind, id: command.targetId },
          tick,
        );
        break;
      }
      case "propose-peace":
        wars.proposePeace(id, command.warId, actor.id(), tick);
        break;
      case "accept-peace":
        wars.acceptPeace(command.motionId, actor.id(), tick);
        break;
    }
    this.nextSequence++;
  }

  init(game: Game, tick: number): void {
    this.game = game;
    const politics = game.nationalPoliticalAuthority();
    if (
      !politics ||
      !game.hasPlayer(this.actor.id()) ||
      game.player(this.actor.id()) !== this.actor ||
      !this.actor.isAlive() ||
      !this.actor.hasSpawned() ||
      !politics.nationAlive(this.actor.id())
    ) {
      this.active = false;
      return;
    }
    const existing = nationalConflict(game);
    if (existing && existing !== this) {
      try {
        existing.perform(this.actor, this.command, tick);
      } catch (error) {
        console.warn("NATIONAL war command rejected:", String(error));
      }
      this.active = false;
      return;
    }
    this.root = true;
    try {
      this.perform(this.actor, this.command, tick);
    } catch (error) {
      console.warn("NATIONAL war command rejected:", String(error));
      this.root = false;
      this.active = false;
      this.warLedger = null;
      this.levyLedger = null;
    }
  }

  tick(_ticks: number): void {
    // Durable authoritative state, not a repeating diplomatic command.
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return NationalWarExecutionSnapshot.write({
      active: this.active,
      root: this.root,
      initialized: this.game !== null,
      actor: w.player(this.actor),
      command: this.command,
      nextSequence: this.nextSequence,
      war: this.root ? (this.warLedger?.exportState() ?? this.savedWar) : null,
      levy: this.root ? (this.levyLedger?.exportState() ?? this.savedLevy) : null,
    });
  }

  restoreSnapshot(state: State, reader: SnapshotReader): void {
    this.active = state.active;
    this.root = state.root;
    this.game = state.initialized ? reader.game : null;
    this.actor = reader.player(state.actor);
    this.command = state.command;
    this.nextSequence = state.nextSequence;
    this.savedWar = state.war as ConflictLedgerState | null;
    this.savedLevy = state.levy as LevyLedgerState | null;
    this.warLedger = null;
    this.levyLedger = null;
  }
}

export const NationalWarExecutionSnapshot = execSnapshotType({
  name: "NationalWar",
  version: 1,
  schema: stateSchema,
  cls: () => NationalWarExecution,
});
