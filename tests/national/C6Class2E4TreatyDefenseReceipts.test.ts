import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { validateNationalAssessmentPacket } from "@openfront/engine-api/game/NationalAssessmentView";
import type { StampedIntent } from "@openfront/engine-api/Schemas";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const [A, B, C, D, E] = [
  "e4-attacker",
  "e4-defender",
  "e4-donor-c",
  "e4-donor-d",
  "e4-outsider",
];
const ids = [A, B, C, D, E];
const client = (id: string) => id + "-client";
const terms = { admission: "leader", expulsion: "forbidden" } as const;

// Freeze passive growth only; inventory, attacks, politics, and debit
// transactions are the real Game/PlayerImpl implementations.
class AccountingConfig extends TestConfig {
  troopIncreaseRate(): number {
    return 0;
  }
  goldAdditionRate(): bigint {
    return 0n;
  }
}

async function fixture() {
  const records = ids.map(
    (id) => new PlayerInfo(id, PlayerType.Human, client(id), id),
  );
  const game = await setup(
    "plains",
    { nationalMode: true },
    records,
    undefined,
    AccountingConfig,
  );
  const coords = [
    [20, 20],
    [70, 20],
    [20, 70],
    [70, 70],
    [50, 50],
  ];
  for (let i = 0; i < ids.length; i++) {
    game.addExecution(
      new SpawnExecution(
        "e4-live",
        records[i],
        game.ref(coords[i][0], coords[i][1]),
      ),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (let y = 30; y < 46; y++) {
    for (let x = 30; x < 50; x++) game.player(A).conquer(game.ref(x, y));
    for (let x = 50; x < 70; x++) game.player(B).conquer(game.ref(x, y));
  }
  game.executeNextTick();
  for (const id of ids) {
    const p = game.player(id);
    expect(p.hasSpawned()).toBe(true);
    p.setTroops(Math.floor(game.config().maxTroops(p)));
  }
  return game;
}

function frame(
  game: Game,
  intents: StampedIntent[],
  viewer?: string,
): GameUpdateViewData {
  let result: GameUpdateViewData | undefined;
  const runner = new GameRunner(
    game,
    new Executor(game, "e4-live", viewer),
    (event) => {
      if ("updates" in event) result = event;
    },
    viewer,
  );
  game.queueViewResync();
  runner.addTurn({ turnNumber: game.ticks(), intents });
  expect(runner.executeNextTick()).toBe(true);
  if (!result) throw new Error("missing GameRunner frame");
  return result;
}

function pact(game: Game, donor: string, defender = B) {
  const pactId = "mda-" + defender + "-" + donor;
  game.performNationalCommand(game.player(defender), {
    kind: "found-pact",
    pactId,
    pactKind: "MDA",
    name: pactId,
    terms,
  });
  game.performNationalCommand(game.player(defender), {
    kind: "invite-pact",
    pactId,
    candidateId: donor,
  });
  game.performNationalCommand(game.player(donor), {
    kind: "accept-pact",
    pactId,
  });
  return pactId;
}

function propose(
  game: Game,
  pactId: string,
  cap: number,
  reserve: number,
  defender = B,
) {
  game.performNationalCommand(game.player(defender), {
    kind: "propose-pact-amendment",
    pactId,
    terms: {
      ...terms,
      defenseContributionBps: cap,
      defenseReserveBps: reserve,
    },
    administratorId: defender,
  });
  const version = game
    .nationalPactViewsFor(game.player(defender))
    .find((p) => p.id === pactId)?.pendingAmendment?.defenseVersion;
  expect(version).toBeGreaterThan(0);
  return version!;
}

function war(game: Game, target = B) {
  game.performNationalWarCommand(game.player(A), {
    kind: "declare-national",
    warId: "e4-war-" + target,
    aggressorId: A,
    targetId: target,
  });
}

function invade(game: Game) {
  frame(
    game,
    [{ type: "attack", clientID: client(A), targetID: B, troops: 50_000 }],
    client(A),
  );
  return game.nationalWarState()!.levy.processed[0].result;
}

describe("C6 Class 2 E4 real constitutional defense and assessment receipts", () => {
  it("two approved treaties determine distinct actual levies from a 50,000 troop invasion; replay is identical", async () => {
    const game = await fixture();
    const c = pact(game, C),
      d = pact(game, D);
    const vc = propose(game, c, 400, 8000);
    const vd = propose(game, d, 1000, 3000);
    expect(() =>
      game.performNationalCommand(game.player(E), {
        kind: "approve-pact-amendment",
        pactId: c,
        expectedDefenseVersion: vc,
      }),
    ).toThrow();
    expect(() =>
      game.performNationalCommand(game.player(C), {
        kind: "approve-pact-amendment",
        pactId: c,
        expectedDefenseVersion: vd,
      }),
    ).toThrow(/stale defense amendment/);
    for (const [id, pactId, version] of [
      [C, c, vc],
      [D, d, vd],
    ] as const) {
      frame(
        game,
        [
          {
            type: "national_approve_pact_amendment",
            clientID: client(id),
            pactId,
            expectedDefenseVersion: version,
            requestId: "approve-" + id,
          },
        ],
        client(id),
      );
      frame(game, [], client(id));
      expect(
        game.nationalPactViewsFor(game.player(id)).find((p) => p.id === pactId)
          ?.pendingAmendment,
      ).toBeNull();
    }
    war(game);
    const donors = [C, D].map((id) => game.player(id));
    const before = donors.map((p) => p.troops());
    const caps = [400, 1000];
    const reserves = donors.map((p, i) =>
      Math.ceil(Math.floor(game.config().maxTroops(p)) * [0.8, 0.3][i]),
    );
    const expected = before.map((n, i) =>
      Math.min(Math.floor((n * caps[i]) / 10000), n - reserves[i]),
    );
    expect(expected[0]).toBeGreaterThan(0);
    expect(expected[1]).toBeGreaterThan(0);
    expect(expected[0]).not.toBe(expected[1]);
    const attackerBefore = game.player(A).troops();
    const defenderBefore = game.player(B).troops();
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    const result = invade(game);
    const replay = invade(restored);
    expect(replay).toEqual(result);
    expect(result.application).toBe("applied");
    expect(donors.map((p, i) => before[i] - p.troops())).toEqual(expected);
    expect(result.intercepted).toBe(expected[0] + expected[1]);
    expect(game.player(A).troops()).toBe(attackerBefore - 50_000);
    expect(game.player(B).troops()).toBe(defenderBefore);
    expect(
      game
        .player(A)
        .outgoingAttacks()
        .reduce((n, a) => n + a.troops(), 0),
    ).toBe(50_000 - result.intercepted);
    for (let i = 0; i < donors.length; i++) {
      expect(donors[i].troops()).toBeGreaterThanOrEqual(reserves[i]);
      expect(restored.player(donors[i].id()).troops()).toBe(donors[i].troops());
    }
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    const snapshotHash = (g: Game) =>
      createHash("sha256").update(snapshotGame(g)).digest("hex");
    expect(snapshotHash(restored)).toBe(snapshotHash(game));
    console.info(
      "[C6C2-E4-MDA-LEVY-POLICY]",
      JSON.stringify({
        invasion: 50000,
        before,
        reserves,
        expected,
        intercepted: result.intercepted,
        remaining: donors.map((p) => p.troops()),
        remainingAttacker: 50000 - result.intercepted,
        replaySha256: snapshotHash(game),
      }),
    );
    const spent = donors.map((p) => p.troops());
    // Relaxing both terms cannot renew the consumed campaign budget.
    for (const [id, pactId] of [
      [C, c],
      [D, d],
    ] as const) {
      const version = propose(game, pactId, 1000, 3000);
      game.performNationalCommand(game.player(id), {
        kind: "approve-pact-amendment",
        pactId,
        expectedDefenseVersion: version,
      });
    }
    for (let i = 0; i < 20; i++) {
      new AttackExecution(500, game.player(A), B).init(game, game.ticks());
    }
    expect(donors.map((p) => p.troops())).toEqual(spent);
    for (const allowance of game.nationalWarState()!.levy.allowances) {
      expect(allowance.spent).toBeLessThanOrEqual(allowance.limit);
    }
  });

  it("incomplete or stale consent leaves default levy intact", async () => {
    const game = await fixture();
    const c = pact(game, C);
    const version = propose(game, c, 0, 10000);
    expect(() =>
      game.performNationalCommand(game.player(C), {
        kind: "approve-pact-amendment",
        pactId: c,
      }),
    ).toThrow(/stale defense amendment/);
    expect(
      game.nationalPactViewsFor(game.player(C)).find((p) => p.id === c)
        ?.pendingAmendment?.defenseVersion,
    ).toBe(version);
    war(game);
    const before = game.player(C).troops();
    const result = invade(game);
    expect(result.intercepted).toBe(Math.floor(before * 0.1));
    expect(game.player(C).troops()).toBe(before - result.intercepted);
  });

  it("reduces a funded campaign mid-battle and preserves the same real donor across simultaneous fronts and twenty microattacks", async () => {
    const game = await fixture();
    for (let y = 60; y < 68; y++) {
      for (let x = 30; x < 50; x++) game.player(A).conquer(game.ref(x, y));
      for (let x = 50; x < 65; x++) game.player(E).conquer(game.ref(x, y));
    }
    game.executeNextTick();
    const c = pact(game, C),
      other = pact(game, C, E);
    const vOther = propose(game, other, 400, 9500, E);
    game.performNationalCommand(game.player(C), {
      kind: "approve-pact-amendment",
      pactId: other,
      expectedDefenseVersion: vOther,
    });
    war(game);
    war(game, E);
    const donor = game.player(C),
      attacker = game.player(A);
    const before = donor.troops();
    const protectedReserve = Math.ceil(
      Math.floor(game.config().maxTroops(donor)) * 0.95,
    );
    attacker.setTroops(Math.floor(game.config().maxTroops(attacker)));
    const attack = (target: string, troops: number) => {
      new AttackExecution(troops, attacker, target).init(game, game.ticks());
    };
    attack(B, 1000);
    expect(before - donor.troops()).toBe(1000);
    const version = propose(game, c, 200, 3000);
    game.performNationalCommand(donor, {
      kind: "approve-pact-amendment",
      pactId: c,
      expectedDefenseVersion: version,
    });
    attack(B, 50000);
    const afterB = donor.troops();
    expect(before - afterB).toBe(Math.floor(before * 0.02));
    attack(E, 50000);
    const afterE = donor.troops();
    expect(afterB - afterE).toBe(
      Math.min(Math.floor(afterB * 0.04), afterB - protectedReserve),
    );
    expect(afterE).toBeGreaterThanOrEqual(protectedReserve);
    for (let i = 0; i < 20; i++) attack(i % 2 === 0 ? B : E, 500);
    const levy = game.nationalWarState()!.levy;
    expect(levy.processed).toHaveLength(23);
    expect(levy.allowances).toHaveLength(2);
    expect(donor.troops()).toBe(afterE);
    expect(before - donor.troops()).toBe(
      levy.allowances.reduce((sum, x) => sum + x.spent, 0),
    );
    expect(before - donor.troops()).toBe(
      levy.processed.reduce((sum, x) => sum + x.result.intercepted, 0),
    );
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    console.info(
      "[E4 two fronts]",
      JSON.stringify({
        before,
        afterB,
        afterE,
        protectedReserve,
        attacks: levy.processed.length,
        ledger: levy.allowances,
        replaySha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    );
  });

  it("revokes a pending defense amendment after membership changes and rejects its old version", async () => {
    const game = await fixture();
    const c = pact(game, C);
    const old = propose(game, c, 400, 8000);
    game.performNationalCommand(game.player(B), {
      kind: "invite-pact",
      pactId: c,
      candidateId: E,
    });
    game.performNationalCommand(game.player(E), {
      kind: "accept-pact",
      pactId: c,
    });
    const current = propose(game, c, 200, 9000);
    expect(current).toBeGreaterThan(old);
    expect(() =>
      game.performNationalCommand(game.player(C), {
        kind: "approve-pact-amendment",
        pactId: c,
        expectedDefenseVersion: old,
      }),
    ).toThrow(/stale defense amendment/);
    game.performNationalCommand(game.player(E), {
      kind: "approve-pact-amendment",
      pactId: c,
      expectedDefenseVersion: current,
    });
    const pending = game
      .nationalPactViewsFor(game.player(B))
      .find((p) => p.id === c)!;
    expect(pending.terms.defenseContributionBps).toBeUndefined();
    expect(pending.pendingAmendment?.defenseVersion).toBe(current);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    restored.performNationalCommand(restored.player(C), {
      kind: "approve-pact-amendment",
      pactId: c,
      expectedDefenseVersion: current,
    });
    expect(
      restored.nationalPactViewsFor(restored.player(B)).find((p) => p.id === c)
        ?.terms.defenseContributionBps,
    ).toBe(200);
  });

  it("two overlapping same-target purchases and a denial produce exact payer receipts, conserved gold, and restored replay protection", async () => {
    const game = await fixture();
    const payer = game.player(B);
    payer.removeGold(payer.gold());
    payer.addGold(2400n);
    const purchase = (requestId: string): StampedIntent => ({
      type: "national_buy_national_assessment",
      clientID: client(B),
      targetId: A,
      requestId,
    });
    frame(game, [purchase("first")], client(B));
    const earlier = frame(
      game,
      [purchase("second"), purchase("denied")],
      client(B),
    );
    const packet = frame(game, [], client(B));
    expect(
      earlier.nationalAssessments?.receipts?.map((r) => r.requestId),
    ).toEqual(["first"]);
    const report = packet.nationalAssessments!;
    expect(payer.gold()).toBe(0n);
    expect(report.items).toHaveLength(2);
    expect(report.items.every((i) => !("requestId" in i))).toBe(true);
    expect(report.receipts).toHaveLength(3);
    const reversed = { ...report, receipts: [...report.receipts!].reverse() };
    validateNationalAssessmentPacket(reversed, B, game.ticks());
    const outcomes = new Map<string, string[]>();
    // Deliver two genuine snapshots newest first. Missing older rows cannot
    // revoke an acknowledged request or acknowledge another pending click.
    for (const f of [packet, earlier]) {
      validateNationalAssessmentPacket(f.nationalAssessments, B, f.tick);
      for (const receipt of f.nationalAssessments?.receipts ?? []) {
        expect(receipt.targetId).toBe(A);
        outcomes.set(receipt.requestId, [receipt.outcome, receipt.cost]);
      }
    }
    expect(outcomes.get("first")).toEqual(["accepted", "1200"]);
    expect(outcomes.get("second")).toEqual(["accepted", "1200"]);
    expect(outcomes.get("denied")).toEqual(["rejected", "0"]);
    expect(outcomes.has("unsubmitted")).toBe(false);
    expect(() =>
      validateNationalAssessmentPacket(reversed, E, game.ticks()),
    ).toThrow();
    expect(() =>
      validateNationalAssessmentPacket(reversed, null, game.ticks()),
    ).toThrow();
    expect(() =>
      validateNationalAssessmentPacket(
        {
          ...reversed,
          receipts: [{ ...reversed.receipts[0], payerId: E }],
        },
        B,
        game.ticks(),
      ),
    ).toThrow();
    expect(
      frame(game, [], client(E)).nationalAssessments?.receipts ?? [],
    ).toEqual([]);
    expect(frame(game, []).nationalAssessments?.receipts ?? []).toEqual([]);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    const rp = restored.player(B);
    rp.addGold(5000n);
    frame(
      restored,
      [purchase("first"), purchase("second"), purchase("denied")],
      client(B),
    );
    const restoredPacket = frame(restored, [], client(B));
    expect(rp.gold()).toBe(5000n);
    expect(restoredPacket.nationalAssessments?.receipts).toEqual(
      report.receipts,
    );
    expect(restored.nationalAssessmentsFor(B)).toHaveLength(2);
    const replayFlag = vi
      .spyOn(restored.config(), "isReplay")
      .mockReturnValue(true);
    expect(restored.nationalAssessmentReceiptsFor!(rp)).toEqual([]);
    replayFlag.mockRestore();
    console.info(
      "[E4 M7] initial=2400 charged=2400 remaining=0 restored-retry-charge=0 outcomes=accepted,accepted,rejected replaySha256=" +
        createHash("sha256").update(bytes).digest("hex"),
    );
  });
});
