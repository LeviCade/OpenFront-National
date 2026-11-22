/**
 * AI sovereign diplomacy. The only inputs are the principal-filtered NATIONAL
 * observation and a bounded, snapshotted record of its OWN command outcomes.
 * No Game, Player, hidden troop balance, controllerKind, or foreign pact ballot.
 */
import type { NationalCommand } from "../NationalRuntime";
import type {
  NationalObservation,
  NationId,
} from "../observation/NationalObservation";
import type { NationalPoliticalCommandResult } from "../politics/NationalGovernanceState";
import { deriveNationalWarSides } from "./NationalPlanner";

export type AIPoliticalCommand = Exclude<NationalCommand, { kind: "found-empire" }>;
export type PoliticalReason =
  | "accept-mutual-defense"
  | "accept-nonaggression"
  | "offer-pact"
  | "invite-neighbor"
  | "renounce-hostile-pact"
  | "accept-safe-empire"
  | "seek-imperial-shelter"
  | "recruit-imperial-member"
  | "accept-viable-candidate"
  | "preserve-independence"
  | "serve-empire"
  | "preserve-sovereignty";

export interface AIPoliticalDecision {
  readonly command: AIPoliticalCommand | null;
  readonly reason: PoliticalReason;
}

export interface AIPoliticalMemory {
  readonly nextPlanningTick: number;
  readonly lastOutcomeSequence: number;
  readonly completedCommands: readonly string[];
  readonly rejectedCommands: readonly {
    readonly key: string;
    readonly retryAfterTick: number;
  }[];
}

export interface AIPoliticalPlan {
  readonly planned: boolean;
  readonly decision: AIPoliticalDecision | null;
  readonly memory: AIPoliticalMemory;
}

const compare = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
const MAX_HISTORY = 64;
const COMMAND_RETRY_TICKS = 180;

export function initialAIPoliticalMemory(): AIPoliticalMemory {
  return {
    nextPlanningTick: 0,
    lastOutcomeSequence: -1,
    completedCommands: [],
    rejectedCommands: [],
  };
}

export function politicalCommandKey(command: AIPoliticalCommand): string {
  return JSON.stringify(command);
}

function alreadyAttempted(
  command: AIPoliticalCommand,
  memory: AIPoliticalMemory,
): boolean {
  const key = politicalCommandKey(command);
  return (
    memory.completedCommands.includes(key) ||
    memory.rejectedCommands.some((entry) => entry.key === key)
  );
}

/**
 * Outcomes come from performNationalPoliticalCommandWithOutcome, not a
 * speculative intent. The execution bridge verifies the actor and target
 * before feeding this result back into replayable strategy memory.
 */
export function recordAIPoliticalOutcome(
  observation: NationalObservation,
  previous: AIPoliticalMemory,
  command: AIPoliticalCommand,
  outcome: NationalPoliticalCommandResult,
): AIPoliticalMemory {
  const targetId = "pactId" in command ? command.pactId : command.empireId;
  if (
    outcome.actorId !== observation.observerId ||
    outcome.recipientId !== observation.observerId ||
    outcome.commandKind !== command.kind ||
    outcome.commandTargetId !== targetId ||
    !Number.isSafeInteger(outcome.tick) ||
    outcome.tick > observation.tick ||
    outcome.tick < 0 ||
    !Number.isSafeInteger(outcome.sequence) ||
    outcome.sequence < 0
  )
    throw new Error("NATIONAL political AI: nonprincipal command result");
  if (outcome.sequence <= previous.lastOutcomeSequence) return previous;
  const key = politicalCommandKey(command);
  const rejectedCommands = previous.rejectedCommands
    .filter((entry) => entry.retryAfterTick > observation.tick && entry.key !== key);
  const completedCommands = [...previous.completedCommands];
  if (outcome.accepted) {
    // Only invitations have lasting issued-intent identity. A founding or
    // betrayal action is constrained by current authoritative pact membership.
    if (command.kind === "invite-pact" || command.kind === "offer-empire")
      completedCommands.push(key);
  } else {
    rejectedCommands.push({
      key,
      retryAfterTick: observation.tick + COMMAND_RETRY_TICKS,
    });
  }
  return {
    nextPlanningTick: observation.tick + (outcome.accepted ? 5 : 30),
    lastOutcomeSequence: outcome.sequence,
    completedCommands: [...new Set(completedCommands)].slice(-MAX_HISTORY),
    rejectedCommands: rejectedCommands
      .sort((a, b) => a.retryAfterTick - b.retryAfterTick || compare(a.key, b.key))
      .slice(-MAX_HISTORY),
  };
}

/** Stable, short Game-valid pact name derived from the actor's public ID. */
function pactId(observerId: string, kind: "NAP" | "MDA"): string {
  let hash = 2166136261;
  for (let i = 0; i < observerId.length; i++) {
    hash = Math.imul(hash ^ observerId.charCodeAt(i), 16777619);
  }
  return "ai_" + kind.toLowerCase() + "_" + (hash >>> 0).toString(36);
}

/**
 * Informed political decisions on the EXACT authorized per-principal
 * observation consumed by ordinary NATIONAL viewers. The decision is not
 * authority: GameImpl validates each emitted command again.
 */
export function planAIPoliticalInterest(
  observation: NationalObservation,
  previous: AIPoliticalMemory,
  cadenceTicks: number,
  reputation: readonly { readonly nationId: NationId; readonly credibility: number }[] = [],
): AIPoliticalPlan {
  if (!Number.isSafeInteger(cadenceTicks) || cadenceTicks < 1)
    throw new Error("NATIONAL political AI: invalid cadence");
  const memory: AIPoliticalMemory = {
    ...previous,
    rejectedCommands: previous.rejectedCommands.filter(
      (item) => item.retryAfterTick > observation.tick,
    ),
  };
  if (observation.tick < memory.nextPlanningTick)
    return { planned: false, decision: null, memory };
  const self = observation.nations.find((n) => n.id === observation.observerId);
  const result = (decision: AIPoliticalDecision): AIPoliticalPlan => ({
    planned: true,
    decision,
    memory: { ...memory, nextPlanningTick: observation.tick + cadenceTicks },
  });
  const idle = (reason: PoliticalReason): AIPoliticalPlan =>
    result({ command: null, reason });
  if (!self?.alive) return idle("preserve-sovereignty");

  const nations = new Map(observation.nations.map((n) => [n.id, n]));
  const warSides = deriveNationalWarSides(observation.wars, self.id);
  const frontiers = [...new Set(
    observation.frontiers
      .filter((f) => f.access === "land" && nations.get(f.targetId)?.alive)
      .map((f) => f.targetId),
  )].sort(compare);
  const reputationById = new Map(
    reputation.map((entry) => [entry.nationId, entry.credibility]),
  );
  const seenMilitary = new Set(
    observation.visibleAssets
      .filter((a) => a.kind === "army" || a.kind === "warship")
      .map((a) => a.ownerId),
  );
  const credibleThreats = frontiers.filter((id) => {
    const other = nations.get(id)!;
    return (
      warSides.enemies.has(id) ||
      (seenMilitary.has(id) &&
        other.landPercent >= Math.max(0.25, self.landPercent * 1.5))
    );
  });
  const greatestThreat = Math.max(
    0,
    ...credibleThreats.map((id) => nations.get(id)?.landPercent ?? 0),
  );
  const existential = credibleThreats.some(
    (id) =>
      warSides.enemies.has(id) ||
      (nations.get(id)?.landPercent ?? 0) >=
        Math.max(0.25, self.landPercent * 1.5),
  );
  const viableIndependence =
    !existential &&
    (observation.unownedFrontier === true ||
      (observation.ownResources.troops >= 4_000 &&
        self.landPercent >= 0.4));
  const empires = observation.coalitions
    .filter((p) => p.kind === "empire")
    .sort((a, b) => compare(a.id, b.id));
  const empireLand = (members: readonly string[]): number =>
    members.reduce((total, id) => total + (nations.get(id)?.landPercent ?? 0), 0);
  const safeEmpire = (empire: (typeof empires)[number]): boolean =>
    empireLand(empire.members) >= Math.max(0.25, greatestThreat * 0.7) &&
    !empire.members.some((id) => warSides.enemies.has(id));

  const myEmpire = empires.find((e) => e.members.includes(self.id));
  if (myEmpire) {
    // Imperial members never try to secede. Their military expansion into
    // unowned land continues through the pre-existing NationExecution loop.
    if (myEmpire.leaderId !== self.id) return idle("serve-empire");
    // As emperor, handle a candidate's explicitly addressed consent offer.
    for (const offer of [...(observation.imperialOffers ?? [])].sort(
      (a, b) => compare(a.candidateId, b.candidateId),
    )) {
      const candidate = nations.get(offer.candidateId);
      if (
        offer.empireId !== myEmpire.id ||
        offer.recipientId !== self.id ||
        offer.proposerId !== offer.candidateId ||
        !candidate?.alive ||
        candidate.status !== "independent" ||
        candidate.landPercent <= 0
      ) continue;
      const command: AIPoliticalCommand = {
        kind: "accept-empire",
        empireId: myEmpire.id,
        candidateId: offer.candidateId,
      };
      if (!alreadyAttempted(command, memory))
        return result({ command, reason: "accept-viable-candidate" });
    }
    // Recruitment gives the empire an actual path to the last-power victory.
    for (const targetId of frontiers) {
      const candidate = nations.get(targetId)!;
      if (
        candidate.status !== "independent" ||
        candidate.landPercent <= 0 ||
        warSides.enemies.has(targetId) ||
        (reputationById.get(targetId) ?? 0) < -2
      ) continue;
      const command: AIPoliticalCommand = {
        kind: "offer-empire",
        empireId: myEmpire.id,
        candidateId: targetId,
      };
      if (!alreadyAttempted(command, memory))
        return result({ command, reason: "recruit-imperial-member" });
    }
    return idle("serve-empire");
  }

  // An independent sovereign may renounce its own bad treaty, but cannot
  // attack inside a still-active pact. Each Betray is a validated transition;
  // offensive WAR must be declared separately on a later observation.
  for (const pact of observation.coalitions
    .filter((c) => (c.kind === "nap" || c.kind === "mda") && c.members.includes(self.id))
    .sort((a, b) => compare(a.id, b.id))) {
    const hostile = pact.members
      .filter((id) =>
        id !== self.id &&
        frontiers.includes(id) &&
        ((reputationById.get(id) ?? 0) <= -3 ||
          (observation.ownResources.troops >= 40_000 &&
            self.landPercent >= (nations.get(id)?.landPercent ?? Infinity) * 3)) &&
        (nations.get(id)?.landPercent ?? Infinity) <=
          Math.max(1, self.landPercent * 1.5) &&
        observation.ownResources.troops >= 1_000 &&
        observation.unownedFrontier !== true,
      )
      .sort(compare);
    if (hostile.length === 0) continue;
    const command: AIPoliticalCommand = { kind: "betray-pact", pactId: pact.id };
    if (!alreadyAttempted(command, memory))
      return result({ command, reason: "renounce-hostile-pact" });
  }

  // Offers are addressed to the candidate; never discover foreign offers.
  for (const offer of [...(observation.imperialOffers ?? [])].sort(
    (a, b) => compare(a.empireId, b.empireId),
  )) {
    if (offer.recipientId !== self.id || offer.candidateId !== self.id)
      continue;
    const empire = empires.find((e) => e.id === offer.empireId);
    if (!empire || !existential || !safeEmpire(empire)) continue;
    const command: AIPoliticalCommand = {
      kind: "accept-empire",
      empireId: offer.empireId,
      candidateId: self.id,
    };
    if (!alreadyAttempted(command, memory))
      return result({ command, reason: "accept-safe-empire" });
  }
  // An unthreatened small state can still be a viable independent power.
  // A refusal is a deliberate *non-acceptance*. The current constitution
  // offers no decline-empire transition and this planner may not invent one.
  if ((observation.imperialOffers ?? []).some((o) => o.candidateId === self.id) &&
      viableIndependence)
    return idle("preserve-independence");

  // With credible danger but no offer, seek consent instead of auto-joining.
  if (existential) {
    for (const empire of empires) {
      if (!safeEmpire(empire)) continue;
      const command: AIPoliticalCommand = {
        kind: "offer-empire",
        empireId: empire.id,
        candidateId: self.id,
      };
      if (!alreadyAttempted(command, memory))
        return result({ command, reason: "seek-imperial-shelter" });
    }
  }

  for (const pact of observation.coalitions
    .filter((p) => (p.kind === "nap" || p.kind === "mda") && p.invited)
    .sort((a, b) => compare(a.id, b.id))) {
    if (
      !pact.terms ||
      pact.members.some((id) => warSides.enemies.has(id)) ||
      pact.members.every((id) => !frontiers.includes(id))
    ) continue;
    const command: AIPoliticalCommand = { kind: "accept-pact", pactId: pact.id };
    if (!alreadyAttempted(command, memory))
      return result({
        command,
        reason: pact.kind === "mda" ? "accept-mutual-defense" : "accept-nonaggression",
      });
  }

  const ownPacts = observation.coalitions
    .filter((p) => (p.kind === "nap" || p.kind === "mda") && p.members.includes(self.id))
    .sort((a, b) => compare(a.id, b.id));
  for (const pact of ownPacts) {
    for (const targetId of frontiers) {
      const target = nations.get(targetId)!;
      if (
        target.status !== "independent" ||
        pact.members.includes(targetId) ||
        pact.pendingInvitees?.includes(targetId) ||
        warSides.enemies.has(targetId) ||
        (reputationById.get(targetId) ?? 0) < -2
      ) continue;
      const command: AIPoliticalCommand = {
        kind: "invite-pact",
        pactId: pact.id,
        candidateId: targetId,
      };
      if (!alreadyAttempted(command, memory))
        return result({ command, reason: "invite-neighbor" });
    }
  }
  // One pact per country until genuine admissions change the opportunity.
  if (ownPacts.length === 0) {
    const neighbor = frontiers.find((id) => {
      const target = nations.get(id)!;
      return target.status === "independent" &&
        !warSides.enemies.has(id) &&
        (reputationById.get(id) ?? 0) >= -2;
    });
    if (neighbor !== undefined) {
      const kind = existential ? "MDA" : "NAP";
      const command: AIPoliticalCommand = {
        kind: "found-pact",
        pactId: pactId(self.id, kind),
        name: kind === "MDA" ? "Mutual Defence" : "Nonaggression",
        pactKind: kind,
        terms: { admission: "leader", expulsion: "forbidden" },
      };
      if (!alreadyAttempted(command, memory))
        return result({ command, reason: "offer-pact" });
    }
  }
  return idle("preserve-sovereignty");
}
