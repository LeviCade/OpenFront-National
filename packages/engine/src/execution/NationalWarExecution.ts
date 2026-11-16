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
});
type State = z.infer<typeof stateSchema>;

type WarParty = { kind: "nation" | "empire"; id: string };
type CanonicalWarCommand =
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
  | { kind: "accept-peace"; motionId: string };

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
  performNationalWarCommand(actor: Player, command: CanonicalWarCommand): void;
  nationalLevySource(nationId: string): TroopSource | null;
  applyNationalDefenseLevy(
    attacks: readonly IncomingDefense[],
  ): readonly DefenseResult[];
  /** Pending E1 read-only bridge; absent = no fabricated MDA contributors. */
  nationalMdaAllies?(defenderId: string): readonly string[];
}

function canonicalWarPort(game: Game): Partial<WarGamePort> {
  return game as Game & Partial<WarGamePort>;
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

  const candidateIds = [...new Set(port.nationalMdaAllies?.(defenderId) ?? [])]
    .sort()
    .filter(
      (id) =>
        id !== defenderId &&
        id !== attackerId &&
        politics.nationAlive(id) &&
        game.hasPlayer(id) &&
        game.player(id).isAlive(),
    );
  const eligible = candidateIds.flatMap((id) => {
    const source = port.nationalLevySource?.(id);
    if (!source) return [];
    return [
      {
        source,
        troopCapacity: Math.floor(game.config().maxTroops(game.player(id))),
        maximumFraction: 0.1,
        protectedCapacityFraction: 0.3,
      },
    ];
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
    if (
      !game ||
      !port?.performNationalWarCommand ||
      !game.nationalPoliticalAuthority() ||
      !game.hasPlayer(this.actor.id()) ||
      game.player(this.actor.id()) !== this.actor ||
      !this.actor.hasSpawned() ||
      !this.actor.isAlive()
    )
      return;

    const political = game.nationalPoliticalAuthority()!;
    if (!port.nationalWarState?.()) return;
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
        if (empire === null || political.emperorOf(empire) !== this.actor.id())
          return;
        command = {
          kind: "declare-imperial",
          warId: id,
          aggressor: { kind: "empire", id: empire },
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

    try {
      // GameImpl rechecks authoritative actor, timing, live politics and
      // delegates to the canonical snapshotted WarLedger.
      port.performNationalWarCommand(this.actor, command);
    } catch (error) {
      console.warn("NATIONAL war command rejected:", String(error));
    }
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return NationalWarExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      actor: w.player(this.actor),
      command: this.command,
    });
  }

  restoreSnapshot(state: State, reader: SnapshotReader): void {
    this.active = state.active;
    this.game = state.initialized ? reader.game : null;
    this.actor = reader.player(state.actor);
    this.command = state.command;
  }
}

export const NationalWarExecutionSnapshot = execSnapshotType({
  name: "NationalWar",
  version: 1,
  schema: stateSchema,
  cls: () => NationalWarExecution,
});
