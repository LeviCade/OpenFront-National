/**
 * R10 E2: executed NATIONAL match, not a standalone war simulation.
 * Every command crosses the ordinary GameRunner -> Executor path.
 * Army balances, political layers and defensive debits come only from Game.
 */
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import type { Game } from "@openfront/engine/game/Game";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const gameID = "r10-live-combat";
const humans = [
  new PlayerInfo("Alpha", PlayerType.Human, "R10ALPHA1", "R10ATK01"),
  new PlayerInfo("Bravo", PlayerType.Human, "R10BRAVO1", "R10DEF01"),
  new PlayerInfo("Charlie", PlayerType.Human, "R10CHARL1", "R10SUP01"),
  new PlayerInfo("Delta", PlayerType.Human, "R10DELTA1", "R10SUP02"),
];
const [A, B, C, D] = humans.map((info) => info.id);
const [clientA, clientB, clientC] = humans.map((info) => info.clientID!);

async function liveGame(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, humans);
  const spawn = [
    [20, 20],
    [80, 20],
    [20, 80],
    [80, 80],
  ];
  for (let i = 0; i < humans.length; i++) {
    game.addExecution(
      new SpawnExecution(
        gameID,
        humans[i],
        game.ref(spawn[i][0], spawn[i][1]),
      ),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  for (const player of humans)
    expect(game.player(player.id).hasSpawned()).toBe(true);

  // Two different real borders, so the same player can attack two fronts.
  for (let y = 30; y < 46; y++) {
    for (let x = 30; x < 50; x++) game.player(A).conquer(game.ref(x, y));
    for (let x = 50; x < 70; x++) game.player(B).conquer(game.ref(x, y));
  }
  for (let y = 60; y < 72; y++) {
    for (let x = 30; x < 50; x++) game.player(A).conquer(game.ref(x, y));
    for (let x = 50; x < 70; x++) game.player(C).conquer(game.ref(x, y));
  }
  // Join every artificial front to its actual spawned capital. Otherwise
  // PlayerExecution's normal cluster pruning could reclaim detached test
  // rectangles during the later, genuine peace and replay ticks.
  for (let x = 20; x <= 30; x++) game.player(A).conquer(game.ref(x, 20));
  for (let y = 20; y < 72; y++) game.player(A).conquer(game.ref(30, y));
  for (let x = 70; x <= 80; x++) game.player(B).conquer(game.ref(x, 20));
  for (let y = 20; y < 46; y++) game.player(B).conquer(game.ref(70, y));
  for (let x = 20; x <= 60; x++) game.player(C).conquer(game.ref(x, 80));
  for (let y = 71; y <= 80; y++) game.player(C).conquer(game.ref(60, y));
  game.executeNextTick();
  game.player(A).setTroops(500_000);
  game.player(B).setTroops(250_000);
  game.player(C).setTroops(500_000);
  game.player(D).setTroops(500_000);
  return game;
}

function pact(game: Game, defenderId: string, id: string, donors: string[]) {
  const defender = game.player(defenderId);
  game.performNationalCommand(defender, {
    kind: "found-pact",
    pactId: id,
    pactKind: "MDA",
    name: id,
    terms: { admission: "leader", expulsion: "forbidden" },
  });
  for (const donor of donors) {
    game.performNationalCommand(defender, {
      kind: "invite-pact",
      pactId: id,
      candidateId: donor,
    });
    game.performNationalCommand(game.player(donor), {
      kind: "accept-pact",
      pactId: id,
    });
  }
}

type Click = Record<string, unknown>;
function runner(game: Game) {
  const errors: string[] = [];
  const engine = new GameRunner(
    game,
    new Executor(game, gameID, undefined),
    (packet) => {
      if ("errMsg" in packet) errors.push(String(packet.errMsg));
    },
    clientA,
  );
  return { engine, errors };
}

function turn(game: Game, runner: GameRunner, ...clicks: Click[]) {
  runner.addTurn({
    turnNumber: game.ticks(),
    intents: clicks.map((click) => StampedIntentSchema.parse(click)),
  });
  expect(runner.executeNextTick()).toBe(true);
}

function war(targetId: string, requestId: string, clientID = clientA) {
  return {
    type: "national_declare_war",
    scope: "national",
    nationId: A,
    targetId,
    targetKind: "nation",
    requestId,
    clientID,
  };
}

function attack(targetID: string, troops = 180_000, clientID = clientA) {
  return { type: "attack", targetID, troops, clientID };
}

function peaceMotion(game: Game, warId: string): string {
  const motion = game
    .nationalWarState()
    ?.wars.motions.find((item) => item.layerId === warId);
  expect(motion).toBeDefined();
  return motion!.id;
}

function stateBytes(game: Game): number[] {
  return [...snapshotGame(game)];
}

describe("R10 E2 actual GameRunner NATIONAL war, MDA and peace", () => {
  it("executes human WAR -> ordinary map assault -> casualties/territory -> rejected and accepted peace -> snapshot/replay", async () => {
    const game = await liveGame();
    pact(game, B, "r10-defense-bravo", [C, D]);
    expect(game.nationalMdaAllies(B)).toEqual([C, D]);
    const { engine, errors } = runner(game);

    // First prove it is impossible to attack a neutral nation or buy an MDA
    // charge before a canonical declaration, even with an authenticated click.
    const prewarTroops = game.player(A).troops();
    const prewarDonors = [C, D].map((id) => game.player(id).troops());
    const prewar = new AttackExecution(80_000, game.player(A), B);
    prewar.init(game, game.ticks());
    expect(prewar.isActive()).toBe(false);
    expect(game.player(A).troops()).toBe(prewarTroops);
    expect([C, D].map((id) => game.player(id).troops())).toEqual(
      prewarDonors,
    );
    expect(game.nationalWarState()!.levy.processed).toEqual([]);

    turn(game, engine, war(B, "r10-declare"));
    turn(game, engine);
    const declaration = game
      .nationalWarCommandResults(game.player(A))
      .find((item) => item.requestId === "r10-declare");
    expect(declaration).toMatchObject({
      accepted: true,
      actorId: A,
      recipientId: A,
      commandKind: "national_declare_war",
    });
    const warId = declaration!.warId!;
    expect(game.nationalWarAuthority()!.authorizeOffensiveAction(A, B)).toBe(
      true,
    );

    // Compare to a fully restored idle twin: normal PlayerExecution regen
    // continues in both, while ONLY the attack twin may debit donors.
    const { restored: idle } = await roundTrip(game, "plains");
    const { engine: idleEngine, errors: idleErrors } = runner(idle);
    const beforeTiles = [
      game.player(A).numTilesOwned(),
      game.player(B).numTilesOwned(),
    ];
    turn(game, engine, attack(B));
    turn(idle, idleEngine);
    turn(game, engine);
    turn(idle, idleEngine);

    const ledger = game.nationalWarState()!.levy;
    expect(ledger.processed).toHaveLength(1);
    const receipt = ledger.processed[0].result;
    expect(receipt.application).toBe("applied");
    expect(receipt.intercepted).toBeGreaterThan(0);
    expect(receipt.remainingAttackingTroops).toBeGreaterThan(0);
    expect(receipt.intercepted + receipt.remainingAttackingTroops).toBe(
      receipt.attackTroopsBefore,
    );
    expect(receipt.contributions.map((item) => item.nationId)).toEqual([C, D]);
    expect(
      receipt.contributions.reduce((sum, item) => sum + item.troopsDebited, 0),
    ).toBe(receipt.intercepted);
    for (const contributor of receipt.contributions) {
      // Comparison is against the same actual PlayerImpl tick/regen in the
      // idle twin, not a fabricated donor balance or mock transaction port.
      expect(game.player(contributor.nationId).troops()).toBeLessThan(
        idle.player(contributor.nationId).troops(),
      );
    }

    for (let i = 0; i < 6; i++) {
      turn(game, engine);
      turn(idle, idleEngine);
    }
    expect(game.player(A).numTilesOwned()).toBeGreaterThan(beforeTiles[0]);
    expect(game.player(B).numTilesOwned()).toBeLessThan(beforeTiles[1]);
    // Troops regenerate during every real tick. Compare the defender to its
    // identical no-combat twin, never to a fixed prebattle troop constant.
    expect(game.player(B).troops()).toBeLessThan(idle.player(B).troops());

    // Rejected same-side peace cannot end the war. The other belligerent
    // must accept through the exact same authenticated GameRunner path.
    turn(game, engine, {
      type: "national_propose_peace",
      warId,
      requestId: "r10-propose",
      clientID: clientA,
    });
    turn(game, engine);
    const motionId = peaceMotion(game, warId);
    turn(game, engine, {
      type: "national_accept_peace",
      motionId,
      requestId: "r10-wrong-side",
      clientID: clientA,
    });
    turn(game, engine);
    expect(
      game.nationalWarCommandResults(game.player(A))
        .find((row) => row.requestId === "r10-wrong-side")?.accepted,
    ).toBe(false);
    expect(game.nationalWarAuthority()!.atWar(A, B)).toBe(true);

    turn(game, engine, {
      type: "national_accept_peace",
      motionId,
      requestId: "r10-bilateral-accept",
      clientID: clientB,
    });
    turn(game, engine);
    expect(
      game.nationalWarCommandResults(game.player(B))
        .find((row) => row.requestId === "r10-bilateral-accept")?.accepted,
    ).toBe(true);
    expect(game.nationalWarAuthority()!.atWar(A, B)).toBe(false);

    // Existing attack retreats, and a new click after peace cannot spend MDA
    // resources, create an attack or change the canonical levy ledger.
    for (let i = 0; i < 3; i++) turn(game, engine);
    const stoppedTiles = game.player(B).numTilesOwned();
    const previousLevy = game.nationalWarState()!.levy;
    turn(game, engine, attack(B, 90_000));
    turn(game, engine);
    turn(game, engine);
    expect(game.player(B).numTilesOwned()).toBe(stoppedTiles);
    expect(game.nationalWarState()!.levy).toEqual(previousLevy);
    expect(game.player(A).outgoingAttacks()).toHaveLength(0);

    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    const { engine: replayRunner, errors: replayErrors } = runner(restored);
    for (let i = 0; i < 5; i++) {
      turn(game, engine);
      turn(restored, replayRunner);
      expect(stateBytes(restored)).toEqual(stateBytes(game));
    }
    expect(errors).toEqual([]);
    expect(idleErrors).toEqual([]);
    expect(replayErrors).toEqual([]);
  });

  it("rejects forged client identities, foreign WAR claims, reused tokens and zero-strength attacks without creating armies", async () => {
    const game = await liveGame();
    pact(game, B, "r10-rejections", [D]);
    const { engine, errors } = runner(game);
    turn(game, engine, war(B, "r10-forged", "R10FORGE1"));
    turn(game, engine);
    expect(game.nationalWarState()!.wars.layers).toHaveLength(0);

    // Stamped actor B may not claim to command A's military or its nation.
    turn(game, engine, war(B, "r10-foreign-claim", clientB));
    turn(game, engine);
    expect(game.nationalWarState()!.wars.layers).toHaveLength(0);
    expect(
      game.nationalWarCommandResults(game.player(B))
        .find((row) => row.requestId === "r10-foreign-claim")?.accepted,
    ).toBe(false);

    turn(game, engine, war(B, "r10-valid"));
    turn(game, engine);
    const originalWars = game.nationalWarState()!.wars.layers;
    turn(game, engine, war(C, "r10-valid")); // same token, changed command
    turn(game, engine);
    expect(game.nationalWarState()!.wars.layers).toEqual(originalWars);
    expect(game.nationalWarAuthority()!.atWar(A, C)).toBe(false);

    for (const troops of [0, 0.5, -1, Number.NaN, Infinity]) {
      // Bypass the validated network schema to exercise the runtime itself.
      const balance = game.player(A).troops();
      const donors = game.player(D).troops();
      const ledger = game.nationalWarState()!.levy;
      const attempt = new AttackExecution(troops, game.player(A), B);
      attempt.init(game, game.ticks());
      expect(attempt.isActive()).toBe(false);
      expect(game.player(A).troops()).toBe(balance);
      expect(game.player(D).troops()).toBe(donors);
      expect(game.nationalWarState()!.levy).toEqual(ledger);
      expect(game.player(A).outgoingAttacks()).toHaveLength(0);
    }
    // Stale motion cannot close a living WAR; it must not take down a tick.
    turn(game, engine, {
      type: "national_accept_peace",
      motionId: "unknown-motion",
      clientID: clientC,
      requestId: "r10-stale-motion",
    });
    turn(game, engine);
    expect(game.nationalWarAuthority()!.atWar(A, B)).toBe(true);
    expect(errors).toEqual([]);
  });

  it("charges one shared living donor across two concurrent legal fronts without duplicate balances or allowance refresh", async () => {
    const game = await liveGame();
    pact(game, B, "r10-bravo-shared", [D]);
    pact(game, C, "r10-charlie-shared", [D]);
    const { engine, errors } = runner(game);
    turn(game, engine, war(B, "r10-front-b"), war(C, "r10-front-c"));
    turn(game, engine);
    expect(game.nationalWarAuthority()!.atWar(A, B)).toBe(true);
    expect(game.nationalWarAuthority()!.atWar(A, C)).toBe(true);
    expect(game.nationalMdaAllies(B)).toEqual([D]);
    expect(game.nationalMdaAllies(C)).toEqual([D]);

    const donorBefore = game.player(D).troops();
    turn(game, engine, attack(B, 100_000), attack(C, 100_000));
    turn(game, engine);
    const levy = game.nationalWarState()!.levy;
    expect(levy.processed).toHaveLength(2);
    const charged = levy.processed.reduce(
      (sum, row) => sum + row.result.intercepted,
      0,
    );
    expect(charged).toBeGreaterThan(0);
    expect(
      levy.processed.every(
        (row) =>
          row.result.application === "applied" &&
          row.result.contributions.length === 1 &&
          row.result.contributions[0].nationId === D,
      ),
    ).toBe(true);
    expect(
      levy.allowances.every(
        (row) => row.spent >= 0 && row.spent <= row.limit,
      ),
    ).toBe(true);
    expect(levy.allowances).toHaveLength(2);
    expect(game.player(D).troops()).toBeLessThan(donorBefore);

    // Settling only the Bravo layer cannot outlaw Charlie combat. Both
    // wars exist independently in the same canonical Game WAR authority.
    const bravoWar = game
      .nationalWarCommandResults(game.player(A))
      .find((row) => row.requestId === "r10-front-b")?.warId;
    expect(bravoWar).toBeDefined();
    turn(game, engine, {
      type: "national_propose_peace",
      warId: bravoWar,
      requestId: "r10-front-b-peace",
      clientID: clientA,
    });
    turn(game, engine);
    const motionId = peaceMotion(game, bravoWar!);
    turn(game, engine, {
      type: "national_accept_peace",
      motionId,
      requestId: "r10-front-b-accepted",
      clientID: clientB,
    });
    turn(game, engine);
    expect(game.nationalWarAuthority()!.atWar(A, B)).toBe(false);
    expect(game.nationalWarAuthority()!.atWar(A, C)).toBe(true);
    const beforeMoreCombat = game.nationalWarState()!.levy.processed.length;
    turn(game, engine, attack(B, 20_000), attack(C, 20_000));
    turn(game, engine);
    // The peacetime B click cannot spend anything; the surviving C layer
    // still accepts its ordinary map assault and records one actual event.
    expect(game.nationalWarState()!.levy.processed).toHaveLength(
      beforeMoreCombat + 1,
    );
    const { bytes, restored, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    expect(restored.player(D).troops()).toBe(game.player(D).troops());
    expect(errors).toEqual([]);
  });
});
