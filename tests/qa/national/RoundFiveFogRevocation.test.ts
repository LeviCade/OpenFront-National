import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { unpackUnitUpdates } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { advanceLastKnown } from "@openfront/engine/national/observation/NationalObservation";
import { NationalOutboundFilter } from "@openfront/engine/national/observation/NationalOutbound";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../../util/Setup";
import { roundTrip } from "../../util/Snapshot";

const viewer = new PlayerInfo(
  "QA Viewer",
  PlayerType.Human,
  "r5-view-client",
  "r5-view",
);
const ally = new PlayerInfo("QA Ally", PlayerType.Nation, null, "r5-ally");
const enemy = new PlayerInfo("QA Hidden", PlayerType.Nation, null, "r5-hidden");

describe("E5 Round Five FOG: real GameRunner visibility / revoked empire / restored principal", () => {
  it("revokes inherited vessel sight, forbids leaked secret troops, and never transfers viewer memory", async () => {
    const game = await setup("plains", { nationalMode: true }, [
      viewer,
      ally,
      enemy,
    ]);
    game.addExecution(
      new SpawnExecution("qa-r5-fog", viewer, game.ref(10, 10)),
      new SpawnExecution("qa-r5-fog", ally, game.ref(45, 45)),
      new SpawnExecution("qa-r5-fog", enemy, game.ref(80, 80)),
    );
    game.executeNextTick();
    game.executeNextTick();
    game.endSpawnPhase();
    game.performNationalCommand(game.player(viewer.id), {
      kind: "found-empire",
      empireId: "r5_fog_empire",
    });
    game.performNationalCommand(game.player(viewer.id), {
      kind: "offer-empire",
      empireId: "r5_fog_empire",
      candidateId: ally.id,
    });
    game.performNationalCommand(game.player(ally.id), {
      kind: "accept-empire",
      empireId: "r5_fog_empire",
      candidateId: ally.id,
    });

    let nearAlly: number | null = null;
    for (const tile of game.player(ally.id).borderTiles()) {
      game.forEachNeighbor(tile, (next) => {
        if (
          nearAlly === null &&
          game.isLand(next) &&
          !game.owner(next).isPlayer()
        ) {
          nearAlly = next;
        }
      });
      if (nearAlly !== null) break;
    }
    expect(nearAlly).not.toBeNull();
    const hostileShip = game
      .player(enemy.id)
      .buildUnit(UnitType.TransportShip, nearAlly!, {
        troops: 8_765_432,
      });
    const before = collectLiveNationalObservation(game, viewer.id);
    expect(
      before.observation.visibleAssets.some(
        (item) => item.id === String(hostileShip.id()),
      ),
    ).toBe(true);
    const saved = advanceLastKnown(before.observation, null, 60).memory;

    const packets: GameUpdateViewData[] = [];
    const runner = new GameRunner(
      game,
      new Executor(game, "qa-r5-fog", viewer.clientID!),
      (packet) => {
        if ("updates" in packet) packets.push(packet);
      },
      viewer.clientID!,
    );
    game.queueViewResync();
    runner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(runner.executeNextTick()).toBe(true);
    const first = packets[0];
    const units = unpackUnitUpdates(
      first.packedUnitUpdates,
      first.packedMissileTimers,
    );
    expect(units.find((unit) => unit.id === hostileShip.id())?.troops).toBe(0);
    expect(JSON.stringify(first)).not.toContain("8765432");

    // Simulates a Game-owned membership revocation at the read boundary.
    // The filter must forget inherited sight, not preserve a stale empire grant.
    const authority = game.nationalPoliticalAuthority()!;
    const spy = vi.spyOn(game, "nationalPoliticalAuthority");
    spy.mockImplementation(() => ({
      ...authority,
      empireOf: (id: string) =>
        id === viewer.id || id === ally.id ? null : authority.empireOf(id),
      emperorOf: (id: string) =>
        id === "r5_fog_empire" ? null : authority.emperorOf(id),
      membersOf: (id: string) =>
        id === "r5_fog_empire" ? [] : authority.membersOf(id),
    }));
    try {
      const revoked = collectLiveNationalObservation(game, viewer.id);
      expect(
        revoked.observation.visibleAssets.some(
          (item) => item.id === String(hostileShip.id()),
        ),
      ).toBe(false);
      expect(
        advanceLastKnown(revoked.observation, saved, 60).stale.some(
          (item) => item.id === String(hostileShip.id()),
        ),
      ).toBe(false);
      runner.addTurn({ turnNumber: game.ticks(), intents: [] });
      expect(runner.executeNextTick()).toBe(true);
      const packet = packets[packets.length - 1];
      expect(JSON.stringify(packet)).not.toContain("8765432");
    } finally {
      spy.mockRestore();
    }

    const viewerFilter = new NationalOutboundFilter(game, viewer.id);
    const unknownFilter = new NationalOutboundFilter(game, null);
    expect(() => unknownFilter.restoreSightMemory(saved)).toThrow(
      /principal mismatch/,
    );
    viewerFilter.restoreSightMemory(saved);
    const detached = viewerFilter.snapshotSightMemory();
    expect(detached).not.toBe(saved);

    const { restored } = await roundTrip(game, "plains");
    const foreign = new NationalOutboundFilter(restored, enemy.id);
    expect(() => foreign.restoreSightMemory(detached)).toThrow(
      /principal mismatch/,
    );
    expect(
      restored.nationalPoliticalAuthority()?.emperorOf("r5_fog_empire"),
    ).toBe(viewer.id);
  });
});
