import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../../util/Setup";
import { roundTrip } from "../../util/Snapshot";

const alpha = new PlayerInfo(
  "E5 Alpha",
  PlayerType.Human,
  "e5-r10-session-alpha",
  "e5-r10-alpha",
);
const bravo = new PlayerInfo(
  "E5 Bravo",
  PlayerType.Human,
  "e5-r10-session-bravo",
  "e5-r10-bravo",
);
const charlie = new PlayerInfo(
  "E5 Charlie",
  PlayerType.Nation,
  null,
  "e5-r10-charlie",
);
const seed = "e5-r10-independent";

async function spawned(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, [
    alpha,
    bravo,
    charlie,
  ]);
  game.addExecution(
    new SpawnExecution(seed, alpha, game.ref(20, 20)),
    new SpawnExecution(seed, bravo, game.ref(75, 75)),
    new SpawnExecution(seed, charlie, game.ref(25, 75)),
  );
  game.executeNextTick();
  game.executeNextTick();
  for (const player of [alpha, bravo, charlie]) {
    expect(game.player(player.id).hasSpawned()).toBe(true);
  }
  return game;
}

function observedPrincipal(game: Game, clientID?: string) {
  const packets: GameUpdateViewData[] = [];
  // Create recipient-bound delivery cursor BEFORE the new command. Constructing
  // it after the command intentionally discards prior journal receipts.
  const runner = new GameRunner(
    game,
    new Executor(game, seed, clientID),
    (event) => {
      if ("updates" in event) packets.push(event);
    },
    clientID,
  );
  return {
    packets,
    next() {
      game.queueViewResync();
      runner.addTurn({ turnNumber: game.ticks(), intents: [] });
      expect(runner.executeNextTick()).toBe(true);
      expect(packets.length).toBeGreaterThan(0);
      return packets;
    },
  };
}

describe("R10 independent GameRunner hostile authority and replay canaries", () => {
  it("does not disclose another player's positive WAR result to foreign or unbound workers", async () => {
    const game = await spawned();
    const alphaView = observedPrincipal(game, alpha.clientID!);
    const bravoView = observedPrincipal(game, bravo.clientID!);
    const anonymousView = observedPrincipal(game, undefined);
    const war = game.performNationalWarCommandWithOutcome(
      game.player(alpha.id),
      {
        kind: "declare-national",
        warId: "e5-war:active:1",
        aggressorId: alpha.id,
        targetId: bravo.id,
        requestId: "e5-r10-actual-request",
      },
    );
    expect(war).toMatchObject({
      accepted: true,
      actorId: alpha.id,
      recipientId: alpha.id,
      requestId: "e5-r10-actual-request",
    });
    const alphaPackets = alphaView.next();
    const alphaOutcomes = alphaPackets.flatMap(
      (packet) => packet.nationalCommandResults ?? [],
    );
    expect(alphaOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: "e5-r10-actual-request",
          actorId: alpha.id,
          recipientId: alpha.id,
          accepted: true,
        }),
      ]),
    );
    for (const [clientID, view] of [
      [bravo.clientID!, bravoView],
      [undefined, anonymousView],
    ] as const) {
      const foreignPackets = view.next();
      const foreignOutcomes = foreignPackets.flatMap(
        (packet) => packet.nationalCommandResults ?? [],
      );
      expect(
        foreignOutcomes.some(
          (result) => result.requestId === "e5-r10-actual-request",
        ),
      ).toBe(false);
      if (clientID === undefined) {
        expect(
          foreignPackets.every(
            (packet) =>
              packet.packedPlayerUpdates === undefined &&
              packet.packedUnitUpdates === undefined &&
              packet.packedTileUpdates.length === 0,
          ),
        ).toBe(true);
      }
    }
  });

  it("rejects forged Game actor identity, cross-principal token collisions and snapshot replay without a second WAR", async () => {
    const game = await spawned();
    const token = "e5-r10-replay";
    const command = {
      kind: "declare-national" as const,
      warId: "e5-war:one",
      aggressorId: alpha.id,
      targetId: bravo.id,
      requestId: token,
    };
    const accepted = game.performNationalWarCommandWithOutcome(
      game.player(alpha.id),
      command,
    );
    expect(accepted.accepted).toBe(true);
    expect(game.nationalWarState()?.wars.layers).toHaveLength(1);
    const original = snapshotGameData(game);
    expect(() =>
      game.performNationalWarCommandWithOutcome(
        new Proxy(game.player(alpha.id), {}),
        { ...command, requestId: "e5-r10-forged" },
      ),
    ).toThrow(/forged actor/);
    expect(() =>
      game.performNationalWarCommandWithOutcome(game.player(bravo.id), {
        ...command,
        aggressorId: bravo.id,
        requestId: token,
      }),
    ).toThrow(/reused foreign request ID/);
    expect(snapshotGameData(game)).toEqual(original);

    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    for (const current of [game, restored]) {
      expect(
        current.performNationalWarCommandWithOutcome(current.player(alpha.id), {
          ...command,
          warId: "e5-war:forged-new-layer",
        }),
      ).toEqual(accepted);
      expect(current.nationalWarState()?.wars.layers).toHaveLength(1);
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });
});
