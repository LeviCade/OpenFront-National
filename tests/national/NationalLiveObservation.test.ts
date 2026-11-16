import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  type GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { unpackUnitUpdates } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { GameRunner } from "@openfront/engine/GameRunner";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { roundTrip } from "../util/Snapshot";
import { setup } from "../util/Setup";

const viewer = new PlayerInfo("Viewer", PlayerType.Human, "viewer-client", "viewer-id");
const secret = new PlayerInfo("Hidden Enemy", PlayerType.Nation, null, "secret-id");

async function activeGame(nationalMode: boolean) {
  const game = await setup("plains", { nationalMode }, [viewer, secret]);
  const near = game.ref(10, 10);
  const far = game.ref(80, 80);
  game.addExecution(
    new SpawnExecution("live-fog-test", viewer, near),
    new SpawnExecution("live-fog-test", secret, far),
  );
  game.executeNextTick();
  game.executeNextTick();
  expect(game.player(viewer.id).hasSpawned()).toBe(true);
  expect(game.player(secret.id).hasSpawned()).toBe(true);
  return game;
}

function runPacket(
  game: Awaited<ReturnType<typeof activeGame>>,
  clientID: string | undefined,
): GameUpdateViewData {
  let emitted: GameUpdateViewData | null = null;
  const runner = new GameRunner(
    game,
    new Executor(game, "live-fog-test", clientID),
    (packet) => {
      if ("updates" in packet) emitted = packet;
    },
    clientID,
  );
  game.queueViewResync();
  runner.addTurn({ turnNumber: game.ticks(), intents: [] });
  expect(runner.executeNextTick()).toBe(true);
  if (emitted === null) throw new Error("No running-game packet");
  return emitted;
}

function numericData(packet: GameUpdateViewData): number[] {
  return [
    ...packet.packedTileUpdates,
    ...(packet.packedPlayerUpdates ?? []),
    ...(packet.packedAttackUpdates ?? []),
    ...(packet.packedUnitUpdates ?? []),
    ...(packet.packedMotionPlans ?? []),
  ];
}

describe("REAL NATIONAL NationExecution and GameRunner observation boundary", () => {
  it("FOG-01/03/07 hides far enemy troop and transport canaries in live packed output and resync", async () => {
    const game = await activeGame(true);
    const foe = game.player(secret.id);
    const hiddenTile = game.ref(80, 80);
    const secretTroops = 8_765_432;
    foe.setTroops(secretTroops);
    const ship = foe.buildUnit(UnitType.TransportShip, hiddenTile, {
      troops: 4_567_891,
      targetTile: game.ref(11, 11),
    });
    const shipId = ship.id();
    const first = runPacket(game, viewer.clientID!);

    expect(first.packedAttackUpdates).toBeUndefined();
    expect(first.packedMotionPlans).toBeUndefined();
    expect(numericData(first)).not.toContain(secretTroops);
    expect(unpackUnitUpdates(
      first.packedUnitUpdates, first.packedMissileTimers,
    ).some((unit) => unit.id === shipId)).toBe(false);
    const foreign = first.updates[GameUpdateType.Player].find(
      (p) => p.id === secret.id,
    );
    if (foreign) {
      expect("gold" in foreign).toBe(false);
      expect("troops" in foreign).toBe(false);
      expect("incomingAttacks" in foreign).toBe(false);
      expect("spawnTile" in foreign).toBe(false);
    }
    expect(
      Array.from(first.packedTileUpdates).filter(
        (_, i) => i % 2 === 0,
      ),
    ).not.toContain(hiddenTile);

    // A second fresh resync must not recover the hidden exact values.
    const again = runPacket(game, viewer.clientID!);
    expect(numericData(again)).not.toContain(secretTroops);
    expect(unpackUnitUpdates(
      again.packedUnitUpdates, again.packedMissileTimers,
    ).some((unit) => unit.id === shipId)).toBe(false);
    const unknown = runPacket(game, undefined);
    expect(unknown.packedUnitUpdates).toBeUndefined();
    expect(unknown.packedPlayerUpdates).toBeUndefined();
    expect(unknown.packedTileUpdates).toHaveLength(0);
  });

  it("FOG-06 current own sight follows actual territory, not client assertions", async () => {
    const game = await activeGame(true);
    const a = collectLiveNationalObservation(game, viewer.id);
    const b = collectLiveNationalObservation(game, secret.id);
    expect(a.observation.observerId).toBe(viewer.id);
    expect(b.observation.observerId).toBe(secret.id);
    expect(a.visibleTiles.has(game.ref(10, 10))).toBe(true);
    expect(a.visibleTiles.has(game.ref(80, 80))).toBe(false);
    expect(b.visibleTiles.has(game.ref(80, 80))).toBe(true);
    expect(b.visibleTiles.has(game.ref(10, 10))).toBe(false);
    expect(a.observation.nations.map((n) => n.id)).toContain(secret.id);
    expect(a.observation.nations.find((n) => n.id === secret.id)).not.toHaveProperty("troops");
    const legacy = await activeGame(false);
    expect(() => collectLiveNationalObservation(legacy, viewer.id)).toThrow();
  });

  it("AI-01/02/04 executes legal neutral expansion in NationExecution and survives snapshot", async () => {
    const botInfo = new PlayerInfo("Independent AI", PlayerType.Nation, null, "ai-id");
    const nation = new Nation(new Cell(45, 45), botInfo);
    const game = await setup(
      "plains", { nationalMode: true }, [], undefined, undefined, true, [nation],
    );
    game.addExecution(
      new NationExecution("national-live-ai", nation),
      new SpawnExecution("national-live-ai", botInfo, game.ref(45, 45)),
    );
    for (let i = 0; i < 3; i++) game.executeNextTick();
    const bot = game.player(botInfo.id);
    expect(bot.hasSpawned()).toBe(true);
    bot.setTroops(75_000);
    const firstLand = bot.numTilesOwned();
    const firstAttacks = bot.outgoingAttacks().length;
    for (let i = 0; i < 15; i++) game.executeNextTick();
    const advanced = bot.numTilesOwned();
    expect(advanced).toBeGreaterThan(firstLand);
    expect(bot.outgoingAttacks().length + advanced).toBeGreaterThan(
      firstAttacks + firstLand,
    );
    expect(game.executions().some((e) => e instanceof NationExecution)).toBe(true);
    const { bytes, restored, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(restored.player(botInfo.id).numTilesOwned()).toBe(advanced);
  });

  it("LEGACY full runner packets retain existing enemy troop and ship fields", async () => {
    const game = await activeGame(false);
    game.player(secret.id).setTroops(8_765_432);
    const ship = game.player(secret.id).buildUnit(
      UnitType.TransportShip, game.ref(80, 80), { troops: 13_579 },
    );
    const packet = runPacket(game, viewer.clientID!);
    expect(
      unpackUnitUpdates(packet.packedUnitUpdates, packet.packedMissileTimers)
        .some((u) => u.id === ship.id()),
    ).toBe(true);
    expect(packet.packedPlayerUpdates?.length).toBeGreaterThan(0);
  });

  it("bounds actual GameRunner observation throughput with 120 nations", async () => {
    const humans = Array.from({ length: 120 }, (_, i) =>
      new PlayerInfo("n" + i, PlayerType.Nation, null, "n-" + i),
    );
    const game = await setup("plains", { nationalMode: true }, humans);
    const runner = new GameRunner(
      game, new Executor(game, "perf-120", undefined), () => {},
    );
    const start = performance.now();
    for (let tick = 0; tick < 5; tick++) {
      runner.addTurn({ turnNumber: tick, intents: [] });
      expect(runner.executeNextTick()).toBe(true);
    }
    const elapsed = performance.now() - start;
    console.info("[NATIONAL live perf] 120 nations; 5 GameRunner ticks; elapsedMs=" + elapsed.toFixed(2));
    expect(elapsed).toBeLessThan(5000);
  });
});
