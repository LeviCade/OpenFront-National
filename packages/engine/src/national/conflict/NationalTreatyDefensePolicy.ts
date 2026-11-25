/** Approved MDA constitution terms, absent on inherited pacts and snapshots. */
export interface NationalTreatyDefenseTerms {
  readonly defenseContributionBps?: number;
  readonly defenseReserveBps?: number;
}

export function validateTreatyDefenseTerms(
  kind: "MDA" | "NAP",
  terms: NationalTreatyDefenseTerms,
): void {
  const { defenseContributionBps: cap, defenseReserveBps: reserve } = terms;
  if (
    (kind !== "MDA" && (cap !== undefined || reserve !== undefined)) ||
    (cap !== undefined && (!Number.isInteger(cap) || cap < 0 || cap > 1000)) ||
    (reserve !== undefined &&
      (!Number.isInteger(reserve) || reserve < 3000 || reserve > 10000))
  )
    throw new Error("NATIONAL: invalid treaty defense terms");
}

/** Multiple common MDAs never stack: the most protective treaty prevails. */
export function treatyDefensePolicy(
  pacts: readonly {
    kind: "MDA" | "NAP";
    memberIds: readonly string[];
    terms: NationalTreatyDefenseTerms;
  }[],
  defenderId: string,
  donorId: string,
  imperial: boolean,
): {
  maximumFraction: number;
  protectedCapacityFraction: number;
  treatyMaximumFraction?: number;
} {
  let cap = imperial ? 10000 : 1000;
  let reserve = 3000;
  let explicit = false;
  for (const pact of pacts) {
    if (
      pact.kind !== "MDA" ||
      !pact.memberIds.includes(defenderId) ||
      !pact.memberIds.includes(donorId)
    )
      continue;
    validateTreatyDefenseTerms(pact.kind, pact.terms);
    if (pact.terms.defenseContributionBps !== undefined) {
      explicit = true;
      cap = Math.min(cap, pact.terms.defenseContributionBps);
    } else if (!imperial) {
      cap = Math.min(cap, 1000);
    }
    reserve = Math.max(reserve, pact.terms.defenseReserveBps ?? 3000);
  }
  return {
    maximumFraction: cap / 10000,
    protectedCapacityFraction: reserve / 10000,
    ...(explicit ? { treatyMaximumFraction: cap / 10000 } : {}),
  };
}
