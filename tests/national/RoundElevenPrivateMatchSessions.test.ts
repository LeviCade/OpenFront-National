/**
 * R11 E2 class three — authenticated PRIVATE NATIONAL server-turn replication.
 * These are two INDEPENDENT game simulations (the actual network architecture),
 * not multiple principals sharing one Game object or a fake second Solo browser.
 * The server stamps the actor; both viewers apply the same authoritative turn,
 * while each GameRunner projects only its own E3 recipient-private receipt.
 *
 * The complete two-browser WebSocket/E4 UI/GPU check remains a separate gate.
 */
import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { StampedIntentSchema, type Turn } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const MATCH = "r11-shared-private";
const PLAYERS = [
  new PlayerInfo("Human A", PlayerType.Human, "R11PRIVCA", "R11PRIVPA"),
  new PlayerInfo("Human B", PlayerType.Human, "R11PRIVCB", "R11PRIVPB"),
];
const [A, B] = PLAYERS.map((x) => x.id);
const [CA, CB] = PLAYERS.map((x) => x.clientID!);

async function independentGame(): Promise<Game> {
  const game = await setup(
    "plains",
    { nationalMode: true, gameType: GameType.Private, gameMode: GameMode.FFA },
    PLAYERS,
  );
  game.addExecution(
    new SpawnExecution(MATCH, PLAYERS[0], game.ref(20, 20)),
    new SpawnExecution(MATCH, PLAYERS[1], game.ref(80, 80)),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const p of PLAYERS) expect(game.player(p.id).hasSpawned()).toBe(true);
  return game;
}

function seat(game: Game, clientID: string) {
  const packets: GameUpdateViewData[] = [];
  const errors: string[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, MATCH, clientID),
    (msg) => {
      if ("updates" in msg) packets.push(msg);
      else errors.push(msg.errMsg);
    },
    clientID,
  );
  return { runner, packets, errors };
}

function committedTurn(
  current: number,
  clientID?: string,
  request?: Record<string, unknown>,
): Turn {
  return {
    turnNumber: current,
    intents: clientID && request
      ? [StampedIntentSchema.parse({ ...request, clientID })]
      : [],
  };
}

function replicate(
  leftGame: Game,
  leftRunner: GameRunner,
  rightGame: Game,
  rightRunner: GameRunner,
  clientID?: string,
  request?: Record<string, unknown>,
) {
  // The GameServer owns the shared match and broadcasts this exact same
  // committed turn; each worker has its own simulation and viewer identity.
  expect(leftGame.ticks()).toBe(rightGame.ticks());
  const turn = committedTurn(leftGame.ticks(), clientID, request);
  leftRunner.addTurn(turn);
  rightRunner.addTurn(turn);
  expect(leftRunner.executeNextTick()).toBe(true);
  expect(rightRunner.executeNextTick()).toBe(true);
  expect(leftGame.ticks()).toBe(rightGame.ticks());
  expect(leftGame.nationalPublicPoliticalView()).toEqual(
    rightGame.nationalPublicPoliticalView(),
  );
}

function command(
  left: Game,
  leftRunner: GameRunner,
  right: Game,
  rightRunner: GameRunner,
  actor: string,
  request: Record<string, unknown>,
) {
  replicate(left, leftRunner, right, rightRunner, actor, request);
  replicate(left, leftRunner, right, rightRunner);
}

function results(packets: readonly GameUpdateViewData[]) {
  return packets.flatMap((p) => p.nationalCommandResults ?? []);
}

describe("R11 E2 shared PRIVATE NATIONAL turn replication", () => {
  it("accepts other registered players' server-broadcast turns, rejects unknown actors, and leaves private RPCs actor-only", async () => {
    const a = await independentGame();
    const b = await independentGame();
    const viewerA = seat(a, CA);
    const viewerB = seat(b, CB);

    expect(viewerA.runner.isNationalIntentAuthorized(CA)).toBe(true);
    expect(viewerA.runner.isNationalIntentAuthorized(CB)).toBe(false);
    expect(viewerA.runner.isNationalBroadcastTurnAuthorized(CA)).toBe(true);
    expect(viewerA.runner.isNationalBroadcastTurnAuthorized(CB)).toBe(true);
    expect(viewerB.runner.isNationalBroadcastTurnAuthorized(CA)).toBe(true);
    expect(viewerB.runner.isNationalBroadcastTurnAuthorized("UNLISTED")).toBe(false);
    expect(viewerA.runner.isNationalRequesterAuthorized(B)).toBe(false);
    expect(viewerB.runner.isNationalRequesterAuthorized(A)).toBe(false);

    command(a, viewerA.runner, b, viewerB.runner, CA, {
      type: "national_found_empire",
      empireId: "R11PRIVATEEMPIRE",
      requestId: "r11_private_found",
    });
    expect(results(viewerA.packets).filter(
      (r) => r.requestId === "r11_private_found",
    )).toEqual([
      expect.objectContaining({
        type: "national_found_empire",
        actorId: A,
        recipientId: A,
        accepted: true,
      }),
    ]);
    expect(results(viewerB.packets).some(
      (r) => r.requestId === "r11_private_found",
    )).toBe(false);
    expect(a.nationalPublicPoliticalView()?.empires).toEqual(
      b.nationalPublicPoliticalView()?.empires,
    );

    command(a, viewerA.runner, b, viewerB.runner, CA, {
      type: "national_offer_empire",
      empireId: "R11PRIVATEEMPIRE",
      candidateId: B,
      requestId: "r11_private_offer",
    });
    command(a, viewerA.runner, b, viewerB.runner, CB, {
      type: "national_accept_empire",
      empireId: "R11PRIVATEEMPIRE",
      candidateId: B,
      requestId: "r11_private_accept",
    });
    expect(a.nationalPoliticalAuthority()?.membersOf("R11PRIVATEEMPIRE")).toEqual(
      [A, B].sort(),
    );
    expect(b.nationalPoliticalAuthority()?.membersOf("R11PRIVATEEMPIRE")).toEqual(
      [A, B].sort(),
    );
    expect(results(viewerA.packets).some(
      (r) => r.requestId === "r11_private_accept",
    )).toBe(false);
    expect(results(viewerB.packets).some(
      (r) => r.requestId === "r11_private_accept" && r.recipientId === B && r.accepted,
    )).toBe(true);
    expect(viewerA.errors).toEqual([]);
    expect(viewerB.errors).toEqual([]);

    // Public world remains identical between peers; recipient-private E1
    // sight/journal snapshot components are intentionally NOT cross-equal.
    const before = a.nationalPublicPoliticalView();
    const { restored, bytes, again } = await roundTrip(a, "plains");
    expect(bytes).toEqual(again);
    expect(restored.nationalPublicPoliticalView()).toEqual(before);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(a));
  });

  it("preserves strict SOLO local actor admission and rejects unknown principals", async () => {
    const solo = await setup("plains", {
      nationalMode: true,
      gameType: GameType.Singleplayer,
    }, PLAYERS);
    const viewerA = seat(solo, CA);
    expect(viewerA.runner.isNationalBroadcastTurnAuthorized(CA)).toBe(true);
    expect(viewerA.runner.isNationalBroadcastTurnAuthorized(CB)).toBe(false);
    expect(viewerA.runner.isNationalBroadcastTurnAuthorized("UNLISTED")).toBe(false);
    expect(viewerA.runner.isNationalRequesterAuthorized(B)).toBe(false);
  });
});
