import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  StampedIntentSchema,
  type StampedIntent,
} from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationalBlockadeExecution } from "@openfront/engine/execution/NationalBlockadeExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { describe, expect, it } from "vitest";
import { createGame, L, W } from "../core/pathfinding/_fixtures";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const MAP = "half_land_half_ocean";
const MATCH = "c7-naval";
const [A, B, C] = ["c7naval01", "c7naval02", "c7naval03"];
const EMPIRE = "c7-imperium";
const WAR = "c7-imperial-war";

function runner(game: Game) {
  return new GameRunner(game, new Executor(game, MATCH, A), () => {}, A);
}

function step(game: Game, run: GameRunner, intents: StampedIntent[] = []) {
  run.addTurn({ turnNumber: game.ticks(), intents });
  expect(run.executeNextTick()).toBe(true);
}

function submit(game: Game, run: GameRunner, intents: StampedIntent[]) {
  step(game, run, intents);
  step(game, run);
}

function until(game: Game, run: GameRunner, done: () => boolean) {
  for (let i = 0; i < 150 && !done(); i++) step(game, run);
  expect(done()).toBe(true);
}

function epoch(game: Game, id = A) {
  return game.nationalPoliticalAuthority()!.warPolicyVersionFor(id)!;
}

function move(game: Game, hull: number, tile: number, requestId: string) {
  return StampedIntentSchema.parse({
    type: "national_imperial_administration",
    clientID: A,
    requestId,
    command: {
      kind: "imperial-move-warship",
      gameId: MATCH,
      empireId: EMPIRE,
      expectedVersion: epoch(game),
      memberId: B,
      unitId: hull,
      tile,
    },
  });
}

function expedition(
  game: Game,
  amount: number,
  requestId: string,
  tile = game.ref(7, 14),
) {
  return StampedIntentSchema.parse({
    type: "national_imperial_administration",
    clientID: A,
    requestId,
    command: {
      kind: "imperial-transport",
      gameId: MATCH,
      empireId: EMPIRE,
      expectedVersion: epoch(game),
      memberId: B,
      targetId: C,
      tile,
      amount,
    },
  });
}

function pool(game: Game, crown = A) {
  return BigInt(
    game.nationalImperialAdministrationFor(game.player(crown))!.imperialTroops,
  );
}

function account(game: Game, crown: string | null) {
  const members = [game.player(A), game.player(B)];
  return (
    (crown === null ? 0n : pool(game, crown)) +
    members.reduce(
      (total, member) =>
        total +
        BigInt(member.troops()) +
        BigInt(game.nationalDeferredTroopsFor(member) ?? "0") +
        member
          .units(UnitType.TransportShip)
          .reduce((sum, boat) => sum + BigInt(boat.troops()), 0n) +
        member
          .outgoingAttacks()
          .reduce((sum, attack) => sum + BigInt(attack.troops()), 0n),
      0n,
    )
  );
}

async function world() {
  const game = await setup(
    MAP,
    { nationalMode: true, instantBuild: true },
    [A, B, C].map((id) => new PlayerInfo(id, PlayerType.Human, id, id)),
  );
  const [a, b, c] = [A, B, C].map((id, i) => {
    const player = game.player(id);
    const tile = game.ref(7, 2 + i * 6);
    player.conquer(tile);
    player.conquer(game.ref(6, 2 + i * 6));
    player.setSpawnTile(tile);
    player.addGold(1_000_000_000n);
    player.buildUnit(UnitType.Port, tile, {});
    return player;
  });
  for (let y = 12; y <= 15; y++) {
    c.conquer(game.ref(7, y));
    c.conquer(game.ref(6, y));
  }
  a.setTroops(400);
  b.setTroops(900);
  c.setTroops(20);
  game.executeNextTick();
  game.performNationalCommand(a, { kind: "found-empire", empireId: EMPIRE });
  game.performNationalCommand(a, {
    kind: "offer-empire",
    empireId: EMPIRE,
    candidateId: B,
  });
  game.performNationalCommand(b, {
    kind: "accept-empire",
    empireId: EMPIRE,
    candidateId: B,
  });
  game.performNationalImperialAdministration(a, {
    kind: "set-army-mode",
    empireId: EMPIRE,
    mode: "centralized",
    thresholdBps: 0,
  });
  expect(pool(game)).toBe(1300n);
  return { game, a, b, c };
}

function declare(game: Game) {
  game.performNationalWarCommand(game.player(A), {
    kind: "declare-imperial",
    warId: WAR,
    aggressor: { kind: "empire", id: EMPIRE },
    target: { kind: "nation", id: C },
  });
  expect(game.nationalWarAuthority()!.authorizeOffensiveAction(B, C)).toBe(
    true,
  );
}

function transfer(game: Game) {
  game.performNationalCommand(game.player(A), {
    kind: "transfer-crown",
    empireId: EMPIRE,
    successorId: B,
  });
}

function peace(game: Game, crown: string) {
  game.performNationalWarCommand(game.player(crown), {
    kind: "propose-peace",
    warId: WAR,
    motionId: "c7-naval-peace",
  });
  game.performNationalWarCommand(game.player(C), {
    kind: "accept-peace",
    motionId: "c7-naval-peace",
  });
  expect(game.nationalWarAuthority()!.authorizeOffensiveAction(B, C)).toBe(
    false,
  );
}

describe("C7C1E3 A: real constituent hull authority", () => {
  it("moves an existing member hull, denies outsiders and stale crowns, and preserves actual ownership", async () => {
    const { game, a, b, c } = await world();
    const start = game.ref(8, 8);
    const destination = game.ref(12, 12);
    const ship = b.buildUnit(UnitType.Warship, start, { patrolTile: start });
    game.addExecution(new WarshipExecution(ship));
    const foreign = c.buildUnit(UnitType.Warship, game.ref(8, 14), {
      patrolTile: game.ref(8, 14),
    });
    const run = runner(game);
    submit(game, run, [
      {
        type: "move_warship",
        clientID: B,
        unitIds: [ship.id()],
        tile: destination,
      },
      { ...move(game, ship.id(), destination, "member"), clientID: B },
      { ...move(game, ship.id(), destination, "outsider"), clientID: C },
      move(game, foreign.id(), destination, "forged-hull"),
    ]);
    expect(ship.warshipState().patrolTile).toBe(start);
    const valid = move(game, ship.id(), destination, "crown-move");
    submit(game, run, [valid, valid]);
    expect(ship.warshipState().patrolTile).toBe(destination);
    expect(ship.owner()).toBe(b);
    expect(a.units(UnitType.Warship)).toHaveLength(0);
    expect(b.units(UnitType.Warship)).toHaveLength(1);
    expect(
      game
        .nationalPoliticalCommandResults(a)
        .filter((row) => row.requestId === "crown-move" && row.accepted),
    ).toHaveLength(1);
    const visited = new Set([ship.tile()]);
    for (let i = 0; i < 20; i++) {
      step(game, run);
      visited.add(ship.tile());
    }
    expect(visited.size).toBeGreaterThan(1);
    const stale = move(game, ship.id(), start, "stale-crown");
    const oldEpoch = epoch(game);
    transfer(game);
    expect(epoch(game, B)).toBeGreaterThan(oldEpoch);
    submit(game, run, [stale, { ...stale, clientID: B }]);
    expect(ship.warshipState().patrolTile).toBe(destination);
    const current = move(game, ship.id(), start, "successor-move");
    submit(game, run, [{ ...current, clientID: B }]);
    expect(ship.warshipState().patrolTile).toBe(start);
    expect(ship.owner()).toBe(b);
    console.info("C7C1E3_HULL_WITNESS", {
      hull: ship.id(),
      visited: [...visited],
      oldEpoch,
      currentEpoch: epoch(game, B),
    });
  });

  it("uses the existing hull's real combat path only during lawful WAR", async () => {
    const { game, b, c } = await world();
    const start = game.ref(8, 8);
    const ship = b.buildUnit(UnitType.Warship, start, { patrolTile: start });
    game.addExecution(new WarshipExecution(ship));
    const enemy = c.buildUnit(UnitType.TransportShip, game.ref(9, 8), {
      troops: 10,
      targetTile: game.ref(7, 8),
    });
    const run = runner(game);
    submit(game, run, [move(game, ship.id(), start, "peace-patrol")]);
    for (let i = 0; i < 8; i++) step(game, run);
    expect(enemy.isActive()).toBe(true);
    declare(game);
    submit(game, run, [move(game, ship.id(), enemy.tile(), "war-patrol")]);
    until(game, run, () => !enemy.isActive());
    expect(ship.owner()).toBe(b);
    expect(b.units(UnitType.Warship)).toHaveLength(1);
  });
});

describe("C7C1E3 B: pooled amphibious expedition", () => {
  it("debits only the real imperial pool, rejects unauthorized launches, and lands an actual force", async () => {
    const { game, a, b, c } = await world();
    const run = runner(game);
    submit(game, run, [expedition(game, 200, "peace-launch")]);
    expect(pool(game)).toBe(1300n);
    expect(b.units(UnitType.TransportShip)).toHaveLength(0);
    declare(game);
    submit(game, run, [
      { ...expedition(game, 200, "subordinate-launch"), clientID: B },
      { ...expedition(game, 200, "outsider-launch"), clientID: C },
      expedition(game, 1301, "overdraw"),
    ]);
    expect(pool(game)).toBe(1300n);
    const targetTiles = c.numTilesOwned();
    const launch = expedition(game, 200, "pooled-launch");
    submit(game, run, [launch, launch]);
    expect(pool(game)).toBe(1100n);
    expect([a.troops(), b.troops()]).toEqual([0, 0]);
    const boats = b.units(UnitType.TransportShip);
    expect(boats).toHaveLength(1);
    expect(boats[0].troops()).toBe(200);
    expect(account(game, A)).toBe(1300n);
    console.info("C7C1E3_EMBARK_WITNESS", {
      before: 1300,
      pool: 1100,
      aboard: boats[0].troops(),
      personal: b.troops(),
    });
    until(game, run, () => !boats[0].isActive());
    expect(c.numTilesOwned()).toBeLessThan(targetTiles);
    expect(b.units(UnitType.TransportShip)).toHaveLength(0);
    expect(account(game, A)).toBe(1300n);
    expect(b.outgoingAttacks().map((attack) => attack.troops())).toEqual([200]);
    console.info("C7C1E3_LANDING_WITNESS", {
      reserve: pool(game).toString(),
      landed: b.outgoingAttacks()[0].troops(),
      total: account(game, A).toString(),
    });
  });

  it("preserves exact embarkation accounting across snapshot, succession and peace return", async () => {
    const { game, b } = await world();
    declare(game);
    const run = runner(game);
    const stale = expedition(game, 100, "old-crown");
    submit(game, run, [expedition(game, 200, "active-voyage")]);
    expect(b.units(UnitType.TransportShip)).toHaveLength(1);
    expect(account(game, A)).toBe(1300n);
    const active = await roundTrip(game, MAP);
    expect(active.again).toEqual(active.bytes);
    for (const current of [game, active.restored]) {
      const currentRun = runner(current);
      transfer(current);
      expect(account(current, B)).toBe(1300n);
      submit(current, currentRun, [stale]);
      expect(current.player(B).units(UnitType.TransportShip)).toHaveLength(1);
      peace(current, B);
      until(
        current,
        currentRun,
        () => current.player(B).units(UnitType.TransportShip).length === 0,
      );
      expect(account(current, B)).toBe(1300n);
    }
    const original = await roundTrip(game, MAP);
    const replay = await roundTrip(active.restored, MAP);
    expect(original.bytes).toEqual(replay.bytes);
    console.info("C7C1E3_PEACE_WITNESS", {
      before: 1300,
      pool: pool(game, B).toString(),
      total: account(game, B).toString(),
    });
  });

  it("does not duplicate an active expedition when the empire dissolves", async () => {
    const { game, a, b } = await world();
    declare(game);
    const run = runner(game);
    submit(game, run, [expedition(game, 200, "dissolve-voyage")]);
    expect(b.units(UnitType.TransportShip)).toHaveLength(1);
    game.performNationalImperialAdministration(a, {
      kind: "dissolve",
      empireId: EMPIRE,
    });
    expect(game.nationalPoliticalAuthority()!.empireOf(B)).toBeNull();
    expect(account(game, null)).toBe(1300n);
    until(game, run, () => b.units(UnitType.TransportShip).length === 0);
    expect(account(game, null)).toBe(1300n);
  });
});

describe("C7C1E3 independent route and session negatives", () => {
  it("rejects both real crown orders across disconnected seas without changing reserve or hull", () => {
    const width = 40;
    const height = 18;
    const game = createGame(
      {
        width,
        height,
        grid: Array.from({ length: width * height }, (_, i) => {
          const x = i % width;
          return x < 4 || x >= width - 4 || (x >= 18 && x <= 23) ? L : W;
        }),
      },
      { nationalMode: true, instantBuild: true },
    );
    for (const id of [A, B, C])
      game.addPlayer(new PlayerInfo(id, PlayerType.Human, id, id));
    game.endSpawnPhase();
    const [a, b, c] = [A, B, C].map((id) => game.player(id));
    for (const [player, tile] of [
      [a, game.ref(3, 2)],
      [b, game.ref(3, 8)],
      [c, game.ref(width - 4, 8)],
    ] as const) {
      player.conquer(tile);
      player.setSpawnTile(tile);
      player.addGold(1_000_000_000n);
      player.buildUnit(UnitType.Port, tile, {});
    }
    a.setTroops(400);
    b.setTroops(900);
    game.performNationalCommand(a, { kind: "found-empire", empireId: EMPIRE });
    game.performNationalCommand(a, {
      kind: "offer-empire",
      empireId: EMPIRE,
      candidateId: B,
    });
    game.performNationalCommand(b, {
      kind: "accept-empire",
      empireId: EMPIRE,
      candidateId: B,
    });
    game.performNationalImperialAdministration(a, {
      kind: "set-army-mode",
      empireId: EMPIRE,
      mode: "centralized",
      thresholdBps: 0,
    });
    declare(game);
    const start = game.ref(4, 8);
    const isolatedWater = game.ref(width - 5, 8);
    const ship = b.buildUnit(UnitType.Warship, start, { patrolTile: start });
    expect(game.getWaterComponent(start)).not.toBe(
      game.getWaterComponent(isolatedWater),
    );
    const run = runner(game);
    const otherGame = move(game, ship.id(), game.ref(5, 8), "other-game");
    if (
      otherGame.type !== "national_imperial_administration" ||
      otherGame.command.kind !== "imperial-move-warship"
    )
      throw Error("wrong intent");
    submit(game, run, [
      move(game, ship.id(), isolatedWater, "disconnected-hull"),
      expedition(game, 200, "disconnected-transport", game.ref(width - 4, 8)),
      {
        ...otherGame,
        command: { ...otherGame.command, gameId: "wrong-match" },
      },
    ]);
    expect(ship.warshipState().patrolTile).toBe(start);
    expect(b.units(UnitType.TransportShip)).toHaveLength(0);
    expect(account(game, A)).toBe(1300n);
    expect(pool(game)).toBe(1300n);
    expect(game.nationalPoliticalCommandResults(a)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: "disconnected-hull",
          accepted: false,
        }),
        expect.objectContaining({
          requestId: "disconnected-transport",
          accepted: false,
        }),
      ]),
    );
  });
});

describe("C7C1E3 existing blockade debt: hostile negative regressions", () => {
  for (const hidden of [true, false]) {
    it(
      hidden
        ? "rejects a real hidden port even in the same sea"
        : "rejects a visible port in disconnected water",
      () => {
        const width = hidden ? 520 : 40;
        const height = 18;
        const game = createGame(
          {
            width,
            height,
            grid: Array.from({ length: width * height }, (_, i) => {
              const x = i % width;
              return x < 4 || x >= width - 4 || (!hidden && x >= 18 && x <= 23)
                ? L
                : W;
            }),
          },
          { nationalMode: true, instantBuild: true },
        );
        for (const id of [A, C])
          game.addPlayer(new PlayerInfo(id, PlayerType.Human, id, id));
        game.endSpawnPhase();
        const a = game.player(A);
        const c = game.player(C);
        const left = game.ref(3, 8);
        const right = game.ref(width - 4, 8);
        for (const [player, tile] of [
          [a, left],
          [c, right],
        ] as const) {
          player.conquer(tile);
          player.setSpawnTile(tile);
          player.addGold(1_000_000_000n);
        }
        a.buildUnit(UnitType.Port, left, {});
        const port = c.buildUnit(UnitType.Port, right, {});
        const start = game.ref(4, 8);
        const ship = a.buildUnit(UnitType.Warship, start, {
          patrolTile: start,
        });
        game.performNationalWarCommand(a, {
          kind: "declare-national",
          warId: WAR,
          aggressorId: A,
          targetId: C,
        });
        expect(
          collectLiveNationalObservation(
            game,
            A,
          ).observation.visibleAssets.some(
            (asset) => asset.id === String(port.id()),
          ),
        ).toBe(!hidden);
        expect(
          game.hasWaterComponent(port.tile(), game.getWaterComponent(start)!),
        ).toBe(hidden);
        const run = runner(game);
        step(game, run, [
          {
            type: "national_blockade",
            clientID: A,
            warId: WAR,
            shipId: ship.id(),
            portId: port.id(),
            portTile: port.tile(),
            requestId: "hostile-negative",
          },
        ]);
        expect(NationalBlockadeExecution.viewFor(game, a)).toContainEqual(
          expect.objectContaining({
            requestId: "hostile-negative",
            phase: "rejected",
          }),
        );
        expect(ship.warshipState().patrolTile).toBe(start);
      },
    );
  }
});

describe("C7 integrated imperial authority lifecycle", () => {
  it("revokes a queued naval order across military-mode changes and never reuses dissolved identity", async () => {
    const { game, a, b } = await world();
    const start = game.ref(8, 8);
    const destination = game.ref(12, 12);
    const ship = b.buildUnit(UnitType.Warship, start, { patrolTile: start });
    const stale = move(game, ship.id(), destination, "stale-mode");
    const previous = epoch(game);
    game.performNationalImperialAdministration(a, {
      kind: "set-army-mode",
      empireId: EMPIRE,
      mode: "decentralized",
      thresholdBps: 0,
    });
    game.performNationalImperialAdministration(a, {
      kind: "set-army-mode",
      empireId: EMPIRE,
      mode: "centralized",
      thresholdBps: 0,
    });
    expect(epoch(game)).toBe(previous + 1);
    const run = runner(game);
    submit(game, run, [stale]);
    expect(ship.warshipState().patrolTile).toBe(start);
    expect(game.nationalPoliticalCommandResults(a)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requestId: "stale-mode", accepted: false }),
      ]),
    );
    game.performNationalImperialAdministration(a, {
      kind: "dissolve",
      empireId: EMPIRE,
    });
    expect(() =>
      game.performNationalCommand(a, {
        kind: "found-empire",
        empireId: EMPIRE,
      }),
    ).toThrow(/empire id already used/);
    const { restored } = await roundTrip(game, MAP);
    expect(() =>
      restored.performNationalCommand(restored.player(A), {
        kind: "found-empire",
        empireId: EMPIRE,
      }),
    ).toThrow(/empire id already used/);
  });
});
