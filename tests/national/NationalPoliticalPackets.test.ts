import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const north = new PlayerInfo(
  "North",
  PlayerType.Human,
  "north-client",
  "north-id",
);
const south = new PlayerInfo(
  "South",
  PlayerType.Human,
  "south-client",
  "south-id",
);
type PoliticalPacket = GameUpdateViewData & {
  nationalPolitics?: NonNullable<
    ReturnType<Game["nationalPublicPoliticalView"]>
  >;
};
async function populated(nationalMode = true) {
  const game = await setup("plains", { nationalMode }, [north, south]);
  game.addExecution(
    new SpawnExecution("e3-r5-politics", north, game.ref(15, 15)),
    new SpawnExecution("e3-r5-politics", south, game.ref(85, 85)),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  return game;
}
function runnerFor(game: Game, clientId: string | undefined) {
  const packets: PoliticalPacket[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, "e3-r5-politics", clientId),
    (packet) => {
      // E1 public politics and E2's wire DTO intentionally use different
      // mutability boundaries. The worker callback supplies the real E2
      // GameUpdateViewData; tests project only E3-observed public fields.
      if ("updates" in packet) packets.push(packet as PoliticalPacket);
    },
    clientId,
  );
  const next = () => {
    runner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(runner.executeNextTick()).toBe(true);
    return packets[packets.length - 1];
  };
  return { next, packets, runner };
}
describe("Round Five real GameRunner public NATIONAL political packets", () => {
  it("does not announce an empire when a command is only queued, but exposes the actual resulting roster after execution", async () => {
    const game = await populated();
    const northRunner = runnerFor(game, north.clientID!);
    expect(northRunner.next().nationalPolitics?.empires).toEqual([]);
    game.addExecution(
      new Executor(game, "e3-r5-politics", north.clientID!).createExec({
        type: "national_found_empire",
        empireId: "north_kingdom",
        clientID: north.clientID!,
      }),
    );
    const queued = northRunner.next();
    expect(queued.nationalPolitics?.empires).toEqual([]);
    expect(queued).not.toHaveProperty("nationalCommandResults");
    const executed = northRunner.next();
    if (
      typeof (
        game as Game & {
          nationalCommandResults?: (
            actor: ReturnType<Game["player"]>,
          ) => readonly unknown[];
        }
      ).nationalCommandResults === "function"
    ) {
      expect(executed).toHaveProperty("nationalCommandResults");
      const accepted = (
        executed as PoliticalPacket & {
          nationalCommandResults?: readonly {
            recipientId: string;
            actorId: string;
            accepted: boolean;
            empireId?: string;
            type: string;
            reason?: string;
          }[];
        }
      ).nationalCommandResults;
      expect(accepted).toEqual([
        expect.objectContaining({
          recipientId: north.id,
          actorId: north.id,
          type: "national_found_empire",
          empireId: "north_kingdom",
          accepted: true,
          reason: "accepted",
        }),
      ]);
      const southPacket = runnerFor(game, south.clientID!).next();
      const spectatorPacket = runnerFor(game, undefined).next();
      expect(southPacket).not.toHaveProperty("nationalCommandResults");
      expect(spectatorPacket).not.toHaveProperty("nationalCommandResults");
      // A fresh runner sees the roster, never a stale accepted toast.
      expect(runnerFor(game, north.clientID!).next()).not.toHaveProperty(
        "nationalCommandResults",
      );
    }
    expect(executed.nationalPolitics?.empires).toEqual([
      {
        id: "north_kingdom",
        leaderId: north.id,
        memberIds: [north.id],
      },
    ]);
    expect(executed.nationalPolitics).toEqual(
      game.nationalPublicPoliticalView(),
    );
    expect(JSON.stringify(executed.nationalPolitics)).not.toContain("treasury");
    expect(JSON.stringify(executed.nationalPolitics)).not.toContain("troops");
    expect(JSON.stringify(executed.nationalPolitics)).not.toContain("terms");
  });

  it("E1 executed duplicate founding rejection is emitted once to the current actor, never on enqueue", async () => {
    const game = await populated();
    const stream = runnerFor(game, north.clientID!);
    const executor = new Executor(game, "e3-r5-politics", north.clientID!);
    // Actor-bound Game journal is optional only until E1 R5 merges.
    const supportsJournal =
      typeof (
        game as Game & {
          nationalCommandResults?: unknown;
        }
      ).nationalCommandResults === "function";
    for (let attempt = 0; attempt < 2; attempt++) {
      game.addExecution(
        executor.createExec({
          type: "national_found_empire",
          empireId: "duplicate_kingdom",
          clientID: north.clientID!,
        }),
      );
      const pending = stream.next();
      expect(pending).not.toHaveProperty("nationalCommandResults");
      const processed = stream.next() as PoliticalPacket & {
        nationalCommandResults?: readonly {
          recipientId: string;
          accepted: boolean;
          reason?: string;
          empireId?: string;
        }[];
      };
      if (supportsJournal) {
        expect(processed.nationalCommandResults).toEqual([
          expect.objectContaining({
            recipientId: north.id,
            empireId: "duplicate_kingdom",
            accepted: attempt === 0,
            reason: attempt === 0 ? "accepted" : "political-rule",
          }),
        ]);
        expect(stream.next()).not.toHaveProperty("nationalCommandResults");
      }
    }
    expect(game.nationalPublicPoliticalView()?.empires).toHaveLength(1);
  });

  it("public political state is authentic on a new runner and after snapshot restore, without foreign resources", async () => {
    const game = await populated();
    game.player(south.id).setTroops(8_765_432);
    game.player(south.id).addGold(123_456_789n);
    game.performNationalCommand(game.player(north.id), {
      kind: "found-empire",
      empireId: "persisted_kingdom",
    });
    const northPacket = runnerFor(game, north.clientID!).next();
    const southPacket = runnerFor(game, south.clientID!).next();
    const spectator = runnerFor(game, undefined).next();
    for (const packet of [northPacket, southPacket, spectator]) {
      expect(packet.nationalPolitics?.empires[0].id).toBe("persisted_kingdom");
      expect(JSON.stringify(packet.nationalPolitics)).not.toContain("8765432");
      expect(JSON.stringify(packet.nationalPolitics)).not.toContain(
        "123456789",
      );
    }
    expect(JSON.stringify(northPacket)).not.toContain("123456789");
    const { restored } = await roundTrip(game, "plains");
    const resumed = runnerFor(restored, north.clientID!).next();
    expect(resumed.nationalPolitics?.empires).toEqual(
      northPacket.nationalPolitics?.empires,
    );
  });

  it("legacy GameRunner output never gains NATIONAL political fields", async () => {
    const game = await populated(false);
    const packet = runnerFor(game, north.clientID!).next();
    expect(packet).not.toHaveProperty("nationalPolitics");
    expect(packet).not.toHaveProperty("nationalCommandResults");
  });
});
