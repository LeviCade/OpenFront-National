import type { NationalEconomicDemandView } from "../../execution/NationalSanctionExecution";
import type { NationalObservation } from "../observation/NationalObservation";

/**
 * Only a nation's own operational trade information and its visible
 * diplomatic history. Not an omniscient foreign-economy read.
 */
export interface OwnEconomicTie {
  readonly partnerId: string;
  readonly tradePermitted: boolean;
  readonly activeOwnVoyages: number;
}

export type EconomicDecision =
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

/** No human/AI controller field exists in the inputs. */
export function planNationalEconomicDecision(
  observation: NationalObservation,
  demands: readonly NationalEconomicDemandView[],
  ties: readonly OwnEconomicTie[],
): EconomicDecision | null {
  const self = observation.observerId;
  const sorted = [...demands].sort(
    (a, b) => a.deadline - b.deadline || cmp(a.id, b.id),
  );
  const tradeValue = (ids: readonly string[]): number =>
    ties
      .filter((t) => ids.includes(t.partnerId) && t.tradePermitted)
      .reduce((sum, t) => sum + 1 + Math.min(8, t.activeOwnVoyages) * 3, 0);
  for (const d of sorted) {
    if (d.authorityId === null) continue;
    if (
      d.role === "issuer" &&
      d.authorityId === self &&
      d.phase === "decision-required"
    ) {
      // An issuer cannot assume coercion succeeds. Preserve actual trade
      // when the threatened embargo is more costly than its strategic reach.
      const cost = tradeValue(d.recipientIds);
      const strategicReach = observation.frontiers.some(
        (f) => f.targetId === d.target,
      )
        ? 3
        : 0;
      return {
        kind: "resolve",
        sanctionId: d.id,
        decision: cost <= strategicReach ? "enforce" : "back-down",
      };
    }
    if (
      d.role !== "recipient" ||
      !d.recipientIds.includes(self) ||
      d.phase !== "pending" ||
      d.response !== "none" ||
      d.deadline <= observation.tick + 1
    )
      continue;
    const issuerIds =
      d.empire === null
        ? [d.authorityId]
        : (observation.coalitions.find(
            (c) => c.kind === "empire" && c.id === d.empire,
          )?.members ?? [d.authorityId]);
    const lossOfIssuerTrade = tradeValue(issuerIds);
    const lossOfTargetTrade = tradeValue([d.target]);
    const history = sorted.filter(
      (past) =>
        past.id !== d.id &&
        past.role === "recipient" &&
        (d.empire === null
          ? past.empire === null && past.issuer === d.issuer
          : past.empire === d.empire),
    );
    // Only previously addressed outcomes are available. No global reputation
    // or automatic economic penalty follows a bluff.
    const credibility = Math.max(
      -6,
      Math.min(
        6,
        history.reduce(
          (score, past) =>
            score +
            (past.phase === "enforced"
              ? 2
              : past.phase === "backed-down"
                ? -3
                : 0),
          0,
        ),
      ),
    );
    const reach = observation.frontiers.some(
      (f) =>
        issuerIds.includes(f.targetId) &&
        observation.visibleAssets.some(
          (a) =>
            a.ownerId === f.targetId &&
            (f.access === "naval" ? a.kind === "warship" : a.kind === "army"),
        ),
    )
      ? 1
      : 0;
    return {
      kind: "respond",
      sanctionId: d.id,
      decision:
        lossOfIssuerTrade + credibility + reach > lossOfTargetTrade
          ? "comply"
          : "refuse",
    };
  }
  return null;
}
