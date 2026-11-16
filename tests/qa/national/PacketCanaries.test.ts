import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  type GameUpdateViewData,
  type PlayerUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import { unpackUnitUpdates } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../../util/Setup";
import { roundTrip } from "../../util/Snapshot";

const observer = new PlayerInfo(
  "QA Observer",
  PlayerType.Human,
  "qa-observer-client",
  "qa-observer-id",
);
const hidden = new PlayerInfo(
  "QA Hidden",
  PlayerType.Nation,
  null,
  "qa-hidden-id",
);
const SECRET_TROOPS = 8_765_432;
const SECRET_SHIP_TROOPS = 4_567_891;
const SECRET_TREATY = "QA_CONFIDENTIAL_TREATY_93641";

function wireText(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

/** This oracle intentionally fails on a deliberately contaminated packet. */
export function assertNoHostileCanary(packet: unknown): void {
  const bytes = wireText(packet);
  for (const canary of [
    String(SECRET_TROOPS),
    String(SECRET_SHIP_TROOPS),
    SECRET_TREATY,
  ]) {
    if (bytes.includes(canary)) {
      throw new Error("NATIONAL unauthorized packet disclosure: " + canary);
    }
  }
}

async function spawned(nationalMode = true): Promise<Game> {
  const game = await setup("plains", { nationalMode }, [observer, hidden]);
  game.addExecution(
    new SpawnExecution("qa-packets", observer, game.ref(10, 10)),
    new SpawnExecution("qa-packets", hidden, game.ref(80, 80)),
  );
  game.executeNextTick();
  game.executeNextTick();
  expect(game.player(observer.id).hasSpawned()).toBe(true);
  expect(game.player(hidden.id).hasSpawned()).toBe(true);
  return game;
}

function tickPacket(game: Game, clientID?: string) {
  const packets: GameUpdateViewData[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, "qa-packets", clientID),
    (packet) => {
      if ("updates" in packet) packets.push(packet);
    },
    clientID,
  );
  game.queueViewResync();
  runner.addTurn({ turnNumber: game.ticks(), intents: [] });
  expect(runner.executeNextTick()).toBe(true);
  expect(packets).toHaveLength(1);
  return { runner, packet: packets[0] };
}

describe("NATIONAL QA — actual GameRunner and worker-facing packet canaries", () => {
  it("fails its detection oracle on contaminated typed arrays and diplomatic events", () => {
    const fakeWorkerOutput = {
      type: "game_update_batch",
      gameUpdates: [
        {
          packedPlayerUpdates: new Float64Array([1, SECRET_TROOPS]),
          updates: {
            [GameUpdateType.DisplayChatEvent]: [
              { type: GameUpdateType.DisplayChatEvent, message: SECRET_TREATY },
            ],
          },
        },
      ],
    };
    expect(() => assertNoHostileCanary(fakeWorkerOutput)).toThrow(
      /unauthorized packet disclosure/,
    );
    expect(() =>
      assertNoHostileCanary({
        packedUnitUpdates: new Float64Array([SECRET_SHIP_TROOPS]),
      }),
    ).toThrow(/unauthorized packet disclosure/);
    expect(() => assertNoHostileCanary({ public: "ordinary" })).not.toThrow();
  });

  it("does not emit hidden troops, ships, diplomatic text or packed statistics through REAL GameRunner", async () => {
    const game = await spawned();
    const foe = game.player(hidden.id);
    foe.setTroops(SECRET_TROOPS);
    const ship = foe.buildUnit(UnitType.TransportShip, game.ref(80, 80), {
      troops: SECRET_SHIP_TROOPS,
      targetTile: game.ref(11, 11),
    });
    const tick = game.executeNextTick.bind(game);
    // Inject raw hostile-private data into the authoritative update source.
    // A permissive shallow-copy projection would FAIL this test.
    game.executeNextTick = () => {
      const updates = tick();
      (updates[GameUpdateType.DisplayChatEvent] as unknown[]).push({
        type: GameUpdateType.DisplayChatEvent,
        message: SECRET_TREATY,
      });
      (updates[GameUpdateType.Player] as PlayerUpdate[]).push({
        type: GameUpdateType.Player,
        id: hidden.id,
        troops: SECRET_TROOPS,
      });
      return updates;
    };

    const first = tickPacket(game, observer.clientID!);
    expect(first.runner.isNationalRequesterAuthorized(observer.id)).toBe(true);
    expect(first.runner.isNationalRequesterAuthorized(hidden.id)).toBe(false);
    expect(first.runner.isNationalCoordinateVisible(10, 10)).toBe(true);
    expect(first.runner.isNationalCoordinateVisible(80, 80)).toBe(false);
    expect(first.runner.isNationalTileVisible(game.ref(80, 80))).toBe(false);
    expect(first.packet.packedAttackUpdates).toBeUndefined();
    expect(first.packet.packedMotionPlans).toBeUndefined();
    expect(first.packet.updates[GameUpdateType.DisplayChatEvent]).toEqual([]);
    expect(
      unpackUnitUpdates(
        first.packet.packedUnitUpdates,
        first.packet.packedMissileTimers,
      ).some((u) => u.id === ship.id()),
    ).toBe(false);
    assertNoHostileCanary(first.packet);
    const foreign = first.packet.updates[GameUpdateType.Player].find(
      (p) => p.id === hidden.id,
    );
    if (foreign) {
      expect(foreign.gold).toBeUndefined();
      expect(foreign.troops).toBeUndefined();
      expect(foreign.incomingAttacks).toBeUndefined();
    }

    const again = tickPacket(game, observer.clientID!);
    assertNoHostileCanary(again.packet);
    const { restored } = await roundTrip(game, "plains");
    assertNoHostileCanary(tickPacket(restored, observer.clientID!).packet);
    const unknown = tickPacket(game, undefined).packet;
    expect(unknown.packedTileUpdates).toHaveLength(0);
    expect(unknown.packedPlayerUpdates).toBeUndefined();
    expect(unknown.packedUnitUpdates).toBeUndefined();
    assertNoHostileCanary(unknown);

    // The authoritative simulation holds these secrets. A modified browser
    // can read Game state / snapshot bytes despite ordinary filtered packets.
    const authoritativeTroops = game.player(hidden.id).troops();
    expect(authoritativeTroops).toBeGreaterThan(0);
    // The simulation legitimately recalculates troop counts each tick.
    // Whatever the *current* secret value, it exists in raw local state.
    expect(wireText(snapshotGameData(game))).toContain(
      String(authoritativeTroops),
    );
  });

  it("revokes stale worker requester identity; legacy FFA remains unfiltered", async () => {
    const game = await spawned();
    game.player(hidden.id).setTroops(SECRET_TROOPS);
    const packets: GameUpdateViewData[] = [];
    const runner = new GameRunner(
      game,
      new Executor(game, "qa-revoked", observer.clientID!),
      (value) => {
        if ("updates" in value) packets.push(value);
      },
      observer.clientID!,
    );
    expect(runner.isNationalIntentAuthorized(observer.clientID!)).toBe(true);
    game
      .player(observer.id)
      .setPlayerInfo(
        new PlayerInfo(observer.name, PlayerType.Nation, null, observer.id),
      );
    expect(runner.isNationalRequesterAuthorized(observer.id)).toBe(false);
    expect(runner.isNationalIntentAuthorized(observer.clientID!)).toBe(false);
    runner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(runner.executeNextTick()).toBe(true);
    expect(packets).toHaveLength(1);
    expect(packets[0].packedPlayerUpdates).toBeUndefined();
    expect(packets[0].packedUnitUpdates).toBeUndefined();
    expect(packets[0].packedTileUpdates).toHaveLength(0);
    assertNoHostileCanary(packets[0]);

    const legacy = await spawned(false);
    legacy.player(hidden.id).setTroops(SECRET_TROOPS);
    const legacyPacket = tickPacket(legacy, observer.clientID!);
    expect(legacyPacket.runner.isNationalRequesterAuthorized(hidden.id)).toBe(
      true,
    );
    expect(legacyPacket.packet.packedPlayerUpdates?.length).toBeGreaterThan(0);
  });

  it("bounds five live GameRunner packet projections and prints repeatable measured duration", async () => {
    const game = await spawned();
    const runner = new GameRunner(
      game,
      new Executor(game, "qa-performance", observer.clientID!),
      () => {},
      observer.clientID!,
    );
    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      runner.addTurn({ turnNumber: game.ticks(), intents: [] });
      expect(runner.executeNextTick()).toBe(true);
    }
    const elapsedMs = performance.now() - start;
    console.info(
      JSON.stringify({
        qa: "national-packet-performance",
        ticks: 5,
        elapsedMs: Number(elapsedMs.toFixed(2)),
      }),
    );
    expect(elapsedMs).toBeLessThan(8_000);
  });
});
