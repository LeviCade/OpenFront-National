/** Sixth C1 E2: real Game and hostile replay acceptance. */
import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { readNationalImperialAdministration } from "@openfront/engine-api/game/NationalImperialView";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import type { Game, Player } from "@openfront/engine/game/Game";
import { GameSnapshot } from "@openfront/engine/game/GameImpl";
import { GameRunner } from "@openfront/engine/GameRunner";
import { NationalRuntime } from "@openfront/engine/national/NationalRuntime";
import { projectNationalImperialAdministration } from "@openfront/engine/national/observation/NationalPactProjection";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const [A, B, C] = ["C6R_A", "C6R_B", "C6R_C"];
const empireId = "C6Relief";
const map = "half_land_half_ocean";
const roster = [A, B, C].map(
  (id, i) => new PlayerInfo(id, PlayerType.Human, "E2CLIENT" + i, id),
);
async function fixture(nationalMode = true) {
  const game = await setup(map, { nationalMode, instantBuild: true }, roster);
  roster.forEach((info, i) => {
    const player = game.player(info.id);
    const tile = game.ref(1, 1 + i * 4);
    player.conquer(tile);
    player.setSpawnTile(tile);
    player.addGold(1_000_000_000n);
  });
  game.executeNextTick();
  const workers = vi
    .spyOn(game.config(), "goldAdditionRate")
    .mockReturnValue(0n);
  return { game, workers };
}
function join(game: Game) {
  game.performNationalCommand(game.player(A), {
    kind: "found-empire",
    empireId,
  });
  game.performNationalCommand(game.player(A), {
    kind: "offer-empire",
    empireId,
    candidateId: B,
  });
  game.performNationalCommand(game.player(B), {
    kind: "accept-empire",
    empireId,
    candidateId: B,
  });
}
function policy(game: Game, workerIncomeBps = 10000) {
  game.performNationalImperialAdministration(game.player(A), {
    kind: "set-policy",
    empireId,
    policy: {
      workerIncomeBps,
      nonWorkerIncomeBps: 0,
      fixedGoldPerPayout: "0",
      revenueClasses: {
        workers: true,
        maritime: true,
        rail: true,
        piracy: true,
      },
      allowedConstruction: null,
    },
  });
}
function treasury(game: Game, emperor = A): bigint {
  return BigInt(
    game.nationalImperialAdministrationFor(game.player(emperor))!.treasury,
  );
}
function workerPayout(
  game: Game,
  worker: Player,
  workers: { mockReturnValue(value: bigint): unknown },
  gross: bigint,
) {
  workers.mockReturnValue(gross);
  const execution = new PlayerExecution(worker);
  execution.init(game, game.ticks());
  execution.tick(game.ticks());
  workers.mockReturnValue(0n);
}
function request(game: Game, reliefId: string, amount: string, actor = B) {
  game.performNationalImperialAdministration(game.player(actor), {
    kind: "request-relief",
    empireId,
    reliefId,
    amount,
  });
}
function decide(
  game: Game,
  reliefId: string,
  decision: "approve" | "reject",
  actor = A,
  expectedVersion = 0,
) {
  game.performNationalImperialAdministration(game.player(actor), {
    kind: "decide-relief",
    empireId,
    reliefId,
    expectedVersion,
    decision,
  });
}
function ledger(game: Game) {
  return readVersioned(GameSnapshot, snapshotGameData(game).game).national!;
}
afterEach(() => vi.restoreAllMocks());

describe("C6 C1 E2 — real imperial relief", () => {
  it("spends actual worker-funded treasury grant on lawful member-paid City construction, conservation and binary replay", async () => {
    const { game, workers } = await fixture();
    join(game);
    policy(game);
    const member = game.player(B);
    member.removeGold(member.gold());
    const buildTile = game.ref(1, 11);
    member.conquer(buildTile);
    const cost = game.unitInfo(UnitType.City).cost(game, member);
    expect(cost).toBeGreaterThan(0n);
    const grant = cost + 29n;
    expect(grant).toBeLessThan(1_000_000_000_000n);
    expect(member.gold()).toBe(0n);
    expect(member.canBuild(UnitType.City, buildTile)).toBe(false);
    const earnedBefore = member.goldEarned();
    workerPayout(game, member, workers, grant + 61n);
    expect(treasury(game)).toBe(grant + 61n);
    expect(member.gold()).toBe(0n);
    const before = { wallet: member.gold(), treasury: treasury(game) };
    expect(member.goldEarned()).toBe(earnedBefore);
    request(game, "real-worker-to-building", grant.toString());
    decide(game, "real-worker-to-building", "approve");
    expect(treasury(game)).toBe(61n);
    expect(member.gold()).toBe(grant);
    expect(member.goldEarned()).toBe(earnedBefore);
    expect(treasury(game) + member.gold()).toBe(
      before.treasury + before.wallet,
    );
    const valid = member.canBuild(UnitType.City, buildTile);
    expect(valid).not.toBe(false);
    if (valid === false) throw new Error("no lawful city position");
    const structure = member.buildUnit(UnitType.City, valid, {});
    expect(structure.owner()).toBe(member);
    expect(member.gold()).toBe(grant - cost);
    expect(treasury(game)).toBe(61n);
    console.info(
      "C6_E2_REAL_WITNESS=" +
        JSON.stringify({
          workerGross: (grant + 61n).toString(),
          treasuryBefore: before.treasury.toString(),
          walletBefore: before.wallet.toString(),
          approvedAmount: grant.toString(),
          treasuryAfter: treasury(game).toString(),
          walletAfterConstruction: member.gold().toString(),
          realConstructionCost: cost.toString(),
        }),
    );
    const { restored, bytes, again } = await roundTrip(game, map);
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    expect(restored.player(B).gold()).toBe(member.gold());
    expect(
      restored.nationalImperialAdministrationFor(restored.player(B))
        ?.reliefRequests[0]?.status,
    ).toBe("approved");
  });

  it("GameRunner stamps separate member request and emperor decision; duplicate IDs cannot pay twice", async () => {
    const { game, workers } = await fixture();
    join(game);
    policy(game);
    workerPayout(game, game.player(B), workers, 1000n);
    const before = game.player(B).gold();
    const runner = new GameRunner(
      game,
      new Executor(game, "c6c1e2", undefined),
      () => {},
    );
    const stamped = (
      actor: string,
      requestId: string,
      command: Record<string, unknown>,
    ) =>
      StampedIntentSchema.parse({
        type: "national_imperial_administration",
        clientID: game.player(actor).clientID(),
        requestId,
        command,
      });
    runner.addTurn({
      turnNumber: 0,
      intents: [
        stamped(B, "request-once-stamped", {
          kind: "request-relief",
          empireId,
          reliefId: "runner-grant",
          amount: "400",
        }),
      ],
    });
    expect(runner.executeNextTick()).toBe(true);
    game.executeNextTick();
    expect(
      game.nationalImperialAdministrationFor(game.player(B))?.reliefRequests[0]
        ?.status,
    ).toBe("pending");
    runner.addTurn({
      turnNumber: 1,
      intents: [
        stamped(A, "approve-once-stamped", {
          kind: "decide-relief",
          empireId,
          reliefId: "runner-grant",
          expectedVersion: 0,
          decision: "approve",
        }),
      ],
    });
    expect(runner.executeNextTick()).toBe(true);
    game.executeNextTick();
    expect(treasury(game)).toBe(600n);
    expect(game.player(B).gold() - before).toBe(400n);
    expect(() => decide(game, "runner-grant", "approve")).toThrow();
    expect(() => request(game, "runner-grant", "200")).toThrow();
    expect(treasury(game)).toBe(600n);
    expect(game.player(B).gold() - before).toBe(400n);
  });

  it("rejects insufficient gold, nonmembers, foreign empires, self requests, malformed amounts and stale decisions", async () => {
    const { game } = await fixture();
    join(game);
    policy(game, 0);
    const initial = game.player(B).gold();
    request(game, "unfunded", "600");
    expect(() => decide(game, "unfunded", "approve")).toThrow(
      "insufficient imperial relief treasury",
    );
    expect(treasury(game)).toBe(0n);
    expect(game.player(B).gold()).toBe(initial);
    expect(() => request(game, "unfunded", "1")).toThrow();
    expect(() => request(game, "foreign", "20", C)).toThrow();
    expect(() => request(game, "emperor-self", "20", A)).toThrow();
    expect(() => request(game, "zero", "0")).toThrow();
    expect(() => request(game, "leading", "001")).toThrow();
    expect(() => request(game, "overflow", "9999999999999")).toThrow();
    expect(
      StampedIntentSchema.safeParse({
        type: "national_imperial_administration",
        clientID: game.player(B).clientID(),
        requestId: "bad-wire",
        command: {
          kind: "request-relief",
          empireId,
          reliefId: "bad-wire",
          amount: "-1",
        },
      }).success,
    ).toBe(false);
    expect(() =>
      game.performNationalImperialAdministration(game.player(A), {
        kind: "decide-relief",
        empireId: "otherEmpire",
        reliefId: "unfunded",
        expectedVersion: 0,
        decision: "approve",
      }),
    ).toThrow();
    request(game, "rejected", "1");
    decide(game, "rejected", "reject");
    expect(() => decide(game, "rejected", "approve", A, 1)).toThrow();
    expect(() => decide(game, "rejected", "reject")).toThrow();
    expect(treasury(game)).toBe(0n);
    expect(game.player(B).gold()).toBe(initial);
  });

  it("rejects stale emperor after crown transfer and prevents new emperor approving own request", async () => {
    const { game, workers } = await fixture();
    join(game);
    policy(game);
    workerPayout(game, game.player(B), workers, 100n);
    request(game, "crown-request", "40");
    game.performNationalCommand(game.player(A), {
      kind: "transfer-crown",
      empireId,
      successorId: B,
    });
    expect(() => decide(game, "crown-request", "approve", A)).toThrow();
    expect(() => decide(game, "crown-request", "approve", B)).toThrow();
    expect(treasury(game, B)).toBe(100n);
    expect(
      game.nationalImperialAdministrationFor(game.player(B))?.reliefRequests[0]
        ?.status,
    ).toBe("pending");
  });

  it("migrates absent old V1 ledger; rejects duplicate/tampered snapshot and cancels obligations on dissolution", async () => {
    const { game, workers } = await fixture();
    join(game);
    policy(game);
    workerPayout(game, game.player(B), workers, 100n);
    request(game, "paid-record", "25");
    decide(game, "paid-record", "approve");
    request(game, "pending-record", "10");
    const saved = ledger(game);
    expect(saved.reliefRequests?.map((r) => r.status)).toEqual([
      "approved",
      "pending",
    ]);
    const restored = NationalRuntime.restore(saved, [A, B, C], game.ticks());
    expect(restored.snapshot()).toEqual(saved);
    expect(() =>
      restored.requestImperialRelief(B, empireId, "paid-record", "5"),
    ).toThrow();
    expect(() =>
      NationalRuntime.restore(
        {
          ...saved,
          reliefRequests: [
            ...(saved.reliefRequests ?? []),
            saved.reliefRequests![0],
          ],
        },
        [A, B, C],
        game.ticks(),
      ),
    ).toThrow("duplicate");
    expect(() =>
      NationalRuntime.restore(
        {
          ...saved,
          reliefRequests: [
            { ...saved.reliefRequests![1], version: 1, status: "pending" },
          ],
        },
        [A, B, C],
        game.ticks(),
      ),
    ).toThrow("invalid");
    const oldV1 = { ...saved, reliefRequests: undefined };
    expect(
      NationalRuntime.restore(oldV1, [A, B, C], game.ticks()).snapshot()
        .reliefRequests,
    ).toBeUndefined();
    game.performNationalImperialAdministration(game.player(A), {
      kind: "dissolve",
      empireId,
    });
    expect(
      ledger(game).reliefRequests?.find((r) => r.reliefId === "pending-record")
        ?.status,
    ).toBe("cancelled");
  });

  it("keeps requests recipient-private and forbids relief in FFA", async () => {
    const { game } = await fixture();
    join(game);
    policy(game, 0);
    request(game, "private-request", "25");
    const politics = ledger(game).politics;
    const leader = projectNationalImperialAdministration(
      game,
      A,
      politics,
      game.ticks(),
    );
    const member = projectNationalImperialAdministration(
      game,
      B,
      politics,
      game.ticks(),
    );
    expect(leader?.reliefRequests?.map((r) => r.reliefId)).toEqual([
      "private-request",
    ]);
    expect(member?.reliefRequests?.map((r) => r.reliefId)).toEqual([
      "private-request",
    ]);
    expect(
      projectNationalImperialAdministration(game, C, politics, game.ticks()),
    ).toBeUndefined();
    expect(
      readNationalImperialAdministration(
        {
          ...member,
          reliefRequests: [{ ...member!.reliefRequests![0], memberId: C }],
        },
        politics,
        B,
        game.ticks(),
      ),
    ).toBeNull();
    const { game: ffa } = await fixture(false);
    expect(ffa.nationalImperialAdministrationFor(ffa.player(B))).toBeNull();
    expect(() => request(ffa, "ffa", "1")).toThrow("NATIONAL is not enabled");
    const old = ffa.player(B).gold();
    ffa.creditNationalCommercialIncome(ffa.player(B), 17n);
    expect(ffa.player(B).gold() - old).toBe(17n);
  });
});
