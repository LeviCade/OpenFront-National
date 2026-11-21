/**
 * R10 E2: two actual NationExecutions in the real Game/GameRunner.
 * No fake attack service, synthetic command receipt or duplicate war state.
 */
import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { initialNationalPlannerMemory } from "@openfront/engine/national/ai/NationalPlanner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const A = "R10BOTA1";
const B = "R10BOTB1";
const H = "R10HUMAN";
const CLIENT = "R10CLNT1";
const a = new PlayerInfo("Alpha", PlayerType.Nation, null, A);
const b = new PlayerInfo("Bravo", PlayerType.Nation, null, B);
const human = new PlayerInfo("Charlie", PlayerType.Human, CLIENT, H);
const nationA = new Nation(new Cell(15, 25), a);
const nationB = new Nation(new Cell(55, 25), b);
const gameID = "r10-bot-bridge";

async function seeded(): Promise<{
  game: Game;
  alpha: NationExecution;
  bravo: NationExecution;
}> {
  const game = await setup(
    "plains",
    { nationalMode: true },
    [human],
    undefined,
    undefined,
    true,
    [nationA, nationB],
  );
  const alpha = new NationExecution(gameID, nationA);
  const bravo = new NationExecution(gameID, nationB);
  game.addExecution(
    alpha,
    bravo,
    new SpawnExecution(gameID, a, game.ref(15, 25)),
    new SpawnExecution(gameID, b, game.ref(55, 25)),
    new SpawnExecution(gameID, human, game.ref(85, 85)),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const id of [A, B, H])
    expect(game.player(id).hasSpawned()).toBe(true);

  // Every passable land tile has a REAL owner, preventing the AI from
  // confusing unclaimed-map expansion with a legally required declaration.
  // Alpha/Beta/Human share ordinary passable national borders.
  const first = Math.floor(game.width() * 0.35);
  const second = Math.floor(game.width() * 0.7);
  for (let y = 0; y < game.height(); y++) {
    for (let x = 0; x < game.width(); x++) {
      const tile = game.ref(x, y);
      if (!game.isLand(tile) || game.isImpassable(tile)) continue;
      const id = x < first ? A : x < second ? B : H;
      game.player(id).conquer(tile);
    }
  }
  game.player(A).setTroops(260_000);
  game.player(B).setTroops(240_000);
  game.player(H).setTroops(180_000);
  return { game, alpha, bravo };
}

function humanTurn(
  game: Game,
  runner: GameRunner,
  command?: Record<string, unknown>,
): void {
  runner.addTurn({
    turnNumber: game.ticks(),
    intents:
      command === undefined ? [] : [StampedIntentSchema.parse(command)],
  });
  expect(runner.executeNextTick()).toBe(true);
}

describe("R10 E2 real NationExecution -> E1 outcome -> AttackExecution", () => {
  it(
    "two bots, one authenticated human, canonical WAR and real combat remain replayable",
    async () => {
    const { game } = await seeded();
    const seen = collectLiveNationalObservation(game, A).observation;
    expect(seen.frontiers.some((front) => front.targetId === B)).toBe(true);
    expect(seen.nations.find((nation) => nation.id === H)).not.toHaveProperty(
      "troops",
    );
    const humanRunner = new GameRunner(
      game,
      new Executor(game, gameID, undefined),
      () => {},
      CLIENT,
    );
    const declarations = vi.spyOn(game, "performNationalWarCommandWithOutcome");
    const beforeAlpha = game.player(A).troops();
    const beforeTiles = game.player(A).numTilesOwned();
    humanTurn(game, humanRunner, {
      type: "national_found_empire",
      empireId: "r10_human_empire",
      requestId: "r10_human_found",
      clientID: CLIENT,
    });
    humanTurn(game, humanRunner);
    expect(
      game.nationalCommandResults(game.player(H)).find(
        (row) => row.requestId === "r10_human_found",
      )?.accepted,
    ).toBe(true);
    expect(game.nationalPublicPoliticalView()?.empires).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "r10_human_empire", leaderId: H }),
      ]),
    );

    let acceptedBotWar = false;
    for (let i = 0; i < 48; i++) {
      humanTurn(game, humanRunner);
      acceptedBotWar ||= declarations.mock.results.some(
        (result, index) =>
          result.type === "return" &&
          result.value?.accepted === true &&
          result.value?.commandKind === "national_declare_war" &&
          declarations.mock.calls[index][0].id() === A &&
          result.value?.commandTargetId === B,
      );
      if (
        acceptedBotWar &&
        (game.player(A).troops() < beforeAlpha ||
          game.player(A).numTilesOwned() > beforeTiles)
      )
        break;
    }
    declarations.mockRestore();
    expect(acceptedBotWar).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(A, B)).toBe(true);
    // The ordinary engine must debit an actual Player or take real tiles.
    expect(
      game.player(A).troops() < beforeAlpha ||
        game.player(A).numTilesOwned() > beforeTiles,
    ).toBe(true);

    const active = game.nationalWarState()!.wars.layers.find(
      (layer) =>
        layer.endedTick === null &&
        layer.first.kind === "nation" &&
        layer.first.id === A &&
        layer.second.kind === "nation" &&
        layer.second.id === B,
    );
    expect(active).toBeDefined();
    const proposed = game.performNationalWarCommandWithOutcome(
      game.player(A),
      {
        kind: "propose-peace",
        warId: active!.id,
        motionId: "r10_bridge_peace",
      },
    );
    expect(proposed.accepted).toBe(true);
    const settled = game.performNationalWarCommandWithOutcome(
      game.player(B),
      { kind: "accept-peace", motionId: "r10_bridge_peace" },
    );
    expect(settled.accepted).toBe(true);
    expect(game.nationalWarAuthority()!.atWar(A, B)).toBe(false);
    const paidTroops = game.player(A).troops();
    const postPeaceAttack = new AttackExecution(15_000, game.player(A), B);
    postPeaceAttack.init(game, game.ticks());
    expect(postPeaceAttack.isActive()).toBe(false);
    expect(game.player(A).troops()).toBe(paidTroops);

    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    for (let i = 0; i < 6; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    const final = await roundTrip(game, "plains");
    const replayed = await roundTrip(restored, "plains");
    expect([...final.bytes]).toEqual([...replayed.bytes]);
    },
  );

  it("roundtrips E3's bounded rejection memory without altering E2 troop or WAR ledgers", async () => {
    const { game, alpha } = await seeded();
    const withheld = {
      ...initialNationalPlannerMemory(A),
      nextPlanningTick: game.ticks() + 60,
      rejectedWarTargets: [
        { targetId: B, retryAfterTick: game.ticks() + 180 },
      ],
      lastWarOutcomeSequence: 9,
    };
    // Isolate the E2-owned snapshot codec: this is input state from the E3
    // planner, not fabricated combat or a synthetic Game receipt.
    Object.assign(alpha, { nationalPlannerMemory: withheld });
    const troopBefore = game.player(A).troops();
    const warBefore = game.nationalWarState();
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    const restoredBot = restored.executions().find(
      (exec) => exec instanceof NationExecution && exec.playerID() === A,
    );
    expect(restoredBot).toBeDefined();
    const memory = (
      restoredBot as unknown as {
        nationalPlannerMemory: typeof withheld | null;
      }
    ).nationalPlannerMemory;
    expect(memory?.rejectedWarTargets).toEqual(withheld.rejectedWarTargets);
    expect(memory?.lastWarOutcomeSequence).toBe(9);
    expect(restored.player(A).troops()).toBe(troopBefore);
    expect(restored.nationalWarState()).toEqual(warBefore);
  });
});
