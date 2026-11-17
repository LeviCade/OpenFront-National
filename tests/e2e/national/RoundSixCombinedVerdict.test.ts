/**
 * Engineer #5 Round Six — independent tests against actual combined Game,
 * GameRunner, Executor and live Player troop balances. Deliberately fail if
 * any E1/E2/E3 contract disappears; no forged success or synthetic donors.
 */
import { createHash } from "node:crypto";
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../../util/Setup";
import { roundTrip } from "../../util/Snapshot";

const info = [
  new PlayerInfo("R6 North", PlayerType.Human, "r6-north-client", "r6-north"),
  new PlayerInfo("R6 South", PlayerType.Human, "r6-south-client", "r6-south"),
  new PlayerInfo("R6 East", PlayerType.Human, "r6-east-client", "r6-east"),
  new PlayerInfo("R6 West", PlayerType.Human, "r6-west-client", "r6-west"),
  new PlayerInfo("R6 Center", PlayerType.Human, "r6-center-client", "r6-center"),
];
const [A, B, C, D, E] = info.map((p) => p.id);

async function live(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, info);
  const coords = [[20, 20], [70, 20], [20, 70], [70, 70], [50, 50]];
  for (const [i, player] of info.entries()) {
    const [x, y] = coords[i];
    game.addExecution(new SpawnExecution("r6-independent", player, game.ref(x, y)));
  }
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const player of info) expect(game.player(player.id).hasSpawned()).toBe(true);
  return game;
}

function hash(game: Game): string {
  return createHash("sha256").update(snapshotGame(game)).digest("hex");
}

function addBorder(game: Game) {
  for (let y = 30; y < 46; y++) {
    for (let x = 30; x < 50; x++) game.player(A).conquer(game.ref(x, y));
    for (let x = 50; x < 70; x++) game.player(B).conquer(game.ref(x, y));
  }
  game.executeNextTick();
}

function pact(game: Game, donors: readonly string[]) {
  game.performNationalCommand(game.player(B), {
    kind: "found-pact",
    pactId: "r6-full-mda",
    pactKind: "MDA",
    name: "Strict QA Defense",
    terms: { admission: "leader", expulsion: "forbidden" },
  });
  for (const id of donors) {
    game.performNationalCommand(game.player(B), {
      kind: "invite-pact", pactId: "r6-full-mda", candidateId: id,
    });
    game.performNationalCommand(game.player(id), {
      kind: "accept-pact", pactId: "r6-full-mda",
    });
  }
}

function count(game: Game, ids: readonly string[]): number {
  return ids.reduce((sum, id) => sum + game.player(id).troops(), 0);
}

describe("E5 R6 combined game acceptance — real donors and exact journal correlation", () => {
  for (const donorCount of [2, 3] as const) {
    it(`R6 LEVY-01/04 ${donorCount} real MDA donors conserve both sides and snapshot receipts`, async () => {
      const game = await live();
      addBorder(game);
      const donors = [C, D, E].slice(0, donorCount);
      pact(game, donors);
      game.performNationalWarCommand(game.player(A), {
        kind: "declare-national",
        warId: "r6-actual-war",
        aggressorId: A,
        targetId: B,
      });
      expect(game.nationalMdaAllies(B)).toEqual(donors);
      game.player(A).setTroops(500_000);
      game.player(B).setTroops(250_000);
      for (const id of donors) game.player(id).setTroops(500_000);
      const beforeAttacker = game.player(A).troops();
      const beforeDefender = game.player(B).troops();
      const beforeDonors = count(game, donors);
      const priorWar = game.nationalWarState();

      // A synthetically incomplete donor list must be rejected BEFORE
      // any reserve debit, despite a real war and fully authenticated actor.
      const forged = [{
        source: game.nationalLevySource(donors[0])!,
        troopCapacity: Math.floor(game.config().maxTroops(game.player(donors[0]))),
        maximumFraction: 0.1,
        protectedCapacityFraction: 0.3,
      }];
      expect(() => game.applyNationalDefenseLevy([{
        attackId: "r6-forged-" + donorCount,
        confirmedAccepted: true,
        campaignId: "r6-forged-budget",
        attackerId: A,
        defenderId: B,
        attackingTroops: 100_000,
        eligible: forged,
      }])).toThrow(/missing or forged MDA contributor roster/);
      expect(game.player(A).troops()).toBe(beforeAttacker);
      expect(count(game, donors)).toBe(beforeDonors);
      expect(game.nationalWarState()).toEqual(priorWar);

      const initial = 100_000;
      const attack = new AttackExecution(initial, game.player(A), B);
      attack.init(game, game.ticks());
      expect(attack.isActive()).toBe(true);
      const ledger = game.nationalWarState()!;
      expect(ledger.levy.processed).toHaveLength(1);
      const receipt = ledger.levy.processed[0].result;
      expect(receipt.application).toBe("applied");
      expect(receipt.contributions).toHaveLength(donorCount);
      const payerIds = receipt.contributions.map((item) => item.nationId);
      expect(payerIds).toEqual(donors);
      const sum = receipt.contributions.reduce((n, item) => n + item.troopsDebited, 0);
      expect(sum).toBe(receipt.intercepted);
      expect(sum).toBe(beforeDonors - count(game, donors));
      expect(sum).toBeGreaterThan(0);
      expect(receipt.remainingAttackingTroops + sum).toBe(initial);
      expect(game.player(A).troops()).toBe(beforeAttacker - initial);
      expect(game.player(B).troops()).toBe(beforeDefender);
      const outgoing = game.player(A).outgoingAttacks().reduce((n, item) => n + item.troops(), 0);
      expect(outgoing).toBe(initial - sum);
      expect(beforeAttacker + beforeDonors - (game.player(A).troops() + count(game, donors) + outgoing)).toBe(2 * sum);
      const beforeHash = hash(game);
      const { restored, bytes, again } = await roundTrip(game, "plains");
      expect([...bytes]).toEqual([...again]);
      expect(hash(restored)).toBe(beforeHash);
      expect(restored.nationalWarState()).toEqual(ledger);
      expect(count(restored, donors)).toBe(count(game, donors));
      console.info("QA_R6_MULTIDONOR " + JSON.stringify({
        donorCount, donorIds: donors, intercepted: sum,
        payerDebits: receipt.contributions, inFlight: outgoing,
        canonicalSnapshotSHA256: beforeHash,
      }));
    });
  }

  it("R6 exact per-click requestId must survive Executor → E1 journal → E3 GameRunner without foreign recipients", async () => {
    const game = await live();
    const packets: GameUpdateViewData[] = [];
    const runner = new GameRunner(
      game,
      new Executor(game, "r6-actor", info[0].clientID!),
      (packet) => { if ("updates" in packet) packets.push(packet); },
      info[0].clientID!,
    );
    const tick = () => {
      runner.addTurn({ turnNumber: game.ticks(), intents: [] });
      expect(runner.executeNextTick()).toBe(true);
      return packets[packets.length - 1];
    };
    expect(tick().nationalPolitics?.empires).toEqual([]);
    const cmd = new Executor(game, "r6-actor", info[0].clientID!);
    for (const [step, requestId] of ["qa_r6_req_first", "qa_r6_req_rejected"].entries()) {
      game.addExecution(cmd.createExec({
        type: "national_found_empire",
        empireId: "r6_kingdom",
        clientID: info[0].clientID!,
        requestId,
      } as Parameters<Executor["createExec"]>[0]));
      const queued = tick();
      expect(queued.nationalCommandResults).toBeUndefined();
      const applied = tick();
      const results = applied.nationalCommandResults;
      expect(results).toHaveLength(1);
      expect(results![0]).toMatchObject({
        recipientId: A,
        actorId: A,
        empireId: "r6_kingdom",
        type: "national_found_empire",
        accepted: step === 0,
        requestId,
      });
      expect(Number.isSafeInteger(results![0].sequence)).toBe(true);
      expect(applied.nationalPolitics?.empires).toEqual([{id: "r6_kingdom", leaderId: A, memberIds: [A]}]);
      expect(tick().nationalCommandResults).toBeUndefined();
      console.info("QA_R6_FOUNDING_RECEIPT " + JSON.stringify({
        accepted: step === 0, requestId, sequence: results![0].sequence,
        actor: results![0].actorId,
      }));
    }
    const other: GameUpdateViewData[] = [];
    const foreignRunner = new GameRunner(
      game,
      new Executor(game, "r6-foreign", info[1].clientID!),
      (packet) => {if ("updates" in packet) other.push(packet);},
      info[1].clientID!,
    );
    foreignRunner.addTurn({turnNumber: game.ticks(), intents: []});
    expect(foreignRunner.executeNextTick()).toBe(true);
    expect(other[other.length - 1].nationalCommandResults).toBeUndefined();
  });
});
