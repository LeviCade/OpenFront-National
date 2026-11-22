import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import {
  assessImperialShelter,
  initialNationalCoercionMemory,
  observedImperialReach,
  planObservedImperialCoercion,
  updateNationalCoercionMemory,
  type ObservedImperialUltimatum,
} from "@openfront/engine/national/ai/NationalCoercionStrategy";
import {
  initialNationalPlannerMemory,
  planNationalInterest,
} from "@openfront/engine/national/ai/NationalPlanner";
import {
  initialAIPoliticalMemory,
  planAIPoliticalInterest,
} from "@openfront/engine/national/ai/NationalPoliticalStrategy";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import {
  projectNationalObservation,
  type NationalWorld,
} from "@openfront/engine/national/observation/NationalObservation";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const A = "c5c2e6-alpha",
  B = "c5c2e6-bravo",
  C = "c5c2e6-charlie",
  D = "c5c2e6-delta";
function baseWorld(): NationalWorld {
  return {
    tick: 80,
    nations: [
      {
        id: A,
        name: "Alpha",
        landPercent: 0.4,
        status: "independent",
        alive: true,
        controllerKind: "ai",
        troops: 900,
        treasury: 50,
      },
      {
        id: B,
        name: "Bravo",
        landPercent: 12,
        status: "independent",
        alive: true,
        controllerKind: "human",
        troops: 900000,
        treasury: 999999,
      },
      {
        id: C,
        name: "Charlie",
        landPercent: 25,
        status: "imperial",
        alive: true,
        controllerKind: "human",
        troops: 999999,
        treasury: 999999,
      },
      {
        id: D,
        name: "Delta",
        landPercent: 3,
        status: "member",
        alive: true,
        controllerKind: "ai",
        troops: 200,
        treasury: 0,
      },
    ],
    coalitions: [
      { id: "crown", kind: "empire", leaderId: C, members: [C, D], terms: {} },
    ],
    invitations: [],
    imperialOffers: [
      { empireId: "crown", candidateId: A, proposerId: C, recipientId: A },
    ],
    wars: [
      {
        id: "real-threat",
        scope: "national",
        first: { kind: "nation", stableId: B, activeMemberIds: [B] },
        second: { kind: "nation", stableId: A, activeMemberIds: [A] },
        startedTick: 50,
      },
    ],
    assets: [
      {
        id: "bravo-visible-army",
        ownerId: B,
        kind: "army",
        x: 30,
        y: 30,
        strength: 999999,
      },
      {
        id: "secret-charlie-transport",
        ownerId: C,
        kind: "transport",
        x: 90,
        y: 90,
        landingDestination: { x: 4, y: 4 },
      },
    ],
    sightGrants: [
      {
        observerId: A,
        assetId: "bravo-visible-army",
        source: "border",
        observedAtTick: 80,
        expiresAtTick: 80,
      },
    ],
    frontiers: [
      { observerId: A, targetId: B, access: "land" },
      { observerId: A, targetId: C, access: "naval" },
      { observerId: C, targetId: A, access: "land" },
      { observerId: D, targetId: B, access: "land" },
    ],
    unownedFrontier: false,
    diplomaticEvents: [],
  };
}
function demand(
  phase: ObservedImperialUltimatum["phase"] = "pending",
): ObservedImperialUltimatum {
  return {
    id: "ultimatum-1",
    empireId: "crown",
    issuerId: C,
    targetId: A,
    role: "recipient",
    threat: "imperial-war",
    deadlineTick: 110,
    phase,
    response: phase === "consented" ? "accept" : "none",
  };
}
const projected = (world: NationalWorld, id = A) =>
  projectNationalObservation(world, id);

describe("C5 Class Two E6 sovereign coercion — AI-01/04/05/06/07, ECON-06/07", () => {
  it("ECON-06 refuses a distant bluff even when public empire land is huge; no hidden transport magic", () => {
    const w = baseWorld();
    const observation = projected(w);
    const empire = observation.coalitions.find((c) => c.id === "crown")!;
    expect(observedImperialReach(observation, empire)).toBe("none");
    expect(JSON.stringify(observation)).not.toContain(
      "secret-charlie-transport",
    );
    expect(JSON.stringify(observation)).not.toContain("landingDestination");
    const memory = initialNationalCoercionMemory(A);
    expect(
      planObservedImperialCoercion(observation, [demand()], memory),
    ).toMatchObject({
      kind: "resist",
      reason: "unreachable-or-bluff",
    });
    expect(
      planAIPoliticalInterest(
        observation,
        initialAIPoliticalMemory(),
        25,
        [],
        [demand()],
      ).decision,
    ).toEqual({ command: null, reason: "preserve-independence" });
    expect(w.coalitions[0].members).toEqual([C, D]);
  });

  it("AI-01 and FOG-07 ignore opponent controller, secret gold, hidden fleet and undisclosed destination", () => {
    const original = baseWorld();
    const swapped: NationalWorld = {
      ...original,
      nations: original.nations.map((n) => ({
        ...n,
        controllerKind: n.controllerKind === "ai" ? "human" : "ai",
        treasury: n.id === B ? 0 : 17,
        troops: n.id === B ? 1 : 42,
      })),
      assets: original.assets.map((a) =>
        a.id === "secret-charlie-transport"
          ? { ...a, landingDestination: { x: 1, y: 1 }, strength: 999999 }
          : a,
      ),
    };
    const first = projected(original),
      second = projected(swapped);
    expect(first).toEqual(second);
    expect(
      planObservedImperialCoercion(
        first,
        [demand()],
        initialNationalCoercionMemory(A),
      ),
    ).toEqual(
      planObservedImperialCoercion(
        second,
        [demand()],
        initialNationalCoercionMemory(A),
      ),
    );
  });

  it("ECON-07: a reachable protector can receive a lawful consent decision under existential WAR", () => {
    const w: NationalWorld = {
      ...baseWorld(),
      frontiers: [
        { observerId: A, targetId: B, access: "land" },
        { observerId: A, targetId: C, access: "land" },
      ],
    };
    const obs = projected(w);
    const assessment = assessImperialShelter(
      obs,
      obs.coalitions[0],
      initialNationalCoercionMemory(A),
    );
    expect(assessment).toMatchObject({
      protectorViable: true,
      reachable: true,
      existential: true,
      independentRoute: false,
    });
    expect(
      planObservedImperialCoercion(
        obs,
        [demand()],
        initialNationalCoercionMemory(A),
      )?.kind,
    ).toBe("acknowledge-consent");
    expect(
      planObservedImperialCoercion(
        obs,
        [demand("consented")],
        initialNationalCoercionMemory(A),
      ),
    ).toMatchObject({
      kind: "accept-consent",
      empireId: "crown",
    });
    expect(
      planAIPoliticalInterest(
        obs,
        initialAIPoliticalMemory(),
        25,
        [],
        [demand("consented")],
      ).decision?.command,
    ).toEqual({ kind: "accept-empire", empireId: "crown", candidateId: A });
    expect(
      planObservedImperialCoercion(
        { ...obs, imperialOffers: [] },
        [demand("consented")],
        initialNationalCoercionMemory(A),
      )?.kind,
    ).toBe("request-consent");
  });

  it("AI-04 refuses accession while an independent neutral-growth route survives", () => {
    const w: NationalWorld = {
      ...baseWorld(),
      wars: [],
      unownedFrontier: true,
      frontiers: [
        { observerId: A, targetId: B, access: "land" },
        { observerId: A, targetId: C, access: "land" },
      ],
    };
    expect(
      planObservedImperialCoercion(
        projected(w),
        [demand()],
        initialNationalCoercionMemory(A),
      )?.kind,
    ).toBe("resist");
  });

  it("AI-05 refuses a publicly overwhelmed and historically collapsing protector", () => {
    const w: NationalWorld = {
      ...baseWorld(),
      nations: baseWorld().nations.map((n) =>
        n.id === C
          ? { ...n, landPercent: 5 }
          : n.id === B
            ? { ...n, landPercent: 60 }
            : n,
      ),
      wars: [
        ...baseWorld().wars,
        {
          id: "empire-collapse-war",
          scope: "national",
          first: { kind: "nation", stableId: B, activeMemberIds: [B] },
          second: { kind: "nation", stableId: C, activeMemberIds: [C] },
          startedTick: 20,
        },
      ],
      frontiers: [
        { observerId: A, targetId: B, access: "land" },
        { observerId: A, targetId: C, access: "land" },
      ],
    };
    const obs = projected(w);
    const memory = updateNationalCoercionMemory(
      projected(baseWorld()),
      [],
      initialNationalCoercionMemory(A),
    );
    const decision = planObservedImperialCoercion(obs, [demand()], memory);
    expect(
      assessImperialShelter(obs, obs.coalitions[0], memory).declining,
    ).toBe(true);
    expect(decision?.kind).toBe("resist");
    expect(
      planAIPoliticalInterest(
        obs,
        { ...initialAIPoliticalMemory(), coercion: memory },
        25,
      ).decision?.command?.kind,
    ).not.toBe("accept-empire");
  });

  it("AI-07: genuine enforcement increases credibility; genuine backdown reduces it; replay does not double count", () => {
    const obs = projected(baseWorld());
    const first = updateNationalCoercionMemory(
      obs,
      [demand("enforced")],
      initialNationalCoercionMemory(A),
    );
    expect(first.issuerCredibility.find((e) => e.issuerId === C)?.score).toBe(
      2,
    );
    const secondView = { ...demand("backed-down"), id: "ultimatum-2" };
    const second = updateNationalCoercionMemory(
      { ...obs, tick: 81 },
      [demand("enforced"), secondView],
      first,
    );
    expect(second.issuerCredibility.find((e) => e.issuerId === C)?.score).toBe(
      -1,
    );
    const replay = updateNationalCoercionMemory(
      { ...obs, tick: 82 },
      [demand("enforced"), secondView],
      JSON.parse(JSON.stringify(second)),
    );
    expect(replay.issuerCredibility).toEqual(second.issuerCredibility);
    expect(replay.processedOutcomeIds).toEqual(second.processedOutcomeIds);
    expect(() =>
      updateNationalCoercionMemory(projected(baseWorld(), B), [], second),
    ).toThrow(/principal/);
    const bluffed = updateNationalCoercionMemory(
      { ...obs, tick: 85 },
      [
        ...["3", "4"].map((id) => ({
          ...demand("backed-down"),
          id: "ultimatum-" + id,
        })),
      ],
      replay,
    );
    const reachable = {
      ...obs,
      frontiers: [
        { targetId: B, access: "land" as const },
        { targetId: C, access: "land" as const },
      ],
    };
    expect(
      planObservedImperialCoercion(reachable, [demand()], bluffed)?.kind,
    ).toBe("resist");
    // A recipient must not learn an outcome directed at a different principal.
    const foreign = { ...demand("enforced"), id: "foreign", targetId: B };
    expect(
      updateNationalCoercionMemory(obs, [foreign], bluffed).processedOutcomeIds,
    ).not.toContain("foreign");
  });

  it("AI-06 imperial member retains empire victory objective and lawful expansion", () => {
    const w: NationalWorld = {
      ...baseWorld(),
      nations: baseWorld().nations.map((n) =>
        n.id === A ? { ...n, status: "member" as const } : n,
      ),
      coalitions: [
        {
          id: "crown",
          kind: "empire",
          leaderId: C,
          members: [A, C, D],
          terms: {},
        },
      ],
      imperialOffers: [],
      unownedFrontier: true,
      wars: [],
    };
    const obs = projected(w);
    expect(
      planAIPoliticalInterest(obs, initialAIPoliticalMemory(), 25).decision,
    ).toEqual({ command: null, reason: "serve-empire" });
    expect(
      planNationalInterest(obs, initialNationalPlannerMemory(A), 30).decision
        ?.objective,
    ).toBe("expand");
  });

  it("imperial issuer distinguishes legitimate reachable enforcement from an actual backdown", () => {
    const w = baseWorld();
    const view = { ...demand("decision-required"), role: "issuer" as const };
    const issuerObs = projected(w, C);
    expect(
      planObservedImperialCoercion(
        issuerObs,
        [view],
        initialNationalCoercionMemory(C),
      )?.kind,
    ).toBe("enforce");
    const isolated = projected(
      { ...w, frontiers: w.frontiers.filter((f) => f.observerId !== C) },
      C,
    );
    expect(
      planObservedImperialCoercion(
        isolated,
        [view],
        initialNationalCoercionMemory(C),
      )?.kind,
    ).toBe("back-down");
  });
});

describe("E6 live GameRunner sovereign command and replay receipt", () => {
  it("executes a genuinely accepted imperial consent against a live WAR without creating resources or bypassing command authority", async () => {
    const ai = new PlayerInfo("Alpha", PlayerType.Nation, null, A);
    const br = new PlayerInfo("Bravo", PlayerType.Human, "e6-bravo-client", B);
    const cr = new PlayerInfo(
      "Charlie",
      PlayerType.Human,
      "e6-crown-client",
      C,
    );
    const nation = new Nation(new Cell(15, 25), ai);
    const game = await setup(
      "plains",
      { nationalMode: true },
      [br, cr],
      undefined,
      undefined,
      true,
      [nation],
    );
    const gid = "e6-live-credible";
    game.addExecution(
      new NationExecution(gid, nation),
      new SpawnExecution(gid, ai, game.ref(15, 25)),
      new SpawnExecution(gid, br, game.ref(55, 25)),
      new SpawnExecution(gid, cr, game.ref(85, 25)),
    );
    game.executeNextTick();
    game.executeNextTick();
    game.endSpawnPhase();
    // Own land is real, with a narrow C/A frontier and a separate B/A threat.
    const width = game.width(),
      height = game.height();
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const cell = game.ref(x, y);
        if (!game.isLand(cell) || game.isImpassable(cell)) continue;
        const owner =
          x < Math.floor(width * 0.08)
            ? A
            : x < Math.floor(width * 0.52)
              ? B
              : C;
        game.player(owner).conquer(cell);
      }
    for (let y = 10; y < height - 10; y++) {
      const x = Math.floor(width * 0.08);
      const tile = game.ref(x, y);
      if (game.isLand(tile) && !game.isImpassable(tile))
        game.player(C).conquer(tile);
    }
    game.player(A).setTroops(900);
    game.player(B).setTroops(200000);
    game.player(C).setTroops(300000);
    game.performNationalCommand(game.player(C), {
      kind: "found-empire",
      empireId: "e6-crown",
    });
    const invitation = game.performNationalPoliticalCommandWithOutcome(
      game.player(C),
      { kind: "offer-empire", empireId: "e6-crown", candidateId: A },
    );
    expect(invitation.accepted).toBe(true);
    const war = game.performNationalWarCommandWithOutcome(game.player(B), {
      kind: "declare-national",
      warId: "e6-threat",
      aggressorId: B,
      targetId: A,
    });
    expect(war.accepted).toBe(true);
    const beforeGold = [A, B, C].map((id) => game.player(id).gold().toString());
    const beforeTroops = [A, B, C].map((id) => game.player(id).troops());
    const obs = collectLiveNationalObservation(game, A).observation;
    expect(obs.wars.some((w) => w.id === "e6-threat")).toBe(true);
    const result = planAIPoliticalInterest(
      obs,
      initialAIPoliticalMemory(),
      25,
      [],
      [
        {
          id: "e6-ultimatum",
          empireId: "e6-crown",
          issuerId: C,
          targetId: A,
          role: "recipient",
          threat: "imperial-war",
          phase: "consented",
          deadlineTick: game.ticks() + 40,
          response: "accept",
        },
      ],
    );
    expect(result.decision?.command).toEqual({
      kind: "accept-empire",
      empireId: "e6-crown",
      candidateId: A,
    });
    const outcome = game.performNationalPoliticalCommandWithOutcome(
      game.player(A),
      result.decision!.command!,
    );
    expect(outcome.accepted).toBe(true);
    expect(game.nationalPoliticalAuthority()?.empireOf(A)).toBe("e6-crown");
    expect([A, B, C].map((id) => game.player(id).gold().toString())).toEqual(
      beforeGold,
    );
    expect([A, B, C].map((id) => game.player(id).troops())).toEqual(
      beforeTroops,
    );
    const runner = new GameRunner(
      game,
      new Executor(game, gid, undefined),
      () => {},
      "e6-bravo-client",
    );
    for (let i = 0; i < 8; i++) {
      runner.addTurn({ turnNumber: game.ticks(), intents: [] });
      expect(runner.executeNextTick()).toBe(true);
    }
    expect(game.nationalPoliticalAuthority()?.empireOf(A)).toBe("e6-crown");
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...bytes]).toEqual([...again]);
    expect(restored.nationalPoliticalAuthority()?.empireOf(A)).toBe("e6-crown");
    console.info(
      "E6_LIVE_COMMAND_WITNESS=" +
        JSON.stringify({
          actor: A,
          issuer: C,
          enemy: B,
          command: result.decision?.command,
          receipt: {
            accepted: outcome.accepted,
            sequence: outcome.sequence,
            reason: outcome.reason,
          },
          crown: game.nationalPoliticalAuthority()?.empireOf(A),
          ticks: game.ticks(),
        }),
    );
  });
});
