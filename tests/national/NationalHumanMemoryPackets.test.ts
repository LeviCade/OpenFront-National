import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import type { Game } from "@openfront/engine/game/Game";
import type { NationalSightMemory } from "@openfront/engine/national/observation/NationalObservation";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const viewer = new PlayerInfo("Viewer", PlayerType.Human, "memory-view", "memory-view-id");
const ally = new PlayerInfo("Ally", PlayerType.Human, "memory-ally", "memory-ally-id");
const foreign = new PlayerInfo("Foreign", PlayerType.Nation, null, "memory-foreign-id");
type SightPort = Game & {
  readNationalObserverMemory?: (principal: string) => NationalSightMemory | null;
};
function session(game: Game, packets: GameUpdateViewData[]) {
  const runner = new GameRunner(
    game,
    new Executor(game, "e3-human-memory", viewer.clientID!),
    (packet) => { if ("updates" in packet) packets.push(packet); },
    viewer.clientID!,
  );
  return runner;
}

describe("Round Five authenticated human GameSnapshot intelligence", () => {
  it("persists human empire-shared sightings, revokes on membership loss, preserves byte-exact restore and never replays hidden canaries", async () => {
    const game = await setup("plains", { nationalMode: true }, [
      viewer, ally, foreign,
    ]);
    game.addExecution(
      new SpawnExecution("e3-human-memory", viewer, game.ref(10, 10)),
      new SpawnExecution("e3-human-memory", ally, game.ref(45, 45)),
      new SpawnExecution("e3-human-memory", foreign, game.ref(80, 80)),
    );
    game.executeNextTick();
    game.executeNextTick();
    game.endSpawnPhase();
    const publicWarPort = game as SightPort;
    const canonicalMemory = typeof publicWarPort.readNationalObserverMemory === "function";

    game.performNationalCommand(game.player(viewer.id), {
      kind: "found-empire", empireId: "memory_empire",
    });
    game.performNationalCommand(game.player(viewer.id), {
      kind: "offer-empire", empireId: "memory_empire", candidateId: ally.id,
    });
    game.performNationalCommand(game.player(ally.id), {
      kind: "accept-empire", empireId: "memory_empire", candidateId: ally.id,
    });
    let discovered: number | null = null;
    for (const border of game.player(ally.id).borderTiles()) {
      game.forEachNeighbor(border, (tile) => {
        if (discovered === null && game.isLand(tile) && !game.owner(tile).isPlayer())
          discovered = tile;
      });
      if (discovered !== null) break;
    }
    expect(discovered).not.toBeNull();
    const spy = game.player(foreign.id).buildUnit(
      UnitType.TransportShip,
      discovered!,
      { troops: 4_321_987 },
    );

    const seen: GameUpdateViewData[] = [];
    const runner = session(game, seen);
    runner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(runner.executeNextTick()).toBe(true);
    expect(JSON.stringify(seen[0], (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    )).not.toContain("4321987");
    if (canonicalMemory) {
      expect(publicWarPort.readNationalObserverMemory!(viewer.id)?.assets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: String(spy.id()),
            sourceNationId: ally.id,
          }),
        ]),
      );
    }
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    if (canonicalMemory) {
      expect((restored as SightPort).readNationalObserverMemory!(viewer.id)).toEqual(
        publicWarPort.readNationalObserverMemory!(viewer.id),
      );
    }

    // The emperor remains alive; removal of the contributing member must
    // revoke ONLY its inherited sight from persisted human intelligence.
    for (const tile of [...restored.player(ally.id).tiles()])
      restored.player(ally.id).relinquish(tile);
    restored.executeNextTick();
    const resumed: GameUpdateViewData[] = [];
    const fresh = session(restored, resumed);
    fresh.addTurn({ turnNumber: restored.ticks(), intents: [] });
    expect(fresh.executeNextTick()).toBe(true);
    expect(JSON.stringify(resumed[0], (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    )).not.toContain("4321987");
    if (canonicalMemory) {
      expect(
        (restored as SightPort).readNationalObserverMemory!(viewer.id)?.assets.some(
          (asset) => asset.id === String(spy.id()),
        ),
      ).toBe(false);
    }
    expect(resumed[0].packedAttackUpdates).toBeUndefined();
  });
});
