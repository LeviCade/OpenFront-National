/**
 * Candidate-neutral NATIONAL strategic planner (D-002; AI-01, AI-02, AI-04).
 * This module has no Game/Player imports: it cannot query hidden state.
 * Suggestions are NOT executions; conductor-owned command validators decide
 * legality, cost and actual effects when NATIONAL is wired into M0.
 */
import type {
  NationId,
  NationalObservation,
  PublicDiplomaticEventKind,
} from "../observation/NationalObservation";

export type NationalObjective = "defend" | "expand" | "consolidate";
export interface DiplomaticReputation {
  readonly nationId: NationId;
  readonly credibility: number;
}
export interface NationalPlannerMemory {
  readonly observerId: NationId;
  readonly objective: NationalObjective;
  readonly targetId: NationId | null;
  readonly nextPlanningTick: number;
  readonly processedEvents: readonly string[];
  readonly reputation: readonly DiplomaticReputation[];
}
export interface NationalDecision {
  readonly objective: NationalObjective;
  readonly targetId: NationId | null;
  readonly score: number;
  readonly rationale: "active-defense" | "reachable-opportunity" | "preserve-options";
}
export interface NationalPlanResult {
  readonly planned: boolean;
  readonly decision: NationalDecision | null;
  readonly memory: NationalPlannerMemory;
}

const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const EVENT_LIMIT = 128;
const REPUTATION_LIMIT = 128;
const clamp = (n: number): number => Math.max(-10, Math.min(10, n));
const weight: Record<PublicDiplomaticEventKind, number> = {
  "treaty-kept": 1,
  "treaty-broken": -4,
  "threat-fulfilled": 2,
  "bluff-exposed": -3,
};

export function initialNationalPlannerMemory(observerId: NationId): NationalPlannerMemory {
  return {
    observerId,
    objective: "consolidate",
    targetId: null,
    nextPlanningTick: 0,
    processedEvents: [],
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
  const seen = new Set(memory.processedEvents);
  const processed = [...memory.processedEvents];
  const reputation = new Map(memory.reputation.map((r) => [r.nationId, r.credibility]));
  let sawNewEvent = false;
  for (const e of observation.diplomaticEvents) {
    if (e.tick > observation.tick || seen.has(e.id)) continue;
    seen.add(e.id);
    processed.push(e.id);
    sawNewEvent = true;
    reputation.set(e.actorId, clamp((reputation.get(e.actorId) ?? 0) + weight[e.kind]));
  }
  const trimmed = processed.slice(-EVENT_LIMIT);
  const sortedReputation = [...reputation].sort((a, b) => cmp(a[0], b[0]))
    .slice(0, REPUTATION_LIMIT)
    .map(([nationId, credibility]) => ({ nationId, credibility }));
  return {
    sawNewEvent,
    memory: { ...memory, processedEvents: trimmed, reputation: sortedReputation },
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
    return { planned: true, decision: { objective: "consolidate", targetId: null, score: 0, rationale: "preserve-options" },
      memory: { ...memory, objective: "consolidate", targetId: null, nextPlanningTick: observation.tick + cadenceTicks } };
  }

  const publicNations = new Map(observation.nations.map((n) => [n.id, n]));
  const enemiesAtWar = new Set<string>();
  for (const war of observation.wars) {
    if (!war.participants.includes(self.id)) continue;
    for (const id of war.participants) if (id !== self.id) enemiesAtWar.add(id);
  }
  const closeThreat = observation.visibleAssets.some(
    (a) => a.ownerId !== self.id && enemiesAtWar.has(a.ownerId),
  );
  if (closeThreat && self.landPercent <= 3) {
    const decision: NationalDecision = { objective: "defend", targetId: null, score: 100, rationale: "active-defense" };
    return {
      planned: true, decision,
      memory: { ...memory, objective: decision.objective, targetId: null, nextPlanningTick: observation.tick + cadenceTicks },
    };
  }

  const knownCredibility = new Map(memory.reputation.map((r) => [r.nationId, r.credibility]));
  const visibleMilitary = new Set(
    observation.visibleAssets
      .filter((a) => a.kind === "army" || a.kind === "warship")
      .map((a) => a.ownerId),
  );
  const protectedPartners = new Set<string>();
  for (const c of observation.coalitions) {
    if (c.members.includes(self.id)) for (const id of c.members) protectedPartners.add(id);
  }

  let bestId: string | null = null;
  let bestScore = -Infinity;
  // One linear pass. No access to type/control or secret enemy resources.
  for (const frontier of observation.frontiers) {
    const target = publicNations.get(frontier.targetId);
    if (!target || !target.alive || target.status === "eliminated") continue;
    // Existing coalitions cannot become ordinary offensive targets.
    if (protectedPartners.has(target.id)) continue;
    const credibility = knownCredibility.get(target.id) ?? 0;
    const seenMilitary = visibleMilitary.has(target.id);
    const score =
      22 +
      (frontier.access === "land" ? 8 : 0) +
      (enemiesAtWar.has(target.id) ? 10 : 0) -
      Math.min(20, target.landPercent * 0.7) -
      (seenMilitary ? 9 : 0) -
      Math.max(0, credibility);
    if (score > bestScore || (score === bestScore && (bestId === null || cmp(target.id, bestId) < 0))) {
      bestId = target.id;
      bestScore = score;
    }
  }
  const decision: NationalDecision = bestId !== null && bestScore > 9
    ? { objective: "expand", targetId: bestId, score: Math.round(bestScore * 100) / 100, rationale: "reachable-opportunity" }
    : { objective: "consolidate", targetId: null, score: 0, rationale: "preserve-options" };
  return {
    planned: true, decision,
    memory: {
      ...memory,
      objective: decision.objective,
      targetId: decision.targetId,
      nextPlanningTick: observation.tick + cadenceTicks,
    },
  };
}
