import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game, Player } from "@openfront/engine/game/Game";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const ids = ["r8-a", "r8-b", "r8-c", "r8-d", "r8-e"] as const;
const records = ids.map(
  (id) => new PlayerInfo(id, PlayerType.Human, `${id}-client`, id),
);

async function overlappingGame(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, records);
  const coords = [[20, 20], [70, 20], [70, 70], [20, 70], [50, 50]];
  for (let i = 0; i < records.length; i++) {
    game.addExecution(
      new SpawnExecution("r8-levy", records[i], game.ref(coords[i][0], coords[i][1])),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  for (const info of records) expect(game.player(info.id).hasSpawned()).toBe(true);
  const attacker = game.player(ids[0]);
  const b = game.player(ids[1]);
  const c = game.player(ids[2]);
  for (let x = 30; x < 50; x++) {
    for (let y = 30; y < 40; y++) attacker.conquer(game.ref(x, y));
    for (let y = 60; y < 70; y++) attacker.conquer(game.ref(x, y));
  }
  for (let x = 50; x < 65; x++) {
    for (let y = 30; y < 40; y++) b.conquer(game.ref(x, y));
    for (let y = 60; y < 70; y++) c.conquer(game.ref(x, y));
  }
  game.executeNextTick();

  const join = (defender: Player, pactId: string, donors: readonly string[]) => {
    game.performNationalCommand(defender, {
      kind: "found-pact",
      pactId,
      pactKind: "MDA",
      name: pactId,
      terms: { admission: "leader", expulsion: "forbidden" },
    });
    for (const id of donors) {
      game.performNationalCommand(defender, {
        kind: "invite-pact", pactId, candidateId: id,
      });
      game.performNationalCommand(game.player(id), {
        kind: "accept-pact", pactId,
      });
    }
  };
  join(b, "r8-mda-b", [ids[3], ids[4]]);
  join(c, "r8-mda-c", [ids[3]]);
  for (const targetId of [ids[1], ids[2]]) {
    game.performNationalWarCommand(attacker, {
      kind: "declare-national",
      warId: `r8-a-to-${targetId}`,
      aggressorId: ids[0],
      targetId,
    });
  }
  attacker.setTroops(500_000);
  b.setTroops(250_000);
  c.setTroops(250_000);
  game.player(ids[3]).setTroops(500_000);
  game.player(ids[4]).setTroops(500_000);
  expect(game.nationalMdaAllies(ids[1])).toEqual([ids[3], ids[4]]);
  expect(game.nationalMdaAllies(ids[2])).toEqual([ids[3]]);
  return game;
}

function sum(players: readonly Player[]): number {
  return players.reduce((n, p) => n + p.troops(), 0);
}

describe("Round Eight LEVY-04–07 actual simultaneous MDA conservation", () => {
  it("LEVY-05/07: one overlapping donor funds two legal fronts from the SAME real balance, never twice", async () => {
    const game = await overlappingGame();
    const attacker = game.player(ids[0]);
    const defenders = [game.player(ids[1]), game.player(ids[2])];
    const donors = [game.player(ids[3]), game.player(ids[4])];
    const beforeDonor = sum(donors);
    const beforeAttacker = attacker.troops();

    const first = new AttackExecution(60_000, attacker, defenders[0].id());
    const second = new AttackExecution(60_000, attacker, defenders[1].id());
    first.init(game, game.ticks());
    second.init(game, game.ticks());
    expect(first.isActive()).toBe(true);
    expect(second.isActive()).toBe(true);
    const ledger = game.nationalWarState()!.levy;
    expect(ledger.processed).toHaveLength(2);
    expect(ledger.processed.every((r) => r.result.application === "applied")).toBe(true);
    expect(ledger.processed.every((r) => r.result.intercepted > 0)).toBe(true);
    const allContributions = ledger.processed.flatMap((r) => r.result.contributions);
    expect(allContributions.filter((r) => r.nationId === ids[3])).toHaveLength(2);
    const intercepted = ledger.processed.reduce((n, r) => n + r.result.intercepted, 0);
    expect(allContributions.reduce((n, r) => n + r.troopsDebited, 0)).toBe(intercepted);
    expect(beforeDonor - sum(donors)).toBe(intercepted);
    expect(attacker.troops()).toBe(beforeAttacker - 120_000);
    const inFlight = attacker.outgoingAttacks().reduce((n, a) => n + a.troops(), 0);
    expect(inFlight).toBe(120_000 - intercepted);
    expect(beforeAttacker + beforeDonor - (attacker.troops() + sum(donors) + inFlight))
      .toBe(2 * intercepted);

    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    expect([ids[3], ids[4]].map((id) => restored.player(id).troops()))
      .toEqual(donors.map((p) => p.troops()));
  });

  it("LEVY-04/06/07: twenty repeated attacks share one campaign cap for every donor and never breach protected reserves", async () => {
    const game = await overlappingGame();
    const attacker = game.player(ids[0]);
    const defenders = [game.player(ids[1]), game.player(ids[2])];
    const donors = [game.player(ids[3]), game.player(ids[4])];
    const before = sum(donors);
    const reserves = donors.map((p) => Math.ceil(game.config().maxTroops(p) * 0.3));

    for (let i = 0; i < 20; i++) {
      const defender = defenders[i % 2];
      const attempt = new AttackExecution(5_000, attacker, defender.id());
      attempt.init(game, game.ticks());
      expect(attempt.isActive()).toBe(true);
    }
    const levy = game.nationalWarState()!.levy;
    expect(levy.processed).toHaveLength(20);
    expect(levy.allowances).toHaveLength(3);
    for (const allowance of levy.allowances) {
      expect(allowance.spent).toBeGreaterThanOrEqual(0);
      expect(allowance.spent).toBeLessThanOrEqual(allowance.limit);
    }
    for (let i = 0; i < donors.length; i++) {
      expect(donors[i].troops()).toBeGreaterThanOrEqual(reserves[i]);
    }
    expect(before - sum(donors)).toBe(
      levy.allowances.reduce((n, a) => n + a.spent, 0),
    );
    const replay = game.applyNationalDefenseLevy([]);
    expect(replay).toEqual([]);
    expect(game.nationalWarState()!.levy).toEqual(levy);
  });
});
