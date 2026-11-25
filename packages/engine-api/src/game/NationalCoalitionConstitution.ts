import type {
  NationalPactTerms,
  NationalPublicPactView,
} from "./NationalPactView";

/** C7 constitutional extensions are private, opt-in, and do not change legacy defaults. */
export function extendedCoalitionTerms(terms: NationalPactTerms): boolean {
  return (
    terms.membershipCap !== undefined ||
    terms.invitationDurationTicks !== undefined ||
    terms.expulsion === "selected" ||
    terms.expulsion === "majority" ||
    terms.expulsion === "supermajority"
  );
}

export function boundedCoalitionInteger(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

export function coalitionEligibleExpellers(
  terms: NationalPactTerms,
  pact: NationalPublicPactView,
  targetId: string,
): string[] {
  if (terms.expulsion === "forbidden") return [];
  const voters =
    terms.expulsion === "leader"
      ? pact.administratorId === null
        ? []
        : [pact.administratorId]
      : terms.expulsion === "selected"
        ? (terms.selectedExpellerIds ?? [])
        : pact.memberIds;
  return voters.filter((id) => id !== targetId && pact.memberIds.includes(id));
}

export function coalitionExpulsionThreshold(
  terms: NationalPactTerms,
  count: number,
): number {
  if (count === 0) return 1;
  if (terms.expulsion === "majority") return Math.floor(count / 2) + 1;
  if (terms.expulsion === "supermajority") return Math.ceil((count * 2) / 3);
  return count;
}
