/**
 * Candidate-neutral NATIONAL strategic planner (D-002; AI-01, AI-02, AI-04).
 * This module has no Game/Player imports: it cannot query hidden state.
 * Suggestions are NOT executions; conductor-owned command validators decide
 * legality, cost and actual effects when NATIONAL is wired into M0.
 */
import type {
  NationId,
  NationalObservation,
  NationalWarView,
  PublicDiplomaticEventKind,
} from "../observation/NationalObservation";

/**
 * Nations on the SAME side are comrades, NOT enemies.
 * Opposing side alone produces possible hostile identities. Malformed records
 * where observer is on both sides fail closed; if contradictory independent
 * layers contain an ally and enemy at once, same-side protection wins.
 * This strategic reader does not authorize a military command.
 */
export function deriveNationalWarSides(
  wars: readonly NationalWarView[],
  observerId: NationId,
): {
  readonly enemies: ReadonlySet<NationId>;
  readonly allies: ReadonlySet<NationId>;
} {
  const enemies = new Set<NationId>();
  const allies = new Set<NationId>();
  for (const war of wars) {
    const first = war.first.activeMemberIds;
    const second = war.second.activeMemberIds;
    const onFirst = first.includes(observerId);
    const onSecond = second.includes(observerId);
    if (onFirst === onSecond) continue;
    const sameSide = onFirst ? first : second;
    const oppositeSide = onFirst ? second : first;
    for (const id of sameSide) if (id !== observerId) allies.add(id);
    for (const id of oppositeSide) if (id !== observerId) enemies.add(id);
  }
  for (const id of allies) enemies.delete(id);
  return { enemies, allies };
}

export type NationalObjective = "defend" | "expand" | "consolidate";
export interface DiplomaticReputation {
  readonly nationId: NationId;
  readonly credibility: number;
  readonly lastObservedTick: number;
}
export interface NationalPlannerMemory {
  readonly observerId: NationId;
  readonly objective: NationalObjective;
  readonly targetId: NationId | null;
  readonly nextPlanningTick: number;
  readonly lastProcessedEvent: {
    readonly tick: number;
    readonly id: string;
  } | null;
  readonly reputation: readonly DiplomaticReputation[];
}
export interface NationalDecision {
  readonly objective: NationalObjective;
  readonly targetId: NationId | null;
  readonly score: number;
  readonly rationale:
    | "active-defense"
    | "reachable-opportunity"
    | "preserve-options";
}
export interface NationalPlanResult {
  readonly planned: boolean;
  readonly decision: NationalDecision | null;
  readonly memory: NationalPlannerMemory;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const REPUTATION_LIMIT = 128;
const clamp = (n: number): number => Math.max(-10, Math.min(10, n));
const weight: Record<PublicDiplomaticEventKind, number> = {
  "treaty-kept": 1,
  "treaty-broken": -4,
  "threat-fulfilled": 2,
  "bluff-exposed": -3,
};

export function initialNationalPlannerMemory(
  observerId: NationId,
): NationalPlannerMemory {
  return {
    observerId,
    objective: "consolidate",
    targetId: null,
    nextPlanningTick: 0,
    lastProcessedEvent: null,
    reputation: [],
  };
}

/** Memory consumes ONLY diplomatic events admitted by the observation filter. */
export function updateNationalDiplomaticMemory(
  observation: NationalObservation,
  memory: NationalPlannerMemory,
): { memory: NationalPlannerMemory; sawNewEvent: boolean } {
  if (observation.observerId !== memory.observerId) {
    throw new Error("Planner memory principal mismatch");
  }
  let cursor = memory.lastProcessedEvent;
  const reputation = new Map(memory.reputation.map((r) => [r.nationId, r]));
  let sawNewEvent = false;
  // Events are sorted by (tick, ID); the cursor makes long repeated
  // histories idempotent without unbounded event-ID storage.
  for (const e of observation.diplomaticEvents) {
    if (e.tick > observation.tick) continue;
    if (
      cursor &&
      (e.tick < cursor.tick || (e.tick === cursor.tick && e.id <= cursor.id))
    )
      continue;
    cursor = { tick: e.tick, id: e.id };
    sawNewEvent = true;
    reputation.set(e.actorId, {
      nationId: e.actorId,
      credibility: clamp(
        (reputation.get(e.actorId)?.credibility ?? 0) + weight[e.kind],
      ),
      lastObservedTick: e.tick,
    });
  }
  const sortedReputation = [...reputation.values()]
    .sort(
      (a, b) =>
        b.lastObservedTick - a.lastObservedTick || cmp(a.nationId, b.nationId),
    )
    .slice(0, REPUTATION_LIMIT)
    .sort((a, b) => cmp(a.nationId, b.nationId));
  return {
    sawNewEvent,
    memory: {
      ...memory,
      lastProcessedEvent: cursor,
      reputation: sortedReputation,
    },
  };
}

/**
 * A bounded cadence plus event-driven reconsideration.
 * The only candidates are visible/discovered reachable frontiers, never an
 * omniscient list of weak opponents or the largest global human player.
 */
export function planNationalInterest(
  observation: NationalObservation,
  previous: NationalPlannerMemory,
  cadenceTicks: number,
): NationalPlanResult {
  if (!Number.isSafeInteger(cadenceTicks) || cadenceTicks < 1) {
    throw new Error("cadenceTicks must be a positive integer");
  }
  const updated = updateNationalDiplomaticMemory(observation, previous);
  const memory = updated.memory;
  if (observation.tick < memory.nextPlanningTick && !updated.sawNewEvent) {
    return { planned: false, decision: null, memory };
  }
  const self = observation.nations.find((n) => n.id === observation.observerId);
  if (!self || !self.alive) {
    return {
      planned: true,
      decision: {
        objective: "consolidate",
        targetId: null,
        score: 0,
        rationale: "preserve-options",
      },
      memory: {
        ...memory,
        objective: "consolidate",
        targetId: null,
        nextPlanningTick: observation.tick + cadenceTicks,
      },
    };
  }

  const publicNations = new Map(observation.nations.map((n) => [n.id, n]));
  const { enemies: enemiesAtWar, allies: warAllies } = deriveNationalWarSides(
    observation.wars,
    self.id,
  );

  // Coalition membership is public. Never treat an empire comrade or fellow
  // war-side belligerent as a target, even if a different layer also makes
  // them appear hostile. No controllerKind or private strength is available.
  const protectedPartners = new Set<string>(warAllies);
  for (const coalition of observation.coalitions) {
    if (coalition.members.includes(self.id)) {
      for (const id of coalition.members) protectedPartners.add(id);
    }
  }

  const knownCredibility = new Map(
    memory.reputation.map((r) => [r.nationId, r.credibility]),
  );
  // Only a physically observed military asset may affect tactical risk. An
  // unobserved powerful nation is not a psychic threat to this local front.
  const visibleMilitary = new Set(
    observation.visibleAssets
      .filter((a) => a.kind === "army" || a.kind === "warship")
      .map((a) => a.ownerId),
  );
  const frontlineTargets = [...new Set(
    observation.frontiers
      .filter((f) => f.access === "land")
      .map((f) => f.targetId),
  )].sort(cmp);
  const localWarTargets = frontlineTargets.filter(
    (id) =>
      enemiesAtWar.has(id) &&
      !protectedPartners.has(id) &&
      publicNations.get(id)?.alive === true,
  );

  // AI-02: an ACTUAL local campaign outranks every hypothetical new war,
  // regardless of how many tiles a remote empire controls. Persistence
  // comes from snapshot-owned planner memory and is deterministic on replay.
  if (localWarTargets.length > 0) {
    const preferred =
      memory.targetId !== null && localWarTargets.includes(memory.targetId)
        ? memory.targetId
        : localWarTargets[0];
    const enemyNearby = observation.visibleAssets.some(
      (asset) =>
        asset.ownerId === preferred &&
        (asset.kind === "army" || asset.kind === "warship"),
    );
    const defend = enemyNearby && self.landPercent <= 3;
    const decision: NationalDecision = {
      objective: defend ? "defend" : "expand",
      targetId: preferred,
      score: defend ? 100 : 80,
      rationale: defend ? "active-defense" : "reachable-opportunity",
    };
    return {
      planned: true,
      decision,
      memory: {
        ...memory,
        objective: decision.objective,
        targetId: decision.targetId,
        nextPlanningTick: observation.tick + cadenceTicks,
      },
    };
  }

  // AI-04: credible self-preservation beats elective aggression. Small
  // independent states expand into neutral land and preserve their standing
  // army. Members (AI-06) may expand similarly but cannot unilaterally
  // declare a war on behalf of their emperor.
  if (observation.unownedFrontier === true) {
    const decision: NationalDecision = {
      objective: "expand",
      targetId: null,
      score: 50,
      rationale: "reachable-opportunity",
    };
    return {
      planned: true,
      decision,
      memory: {
        ...memory,
        objective: decision.objective,
        targetId: null,
        nextPlanningTick: observation.tick + cadenceTicks,
      },
    };
  }

  let bestId: string | null = null;
  let bestScore = -Infinity;
  if (self.status === "independent" && observation.ownResources.troops >= 5_000) {
    for (const frontier of observation.frontiers) {
      if (frontier.access !== "land") continue;
      const target = publicNations.get(frontier.targetId);
      if (!target?.alive || protectedPartners.has(target.id)) continue;
      // Do not initiate a speculative war against a locally credible
      // superior force. The comparison uses PUBLIC land shares and the
      // existence of observed military units, never hidden troop balances.
      const seenMilitary = visibleMilitary.has(target.id);
      if (
        target.landPercent > Math.max(6, self.landPercent * 2.5) ||
        (self.landPercent <= 2 && seenMilitary)
      ) {
        continue;
      }
      const credibility = knownCredibility.get(target.id) ?? 0;
      const score =
        38 -
        Math.min(15, target.landPercent * 0.4) -
        (seenMilitary ? 8 : 0) -
        Math.max(0, credibility) +
        (memory.targetId === target.id ? 8 : 0);
      if (
        score > bestScore ||
        (score === bestScore &&
          (bestId === null || cmp(target.id, bestId) < 0))
      ) {
        bestId = target.id;
        bestScore = score;
      }
    }
  }

  const decision: NationalDecision =
    bestId !== null && bestScore > 12
      ? {
          objective: "expand",
          targetId: bestId,
          score: Math.round(bestScore * 100) / 100,
          rationale: "reachable-opportunity",
        }
      : {
          objective: "consolidate",
          targetId: null,
          score: 0,
          rationale: "preserve-options",
        };
  return {
    planned: true,
    decision,
    memory: {
      ...memory,
      objective: decision.objective,
      targetId: decision.targetId,
      nextPlanningTick: observation.tick + cadenceTicks,
    },
  };
}
