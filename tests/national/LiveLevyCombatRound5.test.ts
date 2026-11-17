/**
 * E2 real Game / AttackExecution levy acceptance. Requires the actual E1
 * Game.nationalMdaAllies() authority: NEVER install a test-only donor
 * reader that could hide the production fail-closed guarantee.
 */
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { interceptNationalAttack } from "@openfront/engine/execution/NationalWarExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game, Player } from "@openfront/engine/game/Game";
import { PlayerImpl } from "@openfront/engine/game/PlayerImpl";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const records = [
  new PlayerInfo("North", PlayerType.Human, "mda-north-client", "mda-north"),
  new PlayerInfo("South", PlayerType.Human, "mda-south-client", "mda-south"),
  new PlayerInfo("East", PlayerType.Human, "mda-east-client", "mda-east"),
  new PlayerInfo("West", PlayerType.Human, "mda-west-client", "mda-west"),
  new PlayerInfo(
    "Central",
    PlayerType.Human,
    "mda-center-client",
    "mda-center",
  ),
];
const A = "mda-north",
  B = "mda-south";
const donorIds = ["mda-east", "mda-west", "mda-center"];

async function gameWithPlayers(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, records);
  const coords = [
    [20, 20],
    [70, 20],
    [20, 70],
    [70, 70],
    [50, 50],
  ];
  for (let i = 0; i < records.length; i++) {
    const [x, y] = coords[i];
    game.addExecution(
      new SpawnExecution("round5-mda", records[i], game.map().ref(x, y)),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  for (const player of records)
    expect(game.player(player.id).hasSpawned()).toBe(true);
  return game;
}

function joinMda(game: Game, ids: readonly string[]) {
  const defender = game.player(B);
  game.performNationalCommand(defender, {
    kind: "found-pact",
    pactId: "round5-mda",
    pactKind: "MDA",
    name: "Mutual Defense",
    terms: { admission: "leader", expulsion: "forbidden" },
  });
  for (const id of ids) {
    game.performNationalCommand(defender, {
      kind: "invite-pact",
      pactId: "round5-mda",
      candidateId: id,
    });
    game.performNationalCommand(game.player(id), {
      kind: "accept-pact",
      pactId: "round5-mda",
    });
  }
}

/** Require E1's actual live authoritative Game port; no mocked donors. */
function requireCanonicalDonorReader(game: Game): void {
  const port = game as Game & {
    nationalMdaAllies?: (defenderId: string) => readonly string[];
  };
  expect(typeof port.nationalMdaAllies).toBe("function");
}

function declareWar(game: Game) {
  game.performNationalWarCommand(game.player(A), {
    kind: "declare-national",
    warId: "round5-offensive",
    aggressorId: A,
    targetId: B,
  });
}

function connectBorder(game: Game) {
  const map = game.map();
  const north = game.player(A);
  const south = game.player(B);
  for (let y = 30; y < 46; y++) {
    for (let x = 30; x < 50; x++) north.conquer(map.ref(x, y));
    for (let x = 50; x < 70; x++) south.conquer(map.ref(x, y));
  }
  game.executeNextTick();
}

async function scenario(count: 2 | 3, connect = true) {
  const game = await gameWithPlayers();
  requireCanonicalDonorReader(game);
  if (connect) connectBorder(game);
  const donors = donorIds.slice(0, count).map((id) => game.player(id));
  joinMda(game, donorIds.slice(0, count));
  declareWar(game);
  const attacker = game.player(A),
    defender = game.player(B);
  attacker.setTroops(500_000);
  defender.setTroops(250_000);
  for (const donor of donors) donor.setTroops(500_000);
  return { game, attacker, defender, donors };
}

function total(players: readonly Player[]): number {
  return players.reduce((sum, p) => sum + p.troops(), 0);
}

describe("Round Five: real NATIONAL MDA defensive combat conservation", () => {
  for (const count of [2, 3] as const) {
    it(`LEVY-01/04 actual ${count} donors charge once and inflict matching attacker loss`, async () => {
      const { game, attacker, defender, donors } = await scenario(count);
      const beforeAttacker = attacker.troops();
      const beforeDonors = total(donors);
      const beforeDefender = defender.troops();
      const initial = 100_000;
      const execution = new AttackExecution(initial, attacker, defender.id());
      execution.init(game, game.ticks());
      expect(execution.isActive()).toBe(true);
      const processed = game.nationalWarState()!.levy.processed;
      expect(processed).toHaveLength(1);
      const first = processed[0].result;
      expect(first.application).toBe("applied");
      expect(first.contributions.length).toBe(count);
      const intercepted = first.intercepted;
      expect(intercepted).toBeGreaterThan(0);
      const donorLoss = beforeDonors - total(donors);
      expect(donorLoss).toBe(intercepted);
      expect(first.contributions.reduce((n, c) => n + c.troopsDebited, 0)).toBe(
        intercepted,
      );
      expect(attacker.troops()).toBe(beforeAttacker - initial);
      expect(defender.troops()).toBe(beforeDefender);
      const inFlight = attacker
        .outgoingAttacks()
        .reduce((n, a) => n + a.troops(), 0);
      expect(inFlight).toBe(initial - intercepted);
      // Both sides' casualties are conserved: every MDA troop spent causes
      // exactly one attacker loss. No refund, no duplicate reservation.
      expect(
        beforeAttacker +
          beforeDonors -
          (attacker.troops() + total(donors) + inFlight),
      ).toBe(2 * intercepted);
    });
  }

  it("LEVY-05 second/final real PlayerImpl preflight failures leave all accounts and war ledger unchanged", async () => {
    for (const at of [1, 2]) {
      const { game, attacker, defender, donors } = await scenario(3);
      const all = [attacker, defender, ...donors];
      const before = all.map((p) => p.troops());
      const prior = game.nationalWarState();
      // E1's command handler calls the full-batch adapter. This wrapper injects
      // a genuine PlayerImpl preflight failure before the E1 ledger can commit.
      // No fake contributor refund or post-commit compensation is involved.
      const apply = game.applyNationalDefenseLevy.bind(game);
      Object.assign(game, {
        applyNationalDefenseLevy: (
          requests: Parameters<Game["applyNationalDefenseLevy"]>[0],
        ) => {
          const rows = requests[0].eligible.map((e) => ({
            player: game.player(e.source.nationId) as PlayerImpl,
            expectedBalance: e.source.troops(),
            debit: 1,
            resultingBalance: e.source.troops() - 1,
          }));
          PlayerImpl.commitNationalTroopDebits(rows, (index) => {
            if (index === at) throw new Error("injected commit preflight");
          });
          return apply(requests);
        },
      });
      const attempted = new AttackExecution(100_000, attacker, defender.id());
      attempted.init(game, game.ticks());
      expect(attempted.isActive()).toBe(false);
      expect(all.map((p) => p.troops())).toEqual(before);
      expect(attacker.outgoingAttacks()).toHaveLength(0);
      expect(game.nationalWarState()).toEqual(prior);
    }
  });

  it("LEVY-06/07 campaign budget cannot be replenished by repeated microattacks", async () => {
    const { game, attacker, defender, donors } = await scenario(3);
    const before = total(donors);
    for (let i = 0; i < 15; i++) {
      const execution = new AttackExecution(8_000, attacker, defender.id());
      execution.init(game, game.ticks());
    }
    const allowances = game.nationalWarState()!.levy.allowances;
    expect(allowances).toHaveLength(3);
    for (const x of allowances) {
      expect(x.spent).toBeGreaterThanOrEqual(0);
      expect(x.spent).toBeLessThanOrEqual(x.limit);
    }
    expect(before - total(donors)).toBe(
      allowances.reduce((sum, x) => sum + x.spent, 0),
    );
    expect(new Set(allowances.map((x) => x.key)).size).toBe(3);
    expect(game.nationalWarState()!.levy.processed.length).toBeGreaterThan(1);
  });

  it("LEVY-07 nonlanding canceled attack does not debit donors or open a campaign", async () => {
    const { game, attacker, defender, donors } = await scenario(2, false);
    const before = total(donors);
    const beforeAttacker = attacker.troops();
    const warState = game.nationalWarState();
    const attack = new AttackExecution(100_000, attacker, defender.id());
    attack.init(game, game.ticks());
    expect(attack.isActive()).toBe(false);
    expect(total(donors)).toBe(before);
    expect(attacker.troops()).toBe(beforeAttacker);
    expect(game.nationalWarState()).toEqual(warState);
  });

  it("WAR-04/LEVY-07 accepted peace stops a real in-flight attack without refunding MDA losses", async () => {
    const { game, attacker, defender, donors } = await scenario(2);
    const initial = attacker.troops();
    const beforeDonors = total(donors);
    const beforeTiles = defender.numTilesOwned();
    const beforeDefender = defender.troops();
    const assault = new AttackExecution(100_000, attacker, defender.id());
    assault.init(game, game.ticks());
    expect(assault.isActive()).toBe(true);
    const intercepted =
      game.nationalWarState()!.levy.processed[0].result.intercepted;
    expect(intercepted).toBeGreaterThan(0);
    const afterAcceptedDonors = total(donors);
    expect(beforeDonors - afterAcceptedDonors).toBe(intercepted);
    game.performNationalWarCommand(attacker, {
      kind: "propose-peace",
      warId: "round5-offensive",
      motionId: "round5-peace",
    });
    game.performNationalWarCommand(defender, {
      kind: "accept-peace",
      motionId: "round5-peace",
    });
    expect(game.nationalWarAuthority()?.atWar(A, B)).toBe(false);
    assault.tick(game.ticks()); // actual ongoing execution, before any tile damage
    expect(assault.isActive()).toBe(false);
    expect(attacker.outgoingAttacks()).toHaveLength(0);
    expect(defender.numTilesOwned()).toBe(beforeTiles);
    expect(defender.troops()).toBe(beforeDefender);
    expect(total(donors)).toBe(afterAcceptedDonors); // P2: no donor refund invented
    expect(attacker.troops()).toBe(initial - intercepted);
    expect(initial + beforeDonors - (attacker.troops() + total(donors))).toBe(
      2 * intercepted,
    );
  });

  it("LEVY-06/07 snapshot restores original receipt and duplicate attack is a strict no-op", async () => {
    const { game, attacker, defender, donors } = await scenario(2);
    game.addExecution(new AttackExecution(100_000, attacker, defender.id()));
    game.executeNextTick(); // genuine real queued attack acceptance
    const first = game.nationalWarState()!.levy.processed[0];
    expect(first).toBeDefined();
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    requireCanonicalDonorReader(restored);
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    const sources = donors.map((p) => p.id());
    const before = total(sources.map((id) => restored.player(id)));
    const replay = interceptNationalAttack(
      restored,
      first.attackId,
      A,
      B,
      first.attackTroopsBefore,
    );
    expect(replay?.application).toBe("replay");
    expect(replay?.intercepted).toBe(0);
    expect(total(sources.map((id) => restored.player(id)))).toBe(before);
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
  });
});
