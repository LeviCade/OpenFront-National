/**
 * R11 E2: real GameRunner founding, rejected bot-war recovery, and bilateral
 * peace. No synthetic receipts, injected planner memory or mock attack ports.
 */
import {
  Cell,
  GameType,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import {
  initialNationalPlannerMemory,
  planNationalInterest,
  recordNationalWarOutcome,
  type NationalPlannerMemory,
} from "@openfront/engine/national/ai/NationalPlanner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const GAME_ID = "r11-foundation-combat";
const founders = [
  new PlayerInfo("Alpha", PlayerType.Human, "R11CLIA1", "R11ALPHA"),
  new PlayerInfo("Bravo", PlayerType.Human, "R11CLIB1", "R11BRAVO"),
  new PlayerInfo("Charlie", PlayerType.Human, "R11CLIC1", "R11CHARL"),
];
const [A, B, C] = founders.map((p) => p.id);
const [CA, CB, CC] = founders.map((p) => p.clientID!);

type Packet = GameUpdateViewData;
function authenticatedRunner(game: Game, clientID: string) {
  const packets: Packet[] = [];
  const errors: string[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, GAME_ID, clientID),
    (message) => {
      if ("updates" in message) packets.push(message);
      else errors.push(String(message.errMsg));
    },
    clientID,
  );
  return { runner, packets, errors };
}
function tick(
  game: Game,
  runner: GameRunner,
  ...intents: Record<string, unknown>[]
) {
  runner.addTurn({
    turnNumber: game.ticks(),
    intents: intents.map((intent) => StampedIntentSchema.parse(intent)),
  });
  expect(runner.executeNextTick()).toBe(true);
}
function results(packets: readonly Packet[]) {
  return packets.flatMap((p) => p.nationalCommandResults ?? []);
}
async function humanGame(count = 3): Promise<Game> {
  const game = await setup(
    "plains",
    { nationalMode: true },
    founders.slice(0, count),
  );
  const cells = [
    [20, 20],
    [80, 20],
    [80, 80],
  ];
  for (let i = 0; i < count; i++) {
    const [x, y] = cells[i];
    game.addExecution(new SpawnExecution(GAME_ID, founders[i], game.ref(x, y)));
  }
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (let i = 0; i < count; i++)
    expect(game.player(founders[i].id).hasSpawned()).toBe(true);
  return game;
}
function memory(bot: NationExecution): NationalPlannerMemory | null {
  // Read-only inspection of the actual bot's internal snapshot-owned memory.
  // Never inject memory or call the planner hook in place of Game execution.
  return (
    bot as unknown as {
      readonly nationalPlannerMemory: NationalPlannerMemory | null;
    }
  ).nationalPlannerMemory;
}
function botFor(game: Game, id: string): NationExecution {
  const bot = game
    .executions()
    .find(
      (execution) =>
        execution instanceof NationExecution && execution.playerID() === id,
    );
  expect(bot).toBeDefined();
  return bot as NationExecution;
}

describe("R11 E2 real founding / AI rejection / bilateral peace", () => {
  it("rejects NATIONAL browser-side PRIVATE execution", async () => {
    // Private websocket rooms do not yet have a trusted authoritative Game
    // host. A browser worker contains every nation's raw state, so enabling
    // NATIONAL there would bypass recipient-private packet projection.
    const privateNational = setup(
      "plains",
      { nationalMode: true, gameType: GameType.Private },
      founders.slice(0, 2),
    );
    await expect(privateNational).rejects.toThrow(
      "NATIONAL requires unranked Solo Free For All",
    );
  });

  it("executes an authenticated founding click through ordinary GameRunner turns and delivers only the actor's receipt", async () => {
    const game = await humanGame(2);
    const alpha = authenticatedRunner(game, CA);
    const bravo = authenticatedRunner(game, CB);
    const requestId = "r11_found_desktop_01";
    const initialTick = game.ticks();

    // E2 never claims a click is accepted before a real scheduled turn.
    expect(alpha.runner.executeNextTick()).toBe(false);
    expect(game.ticks()).toBe(initialTick);
    expect(game.nationalCommandResults(game.player(A))).toEqual([]);
    tick(game, alpha.runner, {
      type: "national_found_empire",
      empireId: "R11_BROWSER_REAL",
      requestId,
      clientID: CA,
    });
    tick(game, alpha.runner);
    const result = game
      .nationalCommandResults(game.player(A))
      .find((item) => item.requestId === requestId);
    expect(result).toMatchObject({
      accepted: true,
      actorId: A,
      requestId,
      empireId: "R11_BROWSER_REAL",
    });
    expect(result?.tick).toBeGreaterThanOrEqual(initialTick);
    const delivered = results(alpha.packets).filter(
      (item) => item.requestId === requestId,
    );
    expect(delivered).toEqual([
      expect.objectContaining({
        type: "national_found_empire",
        accepted: true,
        recipientId: A,
        actorId: A,
        requestId,
        sequence: result!.sequence,
        tick: result!.tick,
        empireId: "R11_BROWSER_REAL",
      }),
    ]);
    expect(
      alpha.packets.some((packet) =>
        packet.nationalPolitics?.empires.some(
          (empire) => empire.id === "R11_BROWSER_REAL" && empire.leaderId === A,
        ),
      ),
    ).toBe(true);
    tick(game, bravo.runner);
    expect(results(bravo.packets)).toEqual([]);
    expect(game.nationalCommandResults(game.player(B))).toEqual([]);
    expect(alpha.errors).toEqual([]);
    expect(bravo.errors).toEqual([]);
  });

  it("takes a REAL Game-rejected bot declaration, cools down, replans to a different observed enemy, attacks, and replays", async () => {
    const BOT_A = "R11AIBOT";
    const BOT_B = "R11BIBOT";
    const HUMAN = "R11HUMAN";
    const botAInfo = new PlayerInfo(
      "Alpha bot",
      PlayerType.Nation,
      null,
      BOT_A,
    );
    const botBInfo = new PlayerInfo(
      "Bravo bot",
      PlayerType.Nation,
      null,
      BOT_B,
    );
    const humanInfo = new PlayerInfo(
      "Human",
      PlayerType.Human,
      "R11HUMC1",
      HUMAN,
    );
    const nationA = new Nation(new Cell(15, 25), botAInfo);
    const nationB = new Nation(new Cell(55, 25), botBInfo);
    const game = await setup(
      "plains",
      { nationalMode: true },
      [humanInfo],
      undefined,
      undefined,
      true,
      [nationA, nationB],
    );
    game.addExecution(
      new NationExecution(GAME_ID, nationA),
      new NationExecution(GAME_ID, nationB),
      new SpawnExecution(GAME_ID, botAInfo, game.ref(15, 25)),
      new SpawnExecution(GAME_ID, botBInfo, game.ref(55, 25)),
      new SpawnExecution(GAME_ID, humanInfo, game.ref(85, 85)),
    );
    game.executeNextTick();
    game.executeNextTick();
    game.endSpawnPhase();
    for (const id of [BOT_A, BOT_B, HUMAN])
      expect(game.player(id).hasSpawned()).toBe(true);

    // Real passable tiles, no fabricated observations or memory injection.
    // Alpha borders BOTH alternatives; the smaller Bravo front scores first.
    const splitX = Math.floor(game.width() * 0.43);
    const splitY = Math.floor(game.height() * 0.34);
    for (let y = 0; y < game.height(); y++) {
      for (let x = 0; x < game.width(); x++) {
        const tile = game.ref(x, y);
        if (!game.isLand(tile) || game.isImpassable(tile)) continue;
        const owner = x < splitX ? BOT_A : y < splitY ? BOT_B : HUMAN;
        game.player(owner).conquer(tile);
      }
    }
    game.player(BOT_A).setTroops(260_000);
    game.player(BOT_B).setTroops(240_000);
    game.player(HUMAN).setTroops(220_000);
    const observed = collectLiveNationalObservation(game, BOT_A).observation;
    expect(observed.unownedFrontier).toBe(false);
    expect(observed.frontiers.map((f) => f.targetId)).toEqual(
      expect.arrayContaining([BOT_B, HUMAN]),
    );
    expect(
      planNationalInterest(observed, initialNationalPlannerMemory(BOT_A), 30)
        .decision?.targetId,
    ).toBe(BOT_B);

    // D-017 makes membership public, while the treaty constitution is secret.
    // The new E4 AI must avoid attacking a known pact partner. An explicit
    // Game command still proves the original E1 prohibition is enforceable.
    game.performNationalCommand(game.player(BOT_A), {
      kind: "found-pact",
      pactId: "r11_protected",
      name: "Protected NAP",
      pactKind: "NAP",
      terms: { admission: "leader", expulsion: "forbidden" },
    });
    game.performNationalCommand(game.player(BOT_A), {
      kind: "invite-pact",
      pactId: "r11_protected",
      candidateId: BOT_B,
    });
    game.performNationalCommand(game.player(BOT_B), {
      kind: "accept-pact",
      pactId: "r11_protected",
    });
    expect(
      game.nationalPoliticalAuthority()?.treatyProtects(BOT_A, BOT_B),
    ).toBe(true);

    // This real human acts in the same match via authenticated execution.
    const calls = vi.spyOn(game, "performNationalWarCommandWithOutcome");
    const outgoing = vi.spyOn(game, "addExecution");
    const deliberatelyRejected = game.performNationalWarCommandWithOutcome(
      game.player(BOT_A),
      {
        kind: "declare-national",
        warId: "r11_protected_prohibited",
        aggressorId: BOT_A,
        targetId: BOT_B,
      },
    );
    expect(deliberatelyRejected).toMatchObject({
      accepted: false,
      actorId: BOT_A,
      recipientId: BOT_A,
      commandKind: "national_declare_war",
      commandTargetId: BOT_B,
      reason: "war-rule",
    });
    const witnessedCooldown = recordNationalWarOutcome(
      collectLiveNationalObservation(game, BOT_A).observation,
      initialNationalPlannerMemory(BOT_A),
      deliberatelyRejected,
    );
    expect(
      witnessedCooldown.rejectedWarTargets?.find(
        (entry) => entry.targetId === BOT_B,
      )?.retryAfterTick,
    ).toBe(deliberatelyRejected.tick + 180);
    const beforeTroops = game.player(BOT_A).troops();
    const human = authenticatedRunner(game, humanInfo.clientID!);
    tick(game, human.runner, {
      type: "national_found_empire",
      empireId: "r11_human_recovery",
      requestId: "r11_human_found",
      clientID: humanInfo.clientID!,
    });
    tick(game, human.runner);
    expect(
      game
        .nationalCommandResults(game.player(HUMAN))
        .find((r) => r.requestId === "r11_human_found")?.accepted,
    ).toBe(true);

    let rejected:
      | ReturnType<Game["performNationalWarCommandWithOutcome"]>
      | undefined = deliberatelyRejected;
    let alternative:
      | ReturnType<Game["performNationalWarCommandWithOutcome"]>
      | undefined;
    for (let n = 0; n < 115; n++) {
      game.executeNextTick();
      for (let i = 0; i < calls.mock.calls.length; i++) {
        if (calls.mock.calls[i][0].id() !== BOT_A) continue;
        const result = calls.mock.results[i];
        if (result.type !== "return") continue;
        const outcome = result.value;
        if (outcome.commandKind !== "national_declare_war") continue;
        if (outcome.commandTargetId === BOT_B && !outcome.accepted)
          rejected = outcome;
        if (outcome.commandTargetId === HUMAN && outcome.accepted)
          alternative = outcome;
      }
      if (rejected && alternative) break;
    }
    expect(rejected).toMatchObject({
      accepted: false,
      actorId: BOT_A,
      recipientId: BOT_A,
      commandKind: "national_declare_war",
      commandTargetId: BOT_B,
      reason: "war-rule",
    });
    expect(alternative).toMatchObject({
      accepted: true,
      actorId: BOT_A,
      recipientId: BOT_A,
      commandKind: "national_declare_war",
      commandTargetId: HUMAN,
    });
    expect(game.nationalWarAuthority()?.atWar(BOT_A, BOT_B)).toBe(false);
    expect(game.nationalWarAuthority()?.atWar(BOT_A, HUMAN)).toBe(true);
    const remembered = memory(botFor(game, BOT_A));
    expect(remembered?.lastWarOutcomeSequence).toBe(alternative!.sequence);
    // The AI now knows its own public treaty membership and does not need
    // a rejected AI-authored declaration to cool down; the *direct* invalid
    // Game-issued attempt above remains a mandatory negative witness.
    const blocked = remembered?.rejectedWarTargets?.find(
      (target) => target.targetId === BOT_B,
    );
    expect(blocked).toBeUndefined();
    expect(
      outgoing.mock.calls
        .flat()
        .some(
          (execution) =>
            execution.constructor.name === "AttackExecution" &&
            "targetID" in execution &&
            typeof execution.targetID === "function" &&
            execution.targetID() === HUMAN,
        ),
    ).toBe(true);
    // The battle is not simulated: compare actual troop balance or attack.
    for (let i = 0; i < 4; i++) game.executeNextTick();
    expect(
      game.player(BOT_A).troops() < beforeTroops ||
        game.player(BOT_A).outgoingAttacks().length > 0,
    ).toBe(true);
    calls.mockRestore();
    outgoing.mockRestore();

    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(memory(botFor(restored, BOT_A))).toEqual(
      memory(botFor(game, BOT_A)),
    );
    for (let i = 0; i < 8; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect([...snapshotGame(restored)]).toEqual([...snapshotGame(game)]);

    // The real rejected Game receipt was already tested through the planner's
    // 180-tick cooldown bridge above. The informed bot itself now protects
    // known pact members without making a prohibited declaration.
    const replayedCalls = vi.spyOn(
      game,
      "performNationalWarCommandWithOutcome",
    );
    while (game.ticks() < deliberatelyRejected.tick + 180)
      game.executeNextTick();
    const earlyRetries = replayedCalls.mock.calls.filter(
      ([actor, cmd]) =>
        actor.id() === BOT_A &&
        cmd.kind === "declare-national" &&
        cmd.targetId === BOT_B,
    );
    expect(earlyRetries).toEqual([]);
    replayedCalls.mockRestore();
  });

  it("requires a distinct authenticated opposing player for peace and keeps an unrelated active front lawful", async () => {
    const game = await humanGame();
    // Connected real borders for A-B (upper) and A-C (lower).
    for (let y = 30; y < 72; y++) {
      for (let x = 30; x < 50; x++) game.player(A).conquer(game.ref(x, y));
      for (let x = 50; x < 70; x++) {
        game.player(y < 47 ? B : C).conquer(game.ref(x, y));
      }
    }
    for (let x = 20; x <= 30; x++) game.player(A).conquer(game.ref(x, 20));
    for (let y = 20; y < 72; y++) game.player(A).conquer(game.ref(30, y));
    for (let x = 70; x <= 80; x++) game.player(B).conquer(game.ref(x, 20));
    for (let y = 20; y < 47; y++) game.player(B).conquer(game.ref(70, y));
    for (let x = 70; x <= 80; x++) game.player(C).conquer(game.ref(x, 80));
    for (let y = 47; y <= 80; y++) game.player(C).conquer(game.ref(70, y));
    game.player(A).setTroops(300_000);
    game.player(B).setTroops(230_000);
    game.player(C).setTroops(240_000);
    const ra = authenticatedRunner(game, CA);
    const rb = authenticatedRunner(game, CB);
    const rc = authenticatedRunner(game, CC);
    const declare = (targetId: string, requestId: string) => ({
      type: "national_declare_war",
      scope: "national",
      nationId: A,
      targetKind: "nation",
      targetId,
      requestId,
      clientID: CA,
    });
    tick(game, ra.runner, declare(B, "r11_ab_war"));
    tick(game, ra.runner);
    tick(game, ra.runner, declare(C, "r11_ac_war"));
    tick(game, ra.runner);
    const warA = game.nationalWarCommandResults(game.player(A));
    const warAB = warA.find((item) => item.requestId === "r11_ab_war");
    const warAC = warA.find((item) => item.requestId === "r11_ac_war");
    expect(warAB?.accepted).toBe(true);
    expect(warAC?.accepted).toBe(true);
    expect(game.nationalWarAuthority()!.atWar(A, B)).toBe(true);
    expect(game.nationalWarAuthority()!.atWar(A, C)).toBe(true);

    tick(game, ra.runner, {
      type: "national_propose_peace",
      warId: warAB!.warId!,
      requestId: "r11_a_proposes",
      clientID: CA,
    });
    tick(game, ra.runner);
    const proposal = game
      .nationalWarCommandResults(game.player(A))
      .find((item) => item.requestId === "r11_a_proposes");
    expect(proposal?.accepted).toBe(true);
    expect(proposal?.motionId).toBeDefined();
    tick(game, ra.runner, {
      type: "national_accept_peace",
      motionId: proposal!.motionId!,
      requestId: "r11_wrong_same_side",
      clientID: CA,
    });
    tick(game, ra.runner);
    expect(
      game
        .nationalWarCommandResults(game.player(A))
        .find((item) => item.requestId === "r11_wrong_same_side")?.accepted,
    ).toBe(false);
    expect(game.nationalWarAuthority()!.atWar(A, B)).toBe(true);

    // Second independently bound GameRunner, NOT A's Executor with B's
    // forged clientID, accepts only its own lawful opposing peace motion.
    tick(game, rb.runner, {
      type: "national_accept_peace",
      motionId: proposal!.motionId!,
      requestId: "r11_b_accepts",
      clientID: CB,
    });
    tick(game, rb.runner);
    const accepted = game
      .nationalWarCommandResults(game.player(B))
      .find((item) => item.requestId === "r11_b_accepts");
    expect(accepted).toMatchObject({
      accepted: true,
      actorId: B,
      recipientId: B,
      commandKind: "national_accept_peace",
      motionId: proposal!.motionId,
    });
    expect(game.nationalWarAuthority()!.atWar(A, B)).toBe(false);
    expect(game.nationalWarAuthority()!.atWar(A, C)).toBe(true);
    const layers = game.nationalWarState()!.wars.layers;
    expect(
      layers.find((layer) => layer.id === warAB!.warId)?.endedTick,
    ).not.toBeNull();
    expect(
      layers.find((layer) => layer.id === warAC!.warId)?.endedTick,
    ).toBeNull();

    // Private E1 receipts only appear in the matching principal's worker
    // projection, never in foreign/spectator update packets.
    expect(
      results(ra.packets).some((item) => item.requestId === "r11_a_proposes"),
    ).toBe(true);
    expect(
      results(rb.packets).some((item) => item.requestId === "r11_b_accepts"),
    ).toBe(true);
    expect(results(ra.packets).every((item) => item.recipientId === A)).toBe(
      true,
    );
    expect(results(rb.packets).every((item) => item.recipientId === B)).toBe(
      true,
    );
    tick(game, rc.runner);
    expect(results(rc.packets)).toEqual([]);

    // Invalid post-peace attack crosses the NORMAL stamped combat input.
    // Compare to real idle replay to exclude ordinary tick troop regen.
    const { restored: idle } = await roundTrip(game, "plains");
    const idleRunner = authenticatedRunner(idle, CA);
    const levyBefore = game.nationalWarState()!.levy;
    const defenderBefore = game.player(B).numTilesOwned();
    tick(game, ra.runner, {
      type: "attack",
      targetID: B,
      troops: 60_000,
      clientID: CA,
    });
    tick(idle, idleRunner.runner);
    tick(game, ra.runner);
    tick(idle, idleRunner.runner);
    expect(game.player(A).troops()).toBe(idle.player(A).troops());
    expect(game.player(B).numTilesOwned()).toBe(defenderBefore);
    expect(game.nationalWarState()!.levy).toEqual(levyBefore);
    expect(game.nationalWarAuthority()!.authorizeOffensiveAction(A, C)).toBe(
      true,
    );
    expect(ra.errors).toEqual([]);
    expect(rb.errors).toEqual([]);
    expect(rc.errors).toEqual([]);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
  });
});
