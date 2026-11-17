import { describe, expect, it } from "vitest";
import {
  DefenseLevyLedger,
  type IncomingDefense,
  type TroopDebitTransactionAdapter,
  type TroopSource,
} from "../../packages/engine/src/national/conflict/DefenseLevy";
import {
  WarLedger,
  type PoliticsPort,
} from "../../packages/engine/src/national/conflict/WarLedger";

/** Actual combat application must use only the NEW interception receipt. */
class Balances {
  readonly values = new Map([["C", 100_000]]);
  readonly donor: TroopSource = {
    nationId: "C",
    troops: () => this.values.get("C")!,
  };
  readonly adapter: TroopDebitTransactionAdapter = {
    prepare: (debits) => ({
      approved: debits.map((d) => ({
        nationId: d.source.nationId,
        troopsDebited: d.debit,
      })),
      discard: () => {},
      commit: () => {
        for (const d of debits) {
          if (this.values.get(d.source.nationId) !== d.expectedBalance)
            throw new Error("stale balance");
        }
        const next = new Map(this.values);
        for (const d of debits) next.set(d.source.nationId, d.resultingBalance);
        this.values.clear();
        for (const [id, amount] of next) this.values.set(id, amount);
      },
    }),
  };

  attack(id = "attack", campaign = "invasion"): IncomingDefense {
    return {
      attackId: id,
      campaignId: campaign,
      attackerId: "A",
      defenderId: "B",
      confirmedAccepted: true,
      attackingTroops: 20_000,
      eligible: [
        {
          source: this.donor,
          troopCapacity: 100_000,
          maximumFraction: 0.1,
          protectedCapacityFraction: 0.3,
        },
      ],
    };
  }
}

class AlivePolitics implements PoliticsPort {
  alive = new Set(["A", "B"]);
  empireOf(_id: string) {
    return null;
  }
  emperorOf(_id: string) {
    return null;
  }
  membersOf(_id: string): readonly string[] {
    return [];
  }
  nationAlive(id: string) {
    return this.alive.has(id);
  }
  empireExists(_id: string) {
    return false;
  }
  mayDeclareNational(_id: string) {
    return false;
  }
  maySettleNational(_id: string) {
    return false;
  }
  treatyProtects(_a: string, _b: string) {
    return false;
  }
}

describe("Conductor review: replay-safe two-sided combat and fail-closed neutrality", () => {
  it("fresh receipt reduces both forces once, replay reduces neither", () => {
    const store = new Balances();
    const ledger = new DefenseLevyLedger(store.adapter);
    let attacking = 20_000;
    const first = ledger.interceptAcceptedAttacks([store.attack()])[0];
    expect(first.application).toBe("applied");
    expect(first.intercepted).toBe(10_000);
    attacking -= first.intercepted;
    expect(attacking).toBe(10_000);
    expect(store.values.get("C")).toBe(90_000);

    const replay = ledger.interceptAcceptedAttacks([store.attack()])[0];
    expect(replay.application).toBe("replay");
    expect(replay.intercepted).toBe(0);
    expect(replay.remainingAttackingTroops).toBe(20_000);
    expect(replay.contributions).toEqual([]);
    attacking -= replay.intercepted;
    expect(attacking).toBe(10_000);
    expect(store.values.get("C")).toBe(90_000);
    expect(ledger.exportState().processed[0].result.intercepted).toBe(10_000);
  });

  it("restored funded receipt cannot double-charge either army", () => {
    const store = new Balances();
    const ledger = new DefenseLevyLedger(store.adapter);
    ledger.interceptAcceptedAttacks([store.attack()]);
    const balanceBefore = store.values.get("C");
    const state = ledger.exportState();
    const restored = new DefenseLevyLedger(store.adapter);
    restored.restoreState(state);
    const replay = restored.interceptAcceptedAttacks([store.attack()])[0];
    expect(replay).toMatchObject({
      application: "replay",
      intercepted: 0,
      remainingAttackingTroops: 20_000,
      contributions: [],
    });
    expect(store.values.get("C")).toBe(balanceBefore);
    expect(restored.exportState()).toEqual(state);
  });

  it("reusing an attack ID with changed size or campaign rejects before any debit", () => {
    const store = new Balances();
    const ledger = new DefenseLevyLedger(store.adapter);
    ledger.interceptAcceptedAttacks([store.attack()]);
    const balance = store.values.get("C");
    const history = ledger.exportState();
    expect(() =>
      ledger.interceptAcceptedAttacks([store.attack("attack", "different")]),
    ).toThrow("attack ID reused");
    expect(() =>
      ledger.interceptAcceptedAttacks([
        { ...store.attack(), attackingTroops: 19_999 },
      ]),
    ).toThrow("attack ID reused");
    expect(store.values.get("C")).toBe(balance);
    expect(ledger.exportState()).toEqual(history);
  });

  it("snapshot cannot store a replay receipt as a newly applied attack", () => {
    const store = new Balances();
    const ledger = new DefenseLevyLedger(store.adapter);
    ledger.interceptAcceptedAttacks([store.attack()]);
    const tampered = JSON.parse(JSON.stringify(ledger.exportState()));
    tampered.processed[0].result.application = "replay";
    expect(() =>
      new DefenseLevyLedger(store.adapter).restoreState(tampered),
    ).toThrow();
  });

  it("legitimate living nation can capture terra nullius; unknown and dead actors cannot", () => {
    const politics = new AlivePolitics();
    const wars = new WarLedger(politics);
    expect(wars.authorizeOffensiveAction("A", null)).toBe(true);
    expect(wars.authorizeOffensiveAction("UNKNOWN", null)).toBe(false);
    expect(wars.authorizeOffensiveAction("A", "UNKNOWN")).toBe(false);
    politics.alive.delete("A");
    expect(wars.authorizeOffensiveAction("A", null)).toBe(false);
    expect(wars.authorizeOffensiveAction("A", "B")).toBe(false);
  });
});
