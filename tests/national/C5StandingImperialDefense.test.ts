/**
 * C5 C2 E4 — standing imperial DEFENSE through genuine GameRunner battle.
 * No test-only levy caller, fake war state, or donor balance override after hit.
 */
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const [CROWN, MEMBER, DONOR, ENEMY, OTHER] = [
  "C5E4_CROWN",
  "C5E4_MEMBER",
  "C5E4_DONOR",
  "C5E4_ENEMY",
  "C5E4_OTHER",
];
const EMPIRE = "c5e4-imperium";
const roster = [
  new PlayerInfo("Crown", PlayerType.Human, "c5e4crown", CROWN),
  new PlayerInfo("Member", PlayerType.Human, "c5e4member", MEMBER),
  new PlayerInfo("Donor", PlayerType.Human, "c5e4donor1", DONOR),
  new PlayerInfo("Enemy", PlayerType.Human, "c5e4enemy1", ENEMY),
  new PlayerInfo("Other", PlayerType.Human, "c5e4other1", OTHER),
];

type Response = "none" | "assist" | "imperial" | "both";

async function found(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, roster);
  const coordinates: [number, number][] = [
    [20, 20],
    [35, 35],
    [50, 50],
    [80, 80],
    [70, 20],
  ];
  roster.forEach((player, index) =>
    game.addExecution(
      new SpawnExecution(
        "c5e4-defense",
        player,
        game.ref(...coordinates[index]),
      ),
    ),
  );
  game.executeNextTick();
  game.executeNextTick();
  const emperor = game.player(CROWN);
  game.performNationalCommand(emperor, {
    kind: "found-empire",
    empireId: EMPIRE,
  });
  for (const id of [MEMBER, DONOR]) {
    game.performNationalCommand(emperor, {
      kind: "offer-empire",
      empireId: EMPIRE,
      candidateId: id,
    });
    game.performNationalCommand(game.player(id), {
      kind: "accept-empire",
      empireId: EMPIRE,
      candidateId: id,
    });
  }
  // The independent offensive WAR is already lawful before the first attack.
  game.performNationalWarCommand(game.player(ENEMY), {
    kind: "declare-national",
    warId: "c5e4-original-national",
    aggressorId: ENEMY,
    targetId: MEMBER,
  });
  // A real defender-owned land tile touching the enemy's existing tiles.
  const buf = [0, 0, 0, 0];
  for (const tile of game.player(ENEMY).tiles()) {
    const length = game.map().neighbors4(tile, buf);
    for (let i = 0; i < length; i++) {
      const candidate = buf[i];
      if (
        !game.map().isWater(candidate) &&
        !game.map().isImpassable(candidate) &&
        game.owner(candidate) === game.terraNullius()
      ) {
        game.player(MEMBER).conquer(candidate);
        expect(game.player(ENEMY).sharesBorderWith(game.player(MEMBER))).toBe(
          true,
        );
        return game;
      }
    }
  }
  throw new Error("fixture could not establish land border");
}

function setResponse(
  game: Game,
  response: Response,
  expectedVersion = 0,
): void {
  game.performNationalImperialAdministration(game.player(CROWN), {
    kind: "set-standing-defense-policy",
    empireId: EMPIRE,
    expectedVersion,
    response,
  });
}
function tick(game: Game, count = 1): void {
  const runner = new GameRunner(
    game,
    new Executor(game, "c5e4-defense", game.player(CROWN).clientID()!),
    () => undefined,
    game.player(CROWN).clientID()!,
  );
  for (let i = 0; i < count; i++) {
    runner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(runner.executeNextTick()).toBe(true);
  }
}
function hit(game: Game, troopCount: number): void {
  game.addExecution(
    new AttackExecution(troopCount, game.player(ENEMY), MEMBER),
  );
  tick(game);
}
function ledger(game: Game) {
  return game.nationalWarState()!;
}
function imperialLayers(game: Game) {
  return ledger(game).wars.layers.filter((l) => l.scope === "imperial");
}
function reserve(game: Game): number {
  return Math.ceil(game.config().maxTroops(game.player(DONOR)) * 0.3);
}

describe("C5 C2 E4 — attack-time imperial defense", () => {
  it("intercepts a genuine 50,000-troop invasion with 45,000 initially funded reserves and exact growth-normalized donor debit, then preserves WAR and peace", async () => {
    const game = await found();
    setResponse(game, "both");
    game.player(CROWN).setTroops(0);
    game.player(MEMBER).setTroops(1);
    game.player(DONOR).setTroops(reserve(game) + 45_000);
    game.player(ENEMY).setTroops(50_000);
    const initialDonor = game.player(DONOR).troops();
    // Runner grows nations before queued attacks initialize. A no-attack
    // restored control measures that legitimate production independently.
    const { restored: control } = await roundTrip(game, "plains");
    tick(control);
    const baselineDonor = control.player(DONOR).troops();
    const baselineGold = roster.map((p) =>
      control.player(p.id).gold().toString(),
    );
    const protectedReserve = reserve(game);
    const oldWar = ledger(game).wars.layers.find(
      (l) => l.id === "c5e4-original-national",
    )!;
    expect(oldWar.scope).toBe("national");
    expect(imperialLayers(game)).toHaveLength(0);

    hit(game, 50_000);
    const records = ledger(game).levy.processed;
    expect(records).toHaveLength(1);
    const recorded = records[0].result;
    expect(recorded.attackTroopsBefore).toBe(50_000);
    expect(initialDonor - protectedReserve).toBe(45_000);
    expect(recorded.intercepted).toBe(
      baselineDonor - game.player(DONOR).troops(),
    );
    expect(recorded.remainingAttackingTroops).toBe(
      50_000 - recorded.intercepted,
    );
    expect(recorded.contributions).toEqual([
      {
        nationId: DONOR,
        troopsDebited: recorded.intercepted,
      },
    ]);
    expect(game.player(DONOR).troops()).toBeGreaterThanOrEqual(
      protectedReserve - 1,
    );
    expect(game.player(DONOR).troops()).toBeLessThanOrEqual(protectedReserve);
    expect(roster.map((p) => game.player(p.id).gold().toString())).toEqual(
      baselineGold,
    );
    expect(imperialLayers(game)).toHaveLength(1);
    const imperial = imperialLayers(game)[0];
    expect(imperial.endedTick).toBeNull();
    expect(imperial.first).toEqual({ kind: "empire", id: EMPIRE });
    expect(imperial.second).toEqual({ kind: "nation", id: ENEMY });
    expect(game.nationalWarAuthority()?.atWar(CROWN, ENEMY)).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(MEMBER, ENEMY)).toBe(true);

    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    expect(
      restored.nationalImperialAdministrationFor(restored.player(CROWN)),
    ).toEqual(game.nationalImperialAdministrationFor(game.player(CROWN)));
    expect(restored.player(DONOR).troops()).toBe(game.player(DONOR).troops());

    game.performNationalWarCommand(game.player(ENEMY), {
      kind: "propose-peace",
      warId: imperial.id,
      motionId: "c5e4-peace",
    });
    game.performNationalWarCommand(game.player(CROWN), {
      kind: "accept-peace",
      motionId: "c5e4-peace",
    });
    expect(game.nationalWarAuthority()?.atWar(CROWN, ENEMY)).toBe(false);
    expect(game.nationalWarAuthority()?.atWar(MEMBER, ENEMY)).toBe(true);
    expect(
      ledger(game).wars.layers.find((l) => l.id === oldWar.id)?.endedTick,
    ).toBeNull();

    // A subsequent national attack must not resurrect the accepted imperial peace.
    game.player(ENEMY).setTroops(1_000);
    hit(game, 1_000);
    expect(imperialLayers(game)).toHaveLength(1);
    expect(imperialLayers(game)[0].endedTick).not.toBeNull();
  });

  it("honors all four modes on real combat and permits full shield only with funded real reserves", async () => {
    for (const response of ["none", "assist", "imperial", "both"] as const) {
      const game = await found();
      setResponse(game, response);
      game.player(CROWN).setTroops(0);
      game.player(MEMBER).setTroops(1);
      game.player(DONOR).setTroops(reserve(game) + 35_000);
      game.player(ENEMY).setTroops(30_000);
      const { restored: control } = await roundTrip(game, "plains");
      tick(control);
      const baselineDonor = control.player(DONOR).troops();
      const territoryBefore = game.player(MEMBER).numTilesOwned();
      hit(game, 30_000);
      const record = ledger(game).levy.processed[0].result;
      expect(record.intercepted).toBe(
        response === "assist" || response === "both" ? 30_000 : 0,
      );
      expect(baselineDonor - game.player(DONOR).troops()).toBe(
        record.intercepted,
      );
      expect(record.remainingAttackingTroops).toBe(30_000 - record.intercepted);
      expect(imperialLayers(game)).toHaveLength(
        response === "imperial" || response === "both" ? 1 : 0,
      );
      if (record.intercepted === 30_000)
        expect(game.player(MEMBER).numTilesOwned()).toBe(territoryBefore);
    }
  });

  it("rejects unauthorized/invalid doctrine, revokes CAS on transfer, and preserves untouched invalid-attack ledgers", async () => {
    const game = await found();
    game.nationalVictoryRoster(); // Synchronize directly conquered fixture tiles.
    const untouched = snapshotGameData(game).game;
    const command = {
      kind: "set-standing-defense-policy" as const,
      empireId: EMPIRE,
      expectedVersion: 0,
      response: "both" as const,
    };
    expect(() =>
      game.performNationalImperialAdministration(game.player(DONOR), command),
    ).toThrow(/emperor/);
    expect(() =>
      game.performNationalImperialAdministration(game.player(ENEMY), command),
    ).toThrow(/emperor/);
    expect(snapshotGameData(game).game).toEqual(untouched);
    setResponse(game, "both");
    expect(() => setResponse(game, "none")).toThrow(/stale/);
    expect(
      game.nationalImperialAdministrationFor(game.player(CROWN))
        ?.warPolicyVersion,
    ).toBe(1);

    // An invalid target must not charge the donor or open a war layer.
    const beforeInvalid = ledger(game);
    const { restored: control } = await roundTrip(game, "plains");
    tick(control);
    const donorWithoutAttack = control.player(DONOR).troops();
    game.addExecution(new AttackExecution(500, game.player(ENEMY), CROWN));
    tick(game);
    expect(ledger(game).levy.processed).toEqual(beforeInvalid.levy.processed);
    expect(imperialLayers(game)).toHaveLength(0);
    expect(game.player(DONOR).troops()).toBe(donorWithoutAttack);

    game.performNationalCommand(game.player(CROWN), {
      kind: "transfer-crown",
      empireId: EMPIRE,
      successorId: DONOR,
    });
    expect(() =>
      game.performNationalImperialAdministration(game.player(CROWN), {
        ...command,
        expectedVersion: 2,
      }),
    ).toThrow(/emperor/);
    expect(() =>
      game.performNationalImperialAdministration(game.player(DONOR), {
        ...command,
        expectedVersion: 1,
      }),
    ).toThrow(/stale/);
    game.performNationalImperialAdministration(game.player(DONOR), {
      ...command,
      expectedVersion: 2,
      response: "none",
    });
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    expect(
      restored.nationalImperialAdministrationFor(restored.player(DONOR)),
    ).toEqual(game.nationalImperialAdministrationFor(game.player(DONOR)));
  });

  it("shares real contributor balances across simultaneous attacks and never pierces reserves", async () => {
    const game = await found();
    setResponse(game, "assist");
    game.player(CROWN).setTroops(0);
    game.player(MEMBER).setTroops(1);
    const min = reserve(game);
    game.player(DONOR).setTroops(min + 10_000);
    game.player(ENEMY).setTroops(20_000);
    // TWO valid fronts against the same member in one GameRunner tick.
    game.performNationalWarCommand(game.player(OTHER), {
      kind: "declare-national",
      warId: "c5e4-other-war",
      aggressorId: OTHER,
      targetId: MEMBER,
    });
    const buf = [0, 0, 0, 0];
    let shared = false;
    for (const tile of game.player(OTHER).tiles()) {
      const n = game.map().neighbors4(tile, buf);
      for (let i = 0; i < n; i++) {
        const c = buf[i];
        if (
          !game.map().isWater(c) &&
          !game.map().isImpassable(c) &&
          game.owner(c) === game.terraNullius()
        ) {
          game.player(MEMBER).conquer(c);
          shared = true;
          break;
        }
      }
      if (shared) break;
    }
    expect(game.player(OTHER).sharesBorderWith(game.player(MEMBER))).toBe(true);
    game.player(OTHER).setTroops(20_000);
    game.addExecution(new AttackExecution(10_000, game.player(ENEMY), MEMBER));
    game.addExecution(new AttackExecution(10_000, game.player(OTHER), MEMBER));
    tick(game);
    const accepted = ledger(game).levy.processed;
    expect(accepted).toHaveLength(2);
    const debited = accepted.reduce(
      (sum, r) =>
        sum + r.result.contributions.reduce((v, c) => v + c.troopsDebited, 0),
      0,
    );
    // The two front lines share one live account, including regular production
    // credited before this tick's authoritative interception.
    expect(debited).toBeGreaterThanOrEqual(10_000);
    expect(game.player(DONOR).troops()).toBeGreaterThanOrEqual(min - 1);
    expect(debited).toBe(
      ledger(game).levy.allowances.reduce(
        (sum, allowance) => sum + allowance.spent,
        0,
      ),
    );
    expect(accepted.every((r) => r.result.intercepted >= 0)).toBe(true);
    expect(imperialLayers(game)).toHaveLength(0);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
  });

  it("rejects direct synthetic attack receipts and forged troop size before charging a donor or creating WAR", async () => {
    const game = await found();
    setResponse(game, "both");
    game.player(DONOR).setTroops(reserve(game) + 50_000);
    game.player(ENEMY).setTroops(50_000);
    const read = () => ({
      donors: game.player(DONOR).troops(),
      processed: ledger(game).levy.processed,
      wars: imperialLayers(game),
    });
    const ingress = game as Game & {
      interceptNationalIncomingAttack(
        attackId: string,
        attackerId: string,
        defenderId: string,
        troops: number,
      ): unknown;
    };
    const before = read();
    expect(() =>
      ingress.interceptNationalIncomingAttack(
        "forged-not-a-real-attack", ENEMY, MEMBER, 50_000,
      ),
    ).toThrow(/real accepted invading army/);
    expect(read()).toEqual(before);

    const shell = game.player(ENEMY).createAttack(
      game.player(MEMBER), 100, null, new Set(),
    );
    expect(() =>
      ingress.interceptNationalIncomingAttack(
        shell.id(), ENEMY, MEMBER, 50_000,
      ),
    ).toThrow(/forged invading troop strength/);
    shell.delete();
    expect(read()).toEqual(before);
  });

  it("re-checks current emperor doctrine when a real attack waits in the queue", async () => {
    const game = await found();
    setResponse(game, "both");
    game.player(MEMBER).setTroops(1);
    game.player(DONOR).setTroops(reserve(game) + 40_000);
    game.player(ENEMY).setTroops(10_000);
    game.addExecution(new AttackExecution(10_000, game.player(ENEMY), MEMBER));
    setResponse(game, "none", 1);
    tick(game);
    expect(ledger(game).levy.processed).toHaveLength(1);
    expect(ledger(game).levy.processed[0].result.intercepted).toBe(0);
    expect(imperialLayers(game)).toHaveLength(0);
    expect(
      game.nationalImperialAdministrationFor(game.player(CROWN))
        ?.standingDefenseResponse,
    ).toBe("none");
  });

  it("limits twenty microattack clicks to one non-refreshing donor campaign allowance", async () => {
    const game = await found();
    setResponse(game, "assist");
    game.player(CROWN).setTroops(0);
    game.player(MEMBER).setTroops(200_000);
    game.player(DONOR).setTroops(reserve(game) + 10_000);
    game.player(ENEMY).setTroops(100_000);
    for (let i = 0; i < 20; i++) {
      hit(game, 1_000);
    }
    const allowances = ledger(game).levy.allowances.filter(
      (a) => a.contributorId === DONOR,
    );
    expect(allowances).toHaveLength(1);
    expect(allowances[0].spent).toBeLessThanOrEqual(allowances[0].limit);
    expect(game.player(DONOR).troops()).toBeGreaterThanOrEqual(reserve(game));
    expect(imperialLayers(game)).toHaveLength(0);
    const totalReceipts = ledger(game)
      .levy.processed.flatMap((row) =>
        row.result.contributions.filter((c) => c.nationId === DONOR),
      )
      .reduce((sum, c) => sum + c.troopsDebited, 0);
    expect(totalReceipts).toBe(allowances[0].spent);
  });
});
