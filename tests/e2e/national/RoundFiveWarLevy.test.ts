import { createHash } from "node:crypto";
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { authorizeNationalAttack } from "@openfront/engine/execution/NationalWarExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { PlayerImpl } from "@openfront/engine/game/PlayerImpl";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../../util/Setup";
import { roundTrip } from "../../util/Snapshot";

const roster = [
  new PlayerInfo("QA Alpha", PlayerType.Human, "qa-r5-client-a", "qa-r5-a"),
  new PlayerInfo("QA Bravo", PlayerType.Human, "qa-r5-client-b", "qa-r5-b"),
  new PlayerInfo("QA Charlie", PlayerType.Human, "qa-r5-client-c", "qa-r5-c"),
];
const [A, B, C] = roster.map((p) => p.id);

async function live(nationalMode = true): Promise<Game> {
  const game = await setup("plains", { nationalMode }, roster);
  for (const [i, info] of roster.entries()) {
    const [x, y] = [[20, 20], [80, 80], [20, 80]][i];
    game.addExecution(new SpawnExecution("r5-independent-war", info, game.ref(x, y)));
  }
  game.executeNextTick();
  game.executeNextTick();
  for (const info of roster) expect(game.player(info.id).hasSpawned()).toBe(true);
  return game;
}

function border(game: Game): void {
  for (let y = 30; y < 48; y++) {
    for (let x = 30; x < 50; x++) game.player(A).conquer(game.ref(x, y));
    for (let x = 50; x < 70; x++) game.player(B).conquer(game.ref(x, y));
  }
  game.executeNextTick();
}

function mda(game: Game): void {
  game.performNationalCommand(game.player(B), {
    kind: "found-pact",
    pactId: "r5-defensive-pact",
    pactKind: "MDA",
    name: "QA Independent Defense",
    terms: { admission: "leader", expulsion: "forbidden" },
  });
  game.performNationalCommand(game.player(B), {
    kind: "invite-pact",
    pactId: "r5-defensive-pact",
    candidateId: C,
  });
  game.performNationalCommand(game.player(C), {
    kind: "accept-pact",
    pactId: "r5-defensive-pact",
  });
}

function war(game: Game, id: string): void {
  game.performNationalWarCommand(game.player(A), {
    kind: "declare-national",
    warId: id,
    aggressorId: A,
    targetId: B,
  });
}

function digest(game: Game): string {
  return createHash("sha256").update(snapshotGame(game)).digest("hex");
}

function assertResources(
  game: Game, before: readonly number[], expectedDeductions: readonly number[],
): void {
  const now = [A, B, C].map((id) => game.player(id).troops());
  for (let i = 0; i < 3; i++) {
    if (now[i] !== before[i] - expectedDeductions[i]) {
      throw new Error(`NATIONAL resource conservation failure for ${[A,B,C][i]}: ${before[i]} -> ${now[i]}; expected debit ${expectedDeductions[i]}`);
    }
  }
}

describe("E5 Round Five independent real-game WAR + MDA acceptance", () => {
  it("WAR-01 unauthorized attack is rejected without troop debit; injected missing authorization is detected", async () => {
    const game = await live();
    border(game);
    const alpha = game.player(A);
    const bravo = game.player(B);
    alpha.setTroops(100_000);
    bravo.setTroops(100_000);
    const before = [A, B, C].map((id) => game.player(id).troops());
    const refuse = new AttackExecution(20_000, alpha, B);
    refuse.init(game, game.ticks());
    expect(refuse.isActive()).toBe(false);
    assertResources(game, before, [0, 0, 0]);
    expect(authorizeNationalAttack(game, A, B)).toBe(false);

    // Fault injection against the *real Game object*, no production edits.
    // A gate that simply trusts a happy-path assertion fails this test.
    const realAuthority = game.nationalWarAuthority.bind(game);
    Object.assign(game, {
      nationalWarAuthority: () => ({
        authorizeOffensiveAction: () => true,
        atWar: () => true,
      }),
    });
    try {
      expect(() => {
        if (authorizeNationalAttack(game, A, B))
          throw new Error("NATIONAL unauthorized attack accepted");
      }).toThrow("unauthorized attack accepted");
    } finally {
      Object.assign(game, { nationalWarAuthority: realAuthority });
    }
    expect(authorizeNationalAttack(game, A, B)).toBe(false);
  });

  it("WAR-04 formal war enables a real AttackExecution and neutral FFA keeps its original rule", async () => {
    const national = await live();
    border(national);
    national.player(A).setTroops(100_000);
    national.player(B).setTroops(100_000);
    war(national, "r5-war-attack");
    expect(authorizeNationalAttack(national, A, B)).toBe(true);
    const before = national.player(A).troops();
    const attack = new AttackExecution(20_000, national.player(A), B);
    attack.init(national, national.ticks());
    // Missing MDA discovery must FAIL this required positive game scenario;
    // an authorized war that cannot attack is NOT playable.
    expect(attack.isActive()).toBe(true);
    expect(national.player(A).troops()).toBe(before - 20_000);
    expect(national.player(A).outgoingAttacks().length).toBeGreaterThan(0);

    const legacy = await live(false);
    border(legacy);
    expect(authorizeNationalAttack(legacy, A, B)).toBe(true);
    const original = legacy.player(A).troops();
    legacy.player(A).setTroops(100_000);
    const oldAttack = new AttackExecution(20_000, legacy.player(A), B);
    oldAttack.init(legacy, legacy.ticks());
    expect(oldAttack.isActive()).toBe(true);
    expect(legacy.player(A).troops()).toBe(80_000);
    expect(original).toBeGreaterThanOrEqual(0);
  });

  it("LEVY-01/05 real MDA contributor roster, exact receipts, no repeat debit, deterministic restored replay", async () => {
    const game = await live();
    mda(game);
    war(game, "r5-war-defense");
    game.player(C).setTroops(500_000);
    const port = game as Game & { nationalMdaAllies?: (id: string) => readonly string[] };
    // A missing canonical discovery port is a hard failed acceptance; never
    // pass by constructing a fake donor roster in E5.
    expect(typeof port.nationalMdaAllies).toBe("function");
    expect(port.nationalMdaAllies?.(B)).toEqual([C]);
    const source = game.nationalLevySource(C)!;
    const request = (g: Game) => ({
      attackId: "r5-mda-attack",
      confirmedAccepted: true as const,
      campaignId: "r5-mda-campaign",
      attackerId: A,
      defenderId: B,
      attackingTroops: 20_000,
      eligible: [{
        source: g.nationalLevySource(C)!,
        troopCapacity: Math.floor(g.config().maxTroops(g.player(C))),
        maximumFraction: 0.1,
        protectedCapacityFraction: 0.3,
      }],
    });
    expect(source.nationId).toBe(C);
    const before = [A, B, C].map((id) => game.player(id).troops());
    const [receipt] = game.applyNationalDefenseLevy([request(game)]);
    expect(receipt.application).toBe("applied");
    expect(receipt.intercepted).toBe(20_000);
    expect(receipt.contributions).toEqual([{ nationId: C, troopsDebited: 20_000 }]);
    expect(receipt.remainingAttackingTroops + receipt.intercepted).toBe(20_000);
    assertResources(game, before, [0, 0, 20_000]);

    const byteHash = digest(game);
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(digest(restored)).toBe(byteHash);
    for (const g of [game, restored]) {
      const conserved = [A, B, C].map((id) => g.player(id).troops());
      const [replay] = g.applyNationalDefenseLevy([request(g)]);
      expect(replay).toMatchObject({ application: "replay", intercepted: 0, contributions: [] });
      assertResources(g, conserved, [0, 0, 0]);
    }
    expect(digest(restored)).toBe(digest(game));
    for (let i = 0; i < 5; i++) {
      game.executeNextTick();
      restored.executeNextTick();
      expect(digest(restored)).toBe(digest(game));
    }
    console.info("QA_R5_LEVY_REPLAY " + JSON.stringify({ first: byteHash, final: digest(game), ticks: 5, intercepted: receipt.intercepted }));
  });

  it("LEVY-05/06 actual CAS rejects stale and duplicate funding; conservation oracle detects injected second debit", async () => {
    const game = await live();
    const donor = game.player(C) as PlayerImpl;
    donor.setTroops(100_000);
    const rows = [{ player: donor, expectedBalance: 100_000, debit: 10_000, resultingBalance: 90_000 }];
    PlayerImpl.commitNationalTroopDebits(rows);
    expect(donor.troops()).toBe(90_000);
    expect(() => PlayerImpl.commitNationalTroopDebits(rows)).toThrow();
    expect(donor.troops()).toBe(90_000);
    const checked = [A, B, C].map((id) => game.player(id).troops());
    donor.setTroops(80_000); // explicit double-charge mutation
    expect(() => assertResources(game, checked, [0, 0, 0])).toThrow(/resource conservation failure/);
    donor.setTroops(90_000);
    assertResources(game, checked, [0, 0, 0]);
    expect(() => PlayerImpl.commitNationalTroopDebits([rows[0], rows[0]])).toThrow();
    expect(donor.troops()).toBe(90_000);
  });

  it("LEVY-06 a real accepted AttackExecution rolls back attacker and donors on injected CAS failure", async () => {
    const game = await live();
    border(game);
    mda(game);
    war(game, "r5-atomic-attack");
    game.player(A).setTroops(100_000);
    game.player(B).setTroops(100_000);
    game.player(C).setTroops(500_000);
    const before = [A, B, C].map((id) => game.player(id).troops());

    const original = game.applyNationalDefenseLevy.bind(game);
    let reachedRealAdapter = 0;
    Object.assign(game, {
      applyNationalDefenseLevy: () => {
        reachedRealAdapter++;
        throw new Error("QA injected second-contributor CAS failure");
      },
    });
    try {
      const attack = new AttackExecution(20_000, game.player(A), B);
      attack.init(game, game.ticks());
      expect(reachedRealAdapter).toBe(1);
      expect(attack.isActive()).toBe(false);
      expect(game.player(A).outgoingAttacks()).toHaveLength(0);
      assertResources(game, before, [0, 0, 0]);
    } finally {
      Object.assign(game, { applyNationalDefenseLevy: original });
    }
    expect(game.nationalWarState()?.levy.processed).toEqual([]);
    expect(game.nationalWarState()?.levy.allowances).toEqual([]);
  });

  it("WAR-04 independent peace layers and source snapshot hash survive restore", async () => {
    const game = await live();
    game.performNationalCommand(game.player(A), { kind: "found-empire", empireId: "r5_empire" });
    game.performNationalWarCommand(game.player(A), {
      kind: "declare-imperial",
      warId: "r5-imperial-war",
      aggressor: { kind: "empire", id: "r5_empire" },
      target: { kind: "nation", id: B },
    });
    war(game, "r5-national-war");
    game.performNationalWarCommand(game.player(A), {
      kind: "propose-peace", motionId: "r5-peace", warId: "r5-imperial-war",
    });
    const baseline = digest(game);
    const { restored } = await roundTrip(game, "plains");
    expect(digest(restored)).toBe(baseline);
    for (const g of [game, restored]) {
      g.performNationalWarCommand(g.player(B), { kind: "accept-peace", motionId: "r5-peace" });
      expect(g.nationalWarAuthority()?.atWar(A, B)).toBe(true);
      expect(g.nationalWarState()?.wars.layers.find((l) => l.id === "r5-imperial-war")?.endedTick).not.toBeNull();
      expect(g.nationalWarState()?.wars.layers.find((l) => l.id === "r5-national-war")?.endedTick).toBeNull();
    }
    expect(digest(restored)).toBe(digest(game));
  });
});
