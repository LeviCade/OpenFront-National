import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { StampedIntent } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationalBlockadeExecution } from "@openfront/engine/execution/NationalBlockadeExecution";
import { TradeShipExecution } from "@openfront/engine/execution/TradeShipExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import type { Game, Player, Unit } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { decodeSnapshotValue } from "@openfront/engine/snapshot/SnapshotCodec";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { diffSnapshots, roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const MAP = "half_land_half_ocean";
const [A, B, C] = ["blockade-a", "blockade-b", "blockade-c"];
const WAR = "blockade-war";
class MaritimeConfig extends TestConfig {
  warshipPatrolRange(): number {
    return 16;
  }
  safeFromPiratesCooldownMax(): number {
    return 0;
  }
}

function runner(game: Game) {
  return new GameRunner(
    game,
    new Executor(game, "blockade-match", A),
    () => {},
    A,
  );
}
function step(game: Game, run: GameRunner, intents: StampedIntent[] = []) {
  run.addTurn({ turnNumber: game.ticks(), intents });
  expect(run.executeNextTick()).toBe(true);
}
function until(game: Game, run: GameRunner, done: () => boolean) {
  for (let i = 0; i < 120 && !done(); i++) step(game, run);
  expect(done()).toBe(true);
}
async function world() {
  const game = await setup(
    MAP,
    { nationalMode: true, instantBuild: true },
    [A, B, C].map((id) => new PlayerInfo(id, PlayerType.Human, id, id)),
    undefined,
    MaritimeConfig,
  );
  const [a, b, c] = [A, B, C].map((id, i) => {
    const player = game.player(id);
    const tile = game.ref(1, 1 + i * 4);
    player.conquer(tile);
    player.setSpawnTile(tile);
    player.addGold(1_000_000_000n);
    return player;
  });
  const port = (owner: Player, y: number) => {
    const tile = game.ref(7, y);
    owner.conquer(tile);
    return owner.buildUnit(UnitType.Port, tile, {});
  };
  const own = port(a, 2);
  const enemy = port(b, 14);
  const home = port(c, 1);
  const start = game.ref(8, 2);
  const ship = a.buildUnit(UnitType.Warship, start, { patrolTile: start });
  game.addExecution(new WarshipExecution(ship));
  game.executeNextTick();
  return { game, a, b, c, own, enemy, home, ship, start };
}
function war(game: Game) {
  expect(
    game.performNationalWarCommandWithOutcome(game.player(A), {
      kind: "declare-national",
      warId: WAR,
      aggressorId: A,
      targetId: B,
    }).accepted,
  ).toBe(true);
}
function order(
  ship: Unit,
  port: Unit,
  requestId: string,
  clientID = A,
): StampedIntent {
  return {
    type: "national_blockade",
    clientID,
    shipId: ship.id(),
    portId: port.id(),
    portTile: port.tile(),
    warId: WAR,
    requestId,
  };
}
function sail(
  game: Game,
  run: GameRunner,
  owner: Player,
  home: Unit,
  dest: Unit,
) {
  const voyage = new TradeShipExecution(owner, home, dest);
  game.addExecution(voyage);
  step(game, run);
  step(game, run);
  return voyage;
}
function gold(game: Game) {
  return [A, B, C].map((id) => game.player(id).gold());
}

describe("C6 C2 E3 player-directed physical blockade", () => {
  it("compares a real commanded blockade against the same restored starting state", async () => {
    const { game, a, b, c, enemy, home, ship, start } = await world();
    war(game);
    const { restored: control, bytes, again } = await roundTrip(game, MAP);
    expect(again).toEqual(bytes);
    const run = runner(game);
    const controlRun = runner(control);
    const before = gold(game);
    expect(gold(control)).toEqual(before);
    step(game, run, [order(ship, enemy, "physical")]);
    step(game, run);
    const positions = new Set([start, ship.tile()]);
    until(game, run, () => {
      positions.add(ship.tile());
      return NationalBlockadeExecution.viewFor(game, a).some(
        (r) => r.phase === "active",
      );
    });
    expect(positions.size).toBeGreaterThan(1);
    expect(ship.tile()).not.toBe(start);
    const voyage = sail(game, run, c, home, enemy);
    const merchant = c.units(UnitType.TradeShip)[0];
    expect(merchant).toBeDefined();
    until(game, run, () => merchant.targetUnit() === home);
    const turning = merchant.tile();
    expect(turning).not.toBe(home.tile());
    expect(merchant.owner()).toBe(c);
    until(game, run, () => !voyage.isActive());
    expect(merchant.tile()).toBe(home.tile());
    expect(merchant.owner()).toBe(c);
    expect(gold(game)).toEqual(before);
    expect(a.piracyGold()).toBe(0n);
    expect(b.tradeGold()).toBe(0n);
    expect(c.tradeGold()).toBe(0n);
    const cp = control.player(C);
    const bp = control.player(B);
    const clean = sail(
      control,
      controlRun,
      cp,
      cp.units(UnitType.Port)[0],
      bp.units(UnitType.Port)[0],
    );
    until(control, controlRun, () => !clean.isActive());
    expect(cp.tradeGold()).toBeGreaterThan(0n);
    expect(bp.tradeGold()).toBe(cp.tradeGold());
    ship.delete(false);
    step(game, run);
    const fresh = sail(game, run, c, home, enemy);
    until(game, run, () => !fresh.isActive());
    expect(c.tradeGold()).toBeGreaterThan(0n);
    expect(b.tradeGold()).toBe(c.tradeGold());
    expect(gold(game)[2] - before[2]).toBe(c.tradeGold());
    const paid = gold(game);
    for (let i = 0; i < 8; i++) step(game, run);
    expect(gold(game)).toEqual(paid);
    console.info(
      "C6C2E3_BLOCKADE_WITNESS=" +
        JSON.stringify({
          hull: ship.id(),
          visited: [...positions],
          turning,
          returned: merchant.tile(),
          neutralOwner: merchant.owner().id(),
          failedTrade: "0",
          baselinePaid: cp.tradeGold().toString(),
          resumedPaid: c.tradeGold().toString(),
          before: before.map(String),
          after: paid.map(String),
        }),
    );
  });

  it("restores a live physical blockade and replays the neutral return without paying twice", async () => {
    const { game, a, c, enemy, home, ship } = await world();
    war(game);
    const run = runner(game);
    step(game, run, [order(ship, enemy, "restore-active")]);
    until(game, run, () =>
      NationalBlockadeExecution.viewFor(game, a).some(
        (r) => r.phase === "active",
      ),
    );
    const active = await roundTrip(game, MAP);
    const decoded = decodeSnapshotValue(active.bytes) as {
      execs: { t: string }[];
    };
    expect(decoded.execs.map((e) => e.t)).toContain("NationalBlockade");
    expect(diffSnapshots(active.bytes, active.again)).toEqual([]);
    expect(active.again).toEqual(active.bytes);
    const restored = active.restored;
    expect(
      NationalBlockadeExecution.viewFor(restored, restored.player(A)),
    ).toEqual(NationalBlockadeExecution.viewFor(game, a));
    const restoreRun = runner(restored);
    const before = gold(game);
    const voyage = sail(game, run, c, home, enemy);
    const second = sail(
      restored,
      restoreRun,
      restored.player(C),
      restored.player(C).units(UnitType.Port)[0],
      restored.player(B).units(UnitType.Port)[0],
    );
    for (let i = 0; i < 120 && (voyage.isActive() || second.isActive()); i++) {
      step(game, run);
      step(restored, restoreRun);
    }
    expect(voyage.isActive()).toBe(false);
    expect(second.isActive()).toBe(false);
    expect(gold(game)).toEqual(before);
    expect(gold(restored)).toEqual(before);
    const final = await roundTrip(game, MAP);
    const replay = await roundTrip(restored, MAP);
    expect(diffSnapshots(final.bytes, replay.bytes)).toEqual([]);
    expect(final.bytes).toEqual(replay.bytes);
    expect(final.again).toEqual(final.bytes);
    console.info("C6C2_ACTIVE_BLOCKADE_REPLAY_BYTES=" + final.bytes.length);
  });

  it("rejects peace, nonowner, false coordinates, duplicate orders and stale WAR", async () => {
    const { game, a, b, enemy, ship } = await world();
    const run = runner(game);
    step(game, run, [order(ship, enemy, "peace")]);
    expect(
      NationalBlockadeExecution.viewFor(game, a).some(
        (r) => r.phase !== "rejected",
      ),
    ).toBe(false);
    war(game);
    const falseOrder = {
      ...order(ship, enemy, "false-position"),
      portTile: game.ref(0, 0),
    };
    step(game, run, [
      order(ship, enemy, "nonowner", B),
      falseOrder,
      order(ship, enemy, "peace"),
    ]);
    expect(
      NationalBlockadeExecution.viewFor(game, b).every(
        (r) => r.phase === "rejected",
      ),
    ).toBe(true);
    expect(
      NationalBlockadeExecution.viewFor(game, a).every(
        (r) => r.phase === "rejected",
      ),
    ).toBe(true);
    const valid = order(ship, enemy, "valid");
    step(game, run, [valid, valid]);
    step(game, run);
    expect(
      NationalBlockadeExecution.viewFor(game, a).filter(
        (r) => r.requestId === "valid",
      ),
    ).toHaveLength(1);
    expect(
      game.performNationalWarCommandWithOutcome(a, {
        kind: "propose-peace",
        warId: WAR,
        motionId: "blockade-peace",
      }).accepted,
    ).toBe(true);
    expect(
      game.performNationalWarCommandWithOutcome(b, {
        kind: "accept-peace",
        motionId: "blockade-peace",
      }).accepted,
    ).toBe(true);
    step(game, run);
    expect(
      NationalBlockadeExecution.viewFor(game, a).find(
        (r) => r.requestId === "valid",
      )?.phase,
    ).toBe("ended");
    step(game, run, [order(ship, enemy, "stale")]);
    expect(
      NationalBlockadeExecution.viewFor(game, a).find(
        (r) => r.requestId === "stale",
      )?.phase,
    ).toBe("rejected");
  });
});
