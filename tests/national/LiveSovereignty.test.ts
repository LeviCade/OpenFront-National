import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { NationalFoundEmpireExecution, NationalFoundEmpireExecutionSnapshot } from "@openfront/engine/execution/NationalFoundEmpireExecution";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameSnapshot } from "@openfront/engine/game/GameImpl";
import { NationalRuntime } from "@openfront/engine/national/NationalRuntime";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const roster = [
  new PlayerInfo("North", PlayerType.Human, "r3-north-client", "r3-north-id"),
  new PlayerInfo("South", PlayerType.Human, "r3-south-client", "r3-south-id"),
  new PlayerInfo("West", PlayerType.Human, "r3-west-client", "r3-west-id"),
];
const N = "r3-north-id";
const S = "r3-south-id";
const W = "r3-west-id";

async function realGame(count = 3, nationalMode = true): Promise<Game> {
  const game = await setup("plains", { nationalMode }, roster.slice(0, count));
  const spawnPoints = [
    game.map().ref(30, 30),
    game.map().ref(70, 70),
    game.map().ref(30, 70),
  ];
  for (let i = 0; i < count; i++) {
    game.addExecution(
      new SpawnExecution("r3-national", roster[i], spawnPoints[i]),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  for (let i = 0; i < count; i++) {
    expect(game.player(roster[i].id).hasSpawned()).toBe(true);
  }
  return game;
}

function snapshot(game: Game) {
  return readVersioned(GameSnapshot, snapshotGameData(game).game).national;
}

function foundAndJoined(game: Game): void {
  game.performNationalCommand(game.player(N), {
    kind: "found-empire",
    empireId: "empire-r3",
  });
  game.performNationalCommand(game.player(N), {
    kind: "offer-empire",
    empireId: "empire-r3",
    candidateId: S,
  });
  game.performNationalCommand(game.player(S), {
    kind: "accept-empire",
    empireId: "empire-r3",
    candidateId: S,
  });
}

function eliminate(game: Game, playerId: string): void {
  const player = game.player(playerId);
  for (const tile of [...player.tiles()]) player.relinquish(tile);
  game.executeNextTick();
}

const pactTerms = { admission: "leader" as const, expulsion: "forbidden" as const };

describe("Round Three — actual GameImpl NATIONAL sovereignty", () => {
  it("M0 facade reads the single running political authority and never leaks legacy state", async () => {
    const live = await realGame(2);
    const legacy = await realGame(2, false);
    expect(legacy.nationalPoliticalAuthority()).toBeNull();
    expect(legacy.nationalVictoryRoster()).toBeNull();
    expect(legacy.nationalUngovernableWarnings()).toEqual([]);
    const a = live.nationalPoliticalAuthority();
    expect(a).not.toBeNull();
    expect(a?.alive(N)).toBe(true);
    expect(a?.alive("forged")).toBe(false);
    expect(a?.empireOf(N)).toBeNull();
    live.performNationalCommand(live.player(N), {
      kind: "found-empire",
      empireId: "imperium",
    });
    expect(a?.emperorOf("imperium")).toBe(N);
    expect(a?.membersOf("imperium")).toEqual([N]);
    expect(a?.mayDeclareNational("forged")).toBe(false);
  });

  it("M0-METRICS: all eight real player metrics reflect land, troop cap, troops and units", async () => {
    const game = await realGame(2);
    const south = game.player(S);
    south.addGold(50_000_000n);
    const tile = [...south.tiles()][0];
    const units = [
      south.buildUnit(UnitType.City, tile, {}),
      south.buildUnit(UnitType.Factory, tile, {}),
      south.buildUnit(UnitType.Port, tile, {}),
      south.buildUnit(UnitType.MissileSilo, tile, {}),
      south.buildUnit(UnitType.Warship, tile, { patrolTile: tile }),
    ];
    for (const unit of units) unit.setUnderConstruction(false);
    const state = game.nationalVictoryRoster(); // synchronizes actual game metrics
    expect(state).toBeNull();
    const m = snapshot(game)?.politics.nations.find((n) => n.id === S)?.metrics;
    expect(m?.land).toBe(south.numTilesOwned());
    expect(m?.maxPopulation).toBe(Math.floor(game.config().maxTroops(south)));
    expect(m?.activePopulation).toBe(south.troops());
    expect(m).toMatchObject({
      cities: 1,
      factories: 1,
      ports: 1,
      silos: 1,
      warships: 1,
    });
    units[0].setUnderConstruction(true);
    game.nationalVictoryRoster();
    expect(snapshot(game)?.politics.nations.find((n) => n.id === S)?.metrics.cities).toBe(0);
  });

  it("SOV-01: a one-tile independent sovereign blocks a large empire from winning", async () => {
    const game = await realGame(2);
    game.performNationalCommand(game.player(N), {
      kind: "found-empire",
      empireId: "empire-r3",
    });
    const south = game.player(S);
    for (const tile of [...south.tiles()].slice(1)) south.relinquish(tile);
    game.executeNextTick();
    expect(south.numTilesOwned()).toBe(1);
    expect(game.nationalVictoryRoster()).toBeNull();
    eliminate(game, S);
    expect(game.nationalVictoryRoster()?.prizes).toEqual([
      { kind: "ImperialVictor", nationId: N, empireId: "empire-r3" },
    ]);
  });

  it("SOV-03/04 and COAL-06: consented accession and crown transfer reach real victory", async () => {
    const game = await realGame(3);
    foundAndJoined(game);
    const a = game.nationalPoliticalAuthority();
    expect(a?.membersOf("empire-r3")).toEqual([N, S]);
    expect(a?.maySettleNational(S)).toBe(false);
    expect(() =>
      game.performNationalCommand(game.player(W), {
        kind: "transfer-crown",
        empireId: "empire-r3",
        successorId: S,
      }),
    ).toThrow(/emperor/);
    game.performNationalCommand(game.player(N), {
      kind: "transfer-crown",
      empireId: "empire-r3",
      successorId: S,
    });
    expect(a?.emperorOf("empire-r3")).toBe(S);
    expect(a?.mayDeclareNational(N)).toBe(false);
    expect(a?.mayDeclareNational(S)).toBe(true);
    const { restored } = await roundTrip(game, "plains");
    expect(snapshot(restored)).toEqual(snapshot(game));
    expect(restored.nationalPoliticalAuthority()?.emperorOf("empire-r3")).toBe(S);
    eliminate(game, W);
    eliminate(restored, W);
    const full = [
      { kind: "ImperialVictor", nationId: S, empireId: "empire-r3" },
      { kind: "EmpireVictor", nationId: N, empireId: "empire-r3" },
    ];
    expect(game.nationalVictoryRoster()?.prizes).toEqual(full);
    expect(restored.nationalVictoryRoster()?.prizes).toEqual(full);
    const check = new WinCheckExecution();
    check.init(game, game.ticks());
    check.checkWinnerFFA();
    const resolved = game.getWinner();
    expect(typeof resolved === "string" ? resolved : resolved?.id()).toBe(S);
  });

  it("M0-EXEC: queued real accession/crown execution survives snapshot and v1 migration", async () => {
    const game = await realGame(3);
    game.addExecution(
      new NationalFoundEmpireExecution(game.player(N), "queued-imperium"),
    );
    game.executeNextTick(); // initialize a registered actual execution
    game.executeNextTick(); // execute founding
    expect(game.nationalPoliticalAuthority()?.emperorOf("queued-imperium")).toBe(N);
    game.addExecution(
      new NationalFoundEmpireExecution(game.player(N), "", {
        kind: "offer-empire",
        empireId: "queued-imperium",
        candidateId: S,
      }),
    );
    const { restored } = await roundTrip(game, "plains");
    for (let i = 0; i < 2; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(snapshot(restored)).toEqual(snapshot(game));
    for (const g of [game, restored]) {
      g.addExecution(
        new NationalFoundEmpireExecution(g.player(S), "", {
          kind: "accept-empire",
          empireId: "queued-imperium",
          candidateId: S,
        }),
      );
      g.executeNextTick();
      g.executeNextTick();
      expect(g.nationalPoliticalAuthority()?.membersOf("queued-imperium")).toEqual([N, S]);
      g.addExecution(
        new NationalFoundEmpireExecution(g.player(N), "", {
          kind: "transfer-crown",
          empireId: "queued-imperium",
          successorId: S,
        }),
      );
      g.executeNextTick();
      g.executeNextTick();
      expect(g.nationalPoliticalAuthority()?.emperorOf("queued-imperium")).toBe(S);
    }
    expect(snapshot(restored)).toEqual(snapshot(game));
    // Previous v1 pending founding records still restore under the new
    // registered v2 execution descriptor (no silent snapshot invalidation).
    const migrated = readVersioned(NationalFoundEmpireExecutionSnapshot, {
      v: 1,
      d: {
        active: true,
        initialized: false,
        actor: 1,
        empireId: "old-founding",
      },
    });
    expect(migrated.politicalCommand).toBeNull();
  });

  it("SOV-06: eliminated emperor dissolves membership before selecting survivor", async () => {
    const game = await realGame(3);
    foundAndJoined(game);
    eliminate(game, N);
    const a = game.nationalPoliticalAuthority();
    expect(a?.emperorOf("empire-r3")).toBeNull();
    expect(a?.empireOf(S)).toBeNull();
    expect(a?.alive(S)).toBe(true);
    expect(game.nationalVictoryRoster()).toBeNull();
    eliminate(game, W);
    expect(game.nationalVictoryRoster()?.prizes).toEqual([
      { kind: "SovereignVictor", nationId: S },
    ]);
  });

  it("COAL-05/06: live NAP consent, Betray and atomic accession remove treaty protection", async () => {
    const game = await realGame(3);
    const n = game.player(N);
    const s = game.player(S);
    game.performNationalCommand(s, {
      kind: "found-pact",
      pactId: "nap-r3",
      name: "Political pact",
      pactKind: "NAP",
      terms: pactTerms,
    });
    game.performNationalCommand(s, {
      kind: "invite-pact",
      pactId: "nap-r3",
      candidateId: W,
    });
    game.performNationalCommand(game.player(W), {
      kind: "accept-pact",
      pactId: "nap-r3",
    });
    const authority = game.nationalPoliticalAuthority();
    expect(authority?.treatyProtects(S, W)).toBe(true);
    // An authorized Betray cancels legal treaty protection immediately.
    game.performNationalCommand(game.player(W), {
      kind: "betray-pact",
      pactId: "nap-r3",
    });
    expect(authority?.treatyProtects(S, W)).toBe(false);
    // A two-member NAP ceases to exist on betrayal. Form a new treaty.
    game.performNationalCommand(s, {
      kind: "found-pact",
      pactId: "nap-r3b",
      name: "Renewed treaty",
      pactKind: "NAP",
      terms: pactTerms,
    });
    game.performNationalCommand(s, {
      kind: "invite-pact",
      pactId: "nap-r3b",
      candidateId: W,
    });
    game.performNationalCommand(game.player(W), {
      kind: "accept-pact",
      pactId: "nap-r3b",
    });
    expect(authority?.treatyProtects(S, W)).toBe(true);
    game.performNationalCommand(n, {
      kind: "found-empire",
      empireId: "empire-r3",
    });
    game.performNationalCommand(n, {
      kind: "offer-empire",
      empireId: "empire-r3",
      candidateId: S,
    });
    expect(() =>
      game.performNationalCommand(n, {
        kind: "accept-empire",
        empireId: "empire-r3",
        candidateId: S,
      }),
    ).toThrow(/recipient consent/);
    expect(authority?.treatyProtects(S, W)).toBe(true);
    game.performNationalCommand(s, {
      kind: "accept-empire",
      empireId: "empire-r3",
      candidateId: S,
    });
    expect(authority?.empireOf(S)).toBe("empire-r3");
    expect(authority?.treatyProtects(S, W)).toBe(false);
    const after = snapshot(game)?.politics;
    expect(after?.pacts).toHaveLength(0);
    expect(after?.empires[0].memberIds).toEqual([N, S]);
    expect(() =>
      game.performNationalCommand(game.player(W), {
        kind: "offer-empire",
        empireId: "empire-r3",
        candidateId: S,
      }),
    ).toThrow();
    // Same game, new NAP: Betray cancels treaty protection even if expulsion
    // was forbidden, before E2 may authorize any separate military action.
    game.performNationalCommand(game.player(W), {
      kind: "found-pact",
      pactId: "nap-independent",
      name: "Ordinary treaty",
      pactKind: "NAP",
      terms: pactTerms,
    });
    // Empire states are excluded from outside coalitions.
    expect(() =>
      game.performNationalCommand(game.player(W), {
        kind: "invite-pact",
        pactId: "nap-independent",
        candidateId: S,
      }),
    ).toThrow(/exclusive/);
  });

  it("SOV-07: final live sovereign wins despite unclaimed land; legacy remains unchanged", async () => {
    const national = await realGame(2);
    const legacy = await realGame(2, false);
    eliminate(national, S);
    eliminate(legacy, S);
    const a = new WinCheckExecution();
    a.init(national, national.ticks());
    a.checkWinnerFFA();
    const result = national.getWinner();
    expect(typeof result === "string" ? result : result?.id()).toBe(N);
    const b = new WinCheckExecution();
    b.init(legacy, legacy.ticks());
    b.checkWinnerFFA();
    expect(legacy.getWinner()).toBeNull();
  });

  it("SOV-05: authentic eight-metric deficit warns for 100 ticks, persists through restore and blocks asset-unsafe collapse", async () => {
    const game = await realGame(2);
    const north = game.player(N);
    const south = game.player(S);
    for (const tile of [...north.tiles()].slice(1)) north.relinquish(tile);
    north.setTroops(1);
    south.setTroops(1_000_000);
    south.addGold(50_000_000n);
    const tile = [...south.tiles()][0];
    for (const [type, params] of [
      [UnitType.City, {}],
      [UnitType.Factory, {}],
      [UnitType.Port, {}],
      [UnitType.MissileSilo, {}],
      [UnitType.Warship, { patrolTile: tile }],
    ] as const) {
      south.buildUnit(type, tile, params).setUnderConstruction(false);
    }
    foundAndJoined(game);
    game.executeNextTick();
    const warning = game.nationalUngovernableWarnings();
    expect(warning).toHaveLength(1);
    const deadline = warning[0].deadlineMs;
    expect(warning[0].remainingMs).toBe(10_000);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalUngovernableWarnings()).toEqual(warning);
    for (let i = 0; i < 101; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(game.nationalUngovernableWarnings()[0]).toMatchObject({
      empireId: "empire-r3",
      deadlineMs: deadline,
      remainingMs: 0,
      blockedByAssetDisposition: true,
    });
    expect(restored.nationalUngovernableWarnings()).toEqual(game.nationalUngovernableWarnings());
    expect(snapshot(restored)).toEqual(snapshot(game));
    expect(game.nationalPoliticalAuthority()?.empireExists("empire-r3")).toBe(true);
    // The emperor can no longer evade the expired deadline by transferring.
    expect(() =>
      game.performNationalCommand(north, {
        kind: "transfer-crown",
        empireId: "empire-r3",
        successorId: S,
      }),
    ).toThrow(/deadline/);
  });

  it("P5 explicit test-only policy: real unspawned contender cannot be forfeited while spawn is pending", async () => {
    const game = await realGame(2);
    const facts = snapshot(game)!.politics.nations;
    const pending = new NationalRuntime([N, S]);
    const realMetrics = facts.find((n) => n.id === N)!.metrics;
    const neverSpawned = {
      id: S, alive: false, spawned: false, pendingSpawn: true,
      metrics: facts.find((n) => n.id === S)!.metrics,
    };
    const north = { id: N, alive: true, spawned: true, metrics: realMetrics };
    pending.synchronize([north, neverSpawned], 2, true, "forfeit-no-pending");
    expect(pending.victoryRoster()).toBeNull();
    pending.synchronize(
      [north, { ...neverSpawned, pendingSpawn: false }],
      3,
      true,
      "forfeit-no-pending",
    );
    expect(pending.victoryRoster()?.prizes).toEqual([
      { kind: "SovereignVictor", nationId: N },
    ]);
    const defaultPending = new NationalRuntime([N, S]);
    defaultPending.synchronize(
      [north, { ...neverSpawned, pendingSpawn: false }],
      3,
      true,
    );
    expect(defaultPending.victoryRoster()).toBeNull();
  });
});
