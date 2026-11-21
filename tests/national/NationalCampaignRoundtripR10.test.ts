import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import {
  deriveNationalWarSides,
  initialNationalPlannerMemory,
  planNationalInterest,
  recordNationalWarOutcome,
} from "@openfront/engine/national/ai/NationalPlanner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import type { NationalPublicConflictView } from "@openfront/engine/national/observation/NationalOutbound";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const AI_A = "r10-ai-alpha";
const AI_B = "r10-ai-bravo";
const HUMAN = "r10-human-charlie";
const infoA = new PlayerInfo("Alpha", PlayerType.Nation, null, AI_A);
const infoB = new PlayerInfo("Bravo", PlayerType.Nation, null, AI_B);
const infoHuman = new PlayerInfo(
  "Charlie",
  PlayerType.Human,
  "r10-charlie-client",
  HUMAN,
);
const nationA = new Nation(new Cell(15, 25), infoA);
const nationB = new Nation(new Cell(55, 25), infoB);

async function realThreeNationMatch(): Promise<Game> {
  const game = await setup(
    "plains",
    { nationalMode: true },
    [infoHuman],
    undefined,
    undefined,
    true,
    [nationA, nationB],
  );
  game.addExecution(
    new NationExecution("r10-ai-observation", nationA),
    new NationExecution("r10-ai-observation", nationB),
    new SpawnExecution("r10-ai-observation", infoA, game.ref(15, 25)),
    new SpawnExecution("r10-ai-observation", infoB, game.ref(55, 25)),
    new SpawnExecution("r10-ai-observation", infoHuman, game.ref(85, 85)),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const id of [AI_A, AI_B, HUMAN]) {
    expect(game.player(id).hasSpawned()).toBe(true);
  }

  // Real engine tiles, not a fabricated NationalObservation. Every passable
  // land cell has a living owner; WAR rather than free-land expansion is the
  // only adjacent territorial option. Three nations share real borders.
  const firstLimit = Math.floor(game.width() * 0.35);
  const secondLimit = Math.floor(game.width() * 0.7);
  for (let y = 0; y < game.height(); y++) {
    for (let x = 0; x < game.width(); x++) {
      const tile = game.ref(x, y);
      if (!game.isLand(tile) || game.isImpassable(tile)) continue;
      const id = x < firstLimit ? AI_A : x < secondLimit ? AI_B : HUMAN;
      game.player(id).conquer(tile);
    }
  }
  game.player(AI_A).setTroops(260_000);
  game.player(AI_B).setTroops(240_000);
  game.player(HUMAN).setTroops(180_000);
  return game;
}

function observation(game: Game, id: string) {
  return collectLiveNationalObservation(game, id).observation;
}

// E3 produces the recipient-filtered public conflict DTO; E2 owns eventual
// inclusion in engine-api. This optional intersection precisely mirrors the
// runtime projection without pretending the upstream wire schema has changed.
type R10Packet = GameUpdateViewData & {
  readonly nationalConflicts?: NationalPublicConflictView;
};

function runner(game: Game, clientID?: string) {
  const packets: R10Packet[] = [];
  const view = new GameRunner(
    game,
    new Executor(game, "r10-ai-observation", clientID),
    (packet) => {
      if ("updates" in packet) packets.push(packet);
    },
    clientID,
  );
  return () => {
    view.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(view.executeNextTick()).toBe(true);
    return packets[packets.length - 1];
  };
}

describe("R10 three-nation observed-information live match", () => {
  it("two actual NationExecutions discover, declare and attack under E2 law", async () => {
    const game = await realThreeNationMatch();
    const alphaObservation = observation(game, AI_A);
    const bravoObservation = observation(game, AI_B);
    expect(alphaObservation.unownedFrontier).toBe(false);
    expect(bravoObservation.unownedFrontier).toBe(false);
    expect(alphaObservation.frontiers.some((f) => f.targetId === AI_B)).toBe(
      true,
    );

    const planned = planNationalInterest(
      alphaObservation,
      initialNationalPlannerMemory(AI_A),
      30,
    );
    expect(planned.decision).toMatchObject({
      objective: "expand",
      targetId: AI_B,
      rationale: "reachable-opportunity",
    });
    // No global opponent strength/controllerKind appears in either plan.
    expect(alphaObservation.nations[0]).not.toHaveProperty("controllerKind");
    expect(
      alphaObservation.nations.find((n) => n.id === HUMAN),
    ).not.toHaveProperty("troops");

    // The third participant exercises real political authority in this same
    // match, rather than serving as a fictitious planner target.
    game.performNationalCommand(game.player(HUMAN), {
      kind: "found-empire",
      empireId: "r10_charlie_empire",
    });
    expect(
      game
        .nationalPublicPoliticalView()
        ?.empires.some((e) => e.id === "r10_charlie_empire"),
    ).toBe(true);

    const startingTroops = game.player(AI_A).troops();
    const attackCalls = vi.spyOn(game, "addExecution");
    for (let i = 0; i < 150; i++) game.executeNextTick();
    const attacks = attackCalls.mock.calls
      .flat()
      .filter((execution) => execution instanceof AttackExecution);
    attackCalls.mockRestore();

    expect(
      game
        .nationalWarState()
        ?.wars.layers.some(
          (layer) =>
            layer.endedTick === null &&
            layer.declaredBy === AI_A &&
            layer.first.id === AI_A &&
            layer.second.id === AI_B,
        ),
    ).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(AI_A, AI_B)).toBe(true);
    expect(attacks.length).toBeGreaterThan(0);
    expect(
      game.player(AI_A).troops() < startingTroops ||
        game.player(AI_A).outgoingAttacks().length > 0,
    ).toBe(true);

    // No fake battle result: actual WAR layers and real troop debits remain
    // authoritative. A live campaign remains the planner's local priority.
    const active = observation(game, AI_A);
    expect(deriveNationalWarSides(active.wars, AI_A).enemies.has(AI_B)).toBe(
      true,
    );
    const next = planNationalInterest(
      active,
      initialNationalPlannerMemory(AI_A),
      30,
    );
    expect(next.decision?.targetId).toBe(AI_B);

    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(observation(restored, AI_A)).toEqual(observation(game, AI_A));
    expect(observation(restored, AI_B)).toEqual(observation(game, AI_B));
  });

  it("replans on public WAR endings with deterministic replay", async () => {
    const game = await realThreeNationMatch();
    const start = game.performNationalWarCommandWithOutcome(game.player(AI_A), {
      kind: "declare-national",
      warId: "r10_ai_live_war",
      aggressorId: AI_A,
      targetId: AI_B,
      requestId: "r10_ai_live_request",
    });
    expect(start.accepted).toBe(true);
    const during = observation(game, AI_A);
    expect(during.diplomaticEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "war:0:started:r10_ai_live_war",
          kind: "war-started",
          public: true,
        }),
      ]),
    );
    const campaigning = planNationalInterest(
      during,
      initialNationalPlannerMemory(AI_A),
      30,
    );
    expect(campaigning.decision?.targetId).toBe(AI_B);

    const proposal = game.performNationalWarCommandWithOutcome(
      game.player(AI_A),
      {
        kind: "propose-peace",
        warId: "r10_ai_live_war",
        motionId: "r10_ai_live_peace",
        requestId: "r10_ai_peace_request",
      },
    );
    expect(proposal.accepted).toBe(true);
    const settled = game.performNationalWarCommandWithOutcome(
      game.player(AI_B),
      {
        kind: "accept-peace",
        motionId: "r10_ai_live_peace",
        requestId: "r10_ai_peace_acceptance",
      },
    );
    expect(settled.accepted).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(AI_A, AI_B)).toBe(false);

    const after = observation(game, AI_A);
    expect(after.wars).toEqual([]);
    expect(after.diplomaticEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "war:1:ended:r10_ai_live_war",
          kind: "war-ended",
          public: true,
        }),
      ]),
    );
    expect(JSON.stringify(after)).not.toContain("r10_ai_live_peace");
    const replanned = planNationalInterest(after, campaigning.memory, 30);
    expect(replanned.planned).toBe(true);
    expect(replanned.decision?.targetId).not.toBe(AI_B);
    expect(replanned.memory.rejectedWarTargets).toEqual(
      expect.arrayContaining([expect.objectContaining({ targetId: AI_B })]),
    );

    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(observation(restored, AI_A)).toEqual(after);
    expect(
      planNationalInterest(observation(restored, AI_A), campaigning.memory, 30),
    ).toEqual(replanned);
  });

  it("turns real rejected WAR receipts into bounded alternative plans", async () => {
    const game = await realThreeNationMatch();
    // A settled layer retains its canonical ID, so reusing it must fail.
    const first = game.performNationalWarCommandWithOutcome(game.player(AI_A), {
      kind: "declare-national",
      warId: "r10_reserved_layer",
      aggressorId: AI_A,
      targetId: AI_B,
      requestId: "r10_first_legitimate",
    });
    expect(first.accepted).toBe(true);
    expect(
      game.performNationalWarCommandWithOutcome(game.player(AI_A), {
        kind: "propose-peace",
        warId: "r10_reserved_layer",
        motionId: "r10_close_layer",
        requestId: "r10_close_request",
      }).accepted,
    ).toBe(true);
    expect(
      game.performNationalWarCommandWithOutcome(game.player(AI_B), {
        kind: "accept-peace",
        motionId: "r10_close_layer",
        requestId: "r10_accept_request",
      }).accepted,
    ).toBe(true);

    const observed = observation(game, AI_B);
    expect(observed.frontiers.some((f) => f.targetId === HUMAN)).toBe(true);
    const rejected = game.performNationalWarCommandWithOutcome(
      game.player(AI_B),
      {
        kind: "declare-national",
        warId: "r10_reserved_layer",
        aggressorId: AI_B,
        targetId: HUMAN,
        requestId: "r10_rejected_collision",
      },
    );
    expect(rejected).toMatchObject({
      accepted: false,
      actorId: AI_B,
      recipientId: AI_B,
      commandKind: "national_declare_war",
      commandTargetId: HUMAN,
      reason: "war-rule",
    });
    const memory = recordNationalWarOutcome(
      observed,
      initialNationalPlannerMemory(AI_B),
      rejected,
    );
    expect(memory.rejectedWarTargets).toEqual([
      { targetId: HUMAN, retryAfterTick: observed.tick + 180 },
    ]);
    expect(recordNationalWarOutcome(observed, memory, rejected)).toEqual(
      memory,
    );
    const chosen = planNationalInterest(observed, memory, 30);
    expect(chosen.decision?.targetId).toBe(AI_A);
    expect(chosen.decision?.targetId).not.toBe(HUMAN);
    expect(
      planNationalInterest(
        { ...observed, tick: observed.tick + 181 },
        memory,
        30,
      ).memory.rejectedWarTargets,
    ).toEqual([]);
    expect(() =>
      recordNationalWarOutcome(observed, memory, {
        ...rejected,
        recipientId: HUMAN,
        sequence: rejected.sequence + 1,
      }),
    ).toThrow(/foreign command outcome/);
  });

  it("never sends third nations or spectators private peace and receipts", async () => {
    const game = await realThreeNationMatch();
    const human = runner(game, infoHuman.clientID!);
    const spectator = runner(game);
    game.performNationalWarCommandWithOutcome(game.player(AI_A), {
      kind: "declare-national",
      warId: "r10_private_war",
      aggressorId: AI_A,
      targetId: AI_B,
      requestId: "r10_private_declare",
    });
    game.performNationalWarCommandWithOutcome(game.player(AI_A), {
      kind: "propose-peace",
      warId: "r10_private_war",
      motionId: "r10_private_motion",
      requestId: "r10_private_proposal",
    });
    const invalid = game.performNationalWarCommandWithOutcome(
      game.player(HUMAN),
      {
        kind: "declare-national",
        warId: "r10_illegal_foreign",
        aggressorId: AI_A,
        targetId: AI_B,
        requestId: "nc_0123456789abcdef0123456789abcdef",
      },
    );
    expect(invalid.accepted).toBe(false);
    const mine = human();
    const unknown = spectator();
    expect(mine.nationalCommandResults).toEqual([
      expect.objectContaining({
        actorId: HUMAN,
        recipientId: HUMAN,
        accepted: false,
        requestId: "nc_0123456789abcdef0123456789abcdef",
      }),
    ]);
    expect(unknown).not.toHaveProperty("nationalCommandResults");
    expect(mine.nationalConflicts?.motions).toEqual([]);
    expect(unknown.nationalConflicts?.motions).toEqual([]);
    expect(
      mine.nationalConflicts?.layers.some(
        (layer) => layer.id === "r10_private_war",
      ),
    ).toBe(true);
    for (const packet of [mine, unknown]) {
      const encoded = JSON.stringify(packet, (_key, value) =>
        typeof value === "bigint" ? String(value) : value,
      );
      expect(encoded).not.toContain("r10_private_motion");
      expect(encoded).not.toContain("r10_private_proposal");
      expect(encoded).not.toContain("r10_private_declare");
      expect(encoded).not.toContain("commandFingerprint");
      expect(encoded).not.toContain("landingDestination");
    }
    expect(human()).not.toHaveProperty("nationalCommandResults");
    expect(spectator()).not.toHaveProperty("nationalCommandResults");
  });
});
