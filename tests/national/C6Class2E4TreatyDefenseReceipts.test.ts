import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { validateNationalAssessmentPacket } from "@openfront/engine-api/game/NationalAssessmentView";
import type { StampedIntent } from "@openfront/engine-api/Schemas";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const [A, B, C, D, E] = ["e4-attacker", "e4-defender", "e4-donor-c", "e4-donor-d", "e4-outsider"];
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
  const game = await setup("plains", { nationalMode: true }, records, undefined, AccountingConfig);
  const coords = [[20, 20], [70, 20], [20, 70], [70, 70], [50, 50]];
  for (let i = 0; i < ids.length; i++) {
    game.addExecution(new SpawnExecution("e4-live", records[i], game.ref(coords[i][0], coords[i][1])));
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

function frame(game: Game, intents: StampedIntent[], viewer?: string): GameUpdateViewData {
  let result: GameUpdateViewData | undefined;
  const runner = new GameRunner(game, new Executor(game, "e4-live", viewer), (event) => {
    if ("updates" in event) result = event;
  }, viewer);
  game.queueViewResync();
  runner.addTurn({ turnNumber: game.ticks(), intents });
  expect(runner.executeNextTick()).toBe(true);
  if (!result) throw new Error("missing GameRunner frame");
  return result;
}

function pact(game: Game, donor: string) {
  const pactId = "mda-" + donor;
  game.performNationalCommand(game.player(B), {
    kind: "found-pact", pactId, pactKind: "MDA", name: pactId, terms,
  });
  game.performNationalCommand(game.player(B), {
    kind: "invite-pact", pactId, candidateId: donor,
  });
  game.performNationalCommand(game.player(donor), { kind: "accept-pact", pactId });
  return pactId;
}

function propose(game: Game, pactId: string, cap: number, reserve: number) {
  game.performNationalCommand(game.player(B), {
    kind: "propose-pact-amendment", pactId,
    terms: { ...terms, defenseContributionBps: cap, defenseReserveBps: reserve },
    administratorId: B,
  });
  const version = game.nationalPactViewsFor(game.player(B)).find((p) => p.id === pactId)?.pendingAmendment?.defenseVersion;
  expect(version).toBeGreaterThan(0);
  return version!;
}

function war(game: Game) {
  game.performNationalWarCommand(game.player(A), {
    kind: "declare-national", warId: "e4-war", aggressorId: A, targetId: B,
  });
}

function invade(game: Game) {
  frame(game, [{ type: "attack", clientID: client(A), targetID: B, troops: 50_000 }], client(A));
  return game.nationalWarState()!.levy.processed[0].result;
}

describe("C6 Class 2 E4 real constitutional defense and assessment receipts", () => {
  it("two approved treaties determine distinct actual levies from a 50,000 troop invasion; replay is identical", async () => {
    const game = await fixture();
    const c = pact(game, C), d = pact(game, D);
    const vc = propose(game, c, 400, 8000);
    const vd = propose(game, d, 900, 9500);
    expect(() => game.performNationalCommand(game.player(E), {
      kind: "approve-pact-amendment", pactId: c, expectedDefenseVersion: vc,
    })).toThrow();
    expect(() => game.performNationalCommand(game.player(C), {
      kind: "approve-pact-amendment", pactId: c, expectedDefenseVersion: vd,
    })).toThrow(/stale defense amendment/);
    for (const [id, pactId, version] of [[C, c, vc], [D, d, vd]] as const) {
      frame(game, [{
        type: "national_approve_pact_amendment", clientID: client(id), pactId,
        expectedDefenseVersion: version, requestId: "approve-" + id,
      }], client(id));
      frame(game, [], client(id));
      expect(game.nationalPactViewsFor(game.player(id)).find((p) => p.id === pactId)?.pendingAmendment).toBeNull();
    }
    war(game);
    const donors = [C, D].map((id) => game.player(id));
    const before = donors.map((p) => p.troops());
    const caps = [400, 900];
    const reserves = donors.map((p, i) => Math.ceil(Math.floor(game.config().maxTroops(p)) * [0.8, 0.95][i]));
    const expected = before.map((n, i) => Math.min(Math.floor(n * caps[i] / 10000), n - reserves[i]));
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
    expect(game.player(A).outgoingAttacks().reduce((n, a) => n + a.troops(), 0)).toBe(50_000 - result.intercepted);
    for (let i = 0; i < donors.length; i++) {
      expect(donors[i].troops()).toBeGreaterThanOrEqual(reserves[i]);
      expect(restored.player(donors[i].id()).troops()).toBe(donors[i].troops());
    }
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    console.info("[E4 M4]", JSON.stringify({ invasion: 50000, before, reserves, expected, intercepted: result.intercepted, remaining: donors.map((p) => p.troops()) }));
    const spent = donors.map((p) => p.troops());
    // Relaxing both terms cannot renew the consumed campaign budget.
    for (const [id, pactId] of [[C, c], [D, d]] as const) {
      const version = propose(game, pactId, 1000, 3000);
      game.performNationalCommand(game.player(id), {
        kind: "approve-pact-amendment", pactId, expectedDefenseVersion: version,
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
    expect(() => game.performNationalCommand(game.player(C), {
      kind: "approve-pact-amendment", pactId: c,
    })).toThrow(/stale defense amendment/);
    expect(game.nationalPactViewsFor(game.player(C)).find((p) => p.id === c)?.pendingAmendment?.defenseVersion).toBe(version);
    war(game);
    const before = game.player(C).troops();
    const result = invade(game);
    expect(result.intercepted).toBe(Math.floor(before * 0.1));
    expect(game.player(C).troops()).toBe(before - result.intercepted);
  });

  it("two overlapping same-target purchases and a denial produce exact payer receipts, conserved gold, and restored replay protection", async () => {
    const game = await fixture();
    const payer = game.player(B);
    payer.removeGold(payer.gold());
    payer.addGold(2400n);
    const purchase = (requestId: string): StampedIntent => ({
      type: "national_buy_national_assessment", clientID: client(B), targetId: A, requestId,
    });
    frame(game, [purchase("first"), purchase("second"), purchase("denied")], client(B));
    const packet = frame(game, [], client(B));
    const report = packet.nationalAssessments!;
    expect(payer.gold()).toBe(0n);
    expect(report.items).toHaveLength(2);
    expect(report.items.every((i) => !("requestId" in i))).toBe(true);
    expect(report.receipts).toHaveLength(3);
    const reversed = { ...report, receipts: [...report.receipts!].reverse() };
    validateNationalAssessmentPacket(reversed, B, game.ticks());
    const outcomes = new Map(reversed.receipts.map((r) => [r.requestId, [r.outcome, r.cost]]));
    expect(outcomes.get("first")).toEqual(["accepted", "1200"]);
    expect(outcomes.get("second")).toEqual(["accepted", "1200"]);
    expect(outcomes.get("denied")).toEqual(["rejected", "0"]);
    expect(outcomes.has("unsubmitted")).toBe(false);
    expect(() => validateNationalAssessmentPacket(reversed, E, game.ticks())).toThrow();
    expect(() => validateNationalAssessmentPacket(reversed, null, game.ticks())).toThrow();
    expect(() => validateNationalAssessmentPacket({
      ...reversed, receipts: [{ ...reversed.receipts[0], payerId: E }],
    }, B, game.ticks())).toThrow();
    expect(frame(game, [], client(E)).nationalAssessments?.receipts ?? []).toEqual([]);
    expect(frame(game, []).nationalAssessments?.receipts ?? []).toEqual([]);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    const rp = restored.player(B);
    rp.addGold(5000n);
    frame(restored, [purchase("first"), purchase("second"), purchase("denied")], client(B));
    const restoredPacket = frame(restored, [], client(B));
    expect(rp.gold()).toBe(5000n);
    expect(restoredPacket.nationalAssessments?.receipts).toEqual(report.receipts);
    expect(restored.nationalAssessmentsFor(B)).toHaveLength(2);
    const replayFlag = vi.spyOn(restored.config(), "isReplay").mockReturnValue(true);
    expect(restored.nationalAssessmentReceiptsFor!(rp)).toEqual([]);
    replayFlag.mockRestore();
    console.info("[E4 M7] initial=2400 charged=2400 remaining=0 restored-retry-charge=0 outcomes=accepted,accepted,rejected");
  });
});
