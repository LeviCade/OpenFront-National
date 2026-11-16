import { describe, expect, it } from "vitest";
import {
  DefenseLevyLedger,
  weightedLevyAllocation,
  type TroopSource,
  type TroopDebitTransactionAdapter,
  type TroopDebit,
  type PreparedTroopDebits,
  type IncomingDefense,
} from "../../packages/engine/src/national/conflict/DefenseLevy";
import {
  WarLedger,
  type PoliticsPort,
} from "../../packages/engine/src/national/conflict/WarLedger";

class Politics implements PoliticsPort {
  membership = new Map([
    ["B", "E"],
    ["C", "E"],
    ["I", "E"],
  ]);
  leaders = new Map([["E", "I"]]);
  declare = false;
  peace = false;
  blocked = false;
  empireOf(id: string) {
    return this.membership.get(id) ?? null;
  }
  emperorOf(id: string) {
    return this.leaders.get(id) ?? null;
  }
  membersOf(id: string): string[] {
    return [...this.membership]
      .filter(([, empire]) => empire === id)
      .map(([nation]) => nation);
  }
  nationAlive(id: string) {
    return ["A", "B", "C", "I", "X", "Y"].includes(id);
  }
  empireExists(id: string) {
    return this.leaders.has(id);
  }
  mayDeclareNational(_memberId: string) {
    return this.declare;
  }
  maySettleNational(_memberId: string) {
    return this.peace;
  }
  treatyProtects(_a: string, _b: string) {
    return this.blocked;
  }
}

class Troops implements TroopSource {
  calls = 0;
  constructor(
    public nationId: string,
    public balance: number,
  ) {}
  troops() {
    return this.balance;
  }
  /** Deliberately forbidden: the levy module must not call one-off debits. */
  removeTroops(_amount: number): never {
    throw new Error("non-transactional removeTroops is forbidden");
  }
}

/**
 * Test-only adapter: all validation and injected failures occur before the
 * first balance write. The commit write phase uses plain numeric fields with
 * no user callbacks. The production adapter must supply an atomic engine
 * balance swap/CAS; direct sequential Player.removeTroops is NOT acceptable.
 */
class AtomicTestAdapter implements TroopDebitTransactionAdapter {
  failPrepareAt: number | null = null;
  failCommitAt: number | null = null;
  reply:
    | "exact"
    | "short"
    | "under"
    | "over"
    | "negative"
    | "wrong-id"
    | "reordered" = "exact";
  prepareCalls = 0;
  commitCalls = 0;
  discardCalls = 0;

  prepare(debits: readonly TroopDebit[]): PreparedTroopDebits {
    this.prepareCalls++;
    const rows = debits.map((d, index) => {
      if (this.failPrepareAt === index)
        throw new Error(`prepare failed at contributor ${index}`);
      if (d.source.troops() !== d.expectedBalance)
        throw new Error("stale expected balance");
      return { nationId: d.source.nationId, troopsDebited: d.debit };
    });
    const approved = rows.map((x) => ({ ...x }));
    switch (this.reply) {
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
      case "wrong-id":
        approved[approved.length - 1].nationId = "not-the-contributor";
        break;
      case "reordered":
        approved.reverse();
        break;
    }

    return {
      approved,
      commit: () => {
        this.commitCalls++;
        // Precommit checks and failure injection compute every destination
        // before any write; a throw leaves all accounts unchanged.
        const updates = debits.map((debit, index) => {
          if (this.failCommitAt === index)
            throw new Error(`atomic commit failed at contributor ${index}`);
          if (debit.source.troops() !== debit.expectedBalance)
            throw new Error("CAS balance mismatch");
          if (debit.resultingBalance !== debit.expectedBalance - debit.debit)
            throw new Error("invalid resulting balance");
          return {
            owner: debit.source as Troops,
            balance: debit.resultingBalance,
          };
        });
        for (const update of updates) {
          update.owner.balance = update.balance;
          update.owner.calls++;
        }
      },
      discard: () => {
        this.discardCalls++;
      },
    };
  }
}

function levy(
  attackId: string,
  campaignId: string,
  troops: number,
  donors: Troops[],
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
    eligible: donors.map((source) => ({
      source,
      troopCapacity: 100_000,
      maximumFraction: 0.1,
      protectedCapacityFraction: 0.3,
    })),
  };
}

describe("NATIONAL layered conflict — D-010/D-014", () => {
  it("WAR-01 defaults to peace, accepts declaration, rejects self attack and preserves neutral capture", () => {
    const ledger = new WarLedger(new Politics());
    expect(ledger.authorizeOffensiveAction("A", "X")).toBe(false);
    expect(ledger.authorizeOffensiveAction("A", null)).toBe(true);
    expect(ledger.authorizeOffensiveAction("UNKNOWN", null)).toBe(false);
    ledger.declareNational("war-1", "A", "A", "X", 1);
    expect(ledger.authorizeOffensiveAction("A", "X")).toBe(true);
    expect(ledger.authorizeOffensiveAction("X", "A")).toBe(true);
    expect(ledger.authorizeOffensiveAction("A", "A")).toBe(false);
    expect(() => ledger.declareNational("bad", "A", "A", "A", 1)).toThrow();
  });
  it("WAR-02 B's national war never draws C or the imperial leader into war", () => {
    const p = new Politics();
    p.declare = true;
    const ledger = new WarLedger(p);
    ledger.declareNational("B-X", "B", "B", "X", 10);
    expect(ledger.atWar("B", "X")).toBe(true);
    expect(ledger.atWar("C", "X")).toBe(false);
    expect(ledger.atWar("I", "X")).toBe(false);
  });
  it("WAR-03/04 imperial overlay is scoped and peace cannot erase national war", () => {
    const ledger = new WarLedger(new Politics());
    ledger.declareNational("B-X", "I", "B", "X", 1);
    ledger.declareImperial(
      "E-X",
      "I",
      { kind: "empire", id: "E" },
      { kind: "nation", id: "X" },
      2,
    );
    expect(["B", "C", "I"].every((n) => ledger.atWar(n, "X"))).toBe(true);
    ledger.proposePeace("offer-E", "E-X", "I", 3);
    expect(ledger.atWar("C", "X")).toBe(true); // proposal is NOT peace
    expect(() => ledger.acceptPeace("offer-E", "B", 4)).toThrow();
    ledger.acceptPeace("offer-E", "X", 4);
    expect(ledger.atWar("B", "X")).toBe(true);
    expect(ledger.atWar("C", "X")).toBe(false);
    expect(ledger.atWar("I", "X")).toBe(false);
    ledger.proposePeace("offer-B", "B-X", "I", 5);
    ledger.acceptPeace("offer-B", "X", 5);
    expect(ledger.atWar("B", "X")).toBe(false);
  });
  it("WAR-07 imperial nation alone may be at national war without drawing the empire", () => {
    const ledger = new WarLedger(new Politics());
    ledger.declareNational("I-X", "I", "I", "X", 1);
    expect(ledger.atWar("I", "X")).toBe(true);
    expect(ledger.atWar("B", "X")).toBe(false);
  });
  it("member authority is delegated for each action, emperor never loses override", () => {
    const p = new Politics();
    const w = new WarLedger(p);
    expect(() => w.declareNational("B-X", "B", "B", "X", 1)).toThrow();
    p.declare = true;
    w.declareNational("B-X", "B", "B", "X", 1);
    expect(() => w.proposePeace("m", "B-X", "B", 2)).toThrow();
    w.proposePeace("m", "B-X", "I", 2);
    w.acceptPeace("m", "X", 3);
  });
  it("NAP/MDA protection requires prior betrayal even with declared war", () => {
    const p = new Politics();
    const w = new WarLedger(p);
    w.declareNational("A-X", "A", "A", "X", 1);
    p.blocked = true;
    expect(w.authorizeOffensiveAction("A", "X")).toBe(false);
    expect(() => w.declareNational("A-Y", "A", "A", "Y", 2)).toThrow();
  });
  it("replay-accurate snapshot, stable sorted IDs, and protected state mutation", () => {
    const p = new Politics();
    const w = new WarLedger(p);
    w.declareNational("z", "A", "A", "X", 1);
    w.declareNational("a", "A", "A", "Y", 2);
    const s = w.exportState();
    expect(s.layers.map((l) => l.id)).toEqual(["a", "z"]);
    const restored = new WarLedger(p);
    restored.restoreState(s);
    expect(restored.exportState()).toEqual(s);
    expect(restored.atWar("A", "X")).toBe(true);
    expect(() => restored.declareNational("z", "A", "A", "Y", 3)).toThrow();
  });
  it("cannot declare same scope/parties twice or settle peace unilaterally", () => {
    const w = new WarLedger(new Politics());
    w.declareNational("war", "A", "A", "X", 1);
    expect(() => w.declareNational("repeat", "X", "X", "A", 2)).toThrow();
    w.proposePeace("m", "war", "A", 2);
    expect(() => w.acceptPeace("m", "A", 3)).toThrow();
    expect(w.atWar("A", "X")).toBe(true);
  });
  it("emperor transfer dynamically changes authority but not war identity", () => {
    const p = new Politics();
    const w = new WarLedger(p);
    w.declareImperial(
      "war",
      "I",
      { kind: "empire", id: "E" },
      { kind: "nation", id: "X" },
      1,
    );
    p.leaders.set("E", "C");
    expect(() => w.proposePeace("m1", "war", "I", 2)).toThrow();
    w.proposePeace("m2", "war", "C", 2);
    w.acceptPeace("m2", "X", 3);
    expect(w.atWar("B", "X")).toBe(false);
  });
});

describe("NATIONAL real defensive levies — D-008", () => {
  it("LEVY-01 50K push intercepts exactly 45K, no phantom troops", () => {
    const donors = [new Troops("C", 450_000)];
    const ledger = new DefenseLevyLedger(new AtomicTestAdapter());
    const r = ledger.interceptAcceptedAttacks([
      {
        ...levy("attack", "campaign", 50_000, donors),
        eligible: [
          {
            source: donors[0],
            troopCapacity: 500_000,
            maximumFraction: 0.1,
            protectedCapacityFraction: 0.3,
          },
        ],
      },
    ])[0];
    expect(r.intercepted).toBe(45_000);
    expect(r.remainingAttackingTroops).toBe(5_000);
    expect(donors[0].balance).toBe(405_000);
    expect(r.contributions).toEqual([{ nationId: "C", troopsDebited: 45_000 }]);
  });
  it("LEVY-02 fully shields an incoming attack before territorial combat", () => {
    const donors = [new Troops("C", 450_000)];
    const r = new DefenseLevyLedger(
      new AtomicTestAdapter(),
    ).interceptAcceptedAttacks([
      {
        ...levy("a", "c", 30_000, donors),
        eligible: [
          {
            source: donors[0],
            troopCapacity: 500_000,
            maximumFraction: 0.1,
            protectedCapacityFraction: 0.3,
          },
        ],
      },
    ])[0];
    expect(r.remainingAttackingTroops).toBe(0);
    expect(donors[0].balance).toBe(420_000);
  });
  it("LEVY-03 rejected/cancelled attack is never charged because no event reaches ledger", () => {
    const donor = new Troops("C", 100_000),
      ledger = new DefenseLevyLedger(new AtomicTestAdapter());
    expect(ledger.interceptAcceptedAttacks([])).toEqual([]);
    expect(donor.balance).toBe(100_000);
    expect(donor.calls).toBe(0);
  });
  it("LEVY-04 twenty microattacks share one finite campaign cap", () => {
    const donor = new Troops("C", 100_000),
      ledger = new DefenseLevyLedger(new AtomicTestAdapter());
    const attacks = Array.from({ length: 20 }, (_, i) =>
      levy(`a-${String(i).padStart(2, "0")}`, "same-campaign", 5_000, [donor]),
    );
    const r = ledger.interceptAcceptedAttacks(attacks);
    expect(r.reduce((s, x) => s + x.intercepted, 0)).toBe(10_000);
    expect(donor.balance).toBe(90_000);
    const replays = ledger.interceptAcceptedAttacks(attacks);
    expect(replays.map((x) => x.application)).toEqual(Array(20).fill("replay"));
    expect(replays.map((x) => x.intercepted)).toEqual(Array(20).fill(0));
    expect(replays.map((x) => x.remainingAttackingTroops)).toEqual(
      Array(20).fill(5_000),
    );
    expect(donor.balance).toBe(90_000);
    // Twenty clicks are funded by one atomic batch commit, not two callbacks.
    expect(donor.calls).toBe(1);
  });
  it("LEVY-05 simultaneous obligations use deterministic order and never double spend", () => {
    const d1 = new Troops("C", 100_000),
      d2 = new Troops("C", 100_000);
    const a = levy("a", "campaign-1", 20_000, [d1], "A", "B");
    const b = levy("b", "campaign-2", 20_000, [d1], "X", "Y");
    const r1 = new DefenseLevyLedger(
      new AtomicTestAdapter(),
    ).interceptAcceptedAttacks([b, a]);
    const r2 = new DefenseLevyLedger(
      new AtomicTestAdapter(),
    ).interceptAcceptedAttacks(
      [a, b].map((x) => ({
        ...x,
        eligible: x.eligible.map((e) => ({ ...e, source: d2 })),
      })),
    );
    expect(r1).toEqual(r2);
    expect(d1.balance).toBe(81_000);
    expect(d2.balance).toBe(81_000);
    expect(r1.reduce((s, x) => s + x.intercepted, 0)).toBe(19_000);
  });
  it("LEVY-06 protected reserve prevents excessive levy despite high campaign cap", () => {
    const donor = new Troops("C", 32_000);
    const r = new DefenseLevyLedger(
      new AtomicTestAdapter(),
    ).interceptAcceptedAttacks([levy("a", "c", 20_000, [donor])])[0];
    expect(r.intercepted).toBe(2_000);
    expect(donor.balance).toBe(30_000);
  });
  it("LEVY-07 multiple treaty memberships count one nation once", () => {
    const donor = new Troops("C", 100_000);
    const request = levy("a", "c", 40_000, [donor]);
    const r = new DefenseLevyLedger(
      new AtomicTestAdapter(),
    ).interceptAcceptedAttacks([
      { ...request, eligible: [...request.eligible, ...request.eligible] },
    ])[0];
    expect(r.intercepted).toBe(10_000);
    expect(donor.balance).toBe(90_000);
  });
  it("weighted allocation is capped, conserves integers, and stable on tied weights", () => {
    const r = weightedLevyAllocation(17, [
      { id: "D", cap: 4, weight: 2 },
      { id: "C", cap: 20, weight: 2 },
      { id: "E", cap: 20, weight: 2 },
    ]);
    expect([...r.values()].reduce((a, b) => a + b, 0)).toBe(17);
    expect(r.get("D")).toBeLessThanOrEqual(4);
    expect(
      weightedLevyAllocation(1, [
        { id: "Z", cap: 1, weight: 1 },
        { id: "A", cap: 1, weight: 1 },
      ]).get("A"),
    ).toBe(1);
  });
  it("restore retains campaign spend and prevents replay levy duplication", () => {
    const donor = new Troops("C", 100_000),
      ledger = new DefenseLevyLedger(new AtomicTestAdapter());
    const r = ledger.interceptAcceptedAttacks([
      levy("a", "campaign", 5_000, [donor]),
    ])[0];
    const state = ledger.exportState();
    const clone = new DefenseLevyLedger(new AtomicTestAdapter());
    clone.restoreState(state);
    expect(clone.exportState()).toEqual(state);
    expect(
      clone.interceptAcceptedAttacks([levy("a", "campaign", 5_000, [donor])]),
    ).toEqual([
      {
        ...r,
        application: "replay",
        intercepted: 0,
        remainingAttackingTroops: 5_000,
        contributions: [],
      },
    ]);
    expect(donor.balance).toBe(95_000);
    const next = clone.interceptAcceptedAttacks([
      levy("b", "campaign", 50_000, [donor]),
    ])[0];
    expect(next.intercepted).toBe(5_000);
    expect(donor.balance).toBe(90_000);
  });
  it("tampered snapshot claiming interception without deductions is rejected", () => {
    const donor = new Troops("C", 100_000),
      ledger = new DefenseLevyLedger(new AtomicTestAdapter());
    ledger.interceptAcceptedAttacks([levy("a", "c", 10_000, [donor])]);
    const state = JSON.parse(JSON.stringify(ledger.exportState()));
    state.processed[0].result.intercepted = 20_000;
    expect(() =>
      new DefenseLevyLedger(new AtomicTestAdapter()).restoreState(state),
    ).toThrow();
  });
});
