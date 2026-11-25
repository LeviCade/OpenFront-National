import { coalitionEligibleExpellers } from "@openfront/engine-api/game/NationalCoalitionConstitution";
import type {
  NationalPactDisclosureViewData,
  NationalPactTerms,
  NationalPublicPactView,
} from "@openfront/engine-api/game/NationalPactView";
import type { Intent } from "@openfront/engine-api/Schemas";

export type PactIntent = Extract<
  Intent,
  {
    type:
      | "national_found_pact"
      | "national_invite_pact"
      | "national_accept_pact"
      | "national_betray_pact"
      | "national_propose_pact_amendment"
      | "national_approve_pact_amendment"
      | "national_expel_pact"
      | "national_found_pact_v2"
      | "national_propose_pact_amendment_v2"
      | "national_expel_pact_v2"
      | "national_reject_pact_amendment_v2";
  }
>;
export type PactAction = PactIntent extends infer T
  ? T extends PactIntent
    ? Omit<T, "requestId">
    : never
  : never;
type LegacyPactIntentType = Exclude<PactIntent["type"], `${string}_v2`>;
export function pactReceiptType(type: PactIntent["type"]): LegacyPactIntentType {
  switch (type) {
    case "national_found_pact_v2": return "national_found_pact";
    case "national_propose_pact_amendment_v2": return "national_propose_pact_amendment";
    case "national_expel_pact_v2": return "national_expel_pact";
    case "national_reject_pact_amendment_v2": return "national_approve_pact_amendment";
    default: return type;
  }
}

/** Keep old native payloads byte-compatible when no extended clause was selected. */
export function legacyPactTerms(terms: NationalPactTerms): Extract<Intent, {type: "national_found_pact"}>["terms"] | null {
  if (terms.membershipCap !== undefined || terms.invitationDurationTicks !== undefined ||
      terms.selectedExpellerIds !== undefined ||
      (terms.expulsion !== "leader" && terms.expulsion !== "unanimous" && terms.expulsion !== "forbidden"))
    return null;
  return { ...terms, expulsion: terms.expulsion };
}

export interface PactReceipt {
  type: LegacyPactIntentType | "national_imperial_administration";
  actorId: string;
  recipientId: string;
  requestId: string;
  commandTargetId: string;
  tick: number;
  sequence: number;
  accepted: boolean;
  reason: string;
}
const types = new Set<string>([
  "national_found_pact",
  "national_invite_pact",
  "national_accept_pact",
  "national_betray_pact",
  "national_propose_pact_amendment",
  "national_approve_pact_amendment",
  "national_expel_pact",
  "national_imperial_administration",
]);
export function readPactReceipts(
  input: unknown,
  actor: string | null,
  tick: number,
): PactReceipt[] {
  if (!actor || !Array.isArray(input)) return [];
  const out: PactReceipt[] = [];
  for (const v of input) {
    if (
      !v ||
      typeof v !== "object" ||
      !types.has(v.type) ||
      v.actorId !== actor ||
      v.recipientId !== actor ||
      typeof v.commandTargetId !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(v.commandTargetId) ||
      typeof v.requestId !== "string" ||
      !/^np_[0-9a-f]{32}$/.test(v.requestId) ||
      !Number.isSafeInteger(v.tick) ||
      v.tick < 0 ||
      v.tick > tick ||
      !Number.isSafeInteger(v.sequence) ||
      v.sequence < 0 ||
      typeof v.accepted !== "boolean" ||
      !["accepted", "actor-inactive", "political-rule"].includes(v.reason) ||
      v.accepted !== (v.reason === "accepted")
    )
      continue;
    out.push({
      type: v.type,
      actorId: actor,
      recipientId: actor,
      requestId: v.requestId,
      commandTargetId: v.commandTargetId,
      tick: v.tick,
      sequence: v.sequence,
      accepted: v.accepted,
      reason: v.reason,
    });
  }
  return out;
}
export function retainPactReceipts(
  previous: readonly PactReceipt[],
  incoming: readonly PactReceipt[],
  tick: number,
): PactReceipt[] {
  // Preserve contradictory receipts for the UI to reject, not first-wins.
  return [
    ...new Map(
      [...previous, ...incoming]
        .filter((v) => v.tick >= tick - 200 && v.tick <= tick)
        .map((v) => [JSON.stringify(v), v]),
    ).values(),
  ].slice(-512);
}
export interface PactContext {
  actor: string;
  roster: readonly NationalPublicPactView[];
  disclosure: NationalPactDisclosureViewData;
  independentCandidates: readonly string[];
}
export function pactActionAllowed(
  action: PactAction,
  context: PactContext,
): boolean {
  const { actor, roster, disclosure, independentCandidates } = context;
  if (
    disclosure.recipientId !== actor ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(action.pactId)
  )
    return false;
  const pact = roster.find((p) => p.id === action.pactId);
  const privateView = disclosure.pacts.find((p) => p.pactId === action.pactId);
  if (action.type === "national_found_pact" || action.type === "national_found_pact_v2")
    return !pact && action.name.trim().length > 0 && action.name.length <= 64;
  if (!pact || !privateView) return false;
  if (action.type === "national_accept_pact")
    return (
      privateView.relationship === "invited" &&
      !pact.memberIds.includes(actor) &&
      action.constitutionVersion === privateView.constitutionVersion
    );
  if (
    action.type === "national_invite_pact" &&
    action.admissionAction === "withdraw"
  )
    return (
      privateView.relationship === "invited" &&
      action.candidateId === actor &&
      privateView.constitutionVersion !== undefined &&
      action.constitutionVersion === privateView.constitutionVersion
    );
  if (privateView.relationship !== "member" || !pact.memberIds.includes(actor))
    return false;
  switch (action.type) {
    case "national_invite_pact": {
      if (
        !independentCandidates.includes(action.candidateId) ||
        pact.memberIds.includes(action.candidateId) ||
        (privateView.terms.membershipCap !== undefined && pact.memberIds.length >= privateView.terms.membershipCap)
      )
        return false;
      if (privateView.constitutionVersion === undefined)
        return (
          action.admissionAction === undefined &&
          action.constitutionVersion === undefined &&
          (privateView.terms.admission === "unanimous" ||
            pact.administratorId === actor)
        );
      if (
        action.constitutionVersion !== privateView.constitutionVersion ||
        (privateView.terms.admission === "selected" &&
          !privateView.terms.selectedApproverIds?.includes(actor)) ||
        (privateView.terms.admission === "leader" && pact.administratorId !== actor)
      )
        return false;
      const ballot = privateView.invitations?.find(
        (record) => record.targetId === action.candidateId,
      );
      return action.admissionAction === "approve"
        ? ballot !== undefined && !ballot.approvedBy.includes(actor)
        : action.admissionAction === "propose" && ballot === undefined;
    }
    case "national_betray_pact":
      return true;
    case "national_propose_pact_amendment_v2":
    case "national_propose_pact_amendment":
      return (
        !privateView.pendingAmendment &&
        (!("membershipCap" in action.terms) || action.terms.membershipCap === undefined || Number(action.terms.membershipCap) >= pact.memberIds.length) &&
        (action.administratorId === null ||
          pact.memberIds.includes(action.administratorId))
      );
    case "national_approve_pact_amendment":
      return (
        !!privateView.pendingAmendment &&
        action.expectedDefenseVersion ===
          privateView.pendingAmendment.defenseVersion &&
        !privateView.pendingAmendment.approvedBy.includes(actor)
      );
    case "national_reject_pact_amendment_v2":
      return !!privateView.pendingAmendment && action.expectedDefenseVersion === privateView.pendingAmendment.defenseVersion;
    case "national_expel_pact_v2":
      return privateView.extendedGovernance === true &&
        action.constitutionVersion === privateView.constitutionVersion &&
        pact.memberIds.includes(action.memberId) &&
        coalitionEligibleExpellers(privateView.terms, pact, action.memberId).includes(actor) &&
        !privateView.expulsionBallots?.find((b) => b.targetId === action.memberId)?.approvedBy.includes(actor);
    case "national_expel_pact":
      return (
        !privateView.extendedGovernance &&
        ((privateView.terms.expulsion === "leader" &&
          pact.administratorId === actor) ||
          (privateView.terms.expulsion === "unanimous" &&
            pact.memberIds.length === 2)) &&
        action.memberId !== actor &&
        pact.memberIds.includes(action.memberId)
      );
  }
}
/** Bind consent to the exact visible current constitution/proposal, not merely ID. */
export function pactConsentKey(context: PactContext, pactId: string): string {
  return JSON.stringify([
    context.roster.find((p) => p.id === pactId) ?? null,
    context.disclosure.pacts.find((p) => p.pactId === pactId) ?? null,
  ]);
}
export function reconcilePactReceipt(
  receipts: readonly PactReceipt[],
  attempt: {
    requestId: string;
    actorId: string;
    pactId: string;
    type: PactReceipt["type"];
    tick: number;
  },
  tick: number,
): "pending" | "accepted" | "rejected" | "conflict" | "unknown" {
  const matching = receipts.filter(
    (r) =>
      r.requestId === attempt.requestId &&
      r.actorId === attempt.actorId &&
      r.recipientId === attempt.actorId &&
      r.commandTargetId === attempt.pactId &&
      r.type === attempt.type &&
      r.tick >= attempt.tick &&
      r.tick <= tick,
  );
  const r = matching[0];
  if (r && matching.some((v) => JSON.stringify(v) !== JSON.stringify(r)))
    return "conflict";
  if (r) return r.accepted ? "accepted" : "rejected";
  return tick - attempt.tick >= 200 ? "unknown" : "pending";
}
