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
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import {
  deriveNationalWarSides,
  initialNationalPlannerMemory,
  planNationalInterest,
} from "@openfront/engine/national/ai/NationalPlanner";
import { WarLedger } from "@openfront/engine/national/conflict/WarLedger";
import {
  collectLiveNationalObservation,
} from "@openfront/engine/national/observation/LiveObservation";
import { advanceLastKnown } from "@openfront/engine/national/observation/NationalObservation";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const viewer = new PlayerInfo(
  "Viewer",
  PlayerType.Human,
  "viewer-client",
  "viewer-id",
);
const secret = new PlayerInfo(
  "Hidden Enemy",
  PlayerType.Nation,
  null,
  "secret-id",
);

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
    expect(
      unpackUnitUpdates(
        first.packedUnitUpdates,
        first.packedMissileTimers,
      ).some((unit) => unit.id === shipId),
    ).toBe(false);
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
      Array.from(first.packedTileUpdates).filter((_, i) => i % 2 === 0),
    ).not.toContain(hiddenTile);

    // A second fresh resync must not recover the hidden exact values.
    const again = runPacket(game, viewer.clientID!);
    expect(numericData(again)).not.toContain(secretTroops);
    expect(
      unpackUnitUpdates(
        again.packedUnitUpdates,
        again.packedMissileTimers,
      ).some((unit) => unit.id === shipId),
    ).toBe(false);
    const unknown = runPacket(game, undefined);
    expect(unknown.packedUnitUpdates).toBeUndefined();
    expect(unknown.packedPlayerUpdates).toBeUndefined();
    expect(unknown.packedTileUpdates).toHaveLength(0);

    // Reconstruct an actual authoritative snapshot and resend the full view.
    // Enemy canaries must not reappear through replay or initial resync.
    const { restored } = await roundTrip(game, "plains");
    const replayPacket = runPacket(restored, viewer.clientID!);
    expect(numericData(replayPacket)).not.toContain(secretTroops);
    expect(
      unpackUnitUpdates(
        replayPacket.packedUnitUpdates,
        replayPacket.packedMissileTimers,
      ).some((unit) => unit.id === shipId),
    ).toBe(false);
    expect(
      Array.from(replayPacket.packedTileUpdates).filter((_, i) => i % 2 === 0),
    ).not.toContain(hiddenTile);
  });

  it("WAR-01/04 projects only E2 canonical active war sides and drops settled layers", async () => {
    const game = await activeGame(true);
    game.endSpawnPhase();
    const ledger = new WarLedger(game.nationalPoliticalAuthority()!);
    const warId = "e3_verified_war";
    ledger.declareNational(
      warId,
      viewer.id,
      viewer.id,
      secret.id,
      game.ticks(),
    );
    // This E3 test injects a real E2 WarLedger read-only adapter, without
    // taking ownership of E1's GameImpl or WAR snapshot schema.
    Object.defineProperty(game, "nationalWarAuthority", {
      configurable: true,
      value: () => ({
        authorizeOffensiveAction: (actor: string, target: string | null) =>
          ledger.authorizeOffensiveAction(actor, target),
        snapshot: () => ({ wars: { layers: ledger.exportState().layers } }),
      }),
    });
    const during = collectLiveNationalObservation(game, viewer.id).observation;
    expect(during.wars.map((w) => w.id)).toEqual([warId]);
    expect(during.wars[0].first).toEqual({
      kind: "nation",
      stableId: viewer.id,
      activeMemberIds: [viewer.id],
    });
    expect(during.wars[0].second.activeMemberIds).toEqual([secret.id]);
    expect(
      [...deriveNationalWarSides(during.wars, viewer.id).enemies],
    ).toEqual([secret.id]);
    expect(JSON.stringify(during.wars)).not.toContain("declaredBy");
    expect(JSON.stringify(during.wars)).not.toContain("proposedBy");
    expect(JSON.stringify(during.wars)).not.toContain("motions");

    ledger.proposePeace("e3_motion", warId, viewer.id, game.ticks());
    ledger.acceptPeace("e3_motion", secret.id, game.ticks());
    const after = collectLiveNationalObservation(game, viewer.id).observation;
    expect(after.wars).toEqual([]);
    expect([...deriveNationalWarSides(after.wars, viewer.id).enemies]).toEqual(
      [],
    );
  });

  it("FOG-07 revokes cached recipient rights after live client identity transfer", async () => {
    const game = await activeGame(true);
    const packets: GameUpdateViewData[] = [];
    const runner = new GameRunner(
      game,
      new Executor(game, "session-revocation", viewer.clientID!),
      (packet) => {
        if ("updates" in packet) packets.push(packet);
      },
      viewer.clientID!,
    );
    expect(runner.isNationalRequesterAuthorized(viewer.id)).toBe(true);
    game
      .player(viewer.id)
      .setPlayerInfo(
        new PlayerInfo("Viewer", PlayerType.Nation, null, viewer.id),
      );
    expect(runner.isNationalRequesterAuthorized(viewer.id)).toBe(false);
    expect(runner.isNationalIntentAuthorized(viewer.clientID!)).toBe(false);
    expect(runner.isNationalCoordinateVisible(10, 10)).toBe(false);
    runner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(runner.executeNextTick()).toBe(true);
    expect(packets).toHaveLength(1);
    expect(packets[0].packedPlayerUpdates).toBeUndefined();
    expect(packets[0].packedUnitUpdates).toBeUndefined();
    expect(packets[0].packedTileUpdates).toHaveLength(0);
    const oldOwner = packets[0].updates[GameUpdateType.Player].find(
      (p) => p.id === viewer.id,
    );
    if (oldOwner) {
      expect(oldOwner.gold).toBeUndefined();
      expect(oldOwner.troops).toBeUndefined();
      expect(oldOwner.incomingAttacks).toBeUndefined();
    }
  });

  it("FOG-03 rejects hidden-location RPC probes by the correct player", async () => {
    const game = await activeGame(true);
    const runner = new GameRunner(
      game,
      new Executor(game, "probe-test", viewer.clientID!),
      () => {},
      viewer.clientID!,
    );
    expect(runner.isNationalRequesterAuthorized(viewer.id)).toBe(true);
    expect(runner.isNationalCoordinateVisible(10, 10)).toBe(true);
    expect(runner.isNationalCoordinateVisible(80, 80)).toBe(false);
    expect(runner.isNationalTileVisible(game.ref(80, 80))).toBe(false);
    expect(runner.isNationalRequesterAuthorized(secret.id)).toBe(false);
    expect(runner.isNationalCoordinateVisible(100000, 100000)).toBe(false);
  });

  it("FOG-02 denies confidential diplomatic canaries in actual outbound packets", async () => {
    const game = await activeGame(true);
    const confidential = "TOP_SECRET_TREATY_CANARY_638155";
    const originalTick = game.executeNextTick.bind(game);
    game.executeNextTick = () => {
      const updates = originalTick();
      // Simulates a future E1/E2 private diplomatic event in the authoritative
      // ledger output. The REAL GameRunner/worker-facing filter must drop it.
      (updates[GameUpdateType.DisplayChatEvent] as unknown[]).push({
        type: GameUpdateType.DisplayChatEvent,
        message: confidential,
      });
      return updates;
    };
    const recipient = runPacket(game, viewer.clientID!);
    expect(recipient.updates[GameUpdateType.DisplayChatEvent]).toEqual([]);
    expect(
      JSON.stringify(recipient, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain(confidential);
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
    expect(
      a.observation.nations.find((n) => n.id === secret.id),
    ).not.toHaveProperty("troops");
    const legacy = await activeGame(false);
    expect(() => collectLiveNationalObservation(legacy, viewer.id)).toThrow();
  });

  it("AI-01/02/04 executes legal neutral expansion in NationExecution and survives snapshot", async () => {
    const botInfo = new PlayerInfo(
      "Independent AI",
      PlayerType.Nation,
      null,
      "ai-id",
    );
    const nation = new Nation(new Cell(45, 45), botInfo);
    const game = await setup(
      "plains",
      { nationalMode: true },
      [],
      undefined,
      undefined,
      true,
      [nation],
    );
    game.addExecution(
      new NationExecution("national-live-ai", nation),
      new SpawnExecution("national-live-ai", botInfo, game.ref(45, 45)),
    );
    for (let i = 0; i < 3; i++) game.executeNextTick();
    const bot = game.player(botInfo.id);
    expect(bot.hasSpawned()).toBe(true);
    bot.setTroops(75_000);
    expect(
      collectLiveNationalObservation(game, botInfo.id).observation
        .unownedFrontier,
    ).toBe(true);
    const firstLand = bot.numTilesOwned();
    const firstAttacks = bot.outgoingAttacks().length;
    // One initial decision can predate the troop injection. Exercise multiple
    // complete 30-tick strategy cycles and observe actual land capture.
    for (let i = 0; i < 75; i++) game.executeNextTick();
    const advanced = bot.numTilesOwned();
    expect(advanced).toBeGreaterThan(firstLand);
    expect(bot.outgoingAttacks().length + advanced).toBeGreaterThan(
      firstAttacks + firstLand,
    );
    expect(game.executions().some((e) => e instanceof NationExecution)).toBe(
      true,
    );
    const { bytes, restored, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(restored.player(botInfo.id).numTilesOwned()).toBe(advanced);
  });

  it("FOG-04/06 attributes real empire sightings to their member and revokes them immediately", async () => {
    const ally = new PlayerInfo("Ally", PlayerType.Nation, null, "ally-id");
    const foreign = new PlayerInfo(
      "Foreign",
      PlayerType.Nation,
      null,
      "foreign-id",
    );
    const game = await setup("plains", { nationalMode: true }, [
      viewer,
      ally,
      foreign,
    ]);
    game.addExecution(
      new SpawnExecution("empire-sight-test", viewer, game.ref(10, 10)),
      new SpawnExecution("empire-sight-test", ally, game.ref(45, 45)),
      new SpawnExecution("empire-sight-test", foreign, game.ref(80, 80)),
    );
    game.executeNextTick();
    game.executeNextTick();
    game.endSpawnPhase();

    const sovereign = game.player(viewer.id);
    game.performNationalCommand(sovereign, {
      kind: "found-empire",
      empireId: "e3_sight",
    });
    game.performNationalCommand(sovereign, {
      kind: "offer-empire",
      empireId: "e3_sight",
      candidateId: ally.id,
    });
    game.performNationalCommand(game.player(ally.id), {
      kind: "accept-empire",
      empireId: "e3_sight",
      candidateId: ally.id,
    });

    let nearby: number | null = null;
    for (const border of game.player(ally.id).borderTiles()) {
      game.forEachNeighbor(border, (tile) => {
        if (
          nearby === null &&
          game.isLand(tile) &&
          !game.owner(tile).isPlayer()
        ) {
          nearby = tile;
        }
      });
      if (nearby !== null) break;
    }
    expect(nearby).not.toBeNull();
    const hostileShip = game
      .player(foreign.id)
      .buildUnit(UnitType.TransportShip, nearby!, { troops: 2_345_987 });
    const allyShip = game
      .player(ally.id)
      .buildUnit(UnitType.TransportShip, game.ref(45, 45), {
        troops: 36_000,
      });

    const seen = collectLiveNationalObservation(game, viewer.id);
    const hostile = seen.observation.visibleAssets.find(
      (a) => a.id === String(hostileShip.id()),
    );
    expect(hostile?.source).toBe("empire");
    expect(hostile?.sourceNationId).toBe(ally.id);
    expect(hostile?.strength).toBeUndefined();
    const allied = seen.observation.visibleAssets.find(
      (a) => a.id === String(allyShip.id()),
    );
    expect(allied?.source).toBe("empire");
    expect(allied?.sourceNationId).toBe(ally.id);
    expect(allied?.strength).toBe(allyShip.troops());
    const savedSight = advanceLastKnown(seen.observation, null, 60);

    const packets: GameUpdateViewData[] = [];
    const runner = new GameRunner(
      game,
      new Executor(game, "empire-packet", viewer.clientID!),
      (packet) => {
        if ("updates" in packet) packets.push(packet);
      },
      viewer.clientID!,
    );
    game.queueViewResync();
    runner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(runner.executeNextTick()).toBe(true);
    const first = unpackUnitUpdates(
      packets[0].packedUnitUpdates,
      packets[0].packedMissileTimers,
    );
    expect(first.find((u) => u.id === hostileShip.id())?.troops).toBe(0);
    expect(first.find((u) => u.id === allyShip.id())?.troops).toBe(
      allyShip.troops(),
    );

    // Simulate an authoritative membership revocation at the E1 read-port.
    // No client-supplied roster or remembered grant may keep inherited sight.
    const authority = game.nationalPoliticalAuthority()!;
    const revoked = vi.spyOn(game, "nationalPoliticalAuthority");
    revoked.mockImplementation(() => ({
      ...authority,
      empireOf: (id: string) =>
        id === viewer.id || id === ally.id ? null : authority.empireOf(id),
      emperorOf: (id: string) =>
        id === "e3_sight" ? null : authority.emperorOf(id),
      membersOf: (id: string) =>
        id === "e3_sight" ? [] : authority.membersOf(id),
    }));
    const after = collectLiveNationalObservation(game, viewer.id);
    expect(after.observation.visibleAssets.some(
      (a) => a.id === String(hostileShip.id()),
    )).toBe(false);
    expect(
      advanceLastKnown(after.observation, savedSight.memory, 60).stale.some(
        (a) => a.id === String(hostileShip.id()),
      ),
    ).toBe(false);

    runner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(runner.executeNextTick()).toBe(true);
    const lost = unpackUnitUpdates(
      packets[1].packedUnitUpdates,
      packets[1].packedMissileTimers,
    );
    const hidden = lost.find((u) => u.id === hostileShip.id());
    expect(hidden?.pos).toBe(nearby);
    expect(hidden?.troops).toBe(0);
    expect(hidden?.markedForDeletion).not.toBe(false);
    const exAlly = lost.find((u) => u.id === allyShip.id());
    expect(exAlly?.troops).toBe(0);
    expect(exAlly?.markedForDeletion).not.toBe(false);
    revoked.mockRestore();
  });

  it("LEGACY full runner packets retain existing enemy troop and ship fields", async () => {
    const game = await activeGame(false);
    game.player(secret.id).setTroops(8_765_432);
    const ship = game
      .player(secret.id)
      .buildUnit(UnitType.TransportShip, game.ref(80, 80), { troops: 13_579 });
    const packet = runPacket(game, viewer.clientID!);
    expect(
      unpackUnitUpdates(
        packet.packedUnitUpdates,
        packet.packedMissileTimers,
      ).some((u) => u.id === ship.id()),
    ).toBe(true);
    expect(packet.packedPlayerUpdates?.length).toBeGreaterThan(0);
  });

  it("bounds actual GameRunner observation throughput with 120 nations", async () => {
    const humans = Array.from(
      { length: 120 },
      (_, i) => new PlayerInfo("n" + i, PlayerType.Nation, null, "n-" + i),
    );
    const game = await setup("plains", { nationalMode: true }, humans);
    const runner = new GameRunner(
      game,
      new Executor(game, "perf-120", undefined),
      () => {},
    );
    const start = performance.now();
    for (let tick = 0; tick < 5; tick++) {
      runner.addTurn({ turnNumber: tick, intents: [] });
      expect(runner.executeNextTick()).toBe(true);
    }
    const elapsed = performance.now() - start;
    console.info(
      "[NATIONAL live perf] 120 nations; 5 GameRunner ticks; elapsedMs=" +
        elapsed.toFixed(2),
    );
    expect(elapsed).toBeLessThan(5000);
  });

  it("FOG-04 revokes actual live unit sight without exposing its hidden destination", async () => {
    const game = await activeGame(true);
    const mine = game.player(viewer.id);
    let sightedTile: number | null = null;
    for (const border of mine.borderTiles()) {
      game.forEachNeighbor(border, (tile) => {
        if (
          sightedTile === null &&
          game.isLand(tile) &&
          !game.owner(tile).isPlayer()
        ) {
          sightedTile = tile;
        }
      });
      if (sightedTile !== null) break;
    }
    expect(sightedTile).not.toBeNull();
    const ship = game
      .player(secret.id)
      .buildUnit(UnitType.TransportShip, sightedTile!, { troops: 2_345_678 });
    const packets: GameUpdateViewData[] = [];
    const runner = new GameRunner(
      game,
      new Executor(game, "revocation-test", viewer.clientID!),
      (packet) => {
        if ("updates" in packet) packets.push(packet);
      },
      viewer.clientID!,
    );
    game.queueViewResync();
    runner.addTurn({ turnNumber: 0, intents: [] });
    expect(runner.executeNextTick()).toBe(true);
    const appeared = unpackUnitUpdates(
      packets[0].packedUnitUpdates,
      packets[0].packedMissileTimers,
    ).find((u) => u.id === ship.id());
    expect(appeared?.pos).toBe(sightedTile);
    expect(appeared?.troops).toBe(0);

    const nowHidden = game.ref(80, 80);
    ship.move(nowHidden);
    runner.addTurn({ turnNumber: 1, intents: [] });
    expect(runner.executeNextTick()).toBe(true);
    const revoked = unpackUnitUpdates(
      packets[1].packedUnitUpdates,
      packets[1].packedMissileTimers,
    ).find((u) => u.id === ship.id());
    expect(revoked?.pos).toBe(sightedTile);
    expect(revoked?.pos).not.toBe(nowHidden);
    expect(revoked?.markedForDeletion).not.toBe(false);
    expect(revoked?.troops).toBe(0);
  });

  it("FOG-07 AI/human controller switches do not change live observations or strategy", async () => {
    const game = await activeGame(true);
    const before = collectLiveNationalObservation(game, viewer.id).observation;
    const beforePlan = planNationalInterest(
      before,
      initialNationalPlannerMemory(viewer.id),
      30,
    );
    game
      .player(viewer.id)
      .setPlayerInfo(
        new PlayerInfo("Viewer", PlayerType.Nation, viewer.clientID, viewer.id),
      );
    const after = collectLiveNationalObservation(game, viewer.id).observation;
    const afterPlan = planNationalInterest(
      after,
      initialNationalPlannerMemory(viewer.id),
      30,
    );
    expect(after).toEqual(before);
    expect(afterPlan).toEqual(beforePlan);
  });
});
