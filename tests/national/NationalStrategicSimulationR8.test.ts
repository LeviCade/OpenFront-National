import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import {
  initialNationalPlannerMemory,
  planNationalInterest,
} from "@openfront/engine/national/ai/NationalPlanner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const BOT = "r8-sovereign-bot";
const NEIGHBOR = "r8-neighbor";
const DISTANT = "r8-distant";

async function seededNationalRun(targetType: PlayerType = PlayerType.Human) {
  const bot = new PlayerInfo("Local Nation", PlayerType.Nation, null, BOT);
  const neighbor = new PlayerInfo(
    "Frontier Nation",
    targetType,
    "r8-neighbor-client",
    NEIGHBOR,
  );
  const distant = new PlayerInfo(
    "Remote Empire",
    PlayerType.Human,
    "r8-distant-client",
    DISTANT,
  );
  const nation = new Nation(new Cell(15, 15), bot);
  // Fixed country IDs, spawn cells, and GameID control all Nation PRNGs.
  const game = await setup(
    "plains",
    { nationalMode: true },
    [neighbor, distant],
    undefined,
    undefined,
    true,
    [nation],
  );
  game.addExecution(
    new NationExecution("r8-seed-national", nation),
    new SpawnExecution("r8-seed-national", bot, game.ref(15, 15)),
    new SpawnExecution("r8-seed-national", neighbor, game.ref(85, 85)),
    new SpawnExecution("r8-seed-national", distant, game.ref(85, 15)),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const id of [BOT, NEIGHBOR, DISTANT]) {
    expect(game.player(id).hasSpawned()).toBe(true);
  }
  // Actual owned territories, not synthetic frontiers or mocked planner data.
  for (let y = 20; y < 65; y++) {
    for (let x = 15; x < 50; x++) game.player(BOT).conquer(game.ref(x, y));
    for (let x = 50; x < 85; x++) game.player(NEIGHBOR).conquer(game.ref(x, y));
  }
  // Remote power controls more land, but cannot teleport into this campaign.
  for (let y = 66; y < 97; y++) {
    for (let x = 2; x < 98; x++) game.player(DISTANT).conquer(game.ref(x, y));
  }
  game.executeNextTick();
  game.player(BOT).setTroops(250_000);
  game.player(NEIGHBOR).setTroops(180_000);
  game.player(DISTANT).setTroops(550_000);
  return game;
}

function runTicks(
  game: Awaited<ReturnType<typeof seededNationalRun>>,
  count: number,
) {
  for (let i = 0; i < count; i++) game.executeNextTick();
}

describe("Round Eight seeded real NATIONAL strategic matches AI-01/02/04/06", () => {
  it("AI-01 controller-neutral human vs bot frontier produces equal decisions and real lawful war action", async () => {
    const againstHuman = await seededNationalRun(PlayerType.Human);
    const againstBot = await seededNationalRun(PlayerType.Nation);
    for (const game of [againstHuman, againstBot]) {
      game.performNationalWarCommand(game.player(BOT), {
        kind: "declare-national",
        warId: "r8_local_border_war",
        aggressorId: BOT,
        targetId: NEIGHBOR,
      });
    }
    const decisions = [againstHuman, againstBot].map(
      (game) =>
        planNationalInterest(
          collectLiveNationalObservation(game, BOT).observation,
          initialNationalPlannerMemory(BOT),
          30,
        ).decision,
    );
    expect(decisions[0]).toEqual(decisions[1]);
    expect(decisions[0]?.targetId).toBe(NEIGHBOR);
    for (const game of [againstHuman, againstBot]) {
      const bot = game.player(BOT);
      const started = bot.troops();
      runTicks(game, 105);
      expect(bot.troops() < started || bot.outgoingAttacks().length > 0).toBe(
        true,
      );
    }
  });

  it("AI-02 does not abandon local WAR campaign because a distant nation has the most land; replay is deterministic", async () => {
    const game = await seededNationalRun();
    const publicNations = collectLiveNationalObservation(game, BOT).observation
      .nations;
    expect(
      publicNations.find((n) => n.id === DISTANT)!.landPercent,
    ).toBeGreaterThan(publicNations.find((n) => n.id === BOT)!.landPercent);
    game.performNationalWarCommand(game.player(BOT), {
      kind: "declare-national",
      warId: "r8_persistent_local_war",
      aggressorId: BOT,
      targetId: NEIGHBOR,
    });
    const startPlan = planNationalInterest(
      collectLiveNationalObservation(game, BOT).observation,
      initialNationalPlannerMemory(BOT),
      30,
    );
    expect(startPlan.decision?.targetId).toBe(NEIGHBOR);
    const queued: AttackExecution[] = [];
    const original = game.addExecution.bind(game);
    const spy = vi.spyOn(game, "addExecution").mockImplementation((...all) => {
      for (const next of all)
        if (next instanceof AttackExecution) queued.push(next);
      return original(...all);
    });
    runTicks(game, 135);
    spy.mockRestore();
    expect(queued.length).toBeGreaterThan(0);
    expect(game.nationalWarAuthority()?.atWar(BOT, NEIGHBOR)).toBe(true);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...bytes]).toEqual([...again]);
    expect(restored.nationalWarAuthority()?.atWar(BOT, NEIGHBOR)).toBe(true);
    expect(
      planNationalInterest(
        collectLiveNationalObservation(restored, BOT).observation,
        initialNationalPlannerMemory(BOT),
        30,
      ).decision?.targetId,
    ).toBe(NEIGHBOR);
  });

  it("WAR-09 real peace acceptance immediately ends the bot's former local offensive target", async () => {
    const game = await seededNationalRun();
    game.performNationalWarCommand(game.player(BOT), {
      kind: "declare-national",
      warId: "r8_real_peace_war",
      aggressorId: BOT,
      targetId: NEIGHBOR,
    });
    expect(
      planNationalInterest(
        collectLiveNationalObservation(game, BOT).observation,
        initialNationalPlannerMemory(BOT),
        30,
      ).decision?.targetId,
    ).toBe(NEIGHBOR);
    game.performNationalWarCommand(game.player(BOT), {
      kind: "propose-peace",
      motionId: "r8_real_peace_motion",
      warId: "r8_real_peace_war",
    });
    game.performNationalWarCommand(game.player(NEIGHBOR), {
      kind: "accept-peace",
      motionId: "r8_real_peace_motion",
    });
    expect(game.nationalWarAuthority()?.atWar(BOT, NEIGHBOR)).toBe(false);
    expect(
      game.nationalWarAuthority()?.authorizeOffensiveAction(BOT, NEIGHBOR),
    ).toBe(false);
    const after = collectLiveNationalObservation(game, BOT).observation;
    expect(after.wars.some((war) => war.id === "r8_real_peace_war")).toBe(
      false,
    );
    const decision = planNationalInterest(
      after,
      initialNationalPlannerMemory(BOT),
      30,
    );
    expect(decision.decision?.targetId).not.toBe(NEIGHBOR);
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...bytes]).toEqual([...again]);
    expect(restored.nationalWarAuthority()?.atWar(BOT, NEIGHBOR)).toBe(false);
    expect(
      collectLiveNationalObservation(restored, BOT).observation.wars.some(
        (war) => war.id === "r8_real_peace_war",
      ),
    ).toBe(false);
  });

  it("AI-04 weak independent nation preserves survival choices instead of attacking a publicly superior neighbor", async () => {
    const game = await seededNationalRun();
    // Initial own territory is weak and resource-limited, but adjoining
    // neutral land remains objectively reachable and costs no declaration.
    game.player(BOT).setTroops(2_000);
    const observation = collectLiveNationalObservation(game, BOT).observation;
    expect(observation.unownedFrontier).toBe(true);
    const plan = planNationalInterest(
      observation,
      initialNationalPlannerMemory(BOT),
      30,
    );
    expect(plan.decision).toMatchObject({
      objective: "expand",
      targetId: null,
    });
    const ownedBefore = game.player(BOT).numTilesOwned();
    runTicks(game, 105);
    expect(game.player(BOT).numTilesOwned()).toBeGreaterThan(ownedBefore);
    expect(game.nationalWarAuthority()?.atWar(BOT, NEIGHBOR)).toBe(false);
  });

  it("AI-04 active-defense alarm actually executes a lawful local counterattack rather than stalling", async () => {
    const game = await seededNationalRun();
    const bot = game.player(BOT);
    // Constrain the country to a REAL weak border strip. The enemy still
    // owns the contiguous neighboring tiles; no fabricated frontier used.
    for (const tile of [...bot.tiles()]) {
      const x = game.x(tile);
      const y = game.y(tile);
      if (x < 47 || x >= 50 || y < 35 || y >= 60) bot.relinquish(tile);
    }
    bot.setTroops(85_000);
    game
      .player(NEIGHBOR)
      .buildUnit(UnitType.Warship, game.ref(50, 45), {
        patrolTile: game.ref(50, 45),
      });
    game.performNationalWarCommand(bot, {
      kind: "declare-national",
      warId: "r8_defensive_war",
      aggressorId: BOT,
      targetId: NEIGHBOR,
    });
    const seen = collectLiveNationalObservation(game, BOT).observation;
    expect(seen.nations.find((n) => n.id === BOT)?.landPercent).toBeLessThan(3);
    expect(
      seen.visibleAssets.some(
        (a) => a.ownerId === NEIGHBOR && a.kind === "warship",
      ),
    ).toBe(true);
    expect(
      planNationalInterest(seen, initialNationalPlannerMemory(BOT), 30)
        .decision,
    ).toMatchObject({ objective: "defend", targetId: null });
    const originalTroops = bot.troops();
    const queued: AttackExecution[] = [];
    const original = game.addExecution.bind(game);
    const spy = vi.spyOn(game, "addExecution").mockImplementation((...all) => {
      for (const item of all)
        if (item instanceof AttackExecution) queued.push(item);
      return original(...all);
    });
    runTicks(game, 120);
    spy.mockRestore();
    expect(queued.length).toBeGreaterThan(0);
    expect(
      bot.troops() < originalTroops || bot.outgoingAttacks().length > 0,
    ).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(BOT, NEIGHBOR)).toBe(true);
  });

  it("SOV-03 real seeded three-nation accession resolves the authoritative imperial victory roster", async () => {
    const game = await seededNationalRun();
    const emperor = game.player(DISTANT);
    game.performNationalCommand(emperor, {
      kind: "found-empire",
      empireId: "r8_shared_sovereignty",
    });
    for (const id of [BOT, NEIGHBOR]) {
      game.performNationalCommand(emperor, {
        kind: "offer-empire",
        empireId: "r8_shared_sovereignty",
        candidateId: id,
      });
      game.performNationalCommand(game.player(id), {
        kind: "accept-empire",
        empireId: "r8_shared_sovereignty",
        candidateId: id,
      });
    }
    // Advance the REAL Game-owned political state and evaluate victory.
    runTicks(game, 2);
    const truth = game.nationalPublicPoliticalView();
    expect(truth?.empires).toEqual([
      {
        id: "r8_shared_sovereignty",
        leaderId: DISTANT,
        memberIds: expect.arrayContaining([BOT, DISTANT, NEIGHBOR]),
      },
    ]);
    expect(truth?.victory?.resolved).toBe(true);
    expect(truth?.victory?.prizes).toEqual(
      expect.arrayContaining([
        {
          kind: "ImperialVictor",
          nationId: DISTANT,
          empireId: "r8_shared_sovereignty",
        },
        {
          kind: "EmpireVictor",
          nationId: BOT,
          empireId: "r8_shared_sovereignty",
        },
      ]),
    );
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...bytes]).toEqual([...again]);
    expect(restored.nationalPublicPoliticalView()?.victory).toEqual(
      truth?.victory,
    );
  });

  it("AI-06 accession keeps bot militarily active under real imperial WAR, without attacking emperor or peace-side allies", async () => {
    const game = await seededNationalRun();
    game.performNationalCommand(game.player(DISTANT), {
      kind: "found-empire",
      empireId: "r8_active_empire",
    });
    game.performNationalCommand(game.player(DISTANT), {
      kind: "offer-empire",
      empireId: "r8_active_empire",
      candidateId: BOT,
    });
    game.performNationalCommand(game.player(BOT), {
      kind: "accept-empire",
      empireId: "r8_active_empire",
      candidateId: BOT,
    });
    game.performNationalWarCommand(game.player(DISTANT), {
      kind: "declare-imperial",
      warId: "r8_imperial_front",
      aggressor: { kind: "empire", id: "r8_active_empire" },
      target: { kind: "nation", id: NEIGHBOR },
    });
    const observed = collectLiveNationalObservation(game, BOT).observation;
    const plan = planNationalInterest(
      observed,
      initialNationalPlannerMemory(BOT),
      30,
    );
    expect(plan.decision?.targetId).toBe(NEIGHBOR);
    expect(
      game.nationalWarAuthority()?.authorizeOffensiveAction(BOT, NEIGHBOR),
    ).toBe(true);
    expect(
      game.nationalWarAuthority()?.authorizeOffensiveAction(BOT, DISTANT),
    ).toBe(false);
    const startTroops = game.player(BOT).troops();
    runTicks(game, 135);
    expect(
      game.player(BOT).troops() < startTroops ||
        game.player(BOT).outgoingAttacks().length > 0,
    ).toBe(true);
    expect(game.nationalPoliticalAuthority()?.empireOf(BOT)).toBe(
      "r8_active_empire",
    );
    expect(game.nationalWarAuthority()?.atWar(BOT, DISTANT)).toBe(false);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalPoliticalAuthority()?.empireOf(BOT)).toBe(
      "r8_active_empire",
    );
  });
});
