import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import {
  deriveNationalWarSides,
  initialNationalPlannerMemory,
  planNationalInterest,
} from "@openfront/engine/national/ai/NationalPlanner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const bot = new PlayerInfo("Nation Bot", PlayerType.Nation, null, "r5-bot");
const human = new PlayerInfo(
  "Neighbor",
  PlayerType.Human,
  "r5-human",
  "r5-human-id",
);
const botNation = new Nation(new Cell(15, 15), bot);

async function battleground() {
  const game = await setup(
    "plains",
    { nationalMode: true },
    [human],
    undefined,
    undefined,
    true,
    [botNation],
  );
  game.addExecution(
    new NationExecution("r5-war-ai", botNation),
    new SpawnExecution("r5-war-ai", bot, game.ref(15, 15)),
    new SpawnExecution("r5-war-ai", human, game.ref(85, 85)),
  );
  game.executeNextTick();
  game.executeNextTick();
  expect(game.player(bot.id).hasSpawned()).toBe(true);
  expect(game.player(human.id).hasSpawned()).toBe(true);
  game.endSpawnPhase();
  const b = game.player(bot.id);
  const h = game.player(human.id);
  // Construct a REAL, land-adjacent frontier without fake observer grants.
  for (let y = 20; y < 65; y++) {
    for (let x = 15; x < 50; x++) b.conquer(game.ref(x, y));
    for (let x = 50; x < 85; x++) h.conquer(game.ref(x, y));
  }
  game.executeNextTick();
  b.setTroops(200_000);
  h.setTroops(200_000);
  return game;
}

describe("Round Five real NATIONAL bot war legality (AI-01/02, WAR-01/03/07)", () => {
  it("an undeclared attack is rejected by the actual AttackExecution before troop debit", async () => {
    const game = await battleground();
    const attacker = game.player(bot.id);
    const before = attacker.troops();
    const priorAttacks = attacker.outgoingAttacks().length;
    expect(
      game.nationalWarAuthority()?.authorizeOffensiveAction(bot.id, human.id),
    ).toBe(false);
    const illegal = new AttackExecution(20_000, attacker, human.id);
    illegal.init(game, game.ticks());
    expect(illegal.isActive()).toBe(false);
    expect(attacker.troops()).toBe(before);
    expect(attacker.outgoingAttacks()).toHaveLength(priorAttacks);
  });

  it("bot observes only actual opposing war sides, chooses legal enemy and executes live attack", async () => {
    const game = await battleground();
    const attacker = game.player(bot.id);
    game.performNationalWarCommand(attacker, {
      kind: "declare-national",
      warId: "r5_bot_hostile",
      aggressorId: bot.id,
      targetId: human.id,
    });
    expect(
      game.nationalWarAuthority()?.authorizeOffensiveAction(bot.id, human.id),
    ).toBe(true);
    const observed = collectLiveNationalObservation(game, bot.id).observation;
    const sides = deriveNationalWarSides(observed.wars, bot.id);
    expect([...sides.enemies]).toEqual([human.id]);
    expect([...sides.allies]).toEqual([]);
    expect(observed.frontiers.some((f) => f.targetId === human.id)).toBe(true);
    const plan = planNationalInterest(
      observed,
      initialNationalPlannerMemory(bot.id),
      30,
    );
    expect(plan.decision?.targetId).toBe(human.id);

    const queued: AttackExecution[] = [];
    const original = game.addExecution.bind(game);
    const spy = vi
      .spyOn(game, "addExecution")
      .mockImplementation((...executions) => {
        for (const execution of executions) {
          if (execution instanceof AttackExecution) queued.push(execution);
        }
        return original(...executions);
      });
    const startTroops = attacker.troops();
    for (let i = 0; i < 95; i++) game.executeNextTick();
    spy.mockRestore();
    expect(queued.length).toBeGreaterThan(0);
    // A queued attack alone is insufficient: real AttackExecution must debit
    // the actual player, or produce a live outgoing attack/territory change.
    expect(
      attacker.troops() < startTroops || attacker.outgoingAttacks().length > 0,
    ).toBe(true);

    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalWarAuthority()?.atWar(bot.id, human.id)).toBe(true);
    expect(
      deriveNationalWarSides(
        collectLiveNationalObservation(restored, bot.id).observation.wars,
        bot.id,
      ).enemies.has(human.id),
    ).toBe(true);
  });

  it("imperial comrades never become offensive targets even in layered war states", async () => {
    const game = await battleground();
    const attacker = game.player(bot.id);
    game.performNationalCommand(attacker, {
      kind: "found-empire",
      empireId: "r5_empire",
    });
    game.performNationalCommand(attacker, {
      kind: "offer-empire",
      empireId: "r5_empire",
      candidateId: human.id,
    });
    game.performNationalCommand(game.player(human.id), {
      kind: "accept-empire",
      empireId: "r5_empire",
      candidateId: human.id,
    });
    expect(
      game.nationalWarAuthority()?.authorizeOffensiveAction(bot.id, human.id),
    ).toBe(false);
    const observation = collectLiveNationalObservation(
      game,
      bot.id,
    ).observation;
    const plan = planNationalInterest(
      observation,
      initialNationalPlannerMemory(bot.id),
      30,
    );
    expect(plan.decision?.targetId).not.toBe(human.id);
    const priorAttacks = attacker.outgoingAttacks().length;
    const illegal = new AttackExecution(10_000, attacker, human.id);
    illegal.init(game, game.ticks());
    expect(illegal.isActive()).toBe(false);
    expect(attacker.outgoingAttacks()).toHaveLength(priorAttacks);
  });
});
