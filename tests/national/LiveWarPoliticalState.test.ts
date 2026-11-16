import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameSnapshot } from "@openfront/engine/game/GameImpl";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const players = [
  new PlayerInfo("Alpha", PlayerType.Human, "r4-alpha-client", "r4-alpha"),
  new PlayerInfo("Beta", PlayerType.Human, "r4-beta-client", "r4-beta"),
  new PlayerInfo("Gamma", PlayerType.Human, "r4-gamma-client", "r4-gamma"),
];
const A = "r4-alpha";
const B = "r4-beta";
const C = "r4-gamma";
const EMPIRE = "r4-empire";

async function live(count = 3, nationalMode = true): Promise<Game> {
  const game = await setup("plains", { nationalMode }, players.slice(0, count));
  const tiles = [game.map().ref(30, 30), game.map().ref(70, 70), game.map().ref(30, 70)];
  for (let i = 0; i < count; i++) {
    game.addExecution(new SpawnExecution("r4-bridge", players[i], tiles[i]));
  }
  game.executeNextTick();
  game.executeNextTick();
  for (let i = 0; i < count; i++)
    expect(game.player(players[i].id).hasSpawned()).toBe(true);
  return game;
}

function joined(game: Game): void {
  game.performNationalCommand(game.player(A), {
    kind: "found-empire", empireId: EMPIRE,
  });
  game.performNationalCommand(game.player(A), {
    kind: "offer-empire", empireId: EMPIRE, candidateId: B,
  });
  game.performNationalCommand(game.player(B), {
    kind: "accept-empire", empireId: EMPIRE, candidateId: B,
  });
}

function declareBoth(game: Game): void {
  game.performNationalWarCommand(game.player(A), {
    kind: "declare-national", warId: "r4-national", aggressorId: B, targetId: C,
  });
  game.performNationalWarCommand(game.player(A), {
    kind: "declare-imperial", warId: "r4-imperial",
    aggressor: { kind: "empire", id: EMPIRE },
    target: { kind: "nation", id: C },
  });
}

function eliminate(game: Game, player: string): void {
  for (const tile of [...game.player(player).tiles()])
    game.player(player).relinquish(tile);
  game.executeNextTick();
}

describe("Round Four — real Game WAR/LEVY political state bridge", () => {
  it("WAR-01: authoritative Game service is born only in NATIONAL games and denies undeclared attacks", async () => {
    const national = await live(2);
    const legacy = await live(2, false);
    expect(legacy.nationalWarAuthority()).toBeNull();
    expect(legacy.nationalWarState()).toBeNull();
    expect(() => legacy.performNationalWarCommand(legacy.player(A), {
      kind: "declare-national", warId: "forbidden", aggressorId: A, targetId: B,
    })).toThrow(/not enabled/);
    const port = national.nationalWarAuthority();
    expect(port?.authorizeOffensiveAction(A, B)).toBe(false);
    expect(port?.authorizeOffensiveAction(A, null)).toBe(true);
    expect(port?.authorizeOffensiveAction("missing", null)).toBe(false);
    expect(national.nationalWarState()).toEqual({
      version: 1,
      wars: { version: 1, layers: [], motions: [], lastTick: 0 },
      levy: { version: 1, allowances: [], processed: [] },
    });
  });

  it("WAR-02/03/07: real imperial and distinct national war coexist at a tick boundary", async () => {
    const game = await live();
    joined(game);
    declareBoth(game);
    game.executeNextTick();
    const s = game.nationalWarState()!;
    expect(s.wars.layers.map((l) => [l.id, l.scope])).toEqual([
      ["r4-imperial", "imperial"],
      ["r4-national", "national"],
    ]);
    expect(s.levy).toEqual({ version: 1, allowances: [], processed: [] });
    const port = game.nationalWarAuthority()!;
    expect(port.atWar(A, C)).toBe(true);
    expect(port.atWar(B, C)).toBe(true);
    expect(port.authorizeOffensiveAction(A, C)).toBe(true);
    expect(port.authorizeOffensiveAction(B, C)).toBe(true);
    expect(port.authorizeOffensiveAction(A, B)).toBe(false);
    // The detached query cannot corrupt canonical records or ordering.
    s.wars.layers.splice(0);
    expect(game.nationalWarState()!.wars.layers).toHaveLength(2);
  });

  it("COAL-06/WAR-03: live accession expands an existing imperial war but never rewrites stable layer IDs", async () => {
    const game = await live();
    game.performNationalCommand(game.player(A), {
      kind: "found-empire", empireId: EMPIRE,
    });
    game.performNationalWarCommand(game.player(A), {
      kind: "declare-imperial", warId: "r4-before-accession",
      aggressor: { kind: "empire", id: EMPIRE },
      target: { kind: "nation", id: C },
    });
    const before = game.nationalWarState()!.wars.layers;
    const capturedPort = game.nationalWarAuthority();
    expect(capturedPort?.atWar(A, C)).toBe(true);
    expect(capturedPort?.atWar(B, C)).toBe(false);
    game.performNationalCommand(game.player(B), {
      kind: "offer-empire", empireId: EMPIRE, candidateId: B,
    });
    game.performNationalCommand(game.player(A), {
      kind: "accept-empire", empireId: EMPIRE, candidateId: B,
    });
    expect(capturedPort?.atWar(B, C)).toBe(true);
    expect(game.nationalWarAuthority()).toBe(capturedPort);
    expect(game.nationalWarState()!.wars.layers).toEqual(before);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalWarAuthority()?.atWar(B, C)).toBe(true);
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
  });

  it("WAR-04/07: crown transfer updates authority immediately; imperial peace leaves national war intact", async () => {
    const game = await live();
    joined(game);
    declareBoth(game);
    game.performNationalWarCommand(game.player(A), {
      kind: "propose-peace", motionId: "r4-peace-imperial", warId: "r4-imperial",
    });
    game.performNationalCommand(game.player(A), {
      kind: "transfer-crown", empireId: EMPIRE, successorId: B,
    });
    expect(game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(B);
    expect(() => game.performNationalWarCommand(game.player(A), {
      kind: "declare-imperial", warId: "rejected-old-crown",
      aggressor: { kind: "empire", id: EMPIRE },
      target: { kind: "nation", id: C },
    })).toThrow(/not authorized/);
    expect(() => game.performNationalWarCommand(game.player(A), {
      kind: "propose-peace", motionId: "rejected-peace", warId: "r4-national",
    })).toThrow(/not authorized/);
    game.performNationalWarCommand(game.player(C), {
      kind: "accept-peace", motionId: "r4-peace-imperial",
    });
    expect(game.nationalWarState()!.wars.layers.find((l) => l.id === "r4-imperial")!.endedTick)
      .toBe(game.ticks());
    expect(game.nationalWarState()!.wars.layers.find((l) => l.id === "r4-national")!.endedTick)
      .toBeNull();
    expect(game.nationalWarAuthority()?.atWar(A, C)).toBe(false);
    expect(game.nationalWarAuthority()?.atWar(B, C)).toBe(true);
    game.performNationalWarCommand(game.player(B), {
      kind: "propose-peace", motionId: "r4-peace-national", warId: "r4-national",
    });
    game.performNationalWarCommand(game.player(C), {
      kind: "accept-peace", motionId: "r4-peace-national",
    });
    expect(game.nationalWarAuthority()?.atWar(B, C)).toBe(false);
  });

  it("WAR-04 snapshot: replay with overlapping wars and an in-flight peace motion preserves exact bytes and game hash", async () => {
    const original = await live();
    joined(original);
    declareBoth(original);
    original.performNationalWarCommand(original.player(A), {
      kind: "propose-peace", motionId: "r4-motion", warId: "r4-imperial",
    });
    const { bytes, again, restored } = await roundTrip(original, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalWarState()).toEqual(original.nationalWarState());
    expect(restored.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(A);
    original.executeNextTick();
    restored.executeNextTick();
    expect(restored.nationalWarState()).toEqual(original.nationalWarState());
    for (const game of [original, restored]) {
      game.performNationalCommand(game.player(A), {
        kind: "transfer-crown", empireId: EMPIRE, successorId: B,
      });
      game.performNationalWarCommand(game.player(C), {
        kind: "accept-peace", motionId: "r4-motion",
      });
    }
    expect(restored.nationalWarState()).toEqual(original.nationalWarState());
    expect(snapshotGameData(restored).game).toEqual(snapshotGameData(original).game);
    const hash = (g: Game) => (g as unknown as { hash(): number }).hash();
    expect(hash(restored)).toBe(hash(original));
    const { bytes: after, again: double } = await roundTrip(original, "plains");
    expect([...double]).toEqual([...after]);
  });

  it("COAL-05: a live protected NAP blocks declaration until authenticated Betray", async () => {
    const game = await live(2);
    game.performNationalCommand(game.player(A), {
      kind: "found-pact", pactId: "r4-nap", pactKind: "NAP", name: "Truce",
      terms: { admission: "leader", expulsion: "forbidden" },
    });
    game.performNationalCommand(game.player(A), {
      kind: "invite-pact", pactId: "r4-nap", candidateId: B,
    });
    game.performNationalCommand(game.player(B), {
      kind: "accept-pact", pactId: "r4-nap",
    });
    expect(game.nationalPoliticalAuthority()?.treatyProtects(A, B)).toBe(true);
    expect(() => game.performNationalWarCommand(game.player(A), {
      kind: "declare-national", warId: "blocked-by-nap", aggressorId: A, targetId: B,
    })).toThrow(/betray protected treaty/);
    expect(game.nationalWarState()?.wars.layers).toEqual([]);
    game.performNationalCommand(game.player(A), {
      kind: "betray-pact", pactId: "r4-nap",
    });
    game.performNationalWarCommand(game.player(A), {
      kind: "declare-national", warId: "after-betrayal", aggressorId: A, targetId: B,
    });
    expect(game.nationalWarAuthority()?.authorizeOffensiveAction(A, B)).toBe(true);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalWarAuthority()?.authorizeOffensiveAction(A, B)).toBe(true);
  });

  it("SOV-06: eliminated emperor dissolves polity without erasing original imperial or national war records", async () => {
    const game = await live();
    joined(game);
    declareBoth(game);
    const ledgerBefore = game.nationalWarState()!;
    eliminate(game, A);
    expect(game.nationalPoliticalAuthority()?.empireOf(B)).toBeNull();
    expect(game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBeNull();
    expect(game.nationalWarState()?.wars.layers).toEqual(ledgerBefore.wars.layers);
    expect(game.nationalWarAuthority()?.atWar(A, C)).toBe(false);
    expect(game.nationalWarAuthority()?.atWar(B, C)).toBe(true);
    expect(game.nationalWarState()?.wars.layers.find((l) => l.id === "r4-imperial")?.endedTick)
      .toBeNull();
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    expect(restored.nationalWarAuthority()?.atWar(B, C)).toBe(true);
    eliminate(game, C);
    eliminate(restored, C);
    expect(game.nationalVictoryRoster()?.prizes).toEqual([
      { kind: "SovereignVictor", nationId: B },
    ]);
    expect(restored.nationalVictoryRoster()).toEqual(game.nationalVictoryRoster());
    const check = new WinCheckExecution();
    check.init(game, game.ticks());
    check.checkWinnerFFA();
    const winner = game.getWinner();
    expect(typeof winner === "string" ? winner : winner?.id()).toBe(B);
  });

  it("snapshot migration v2→v3 initializes absent conflict state, while v1 legacy migration remains valid", async () => {
    const game = await live(2);
    const latest = readVersioned(GameSnapshot, snapshotGameData(game).game);
    const v2 = Object.fromEntries(
      Object.entries(latest).filter(([key]) => key !== "nationalWar"),
    );
    expect(readVersioned(GameSnapshot, { v: 2, d: v2 }).nationalWar).toBeNull();
    const legacy = await live(2, false);
    const old = readVersioned(GameSnapshot, snapshotGameData(legacy).game);
    const v1 = Object.fromEntries(
      Object.entries(old).filter(([key]) => key !== "national" && key !== "nationalWar"),
    );
    const migrated = readVersioned(GameSnapshot, { v: 1, d: v1 });
    expect(migrated.national).toBeNull();
    expect(migrated.nationalWar).toBeNull();
    const { restored } = await roundTrip(legacy, "plains");
    expect(restored.nationalWarAuthority()).toBeNull();
    expect(restored.nationalWarState()).toBeNull();
  });

  it("untrusted actors and failed internal declarations leave the real canonical war snapshot unchanged", async () => {
    const game = await live(2);
    const unrelated = await live(2);
    const before = game.nationalWarState();
    const cmd = {
      kind: "declare-national" as const,
      warId: "forgery", aggressorId: A, targetId: B,
    };
    expect(() => game.performNationalWarCommand(unrelated.player(A), cmd))
      .toThrow(/unauthenticated/);
    expect(() => game.performNationalWarCommand(game.player(B), cmd))
      .toThrow(/national authority denied/);
    expect(game.nationalWarState()).toEqual(before);
    // The borrowed hostile port cannot invent a war or expose a mutable ledger.
    expect(game.nationalWarAuthority()?.authorizeOffensiveAction(A, B)).toBe(false);
  });

  it("LEVY-01/04/06: real MDA troop debit is atomic, persisted and replay-safe", async () => {
    const game = await live();
    const attacker = game.player(A);
    const defender = game.player(B);
    const contributor = game.player(C);
    contributor.setTroops(500_000);
    game.performNationalCommand(defender, {
      kind: "found-pact", pactId: "r4-mda", pactKind: "MDA", name: "Defense",
      terms: { admission: "leader", expulsion: "forbidden" },
    });
    game.performNationalCommand(defender, {
      kind: "invite-pact", pactId: "r4-mda", candidateId: C,
    });
    game.performNationalCommand(contributor, {
      kind: "accept-pact", pactId: "r4-mda",
    });
    game.performNationalWarCommand(attacker, {
      kind: "declare-national", warId: "r4-levy-war",
      aggressorId: A, targetId: B,
    });
    const request = (g: Game) => ({
      attackId: "r4-confirmed-attack",
      confirmedAccepted: true as const,
      campaignId: "r4-invasion-campaign",
      attackerId: A, defenderId: B,
      attackingTroops: 20_000,
      eligible: [{
        source: g.nationalLevySource(C)!,
        troopCapacity: Math.floor(g.config().maxTroops(g.player(C))),
        maximumFraction: 0.1,
        protectedCapacityFraction: 0.3,
      }],
    });
    const before = contributor.troops();
    const [first] = game.applyNationalDefenseLevy([request(game)]);
    expect(first).toMatchObject({
      application: "applied",
      intercepted: 20_000,
      remainingAttackingTroops: 0,
      contributions: [{ nationId: C, troopsDebited: 20_000 }],
    });
    expect(contributor.troops()).toBe(before - 20_000);
    expect(game.nationalWarState()?.levy.processed).toHaveLength(1);
    expect(game.nationalWarState()?.levy.allowances).toHaveLength(1);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    expect(restored.player(C).troops()).toBe(before - 20_000);
    for (const g of [game, restored]) {
      const amount = g.player(C).troops();
      const [replayed] = g.applyNationalDefenseLevy([request(g)]);
      expect(replayed).toMatchObject({
        application: "replay", intercepted: 0,
        remainingAttackingTroops: 20_000, contributions: [],
      });
      expect(g.player(C).troops()).toBe(amount);
      // Treaty membership may change after acceptance. An exact duplicate
      // must still be a no-op, not reopen a campaign or debit troops again.
      g.performNationalCommand(g.player(C), {
        kind: "betray-pact", pactId: "r4-mda",
      });
      const [oldReplay] = g.applyNationalDefenseLevy([request(g)]);
      expect(oldReplay.application).toBe("replay");
      expect(oldReplay.intercepted).toBe(0);
      expect(g.player(C).troops()).toBe(amount);
    }
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    expect(snapshotGameData(restored).game).toEqual(snapshotGameData(game).game);
  });

  it("LEVY-05/07: forged sources, missing MDA and absent formal war reject before ANY debit", async () => {
    const game = await live();
    const other = await live();
    game.player(C).setTroops(500_000);
    const request = (source: NonNullable<ReturnType<Game["nationalLevySource"]>>, id: string) => ({
      attackId: id, confirmedAccepted: true as const,
      campaignId: "r4-refusal",
      attackerId: A, defenderId: B,
      attackingTroops: 10_000,
      eligible: [{
        source,
        troopCapacity: 100_000,
        maximumFraction: 0.1,
        protectedCapacityFraction: 0.3,
      }],
    });
    const own = game.nationalLevySource(C)!;
    const foreign = other.nationalLevySource(C)!;
    const before = game.player(C).troops();
    const empty = game.nationalWarState();
    expect(() => game.applyNationalDefenseLevy([request(own, "without-war")]))
      .toThrow(/not formally authorized/);
    game.performNationalWarCommand(game.player(A), {
      kind: "declare-national", warId: "r4-refusal-war",
      aggressorId: A, targetId: B,
    });
    expect(() => game.applyNationalDefenseLevy([request(own, "without-MDA")]))
      .toThrow(/MDA contributor/);
    game.performNationalCommand(game.player(B), {
      kind: "found-pact", pactId: "r4-mda-refusal", pactKind: "MDA",
      name: "Safe treaty", terms: { admission: "leader", expulsion: "forbidden" },
    });
    game.performNationalCommand(game.player(B), {
      kind: "invite-pact", pactId: "r4-mda-refusal", candidateId: C,
    });
    game.performNationalCommand(game.player(C), {
      kind: "accept-pact", pactId: "r4-mda-refusal",
    });
    expect(() => game.applyNationalDefenseLevy([
      request(own, "valid-in-batch"),
      request(foreign, "foreign-in-batch"),
    ])).toThrow(/MDA contributor/);
    expect(game.player(C).troops()).toBe(before);
    expect(game.nationalWarState()?.levy.processed).toEqual([]);
    expect(game.nationalWarState()?.levy.allowances).toEqual([]);
    expect(empty?.wars.layers).toEqual([]);
    expect(game.nationalWarAuthority()?.atWar(A, B)).toBe(true);
  });
});
