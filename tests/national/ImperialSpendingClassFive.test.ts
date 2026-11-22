import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { TrainExecution } from "@openfront/engine/execution/TrainExecution";
import type { Game, Unit } from "@openfront/engine/game/Game";
import { GameSnapshot } from "@openfront/engine/game/GameImpl";
import { TrainStation } from "@openfront/engine/game/TrainStation";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

/** D-011 M5: all actors, structures, gold and authority are actual Game objects. */
const roster = [
  new PlayerInfo("North", PlayerType.Human, "C5NORTH1", "C5NORTH01"),
  new PlayerInfo("South", PlayerType.Human, "C5SOUTH1", "C5SOUTH01"),
  new PlayerInfo("West", PlayerType.Human, "C5WEST01", "C5WEST001"),
];
const N = "C5NORTH01";
const S = "C5SOUTH01";
const W = "C5WEST001";
const empireId = "c5-empire";

async function liveGame(nationalMode = true): Promise<Game> {
  const game = await setup("plains", { nationalMode }, roster);
  const points = [
    game.map().ref(30, 30),
    game.map().ref(70, 70),
    game.map().ref(30, 70),
  ];
  roster.forEach((p, i) =>
    game.addExecution(new SpawnExecution("c5-game", p, points[i])),
  );
  game.executeNextTick();
  game.executeNextTick();
  for (const p of roster) expect(game.player(p.id).hasSpawned()).toBe(true);
  return game;
}

function join(game: Game): void {
  game.performNationalCommand(game.player(N), {
    kind: "found-empire",
    empireId,
  });
  game.performNationalCommand(game.player(N), {
    kind: "offer-empire",
    empireId,
    candidateId: S,
  });
  game.performNationalCommand(game.player(S), {
    kind: "accept-empire",
    empireId,
    candidateId: S,
  });
}

function policy(
  game: Game,
  workerIncomeBps: number,
  nonWorkerIncomeBps = 0,
): void {
  game.performNationalImperialAdministration(game.player(N), {
    kind: "set-policy",
    empireId,
    policy: { workerIncomeBps, nonWorkerIncomeBps, allowedConstruction: [] },
  });
}

function treasury(game: Game): bigint {
  return BigInt(
    game.nationalImperialAdministrationFor(game.player(N))!.treasury,
  );
}

/** Real PlayerExecution gold route; mock only the income-rate input for a bounded case. */
function workerIncome(game: Game, gross: bigint): void {
  const spy = vi
    .spyOn(game.config(), "goldAdditionRate")
    .mockReturnValue(gross);
  try {
    const execution = new PlayerExecution(game.player(S));
    execution.init(game, game.ticks());
    execution.tick(game.ticks());
  } finally {
    spy.mockRestore();
  }
}

function city(game: Game): Unit {
  const member = game.player(S);
  member.addGold(game.unitInfo(UnitType.City).cost(game, member));
  const unit = member.buildUnit(UnitType.City, [...member.tiles()][0], {});
  unit.setUnderConstruction(false); // fixture: an existing, completed structure
  return unit;
}

function queue(
  game: Game,
  requestId: string,
  command: {
    kind: "upgrade-structure" | "demolish-structure";
    empireId: string;
    memberId: string;
    unitId: number;
  },
  clientID = game.player(N).clientID()!,
): void {
  const executor = new Executor(game, "c5-game", undefined);
  game.addExecution(
    executor.createExec(
      StampedIntentSchema.parse({
        type: "national_imperial_administration",
        requestId,
        clientID,
        command,
      }),
    ),
  );
}

function political(game: Game, requestId: string) {
  return game
    .nationalPoliticalCommandResults(game.player(N))
    .find((receipt) => receipt.requestId === requestId);
}

function national(game: Game) {
  return readVersioned(GameSnapshot, snapshotGameData(game).game).national;
}

describe("Fifth Conductor / Class One / E2 — executable imperial spending (D-011)", () => {
  it("builds, upgrades, and demolishes actual member property using the treasury only", async () => {
    const game = await liveGame();
    join(game);
    const leader = game.player(N);
    const member = game.player(S);
    policy(game, 10_000);
    const firstCost = game.unitInfo(UnitType.City).cost(game, member);
    const funding = firstCost * 100n + 37n;
    workerIncome(game, funding);
    const personal = [leader.gold(), member.gold()];
    const tile = [...member.tiles()][0];
    game.performNationalImperialAdministration(leader, {
      kind: "build-structure",
      empireId,
      memberId: S,
      type: UnitType.City,
      tile,
    });
    const building = member.units(UnitType.City)[0];
    expect(building).toBeDefined();
    expect(building.owner()).toBe(member);
    expect(treasury(game)).toBe(funding - firstCost);
    expect([leader.gold(), member.gold()]).toEqual(personal);

    const duration = game.unitInfo(UnitType.City).constructionDuration ?? 0;
    for (let i = 0; i < duration + 3 && building.isUnderConstruction(); i++)
      game.executeNextTick();
    expect(building.isUnderConstruction()).toBe(false);
    // Ambient ticks also award ordinary personal income to the leader.
    const personalAfterConstruction = [leader.gold(), member.gold()];
    const before = treasury(game);
    const level = building.level();
    const nextCost = game.unitInfo(UnitType.City).cost(game, member);
    game.performNationalImperialAdministration(leader, {
      kind: "upgrade-structure",
      empireId,
      memberId: S,
      unitId: building.id(),
    });
    expect(building.level()).toBe(level + 1);
    expect(treasury(game)).toBe(before - nextCost);
    expect([leader.gold(), member.gold()]).toEqual(personalAfterConstruction);

    const { restored } = await roundTrip(game, "plains");
    expect(restored.player(S).units(UnitType.City)[0].level()).toBe(level + 1);
    expect(
      restored.nationalImperialAdministrationFor(restored.player(N))?.treasury,
    ).toBe(treasury(game).toString());

    const beforeDemolition = treasury(game);
    game.performNationalImperialAdministration(leader, {
      kind: "demolish-structure",
      empireId,
      memberId: S,
      unitId: building.id(),
    });
    expect(building.isActive()).toBe(false);
    expect(game.unit(building.id())).toBeUndefined();
    expect(member.units(UnitType.City)).toHaveLength(0);
    expect(treasury(game)).toBe(beforeDemolition);
    expect([leader.gold(), member.gold()]).toEqual(personalAfterConstruction);
  });

  it("stamped demolition produces one accepted receipt and removes a real unit without treasury debit", async () => {
    const game = await liveGame();
    join(game);
    const unit = city(game);
    policy(game, 0);
    const before = treasury(game);
    queue(game, "c5-demolish-receipt", {
      kind: "demolish-structure",
      empireId,
      memberId: S,
      unitId: unit.id(),
    });
    const { restored } = await roundTrip(game, "plains");
    for (const g of [game, restored]) {
      g.executeNextTick();
      g.executeNextTick();
      expect(g.unit(unit.id())).toBeUndefined();
      expect(g.player(S).units(UnitType.City)).toHaveLength(0);
      expect(BigInt(g.nationalImperialAdministrationFor(g.player(N))!.treasury)).toBe(before);
      expect(political(g, "c5-demolish-receipt")).toMatchObject({
        accepted: true,
        reason: "accepted",
        recipientId: N,
      });
      queue(g, "c5-demolish-receipt", {
        kind: "demolish-structure",
        empireId,
        memberId: S,
        unitId: unit.id(),
      });
      g.executeNextTick();
      g.executeNextTick();
      expect(g.player(S).units(UnitType.City)).toHaveLength(0);
      expect(g.nationalPoliticalCommandResults(g.player(N)).filter(
        (receipt) => receipt.requestId === "c5-demolish-receipt",
      )).toHaveLength(1);
      expect(BigInt(g.nationalImperialAdministrationFor(g.player(N))!.treasury)).toBe(before);
    }
    expect(national(restored)).toEqual(national(game));
  });

  it("pending imperial upgrades reject physically destroyed structures after snapshot restoration", async () => {
    const game = await liveGame();
    join(game);
    const unit = city(game);
    policy(game, 0);
    queue(game, "c5-deleted-target", {
      kind: "upgrade-structure",
      empireId,
      memberId: S,
      unitId: unit.id(),
    });
    unit.delete(false); // actual world change occurs BEFORE the queued order runs
    expect(game.unit(unit.id())).toBeUndefined();
    const { restored } = await roundTrip(game, "plains");
    for (const g of [game, restored]) {
      g.executeNextTick();
      g.executeNextTick();
      expect(g.unit(unit.id())).toBeUndefined();
      expect(BigInt(g.nationalImperialAdministrationFor(g.player(N))!.treasury)).toBe(0n);
      expect(political(g, "c5-deleted-target")).toMatchObject({
        accepted: false,
        reason: "political-rule",
        recipientId: N,
      });
    }
    expect(national(restored)).toEqual(national(game));
  });

  it("rejects insufficient funds, outsiders, other members, inactive units and former crown without mutations", async () => {
    const game = await liveGame();
    join(game);
    const n = game.player(N),
      s = game.player(S);
    const building = city(game);
    policy(game, 0);
    const order = {
      kind: "upgrade-structure" as const,
      empireId,
      memberId: S,
      unitId: building.id(),
    };
    const level = building.level();
    const bank = [n.gold(), s.gold(), treasury(game)];
    expect(() => game.performNationalImperialAdministration(n, order)).toThrow(
      /treasury/,
    );
    expect(() => game.performNationalImperialAdministration(s, order)).toThrow(
      /emperor/,
    );
    expect(() =>
      game.performNationalImperialAdministration(n, {
        ...order,
        memberId: W,
      }),
    ).toThrow(/constituent|owned/);
    expect(() =>
      game.performNationalImperialAdministration(n, {
        ...order,
        unitId: 2147483647,
      }),
    ).toThrow(/missing/);
    expect([n.gold(), s.gold(), treasury(game)]).toEqual(bank);
    expect(building.level()).toBe(level);

    game.performNationalCommand(n, {
      kind: "transfer-crown",
      empireId,
      successorId: S,
    });
    expect(() =>
      game.performNationalImperialAdministration(n, {
        kind: "demolish-structure",
        empireId,
        memberId: S,
        unitId: building.id(),
      }),
    ).toThrow(/emperor/);
    expect(building.isActive()).toBe(true);
    expect([n.gold(), s.gold(), treasury(game)]).toEqual(bank);
  });

  it("orders issued simultaneously serialize with exactly one charge and one level effect; replay is idempotent", async () => {
    const game = await liveGame();
    join(game);
    const unit = city(game);
    policy(game, 10_000);
    const cost = game.unitInfo(UnitType.City).cost(game, game.player(S));
    workerIncome(game, cost);
    policy(game, 0); // freezes treasury during normal subsequent game ticks
    expect(treasury(game)).toBe(cost);
    const request = {
      kind: "upgrade-structure" as const,
      empireId,
      memberId: S,
      unitId: unit.id(),
    };
    queue(game, "c5-spend-one", request);
    queue(game, "c5-spend-two", request);
    const { restored } = await roundTrip(game, "plains");
    const level = unit.level();
    for (const g of [game, restored]) {
      g.executeNextTick();
      g.executeNextTick();
      expect(g.player(S).units(UnitType.City)[0].level()).toBe(level + 1);
      expect(
        BigInt(g.nationalImperialAdministrationFor(g.player(N))!.treasury),
      ).toBe(0n);
      expect(political(g, "c5-spend-one")).toMatchObject({
        accepted: true,
        recipientId: N,
      });
      expect(political(g, "c5-spend-two")).toMatchObject({
        accepted: false,
        reason: "political-rule",
      });
      queue(g, "c5-spend-one", request);
      g.executeNextTick();
      g.executeNextTick();
      expect(g.player(S).units(UnitType.City)[0].level()).toBe(level + 1);
      expect(
        BigInt(g.nationalImperialAdministrationFor(g.player(N))!.treasury),
      ).toBe(0n);
      expect(
        g
          .nationalPoliticalCommandResults(g.player(N))
          .filter((r) => r.requestId === "c5-spend-one"),
      ).toHaveLength(1);
    }
    expect(national(restored)).toEqual(national(game));
  });

  it("revalidates pending crown and dissolution before executing, with no deferred spending authority", async () => {
    for (const dissolve of [false, true]) {
      const game = await liveGame();
      join(game);
      const unit = city(game);
      policy(game, 10_000);
      const cost = game.unitInfo(UnitType.City).cost(game, game.player(S));
      workerIncome(game, cost);
      policy(game, 0);
      queue(game, dissolve ? "c5-dissolve-queued" : "c5-stale-queued", {
        kind: "demolish-structure",
        empireId,
        memberId: S,
        unitId: unit.id(),
      });
      if (dissolve) {
        game.performNationalImperialAdministration(game.player(N), {
          kind: "dissolve",
          empireId,
        });
      } else {
        game.performNationalCommand(game.player(N), {
          kind: "transfer-crown",
          empireId,
          successorId: S,
        });
      }
      const { restored } = await roundTrip(game, "plains");
      for (const g of [game, restored]) {
        g.executeNextTick();
        g.executeNextTick();
        expect(g.player(S).units(UnitType.City)).toHaveLength(1);
        expect(
          political(g, dissolve ? "c5-dissolve-queued" : "c5-stale-queued"),
        ).toMatchObject({ accepted: false, reason: "political-rule" });
      }
      expect(national(restored)).toEqual(national(game));
    }
  });

  it("allocates actual train-stop income once; commercial, worker, donations and FFA remain distinct", async () => {
    const game = await liveGame();
    join(game);
    const unit = city(game);
    const member = game.player(S),
      leader = game.player(N);
    policy(game, 0, 2500);
    const station = new TrainStation(game, unit);
    const train = new TrainExecution(
      game.railNetwork(),
      member,
      station,
      station,
      1,
    );
    const original = member.gold();
    const revenueBefore = member.trainGold();
    const treasuryBefore = treasury(game);
    station.onTrainStop(train); // Real production stop handler, actual config trainGold
    const gross = member.trainGold() - revenueBefore;
    expect(gross).toBeGreaterThan(0n);
    const imperial = (gross * 2500n) / 10_000n;
    expect(member.gold() - original).toBe(gross - imperial);
    expect(treasury(game) - treasuryBefore).toBe(imperial);
    expect(member.gold() - original + treasury(game) - treasuryBefore).toBe(
      gross,
    );
    const after = treasury(game);
    member.addGold(79n); // ordinary transfers are NOT commercial production
    expect(treasury(game)).toBe(after);
    expect(
      game.nationalImperialAdministrationFor(leader)?.nonWorkerIncomeBps,
    ).toBe(2500);
    const { restored } = await roundTrip(game, "plains");
    expect(national(restored)).toEqual(national(game));

    const ffa = await liveGame(false);
    const outsider = ffa.player(S);
    const oldGold = outsider.gold();
    ffa.creditNationalCommercialIncome(outsider, 101n);
    expect(outsider.gold()).toBe(oldGold + 101n);
    expect(ffa.nationalImperialAdministrationFor(outsider)).toBeNull();
  });
});
