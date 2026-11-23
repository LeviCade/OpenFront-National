/** Fifth Conductor / Class Three / E2: paid, classified imperial gold. */
import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { EmbargoExecution } from "@openfront/engine/execution/EmbargoExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { TradeShipExecution } from "@openfront/engine/execution/TradeShipExecution";
import { TrainExecution } from "@openfront/engine/execution/TrainExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import type { Game, Player, Unit } from "@openfront/engine/game/Game";
import { GameSnapshot } from "@openfront/engine/game/GameImpl";
import { Railroad } from "@openfront/engine/game/Railroad";
import { TrainStation } from "@openfront/engine/game/TrainStation";
import { GameRunner } from "@openfront/engine/GameRunner";
import { NationalRuntime } from "@openfront/engine/national/NationalRuntime";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const [A, B, C, D, E] = ["C5E2A", "C5E2B", "C5E2C", "C5E2D", "C5E2E"];
const empireId = "c5c3-revenue";
const roster = [A, B, C, D, E].map(
  (id, i) => new PlayerInfo(id, PlayerType.Human, "E2CLIENT" + i, id),
);
const all = { workers: true, maritime: true, rail: true, piracy: true };
const map = "half_land_half_ocean";

class RevenueConfig extends TestConfig {
  warshipPatrolRange(): number {
    return 16;
  }
  safeFromPiratesCooldownMax(): number {
    return 0;
  }
}

async function fixture(nationalMode = true) {
  const game = await setup(
    map,
    { nationalMode, instantBuild: true },
    roster,
    undefined,
    RevenueConfig,
  );
  roster.forEach((p, i) => {
    const player = game.player(p.id);
    const tile = game.ref(1, 1 + i * 3);
    player.conquer(tile);
    player.setSpawnTile(tile);
    player.addGold(1_000_000_000n);
  });
  game.executeNextTick();
  // Only the legitimate event being tested may produce new gold.
  const zeroWorkers = vi
    .spyOn(game.config(), "goldAdditionRate")
    .mockReturnValue(0n);
  const port = (owner: Player, y: number): Unit => {
    const tile = game.ref(7, y);
    owner.conquer(tile);
    return owner.buildUnit(UnitType.Port, tile, {});
  };
  const ports = {
    leader: port(game.player(A), 10),
    member: port(game.player(B), 8),
    outsider1: port(game.player(C), 14),
    outsider2: port(game.player(D), 5),
    outsider3: port(game.player(E), 1),
  };
  game.executeNextTick();
  return { game, ports, zeroWorkers };
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

function decree(
  game: Game,
  opts: {
    workerIncomeBps?: number;
    nonWorkerIncomeBps?: number;
    fixedGoldPerPayout?: string;
    revenueClasses?: typeof all;
  } = {},
  emperor = A,
) {
  game.performNationalImperialAdministration(game.player(emperor), {
    kind: "set-policy",
    empireId,
    policy: {
      workerIncomeBps: opts.workerIncomeBps ?? 0,
      nonWorkerIncomeBps: opts.nonWorkerIncomeBps ?? 0,
      fixedGoldPerPayout: opts.fixedGoldPerPayout ?? "0",
      revenueClasses: opts.revenueClasses ?? all,
      allowedConstruction: null,
    },
  });
}

function treasury(game: Game, observer = A): bigint {
  return BigInt(
    game.nationalImperialAdministrationFor(game.player(observer))!.treasury,
  );
}

function balances(game: Game) {
  return {
    personal: [A, B, C, D, E].map((id) => ({
      id,
      gold: game.player(id).gold(),
      workers: game.player(id).goldEarned(),
      maritime: game.player(id).tradeGold(),
      rail: game.player(id).trainGold(),
      piracy: game.player(id).piracyGold(),
    })),
    treasury: treasury(game),
  };
}

function witness(
  label: string,
  game: Game,
  before: ReturnType<typeof balances>,
) {
  const after = balances(game);
  console.info(
    "C5_C3_E2_GOLD_WITNESS=" +
      JSON.stringify(
        { label, tick: game.ticks(), before, after },
        (_, value) => (typeof value === "bigint" ? value.toString() : value),
      ),
  );
  return after;
}

function ticks(game: Game, count: number) {
  for (let i = 0; i < count; i++) game.executeNextTick();
}

function until(game: Game, done: () => boolean, limit = 200) {
  for (let i = 0; i < limit && !done(); i++) game.executeNextTick();
  expect(done()).toBe(true);
}

function share(gross: bigint, bps: bigint, fixed: bigint) {
  const percent = (gross * bps) / 10_000n;
  return percent + (fixed < gross - percent ? fixed : gross - percent);
}

function queuePolicy(
  game: Game,
  actor: string,
  requestId: string,
  fixedGoldPerPayout: string,
) {
  const executor = new Executor(game, "c5c3e2", undefined);
  game.addExecution(
    executor.createExec(
      StampedIntentSchema.parse({
        type: "national_imperial_administration",
        clientID: game.player(actor).clientID(),
        requestId,
        command: {
          kind: "set-policy",
          empireId,
          policy: {
            workerIncomeBps: 3000,
            nonWorkerIncomeBps: 4000,
            fixedGoldPerPayout,
            revenueClasses: all,
            allowedConstruction: null,
          },
        },
      }),
    ),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("C5 Third Class E2 — original imperial revenue powers", () => {
  it("conserves real PlayerExecution worker gold for two payout sizes, including fixed cap and 100%", async () => {
    const { game, zeroWorkers } = await fixture();
    join(game);
    decree(game, {
      workerIncomeBps: 2500,
      fixedGoldPerPayout: "19",
    });
    const before = balances(game);
    const member = game.player(B);
    const runWorkers = (gross: bigint) => {
      zeroWorkers.mockReturnValue(gross);
      const exec = new PlayerExecution(member);
      exec.init(game, game.ticks());
      exec.tick(game.ticks());
      zeroWorkers.mockReturnValue(0n);
    };
    runWorkers(101n);
    expect(member.gold() - before.personal[1].gold).toBe(57n);
    expect(treasury(game) - before.treasury).toBe(44n);
    const midway = balances(game);
    runWorkers(3n);
    expect(member.gold() - midway.personal[1].gold).toBe(0n);
    expect(treasury(game) - midway.treasury).toBe(3n);
    witness("workers-fixed-and-capped", game, before);
    decree(game, { workerIncomeBps: 10000, fixedGoldPerPayout: "999" });
    const full = balances(game);
    runWorkers(87n);
    expect(member.gold()).toBe(full.personal[1].gold);
    expect(treasury(game) - full.treasury).toBe(87n);
    const disabled = { ...all, workers: false };
    decree(game, {
      workerIncomeBps: 10000,
      fixedGoldPerPayout: "999",
      revenueClasses: disabled,
    });
    const exempt = balances(game);
    runWorkers(43n);
    expect(member.gold() - exempt.personal[1].gold).toBe(43n);
    expect(treasury(game)).toBe(exempt.treasury);
    witness("workers-disabled", game, exempt);
  });

  it("pays physical maritime voyages to two economies, only taxing the imperial recipient", async () => {
    const { game, ports } = await fixture();
    join(game);
    decree(game, {
      nonWorkerIncomeBps: 2500,
      fixedGoldPerPayout: "19",
    });
    const before = balances(game);
    const voyage = new TradeShipExecution(
      game.player(B),
      ports.member,
      ports.outsider1,
    );
    game.addExecution(voyage);
    until(game, () => !voyage.isActive());
    const after = witness("maritime-physical-arrival", game, before);
    const gross = after.personal[1].maritime - before.personal[1].maritime;
    const external = after.personal[2].maritime - before.personal[2].maritime;
    const contribution = share(gross, 2500n, 19n);
    expect(gross).toBeGreaterThan(0n);
    expect(external).toBe(gross);
    expect(after.personal[1].gold - before.personal[1].gold).toBe(
      gross - contribution,
    );
    expect(after.personal[2].gold - before.personal[2].gold).toBe(gross);
    expect(after.treasury - before.treasury).toBe(contribution);
    expect(
      after.personal[1].gold +
        after.personal[2].gold +
        after.treasury -
        before.personal[1].gold -
        before.personal[2].gold -
        before.treasury,
    ).toBe(2n * gross);
    const { restored, bytes, again } = await roundTrip(game, map);
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    expect(
      restored.nationalImperialAdministrationFor(restored.player(B))
        ?.fixedGoldPerPayout,
    ).toBe("19");
    expect(
      restored.nationalImperialAdministrationFor(restored.player(B))
        ?.revenueClasses,
    ).toEqual(all);
  });

  it("real rail stops respect disabled class and charge each enabled stop exactly once", async () => {
    const { game } = await fixture();
    join(game);
    decree(game, {
      nonWorkerIncomeBps: 5000,
      fixedGoldPerPayout: "19",
      revenueClasses: { ...all, rail: false },
    });
    const railTiles = Array.from({ length: 12 }, (_, y) => game.ref(3, y + 1));
    game.player(B).conquer(railTiles[0]);
    game.player(C).conquer(railTiles[railTiles.length - 1]);
    const source = new TrainStation(
      game,
      game.player(B).buildUnit(UnitType.City, railTiles[0], {}),
    );
    const destination = new TrainStation(
      game,
      game
        .player(C)
        .buildUnit(UnitType.City, railTiles[railTiles.length - 1], {}),
    );
    const network = game.railNetwork();
    network.stationManager().addStation(source);
    network.stationManager().addStation(destination);
    const rail = new Railroad(source, destination, railTiles, 1);
    source.addRailroad(rail);
    destination.addRailroad(rail);
    const runTrain = () => {
      const train = new TrainExecution(
        network,
        game.player(B),
        source,
        destination,
        1,
      );
      game.addExecution(train);
      until(game, () => !train.isActive());
    };
    const exempt = balances(game);
    runTrain();
    const noTax = witness("rail-disabled", game, exempt);
    const gross = noTax.personal[1].rail - exempt.personal[1].rail;
    expect(gross).toBeGreaterThan(0n);
    expect(noTax.personal[1].gold - exempt.personal[1].gold).toBe(gross);
    expect(noTax.treasury).toBe(exempt.treasury);
    decree(game, { nonWorkerIncomeBps: 5000, fixedGoldPerPayout: "19" });
    const charged = balances(game);
    runTrain();
    const after = witness("rail-enabled", game, charged);
    const nextGross = after.personal[1].rail - charged.personal[1].rail;
    const credit = share(nextGross, 5000n, 19n);
    expect(nextGross).toBeGreaterThan(0n);
    expect(after.personal[1].gold - charged.personal[1].gold).toBe(
      nextGross - credit,
    );
    expect(after.treasury - charged.treasury).toBe(credit);
    // The external station still receives its own full, untaxed income.
    expect(after.personal[2].gold - charged.personal[2].gold).toBe(nextGross);
  });

  it("preserves current office, invalidates queued stale decrees and deduplicates request IDs", async () => {
    const { game } = await fixture();
    join(game);
    decree(game, { workerIncomeBps: 0, fixedGoldPerPayout: "11" });
    const before = balances(game);
    expect(() => decree(game, { fixedGoldPerPayout: "99" }, B)).toThrow();
    expect(game.nationalImperialAdministrationFor(game.player(C))).toBeNull();
    expect(() =>
      game.creditNationalCommercialIncome(game.player(B), 10n),
    ).toThrow("requires a named payout source");
    expect(balances(game)).toEqual(before);
    queuePolicy(game, A, "c5c3e2-accepted", "21");
    ticks(game, 2);
    expect(
      game.nationalImperialAdministrationFor(game.player(A))
        ?.fixedGoldPerPayout,
    ).toBe("21");
    queuePolicy(game, A, "c5c3e2-accepted", "77");
    ticks(game, 2);
    expect(
      game.nationalImperialAdministrationFor(game.player(A))
        ?.fixedGoldPerPayout,
    ).toBe("21");
    queuePolicy(game, A, "c5c3e2-stale", "85");
    game.performNationalCommand(game.player(A), {
      kind: "transfer-crown",
      empireId,
      successorId: B,
    });
    ticks(game, 2);
    expect(
      game.nationalImperialAdministrationFor(game.player(B))
        ?.fixedGoldPerPayout,
    ).toBe("21");
    expect(
      game
        .nationalPoliticalCommandResults(game.player(A))
        .find((x) => x.requestId === "c5c3e2-stale"),
    ).toMatchObject({ accepted: false });
    expect(() => decree(game, { fixedGoldPerPayout: "80" }, A)).toThrow();
    decree(game, { workerIncomeBps: 1500, fixedGoldPerPayout: "5" }, B);
    expect(
      game.nationalImperialAdministrationFor(game.player(A))
        ?.fixedGoldPerPayout,
    ).toBe("5");
    const beforeDissolve = treasury(game, B);
    const emperorBefore = game.player(B).gold();
    game.performNationalImperialAdministration(game.player(B), {
      kind: "dissolve",
      empireId,
    });
    expect(game.nationalImperialAdministrationFor(game.player(A))).toBeNull();
    expect(game.player(B).gold() - emperorBefore).toBe(beforeDissolve);
  });

  it("executes a stamped decree through GameRunner and retains FFA without classification", async () => {
    const { game } = await fixture();
    join(game);
    const runner = new GameRunner(
      game,
      new Executor(game, "c5c3e2", undefined),
      () => {},
    );
    runner.addTurn({
      turnNumber: 0,
      intents: [
        StampedIntentSchema.parse({
          type: "national_imperial_administration",
          clientID: game.player(A).clientID(),
          requestId: "c5c3e2-runner",
          command: {
            kind: "set-policy",
            empireId,
            policy: {
              workerIncomeBps: 1000,
              nonWorkerIncomeBps: 0,
              fixedGoldPerPayout: "8",
              revenueClasses: all,
              allowedConstruction: null,
            },
          },
        }),
      ],
    });
    expect(runner.executeNextTick()).toBe(true);
    game.executeNextTick();
    expect(
      game.nationalImperialAdministrationFor(game.player(A))
        ?.fixedGoldPerPayout,
    ).toBe("8");
    const { game: ffa } = await fixture(false);
    const ffaBefore = ffa.player(B).gold();
    ffa.creditNationalCommercialIncome(ffa.player(B), 101n);
    expect(ffa.player(B).gold() - ffaBefore).toBe(101n);
    expect(ffa.nationalImperialAdministrationFor(ffa.player(B))).toBeNull();
  });

  it("two imperial members get two independent credits from one real merchant arrival", async () => {
    const { game, ports } = await fixture();
    join(game);
    decree(game, {
      nonWorkerIncomeBps: 1250,
      fixedGoldPerPayout: "27",
    });
    const before = balances(game);
    const voyage = new TradeShipExecution(
      game.player(A),
      ports.leader,
      ports.member,
    );
    game.addExecution(voyage);
    until(game, () => !voyage.isActive());
    const after = witness("maritime-two-member-one-tick", game, before);
    const grossA = after.personal[0].maritime - before.personal[0].maritime;
    const grossB = after.personal[1].maritime - before.personal[1].maritime;
    expect(grossA).toBeGreaterThan(0n);
    expect(grossB).toBe(grossA);
    const each = share(grossA, 1250n, 27n);
    expect(after.personal[0].gold - before.personal[0].gold).toBe(
      grossA - each,
    );
    expect(after.personal[1].gold - before.personal[1].gold).toBe(
      grossA - each,
    );
    expect(after.treasury - before.treasury).toBe(2n * each);
    expect(
      after.personal[0].gold +
        after.personal[1].gold +
        after.treasury -
        before.personal[0].gold -
        before.personal[1].gold -
        before.treasury,
    ).toBe(2n * grossA);
  });

  it("pays physically captured-ship piracy as piracy, not exempt maritime", async () => {
    const { game, ports } = await fixture();
    join(game);
    decree(game, {
      nonWorkerIncomeBps: 2500,
      fixedGoldPerPayout: "19",
      revenueClasses: { ...all, maritime: false },
    });
    expect(
      game.performNationalWarCommandWithOutcome(game.player(A), {
        kind: "declare-national",
        warId: "c5c3e2-piracy-war",
        aggressorId: A,
        targetId: C,
      }).accepted,
    ).toBe(true);
    const tile = game.ref(8, 13);
    const patrol = game.player(A).buildUnit(UnitType.Warship, tile, {
      patrolTile: tile,
    });
    game.addExecution(new WarshipExecution(patrol));
    const before = balances(game);
    const voyage = new TradeShipExecution(
      game.player(C),
      ports.outsider1,
      ports.outsider3,
    );
    game.addExecution(voyage);
    ticks(game, 2);
    const ship = game.player(C).units(UnitType.TradeShip)[0];
    expect(ship).toBeDefined();
    until(game, () => ship.owner() === game.player(A));
    until(game, () => !voyage.isActive());
    const after = witness("piracy-physical-capture", game, before);
    const gross = after.personal[0].piracy - before.personal[0].piracy;
    const contribution = share(gross, 2500n, 19n);
    expect(gross).toBeGreaterThan(0n);
    expect(after.personal[0].gold - before.personal[0].gold).toBe(
      gross - contribution,
    );
    expect(after.treasury - before.treasury).toBe(contribution);
    expect(after.personal[2].maritime).toBe(before.personal[2].maritime);
    expect(after.personal[4].maritime).toBe(before.personal[4].maritime);
    expect(after.personal[2].gold).toBe(before.personal[2].gold);
    expect(after.personal[4].gold).toBe(before.personal[4].gold);
  });

  it("old V1 snapshots preserve historical percentage rates and default new fields to zero/all", async () => {
    const { game } = await fixture();
    join(game);
    decree(game, {
      workerIncomeBps: 1200,
      nonWorkerIncomeBps: 3300,
      fixedGoldPerPayout: "99",
      revenueClasses: { ...all, rail: false },
    });
    const original = readVersioned(
      GameSnapshot,
      snapshotGameData(game).game,
    ).national!;
    const legacy = {
      ...original,
      administration: (original.administration ?? []).map((row) => ({
        empireId: row.empireId,
        workerIncomeBps: row.workerIncomeBps,
        nonWorkerIncomeBps: row.nonWorkerIncomeBps,
        allowedConstruction: row.allowedConstruction,
        treasury: row.treasury,
        military: row.military,
      })),
    };
    const restored = NationalRuntime.restore(
      legacy,
      roster.map((p) => p.id),
      game.ticks(),
    );
    expect(restored.imperialAdministrationFor(A)).toMatchObject({
      workerIncomeBps: 1200,
      nonWorkerIncomeBps: 3300,
      fixedGoldPerPayout: "0",
      revenueClasses: all,
    });
    const initial = BigInt(restored.imperialAdministrationFor(A)!.treasury);
    const retained = restored.routeNonWorkerIncome(B, 111n, "maritime");
    expect(retained).toBe(75n);
    expect(
      BigInt(restored.imperialAdministrationFor(A)!.treasury) - initial,
    ).toBe(36n);
    // An old client's percentage-only decree cannot silently reset an established new quota.
    game.performNationalImperialAdministration(game.player(A), {
      kind: "set-policy",
      empireId,
      policy: { workerIncomeBps: 4400, allowedConstruction: null },
    });
    expect(
      game.nationalImperialAdministrationFor(game.player(A)),
    ).toMatchObject({
      workerIncomeBps: 4400,
      nonWorkerIncomeBps: 3300,
      fixedGoldPerPayout: "99",
      revenueClasses: { ...all, rail: false },
    });
  });

  it("malformed fixed amounts and malformed category selections reject atomically", async () => {
    const { game } = await fixture();
    join(game);
    decree(game, { fixedGoldPerPayout: "10" });
    const before = balances(game);
    const view = game.nationalImperialAdministrationFor(game.player(A));
    const invalid = ["-1", "1.5", "01", "NaN", "9".repeat(129)];
    for (const fixed of invalid) {
      expect(() => decree(game, { fixedGoldPerPayout: fixed })).toThrow();
      expect(balances(game)).toEqual(before);
    }
    expect(() =>
      game.performNationalImperialAdministration(game.player(A), {
        kind: "set-policy",
        empireId,
        policy: {
          workerIncomeBps: 0,
          allowedConstruction: null,
          revenueClasses: { ...all, rail: "false" } as never,
        },
      }),
    ).toThrow();
    expect(game.nationalImperialAdministrationFor(game.player(A))).toEqual(
      view,
    );
    expect(balances(game)).toEqual(before);
  });

  it("three external economies receive real trades while a blocked imperial voyage mints no treasury gold", async () => {
    const { game, ports } = await fixture();
    join(game);
    decree(game, {
      workerIncomeBps: 10_000,
      nonWorkerIncomeBps: 10_000,
      fixedGoldPerPayout: "999999999",
    });
    const before = balances(game);
    const tradeCD = new TradeShipExecution(
      game.player(C),
      ports.outsider1,
      ports.outsider2,
    );
    game.addExecution(tradeCD);
    until(game, () => !tradeCD.isActive());
    const tradeDE = new TradeShipExecution(
      game.player(D),
      ports.outsider2,
      ports.outsider3,
    );
    game.addExecution(tradeDE);
    until(game, () => !tradeDE.isActive());
    const externallyPaid = witness("three-external-economies", game, before);
    for (const index of [2, 3, 4]) {
      expect(
        externallyPaid.personal[index].maritime -
          before.personal[index].maritime,
      ).toBeGreaterThan(0n);
      expect(
        externallyPaid.personal[index].gold - before.personal[index].gold,
      ).toBeGreaterThan(0n);
    }
    expect(externallyPaid.treasury).toBe(before.treasury);

    // A failed admission does not become an income event or a new tax.
    game.addExecution(new EmbargoExecution(game.player(B), C, "start"));
    ticks(game, 2);
    expect(game.player(B).canTrade(game.player(C))).toBe(false);
    const deniedBefore = balances(game);
    const denied = new TradeShipExecution(
      game.player(B),
      ports.member,
      ports.outsider1,
    );
    game.addExecution(denied);
    ticks(game, 2);
    expect(denied.isActive()).toBe(false);
    expect(balances(game)).toEqual(deniedBefore);
    witness("embargo-no-income-no-imperial-credit", game, deniedBefore);
  });
});
