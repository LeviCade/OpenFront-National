import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameImpl } from "@openfront/engine/game/GameImpl";
import { GameRunner } from "@openfront/engine/GameRunner";
import {
  AI_NATIONAL_ASSESSMENT_COST,
  initialNationalAssessmentAIMemory,
  planNationalAssessment,
  recordNationalAssessmentAttempt,
  type AssessmentObservation,
} from "@openfront/engine/national/ai/NationalAssessmentStrategy";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const A = "C6C1_E5_ASSESSOR";
const B = "C6C1_E5_RIVAL";
const C = "C6C1_E5_THIRD";
const D = "C6C1_E5_FOURTH";
const ID = "c6-class1-e5-seed";
const infos = [
  new PlayerInfo("Assessor", PlayerType.Nation, null, A),
  new PlayerInfo("Rival", PlayerType.Nation, null, B),
  new PlayerInfo("Third", PlayerType.Nation, null, C),
  new PlayerInfo("Fourth", PlayerType.Nation, null, D),
];

function fixture(): AssessmentObservation {
  return {
    observerId: A,
    tick: 25,
    nations: [
      {
        id: A,
        name: "Assessor",
        status: "independent",
        alive: true,
        landPercent: 3,
      },
      {
        id: B,
        name: "Rival",
        status: "independent",
        alive: true,
        landPercent: 12,
      },
      {
        id: C,
        name: "Third",
        status: "independent",
        alive: true,
        landPercent: 7,
      },
      {
        id: D,
        name: "Fourth",
        status: "independent",
        alive: true,
        landPercent: 9,
      },
    ],
    coalitions: [],
    wars: [
      {
        id: "real-war",
        scope: "national",
        first: { kind: "nation", stableId: A, activeMemberIds: [A] },
        second: { kind: "nation", stableId: B, activeMemberIds: [B] },
        startedTick: 1,
      },
    ],
    ownResources: { treasury: 9_000, troops: 250_000 },
    visibleAssets: [
      {
        id: "sighted_factory",
        ownerId: B,
        kind: "structure",
        x: 137,
        y: 100,
        source: "border",
      },
    ],
    frontiers: [{ targetId: B, access: "land" }],
    diplomaticEvents: [],
    unownedFrontier: false,
  };
}

function paidReport(view: AssessmentObservation) {
  return {
    targetId: B,
    paidBy: A,
    effectiveTick: view.tick,
    expiresAtTick: view.tick + 900,
    confidence: "coarse-estimate",
    treasuryGoldBand: { lower: "2500", upperExclusive: "5000" },
    militaryTroopsBand: { lower: "800000", upperExclusive: "900000" },
  };
}

describe("C6 Class One E5: DISTINCT funded national assessment policy", () => {
  it("authorizes separate 1200-gold purchase only for sighted live WAR enemy and healthy budget", () => {
    const view = fixture();
    const memory = initialNationalAssessmentAIMemory(A);
    expect(planNationalAssessment(view, memory).purchase).toEqual({
      targetId: B,
    });
    expect(
      planNationalAssessment({ ...view, wars: [] }, memory).purchase,
    ).toBeNull();
    expect(
      planNationalAssessment({ ...view, visibleAssets: [] }, memory).purchase,
    ).toBeNull();
    expect(
      planNationalAssessment({ ...view, frontiers: [] }, memory).purchase,
    ).toBeNull();
    expect(
      planNationalAssessment({ ...view, unownedFrontier: true }, memory)
        .purchase,
    ).toBeNull();
    expect(
      planNationalAssessment(
        {
          ...view,
          ownResources: {
            ...view.ownResources,
            treasury: AI_NATIONAL_ASSESSMENT_COST + 2499,
          },
        },
        memory,
      ).purchase,
    ).toBeNull();
    expect(
      planNationalAssessment(
        {
          ...view,
          nations: view.nations.map((n) =>
            n.id === A ? { ...n, status: "member" as const } : n,
          ),
        },
        memory,
      ).purchase,
    ).toBeNull();
    expect(
      planNationalAssessment(
        {
          ...view,
          coalitions: [
            { id: "peace", kind: "mda", leaderId: A, members: [A, B] },
          ],
        },
        memory,
      ).purchase,
    ).toBeNull();
    expect(() =>
      planNationalAssessment({ ...view, observerId: D }, memory),
    ).toThrow(/principal mismatch/);
    expect(
      planNationalAssessment(
        {
          ...view,
          nations: view.nations.map((n) =>
            n.id === B
              ? { ...n, exactHiddenTroops: 99999999, controllerKind: "human" }
              : n,
          ),
        },
        memory,
      ).purchase,
    ).toEqual({ targetId: B });
  });

  it("rejects wrong paidBy, forged dates, bad intervals, WAR/treaty changes and expired intelligence", () => {
    const view = fixture();
    const initial = initialNationalAssessmentAIMemory(A);
    const accepted = recordNationalAssessmentAttempt(
      view,
      initial,
      B,
      "ai_assessment_ok",
      view.tick + 900,
    );
    expect(accepted.attempts).toHaveLength(1);
    expect(accepted.attempts[0].outcome).toBe("accepted");
    expect(planNationalAssessment(view, accepted).purchase).toBeNull();
    const report = paidReport(view);
    const withPaidReport = {
      ...view,
      tick: view.tick + 1,
      assessments: [report],
    };
    expect(
      planNationalAssessment(withPaidReport, accepted).holdOffenseAgainst,
    ).toBe(B);
    expect(
      planNationalAssessment(
        {
          ...withPaidReport,
          assessments: [{ ...report, paidBy: C }],
        },
        accepted,
      ).holdOffenseAgainst,
    ).toBeNull();
    expect(
      planNationalAssessment(
        {
          ...withPaidReport,
          assessments: [{ ...report, effectiveTick: view.tick - 1 }],
        },
        accepted,
      ).holdOffenseAgainst,
    ).toBeNull();
    expect(
      planNationalAssessment(
        {
          ...withPaidReport,
          assessments: [
            {
              ...report,
              militaryTroopsBand: { lower: "900000", upperExclusive: "800000" },
            },
          ],
        },
        accepted,
      ).holdOffenseAgainst,
    ).toBeNull();
    expect(
      planNationalAssessment({ ...withPaidReport, wars: [] }, accepted)
        .holdOffenseAgainst,
    ).toBeNull();
    expect(
      planNationalAssessment(
        {
          ...withPaidReport,
          coalitions: [
            { id: "pact", kind: "nap", leaderId: A, members: [A, B] },
          ],
        },
        accepted,
      ).holdOffenseAgainst,
    ).toBeNull();
    expect(
      planNationalAssessment(
        { ...withPaidReport, tick: view.tick + 90 },
        accepted,
      ).holdOffenseAgainst,
    ).toBeNull();
    expect(
      planNationalAssessment(
        { ...withPaidReport, tick: view.tick + 900 },
        accepted,
      ).holdOffenseAgainst,
    ).toBeNull();
  });

  it("treats wider shield bands as uncertainty, not free precision or military authority", () => {
    const view = fixture();
    const accepted = recordNationalAssessmentAttempt(
      view,
      initialNationalAssessmentAIMemory(A),
      B,
      "ai_assessment_shield",
      view.tick + 900,
    );
    const wide = {
      ...paidReport(view),
      confidence: "shielded-coarse-estimate",
      treasuryGoldBand: { lower: "0", upperExclusive: "100000" },
      militaryTroopsBand: { lower: "0", upperExclusive: "2000000" },
    };
    expect(
      planNationalAssessment(
        { ...view, tick: view.tick + 1, assessments: [wide] },
        accepted,
      ).holdOffenseAgainst,
    ).toBe(B);
    const weak = {
      ...wide,
      militaryTroopsBand: { lower: "0", upperExclusive: "100000" },
    };
    expect(
      planNationalAssessment(
        { ...view, tick: view.tick + 1, assessments: [weak] },
        accepted,
      ).holdOffenseAgainst,
    ).toBeNull();
    const rejected = recordNationalAssessmentAttempt(
      view,
      initialNationalAssessmentAIMemory(A),
      B,
      "ai_assessment_denied",
      null,
    );
    expect(rejected.attempts[0].outcome).toBe("rejected");
    expect(
      planNationalAssessment(
        { ...view, tick: view.tick + 1, assessments: [wide] },
        rejected,
      ).holdOffenseAgainst,
    ).toBeNull();
    expect(() =>
      recordNationalAssessmentAttempt(
        view,
        accepted,
        C,
        "ai_assessment_ok",
        null,
      ),
    ).toThrow(/duplicate/);
    expect(() =>
      recordNationalAssessmentAttempt(view, accepted, C, "bad id", null),
    ).toThrow(/invalid/);
    expect(() =>
      recordNationalAssessmentAttempt(
        { ...view, observerId: D },
        accepted,
        B,
        "stranger",
        null,
      ),
    ).toThrow(/principal mismatch/);
    expect(JSON.stringify(accepted).length).toBeLessThan(512);
  });
});

type RealAssessmentGame = Game & {
  performNationalAssessment: (
    actor: ReturnType<Game["player"]>,
    targetId: string,
    requestId: string,
  ) => {
    targetId: string;
    payerId: string;
    cost: string;
    requestId: string;
    effectiveTick: number;
    expiresAtTick: number;
  };
  nationalAssessmentsFor: (
    payerId: string,
  ) => readonly {
    payerId: string;
    targetId: string;
    cost: string;
    requestId: string;
    expiresAtTick: number;
  }[];
};

function memoryOf(game: Game) {
  const exec = game
    .executions()
    .find((e) => e instanceof NationExecution && e.playerID() === A);
  return (
    exec as unknown as
      | {
          nationalAssessmentMemory: ReturnType<
            typeof initialNationalAssessmentAIMemory
          > | null;
        }
      | undefined
  )?.nationalAssessmentMemory;
}

async function fourNations() {
  const nations = [
    new Nation(new Cell(48, 100), infos[0]),
    new Nation(new Cell(145, 100), infos[1]),
    new Nation(new Cell(185, 175), infos[2]),
    new Nation(new Cell(185, 25), infos[3]),
  ];
  const game = await setup(
    "big_plains",
    { nationalMode: true, startingGold: 9_000 },
    [],
    undefined,
    undefined,
    false,
    nations,
  );
  game.addExecution(
    new NationExecution(ID, nations[0]),
    ...infos.map(
      (info, i) =>
        new SpawnExecution(
          ID,
          info,
          game.ref(nations[i].spawnCell!.x, nations[i].spawnCell!.y),
        ),
    ),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (let y = 0; y < game.height(); y++) {
    for (let x = 0; x < game.width(); x++) {
      const tile = game.ref(x, y);
      if (!game.isLand(tile) || game.isImpassable(tile)) continue;
      const owner =
        x >= 45 && x <= 60 && y >= 70 && y <= 130
          ? A
          : x >= 180 && y >= 160
            ? C
            : x >= 180 && y <= 40
              ? D
              : B;
      game.player(owner).conquer(tile);
    }
  }
  const scout = game.player(A);
  scout.setTroops(250_000);
  const wallet = scout.gold();
  scout.removeGold(wallet);
  scout.addGold(9_000n);
  game.player(B).setTroops(900_000);
  game.player(B).buildUnit(UnitType.Factory, game.ref(137, 100), {});
  expect(
    collectLiveNationalObservation(game, A).observation.visibleAssets.some(
      (a) => a.ownerId === B && a.kind === "structure",
    ),
  ).toBe(true);
  expect(
    game.performNationalWarCommandWithOutcome(scout, {
      kind: "declare-national",
      warId: "c6_e5_war",
      aggressorId: A,
      targetId: B,
    }).accepted,
  ).toBe(true);
  return game;
}

function runner(game: Game) {
  return new GameRunner(
    game,
    new Executor(game, ID, undefined),
    () => {},
    undefined,
  );
}

function next(game: Game, run: GameRunner) {
  run.addTurn({ turnNumber: game.ticks(), intents: [] });
  expect(run.executeNextTick()).toBe(true);
}

// This acceptance test is explicitly *skipped* on the isolated E5 branch:
// authoritative assessment code belongs to E4. It automatically activates
// after Conductor integrates E4, with NO fake 1200-gold implementation.
const assessmentAuthorityIntegrated =
  "performNationalAssessment" in GameImpl.prototype;
describe("C6 E5 GameRunner + E4 canonical authority integration", () => {
  it.skipIf(!assessmentAuthorityIntegrated)(
    "identical-seed real wallets, purchased recipient-only report and later actual AttackExecution divergence",
    async () => {
      const active = await fourNations();
      const control = await fourNations();
      const buyer = active as RealAssessmentGame;
      const disabled = control as RealAssessmentGame;
      const activeRunner = runner(active);
      const controlRunner = runner(control);
      // Keep regional recon equally disabled in both comparisons to isolate
      // the distinct national-strength purchase's actual strategic effect.
      vi.spyOn(active, "performNationalReconnaissance").mockImplementation(
        () => {
          throw new Error("controlled: independent regional recon disabled");
        },
      );
      vi.spyOn(control, "performNationalReconnaissance").mockImplementation(
        () => {
          throw new Error("controlled: independent regional recon disabled");
        },
      );
      const purchases = vi.spyOn(buyer, "performNationalAssessment");
      const disabledBuy = vi
        .spyOn(disabled, "performNationalAssessment")
        .mockImplementation(() => {
          throw new Error("controlled no assessment sale");
        });
      const debit = vi.spyOn(active.player(A), "removeGold");
      const activeAdd = vi.spyOn(active, "addExecution");
      const controlAdd = vi.spyOn(control, "addExecution");
      expect(active.player(A).gold()).toBe(control.player(A).gold());
      for (let i = 0; i < 20; i++) {
        next(active, activeRunner);
        next(control, controlRunner);
      }
      expect(purchases).toHaveBeenCalledTimes(1);
      expect(disabledBuy).toHaveBeenCalledTimes(1);
      expect(buyer.nationalAssessmentsFor(A)).toHaveLength(1);
      expect(disabled.nationalAssessmentsFor(A)).toHaveLength(0);
      const grant = buyer.nationalAssessmentsFor(A)[0];
      expect(grant).toMatchObject({ payerId: A, targetId: B, cost: "1200" });
      expect(
        debit.mock.calls.filter(([amount]) => amount === 1200n),
      ).toHaveLength(1);
      expect(memoryOf(active)?.attempts).toHaveLength(1);
      expect(memoryOf(active)?.attempts[0].outcome).toBe("accepted");
      expect(memoryOf(control)?.attempts[0].outcome).toBe("rejected");
      const seen = collectLiveNationalObservation(active, A)
        .observation as AssessmentObservation;
      const stranger = collectLiveNationalObservation(active, C)
        .observation as AssessmentObservation;
      expect(seen.assessments?.find((r) => r.targetId === B)?.paidBy).toBe(A);
      expect(stranger.assessments ?? []).toHaveLength(0);
      const attacks = (spy: typeof activeAdd) =>
        spy.mock.calls
          .flat()
          .filter(
            (e): e is AttackExecution =>
              e instanceof AttackExecution,
          );
      expect(attacks(controlAdd).length).toBeGreaterThan(0);
      expect(attacks(activeAdd)).toHaveLength(0);
      const { restored, bytes, again } = await roundTrip(active, "big_plains");
      expect(again).toEqual(bytes);
      expect(memoryOf(restored)).toEqual(memoryOf(active));
      expect(() =>
        (restored as RealAssessmentGame).performNationalAssessment(
          restored.player(A),
          B,
          grant.requestId,
        ),
      ).toThrow(/duplicate/);
      expect(buyer.nationalAssessmentsFor(A)).toHaveLength(1);
      purchases.mockRestore();
      disabledBuy.mockRestore();
      debit.mockRestore();
    },
    120_000,
  );
});
