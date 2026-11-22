/** D-011/D-012: integer-only treasury routing and dissolution allocation. */
export function splitWorkerIncome(gross: bigint, basisPoints: number): {
  personal: bigint;
  imperial: bigint;
} {
  if (gross < 0n || !Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000)
    throw new Error("NATIONAL: invalid worker income or treasury rate");
  const imperial = gross * BigInt(basisPoints) / 10_000n;
  return { personal: gross - imperial, imperial };
}

export function distributeImperialGold(
  balance: bigint,
  formerLeaderId: string,
  survivingMemberIds: readonly string[],
): { credits: Map<string, bigint>; unclaimed: bigint } {
  if (balance < 0n || new Set(survivingMemberIds).size !== survivingMemberIds.length)
    throw new Error("NATIONAL: invalid dissolution assets or recipients");
  const credits = new Map<string, bigint>();
  if (balance === 0n) return { credits, unclaimed: 0n };
  const ids = [...survivingMemberIds].sort();
  if (ids.includes(formerLeaderId)) {
    credits.set(formerLeaderId, balance);
  } else if (ids.length > 0) {
    const quotient = balance / BigInt(ids.length);
    const remainder = balance % BigInt(ids.length);
    ids.forEach((id, index) => {
      const amount = quotient + (BigInt(index) < remainder ? 1n : 0n);
      if (amount > 0n) credits.set(id, amount);
    });
  } else {
    // No surviving sovereign can own these assets. Preserve an auditable,
    // unspendable terminal estate rather than minting or silently erasing gold.
    return { credits, unclaimed: balance };
  }
  return { credits, unclaimed: 0n };
}

/** Active-reserve transfer only; no deployed forces or capacity changes. */
export function transferActiveTroops(
  source: bigint,
  destination: bigint,
  destinationCapacity: bigint,
  amount: bigint,
): readonly [bigint, bigint] {
  if (source < 0n || destination < 0n || destinationCapacity < 0n || amount <= 0n || source < amount || destination + amount > destinationCapacity)
    throw new Error("NATIONAL: invalid or unaffordable active troop transfer");
  return [source - amount, destination + amount];
}
