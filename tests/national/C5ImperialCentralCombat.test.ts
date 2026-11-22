import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { TransportShipExecution } from "@openfront/engine/execution/TransportShipExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const N = "C5E1N001";
const S = "C5E1S001";
const W = "C5E1W001";
const roster = [
  new PlayerInfo("North", PlayerType.Human, "c5e1north", N),
  new PlayerInfo("South", PlayerType.Human, "c5e1south", S),
  new PlayerInfo("West", PlayerType.Human, "c5e1west1", W),
];
const empireId = "c5-e1-imperium";
type BattleCommand = {
  kind: "imperial-attack";
  empireId: string;
  memberId: string;
  targetId: string;
  amount: number;
};
async function spawned(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, roster);
  for (const [i, p] of roster.entries()) {
    game.addExecution(
      new SpawnExecution(
        "c5-imperial",
        p,
        game.map().ref(30 + i * 20, 30 + i * 20),
      ),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  const north = game.player(N);
  const south = game.player(S);
  game.performNationalCommand(north, { kind: "found-empire", empireId });
  game.performNationalCommand(north, {
    kind: "offer-empire",
    empireId,
    candidateId: S,
  });
  game.performNationalCommand(south, {
    kind: "accept-empire",
    empireId,
    candidateId: S,
  });
  return game;
}
function pool(game: Game): bigint {
  return BigInt(
    game.nationalImperialAdministrationFor(game.player(N))!.imperialTroops,
  );
}
function centralize(game: Game): void {
  game.performNationalImperialAdministration(game.player(N), {
    kind: "set-army-mode",
    empireId,
    mode: "centralized",
    thresholdBps: 0,
  });
}
function makeRealBorder(game: Game): void {
  const south = game.player(S);
  const west = game.player(W);
  const nbuf = [0, 0, 0, 0];
  for (const westTile of west.tiles()) {
    const length = game.map().neighbors4(westTile, nbuf);
    for (let i = 0; i < length; i++) {
      const candidate = nbuf[i];
      if (
        !game.map().isWater(candidate) &&
        !game.map().isImpassable(candidate) &&
        game.owner(candidate) === game.terraNullius()
      ) {
        south.conquer(candidate);
        expect(south.sharesBorderWith(west)).toBe(true);
        return;
      }
    }
  }
  throw new Error("fixture: no ordinary land border available");
}
function declareImperialWar(game: Game): void {
  game.performNationalWarCommand(game.player(N), {
    kind: "declare-imperial",
    warId: "c5-e1-war",
    aggressor: { kind: "empire", id: empireId },
    target: { kind: "nation", id: W },
  });
  expect(game.nationalWarAuthority()?.authorizeOffensiveAction(S, W)).toBe(
    true,
  );
}
function tickRunner(game: Game, count: number): void {
  const runner = new GameRunner(
    game,
    new Executor(game, "c5-imperial", game.player(N).clientID()!),
    () => undefined,
    game.player(N).clientID()!,
  );
  for (let i = 0; i < count; i++) {
    runner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(runner.executeNextTick()).toBe(true);
  }
}

describe("C5 M5 centralized real imperial combat", () => {
  it("conserves live member armies, rejects subordinate commands and survives exact mode changes", async () => {
    const game = await spawned();
    const n = game.player(N),
      s = game.player(S),
      w = game.player(W);
    n.setTroops(120);
    s.setTroops(180);
    w.setTroops(50);
    game.nationalVictoryRoster(); // synchronize live PlayerImpl troop facts
    const before = snapshotGameData(game).game;
    expect(() =>
      game.performNationalImperialAdministration(s, {
        kind: "set-army-mode",
        empireId,
        mode: "centralized",
        thresholdBps: 0,
      }),
    ).toThrow(/emperor/);
    expect(snapshotGameData(game).game).toEqual(before);
    centralize(game);
    expect([n.troops(), s.troops(), w.troops()]).toEqual([0, 0, 50]);
    expect(pool(game)).toBe(300n);
    expect(
      game.nationalImperialAdministrationFor(n)?.troopContributions,
    ).toEqual([
      { memberId: N, total: "120" },
      { memberId: S, total: "180" },
    ]);
    expect(() => centralize(game)).toThrow(/already centralized/);
    expect(pool(game)).toBe(300n);
    const { restored } = await roundTrip(game, "plains");
    expect(
      restored.nationalImperialAdministrationFor(restored.player(N)),
    ).toEqual(game.nationalImperialAdministrationFor(n));
    for (const g of [game, restored]) {
      g.performNationalImperialAdministration(g.player(N), {
        kind: "set-army-mode",
        empireId,
        mode: "decentralized",
        thresholdBps: 0,
      });
      const total =
        BigInt(g.player(N).troops() + g.player(S).troops()) +
        BigInt(g.nationalDeferredTroopsFor(g.player(N)) ?? "0") +
        BigInt(g.nationalDeferredTroopsFor(g.player(S)) ?? "0");
      expect(total).toBe(300n);
      expect(pool(g)).toBe(0n);
    }
    expect(snapshotGameData(restored).game).toEqual(
      snapshotGameData(game).game,
    );
  });

  it("executes emperor-funded pooled battle through actual GameRunner, member debit, WAR and defender loss", async () => {
    const game = await spawned();
    makeRealBorder(game);
    declareImperialWar(game);
    const n = game.player(N),
      s = game.player(S),
      w = game.player(W);
    n.setTroops(100);
    s.setTroops(20000);
    w.setTroops(1);
    const initialTiles = w.numTilesOwned();
    centralize(game);
    expect(pool(game)).toBe(20100n);
    const attack: BattleCommand = {
      kind: "imperial-attack",
      empireId,
      memberId: S,
      targetId: W,
      amount: 12000,
    };
    const untouched = snapshotGameData(game).game;
    expect(() => game.performNationalImperialAdministration(s, attack)).toThrow(
      /emperor/,
    );
    expect(snapshotGameData(game).game).toEqual(untouched);
    const outsider: BattleCommand = { ...attack, memberId: W };
    expect(() =>
      game.performNationalImperialAdministration(n, outsider),
    ).toThrow();
    expect(pool(game)).toBe(20100n);
    game.performNationalImperialAdministration(n, attack);
    expect(pool(game)).toBe(8100n);
    expect(s.troops()).toBe(12000);
    tickRunner(game, 1);
    // Genuine AttackExecution removed member troops. The pool was charged ONCE.
    expect(s.troops()).toBeLessThan(12000);
    // Production growth may replenish the pool on this tick; deployment
    // was already debited exactly at command acceptance.
    expect(pool(game)).toBeGreaterThanOrEqual(8100n);
    tickRunner(game, 25);
    expect(w.numTilesOwned()).toBeLessThan(initialTiles);
    expect(
      game
        .nationalWarState()
        ?.wars.layers.some(
          (l) => l.id === "c5-e1-war" && l.scope === "imperial",
        ),
    ).toBe(true);
  });

  it("does not mint in-flight pooled strength on crown change, dissolution or replay", async () => {
    const game = await spawned();
    makeRealBorder(game);
    declareImperialWar(game);
    game.player(N).setTroops(600);
    game.player(S).setTroops(800);
    centralize(game);
    const attack: BattleCommand = {
      kind: "imperial-attack",
      empireId,
      memberId: S,
      targetId: W,
      amount: 100,
    };
    game.performNationalImperialAdministration(game.player(N), attack);
    expect(pool(game)).toBe(1300n);
    const { restored } = await roundTrip(game, "plains");
    for (const g of [game, restored]) {
      g.performNationalCommand(g.player(N), {
        kind: "transfer-crown",
        empireId,
        successorId: S,
      });
      expect(() =>
        g.performNationalImperialAdministration(g.player(N), attack),
      ).toThrow(/emperor/);
      expect(pool(g)).toBe(1300n);
      g.performNationalImperialAdministration(g.player(S), {
        kind: "dissolve",
        empireId,
      });
      expect(g.nationalPoliticalAuthority()?.empireOf(S)).toBeNull();
      tickRunner(g, 1);
      expect(
        g.nationalWarState()?.wars.layers.find((l) => l.id === "c5-e1-war")
          ?.endedTick,
      ).not.toBeNull();
    }
    expect(snapshotGameData(restored).game).toEqual(
      snapshotGameData(game).game,
    );
  });

  it("deploys genuine pooled defenders, executes enemy attack, then blocks all imperial assaults after peace", async () => {
    const game = await spawned();
    makeRealBorder(game);
    declareImperialWar(game);
    const north = game.player(N),
      south = game.player(S),
      west = game.player(W);
    north.setTroops(500);
    south.setTroops(5000);
    west.setTroops(2000);
    centralize(game);
    expect(pool(game)).toBe(5500n);
    game.performNationalImperialAdministration(north, {
      kind: "release-imperial-troops",
      empireId,
      memberId: S,
      amount: 1200,
    });
    expect(south.troops()).toBe(1200);
    expect(pool(game)).toBe(4300n);
    // The defending troops now live exclusively in the real south Player,
    // rather than existing twice in the imperial reserve and player.
    game.addExecution(new AttackExecution(1000, west, S));
    tickRunner(game, 1);
    expect(west.troops()).toBeLessThan(2000);
    expect(south.isAlive()).toBe(true);
    expect(pool(game)).toBeGreaterThanOrEqual(4300n);
    game.performNationalWarCommand(north, {
      kind: "propose-peace",
      motionId: "c5-e1-defensive-peace",
      warId: "c5-e1-war",
    });
    game.performNationalWarCommand(west, {
      kind: "accept-peace",
      motionId: "c5-e1-defensive-peace",
    });
    expect(game.nationalWarAuthority()?.authorizeOffensiveAction(S, W)).toBe(
      false,
    );
    const before = pool(game);
    expect(() =>
      game.performNationalImperialAdministration(north, {
        kind: "imperial-attack",
        empireId,
        memberId: S,
        targetId: W,
        amount: 200,
      }),
    ).toThrow(/WAR target/);
    expect(pool(game)).toBe(before);
    const { restored } = await roundTrip(game, "plains");
    expect(pool(restored)).toBe(before);
  });

  it("denies ordinary member land and naval attacks under centralized authority", async () => {
    const game = await spawned();
    makeRealBorder(game);
    declareImperialWar(game);
    const north = game.player(N),
      south = game.player(S),
      west = game.player(W);
    north.setTroops(500);
    south.setTroops(700);
    centralize(game);
    game.performNationalImperialAdministration(north, {
      kind: "release-imperial-troops",
      empireId,
      memberId: S,
      amount: 250,
    });
    expect(south.troops()).toBe(250);
    const reserve = pool(game);
    const levyCount = game.nationalWarState()!.levy.processed.length;
    const ships = south.unitCount(UnitType.TransportShip);
    const westTiles = west.numTilesOwned();
    game.addExecution(
      new AttackExecution(100, south, W),
      new TransportShipExecution(south, game.map().ref(70, 70), 100),
    );
    tickRunner(game, 1);
    expect(south.troops()).toBe(250);
    expect(south.outgoingAttacks()).toHaveLength(0);
    expect(south.unitCount(UnitType.TransportShip)).toBe(ships);
    expect(west.numTilesOwned()).toBe(westTiles);
    expect(game.nationalWarState()!.levy.processed).toHaveLength(levyCount);
    expect(pool(game)).toBeGreaterThanOrEqual(reserve);
  });

  it("rejects unauthorized stamped subordinate attack with no side effects", async () => {
    const game = await spawned();
    makeRealBorder(game);
    declareImperialWar(game);
    game.player(N).setTroops(300);
    game.player(S).setTroops(400);
    centralize(game);
    const command = {
      kind: "imperial-attack",
      empireId,
      memberId: S,
      targetId: W,
      amount: 100,
    } as const;
    const baseline = pool(game);
    const executor = new Executor(game, "c5-imperial", undefined);
    game.addExecution(
      executor.createExec(
        StampedIntentSchema.parse({
          type: "national_imperial_administration",
          clientID: game.player(S).clientID(),
          requestId: "c5-subordinate-denied",
          command,
        }),
      ),
    );
    // Political executions initialize before tick(); two runner turns prove
    // that the actual stamped subordinate order reaches the journal.
    tickRunner(game, 2);
    expect(pool(game)).toBeGreaterThanOrEqual(baseline);
    expect(game.player(S).troops()).toBe(0);
    expect(game.nationalPoliticalCommandResults(game.player(S))).toContainEqual(
      expect.objectContaining({
        requestId: "c5-subordinate-denied",
        accepted: false,
        reason: "political-rule",
      }),
    );
  });
});
