import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import {
  initialNationalReconMemory,
  planNationalRecon,
  recordNationalReconAttempt,
} from "@openfront/engine/national/ai/NationalReconStrategy";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import type { NationalObservation } from "@openfront/engine/national/observation/NationalObservation";
import { REGIONAL_RECON_COST } from "@openfront/engine/national/observation/NationalReconnaissance";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const A = "C5C3_E5_SCOUT";
const B = "C5C3_E5_RIVAL";
const C = "C5C3_E5_THIRD";
const D = "C5C3_E5_FOURTH";
const ID = "c5-c3-e5-seeded";
const infos = [
  new PlayerInfo("Scout", PlayerType.Nation, null, A),
  new PlayerInfo("Rival", PlayerType.Nation, null, B),
  new PlayerInfo("Third", PlayerType.Nation, null, C),
  new PlayerInfo("Fourth", PlayerType.Nation, null, D),
];

function observedFixture(): NationalObservation {
  return {
    observerId: A,
    tick: 25,
    nations: [
      {
        id: A,
        name: "Scout",
        alive: true,
        status: "independent",
        landPercent: 3,
      },
      {
        id: B,
        name: "Rival",
        alive: true,
        status: "independent",
        landPercent: 12,
      },
      {
        id: C,
        name: "Third",
        alive: true,
        status: "independent",
        landPercent: 8,
      },
      {
        id: D,
        name: "Fourth",
        alive: true,
        status: "independent",
        landPercent: 9,
      },
    ],
    coalitions: [],
    wars: [],
    ownResources: { troops: 5_000, treasury: 3_000 },
    visibleAssets: [
      {
        id: "factory_1",
        ownerId: B,
        kind: "structure",
        x: 125,
        y: 100,
        source: "border",
      },
    ],
    frontiers: [{ targetId: B, access: "land" }],
    diplomaticEvents: [],
    unownedFrontier: false,
  };
}

function memoryOf(game: Game) {
  const exec = game
    .executions()
    .find((e) => e instanceof NationExecution && e.playerID() === A);
  expect(exec).toBeDefined();
  return (
    exec as unknown as {
      nationalReconMemory: ReturnType<typeof initialNationalReconMemory> | null;
    }
  ).nationalReconMemory;
}

async function seededFourNations(humanRival = false) {
  const rival = humanRival
    ? new PlayerInfo("Rival", PlayerType.Human, "c5e5_rival_socket", B)
    : infos[1];
  const players = [infos[0], rival, infos[2], infos[3]];
  const nations = [
    new Nation(new Cell(48, 100), players[0]),
    new Nation(new Cell(145, 100), players[1]),
    new Nation(new Cell(185, 175), players[2]),
    new Nation(new Cell(185, 25), players[3]),
  ];
  const game = await setup(
    "big_plains",
    { nationalMode: true, startingGold: 3_000 },
    humanRival ? [rival] : [],
    undefined,
    undefined,
    false,
    humanRival ? [nations[0], nations[2], nations[3]] : nations,
  );
  const bot = new NationExecution(ID, nations[0]);
  game.addExecution(
    bot,
    ...players.map(
      (info, index) =>
        new SpawnExecution(
          ID,
          info,
          game.ref(nations[index].spawnCell!.x, nations[index].spawnCell!.y),
        ),
    ),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  expect(players.every((p) => game.player(p.id).hasSpawned())).toBe(true);

  // Four genuinely live nations, one besieged inland principal. Other nations
  // are far from A, so they cannot be selected through a hidden world scan.
  for (let y = 0; y < game.height(); y++) {
    for (let x = 0; x < game.width(); x++) {
      const tile = game.ref(x, y);
      if (!game.isLand(tile) || game.isImpassable(tile)) continue;
      const owner =
        x >= 45 && x <= 60 && y >= 70 && y <= 130
          ? A
          : x >= 180 && y >= 160
            ? C
            : x >= 180 && y <= 40
              ? D
              : B;
      game.player(owner).conquer(tile);
    }
  }
  const scout = game.player(A);
  scout.setTroops(250_000);
  const currentGold = scout.gold();
  scout.removeGold(currentGold);
  scout.addGold(3_500n);
  const anchor = game
    .player(B)
    .buildUnit(UnitType.Factory, game.ref(137, 100), {});
  const hidden = game
    .player(B)
    .buildUnit(UnitType.TransportShip, game.ref(190, 100), { troops: 900_000 });
  const initial = collectLiveNationalObservation(game, A).observation;
  expect(initial.nations).toHaveLength(4);
  expect(
    initial.frontiers.some((f) => f.targetId === B && f.access === "land"),
  ).toBe(true);
  expect(initial.visibleAssets.some((a) => a.id === String(anchor.id()))).toBe(
    true,
  );
  expect(initial.visibleAssets.some((a) => a.id === String(hidden.id()))).toBe(
    false,
  );

  const war = game.performNationalWarCommandWithOutcome(scout, {
    kind: "declare-national",
    warId: "c5c3_e5_initial_war",
    aggressorId: A,
    targetId: B,
  });
  expect(war.accepted).toBe(true);
  return { game, bot, anchor, hidden };
}

function runnerFor(game: Game): GameRunner {
  return new GameRunner(
    game,
    new Executor(game, ID, undefined),
    () => {},
    undefined,
  );
}

function next(game: Game, runner: GameRunner) {
  runner.addTurn({ turnNumber: game.ticks(), intents: [] });
  expect(runner.executeNextTick()).toBe(true);
}

describe("C5 Class Three E5 autonomous funded recon", () => {
  it("keeps spending, target choice and military consequences observation-only, bounded and human-neutral", () => {
    const view = observedFixture();
    const fresh = initialNationalReconMemory(A);
    const plan = planNationalRecon(view, fresh);
    expect(plan.purchase).toMatchObject({
      targetId: B,
      anchorAssetId: "factory_1",
      centerX: 125,
      centerY: 100,
    });
    const harmlessNeighbor = {
      ...view,
      nations: view.nations.map((nation) =>
        nation.id === B ? { ...nation, landPercent: 3 } : nation,
      ),
    };
    expect(planNationalRecon(harmlessNeighbor, fresh).purchase).toBeNull();
    // A real public WAR makes the same weaker rival worth investigating;
    // the subsequent public peace ends that rationale, without private data.
    const threatened: NationalObservation = {
      ...harmlessNeighbor,
      wars: [
        {
          id: "observed_b_war",
          scope: "national",
          first: {
            kind: "nation",
            stableId: A,
            activeMemberIds: [A],
          },
          second: {
            kind: "nation",
            stableId: B,
            activeMemberIds: [B],
          },
          startedTick: 20,
        },
      ],
    };
    expect(planNationalRecon(threatened, fresh).purchase?.targetId).toBe(B);
    expect(planNationalRecon({ ...threatened, wars: [] }, fresh).purchase).toBeNull();
    expect(plan.holdOffenseAgainst).toBeNull();
    expect(
      planNationalRecon(
        { ...view, ownResources: { troops: 5_000, treasury: 2_499 } },
        fresh,
      ).purchase,
    ).toBeNull();
    expect(
      planNationalRecon({ ...view, unownedFrontier: true }, fresh).purchase,
    ).toBeNull();
    expect(
      planNationalRecon({ ...view, frontiers: [] }, fresh).purchase,
    ).toBeNull();
    expect(
      planNationalRecon({ ...view, visibleAssets: [] }, fresh).purchase,
    ).toBeNull();
    expect(
      planNationalRecon(
        {
          ...view,
          nations: view.nations.map((n) =>
            n.id === A ? { ...n, status: "member" as const } : n,
          ),
        },
        fresh,
      ).purchase,
    ).toBeNull();
    const allied: NationalObservation = {
      ...view,
      coalitions: [
        { id: "shared-mda", kind: "mda", leaderId: A, members: [A, B] },
      ],
    };
    expect(planNationalRecon(allied, fresh).purchase).toBeNull();
    // Controller type is intentionally not represented in the public nation
    // DTO. Even adversarial extra fields cannot affect a lawful decision.
    const human = {
      ...view,
      nations: view.nations.map((n) =>
        n.id === B ? { ...n, controllerKind: "human" } : n,
      ),
    } as NationalObservation;
    const ai = {
      ...view,
      nations: view.nations.map((n) =>
        n.id === B ? { ...n, controllerKind: "ai" } : n,
      ),
    } as NationalObservation;
    expect(planNationalRecon(human, fresh).purchase).toEqual(
      planNationalRecon(ai, fresh).purchase,
    );
    expect(() => planNationalRecon({ ...view, observerId: D }, fresh)).toThrow(
      /principal mismatch/,
    );

    const funded = recordNationalReconAttempt(
      view,
      fresh,
      plan.purchase!,
      "ai_recon_seed",
      view.tick + 600,
    );
    expect(funded.attempts).toHaveLength(1);
    expect(
      planNationalRecon({ ...view, tick: 26 }, funded).purchase,
    ).toBeNull();
    const revealed: NationalObservation = {
      ...view,
      tick: 26,
      visibleAssets: [
        ...view.visibleAssets,
        {
          id: "hidden_enemy_transport",
          ownerId: B,
          kind: "transport",
          x: 186,
          y: 100,
          source: "recon",
          reconExpiresAtTick: 625,
        },
      ],
    };
    const after = planNationalRecon(revealed, funded);
    expect(after.holdOffenseAgainst).toBe(B);
    expect(after.memory.lastDiscovery?.assetId).toBe("hidden_enemy_transport");
    expect(after.memory.lastDiscovery?.expiresAtTick).toBe(625);
    expect(
      planNationalRecon(
        { ...revealed, tick: 625, visibleAssets: view.visibleAssets },
        after.memory,
      ).holdOffenseAgainst,
    ).toBeNull();
    const rejected = recordNationalReconAttempt(
      view,
      fresh,
      plan.purchase!,
      "ai_recon_denied",
      null,
    );
    expect(rejected.attempts[0].outcome).toBe("rejected");
    expect(rejected.nextDecisionTick).toBe(view.tick + 180);
    expect(
      planNationalRecon({ ...view, tick: view.tick + 181 }, rejected).purchase,
    ).toBeNull();
    const exhausted = {
      ...fresh,
      attempts: Array.from({ length: 4 }, (_, i) => ({
        targetId: "exhausted_" + i,
        anchorAssetId: "known_" + i,
        requestId: "spent_" + i,
        purchasedTick: i,
        expiresAtTick: i,
        outcome: "rejected" as const,
      })),
    };
    expect(planNationalRecon(view, exhausted).purchase).toBeNull();
  });

  it("buys via real Game-owned actor, deducts exactly 500 gold and changes an executed war decision against denied-purchase control", async () => {
    const { game: active, hidden } = await seededFourNations();
    const { game: control } = await seededFourNations();
    const activeRunner = runnerFor(active);
    const controlRunner = runnerFor(control);
    const denied = vi
      .spyOn(control, "performNationalReconnaissance")
      .mockImplementation(() => {
        throw new Error("control experiment: no intelligence sale");
      });
    const paid = vi.spyOn(active, "performNationalReconnaissance");
    const debits = vi.spyOn(active.player(A), "removeGold");
    const activeAdd = vi.spyOn(active, "addExecution");
    const controlAdd = vi.spyOn(control, "addExecution");
    const activeBefore = active.player(A).gold();
    const controlBefore = control.player(A).gold();
    expect(activeBefore).toBe(controlBefore);
    expect(active.nationalReconnaissanceFor(A)).toHaveLength(0);
    expect(
      collectLiveNationalObservation(active, A).observation.visibleAssets.some(
        (a) => a.id === String(hidden.id()),
      ),
    ).toBe(false);

    for (let i = 0; i < 14; i++) {
      next(active, activeRunner);
      next(control, controlRunner);
    }
    const accepted = active.nationalReconnaissanceFor(A);
    expect(paid).toHaveBeenCalledTimes(1);
    expect(paid.mock.calls[0][0]).toBe(active.player(A));
    expect(paid.mock.calls[0].slice(1, 4)).toEqual([B, 137, 100]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ payerId: A, targetId: B, cost: "500" });
    expect(
      debits.mock.calls.filter(([amount]) => amount === REGIONAL_RECON_COST),
    ).toHaveLength(1);
    expect(control.nationalReconnaissanceFor(A)).toHaveLength(0);
    expect(denied).toHaveBeenCalledTimes(1);
    expect(
      collectLiveNationalObservation(active, A).observation.visibleAssets.find(
        (a) => a.id === String(hidden.id()),
      )?.source,
    ).toBe("recon");
    expect(
      collectLiveNationalObservation(control, A).observation.visibleAssets.some(
        (a) => a.id === String(hidden.id()),
      ),
    ).toBe(false);
    const history = memoryOf(active);
    expect(history?.attempts).toHaveLength(1);
    expect(history?.attempts[0].outcome).toBe("accepted");
    expect(history?.lastDiscovery?.assetId).toBe(String(hidden.id()));

    // Not a planner-only score: the control makes an actual Game attack order,
    // while newly seen military intelligence prevents the active bot's order.
    const attacks = (spy: typeof activeAdd) =>
      spy.mock.calls
        .flat()
        .filter((e): e is AttackExecution => e instanceof AttackExecution);
    expect(attacks(controlAdd).length).toBeGreaterThan(0);
    expect(attacks(activeAdd)).toHaveLength(0);
    expect(active.player(A).gold() - control.player(A).gold()).toBe(
      -REGIONAL_RECON_COST,
    );
    const { restored, bytes, again } = await roundTrip(active, "big_plains");
    expect(again).toEqual(bytes);
    expect(restored.nationalReconnaissanceFor(A)).toEqual(accepted);
    expect(memoryOf(restored)).toEqual(history);
    expect(
      collectLiveNationalObservation(
        restored,
        A,
      ).observation.visibleAssets.find((a) => a.id === String(hidden.id()))
        ?.source,
    ).toBe("recon");
    const duplicate = accepted[0];
    expect(() =>
      restored.performNationalReconnaissance(
        restored.player(A),
        B,
        duplicate.centerX,
        duplicate.centerY,
        duplicate.requestId,
      ),
    ).toThrow(/duplicate/);
    paid.mockRestore();
    denied.mockRestore();
    activeAdd.mockRestore();
    controlAdd.mockRestore();
    debits.mockRestore();
  }, 120_000);

  it("does not attempt to purchase against an actual unfunded nation", async () => {
    const { game } = await seededFourNations();
    const scout = game.player(A);
    scout.removeGold(scout.gold());
    scout.addGold(499n);
    const debits = vi.spyOn(scout, "removeGold");
    const purchases = vi.spyOn(game, "performNationalReconnaissance");
    const runner = runnerFor(game);
    next(game, runner);
    expect(purchases).not.toHaveBeenCalled();
    expect(debits.mock.calls.some(([amount]) => amount === 500n)).toBe(false);
    expect(game.nationalReconnaissanceFor(A)).toHaveLength(0);
    expect(memoryOf(game)?.attempts ?? []).toHaveLength(0);
    debits.mockRestore();
    purchases.mockRestore();
  });

  it("buys exactly the same lawful intelligence from a human or an AI rival", async () => {
    const ai = await seededFourNations();
    const human = await seededFourNations(true);
    const botSight = collectLiveNationalObservation(ai.game, A).observation;
    const humanSight = collectLiveNationalObservation(
      human.game,
      A,
    ).observation;
    expect(botSight.nations).toEqual(humanSight.nations);
    expect(botSight.nations.find((n) => n.id === B)).not.toHaveProperty(
      "controllerKind",
    );
    expect(humanSight.nations.find((n) => n.id === B)).not.toHaveProperty(
      "controllerKind",
    );
    const aiProposal = planNationalRecon(
      botSight,
      initialNationalReconMemory(A),
    ).purchase;
    const humanProposal = planNationalRecon(
      humanSight,
      initialNationalReconMemory(A),
    ).purchase;
    expect(aiProposal).toEqual(humanProposal);
    const aiDebits = vi.spyOn(ai.game.player(A), "removeGold");
    const humanDebits = vi.spyOn(human.game.player(A), "removeGold");
    next(ai.game, runnerFor(ai.game));
    next(human.game, runnerFor(human.game));
    const aiGrant = ai.game.nationalReconnaissanceFor(A);
    const humanGrant = human.game.nationalReconnaissanceFor(A);
    expect(aiGrant).toHaveLength(1);
    expect(humanGrant).toHaveLength(1);
    for (const lease of [...aiGrant, ...humanGrant]) {
      expect(lease).toMatchObject({ payerId: A, targetId: B, cost: "500" });
    }
    expect(
      aiDebits.mock.calls.filter(([gold]) => gold === REGIONAL_RECON_COST),
    ).toHaveLength(1);
    expect(
      humanDebits.mock.calls.filter(([gold]) => gold === REGIONAL_RECON_COST),
    ).toHaveLength(1);
    expect(memoryOf(ai.game)?.attempts[0].outcome).toBe("accepted");
    expect(memoryOf(human.game)?.attempts[0].outcome).toBe("accepted");
    expect(
      collectLiveNationalObservation(ai.game, A).observation.visibleAssets.find(
        (a) => a.id === String(ai.hidden.id()),
      )?.source,
    ).toBe("recon");
    expect(
      collectLiveNationalObservation(
        human.game,
        A,
      ).observation.visibleAssets.find(
        (a) => a.id === String(human.hidden.id()),
      )?.source,
    ).toBe("recon");
    aiDebits.mockRestore();
    humanDebits.mockRestore();
  }, 120_000);

  it("expires paid sight at tick 600 with bounded attempts and byte-identical saved memory", async () => {
    const { game, hidden } = await seededFourNations();
    const runner = runnerFor(game);
    next(game, runner);
    const lease = game.nationalReconnaissanceFor(A)[0];
    expect(lease).toBeDefined();
    expect(memoryOf(game)?.attempts).toHaveLength(1);
    while (game.ticks() < lease.expiresAtTick - 1) game.executeNextTick();
    expect(
      collectLiveNationalObservation(game, A).observation.visibleAssets.find(
        (a) => a.id === String(hidden.id()),
      )?.source,
    ).toBe("recon");
    game.executeNextTick();
    expect(game.ticks()).toBe(lease.expiresAtTick);
    expect(
      collectLiveNationalObservation(game, A).observation.visibleAssets.find(
        (a) => a.id === String(hidden.id()),
      ),
    ).toBeUndefined();
    expect(game.nationalReconnaissanceFor(A)).toHaveLength(0);
    const history = memoryOf(game);
    expect(history?.attempts).toHaveLength(1);
    const { restored, bytes, again } = await roundTrip(game, "big_plains");
    expect(again).toEqual(bytes);
    expect(memoryOf(restored)).toEqual(history);
    for (let i = 0; i < 800; i++) game.executeNextTick();
    const attempts = memoryOf(game)?.attempts ?? [];
    const purchases = attempts.filter((a) => a.outcome === "accepted").length;
    const memoryBytes = JSON.stringify(memoryOf(game)).length;
    const ratePer1000Ticks = (purchases * 1000) / game.ticks();
    console.info(
      `E5 deterministic match: ticks=${game.ticks()} purchases=${purchases} attempts=${attempts.length} purchasesPer1000Ticks=${ratePer1000Ticks.toFixed(3)} reconMemoryBytes=${memoryBytes}`,
    );
    expect(attempts.length).toBeLessThanOrEqual(4);
    expect(memoryBytes).toBeLessThan(2_048);
    expect(attempts.map((a) => a.requestId)).toEqual([
      ...new Set(attempts.map((a) => a.requestId)),
    ]);
  }, 120_000);
});
