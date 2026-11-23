import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationWarshipBehavior } from "@openfront/engine/execution/nation/NationWarshipBehavior";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { TradeShipExecution } from "@openfront/engine/execution/TradeShipExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import type { Game, Player, Unit } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { planObservedNationalNavalTargets } from "@openfront/engine/national/ai/NationalNavalStrategy";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { describe, expect, it, vi } from "vitest";
import { createGame, L, W } from "../core/pathfinding/_fixtures";
import { setup } from "../util/Setup";
import { diffSnapshots, roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const [A, B, C, D] = ["c5nav-a", "c5nav-b", "c5nav-c", "c5nav-d"];
const botInfo = new PlayerInfo("Navy", PlayerType.Nation, null, A);
const humans = [
  new PlayerInfo("Enemy", PlayerType.Human, null, B),
  new PlayerInfo("Merchant", PlayerType.Human, null, C),
  new PlayerInfo("Observer", PlayerType.Human, "c5-nav-client", D),
];
const botNation = new Nation(new Cell(1, 10), botInfo);

class NavalConfig extends TestConfig {
  warshipPatrolRange(): number {
    return 16;
  }
  safeFromPiratesCooldownMax(): number {
    return 0;
  }
}

async function fixture(withBotExecution = false) {
  const game = await setup(
    "half_land_half_ocean",
    { nationalMode: true, instantBuild: true },
    humans,
    undefined,
    NavalConfig,
  );
  game.addPlayer(botInfo);
  const players = [A, B, C, D].map((id, index) => {
    const player = game.player(id);
    const spawn = game.ref(1, index * 4 + 1);
    player.conquer(spawn);
    player.setSpawnTile(spawn);
    player.addGold(1_000_000_000n);
    return player;
  });
  const [a, b, c, d] = players;
  const port = (player: Player, y: number): Unit => {
    const land = game.ref(7, y);
    player.conquer(land);
    return player.buildUnit(UnitType.Port, land, {});
  };
  const cPort = port(c, 1);
  const dPort = port(d, 5);
  const aPort = port(a, 10);
  const bPort = port(b, 14);
  if (withBotExecution) {
    game.addExecution(new NationExecution("c5-nav-ai", botNation));
    game.executeNextTick();
  }
  const issued = game.performNationalWarCommandWithOutcome(a, {
    kind: "declare-national",
    warId: "c5-nav-real-war",
    aggressorId: A,
    targetId: B,
  });
  expect(issued.accepted).toBe(true);
  const fixedEnemyMerchant = b.buildUnit(UnitType.TradeShip, game.ref(8, 12), {
    targetUnit: cPort,
    lastSetSafeFromPirates: -100,
  });
  const random = new PseudoRandom(612);
  const behavior = new NationWarshipBehavior(
    random,
    game,
    a,
    new NationEmojiBehavior(random, game, a),
  );
  return {
    game,
    a,
    b,
    c,
    d,
    aPort,
    bPort,
    cPort,
    dPort,
    fixedEnemyMerchant,
    behavior,
  };
}

function advance(game: Game, count: number): void {
  for (let i = 0; i < count; i++) game.executeNextTick();
}

function runnerFor(game: Game): GameRunner {
  return new GameRunner(
    game,
    new Executor(game, "c5-nav-ai", "c5-nav-client"),
    () => {},
    "c5-nav-client",
  );
}

function advanceRunner(game: Game, turns: number) {
  const runner = runnerFor(game);
  for (let i = 0; i < turns; i++) {
    runner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(runner.executeNextTick()).toBe(true);
  }
}

describe("C5 Class Three E6 lawful observed naval strategy", () => {
  it("selects only current visible WAR enemy merchants; hides ports, allies and neutral vessels", async () => {
    const { game, a, b, c, d, cPort, dPort, behavior, fixedEnemyMerchant } =
      await fixture();
    // A and D actually form an empire. This is a legitimate allied merchant,
    // not merely a second uninvolved neutral vessel.
    game.performNationalCommand(a, {
      kind: "found-empire",
      empireId: "c5-nav-merchant-alliance",
    });
    game.performNationalCommand(a, {
      kind: "offer-empire",
      empireId: "c5-nav-merchant-alliance",
      candidateId: D,
    });
    game.performNationalCommand(d, {
      kind: "accept-empire",
      empireId: "c5-nav-merchant-alliance",
      candidateId: D,
    });
    const neutral = c.buildUnit(UnitType.TradeShip, game.ref(8, 12), {
      targetUnit: cPort,
    });
    const ally = d.buildUnit(UnitType.TradeShip, game.ref(8, 12), {
      targetUnit: dPort,
    });
    const sight = collectLiveNationalObservation(game, A);
    expect(
      sight.observation.coalitions.some(
        (cohort) =>
          cohort.kind === "empire" &&
          cohort.members.includes(A) &&
          cohort.members.includes(D),
      ),
    ).toBe(true);
    const ports = [{ x: 7, y: 10 }];
    const targets = planObservedNationalNavalTargets(sight.observation, ports);
    expect(targets.map((t) => t.vesselId)).toEqual([
      String(fixedEnemyMerchant.id()),
    ]);
    expect(targets.map((t) => t.vesselId)).not.toContain(String(neutral.id()));
    expect(targets.map((t) => t.vesselId)).not.toContain(String(ally.id()));

    // Remove this sole observed shipping target. The enemy port is visible,
    // but its coordinates cannot be mistaken for a trade route.
    fixedEnemyMerchant.delete(false);
    expect(
      planObservedNationalNavalTargets(
        collectLiveNationalObservation(game, A).observation,
        ports,
      ),
    ).toEqual([]);
    expect(
      behavior.dispatchNationalNavalPressure(
        collectLiveNationalObservation(game, A).observation,
      ),
    ).toBeNull();
    expect(a.units(UnitType.Warship)).toHaveLength(0);
    expect(game.nationalWarAuthority()?.atWar(A, B)).toBe(true);
    expect(b.units(UnitType.Port)).toHaveLength(1);
  });

  it("builds with actual gold and connected port; moves the original warship into a wartime merchant's area", async () => {
    const { game, a, behavior, fixedEnemyMerchant } = await fixture();
    const targetTile = fixedEnemyMerchant.tile();
    const initial = a.gold();
    const price = game.unitInfo(UnitType.Warship).cost(game, a);
    const sight = collectLiveNationalObservation(game, A);
    // The executor does not enumerate enemy units or discover secret paths.
    const foreignUnitScan = vi.spyOn(game, "units");
    const dispatched = behavior.dispatchNationalNavalPressure(
      sight.observation,
    );
    expect(dispatched).toBe("build");
    expect(foreignUnitScan).not.toHaveBeenCalled();
    foreignUnitScan.mockRestore();

    advance(game, 3);
    const ship = a.units(UnitType.Warship)[0];
    expect(ship).toBeDefined();
    expect(ship.warshipState().patrolTile).toBe(targetTile);
    expect(a.gold()).toBeLessThanOrEqual(initial - price);
    const visited = new Set<number>([ship.tile()]);
    let closestApproach = game.manhattanDist(ship.tile(), targetTile);
    for (let i = 0; i < 35; i++) {
      game.executeNextTick();
      if (ship.isActive()) {
        visited.add(ship.tile());
        closestApproach = Math.min(
          closestApproach,
          game.manhattanDist(ship.tile(), targetTile),
        );
      }
      if (ship.tile() === targetTile) break;
    }
    expect(visited.size).toBeGreaterThan(1);
    expect(closestApproach).toBeLessThanOrEqual(2);
    expect(
      behavior.dispatchNationalNavalPressure(sight.observation),
    ).toBeNull();
    console.info(
      "C5_NAVAL_PHYSICAL=" +
        JSON.stringify({
          spentAtLeast: price.toString(),
          warshipId: ship.id(),
          target: targetTile,
          visited: visited.size,
          finalTile: ship.tile(),
          active: ship.isActive(),
          authority: game
            .nationalWarAuthority()
            ?.authorizeOffensiveAction(A, B),
        }),
    );
  });

  it("rejects no gold, false principal, stale observation, peace and disconnected destinations", async () => {
    const { game, a, b, behavior } = await fixture();
    const observed = collectLiveNationalObservation(game, A).observation;
    a.removeGold(a.gold());
    expect(behavior.dispatchNationalNavalPressure(observed)).toBeNull();
    expect(a.units(UnitType.Warship)).toHaveLength(0);
    a.addGold(1_000_000_000n);

    expect(
      behavior.dispatchNationalNavalPressure({ ...observed, observerId: C }),
    ).toBeNull();
    expect(
      behavior.dispatchNationalNavalPressure({ ...observed, tick: -1 }),
    ).toBeNull();

    const motion = game.performNationalWarCommandWithOutcome(a, {
      kind: "propose-peace",
      warId: "c5-nav-real-war",
      motionId: "c5-nav-peace",
    });
    expect(motion.accepted).toBe(true);
    expect(
      game.performNationalWarCommandWithOutcome(b, {
        kind: "accept-peace",
        motionId: "c5-nav-peace",
      }).accepted,
    ).toBe(true);
    const peaceful = collectLiveNationalObservation(game, A).observation;
    expect(behavior.dispatchNationalNavalPressure(peaceful)).toBeNull();
    expect(a.units(UnitType.Warship)).toHaveLength(0);
  });

  it("live GameRunner bot deploys; state survives snapshot, destruction and peace without unauthorized piracy", async () => {
    const { game, a, b, c, cPort, bPort } = await fixture(true);
    const before = a.gold();
    advanceRunner(game, 10);
    const active = a.units(UnitType.Warship);
    expect(active.length).toBeGreaterThan(0);
    expect(a.gold()).toBeLessThan(before);
    const ship = active[0];
    const position = ship.tile();
    const { restored, bytes, again } = await roundTrip(
      game,
      "half_land_half_ocean",
    );
    expect(again).toEqual(bytes);
    expect(restored.player(A).units(UnitType.Warship)).toHaveLength(
      active.length,
    );
    expect(restored.player(A).units(UnitType.Warship)[0].tile()).toBe(position);
    const originalRunner = runnerFor(game);
    const restoredRunner = runnerFor(restored);
    for (let i = 0; i < 12; i++) {
      for (const [g, runner] of [
        [game, originalRunner],
        [restored, restoredRunner],
      ] as const) {
        runner.addTurn({ turnNumber: g.ticks(), intents: [] });
        expect(runner.executeNextTick()).toBe(true);
      }
    }
    const replayA = await roundTrip(game, "half_land_half_ocean");
    const replayB = await roundTrip(restored, "half_land_half_ocean");
    expect(diffSnapshots(replayA.bytes, replayB.bytes)).toEqual([]);

    // Real neutral merchant route approaching B is legal but may be returned
    // by the engine only while a valid enemy-port blockader is on station.
    const voyage = new TradeShipExecution(c, cPort, bPort);
    game.addExecution(voyage);
    advanceRunner(game, 3);
    const merchant = c.units(UnitType.TradeShip)[0];
    expect(merchant).toBeDefined();

    ship.delete(false);
    const merchantOwner = merchant.owner();
    const motion = game.performNationalWarCommandWithOutcome(a, {
      kind: "propose-peace",
      warId: "c5-nav-real-war",
      motionId: "c5-nav-stop",
    });
    expect(motion.accepted).toBe(true);
    expect(
      game.performNationalWarCommandWithOutcome(b, {
        kind: "accept-peace",
        motionId: "c5-nav-stop",
      }).accepted,
    ).toBe(true);
    expect(game.nationalWarAuthority()?.authorizeOffensiveAction(A, B)).toBe(
      false,
    );
    const piracyBefore = a.piracyGold();
    advanceRunner(game, 20);
    expect(merchant.owner()).toBe(merchantOwner);
    expect(a.piracyGold()).toBe(piracyBefore);
    expect(
      planObservedNationalNavalTargets(
        collectLiveNationalObservation(game, A).observation,
        [{ x: 7, y: 10 }],
      ),
    ).toEqual([]);
  });
  it("retasks a funded existing ship across a connected sea without buying a phantom second hull", async () => {
    const { game, a, behavior, fixedEnemyMerchant } = await fixture();
    const originalPatrol = game.ref(8, 1);
    const active = a.buildUnit(UnitType.Warship, game.ref(8, 9), {
      patrolTile: originalPatrol,
    });
    game.addExecution(new WarshipExecution(active));
    const gold = a.gold();
    const observation = collectLiveNationalObservation(game, A).observation;
    const destination = fixedEnemyMerchant.tile();
    expect(originalPatrol).not.toBe(destination);
    expect(behavior.dispatchNationalNavalPressure(observation)).toBe("move");
    advance(game, 3);
    expect(active.warshipState().patrolTile).toBe(destination);
    expect(a.units(UnitType.Warship)).toHaveLength(1);
    expect(a.gold()).toBe(gold);
    const visited = new Set<number>([active.tile()]);
    for (let i = 0; i < 20 && active.isActive(); i++) {
      game.executeNextTick();
      visited.add(active.tile());
    }
    expect(visited.size).toBeGreaterThan(1);
  });

  it("one observed ship cannot trigger duplicate spending when sight drops and returns", async () => {
    const { game, a, b, cPort, behavior, fixedEnemyMerchant } = await fixture();
    const first = collectLiveNationalObservation(game, A).observation;
    const spy = vi.spyOn(game, "addExecution");
    try {
      expect(behavior.dispatchNationalNavalPressure(first)).toBe("build");
      fixedEnemyMerchant.delete(false);
      const lost = collectLiveNationalObservation(game, A).observation;
      expect(planObservedNationalNavalTargets(lost, [{ x: 7, y: 10 }])).toEqual(
        [],
      );
      expect(behavior.dispatchNationalNavalPressure(lost)).toBeNull();
      const acquired = b.buildUnit(UnitType.TradeShip, game.ref(8, 5), {
        targetUnit: cPort,
        lastSetSafeFromPirates: -100,
      });
      const regained = collectLiveNationalObservation(game, A).observation;
      expect(
        planObservedNationalNavalTargets(regained, [{ x: 7, y: 10 }]).some(
          (target) => target.vesselId === String(acquired.id()),
        ),
      ).toBe(true);
      expect(behavior.dispatchNationalNavalPressure(regained)).toBeNull();
      const orders = spy.mock.calls.flatMap(([...calls]) => calls);
      expect(
        orders.filter(
          (execution) => execution.constructor.name === "ConstructionExecution",
        ),
      ).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
    advance(game, 3);
    expect(a.units(UnitType.Warship)).toHaveLength(1);
  });

  it("an ACTUAL disconnected sea denies visible enemy commerce, and a stranded fleet cannot teleport", () => {
    const width = 40;
    const height = 18;
    const grid = Array.from({ length: width * height }, (_, i) => {
      const x = i % width;
      return x < 4 || (x >= 18 && x <= 23) || x >= 36 ? L : W;
    });
    const game = createGame(
      { width, height, grid },
      { nationalMode: true, instantBuild: true },
    );
    game.addPlayer(new PlayerInfo("Navy", PlayerType.Nation, null, A));
    game.addPlayer(new PlayerInfo("Enemy", PlayerType.Human, null, B));
    game.endSpawnPhase();
    const a = game.player(A);
    const b = game.player(B);
    const ownCoast = game.ref(3, 9);
    const enemyCoast = game.ref(36, 9);
    a.conquer(ownCoast);
    b.conquer(enemyCoast);
    a.setSpawnTile(ownCoast);
    b.setSpawnTile(enemyCoast);
    a.addGold(1_000_000n);
    b.addGold(1_000_000n);
    const ownPort = a.buildUnit(UnitType.Port, ownCoast, {});
    const enemyPort = b.buildUnit(UnitType.Port, enemyCoast, {});
    const merchant = b.buildUnit(UnitType.TradeShip, game.ref(30, 9), {
      targetUnit: enemyPort,
      lastSetSafeFromPirates: -100,
    });
    expect(
      game.performNationalWarCommandWithOutcome(a, {
        kind: "declare-national",
        warId: "c5-disconnected-seas",
        aggressorId: A,
        targetId: B,
      }).accepted,
    ).toBe(true);
    const live = collectLiveNationalObservation(game, A).observation;
    expect(
      live.visibleAssets.some((asset) => asset.id === String(merchant.id())),
    ).toBe(true);
    const east = game.getWaterComponent(merchant.tile());
    const west = game.getWaterComponent(ownPort.tile());
    expect(east).not.toBeNull();
    expect(west).not.toBeNull();
    expect(east).not.toBe(west);
    const ownShip = a.buildUnit(UnitType.Warship, game.ref(10, 9), {
      patrolTile: game.ref(10, 9),
    });
    const random = new PseudoRandom(99);
    const ai = new NationWarshipBehavior(
      random,
      game,
      a,
      new NationEmojiBehavior(random, game, a),
    );
    const treasury = a.gold();
    const beforePatrol = ownShip.warshipState().patrolTile;
    const spy = vi.spyOn(game, "addExecution");
    try {
      expect(ai.dispatchNationalNavalPressure(live)).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(a.gold()).toBe(treasury);
    expect(a.units(UnitType.Warship)).toHaveLength(1);
    expect(ownShip.warshipState().patrolTile).toBe(beforePatrol);
    console.info(
      "C5_NAVAL_DISCONNECTED=" +
        JSON.stringify({
          westComponent: west,
          eastComponent: east,
          treasury: treasury.toString(),
          observedMerchantId: merchant.id(),
          strandedWarshipId: ownShip.id(),
        }),
    );
  });

  it("identical-seed four-nation GameRunner CONTROL versus live paid neutral trade", async () => {
    const { game, bPort, cPort } = await fixture(true);
    const {
      restored: control,
      bytes,
      again,
    } = await roundTrip(game, "half_land_half_ocean");
    expect(again).toEqual(bytes);
    const price = game.unitInfo(UnitType.Warship).cost(game, game.player(A));
    // In both worlds the same neutral merchant pays for a real C -> B voyage.
    // Only the new naval AI dispatch is disabled in the CONTROL world.
    control.addExecution(
      new TradeShipExecution(
        control.player(C),
        control
          .player(C)
          .units(UnitType.Port)
          .find((u) => u.tile() === cPort.tile())!,
        control
          .player(B)
          .units(UnitType.Port)
          .find((u) => u.tile() === bPort.tile())!,
      ),
    );
    game.addExecution(new TradeShipExecution(game.player(C), cPort, bPort));
    // An actual paid B -> C voyage, not a manufactured static TradeShip.
    // This is the hostile shipping income the NATIONAL navy must suppress.
    const otherBPort = control.player(B).units(UnitType.Port)[0];
    const otherCPort = control.player(C).units(UnitType.Port)[0];
    control.addExecution(
      new TradeShipExecution(control.player(B), otherBPort, otherCPort),
    );
    game.addExecution(new TradeShipExecution(game.player(B), bPort, cPort));
    const unmodified = vi
      .spyOn(NationWarshipBehavior.prototype, "dispatchNationalNavalPressure")
      .mockReturnValue(null);
    let controlGoldAt8 = 0n;
    let controlPiracyAt8 = 0n;
    try {
      advanceRunner(control, 8);
      controlGoldAt8 = control.player(A).gold();
      controlPiracyAt8 = control.player(A).piracyGold();
      // Keep this identical-seed CONTROL unarmed for the ENTIRE voyage.
      // Restoring the prototype after only eight ticks accidentally let the
      // control bot purchase its own warship, destroying the comparison.
      advanceRunner(control, 95);
    } finally {
      unmodified.mockRestore();
    }
    advanceRunner(game, 8);
    const deployed = game.player(A).units(UnitType.Warship);
    expect(control.player(A).units(UnitType.Warship)).toHaveLength(0);
    expect(deployed.length).toBeGreaterThan(0);
    // The cost is from Player.buildUnit / WarshipExecution, not an AI ledger.
    // Correct for any real pirate proceeds already credited to the active A.
    const actualCost =
      controlGoldAt8 -
      game.player(A).gold() +
      game.player(A).piracyGold() -
      controlPiracyAt8;
    expect(actualCost).toBe(price);

    const firstPosition = deployed[0].tile();
    advanceRunner(game, 95);
    console.info(
      "C5_NAVAL_PAID_ROUTE_DIAGNOSTIC=" +
        JSON.stringify({
          realWar: game.nationalWarAuthority()?.atWar(A, B),
          activeB: game.player(B).tradeGold().toString(),
          controlB: control.player(B).tradeGold().toString(),
          activeC: game.player(C).tradeGold().toString(),
          controlC: control.player(C).tradeGold().toString(),
          activePiracy: game.player(A).piracyGold().toString(),
          controlPiracy: control.player(A).piracyGold().toString(),
          activeWarshipPos: deployed[0].tile(),
          activeBShips: game
            .player(B)
            .units(UnitType.TradeShip)
            .map((u) => [u.id(), u.tile(), u.isActive()]),
          controlBShips: control
            .player(B)
            .units(UnitType.TradeShip)
            .map((u) => [u.id(), u.tile(), u.isActive()]),
        }),
    );
    expect(control.player(B).tradeGold()).toBeGreaterThan(0n);
    expect(game.player(B).tradeGold()).toBeLessThan(
      control.player(B).tradeGold(),
    );
    expect(deployed[0].tile()).not.toBe(firstPosition);
    expect(control.player(A).piracyGold()).toBe(0n);
    console.info(
      "C5_NAVAL_CONTROLLED_WITNESS=" +
        JSON.stringify({
          seed: "same-snapshot",
          war: game.nationalWarAuthority()?.atWar(A, B),
          price: price.toString(),
          activeWarship: deployed[0].id(),
          activeBTradeGold: game.player(B).tradeGold().toString(),
          controlBTradeGold: control.player(B).tradeGold().toString(),
          activeAPiracyGold: game.player(A).piracyGold().toString(),
          controlAPiracyGold: control.player(A).piracyGold().toString(),
          start: firstPosition,
          end: deployed[0].tile(),
        }),
    );
  });
});
