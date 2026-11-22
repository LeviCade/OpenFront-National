import type { NationalEconomicDemandView } from "../../execution/NationalSanctionExecution";
import type { NationalObservation } from "../observation/NationalObservation";
import { deriveNationalWarSides } from "./NationalPlanner";

/** The AI only gets its own live trading permissions and dispatched voyages. */
export interface OwnEconomicTie {
  readonly partnerId: string;
  readonly tradePermitted: boolean;
  readonly activeOwnVoyages: number;
}

export interface EconomicCredibility {
  readonly issuerId: string;
  readonly score: number;
  readonly lastObservedTick: number;
}

/** Stored with NationExecution, not in global or foreign-private state. */
export interface NationalEconomicMemory {
  readonly observerId: string;
  readonly processedDemandIds: readonly string[];
  readonly credibility: readonly EconomicCredibility[];
}

export type EconomicDecision =
  | {
      readonly kind: "issue";
      readonly scope: "national" | "imperial";
      readonly targetId: string;
      readonly recipientIds: readonly string[];
      readonly durationTicks: number;
    }
  | {
      readonly kind: "respond";
      readonly sanctionId: string;
      readonly decision: "comply" | "refuse";
    }
  | {
      readonly kind: "resolve";
      readonly sanctionId: string;
      readonly decision: "enforce" | "back-down";
    };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const clamp = (n: number) => Math.max(-6, Math.min(6, n));
const MEMORY_LIMIT = 128; // Canonical demand ledger itself is bounded to 128.
const ISSUER_LIMIT = 16;

export function initialNationalEconomicMemory(observerId: string): NationalEconomicMemory {
  return { observerId, processedDemandIds: [], credibility: [] };
}

/**
 * Learns from terminal, personally addressed demand projections only.
 * An issuer cannot forge proof of a threat, and an unrelated nation cannot
 * learn a confidential recipient outcome. Each demand is scored only once.
 */
export function updateNationalEconomicMemory(
  observation: NationalObservation,
  demands: readonly NationalEconomicDemandView[],
  previous: NationalEconomicMemory,
): NationalEconomicMemory {
  if (observation.observerId !== previous.observerId)
    throw new Error("Economic memory principal mismatch");
  const processed = new Set(previous.processedDemandIds);
  const reputation = new Map(previous.credibility.map((r) => [r.issuerId, r]));
  for (const demand of [...demands].sort((a, b) => a.deadline - b.deadline || cmp(a.id, b.id))) {
    if (demand.role !== "recipient" || !demand.recipientIds.includes(observation.observerId))
      continue;
    if (processed.has(demand.id) || !["enforced", "backed-down"].includes(demand.phase))
      continue;
    processed.add(demand.id);
    const issuerId = demand.authorityId ?? demand.issuer;
    const prior = reputation.get(issuerId);
    reputation.set(issuerId, {
      issuerId,
      score: clamp((prior?.score ?? 0) + (demand.phase === "enforced" ? 2 : -3)),
      lastObservedTick: observation.tick,
    });
  }
  return {
    observerId: previous.observerId,
    processedDemandIds: [...processed].sort(cmp).slice(-MEMORY_LIMIT),
    credibility: [...reputation.values()]
      .sort((a, b) => b.lastObservedTick - a.lastObservedTick || cmp(a.issuerId, b.issuerId))
      .slice(0, ISSUER_LIMIT)
      .sort((a, b) => cmp(a.issuerId, b.issuerId)),
  };
}

function hasReach(observation: NationalObservation, target: string): boolean {
  return observation.frontiers.some((f) =>
    f.targetId === target &&
    (f.access === "land" ||
      (f.access === "naval" && observation.visibleAssets.some(
        (asset) => asset.ownerId === observation.observerId && asset.kind === "warship",
      ))),
  );
}

/** Decisions are pure and ordered by observed deadline/ID, never hidden controller kind. */
export function planNationalEconomicDecision(
  observation: NationalObservation,
  demands: readonly NationalEconomicDemandView[],
  ties: readonly OwnEconomicTie[],
  memory: NationalEconomicMemory = initialNationalEconomicMemory(observation.observerId),
): EconomicDecision | null {
  const self = observation.observerId;
  if (memory.observerId !== self) throw new Error("Economic principal mismatch");
  const sorted = [...demands].sort((a, b) => a.deadline - b.deadline || cmp(a.id, b.id));
  const tradeValue = (ids: readonly string[]): number =>
    ties.filter((t) => ids.includes(t.partnerId) && t.tradePermitted)
      .reduce((sum, t) => sum + 1 + Math.min(8, t.activeOwnVoyages) * 3, 0);

  for (const d of sorted) {
    if (d.authorityId === null) continue;
    if (d.role === "issuer" && d.authorityId === self && d.phase === "decision-required") {
      // An embargo is expensive if we rely more on the recipient than on the
      // strategic objective. A bluff is explicitly visible to its recipients.
      const cost = tradeValue(d.recipientIds);
      const enemies = deriveNationalWarSides(observation.wars, self).enemies;
      const strategicReach = enemies.has(d.target) && hasReach(observation, d.target) ? 8 : 0;
      return {
        kind: "resolve",
        sanctionId: d.id,
        decision: cost <= strategicReach ? "enforce" : "back-down",
      };
    }
    if (
      d.role !== "recipient" || !d.recipientIds.includes(self) ||
      d.phase !== "pending" || d.response !== "none" || d.deadline <= observation.tick + 1
    ) continue;
    const issuerIds = d.empire === null ? [d.authorityId] :
      observation.coalitions.find((c) => c.kind === "empire" && c.id === d.empire)?.members ?? [d.authorityId];
    const lossOfIssuerTrade = tradeValue(issuerIds);
    const lossOfTargetTrade = tradeValue([d.target]);
    const remembered = memory.credibility.find((r) => r.issuerId === d.authorityId);
    // Legacy callers without persistent memory continue to see their
    // personally addressed, still-retained sanction history.
    const history = sorted.filter((past) =>
      past.id !== d.id && past.role === "recipient" &&
      (d.empire === null
        ? past.empire === null && past.issuer === d.issuer
        : past.empire === d.empire));
    const credibility = remembered?.score ?? clamp(history.reduce((score, past) =>
      score + (past.phase === "enforced" ? 2 : past.phase === "backed-down" ? -3 : 0), 0));
    const reach = issuerIds.some((id) => hasReach(observation, id)) ? 1 : 0;
    return {
      kind: "respond",
      sanctionId: d.id,
      decision: lossOfIssuerTrade + credibility + reach > lossOfTargetTrade
        ? "comply" : "refuse",
    };
  }

  // Actual issuer autonomy: observed war interest + witnessed viable trade
  // leverage. A remote land ranking does not justify a threat. A subordinate
  // cannot bind its empire; the current public emperor may use imperial scope.
  const own = observation.nations.find((n) => n.id === self);
  if (!own?.alive || own.status === "member" || own.status === "eliminated")
    return null;
  const ownEmpire = observation.coalitions.find(
    (c) => c.kind === "empire" && c.members.includes(self),
  );
  if (own.status === "imperial" && (!ownEmpire || ownEmpire.leaderId !== self))
    return null;
  if (own.status === "independent" && ownEmpire) return null;
  // Never multiply unfinished threats or issue repeatedly during the
  // decision window. Observe a real issuer record before issuing again.
  if (sorted.some((d) => d.role === "issuer" && (
    d.phase === "pending" || d.phase === "decision-required" ||
    observation.tick < d.deadline + 90
  ))) return null;
  const warSides = deriveNationalWarSides(observation.wars, self);
  const protectedIds = new Set(warSides.allies);
  for (const coalition of observation.coalitions) {
    if (coalition.members.includes(self)) {
      for (const memberId of coalition.members) protectedIds.add(memberId);
    }
  }
  const targets = [...warSides.enemies].filter((id) =>
    !protectedIds.has(id) && hasReach(observation, id) &&
    observation.nations.some((n) => n.id === id && n.alive),
  ).sort(cmp);
  if (targets.length === 0) return null;
  const recipients = [...ties].filter((tie) =>
    tie.tradePermitted && tie.activeOwnVoyages > 0 &&
    tie.partnerId !== self &&
    !warSides.enemies.has(tie.partnerId) &&
    !protectedIds.has(tie.partnerId) &&
    observation.nations.some((n) => n.id === tie.partnerId && n.alive && n.status === "independent"),
  ).sort((a, b) => b.activeOwnVoyages - a.activeOwnVoyages || cmp(a.partnerId, b.partnerId));
  if (recipients.length === 0) return null;
  return {
    kind: "issue",
    scope: own.status === "imperial" ? "imperial" : "national",
    targetId: targets[0],
    recipientIds: [recipients[0].partnerId],
    durationTicks: 30,
  };
}
