import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { NationalSanctionExecution } from "@openfront/engine/execution/NationalSanctionExecution";
import { TradeShipExecution } from "@openfront/engine/execution/TradeShipExecution";
import { TrainExecution } from "@openfront/engine/execution/TrainExecution";
import { Railroad } from "@openfront/engine/game/Railroad";
import { TrainStation } from "@openfront/engine/game/TrainStation";
import type { Game, Player, Unit } from "@openfront/engine/game/Game";
import {
  initialNationalEconomicMemory,
  planNationalEconomicDecision,
  updateNationalEconomicMemory,
} from "@openfront/engine/national/ai/NationalEconomicPlanner";
import {
  projectNationalObservation,
  type NationalWorld,
} from "@openfront/engine/national/observation/NationalObservation";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const MAP = "half_land_half_ocean";
const [A, B, C, D] = ["c5-e5-a", "c5-e5-b", "c5-e5-c", "c5-e5-d"];
const people = [A, B, C, D].map(
  (id) => new PlayerInfo(id, PlayerType.Human, null, id),
);

class EconomicConfig extends TestConfig {
  warshipPatrolRange(): number {
    return 16;
  }
}

function tick(game: Game, count = 1): void {
  for (let i = 0; i < count; i++) game.executeNextTick();
}
function until(game: Game, predicate: () => boolean, limit = 160) {
  for (let i = 0; i < limit && !predicate(); i++) tick(game);
  expect(predicate()).toBe(true);
}
function ledger(game: Game) {
  return people.map(({ id }) => {
    const player = game.player(id);
    return {
      id,
      gold: player.gold().toString(),
      trade: player.tradeGold().toString(),
      train: player.trainGold().toString(),
      piracy: player.piracyGold().toString(),
    };
  });
}
function witness(game: Game, scenario: string, before: ReturnType<typeof ledger>) {
  console.info("C5_E5_ECONOMIC_WITNESS=" + JSON.stringify({
    scenario,
    tick: game.ticks(),
    before,
    after: ledger(game),
    views: {
      issuer: NationalSanctionExecution.viewFor(game, game.player(A)),
      recipient: NationalSanctionExecution.viewFor(game, game.player(B)),
    },
  }));
}
async function live(seed: number) {
  const game = await setup(
    MAP,
    { nationalMode: true, instantBuild: true },
    people,
    undefined,
    EconomicConfig,
  );
  for (const [index, info] of people.entries()) {
    const p = game.player(info.id);
    const spawn = game.ref(1, index * 4 + 1);
    p.conquer(spawn);
    p.setSpawnTile(spawn);
    p.addGold(1_000_000_000n);
    p.setTroops(100);
  }
  tick(game);
  const [a, b, c, d] = people.map((info) => game.player(info.id));
  const makePort = (p: Player, y: number) => {
    const cell = game.ref(7, y);
    p.conquer(cell);
    return p.buildUnit(UnitType.Port, cell, {});
  };
  const ca = makePort(a, 10);
  const bb = makePort(b, 14);
  const cc = makePort(c, 1);
  makePort(d, 5);
  // Genuine geographic land frontier between issuer and the declared target.
  // The AI must observe this via its normal game-bound sight collector.
  a.conquer(game.ref(3, 2));
  c.conquer(game.ref(4, 2));
  tick(game);
  expect(
    game.performNationalWarCommandWithOutcome(a, {
      kind: "declare-national",
      warId: "c5-e5-war-" + seed,
      aggressorId: A,
      targetId: C,
    }).accepted,
  ).toBe(true);
  return { game, a, b, c, d, ca, bb, cc };
}
function voyage(game: Game, p: Player, from: Unit, to: Unit) {
  const exec = new TradeShipExecution(p, from, to);
  game.addExecution(exec);
  tick(game, 2);
  return exec;
}

describe("C5 First Class E5 autonomous national economic statecraft", () => {
  it("AI-07/ECON-05: pure issuer policy requires observed enemy, real own voyage and sovereign capacity", () => {
    const world: NationalWorld = {
      tick: 20,
      nations: [A, B, C].map((id) => ({
        id, name: id, landPercent: 33, status: "independent" as const,
        alive: true, troops: 100, treasury: 100,
      })),
      coalitions: [],
      wars: [{
        id: "economic-war",
        scope: "national",
        first: { kind: "nation", stableId: A, activeMemberIds: [A] },
        second: { kind: "nation", stableId: C, activeMemberIds: [C] },
        startedTick: 1,
      }],
      invitations: [],
      assets: [],
      sightGrants: [],
      frontiers: [{ observerId: A, targetId: C, access: "land" }],
      diplomaticEvents: [],
    };
    const ties = [{ partnerId: B, tradePermitted: true, activeOwnVoyages: 2 }];
    const obs = projectNationalObservation(world, A);
    expect(planNationalEconomicDecision(obs, [], ties)).toEqual({
      kind: "issue", scope: "national", targetId: C,
      recipientIds: [B], durationTicks: 30,
    });
    expect(planNationalEconomicDecision(obs, [], [{ ...ties[0], activeOwnVoyages: 0 }])).toBeNull();
    expect(planNationalEconomicDecision(
      projectNationalObservation({
        ...world, frontiers: [{ observerId: A, targetId: C, access: "naval" }],
      }, A), [], ties,
    )).toBeNull();
    expect(planNationalEconomicDecision(
      projectNationalObservation({
        ...world, coalitions: [{
          id: "empire", kind: "empire", leaderId: B,
          members: [B, A], terms: {},
        }],
      }, A), [], ties,
    )).toBeNull();
    expect(planNationalEconomicDecision(
      projectNationalObservation({
        ...world,
        nations: world.nations.map((n) => n.id === A ? { ...n, status: "imperial" } : n),
        coalitions: [{
          id: "empire", kind: "empire", leaderId: A,
          members: [A], terms: {},
        }],
      }, A), [], ties,
    )?.kind).toBe("issue");
  });

  it("ECON-06/AI-07: bounded observed fulfillment and bluff persist and change next response", () => {
    const world: NationalWorld = {
      tick: 50,
      nations: [A, B, C].map((id) => ({
        id, name: id, landPercent: 20, status: "independent" as const,
        alive: true, troops: 0, treasury: 0,
      })),
      coalitions: [], wars: [], invitations: [], assets: [],
      sightGrants: [], frontiers: [], diplomaticEvents: [],
    };
    const obs = projectNationalObservation(world, B);
    const demand = {
      id: "old", issuer: A, authorityId: A, empire: null,
      role: "recipient" as const, recipientIds: [B],
      target: C, deadline: 20, phase: "enforced" as const,
      trigger: "continuing-trade" as const,
      threat: "embargo" as const,
      response: "refuse" as const,
      requestId: null,
    };
    const next = { ...demand, id: "next", deadline: 60, phase: "pending" as const, response: "none" as const };
    const ties = [
      { partnerId: A, tradePermitted: true, activeOwnVoyages: 0 },
      { partnerId: C, tradePermitted: true, activeOwnVoyages: 0 },
    ];
    const memory = initialNationalEconomicMemory(B);
    const fulfilled = updateNationalEconomicMemory(obs, [demand], memory);
    const bluffed = updateNationalEconomicMemory(obs, [
      { ...demand, phase: "backed-down" },
    ], memory);
    expect(fulfilled.credibility[0].score).toBe(2);
    expect(bluffed.credibility[0].score).toBe(-3);
    expect(updateNationalEconomicMemory(obs, [demand], fulfilled)).toEqual(fulfilled);
    expect(planNationalEconomicDecision(obs, [next], ties, fulfilled)).toMatchObject({
      kind: "respond", decision: "comply",
    });
    expect(planNationalEconomicDecision(obs, [next], ties, bluffed)).toMatchObject({
      kind: "respond", decision: "refuse",
    });
    expect(() => updateNationalEconomicMemory(
      projectNationalObservation(world, A), [demand], fulfilled,
    )).toThrow("principal mismatch");
  });

  for (const seed of [17, 73]) {
    it("ECON-02–07 live seed " + seed + ": AI issues, recipient complies, and paid trade is denied", async () => {
      const { game, a, b, c, ca, bb, cc } = await live(seed);
      const before = ledger(game);
      const route = voyage(game, a, ca, bb);
      expect(route.isActive()).toBe(true);
      game.convertHumanToNation(a, "c5-e5-issuer-" + seed);
      until(game, () => NationalSanctionExecution.viewFor(game, a).length > 0, 60);
      const demand = NationalSanctionExecution.viewFor(game, a)[0];
      expect(demand.issuer).toBe(A);
      expect(demand.target).toBe(C);
      expect(demand.recipientIds).toEqual([B]);
      expect(NationalSanctionExecution.viewFor(game, c)).toEqual([]);
      // A genuinely profitable, long-distance B→A merchant tie makes
      // preserving issuer trade worth more than the unused B→C route.
      const distantTile = game.ref(7, 4);
      a.conquer(distantTile);
      const distantA = a.buildUnit(UnitType.Port, distantTile, {});
      tick(game);
      const dependentTrade = voyage(game, b, bb, distantA);
      expect(dependentTrade.isActive()).toBe(true);
      game.convertHumanToNation(b, "c5-e5-recipient-" + seed);
      until(game, () =>
        NationalSanctionExecution.viewFor(game, b)[0]?.response !== undefined &&
        NationalSanctionExecution.viewFor(game, b)[0].response !== "none",
      50);
      expect(NationalSanctionExecution.viewFor(game, b)[0].response).toBe("comply");
      expect(b.canTrade(c)).toBe(false);
      const blocked = voyage(game, b, bb, cc);
      expect(blocked.isActive()).toBe(false);
      const noBtoC = ledger(game);
      tick(game, 5);
      expect(b.tradeGold()).toBe(BigInt(noBtoC[1].trade));
      expect(c.tradeGold()).toBe(BigInt(noBtoC[2].trade));
      const { bytes, again, restored } = await roundTrip(game, MAP);
      expect(again).toEqual(bytes);
      expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
      expect(restored.player(B).canTrade(restored.player(C))).toBe(false);
      witness(game, "seed-" + seed + "-compliance", before);
    });
  }

  it("ECON-03/06 live: refusal pays actual gold, issuer AI enforces with a real embargo", async () => {
    const { game, a, b, c, ca, bb, cc } = await live(113);
    const leverage = voyage(game, a, ca, bb);
    expect(leverage.isActive()).toBe(true);
    const defiant = voyage(game, b, bb, cc);
    expect(defiant.isActive()).toBe(true);
    game.convertHumanToNation(a, "c5-e5-issuer-113");
    until(game, () => NationalSanctionExecution.viewFor(game, a).length > 0, 60);
    game.convertHumanToNation(b, "c5-e5-recipient-113");
    until(game, () =>
      NationalSanctionExecution.viewFor(game, b)[0]?.response !== undefined &&
        NationalSanctionExecution.viewFor(game, b)[0].response !== "none",
    60);
    expect(NationalSanctionExecution.viewFor(game, b)[0].response).toBe("refuse");
    expect(b.canTrade(c)).toBe(true);
    until(game, () => !defiant.isActive(), 100);
    expect(b.tradeGold()).toBeGreaterThan(0n);
    expect(c.tradeGold()).toBeGreaterThan(0n);
    until(game, () =>
      NationalSanctionExecution.viewFor(game, a)[0]?.phase === "enforced",
    120);
    expect(a.canTrade(b)).toBe(false);
    expect(b.canTrade(c)).toBe(true);
    const after = ledger(game);
    expect(voyage(game, a, ca, bb).isActive()).toBe(false);
    expect(ledger(game)).toEqual(after);
    // A *second*, canonical demand is deliberately issued by a real actor,
    // while recipient B's autonomous controller has observed A's enforcement.
    // Without that observed reputation the recipient would refuse: no A trade
    // is presently permitted, and C trade remains nominally permitted.
    tick(game, 5);
    game.addExecution(new NationalSanctionExecution(a, {
      type: "national_issue_sanction", scope: "national",
      targetId: C, recipientIds: [B], durationTicks: 30,
      requestId: "c5-e5-second-after-enforcement",
    }));
    tick(game, 2);
    const fresh = NationalSanctionExecution.viewFor(game, b).find(
      (row) => row.id !== "sanction-8-1-3",
    );
    expect(fresh?.phase).toBe("pending");
    const naive = planNationalEconomicDecision(
      collectLiveNationalObservation(game, B).observation,
      [fresh!],
      [
        { partnerId: A, tradePermitted: b.canTrade(a), activeOwnVoyages: 0 },
        { partnerId: C, tradePermitted: b.canTrade(c), activeOwnVoyages: 0 },
      ],
      initialNationalEconomicMemory(B),
    );
    expect(naive).toMatchObject({ kind: "respond", decision: "refuse" });
    until(game, () => NationalSanctionExecution.viewFor(game, b).some(
      (row) => row.id === fresh?.id && row.response === "comply",
    ), 50);
    expect(b.canTrade(c)).toBe(false);
    witness(game, "seed-113-enforcement-changes-next-ai-choice", after);
  });

  it("ECON-03/06: AI issuer backs down after losing observed reach and recipient learns the bluff", async () => {
    const { game, a, b, c, ca, bb } = await live(221);
    const before = ledger(game);
    const leverage = voyage(game, a, ca, bb);
    expect(leverage.isActive()).toBe(true);
    game.convertHumanToNation(a, "c5-e5-issuer-221");
    until(game, () => NationalSanctionExecution.viewFor(game, a).length > 0, 60);
    const original = NationalSanctionExecution.viewFor(game, a)[0];
    game.addExecution(new NationalSanctionExecution(b, {
      type: "national_respond_sanction", sanctionId: original.id,
      decision: "refuse", requestId: "c5-e5-human-refuses",
    }));
    tick(game, 2);
    expect(NationalSanctionExecution.viewFor(game, b)[0].response).toBe("refuse");
    // Genuine map ownership no longer supplies the issuer a discovered
    // land frontier to the declared target. No synthetic planner flags.
    c.conquer(game.ref(3, 2));
    a.setTroops(10);
    game.convertHumanToNation(b, "c5-e5-learns-bluff");
    until(game, () =>
      NationalSanctionExecution.viewFor(game, a)[0].phase === "backed-down",
    100);
    expect(a.canTrade(b)).toBe(true);
    expect(b.canTrade(c)).toBe(true);
    tick(game, 6); // Recipient's own AI observes the terminal outcome.
    const tile = game.ref(7, 4);
    a.conquer(tile);
    const distant = a.buildUnit(UnitType.Port, tile, {});
    tick(game);
    const dependency = voyage(game, b, bb, distant);
    expect(dependency.isActive()).toBe(true);
    game.addExecution(new NationalSanctionExecution(a, {
      type: "national_issue_sanction", scope: "national",
      targetId: C, recipientIds: [B], durationTicks: 30,
      requestId: "c5-e5-second-after-bluff",
    }));
    tick(game, 2);
    const next = NationalSanctionExecution.viewFor(game, b).find(
      (row) => row.id !== original.id,
    );
    expect(next?.phase).toBe("pending");
    expect(planNationalEconomicDecision(
      collectLiveNationalObservation(game, B).observation,
      [next!],
      [
        { partnerId: A, tradePermitted: b.canTrade(a), activeOwnVoyages: 1 },
        { partnerId: C, tradePermitted: b.canTrade(c), activeOwnVoyages: 0 },
      ],
      initialNationalEconomicMemory(B),
    )).toMatchObject({ kind: "respond", decision: "comply" });
    until(game, () => NationalSanctionExecution.viewFor(game, b).some(
      (row) => row.id === next?.id && row.response === "refuse",
    ), 50);
    expect(b.canTrade(c)).toBe(true);
    witness(game, "seed-221-backdown-changes-next-ai-choice", before);
  });

  it("ECON-02/07: AI-authored demand stops a live train after a paid railroad control", async () => {
    const { game, a, b, c, ca, bb } = await live(313);
    // Real city stations and a physical railroad, not simulated gold.
    const tiles = Array.from({ length: 12 }, (_, i) => game.ref(3, i + 1));
    b.conquer(tiles[0]);
    c.conquer(tiles[tiles.length - 1]);
    const from = new TrainStation(game, b.buildUnit(UnitType.City, tiles[0], {}));
    const to = new TrainStation(game, c.buildUnit(UnitType.City, tiles[tiles.length - 1], {}));
    const network = game.railNetwork();
    network.stationManager().addStation(from);
    network.stationManager().addStation(to);
    const rail = new Railroad(from, to, tiles, 1);
    from.addRailroad(rail);
    to.addRailroad(rail);
    const initial = ledger(game);
    const control = new TrainExecution(network, b, from, to, 1);
    game.addExecution(control);
    until(game, () => !control.isActive(), 90);
    expect(b.trainGold()).toBeGreaterThan(0n);
    expect(b.trainGold()).toBe(c.trainGold());
    expect(b.gold() - BigInt(initial[1].gold)).toBe(b.trainGold());
    expect(c.gold() - BigInt(initial[2].gold)).toBe(c.trainGold());
    witness(game, "seed-313-pre-sanction-paid-rail", initial);
    const route = voyage(game, a, ca, bb);
    expect(route.isActive()).toBe(true);
    game.convertHumanToNation(a, "c5-e5-issuer-313");
    until(game, () => NationalSanctionExecution.viewFor(game, a).length > 0, 70);
    const demand = NationalSanctionExecution.viewFor(game, a)[0];
    expect(demand.issuer).toBe(A);
    game.addExecution(new NationalSanctionExecution(b, {
      type: "national_respond_sanction",
      sanctionId: demand.id,
      decision: "comply",
      requestId: "c5-e5-rail-compliance",
    }));
    tick(game, 2);
    expect(b.canTrade(c)).toBe(false);
    const blockedBefore = ledger(game);
    const blocked = new TrainExecution(network, b, from, to, 1);
    game.addExecution(blocked);
    until(game, () => !blocked.isActive(), 90);
    expect(b.trainGold()).toBe(BigInt(blockedBefore[1].train));
    expect(c.trainGold()).toBe(BigInt(blockedBefore[2].train));
    witness(game, "seed-313-post-sanction-blocked-rail", blockedBefore);
  });

  it("ECON-04: actual imperial subordinate command is rejected", async () => {
    const { game, a, b, c } = await live(211);
    game.performNationalCommand(a, { kind: "found-empire", empireId: "c5-e5-empire" });
    game.performNationalCommand(a, {
      kind: "offer-empire", empireId: "c5-e5-empire", candidateId: B,
    });
    game.performNationalCommand(b, {
      kind: "accept-empire", empireId: "c5-e5-empire", candidateId: B,
    });
    game.addExecution(new NationalSanctionExecution(b, {
      type: "national_issue_sanction", scope: "imperial",
      targetId: C, recipientIds: [D], durationTicks: 30,
      requestId: "c5-e5-illegal-subordinate",
    }));
    tick(game, 2);
    expect(NationalSanctionExecution.viewFor(game, a)).toEqual([]);
    expect(NationalSanctionExecution.viewFor(game, c)).toEqual([]);
  });
});
