/**
 * Isolated NATIONAL defensive interception rules (D-008; LEVY-01..07).
 *
 * The caller MUST supply attacks only after the authoritative execution
 * accepts a real hostile invasion and identifies a stable campaign. Never
 * run from UI clicks or pending intents. Troops are debited from the real
 * contributor object, not minted as a donation to the defender. Interception
 * destroys an equal number of already-funded attacking and defending troops;
 * the caller must apply remainingAttackingTroops to the live attack before
 * the first tile is conquered. M0 wiring/snapshot integration is pending.
 */

export interface TroopSource {
  readonly nationId: string;
  /** A pure read of real authoritative troops; never a virtual donation pool. */
  troops(): number;
}

/**
 * Exact full-batch debit intent. The adapter must verify expectedBalance at
 * commit under the authoritative engine's exclusive tick lock.
 */
export interface TroopDebit {
  readonly source: TroopSource;
  readonly expectedBalance: number;
  readonly debit: number;
  readonly resultingBalance: number;
}

/**
 * The prepare phase is completely read-only: it may throw, refuse, or return
 * malformed acknowledgements but MUST NOT mutate troop balances.
 */
export interface PreparedTroopDebits {
  /** Exact one-to-one approval, same sorted order and full requested amounts. */
  readonly approved: readonly LevyContribution[];
  /**
   * ATOMIC: compare expected balances and apply ALL proposed debits in one
   * indivisible engine transaction. On ANY exception, zero balances change.
   * On success, EVERY exact debit is applied. No partial/short responses.
   * Never call arbitrary Player.removeTroops callbacks one by one.
   */
  commit(): void;
  /** Discard a staged, uncommitted plan without touching troop balances. */
  discard(): void;
}

/** The conductor must implement this boundary against authoritative state. */
export interface TroopDebitTransactionAdapter {
  prepare(debits: readonly TroopDebit[]): PreparedTroopDebits;
}

export interface LevyEligibility {
  /** Contributor's actual, current troops. */
  readonly source: TroopSource;
  readonly troopCapacity: number;
  /** Limits per campaign; initial illustrated policy 10% / 30% reserve. */
  readonly maximumFraction: number;
  readonly protectedCapacityFraction: number;
}

export interface IncomingDefense {
  /** Must be a stable ID for a *validated* attack, not a click ID. */
  readonly attackId: string;
  /** Authoritative code must construct this only after acceptance. */
  readonly confirmedAccepted: true;
  /** Same invasion campaign across microattacks; supplied by M0. */
  readonly campaignId: string;
  readonly attackerId: string;
  readonly defenderId: string;
  readonly attackingTroops: number;
  /** Must come from live, authorized MDA memberships; duplicates are merged. */
  readonly eligible: readonly LevyEligibility[];
}

export interface LevyContribution {
  readonly nationId: string;
  readonly troopsDebited: number;
}
export interface DefenseResult {
  readonly attackId: string;
  readonly campaignId: string;
  readonly attackTroopsBefore: number;
  readonly intercepted: number;
  readonly remainingAttackingTroops: number;
  readonly contributions: readonly LevyContribution[];
}
type Allowance = {
  key: string;
  contributorId: string;
  limit: number;
  spent: number;
};
type Processed = {
  attackId: string;
  campaignId: string;
  attackerId: string;
  defenderId: string;
  attackTroopsBefore: number;
  result: DefenseResult;
};
export interface LevyLedgerState {
  readonly version: 1;
  readonly allowances: readonly Readonly<Allowance>[];
  readonly processed: readonly Readonly<Processed>[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
function positiveInteger(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}
function assertNonnegative(n: number, label: string): void {
  if (!positiveInteger(n)) throw new Error(`invalid ${label}`);
}
function requireIdentity(s: string): void {
  if (typeof s !== "string" || s.length === 0 || s.length > 256)
    throw new Error("invalid identity");
}
function fraction(n: number): void {
  if (!Number.isFinite(n) || n < 0 || n > 1)
    throw new Error("fraction outside [0,1]");
}
function copyResult(r: DefenseResult): DefenseResult {
  return { ...r, contributions: r.contributions.map((c) => ({ ...c })) };
}

/** Deterministic capped weighted distribution: sum exactly min(demand, caps). */
export function weightedLevyAllocation(
  demand: number,
  capacities: readonly { id: string; cap: number; weight: number }[],
): Map<string, number> {
  assertNonnegative(demand, "demand");
  const unique = new Set<string>();
  const available = capacities
    .map((c) => {
      requireIdentity(c.id);
      assertNonnegative(c.cap, "cap");
      assertNonnegative(c.weight, "weight");
      if (unique.has(c.id)) throw new Error("duplicate contributor");
      unique.add(c.id);
      return { ...c };
    })
    .sort((a, b) => compare(a.id, b.id));
  const result = new Map(available.map((c) => [c.id, 0]));
  let remaining = Math.min(
    demand,
    available.reduce((sum, c) => sum + c.cap, 0),
  );
  if (!Number.isSafeInteger(remaining)) throw new Error("unsafe capacity sum");
  while (remaining > 0) {
    const active = available.filter((c) => c.cap > 0);
    if (active.length === 0) break;
    const weightSum = active.reduce((sum, c) => sum + c.weight, 0);
    const equal = weightSum === 0;
    const divisor = equal ? active.length : weightSum;
    const fractions: { id: string; fraction: number }[] = [];
    let assigned = 0;
    for (const c of active) {
      const share = (remaining * (equal ? 1 : c.weight)) / divisor;
      const proposed = Math.min(c.cap, Math.floor(share));
      c.cap -= proposed;
      result.set(c.id, (result.get(c.id) ?? 0) + proposed);
      assigned += proposed;
      if (c.cap > 0)
        fractions.push({ id: c.id, fraction: share - Math.floor(share) });
    }
    remaining -= assigned;
    if (remaining === 0) break;
    // Largest remainder, deterministic lexicographic tie-break.
    fractions.sort((a, b) => b.fraction - a.fraction || compare(a.id, b.id));
    for (const f of fractions) {
      if (remaining === 0) break;
      const c = available.find((x) => x.id === f.id)!;
      if (c.cap === 0) continue;
      c.cap--;
      remaining--;
      result.set(c.id, (result.get(c.id) ?? 0) + 1);
    }
    if (assigned === 0 && fractions.length === 0)
      throw new Error("non-progressing allocation");
  }
  return result;
}


type LedgerMaps = {
  allowances: Map<string, Allowance>;
  processed: Map<string, Processed>;
};

/**
 * Calculates the whole tick/campaign batch in scratch state. Nothing is
 * irreversible until ONE atomic adapter commit succeeds. A failed prepare,
 * invalid approval, stale balance, or failed atomic commit changes neither
 * troop balances nor ledger history.
 */
export class DefenseLevyLedger {
  private state: LedgerMaps = {
    allowances: new Map<string, Allowance>(),
    processed: new Map<string, Processed>(),
  };

  constructor(private readonly transactions: TroopDebitTransactionAdapter) {}

  exportState(): LevyLedgerState {
    return {
      version: 1,
      allowances: [...this.state.allowances.values()]
        .map((x) => ({ ...x }))
        .sort(
          (a, b) =>
            compare(a.key, b.key) || compare(a.contributorId, b.contributorId),
        ),
      processed: [...this.state.processed.values()]
        .map((x) => ({ ...x, result: copyResult(x.result) }))
        .sort((a, b) => compare(a.attackId, b.attackId)),
    };
  }

  restoreState(s: LevyLedgerState): void {
    if (s.version !== 1) throw new Error("unknown levy ledger version");
    const allowances = new Map<string, Allowance>(),
      processed = new Map<string, Processed>();
    for (const x of s.allowances) {
      requireIdentity(x.key);
      requireIdentity(x.contributorId);
      assertNonnegative(x.limit, "limit");
      assertNonnegative(x.spent, "spent");
      if (x.spent > x.limit) throw new Error("spent exceeds campaign cap");
      const k = x.key;
      if (allowances.has(k)) throw new Error("duplicate allowance");
      allowances.set(k, { ...x });
    }
    for (const x of s.processed) {
      requireIdentity(x.attackId);
      requireIdentity(x.campaignId);
      requireIdentity(x.attackerId);
      requireIdentity(x.defenderId);
      assertNonnegative(x.attackTroopsBefore, "attack size");
      if (
        processed.has(x.attackId) ||
        x.result.attackId !== x.attackId ||
        x.result.campaignId !== x.campaignId ||
        x.result.attackTroopsBefore !== x.attackTroopsBefore
      )
        throw new Error("invalid processed attack");
      assertNonnegative(x.result.intercepted, "intercepted");
      assertNonnegative(x.result.remainingAttackingTroops, "remaining attack");
      if (
        x.result.intercepted + x.result.remainingAttackingTroops !==
        x.attackTroopsBefore
      )
        throw new Error("inconsistent attack outcome");
      let charged = 0;
      const sourceIds = new Set<string>();
      for (const c of x.result.contributions) {
        requireIdentity(c.nationId);
        assertNonnegative(c.troopsDebited, "contribution");
        if (sourceIds.has(c.nationId))
          throw new Error("duplicate contribution");
        sourceIds.add(c.nationId);
        charged += c.troopsDebited;
      }
      if (charged !== x.result.intercepted)
        throw new Error("phantom interception");
      processed.set(x.attackId, { ...x, result: copyResult(x.result) });
    }
    const accounted = new Map<string, number>();
    for (const record of processed.values())
      for (const contribution of record.result.contributions) {
        const key = this.allowanceKey(record, contribution.nationId);
        accounted.set(
          key,
          (accounted.get(key) ?? 0) + contribution.troopsDebited,
        );
      }
    for (const [key, allowance] of allowances) {
      if (allowance.spent !== (accounted.get(key) ?? 0))
        throw new Error("campaign charge mismatch");
    }
    for (const key of accounted.keys())
      if (!allowances.has(key)) throw new Error("missing campaign allowance");
    // The conductor restores real troop balances and ledger together.
    // This function performs no troop debit or refund on restoration.
    this.state = { allowances, processed };
  }

  /**
   * Input is an already accepted, tick-ordered batch, not requests/clicks.
   * Sort by attack ID, simulate virtual balances across ALL attacks, then
   * prepare/commit ONE all-or-nothing debit against live player balances.
   */
  interceptAcceptedAttacks(
    requests: readonly IncomingDefense[],
  ): DefenseResult[] {
    const ids = new Set<string>();
    const liveSources = new Map<string, TroopSource>();
    for (const r of requests) {
      requireIdentity(r.attackId);
      requireIdentity(r.campaignId);
      requireIdentity(r.attackerId);
      requireIdentity(r.defenderId);
      if (r.confirmedAccepted !== true)
        throw new Error("levy requires authoritative accepted attack");
      assertNonnegative(r.attackingTroops, "attacking troops");
      if (r.attackerId === r.defenderId) throw new Error("self-attack");
      if (ids.has(r.attackId)) throw new Error("duplicate attack within batch");
      ids.add(r.attackId);
      for (const e of r.eligible) {
        requireIdentity(e.source.nationId);
        const priorSource = liveSources.get(e.source.nationId);
        if (priorSource && priorSource !== e.source)
          throw new Error("multiple live troop sources for one contributor");
        liveSources.set(e.source.nationId, e.source);
        assertNonnegative(e.troopCapacity, "troop capacity");
        fraction(e.maximumFraction);
        fraction(e.protectedCapacityFraction);
      }
    }

    const initialBalances = new Map<string, number>();
    const virtualBalances = new Map<string, number>();
    for (const [id, source] of [...liveSources].sort(([a], [b]) => compare(a, b))) {
      const balance = source.troops();
      assertNonnegative(balance, "actual contributor troops");
      initialBalances.set(id, balance);
      virtualBalances.set(id, balance);
    }

    const staging: LedgerMaps = {
      allowances: new Map(
        [...this.state.allowances].map(([id, x]) => [id, { ...x }]),
      ),
      processed: new Map(this.state.processed),
    };
    const results = [...requests]
      .sort((a, b) => compare(a.attackId, b.attackId))
      .map((r) => this.stage(r, staging, virtualBalances));

    const debits: TroopDebit[] = [...initialBalances]
      .filter(([id, initial]) => initial !== virtualBalances.get(id))
      .sort(([a], [b]) => compare(a, b))
      .map(([id, initial]) => {
        const remaining = virtualBalances.get(id)!;
        const debit = initial - remaining;
        if (!positiveInteger(debit) || debit === 0)
          throw new Error("invalid staged debit");
        return {
          source: liveSources.get(id)!,
          expectedBalance: initial,
          debit,
          resultingBalance: remaining,
        };
      });

    // No funding needed: still remember the zero-interception accepted attack,
    // preventing duplicate/replay events from opening a fresh allowance.
    if (debits.length === 0) {
      this.state = staging;
      return results;
    }

    let prepared: PreparedTroopDebits | undefined;
    try {
      prepared = this.transactions.prepare(debits);
      if (!prepared || !Array.isArray(prepared.approved))
        throw new Error("invalid debit preparation response");
      if (prepared.approved.length !== debits.length)
        throw new Error("short/extra debit approval");
      for (let i = 0; i < debits.length; i++) {
        const requested = debits[i];
        const approved = prepared.approved[i];
        if (
          !approved ||
          approved.nationId !== requested.source.nationId ||
          !positiveInteger(approved.troopsDebited) ||
          approved.troopsDebited !== requested.debit
        )
          throw new Error("invalid or short debit approval");
      }
      // A pure pre-commit freshness check, plus the mandatory adapter CAS.
      for (const debit of debits) {
        if (debit.source.troops() !== debit.expectedBalance)
          throw new Error("contributor balance changed before commit");
      }
      // A compliant adapter never partially modifies balances if this throws.
      // No further user-supplied callbacks occur after successful commit.
      prepared.commit();
    } catch (error) {
      if (prepared) prepared.discard();
      throw error;
    }

    // Single state swap only AFTER every real balance was atomically debited.
    this.state = staging;
    return results;
  }

  private allowanceKey(
    r: Pick<IncomingDefense, "campaignId" | "attackerId" | "defenderId">,
    contributorId: string,
  ): string {
    // Length framing avoids ambiguous concatenation and supports arbitrary IDs.
    return `${r.campaignId.length}:${r.campaignId}${r.attackerId.length}:${r.attackerId}${r.defenderId.length}:${r.defenderId}${contributorId.length}:${contributorId}`;
  }

  /** This method only mutates private scratch maps and virtual balances. */
  private stage(
    r: IncomingDefense,
    maps: LedgerMaps,
    balances: Map<string, number>,
  ): DefenseResult {
    const previous = maps.processed.get(r.attackId);
    if (previous) {
      if (
        previous.campaignId !== r.campaignId ||
        previous.attackerId !== r.attackerId ||
        previous.defenderId !== r.defenderId ||
        previous.attackTroopsBefore !== r.attackingTroops
      )
        throw new Error("attack ID reused with different details");
      return copyResult(previous.result);
    }

    const candidates = new Map<string, LevyEligibility>();
    for (const e of r.eligible) {
      const id = e.source.nationId;
      if (id === r.attackerId || id === r.defenderId) continue;
      const prior = candidates.get(id);
      if (prior) {
        if (
          prior.source !== e.source ||
          prior.troopCapacity !== e.troopCapacity
        )
          throw new Error("conflicting live contributor identity/capacity");
        candidates.set(id, {
          source: e.source,
          troopCapacity: e.troopCapacity,
          maximumFraction: Math.min(
            prior.maximumFraction,
            e.maximumFraction,
          ),
          protectedCapacityFraction: Math.max(
            prior.protectedCapacityFraction,
            e.protectedCapacityFraction,
          ),
        });
      } else candidates.set(id, e);
    }

    const allocations: {
      id: string;
      cap: number;
      weight: number;
      key: string;
      allowance: Allowance;
    }[] = [];
    for (const [id, e] of [...candidates].sort(([a], [b]) => compare(a, b))) {
      const current = balances.get(id)!;
      const reserve = Math.ceil(
        e.troopCapacity * e.protectedCapacityFraction,
      );
      const key = this.allowanceKey(r, id);
      const existing = maps.allowances.get(key);
      const cap =
        existing?.limit ??
        Math.min(
          Math.floor(current * e.maximumFraction),
          Math.max(0, current - reserve),
        );
      assertNonnegative(cap, "campaign cap");
      const allowance = existing ?? {
        key,
        contributorId: id,
        limit: cap,
        spent: 0,
      };
      allocations.push({
        id,
        cap: Math.max(
          0,
          Math.min(cap - allowance.spent, current - reserve),
        ),
        weight: current,
        key,
        allowance,
      });
    }

    const split = weightedLevyAllocation(
      r.attackingTroops,
      allocations.map((a) => ({
        id: a.id,
        cap: a.cap,
        weight: a.weight,
      })),
    );
    let intercepted = 0;
    const contributions: LevyContribution[] = [];
    for (const a of allocations) {
      const asked = split.get(a.id) ?? 0;
      const row = a.allowance;
      row.spent += asked;
      maps.allowances.set(a.key, row);
      if (asked > 0) {
        const available = balances.get(a.id)!;
        if (asked > available) throw new Error("overcommitted troop balance");
        balances.set(a.id, available - asked);
        intercepted += asked;
        contributions.push({ nationId: a.id, troopsDebited: asked });
      }
    }

    const result: DefenseResult = {
      attackId: r.attackId,
      campaignId: r.campaignId,
      attackTroopsBefore: r.attackingTroops,
      intercepted,
      remainingAttackingTroops: r.attackingTroops - intercepted,
      contributions,
    };
    maps.processed.set(r.attackId, {
      attackId: r.attackId,
      campaignId: r.campaignId,
      attackerId: r.attackerId,
      defenderId: r.defenderId,
      attackTroopsBefore: r.attackingTroops,
      result: copyResult(result),
    });
    return copyResult(result);
  }
}
