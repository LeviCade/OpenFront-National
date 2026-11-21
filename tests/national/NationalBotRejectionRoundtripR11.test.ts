/**
 * R11 E3: complete real NationExecution rejected-declaration feedback loop.
 *
 * A genuine E1 WAR ID already belongs to an unrelated live C->D war. The AI
 * independently computes the same deterministic ID for its observed A->B
 * campaign, receives a real Game WAR-rule rejection, and must switch to its
 * other observed legal A->C frontier. We never stub the Game authority or
 * inject a synthetic outcome/planner memory.
 */
import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { simpleHash } from "@openfront/engine-lib/Util";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import {
  initialNationalPlannerMemory,
  planNationalInterest,
  type NationalPlannerMemory,
} from "@openfront/engine/national/ai/NationalPlanner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const A = "r11-bot-alpha";
const B = "r11-front-bravo";
const C = "r11-front-charlie";
const D = "r11-far-delta";
const botInfo = new PlayerInfo("Independent AI", PlayerType.Nation, null, A);
const bInfo = new PlayerInfo("Bravo", PlayerType.Human, "r11-b-cli", B);
const cInfo = new PlayerInfo("Charlie", PlayerType.Human, "r11-c-cli", C);
const dInfo = new PlayerInfo("Delta", PlayerType.Human, "r11-d-cli", D);
const nation = new Nation(new Cell(40, 45), botInfo);

type PlannerOwner = NationExecution & {
  readonly nationalPlannerMemory: NationalPlannerMemory | null;
};

async function match(): Promise<{
  game: Game;
  bot: NationExecution;
}> {
  const game = await setup(
    "plains", { nationalMode: true }, [bInfo, cInfo, dInfo],
    undefined, undefined, true, [nation],
  );
  const bot = new NationExecution("r11-real-bot-rejection", nation);
  game.addExecution(
    bot,
    new SpawnExecution("r11-real-bot-rejection", botInfo, game.ref(40, 45)),
    new SpawnExecution("r11-real-bot-rejection", bInfo, game.ref(15, 45)),
    new SpawnExecution("r11-real-bot-rejection", cInfo, game.ref(72, 45)),
    new SpawnExecution("r11-real-bot-rejection", dInfo, game.ref(90, 45)),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const id of [A, B, C, D])
    expect(game.player(id).hasSpawned()).toBe(true);
  // No fabricated frontiers: these are actual game cells and PlayerImpl
  // ownership. Both B and C touch A; D does not.
  const bEnd = Math.floor(game.width() * 0.22);
  const aEnd = Math.floor(game.width() * 0.5);
  const cEnd = Math.floor(game.width() * 0.78);
  for (let y = 0; y < game.height(); y++) {
    for (let x = 0; x < game.width(); x++) {
      const tile = game.ref(x, y);
      if (!game.isLand(tile) || game.isImpassable(tile)) continue;
      const owner = x < bEnd ? B : x < aEnd ? A : x < cEnd ? C : D;
      game.player(owner).conquer(tile);
    }
  }
  for (const [id, troopCount] of [
    [A, 260_000],
    [B, 240_000],
    [C, 235_000],
    [D, 230_000],
  ] as const)
    game.player(id).setTroops(troopCount);
  return { game, bot };
}

function live(game: Game) {
  return collectLiveNationalObservation(game, A).observation;
}
function memory(bot: NationExecution): NationalPlannerMemory | null {
  // Inspect the real E2 NationExecution memory to prove ordinary-tick
  // consumption, never write the field or fabricate an E1 command receipt.
  return (bot as PlannerOwner).nationalPlannerMemory;
}

describe("R11 actual E1 rejection -> E3 cooldown -> E2 alternate attack", () => {
  it("two observed legal enemies, rejected canonical WAR receipt, alternative action and deterministic snapshot continuation", async () => {
    const { game, bot } = await match();
    const observed = live(game);
    expect(observed.unownedFrontier).toBe(false);
    expect(observed.frontiers.some((f) => f.targetId === B)).toBe(true);
    expect(observed.frontiers.some((f) => f.targetId === C)).toBe(true);
    expect(observed.frontiers.some((f) => f.targetId === D)).toBe(false);
    const wanted = planNationalInterest(
      observed, initialNationalPlannerMemory(A), 30,
    );
    expect(wanted.decision).toMatchObject({
      objective: "expand", targetId: B,
    });
    expect(memory(bot)?.rejectedWarTargets ?? []).toEqual([]);

    // A deterministically derives this war ID on its NEXT ordinary bot
    // tick. Reserve it in the real WarLedger by a valid different C->D
    // declaration. WarLedger refuses ANY reuse, even across different
    // national belligerents, without special test-only rejection hooks.
    const decisionTick = game.ticks();
    const collisionId = "ai_" + simpleHash(A + ":" + B + ":" + decisionTick);
    const genuineExistingWar = game.performNationalWarCommandWithOutcome(
      game.player(C), {
        kind: "declare-national",
        warId: collisionId,
        aggressorId: C,
        targetId: D,
      }, "r11-collision-authority",
    );
    expect(genuineExistingWar.accepted).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(C, D)).toBe(true);

    const declarationCalls = vi.spyOn(game, "performNationalWarCommandWithOutcome");
    const attackCalls = vi.spyOn(game, "addExecution");
    game.executeNextTick();
    const observedAttempts = declarationCalls.mock.results.flatMap(
      (result, index) => {
        const [actor, command] = declarationCalls.mock.calls[index];
        return actor.id() === A &&
          command.kind === "declare-national" &&
          result.type === "return" ? [result.value] : [];
      },
    );
    expect(observedAttempts).toHaveLength(1);
    const rejected = observedAttempts[0];
    expect(rejected).toMatchObject({
      actorId: A,
      recipientId: A,
      commandKind: "national_declare_war",
      commandTargetId: B,
      accepted: false,
      reason: "war-rule",
      tick: decisionTick,
    });
    expect(rejected.warId).toBeUndefined();
    expect(game.nationalWarAuthority()?.atWar(A, B)).toBe(false);
    expect(memory(bot)?.lastWarOutcomeSequence).toBe(rejected.sequence);
    expect(memory(bot)?.rejectedWarTargets).toEqual([
      { targetId: B, retryAfterTick: decisionTick + 180 },
    ]);

    const alternativeDecision = planNationalInterest(
      live(game), memory(bot)!, 30,
    );
    expect(alternativeDecision.decision).toMatchObject({
      objective: "expand", targetId: C,
    });
    expect(alternativeDecision.decision?.targetId).not.toBe(D);

    // Ordinary Game ticks call the real E2 NationExecution hook again; no
    // direct test invocation of recordNationalWarOutcome() or AttackExecution.
    for (let i = 0; i < 12; i++) {
      game.executeNextTick();
      if (game.nationalWarAuthority()?.atWar(A, C)) break;
    }
    const acceptedAlternative = declarationCalls.mock.results.some(
      (result, index) => {
        const [actor, command] = declarationCalls.mock.calls[index];
        return actor.id() === A &&
          command.kind === "declare-national" &&
          command.targetId === C &&
          result.type === "return" &&
          result.value?.accepted === true &&
          result.value?.commandTargetId === C;
      },
    );
    expect(acceptedAlternative).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(A, C)).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(A, B)).toBe(false);
    expect(
      attackCalls.mock.calls.flat().some(
        (execution) => execution instanceof AttackExecution,
      ),
    ).toBe(true);
    declarationCalls.mockRestore();
    attackCalls.mockRestore();
    expect(memory(bot)?.rejectedWarTargets).toEqual([
      { targetId: B, retryAfterTick: decisionTick + 180 },
    ]);

    const original = await roundTrip(game, "plains");
    expect([...original.bytes]).toEqual([...original.again]);
    const restoredBot = original.restored.executions().find(
      (exec) => exec instanceof NationExecution && exec.playerID() === A,
    ) as NationExecution | undefined;
    expect(restoredBot).toBeDefined();
    expect(memory(restoredBot!)).toEqual(memory(bot));

    // The same authoritative world and persisted bot PRNG/memory produce
    // identical GameSnapshots after further ordinary simulation turns.
    for (let i = 0; i < 8; i++) {
      game.executeNextTick();
      original.restored.executeNextTick();
    }
    const a = await roundTrip(game, "plains");
    const b = await roundTrip(original.restored, "plains");
    expect([...a.bytes]).toEqual([...b.bytes]);
  });
});
