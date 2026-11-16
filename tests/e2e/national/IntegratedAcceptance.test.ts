import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { setup } from "../../util/Setup";
import { roundTrip } from "../../util/Snapshot";

const north = new PlayerInfo(
  "QA North",
  PlayerType.Human,
  "qa-north-client",
  "qa-north",
);
const south = new PlayerInfo(
  "QA South",
  PlayerType.Human,
  "qa-south-client",
  "qa-south",
);

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function step(runner: GameRunner): void {
  runner.addTurn({ turnNumber: runner.game.ticks(), intents: [] });
  expect(runner.executeNextTick()).toBe(true);
}

async function fixture(nationalMode: boolean, seed: string) {
  const game = await setup("plains", { nationalMode }, [north, south]);
  const packets: GameUpdateViewData[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, seed, north.clientID!),
    (packet) => {
      if ("updates" in packet) packets.push(packet);
    },
    north.clientID!,
  );
  runner.init();
  game.addExecution(
    new SpawnExecution(seed, north, game.ref(30, 30)),
    new SpawnExecution(seed, south, game.ref(70, 70)),
  );
  step(runner);
  step(runner);
  expect(game.player(north.id).hasSpawned()).toBe(true);
  expect(game.player(south.id).hasSpawned()).toBe(true);
  return { game, runner, packets };
}

function settle(game: Game): string | null {
  const check = new WinCheckExecution();
  check.init(game, game.ticks());
  check.checkWinnerFFA();
  const winner = game.getWinner();
  return winner === null
    ? null
    : typeof winner === "string"
      ? winner
      : winner.id();
}

describe("NATIONAL independently integrated acceptance (actual Game + GameRunner)", () => {
  it("M0: NATIONAL is explicit Solo opt-in; legacy FFA does not construct politics", async () => {
    const { game: legacy } = await fixture(false, "qa-mode-legacy");
    expect(legacy.nationalPoliticalAuthority()).toBeNull();
    expect(legacy.nationalVictoryRoster()).toBeNull();
    expect(legacy.config().gameConfig().nationalMode).toBe(false);
    const { game } = await fixture(true, "qa-mode-national");
    expect(game.config().gameConfig().gameType).toBe(GameType.Singleplayer);
    expect(game.config().gameConfig().gameMode).toBe(GameMode.FFA);
    expect(game.nationalPoliticalAuthority()).not.toBeNull();
    expect(game.nationalPoliticalAuthority()?.alive(north.id)).toBe(true);
    expect(
      () =>
        new EngineConfig(
          { ...game.config().gameConfig(), gameMode: GameMode.Team },
          false,
        ),
    ).toThrow(/Solo Free For All/);
    expect(
      () =>
        new EngineConfig(
          { ...game.config().gameConfig(), gameType: GameType.Public },
          false,
        ),
    ).toThrow(/Solo Free For All/);
  });

  it.each(["qa-seed-alpha", "qa-seed-bravo"])(
    "M1/M2: %s authenticated founding, exact snapshot/restore, replay hashes and sovereign result",
    async (seed) => {
      const { game, runner, packets } = await fixture(true, seed);
      expect(runner.isNationalIntentAuthorized(north.clientID!)).toBe(true);
      expect(runner.isNationalIntentAuthorized(south.clientID!)).toBe(false);

      const empireId = seed + "-empire";
      runner.addTurn({
        turnNumber: game.ticks(),
        intents: [
          {
            type: "national_found_empire",
            empireId,
            clientID: north.clientID!,
          },
        ],
      });
      expect(runner.executeNextTick()).toBe(true);
      step(runner); // the real queued execution runs on the following tick
      const authority = game.nationalPoliticalAuthority();
      expect(authority?.emperorOf(empireId)).toBe(north.id);
      expect(authority?.membersOf(empireId)).toEqual([north.id]);
      expect(packets.length).toBeGreaterThanOrEqual(4);
      expect(packets.every((p) => p.tick > 0)).toBe(true);

      const before = snapshotGame(game);
      const checkpoint = await roundTrip(game, "plains");
      expect(checkpoint.again).toEqual(checkpoint.bytes);
      expect(checkpoint.bytes).toEqual(before);
      expect(
        checkpoint.restored.nationalPoliticalAuthority()?.emperorOf(empireId),
      ).toBe(north.id);

      const restored = checkpoint.restored;
      const replay = new GameRunner(
        restored,
        new Executor(restored, seed, north.clientID!),
        () => {},
        north.clientID!,
      );
      const hashes: string[] = [];
      for (let tick = 0; tick < 8; tick++) {
        step(runner);
        step(replay);
        const a = sha(snapshotGame(game));
        const b = sha(snapshotGame(restored));
        expect(b).toBe(a);
        hashes.push(a);
      }
      expect(new Set(hashes).size).toBeGreaterThan(1);

      // Same authoritative territory mutation in both continuations.
      for (const current of [game, restored]) {
        for (const tile of [...current.player(south.id).tiles()]) {
          current.player(south.id).relinquish(tile);
        }
      }
      step(runner);
      step(replay);
      expect(sha(snapshotGame(restored))).toBe(sha(snapshotGame(game)));
      expect(game.nationalVictoryRoster()?.prizes).toEqual([
        { kind: "ImperialVictor", nationId: north.id, empireId },
      ]);
      expect(settle(game)).toBe(north.id);
      expect(settle(restored)).toBe(north.id);
      expect(sha(snapshotGame(restored))).toBe(sha(snapshotGame(game)));
      console.info(
        JSON.stringify({
          qa: "national-replay",
          seed,
          checkpointSHA256: sha(before),
          finalSHA256: sha(snapshotGame(game)),
          replayTicks: hashes.length,
          victory: north.id,
        }),
      );
    },
  );

  it("M1 fraud canaries: invalid, unauthenticated, pre-spawn and duplicate political actions do not mint assets", async () => {
    const unspawned = await setup("plains", { nationalMode: true }, [
      north,
      south,
    ]);
    expect(() =>
      unspawned.performNationalCommand(unspawned.player(north.id), {
        kind: "found-empire",
        empireId: "forbidden",
      }),
    ).toThrow();
    const { game, runner } = await fixture(true, "qa-fraud");
    // A rejected command may synchronize derived metrics before validation.
    // Snapshot after canonical synchronization to detect illegal mutations only.
    game.nationalVictoryRoster();
    const originalBytes = snapshotGame(game);
    expect(() =>
      game.performNationalCommand(game.player(north.id), {
        kind: "found-empire",
        empireId: "illegal spaces",
      }),
    ).toThrow();
    expect(snapshotGame(game)).toEqual(originalBytes);

    // A nonexistent clientID must resolve to NoOp, never an acting principal.
    runner.addTurn({
      turnNumber: game.ticks(),
      intents: [
        {
          type: "national_found_empire",
          empireId: "forged-empire",
          clientID: "not-a-real-client",
        },
      ],
    });
    expect(runner.executeNextTick()).toBe(true);
    step(runner);
    expect(
      game.nationalPoliticalAuthority()?.empireExists("forged-empire"),
    ).toBe(false);

    game.performNationalCommand(game.player(north.id), {
      kind: "found-empire",
      empireId: "legitimate-empire",
    });
    const count = game
      .nationalPoliticalAuthority()
      ?.membersOf("legitimate-empire");
    const gold = game.player(north.id).gold();
    const troops = game.player(north.id).troops();
    const tiles = game.player(north.id).numTilesOwned();
    const after = snapshotGame(game);
    expect(() =>
      game.performNationalCommand(game.player(north.id), {
        kind: "found-empire",
        empireId: "legitimate-empire",
      }),
    ).toThrow();
    expect(snapshotGame(game)).toEqual(after);
    expect(
      game.nationalPoliticalAuthority()?.membersOf("legitimate-empire"),
    ).toEqual(count);
    expect(game.player(north.id).gold()).toBe(gold);
    expect(game.player(north.id).troops()).toBe(troops);
    expect(game.player(north.id).numTilesOwned()).toBe(tiles);
    expect(runner.isNationalIntentAuthorized(south.clientID!)).toBe(false);
    expect(runner.isNationalRequesterAuthorized(south.id)).toBe(false);
    expect(runner.isNationalRequesterAuthorized("invented-player")).toBe(false);
  });

  it("LEGACY: a remaining player with most of the map unclaimed is not awarded NATIONAL victory", async () => {
    const { game, runner } = await fixture(false, "qa-legacy");
    for (const tile of [...game.player(south.id).tiles()]) {
      game.player(south.id).relinquish(tile);
    }
    step(runner);
    expect(game.nationalPoliticalAuthority()).toBeNull();
    expect(game.nationalVictoryRoster()).toBeNull();
    expect(settle(game)).toBeNull();
    expect(() =>
      game.performNationalCommand(game.player(north.id), {
        kind: "found-empire",
        empireId: "legacy-illegal",
      }),
    ).toThrow(/not enabled/);
  });
});
