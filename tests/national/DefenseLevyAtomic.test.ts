import { describe, expect, it } from "vitest";
import {
  DefenseLevyLedger,
  type IncomingDefense,
  type PreparedTroopDebits,
  type TroopDebit,
  type TroopDebitTransactionAdapter,
  type TroopSource,
} from "../../packages/engine/src/national/conflict/DefenseLevy";

/**
 * Fake authoritative troop store: the only irreversible write is a single
 * Map reference swap. Faults on any contributor happen before that swap.
 */
class TroopBank {
  private balances = new Map<string, number>();
  private readonly sources = new Map<string, TroopSource>();

  add(nationId: string, balance: number): TroopSource {
    this.balances.set(nationId, balance);
    const source: TroopSource = {
      nationId,
      troops: () => this.balance(nationId),
    };
    this.sources.set(nationId, source);
    return source;
  }

  balance(id: string): number {
    const value = this.balances.get(id);
    if (value === undefined) throw new Error("unknown troop account");
    return value;
  }

  snapshot(): Map<string, number> {
    return new Map(this.balances);
  }

  swap(next: Map<string, number>): void {
    this.balances = next;
  }
}

type AcknowledgementMode =
  | "exact"
  | "short"
  | "under"
  | "over"
  | "negative"
  | "fraction"
  | "wrong-id"
  | "reordered";

class AtomicBankAdapter implements TroopDebitTransactionAdapter {
  prepareFailAt: number | null = null;
  commitFailAt: number | null = null;
  approvalMode: AcknowledgementMode = "exact";
  prepareCount = 0;
  commitCount = 0;
  discardCount = 0;

  constructor(private readonly bank: TroopBank) {}

  prepare(debits: readonly TroopDebit[]): PreparedTroopDebits {
    this.prepareCount++;
    const approved = debits.map((debit, i) => {
      if (i === this.prepareFailAt)
        throw new Error(`prepare failure at contributor ${i}`);
      if (this.bank.balance(debit.source.nationId) !== debit.expectedBalance)
        throw new Error("stale balance before prepare");
      return { nationId: debit.source.nationId, troopsDebited: debit.debit };
    });
    switch (this.approvalMode) {
      case "short":
        approved.pop();
        break;
      case "under":
        approved[approved.length - 1].troopsDebited--;
        break;
      case "over":
        approved[approved.length - 1].troopsDebited++;
        break;
      case "negative":
        approved[approved.length - 1].troopsDebited = -1;
        break;
      case "fraction":
        approved[approved.length - 1].troopsDebited = 0.5;
        break;
      case "wrong-id":
        approved[approved.length - 1].nationId = "WRONG";
        break;
      case "reordered":
        approved.reverse();
        break;
    }
    return {
      approved,
      commit: () => {
        this.commitCount++;
        const next = this.bank.snapshot();
        for (const [index, debit] of debits.entries()) {
          if (index === this.commitFailAt)
            throw new Error(`commit failure at contributor ${index}`);
          if (next.get(debit.source.nationId) !== debit.expectedBalance)
            throw new Error("atomic CAS mismatch");
          if (
            debit.debit <= 0 ||
            debit.expectedBalance - debit.debit !== debit.resultingBalance
          )
            throw new Error("invalid planned change");
          next.set(debit.source.nationId, debit.resultingBalance);
        }
        // One synchronous, nonthrowing publication of ALL account changes.
        this.bank.swap(next);
      },
      discard: () => {
        this.discardCount++;
      },
    };
  }
}

const eligibility = (source: TroopSource) => ({
  source,
  troopCapacity: 100_000,
  maximumFraction: 0.1,
  protectedCapacityFraction: 0.3,
});

function assault(
  attackId: string,
  campaignId: string,
  troops: number,
  sources: readonly TroopSource[],
  attackerId = "A",
  defenderId = "B",
): IncomingDefense {
  return {
    attackId,
    confirmedAccepted: true,
    campaignId,
    attackerId,
    defenderId,
    attackingTroops: troops,
    eligible: sources.map(eligibility),
  };
}

describe("NATIONAL levy transaction atomicity — D-008 / LEVY-01..07", () => {
  it("second contributor PREPARE failure leaves zero troop loss and no campaign spend", () => {
    const bank = new TroopBank();
    const donors = ["C", "D", "E"].map((id) => bank.add(id, 100_000));
    const adapter = new AtomicBankAdapter(bank);
    const ledger = new DefenseLevyLedger(adapter);
    const request = assault("a", "campaign", 30_000, donors);
    const beforeBalances = bank.snapshot();
    const beforeState = ledger.exportState();

    adapter.prepareFailAt = 1;
    expect(() => ledger.interceptAcceptedAttacks([request])).toThrow(
      "prepare failure at contributor 1",
    );
    expect(bank.snapshot()).toEqual(beforeBalances);
    expect(ledger.exportState()).toEqual(beforeState);
    expect(adapter.commitCount).toBe(0);

    adapter.prepareFailAt = null;
    const result = ledger.interceptAcceptedAttacks([request])[0];
    expect(result.intercepted).toBe(30_000);
    expect(bank.balance("C")).toBe(90_000);
    expect(bank.balance("D")).toBe(90_000);
    expect(bank.balance("E")).toBe(90_000);
  });

  it("final contributor PREPARE failure does not debit earlier contributors", () => {
    const bank = new TroopBank();
    const donors = ["C", "D", "E", "F"].map((id) => bank.add(id, 100_000));
    const adapter = new AtomicBankAdapter(bank);
    const ledger = new DefenseLevyLedger(adapter);
    adapter.prepareFailAt = 3;
    expect(() =>
      ledger.interceptAcceptedAttacks([assault("a", "c", 40_000, donors)]),
    ).toThrow("prepare failure at contributor 3");
    expect(bank.snapshot()).toEqual(
      new Map(["C", "D", "E", "F"].map((id) => [id, 100_000])),
    );
    expect(ledger.exportState().processed).toEqual([]);
    expect(adapter.commitCount).toBe(0);
  });

  for (const failureIndex of [1, 2]) {
    it(`atomic COMMIT preflight failure at contributor ${failureIndex} preserves all balances`, () => {
      const bank = new TroopBank();
      const donors = ["C", "D", "E"].map((id) => bank.add(id, 100_000));
      const adapter = new AtomicBankAdapter(bank);
      const ledger = new DefenseLevyLedger(adapter);
      const stateBefore = ledger.exportState();
      const accountsBefore = bank.snapshot();
      adapter.commitFailAt = failureIndex;
      expect(() =>
        ledger.interceptAcceptedAttacks([assault("a", "c", 30_000, donors)]),
      ).toThrow(`commit failure at contributor ${failureIndex}`);
      expect(bank.snapshot()).toEqual(accountsBefore);
      expect(ledger.exportState()).toEqual(stateBefore);
      expect(adapter.discardCount).toBe(1);
      adapter.commitFailAt = null;
      expect(
        ledger.interceptAcceptedAttacks([assault("a", "c", 30_000, donors)])[0]
          .intercepted,
      ).toBe(30_000);
    });
  }

  for (const response of [
    "short",
    "under",
    "over",
    "negative",
    "fraction",
    "wrong-id",
    "reordered",
  ] as const) {
    it(`refuses ${response} approval BEFORE any debit`, () => {
      const bank = new TroopBank();
      const donors = ["C", "D"].map((id) => bank.add(id, 100_000));
      const adapter = new AtomicBankAdapter(bank);
      const ledger = new DefenseLevyLedger(adapter);
      adapter.approvalMode = response;
      expect(() =>
        ledger.interceptAcceptedAttacks([assault("a", "c", 20_000, donors)]),
      ).toThrow();
      expect(bank.snapshot()).toEqual(
        new Map([
          ["C", 100_000],
          ["D", 100_000],
        ]),
      );
      expect(ledger.exportState().processed).toEqual([]);
      expect(adapter.commitCount).toBe(0);
      expect(adapter.discardCount).toBe(1);
    });
  }

  it("simultaneous attacks are one atomic batch, sorted and campaign-budgeted", () => {
    const run = (reverse: boolean) => {
      const bank = new TroopBank();
      const donor = bank.add("C", 100_000);
      const adapter = new AtomicBankAdapter(bank);
      const ledger = new DefenseLevyLedger(adapter);
      const first = assault("a", "c1", 20_000, [donor]);
      const second = assault("b", "c2", 20_000, [donor], "X", "Y");
      const results = ledger.interceptAcceptedAttacks(
        reverse ? [second, first] : [first, second],
      );
      return {
        results,
        balance: bank.balance("C"),
        commits: adapter.commitCount,
      };
    };
    const a = run(false),
      b = run(true);
    expect(a).toEqual(b);
    expect(a.results.map((x) => x.intercepted)).toEqual([10_000, 9_000]);
    expect(a.balance).toBe(81_000);
    expect(a.commits).toBe(1);
  });

  it("a failure in the final donor of a multi-attack batch rolls back the entire batch", () => {
    const bank = new TroopBank();
    const c = bank.add("C", 100_000),
      d = bank.add("D", 100_000);
    const adapter = new AtomicBankAdapter(bank);
    const ledger = new DefenseLevyLedger(adapter);
    adapter.commitFailAt = 1;
    expect(() =>
      ledger.interceptAcceptedAttacks([
        assault("a", "campaign-1", 10_000, [c]),
        assault("b", "campaign-2", 10_000, [d]),
      ]),
    ).toThrow("commit failure at contributor 1");
    expect(bank.balance("C")).toBe(100_000);
    expect(bank.balance("D")).toBe(100_000);
    expect(ledger.exportState().processed).toEqual([]);
    expect(ledger.exportState().allowances).toEqual([]);
  });

  it("microattack spam uses one immutable campaign allowance and never recharges replay IDs", () => {
    const bank = new TroopBank();
    const donor = bank.add("C", 100_000);
    const adapter = new AtomicBankAdapter(bank);
    const ledger = new DefenseLevyLedger(adapter);
    const spam = Array.from({ length: 20 }, (_, i) =>
      assault(`micro-${String(i).padStart(2, "0")}`, "one-campaign", 2_000, [
        donor,
      ]),
    );
    const original = ledger.interceptAcceptedAttacks(spam);
    expect(original.reduce((n, x) => n + x.intercepted, 0)).toBe(10_000);
    expect(bank.balance("C")).toBe(90_000);
    expect(adapter.commitCount).toBe(1);
    expect(ledger.interceptAcceptedAttacks(spam)).toEqual(original);
    expect(bank.balance("C")).toBe(90_000);
    expect(adapter.commitCount).toBe(1);
    expect(
      ledger.interceptAcceptedAttacks([
        assault("new-click", "one-campaign", 2_000, [donor]),
      ])[0].intercepted,
    ).toBe(0);
    expect(bank.balance("C")).toBe(90_000);
  });

  it("rejected, canceled and non-authoritative attacks never debit or enter processed state", () => {
    const bank = new TroopBank();
    const donor = bank.add("C", 100_000);
    const adapter = new AtomicBankAdapter(bank);
    const ledger = new DefenseLevyLedger(adapter);
    expect(ledger.interceptAcceptedAttacks([])).toEqual([]);
    for (const state of [false, undefined, "canceled", "rejected"]) {
      const invalid = {
        ...assault("attack", "campaign", 10_000, [donor]),
        confirmedAccepted: state,
      } as unknown as IncomingDefense;
      expect(() => ledger.interceptAcceptedAttacks([invalid])).toThrow();
    }
    expect(bank.balance("C")).toBe(100_000);
    expect(adapter.prepareCount).toBe(0);
    expect(ledger.exportState().processed).toEqual([]);
  });

  it("replayed ID with altered campaign rejects entire batch without debit", () => {
    const bank = new TroopBank();
    const donor = bank.add("C", 100_000);
    const adapter = new AtomicBankAdapter(bank);
    const ledger = new DefenseLevyLedger(adapter);
    ledger.interceptAcceptedAttacks([assault("a", "camp", 5_000, [donor])]);
    const before = ledger.exportState();
    const balance = bank.balance("C");
    expect(() =>
      ledger.interceptAcceptedAttacks([
        assault("b", "camp", 2_000, [donor]),
        assault("a", "different-campaign", 5_000, [donor]),
      ]),
    ).toThrow("attack ID reused");
    expect(bank.balance("C")).toBe(balance);
    expect(ledger.exportState()).toEqual(before);
  });

  it("snapshot restore preserves funded history and avoids duplicate charge", () => {
    const bank = new TroopBank();
    const donor = bank.add("C", 100_000);
    const adapter = new AtomicBankAdapter(bank);
    const ledger = new DefenseLevyLedger(adapter);
    const first = assault("a", "campaign", 3_000, [donor]);
    const result = ledger.interceptAcceptedAttacks([first])[0];
    const state = ledger.exportState();
    const restoredBalance = bank.balance("C");
    const clone = new DefenseLevyLedger(adapter);
    clone.restoreState(state);
    const countBefore = adapter.commitCount;
    expect(clone.interceptAcceptedAttacks([first])).toEqual([result]);
    expect(adapter.commitCount).toBe(countBefore);
    expect(bank.balance("C")).toBe(restoredBalance);
    expect(
      clone.interceptAcceptedAttacks([
        assault("b", "campaign", 20_000, [donor]),
      ])[0].intercepted,
    ).toBe(7_000);
    expect(bank.balance("C")).toBe(90_000);
    expect(clone.exportState().allowances[0].spent).toBe(10_000);
  });

  it("insufficient live balance at commit fails CAS without modifying ledger", () => {
    const bank = new TroopBank();
    const donor = bank.add("C", 100_000);
    const adapter = new AtomicBankAdapter(bank);
    const ledger = new DefenseLevyLedger(adapter);
    // A source read becomes stale after initial staging, before prepare.
    let reads = 0;
    const stale: TroopSource = {
      nationId: donor.nationId,
      troops: () => {
        reads++;
        return reads <= 1 ? 100_000 : 99_000;
      },
    };
    expect(() =>
      ledger.interceptAcceptedAttacks([assault("a", "c", 10_000, [stale])]),
    ).toThrow();
    expect(bank.balance("C")).toBe(100_000);
    expect(ledger.exportState().processed).toEqual([]);
  });
});
