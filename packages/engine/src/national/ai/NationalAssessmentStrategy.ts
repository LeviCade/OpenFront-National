import type { NationalObservation } from "../observation/NationalObservation";
import { deriveNationalWarSides } from "./NationalPlanner";

/**
 * C6 E5: observation-only policy for the distinct 1,200-gold national
 * assessment. E4 alone owns the Game payment, receipt and recipient projector.
 * This narrow structural DTO keeps this independently reviewed lane compilable
 * before the Conductor integrates E4's authoritative engine implementation.
 */
export interface PaidNationalAssessmentBand {
  readonly lower: string;
  readonly upperExclusive: string;
}

export interface PaidNationalAssessmentView {
  readonly targetId: string;
  readonly paidBy: string;
  readonly effectiveTick: number;
  readonly expiresAtTick: number;
  readonly confidence: string;
  readonly treasuryGoldBand: PaidNationalAssessmentBand;
  readonly militaryTroopsBand: PaidNationalAssessmentBand;
}

export type AssessmentObservation = NationalObservation & {
  readonly assessments?: readonly PaidNationalAssessmentView[];
};

export interface NationalAssessmentAIAttempt {
  readonly targetId: string;
  readonly requestId: string;
  readonly purchasedTick: number;
  readonly expiresAtTick: number;
  readonly outcome: "accepted" | "rejected";
}

export interface NationalAssessmentAIMemory {
  readonly observerId: string;
  readonly nextDecisionTick: number;
  readonly attempts: readonly NationalAssessmentAIAttempt[];
}

export interface NationalAssessmentAIDecision {
  readonly memory: NationalAssessmentAIMemory;
  readonly purchase: { readonly targetId: string } | null;
  /** A tactical delay, NEVER permission to change the legal WAR ledger. */
  readonly holdOffenseAgainst: string | null;
}

export const AI_NATIONAL_ASSESSMENT_COST = 1_200;
const SURVIVAL_GOLD_RESERVE = 2_500;
const MIN_SURVIVAL_TROOPS = 1_000;
const MAX_ATTEMPTS = 3;
const PURCHASE_COOLDOWN_TICKS = 960;
const REJECTION_COOLDOWN_TICKS = 180;
const TACTICAL_REASSESS_TICKS = 90;

export function initialNationalAssessmentAIMemory(
  observerId: string,
): NationalAssessmentAIMemory {
  return { observerId, nextDecisionTick: 0, attempts: [] };
}

function decimalBound(raw: unknown): bigint | null {
  // Reject hostile or unbounded report strings instead of parsing arbitrary
  // precision or interpreting widened E4 shield bands as precise numbers.
  if (typeof raw !== "string" || !/^(0|[1-9][0-9]{0,29})$/.test(raw))
    return null;
  return BigInt(raw);
}

function eligibleReport(
  observation: AssessmentObservation,
  attempt: NationalAssessmentAIAttempt,
): PaidNationalAssessmentView | null {
  if (
    attempt.outcome !== "accepted" ||
    observation.tick < attempt.purchasedTick ||
    observation.tick >= attempt.expiresAtTick ||
    observation.tick >= attempt.purchasedTick + TACTICAL_REASSESS_TICKS
  )
    return null;
  const report = observation.assessments?.find(
    (r) =>
      r.targetId === attempt.targetId &&
      r.paidBy === observation.observerId &&
      r.effectiveTick === attempt.purchasedTick &&
      r.expiresAtTick === attempt.expiresAtTick,
  );
  if (
    report === undefined ||
    typeof report.confidence !== "string" ||
    (report.confidence !== "coarse-estimate" &&
      !report.confidence.startsWith("shielded-"))
  )
    return null;
  const troopLow = decimalBound(report.militaryTroopsBand?.lower);
  const troopHigh = decimalBound(report.militaryTroopsBand?.upperExclusive);
  const goldLow = decimalBound(report.treasuryGoldBand?.lower);
  const goldHigh = decimalBound(report.treasuryGoldBand?.upperExclusive);
  if (
    troopLow === null ||
    troopHigh === null ||
    goldLow === null ||
    goldHigh === null ||
    troopHigh <= troopLow ||
    goldHigh <= goldLow
  )
    return null;
  return report;
}

/**
 * The only foreign inputs are authenticated, recipient-scoped observation
 * fields. Neither the planner nor this memory receives Game/Player objects,
 * raw enemy treasury/troops, hidden units, or privileged map geometry.
 */
export function planNationalAssessment(
  observation: AssessmentObservation,
  previous: NationalAssessmentAIMemory,
): NationalAssessmentAIDecision {
  if (observation.observerId !== previous.observerId)
    throw new Error("NATIONAL assessment AI: principal mismatch");

  const self = observation.nations.find(
    (n) => n.id === observation.observerId,
  );
  const sides = deriveNationalWarSides(
    observation.wars,
    observation.observerId,
  );
  const protectedPartners = new Set(sides.allies);
  for (const coalition of observation.coalitions) {
    if (coalition.members.includes(observation.observerId)) {
      for (const member of coalition.members) protectedPartners.add(member);
    }
  }

  const potentialTargets = observation.frontiers
    .filter(
      (f) =>
        f.access === "land" &&
        f.targetId !== observation.observerId &&
        sides.enemies.has(f.targetId) &&
        !protectedPartners.has(f.targetId) &&
        observation.nations.some((n) => n.id === f.targetId && n.alive),
    )
    .map((f) => f.targetId)
    .sort();
  const enemies = [...new Set(potentialTargets)];
  let holdOffenseAgainst: string | null = null;

  if (
    self?.alive &&
    self.status === "independent" &&
    Number.isSafeInteger(observation.ownResources.troops) &&
    observation.ownResources.troops >= MIN_SURVIVAL_TROOPS
  ) {
    for (const targetId of enemies) {
      const attempts = previous.attempts.filter(
        (a) => a.targetId === targetId,
      );
      const matching = attempts
        .map((a) => eligibleReport(observation, a))
        .find((r) => r !== null);
      if (!matching) continue;
      const upper = decimalBound(matching.militaryTroopsBand.upperExclusive);
      if (
        upper !== null &&
        // A widened shield may produce a weaker lower bound. Use the
        // upper bound ONLY to justify conservation, never to claim a win.
        upper >= BigInt(observation.ownResources.troops) * 2n
      ) {
        holdOffenseAgainst = targetId;
        break;
      }
    }
  }

  const memory: NationalAssessmentAIMemory = {
    observerId: previous.observerId,
    nextDecisionTick: previous.nextDecisionTick,
    attempts: previous.attempts,
  };
  if (
    !self?.alive ||
    self.status !== "independent" ||
    observation.unownedFrontier === true ||
    !Number.isSafeInteger(observation.ownResources.treasury) ||
    !Number.isSafeInteger(observation.ownResources.troops) ||
    observation.ownResources.treasury <
      AI_NATIONAL_ASSESSMENT_COST + SURVIVAL_GOLD_RESERVE ||
    observation.ownResources.troops < MIN_SURVIVAL_TROOPS ||
    observation.tick < memory.nextDecisionTick ||
    memory.attempts.length >= MAX_ATTEMPTS
  )
    return { memory, purchase: null, holdOffenseAgainst };

  const target = enemies.find(
    (id) =>
      !memory.attempts.some((a) => a.targetId === id) &&
      // Real sight, not a coordinate guessed from foreign Game state. No
      // regional recon is bought or credited by this separate proposal.
      observation.visibleAssets.some(
        (asset) => asset.ownerId === id && asset.kind === "structure",
      ),
  );

  return {
    memory,
    purchase: target === undefined ? null : { targetId: target },
    holdOffenseAgainst,
  };
}

/** Persist exactly one actual Game purchase outcome; denied calls grant no intel. */
export function recordNationalAssessmentAttempt(
  observation: AssessmentObservation,
  previous: NationalAssessmentAIMemory,
  targetId: string,
  requestId: string,
  expiresAtTick: number | null,
): NationalAssessmentAIMemory {
  if (observation.observerId !== previous.observerId)
    throw new Error("NATIONAL assessment AI: principal mismatch");
  if (
    previous.attempts.length >= MAX_ATTEMPTS ||
    previous.attempts.some((a) => a.requestId === requestId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(requestId) ||
    targetId === observation.observerId
  )
    throw new Error("NATIONAL assessment AI: invalid or duplicate attempt");
  if (
    expiresAtTick !== null &&
    (expiresAtTick <= observation.tick ||
      !Number.isSafeInteger(expiresAtTick))
  )
    throw new Error("NATIONAL assessment AI: invalid authoritative expiry");

  const accepted = expiresAtTick !== null;
  return {
    observerId: previous.observerId,
    nextDecisionTick:
      observation.tick +
      (accepted ? PURCHASE_COOLDOWN_TICKS : REJECTION_COOLDOWN_TICKS),
    attempts: [
      ...previous.attempts,
      {
        targetId,
        requestId,
        purchasedTick: observation.tick,
        expiresAtTick: expiresAtTick ?? observation.tick,
        outcome: accepted ? "accepted" : "rejected",
      },
    ],
  };
}
