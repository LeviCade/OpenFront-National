import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const HUMAN = new PlayerInfo(
  "Human Viewer",
  PlayerType.Human,
  "r8-fog-client",
  "r8-fog-human",
);
const BOT = new PlayerInfo("AI Observer", PlayerType.Nation, null, "r8-fog-bot");
const FOREIGN = new PlayerInfo(
  "Foreign",
  PlayerType.Human,
  "r8-fog-foreign-client",
  "r8-fog-foreign",
);

function workerPacket(
  game: Awaited<ReturnType<typeof setup>>,
  clientId: string,
): GameUpdateViewData {
  const received: GameUpdateViewData[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, "r8-fog", clientId),
    (packet) => {
      if ("updates" in packet) received.push(packet);
    },
    clientId,
  );
  runner.addTurn({ turnNumber: game.ticks(), intents: [] });
  expect(runner.executeNextTick()).toBe(true);
  return received[0];
}

describe("Round Eight real geographic fog FOG-03/04/05/06/07", () => {
  it("FOG-03 structures are seen inside 100 real border tiles, not beyond; hidden units stay out of human packets", async () => {
    const game = await setup("big_plains", { nationalMode: true }, [HUMAN, FOREIGN]);
    game.addExecution(
      new SpawnExecution("r8-fog", HUMAN, game.ref(20, 100)),
      new SpawnExecution("r8-fog", FOREIGN, game.ref(180, 180)),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(game.player(HUMAN.id).hasSpawned()).toBe(true);
    expect(game.player(FOREIGN.id).hasSpawned()).toBe(true);
    const near = game.player(FOREIGN.id).buildUnit(
      UnitType.City,
      game.ref(80, 100),
      {},
    );
    const distant = game.player(FOREIGN.id).buildUnit(
      UnitType.City,
      game.ref(195, 100),
      {},
    );
    const seen = collectLiveNationalObservation(game, HUMAN.id).observation;
    expect(seen.visibleAssets.map((asset) => asset.id)).toContain(String(near.id()));
    expect(seen.visibleAssets.map((asset) => asset.id)).not.toContain(
      String(distant.id()),
    );
    const projected = workerPacket(game, HUMAN.clientID!);
    const json = JSON.stringify(projected, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(json).not.toContain('"sightMemory"');
    expect(projected.nationalCommandResults).toBeUndefined();
    const { restored, bytes, again } = await roundTrip(game, "big_plains");
    expect([...bytes]).toEqual([...again]);
    expect(
      collectLiveNationalObservation(restored, HUMAN.id).observation.visibleAssets
        .some((a) => a.id === String(distant.id())),
    ).toBe(false);
  });

  it("FOG-04/05 actual coastal observers see naval transports without landing destinations or troop secrets", async () => {
    const game = await setup("half_land_half_ocean", { nationalMode: true }, [
      HUMAN,
      FOREIGN,
    ]);
    let coast: number | undefined;
    let water: number | undefined;
    let otherLand: number | undefined;
    for (let y = 1; y < game.height() - 1; y++) {
      for (let x = 1; x < game.width() - 1; x++) {
        const tile = game.ref(x, y);
        if (game.isLand(tile)) {
          if (otherLand === undefined) otherLand = tile;
          let edge = false;
          game.forEachNeighbor(tile, (neighbor) => {
            if (!game.isLand(neighbor)) {
              edge = true;
              water = neighbor;
            }
          });
          if (edge && coast === undefined) coast = tile;
        }
      }
    }
    expect(coast).toBeDefined();
    expect(water).toBeDefined();
    game.addExecution(
      new SpawnExecution("r8-coast", HUMAN, coast!),
      new SpawnExecution("r8-coast", FOREIGN, otherLand!),
    );
    game.executeNextTick();
    game.executeNextTick();
    const transport = game.player(FOREIGN.id).buildUnit(
      UnitType.TransportShip,
      water!,
      { troops: 7_654_321 },
    );
    const view = collectLiveNationalObservation(game, HUMAN.id);
    const discovered = view.observation.visibleAssets.find(
      (asset) => asset.id === String(transport.id()),
    );
    expect(discovered).toBeDefined();
    expect(discovered).not.toHaveProperty("landingDestination");
    expect(discovered).not.toHaveProperty("strength");
    expect(view.visibleTiles.has(water!)).toBe(true);
    const output = workerPacket(game, HUMAN.clientID!);
    const json = JSON.stringify(output, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(json).not.toContain("7654321");
    expect(json).not.toContain("landingDestination");
  });

  it("FOG-06/07 AI and human share exactly authorized empire sight, then lose inherited foreign sightings immediately after contributor removal", async () => {
    const nation = new Nation(new Cell(65, 100), BOT);
    const game = await setup(
      "big_plains",
      { nationalMode: true },
      [HUMAN, FOREIGN],
      undefined,
      undefined,
      true,
      [nation],
    );
    game.addExecution(
      new NationExecution("r8-fog-parity", nation),
      new SpawnExecution("r8-fog-parity", HUMAN, game.ref(20, 20)),
      new SpawnExecution("r8-fog-parity", BOT, game.ref(65, 100)),
      new SpawnExecution("r8-fog-parity", FOREIGN, game.ref(185, 180)),
    );
    game.executeNextTick();
    game.executeNextTick();
    game.endSpawnPhase();
    const asset = game.player(FOREIGN.id).buildUnit(
      UnitType.City,
      game.ref(90, 105),
      {},
    );
    const beforeHuman = collectLiveNationalObservation(game, HUMAN.id).observation;
    const beforeAI = collectLiveNationalObservation(game, BOT.id).observation;
    expect(beforeHuman.visibleAssets.some((a) => a.id === String(asset.id()))).toBe(false);
    expect(beforeAI.visibleAssets.some((a) => a.id === String(asset.id()))).toBe(true);

    game.performNationalCommand(game.player(HUMAN.id), {
      kind: "found-empire",
      empireId: "r8_fog_parity",
    });
    game.performNationalCommand(game.player(HUMAN.id), {
      kind: "offer-empire",
      empireId: "r8_fog_parity",
      candidateId: BOT.id,
    });
    game.performNationalCommand(game.player(BOT.id), {
      kind: "accept-empire",
      empireId: "r8_fog_parity",
      candidateId: BOT.id,
    });
    const alliedHuman = collectLiveNationalObservation(game, HUMAN.id).observation;
    const alliedBot = collectLiveNationalObservation(game, BOT.id).observation;
    const foreignIds = (obs: typeof alliedBot) =>
      obs.visibleAssets
        .filter((a) => a.ownerId === FOREIGN.id)
        .map((a) => a.id)
        .sort();
    expect(foreignIds(alliedHuman)).toContain(String(asset.id()));
    expect(foreignIds(alliedHuman)).toEqual(foreignIds(alliedBot));
    expect(alliedHuman.visibleAssets.find((a) => a.id === String(asset.id())))
      .not.toHaveProperty("strength");

    // Actual elimination (not a forged treaty grant) removes reciprocal
    // membership; the human immediately loses the bot's 100-tile sight.
    for (const tile of [...game.player(BOT.id).tiles()])
      game.player(BOT.id).relinquish(tile);
    game.executeNextTick();
    const revoked = collectLiveNationalObservation(game, HUMAN.id).observation;
    expect(revoked.visibleAssets.some((a) => a.id === String(asset.id()))).toBe(false);
    const { restored } = await roundTrip(game, "big_plains");
    expect(
      collectLiveNationalObservation(restored, HUMAN.id).observation.visibleAssets
        .some((a) => a.id === String(asset.id())),
    ).toBe(false);
  });
});
