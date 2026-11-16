/**
 * M0: the engine's authoritative opt-in NATIONAL politics runtime.
 *
 * The political transition rules come from E1; this adapter binds them to
 * actual engine PlayerIDs and deterministic ticks. No data in this module is
 * itself a client observation or an AI input.
 */
import type { PlayerID } from "@openfront/engine-api/game/GameTypes";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { PoliticalAuthorityAdapter } from "./politics/PoliticalAuthorityAdapter";
import {
  eliminatePoliticalNation,
  foundEmpire,
  initialPolitics,
  lastSovereignVictory,
  METRIC_KEYS,
  validatePolitics,
  type PoliticsMetrics,
  type PoliticsProjection,
} from "./politics/sovereignty";

const counter = z.number().int().nonnegative();
const metrics = z.object({
  land: counter,
  maxPopulation: counter,
  activePopulation: counter,
  cities: counter,
  factories: counter,
  ports: counter,
  silos: counter,
  warships: counter,
});
const pactTerms = z.object({
  admission: z.enum(["leader", "unanimous"]),
  expulsion: z.enum(["leader", "unanimous", "forbidden"]),
});
const politicsSchema = z.object({
  nations: z.array(
    z.object({
      id: z.string().min(1),
      alive: z.boolean(),
      metrics,
    }),
  ),
  pacts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(["NAP", "MDA"]),
      memberIds: z.array(z.string()),
      administratorId: z.string().nullable(),
      terms: pactTerms,
      invitations: z.array(
        z.object({
          targetId: z.string(),
          approvedBy: z.array(z.string()),
        }),
      ),
    }),
  ),
  empires: z.array(
    z.object({
      id: z.string(),
      leaderId: z.string(),
      memberIds: z.array(z.string()),
      crisisDeadlineMs: counter.nullable(),
    }),
  ),
  accessionOffers: z.array(
    z.object({
      empireId: z.string(),
      candidateId: z.string(),
      proposerId: z.string(),
      recipientId: z.string(),
    }),
  ),
  simulationMs: counter,
});

export const NationalRuntimeSnapshotSchema = z.object({
  version: z.literal(1),
  lastTick: counter,
  politics: politicsSchema,
});
export type NationalRuntimeSnapshot = z.infer<
  typeof NationalRuntimeSnapshotSchema
>;

export type NationalCommand = {
  kind: "found-empire";
  empireId: string;
};

export interface NationalLivePlayer {
  readonly id: PlayerID;
  readonly alive: boolean;
  readonly spawned: boolean;
  readonly land: number;
}

function emptyMetrics(): PoliticsMetrics {
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])) as PoliticsMetrics;
}

/**
 * There is one instance per NATIONAL GameImpl. All writes flow through the
 * authoritative engine; legacy games do not construct this state.
 */
export class NationalRuntime {
  private politics: PoliticsProjection;
  private lastTick = 0;

  /** Read the same authoritative projection after every command or restore. */
  authority(): PoliticalAuthorityAdapter {
    return new PoliticalAuthorityAdapter(() => this.politics);
  }

  constructor(ids: readonly PlayerID[]) {
    this.politics = initialPolitics(
      [...ids].map((id) => ({ id, alive: true, metrics: emptyMetrics() })),
    );
  }

  /**
   * Derive live identity and elimination at an engine tick boundary.
   * Unspawned identities remain pending, not spuriously eliminated: the
   * full AFK/unspawned resolution rule is a separate open design decision.
   * Only the land metric is connected here; other metrics remain zero until
   * the politics adapter supplies authoritative values in the next slice.
   */
  synchronize(
    players: readonly NationalLivePlayer[],
    tick: number,
    spawnPhaseEnded: boolean,
  ): void {
    if (
      !Number.isSafeInteger(tick) ||
      tick < this.lastTick ||
      !Number.isSafeInteger(tick * 100)
    ) {
      throw new Error("NATIONAL: invalid or nonmonotonic simulation tick");
    }
    const known = new Set(this.politics.nations.map((n) => n.id));
    const live = new Map<PlayerID, NationalLivePlayer>();
    for (const player of players) {
      if (
        live.has(player.id) ||
        !player.id ||
        !Number.isSafeInteger(player.land) ||
        player.land < 0
      ) {
        throw new Error("NATIONAL: invalid live player identity/land");
      }
      live.set(player.id, player);
    }
    // The base engine can create bot/tribe players after game construction.
    for (const player of players) {
      if (!known.has(player.id)) {
        this.politics.nations.push({
          id: player.id,
          alive: true,
          metrics: emptyMetrics(),
        });
      }
    }
    for (const n of this.politics.nations) {
      const player = live.get(n.id);
      if (!player) throw new Error("NATIONAL: missing real player identity");
      n.metrics.land = player.land;
    }
    if (spawnPhaseEnded) {
      for (const player of players) {
        const prior = this.politics.nations.find((n) => n.id === player.id);
        if (player.spawned && !player.alive && prior?.alive) {
          this.politics = eliminatePoliticalNation(this.politics, player.id);
        }
      }
    }
    this.politics.simulationMs = tick * 100; // existing engine: ten ticks/second
    validatePolitics(this.politics);
    this.lastTick = tick;
  }

  /** One real authenticated, live nation may found an empire. No side effects on failure. */
  perform(actorId: PlayerID, command: NationalCommand): void {
    if (
      command.kind !== "found-empire" ||
      typeof command.empireId !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(command.empireId)
    ) {
      throw new Error("NATIONAL: invalid authenticated political command");
    }
    // E1 transition validates independent status, liveness and empire uniqueness.
    this.politics = foundEmpire(this.politics, command.empireId, actorId);
  }

  /** Winner chosen by real engine from E1's last-sovereign evaluation. */
  winner(): PlayerID | null {
    const result = lastSovereignVictory(this.politics);
    if (!result.resolved) return null;
    const victor = result.prizes[0];
    return victor?.nationId ?? null;
  }

  snapshot(): NationalRuntimeSnapshot {
    validatePolitics(this.politics);
    // Only JSON primitives in the E1 pure state; copy to prevent caller writes.
    return NationalRuntimeSnapshotSchema.parse({
      version: 1,
      lastTick: this.lastTick,
      politics: this.politics,
    });
  }

  stateHash(): number {
    return simpleHash(JSON.stringify(this.snapshot()));
  }

  static restore(
    raw: unknown,
    actualIds: readonly PlayerID[],
    engineTick: number,
  ): NationalRuntime {
    const saved = NationalRuntimeSnapshotSchema.parse(raw);
    validatePolitics(saved.politics);
    if (
      saved.lastTick > engineTick ||
      saved.politics.simulationMs > engineTick * 100
    ) {
      throw new Error("NATIONAL: snapshot is from the future");
    }
    const ids = new Set(actualIds);
    if (
      ids.size !== actualIds.length ||
      ids.size !== saved.politics.nations.length ||
      saved.politics.nations.some((n) => !ids.has(n.id))
    ) {
      throw new Error("NATIONAL: snapshot identities differ from real players");
    }
    const restored = new NationalRuntime([]);
    restored.politics = saved.politics;
    restored.lastTick = saved.lastTick;
    return restored;
  }
}
