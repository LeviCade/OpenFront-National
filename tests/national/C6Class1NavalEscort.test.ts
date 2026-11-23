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
import type { Game, Player } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { planObservedNationalNavalEscorts } from "@openfront/engine/national/ai/NationalNavalEscortStrategy";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { describe, expect, it, vi } from "vitest";
import { createGame, L, W } from "../core/pathfinding/_fixtures";
import { setup } from "../util/Setup";
import { diffSnapshots, roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const [A, B, C] = ["c6-escort-a", "c6-escort-b", "c6-escort-c"];
const botInfo = new PlayerInfo("Escort Navy", PlayerType.Nation, null, A);
const botNation = new Nation(new Cell(1, 10), botInfo);

class EscortConfig extends TestConfig {
  warshipPatrolRange(): number {
    return 16;
  }
  safeFromPiratesCooldownMax(): number {
    return 0;
  }
}

async function fixture(withBot = false) {
  const game = await setup(
    "half_land_half_ocean",
    { nationalMode: true, instantBuild: true },
    [
      new PlayerInfo("Raider", PlayerType.Human, null, B),
      new PlayerInfo("Customer", PlayerType.Human, null, C),
    ],
    undefined,
    EscortConfig,
  );
  game.addPlayer(botInfo);
  const [a, b, c] = [A, B, C].map((id, index) => {
    const player = game.player(id);
    const spawn = game.ref(1, index * 5 + 1);
    player.conquer(spawn);
    player.setSpawnTile(spawn);
    player.addGold(1_000_000_000n);
    return player;
  });
  const port = (owner: Player, y: number) => {
    const tile = game.ref(7, y);
    owner.conquer(tile);
    return owner.buildUnit(UnitType.Port, tile, {});
  };
  const aPort = port(a, 10);
  const bPort = port(b, 14);
  const cPort = port(c, 1);
  if (withBot) {
    game.addExecution(new NationExecution("c6-escort", botNation));
    game.executeNextTick();
  }
  expect(
    game.performNationalWarCommandWithOutcome(a, {
      kind: "declare-national",
      warId: "c6-escort-war",
      aggressorId: A,
      targetId: B,
    }).accepted,
  ).toBe(true);
  const random = new PseudoRandom(711);
  const behavior = new NationWarshipBehavior(
    random,
    game,
    a,
    new NationEmojiBehavior(random, game, a),
  );
  return { game, a, b, c, aPort, bPort, cPort, behavior };
}

function run(game: Game, ticks: number): void {
  const runner = new GameRunner(
    game,
    new Executor(game, "c6-escort", "c6-escort-client"),
    () => {},
    "c6-escort-client",
  );
  for (let i = 0; i < ticks; i++) {
    runner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(runner.executeNextTick()).toBe(true);
  }
}

async function activeThreat(withBot = false) {
  const state = await fixture(withBot);
  const { game, a, b, aPort, cPort } = state;
  // Align the paid voyage with the bot's observation schedule; the
  // execution queue takes two physical ticks to spawn an actual merchant.
  if (game.ticks() < 3) run(game, 3 - game.ticks());
  game.addExecution(new TradeShipExecution(a, aPort, cPort));
  run(game, 2);
  const merchant = a.units(UnitType.TradeShip)[0];
  expect(merchant).toBeDefined();
  expect(merchant.isActive()).toBe(true);
  const raider = b.buildUnit(UnitType.Warship, game.ref(12, 14), {
    patrolTile: game.ref(8, 10),
  });
  game.addExecution(new WarshipExecution(raider));
  const observed = collectLiveNationalObservation(game, A).observation;
  expect(observed.visibleAssets.some((u) => u.id === String(raider.id()))).toBe(
    true,
  );
  expect(
    observed.visibleAssets.some((u) => u.id === String(merchant.id())),
  ).toBe(true);
  return { ...state, merchant, raider, observed };
}

describe("C6 Class One E6 original defensive convoy escort", () => {
  it("selects only present, visible WAR raiders of actually friendly commerce, rejects duplicate IDs and forgery", async () => {
    const { game, a, b, c, observed, merchant, raider, behavior } =
      await activeThreat();
    const targets = planObservedNationalNavalEscorts(observed);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      merchantId: String(merchant.id()),
      raiderId: String(raider.id()),
      raiderOwnerId: B,
    });
    expect(
      planObservedNationalNavalEscorts({
        ...observed,
        visibleAssets: observed.visibleAssets.filter(
          (u) => u.id !== String(raider.id()),
        ),
      }),
    ).toEqual([]);
    expect(
      planObservedNationalNavalEscorts({
        ...observed,
        visibleAssets: [...observed.visibleAssets, observed.visibleAssets[0]],
      }),
    ).toEqual([]);
    // A neutral warship may be visible but is never a legally valid raider.
    const neutral = c.buildUnit(UnitType.Warship, game.ref(8, 12), {
      patrolTile: game.ref(8, 12),
    });
    const withNeutral = collectLiveNationalObservation(game, A).observation;
    expect(
      planObservedNationalNavalEscorts(withNeutral).some(
        (t) => t.raiderId === String(neutral.id()),
      ),
    ).toBe(false);
    expect(
      behavior.dispatchNationalNavalEscort({ ...observed, observerId: B }),
    ).toBeNull();
    expect(
      behavior.dispatchNationalNavalEscort({ ...observed, tick: -1 }),
    ).toBeNull();
    expect(a.units(UnitType.Warship)).toHaveLength(0);
    expect(b.units(UnitType.Warship)).toHaveLength(1);
  });

  it("pays for a real owned-port warship, moves through water, maintains distinct escort duty across snapshots", async () => {
    const { game, a, aPort, raider, observed, behavior } = await activeThreat();
    const price = game.unitInfo(UnitType.Warship).cost(game, a);
    const before = a.gold();
    const foreignScan = vi.spyOn(game, "units");
    expect(behavior.dispatchNationalNavalEscort(observed)).toBe("build");
    expect(foreignScan).not.toHaveBeenCalled();
    foreignScan.mockRestore();
    expect(behavior.dispatchNationalNavalEscort(observed)).toBeNull();
    run(game, 3);
    const ship = a.units(UnitType.Warship)[0];
    expect(ship).toBeDefined();
    expect(a.gold()).toBeLessThanOrEqual(before - price);
    // ConstructionExecution chooses an actual owned port, not the raider.
    expect(aPort.owner()).toBe(a);
    expect(game.isWater(ship.tile())).toBe(true);
    expect(game.hasWaterComponent(aPort.tile(), game.getWaterComponent(ship.tile())!)).toBe(true);
    const tiles = new Set([ship.tile()]);
    let combat = ship.warshipState().isInCombat === true;
    for (let i = 0; i < 30 && ship.isActive(); i++) {
      run(game, 1);
      tiles.add(ship.tile());
      combat ||= ship.warshipState().isInCombat === true;
    }
    expect(tiles.size).toBeGreaterThan(1);
    const { restored, bytes, again } = await roundTrip(
      game,
      "half_land_half_ocean",
    );
    expect(again).toEqual(bytes);
    expect(restored.player(A).units(UnitType.Warship).length).toBe(
      a.units(UnitType.Warship).length,
    );
    const first = new GameRunner(
      game,
      new Executor(game, "c6-escort", "c6-escort-client"),
      () => {},
      "c6-escort-client",
    );
    const second = new GameRunner(
      restored,
      new Executor(restored, "c6-escort", "c6-escort-client"),
      () => {},
      "c6-escort-client",
    );
    for (let i = 0; i < 12; i++) {
      for (const [g, runner] of [[game, first], [restored, second]] as const) {
        runner.addTurn({ turnNumber: g.ticks(), intents: [] });
        expect(runner.executeNextTick()).toBe(true);
      }
    }
    expect(
      diffSnapshots(
        (await roundTrip(game, "half_land_half_ocean")).bytes,
        (await roundTrip(restored, "half_land_half_ocean")).bytes,
      ),
    ).toEqual([]);
    console.info(
      "C6_ESCORT_PHYSICAL=" +
        JSON.stringify({
          cost: price.toString(),
          shipId: ship.id(),
          visited: tiles.size,
          combat,
          raiderAlive: raider.isActive(),
        }),
    );
  });

  it("reassigns an existing legitimate patrol without a ghost purchase", async () => {
    const { game, a, behavior, observed, raider } = await activeThreat();
    const existing = a.buildUnit(UnitType.Warship, game.ref(8, 11), {
      patrolTile: game.ref(8, 1),
    });
    game.addExecution(new WarshipExecution(existing));
    const gold = a.gold();
    const observedRaiderTile = raider.tile();
    expect(behavior.dispatchNationalNavalEscort(observed)).toBe("move");
    run(game, 2);
    expect(a.units(UnitType.Warship)).toHaveLength(1);
    // The REAL hostile warship continues moving between order and test.
    // Compare against the ordered observed coordinate, not its later tile.
    expect(existing.warshipState().patrolTile).toBe(observedRaiderTile);
    expect(a.gold()).toBe(gold);
  });

  it("fails closed for FFA and non-merchant transport sightings", async () => {
    const { game, observed } = await activeThreat();
    const noCommerce = {
      ...observed,
      visibleAssets: observed.visibleAssets.map((asset) =>
        asset.kind === "trade-ship"
          ? { ...asset, kind: "transport" as const }
          : asset,
      ),
    };
    expect(planObservedNationalNavalEscorts(noCommerce)).toEqual([]);
    const free = createGame(
      {
        width: 8,
        height: 8,
        grid: Array.from({ length: 64 }, (_, i) => (i % 8 < 4 ? L : W)),
      },
      { nationalMode: false, instantBuild: true },
    );
    free.addPlayer(new PlayerInfo("FFA", PlayerType.Nation, null, A));
    free.endSpawnPhase();
    const owner = free.player(A);
    const land = free.ref(3, 3);
    owner.conquer(land);
    owner.setSpawnTile(land);
    const rng = new PseudoRandom(91);
    const ffa = new NationWarshipBehavior(
      rng,
      free,
      owner,
      new NationEmojiBehavior(rng, free, owner),
    );
    expect(ffa.dispatchNationalNavalEscort(observed)).toBeNull();
    expect(game.config().nationalMode()).toBe(true);
  });

  it("rejects poverty, peace, lost merchant and impossible foreign water without synthetic orders", async () => {
    const { game, a, b, observed, merchant, behavior } =
      await activeThreat();
    a.removeGold(a.gold());
    expect(behavior.dispatchNationalNavalEscort(observed)).toBeNull();
    expect(a.units(UnitType.Warship)).toHaveLength(0);
    a.addGold(1_000_000_000n);
    merchant.delete(false);
    expect(
      behavior.dispatchNationalNavalEscort(
        collectLiveNationalObservation(game, A).observation,
      ),
    ).toBeNull();
    const motion = game.performNationalWarCommandWithOutcome(a, {
      kind: "propose-peace",
      warId: "c6-escort-war",
      motionId: "c6-escort-peace",
    });
    expect(motion.accepted).toBe(true);
    expect(
      game.performNationalWarCommandWithOutcome(b, {
        kind: "accept-peace",
        motionId: "c6-escort-peace",
      }).accepted,
    ).toBe(true);
    expect(behavior.dispatchNationalNavalEscort(observed)).toBeNull();

    const width = 40;
    const height = 18;
    const grid = Array.from({ length: width * height }, (_, i) => {
      const x = i % width;
      return x < 4 || (x >= 18 && x <= 23) || x >= 36 ? L : W;
    });
    const split = createGame(
      { width, height, grid },
      { nationalMode: true, instantBuild: true },
    );
    split.addPlayer(new PlayerInfo("Defender", PlayerType.Nation, null, A));
    split.addPlayer(new PlayerInfo("Raider", PlayerType.Human, null, B));
    split.addPlayer(new PlayerInfo("Customer", PlayerType.Human, null, C));
    split.endSpawnPhase();
    const defender = split.player(A);
    const hostile = split.player(B);
    const customer = split.player(C);
    for (const [p, tile] of [
      [defender, split.ref(3, 8)],
      [hostile, split.ref(36, 8)],
      [customer, split.ref(36, 13)],
    ] as const) {
      p.conquer(tile);
      p.setSpawnTile(tile);
      p.addGold(1_000_000n);
      p.buildUnit(UnitType.Port, tile, {});
    }
    const ownTrader = defender.buildUnit(UnitType.TradeShip, split.ref(15, 8), {
      targetUnit: customer.units(UnitType.Port)[0],
    });
    const foreignRaider = hostile.buildUnit(UnitType.Warship, split.ref(25, 8), {
      patrolTile: split.ref(25, 8),
    });
    expect(
      split.performNationalWarCommandWithOutcome(defender, {
        kind: "declare-national",
        warId: "c6-escort-split",
        aggressorId: A,
        targetId: B,
      }).accepted,
    ).toBe(true);
    const rnd = new PseudoRandom(66);
    const ai = new NationWarshipBehavior(
      rnd,
      split,
      defender,
      new NationEmojiBehavior(rnd, split, defender),
    );
    const sight = collectLiveNationalObservation(split, A).observation;
    expect(sight.visibleAssets.some((u) => u.id === String(ownTrader.id()))).toBe(
      true,
    );
    // The disconnected raider cannot receive a same-component order; even a
    // forged visible coordinate must not cause travel or treasury deduction.
    const forged = {
      ...sight,
      visibleAssets: [
        ...sight.visibleAssets.filter(
          (u) => u.id !== String(foreignRaider.id()),
        ),
        {
          id: String(foreignRaider.id()),
          ownerId: B,
          kind: "warship" as const,
          x: 25,
          y: 8,
          source: "coast" as const,
        },
      ],
    };
    const spent = defender.gold();
    expect(planObservedNationalNavalEscorts(forged)).toHaveLength(1);
    expect(ai.dispatchNationalNavalEscort(forged)).toBeNull();
    expect(defender.gold()).toBe(spent);
  });

  it("same-snapshot REAL GameRunner escort versus disabled control measures trade or battle consequence", async () => {
    const { game, a, b, raider } = await activeThreat(true);
    const {
      restored: control,
      bytes,
      again,
    } = await roundTrip(game, "half_land_half_ocean");
    expect(again).toEqual(bytes);
    expect(a.units(UnitType.Warship)).toHaveLength(0);
    const before = a.gold();
    const price = game.unitInfo(UnitType.Warship).cost(game, a);
    // The captured merchant can later become an enemy-flagged ship, which
    // legitimately triggers inherited Fifth offensive pressure. Disable that
    // independent behavior in BOTH worlds to isolate Sixth defensive value.
    // All real WAR, piracy, trade and autonomous warship combat remain active.
    const inheritedOff = vi
      .spyOn(NationWarshipBehavior.prototype, "dispatchNationalNavalPressure")
      .mockReturnValue(null);
    let disabledEscortCalls = 0;
    try {
      const off = vi
        .spyOn(NationWarshipBehavior.prototype, "dispatchNationalNavalEscort")
        .mockImplementation(() => {
          disabledEscortCalls++;
          return null;
        });
      try {
        run(control, 65);
      } finally {
        off.mockRestore();
      }
      run(game, 8);
      const {
        restored: escortReplay,
        bytes: escortBytes,
        again: escortAgain,
      } = await roundTrip(game, "half_land_half_ocean");
      expect(escortAgain).toEqual(escortBytes);
      run(game, 12);
      run(escortReplay, 12);
      expect(
        diffSnapshots(
          (await roundTrip(game, "half_land_half_ocean")).bytes,
          (await roundTrip(escortReplay, "half_land_half_ocean")).bytes,
        ),
      ).toEqual([]);
      run(game, 45);
    } finally {
      inheritedOff.mockRestore();
    }
    expect(disabledEscortCalls).toBeGreaterThan(0);
    const ourShips = game.player(A).units(UnitType.Warship);
    const controlShips = control.player(A).units(UnitType.Warship);
    const liveRaider = b.units(UnitType.Warship).find((u) => u.id() === raider.id());
    const controlRaider = control
      .player(B)
      .units(UnitType.Warship)
      .find((u) => u.id() === raider.id());
    const health = (ship: typeof raider | undefined) =>
      ship?.isActive() ? ship.health() : 0;
    const data = {
      paidCost: price.toString(),
      beginningGold: before.toString(),
      activeGold: game.player(A).gold().toString(),
      controlGold: control.player(A).gold().toString(),
      activeTrade: game.player(A).tradeGold().toString(),
      controlTrade: control.player(A).tradeGold().toString(),
      activePiracyByB: game.player(B).piracyGold().toString(),
      controlPiracyByB: control.player(B).piracyGold().toString(),
      activeRaiderHealth: health(liveRaider),
      controlRaiderHealth: health(controlRaider),
      activeEscortShips: ourShips.map((u) => [u.id(), u.tile(), u.isActive()]),
      controlEscortShips: controlShips.length,
      disabledEscortCalls,
    };
    console.info("C6_ESCORT_TWIN_GAME_RUNNER=" + JSON.stringify(data));
    expect(controlShips).toHaveLength(0);
    expect(ourShips.length).toBeGreaterThan(0);
    expect(game.player(A).gold()).toBeLessThan(before);
    expect(
      game.player(A).tradeGold() > control.player(A).tradeGold() ||
        health(liveRaider) < health(controlRaider),
    ).toBe(true);
  });
});
