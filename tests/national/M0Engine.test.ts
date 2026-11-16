import {
  Difficulty,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameSnapshot } from "@openfront/engine/game/GameImpl";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { roundTrip, restoreTestGame } from "../util/Snapshot";
import { setup } from "../util/Setup";

const names = [
  new PlayerInfo("North", PlayerType.Human, "north-client", "north-id"),
  new PlayerInfo("South", PlayerType.Human, "south-client", "south-id"),
];

function state(game: Game) {
  return readVersioned(GameSnapshot, snapshotGameData(game).game).national;
}

async function spawned(nationalMode: boolean) {
  const game = await setup("plains", { nationalMode }, names);
  game.addExecution(
    new SpawnExecution("national-m0", names[0], game.map().ref(30, 30)),
    new SpawnExecution("national-m0", names[1], game.map().ref(70, 70)),
  );
  game.executeNextTick(); // initialize the real spawn executions
  game.executeNextTick(); // spawn the two real players
  expect(game.player("north-id").hasSpawned()).toBe(true);
  expect(game.player("south-id").hasSpawned()).toBe(true);
  return game;
}

describe("Stage 3 M0: authoritative NATIONAL vertical slice", () => {
  it("requires unranked Solo FFA and preserves absent/false legacy mode", async () => {
    const legacy = await setup("plains");
    const config = legacy.config().gameConfig();
    expect(config.nationalMode).toBeUndefined();
    expect(legacy.nationalWinner()).toBeNull();
    expect(state(legacy)).toBeNull();
    const valid = { ...config, nationalMode: true };
    expect(GameConfigSchema.parse(valid).nationalMode).toBe(true);
    expect(() => new EngineConfig(valid, false)).not.toThrow();
    for (const patch of [
      { gameType: GameType.Public },
      { gameType: GameType.Private },
      { gameMode: GameMode.Team },
      { tutorial: true },
    ]) {
      expect(
        () => new EngineConfig({ ...valid, ...patch }, false),
      ).toThrow(/Solo Free For All/);
    }
    const ranked = {
      ...valid,
      rankedType: "ffa" as GameConfig["rankedType"],
    };
    expect(() => new EngineConfig(ranked, false)).toThrow(
      /Solo Free For All/,
    );
    expect(new EngineConfig({ ...config, nationalMode: false }, false)
      .nationalMode()).toBe(false);
    expect(config.difficulty).toBe(Difficulty.Medium);
  });

  it("binds independent nations to actual live PlayerIDs and simulation ticks", async () => {
    const game = await spawned(true);
    const current = state(game);
    expect(current?.version).toBe(1);
    expect(current?.politics.nations.map((n) => n.id)).toEqual([
      "north-id",
      "south-id",
    ]);
    expect(current?.politics.nations.every((n) => n.alive)).toBe(true);
    expect(current?.politics.nations[0].metrics.land).toBeGreaterThan(0);
    expect(current?.lastTick).toBeLessThanOrEqual(game.ticks());
    expect(game.nationalWinner()).toBeNull();
  });

  it("runs a clientID-authenticated founding command in the real game loop", async () => {
    const game = await spawned(true);
    const executor = new Executor(game, "national-m0", undefined);
    game.addExecution(
      executor.createExec({
        type: "national_found_empire",
        empireId: "north-empire",
        clientID: "north-client",
      }),
    );
    game.executeNextTick(); // initialize
    game.executeNextTick(); // execute
    const current = state(game);
    expect(current?.politics.empires).toHaveLength(1);
    expect(current?.politics.empires[0]).toMatchObject({
      id: "north-empire",
      leaderId: "north-id",
      memberIds: ["north-id"],
    });
    // An invalid stamp is never resolved to an actor and cannot create state.
    game.addExecution(
      executor.createExec({
        type: "national_found_empire",
        empireId: "stolen",
        clientID: "foreign-client",
      }),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(state(game)?.politics.empires).toHaveLength(1);
  });

  it("rejects forged players, pre-spawn commands, duplicate empires, and legacy actions", async () => {
    const beforeSpawn = await setup("plains", { nationalMode: true }, names);
    expect(() => beforeSpawn.performNationalCommand(beforeSpawn.player("north-id"), {
      kind: "found-empire", empireId: "pre-spawn",
    })).toThrow();
    const national = await spawned(true);
    const outsider = await spawned(true);
    expect(() => national.performNationalCommand(outsider.player("north-id"), {
      kind: "found-empire", empireId: "stolen",
    })).toThrow();
    expect(() => national.performNationalCommand(national.player("north-id"), {
      kind: "found-empire", empireId: "invalid empire name",
    })).toThrow();
    expect(state(national)?.politics.empires).toHaveLength(0);
    national.performNationalCommand(national.player("north-id"), {
      kind: "found-empire", empireId: "national-1",
    });
    expect(() => national.performNationalCommand(national.player("north-id"), {
      kind: "found-empire", empireId: "national-1",
    })).toThrow();
    expect(state(national)?.politics.empires).toHaveLength(1);
    const legacy = await spawned(false);
    expect(() => legacy.performNationalCommand(legacy.player("north-id"), {
      kind: "found-empire", empireId: "forbidden",
    })).toThrow(/not enabled/);
  });

  it("restores politics through a version-2 GameSnapshot with exact bytes", async () => {
    const game = await spawned(true);
    game.performNationalCommand(game.player("north-id"), {
      kind: "found-empire",
      empireId: "first-empire",
    });
    const { bytes, restored, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(state(restored)?.politics.empires).toHaveLength(1);
    expect(state(restored)?.politics.empires[0].leaderId).toBe("north-id");
    game.executeNextTick();
    restored.executeNextTick();
    expect(state(restored)).toEqual(state(game));
  });

  it("migrates legacy version-1 game snapshots with NATIONAL absent", async () => {
    const legacy = await spawned(false);
    const old = readVersioned(GameSnapshot, snapshotGameData(legacy).game);
    const { national: _national, ...v1 } = old;
    expect(readVersioned(GameSnapshot, { v: 1, d: v1 }).national).toBeNull();
    const { bytes } = await roundTrip(legacy, "plains");
    const restored = await restoreTestGame(bytes, "plains");
    expect(restored.nationalWinner()).toBeNull();
  });

  it("SOV-07: engine victory ignores unclaimed territory in NATIONAL, not legacy", async () => {
    const national = await spawned(true);
    const legacy = await spawned(false);
    for (const game of [national, legacy]) {
      const south = game.player("south-id");
      for (const tile of [...south.tiles()]) south.relinquish(tile);
      game.executeNextTick();
      const check = new WinCheckExecution();
      check.init(game, game.ticks());
      check.checkWinnerFFA();
    }
    const winner = national.getWinner();
    expect(typeof winner === "string" ? winner : winner?.id()).toBe("north-id");
    expect(legacy.getWinner()).toBeNull();
  });
});
