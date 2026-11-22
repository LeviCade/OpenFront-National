import { createHash } from "node:crypto";
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationalFoundEmpireExecution } from "@openfront/engine/execution/NationalFoundEmpireExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import type { NationalCommand } from "@openfront/engine/national/NationalRuntime";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig, UseRealAttackLogic } from "../util/TestConfig";

const MATCH = "C4E1MATCH";
const EMPIRE = "c4-e1-empire";
const PACT = "c4-e1-mda";
const infos = [
  new PlayerInfo("Alpha", PlayerType.Human, "C4SEATA01", "C4ALPHA01"),
  new PlayerInfo("Bravo", PlayerType.Human, "C4SEATB01", "C4BRAVO01"),
  new PlayerInfo("Charlie", PlayerType.Human, "C4SEATC01", "C4CHARL01"),
  new PlayerInfo("Delta", PlayerType.Human, "C4SEATD01", "C4DELTA01"),
];
const [A, B, C, D] = infos.map((p) => p.id);
type Click = Record<string, unknown>;

function runner(game: Game) {
  const errors: string[] = [];
  const engine = new GameRunner(
    game,
    new Executor(game, MATCH, undefined),
    (packet) => {
      if ("errMsg" in packet) errors.push(String(packet.errMsg));
    },
    undefined,
  );
  return { engine, errors };
}

type Match = Awaited<ReturnType<typeof spawned>>;
function tick(m: { game: Game; engine: GameRunner }, ...clicks: Click[]) {
  m.engine.addTurn({
    turnNumber: m.game.ticks(),
    intents: clicks.map((click) => StampedIntentSchema.parse(click)),
  });
  expect(m.engine.executeNextTick()).toBe(true);
}

function clicks(m: Match, ...commands: Click[]) {
  tick(m, ...commands);
  tick(m);
}

function wait(m: Match, count: number) {
  for (let i = 0; i < count; i++) tick(m);
}

function stamped(id: string, fields: Click): Click {
  return {
    ...fields,
    clientID: infos.find((p) => p.id === id)!.clientID!,
  };
}

function attack(actor: string, targetID: string | null, troops: number) {
  return stamped(actor, { type: "attack", targetID, troops });
}

function winner(game: Game) {
  const w = game.getWinner();
  return typeof w === "string" ? w : (w?.id() ?? null);
}

async function spawned(
  config: typeof TestConfig,
  spots: readonly (readonly [number, number])[],
  nationalMode = true,
) {
  const game = await setup(
    "plains",
    { nationalMode },
    infos,
    undefined,
    config,
  );
  const m = { game, ...runner(game) };
  m.engine.init();
  for (let i = 0; i < infos.length; i++) {
    const [x, y] = spots[i];
    game.addExecution(new SpawnExecution(MATCH, infos[i], game.ref(x, y)));
  }
  wait(m, 3);
  for (const info of infos) {
    expect(game.player(info.id).hasSpawned()).toBe(true);
  }
  expect(winner(game)).toBeNull();
  return m;
}

function political(m: Match, id: string, requestId: string) {
  const receipt = m.game
    .nationalPoliticalCommandResults(m.game.player(id))
    .find((row) => row.requestId === requestId);
  expect(receipt).toBeDefined();
  return receipt!;
}

function military(m: Match, id: string, requestId: string) {
  const receipt = m.game
    .nationalWarCommandResults(m.game.player(id))
    .find((row) => row.requestId === requestId);
  expect(receipt).toBeDefined();
  return receipt!;
}

/**
 * Pact transport is absent at the founding SHA: the actual authenticated
 * political execution exists, is snapshotted and commits actor-only receipts.
 * Schedule that execution; do not invent a wire command or mutate the roster.
 */
function pactCommand(
  m: Match,
  actor: string,
  command: Exclude<NationalCommand, { kind: "found-empire" }>,
  requestId: string,
) {
  m.game.addExecution(
    new NationalFoundEmpireExecution(
      m.game.player(actor),
      "",
      command,
      requestId,
      infos.find((p) => p.id === actor)!.clientID!,
    ),
  );
  wait(m, 2);
  expect(political(m, actor, requestId).accepted).toBe(true);
}

function join(m: Match, emperor: string, member: string) {
  const offer = "offer-" + member;
  clicks(
    m,
    stamped(emperor, {
      type: "national_offer_empire",
      empireId: EMPIRE,
      candidateId: member,
      requestId: offer,
    }),
  );
  expect(political(m, emperor, offer).accepted).toBe(true);
  const consent = "consent-" + member;
  clicks(
    m,
    stamped(member, {
      type: "national_accept_empire",
      empireId: EMPIRE,
      candidateId: member,
      requestId: consent,
    }),
  );
  expect(political(m, member, consent).accepted).toBe(true);
}

function declare(
  m: Match,
  actor: string,
  nationId: string,
  targetId: string,
  scope: "national" | "imperial",
  requestId: string,
) {
  clicks(
    m,
    stamped(actor, {
      type: "national_declare_war",
      nationId,
      targetId,
      targetKind: "nation",
      scope,
      requestId,
    }),
  );
  const receipt = military(m, actor, requestId);
  expect(receipt.accepted).toBe(true);
  expect(receipt.warId).toBeDefined();
  return receipt.warId!;
}

function stopExpansion(m: Match, actors: readonly string[]) {
  const cancels = actors.flatMap((actor) =>
    m.game.player(actor).outgoingAttacks().map((army) =>
      stamped(actor, { type: "cancel_attack", attackID: army.id() }),
    ),
  );
  if (cancels.length > 0) clicks(m, ...cancels);
  wait(m, 25);
}

function balances(game: Game) {
  return infos.map(({ id }) => {
    const p = game.player(id);
    return {
      id,
      tiles: p.numTilesOwned(),
      reserves: p.troops(),
      armies: p.outgoingAttacks().map((a) => ({
        id: a.id(),
        troops: a.troops(),
      })),
    };
  });
}

function digest(game: Game) {
  return createHash("sha256").update(snapshotGame(game)).digest("hex");
}

function layer(m: Match, id: string) {
  const war = m.game.nationalWarState()?.wars.layers.find((w) => w.id === id);
  expect(war).toBeDefined();
  return war!;
}

describe("C4 E1 actual last-sovereign engine", () => {
  it("WAR-01/SOV-01: a tiny defender is not handed to a peaceful neighbor by a single combat tick", async () => {
    const m = await spawned(TestConfig, [
      [20, 20],
      [28, 20],
      [36, 20],
      [75, 75],
    ]);
    const a = m.game.player(A);
    const b = m.game.player(B);
    const c = m.game.player(C);
    expect(a.sharesBorderWith(b)).toBe(true);
    expect(c.sharesBorderWith(b)).toBe(true);
    expect(b.numTilesOwned()).toBeLessThan(100);
    declare(m, A, A, B, "national", "frontier-war");
    const before = balances(m.game);
    const neutralTiles = [...c.tiles()].sort((x, y) => x - y);
    const defendingTiles = b.numTilesOwned();
    clicks(m, attack(A, B, 5_000));
    expect(b.isAlive()).toBe(true);
    expect(b.numTilesOwned()).toBe(defendingTiles - 1);
    expect([...c.tiles()].sort((x, y) => x - y)).toEqual(neutralTiles);
    expect(m.game.nationalWarAuthority()?.atWar(C, B)).toBe(false);
    expect(winner(m.game)).toBeNull();
    expect(m.errors).toEqual([]);
    console.info(
      "C4_E1_SMALL_SOVEREIGN_JSON=" +
        JSON.stringify({ before, after: balances(m.game), digest: digest(m.game) }),
    );
  });

  it("SOV-03/04, WAR-04/12, LEVY-04: real spawn-to-crown-to-conquest match with eight-tick replay", async () => {
    const m = await spawned(UseRealAttackLogic, [
      [20, 20],
      [36, 20],
      [28, 39],
      [75, 75],
    ]);
    const { game } = m;
    const a = game.player(A);
    const b = game.player(B);
    const c = game.player(C);
    const d = game.player(D);
    for (const id of [A, B, C, D]) {
      expect(game.nationalPoliticalAuthority()?.empireOf(id)).toBeNull();
    }

    // Ordinary, paid land expansion; no conquer(), setTroops() or injected
    // ledger state anywhere in this complete journey.
    clicks(m, attack(C, null, 15_000));
    for (let i = 0; i < 60 && c.numTilesOwned() < 450; i++) tick(m);
    expect(c.numTilesOwned()).toBeGreaterThanOrEqual(450);
    stopExpansion(m, [C]);
    clicks(m, attack(A, null, 15_000), attack(B, null, 15_000));
    for (
      let i = 0;
      i < 90 && (!a.sharesBorderWith(c) || !b.sharesBorderWith(c));
      i++
    ) {
      tick(m);
    }
    stopExpansion(m, [A, B]);
    expect(a.sharesBorderWith(c)).toBe(true);
    expect(b.sharesBorderWith(c)).toBe(true);
    expect(c.isAlive()).toBe(true);

    pactCommand(
      m,
      C,
      {
        kind: "found-pact",
        pactId: PACT,
        name: "Common defense",
        pactKind: "MDA",
        terms: { admission: "leader", expulsion: "forbidden" },
      },
      "mda-found",
    );
    pactCommand(
      m,
      C,
      { kind: "invite-pact", pactId: PACT, candidateId: D },
      "mda-invite",
    );
    pactCommand(m, D, { kind: "accept-pact", pactId: PACT }, "mda-accept");
    expect(game.nationalMdaAllies(C)).toEqual([D]);

    clicks(
      m,
      stamped(A, {
        type: "national_found_empire",
        empireId: EMPIRE,
        requestId: "empire-found",
      }),
    );
    expect(game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(A);
    join(m, A, B);

    // Grow only normal national reserves until the defense donor can pay.
    for (
      let i = 0;
      i < 500 && d.troops() < game.config().maxTroops(d) * 0.4;
      i++
    ) {
      tick(m);
    }
    expect(d.troops()).toBeGreaterThan(game.config().maxTroops(d) * 0.3);
    expect(winner(game)).toBeNull();

    const national = declare(m, A, B, C, "national", "bravo-national-war");
    const imperial = declare(m, A, A, C, "imperial", "empire-war");
    expect(layer(m, national).scope).toBe("national");
    expect(layer(m, imperial).scope).toBe("imperial");

    const before = balances(game);
    const idle = await roundTrip(game, "plains");
    const twin = { game: idle.restored, ...runner(idle.restored) };
    tick(m, attack(A, C, 10_000), attack(B, C, 10_000));
    tick(twin);
    const levy = game.nationalWarState()!.levy;
    const receipts = levy.processed.map((row) => row.result);
    expect(receipts).toHaveLength(2);
    const debits = receipts.reduce((sum, receipt) => sum + receipt.intercepted, 0);
    expect(debits).toBeGreaterThan(0);
    for (const receipt of receipts) {
      expect(receipt.intercepted + receipt.remainingAttackingTroops).toBe(
        receipt.attackTroopsBefore,
      );
      expect(receipt.contributions.reduce((sum, x) => sum + x.troopsDebited, 0)).toBe(
        receipt.intercepted,
      );
      expect(receipt.contributions.every((x) => x.nationId === D)).toBe(true);
    }
    expect(twin.game.player(D).troops() - d.troops()).toBe(debits);
    const firstCapture = c.numTilesOwned();
    tick(m);
    expect(c.numTilesOwned()).toBeLessThan(firstCapture);

    clicks(
      m,
      stamped(C, {
        type: "national_propose_peace",
        warId: imperial,
        requestId: "rival-peace",
      }),
    );
    const peace = military(m, C, "rival-peace");
    expect(peace.accepted).toBe(true);
    expect(c.isAlive()).toBe(true);
    expect(a.outgoingAttacks().length + b.outgoingAttacks().length).toBeGreaterThan(0);

    const active = await roundTrip(game, "plains");
    expect(active.again).toEqual(active.bytes);
    const restored = { game: active.restored, ...runner(active.restored) };
    const commitments: string[] = [];
    for (let i = 0; i < 8; i++) {
      tick(m);
      tick(restored);
      expect(balances(restored.game)).toEqual(balances(game));
      expect(restored.game.nationalWarState()).toEqual(game.nationalWarState());
      expect(restored.game.nationalPublicPoliticalView()).toEqual(game.nationalPublicPoliticalView());
      const current = digest(game);
      expect(digest(restored.game)).toBe(current);
      commitments.push(current);
    }
    expect(restored.errors).toEqual([]);
    expect(c.isAlive()).toBe(true);

    clicks(
      m,
      stamped(A, {
        type: "national_transfer_crown",
        empireId: EMPIRE,
        successorId: B,
        requestId: "crown-to-bravo",
      }),
    );
    expect(political(m, A, "crown-to-bravo").accepted).toBe(true);
    expect(game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(B);
    clicks(
      m,
      stamped(A, {
        type: "national_accept_peace",
        motionId: peace.motionId!,
        requestId: "stale-crown",
      }),
    );
    expect(military(m, A, "stale-crown").accepted).toBe(false);
    expect(layer(m, imperial).endedTick).toBeNull();

    clicks(m, attack(B, C, 5_000));
    const repeat = game.nationalWarState()!.levy;
    expect(repeat.processed.length).toBeGreaterThan(receipts.length);
    expect(repeat.allowances.every((row) => row.spent <= row.limit)).toBe(true);
    clicks(
      m,
      stamped(B, {
        type: "national_accept_peace",
        motionId: peace.motionId!,
        requestId: "lawful-peace",
      }),
    );
    expect(military(m, B, "lawful-peace").accepted).toBe(true);
    expect(layer(m, imperial).endedTick).not.toBeNull();
    expect(layer(m, national).endedTick).toBeNull();
    expect(game.nationalWarAuthority()?.atWar(A, C)).toBe(false);
    expect(game.nationalWarAuthority()?.atWar(B, C)).toBe(true);
    wait(m, 2);
    expect(a.outgoingAttacks()).toHaveLength(0);

    // Consent, not annexation: the donor becomes an imperial member and its
    // former MDA membership ends. The surviving rival remains independent.
    join(m, B, D);
    expect(game.nationalMdaAllies(C)).toEqual([]);
    expect(game.nationalPoliticalAuthority()?.empireOf(C)).toBeNull();
    expect(c.isAlive()).toBe(true);
    wait(m, 12);
    expect(winner(game)).toBeNull();
    expect(game.nationalVictoryRoster()).toBeNull();

    // Win via repeated real attacks and normal regeneration, never by
    // removing tiles directly or invoking WinCheck manually.
    const finalCampaigns: number[] = [];
    for (let campaign = 0; campaign < 30 && c.isAlive(); campaign++) {
      if (b.troops() < 20_000) wait(m, 50);
      const troops = Math.floor(b.troops() * 0.75);
      finalCampaigns.push(troops);
      expect(b.sharesBorderWith(c)).toBe(true);
      clicks(m, attack(B, C, troops));
      wait(m, 30);
    }
    expect(c.numTilesOwned()).toBe(0);
    expect(c.isAlive()).toBe(false);
    wait(m, 12);
    expect(winner(game)).toBe(B);
    expect(game.nationalVictoryRoster()?.prizes).toEqual([
      { kind: "ImperialVictor", nationId: B, empireId: EMPIRE },
      { kind: "EmpireVictor", nationId: A, empireId: EMPIRE },
      { kind: "EmpireVictor", nationId: D, empireId: EMPIRE },
    ]);
    expect(m.errors).toEqual([]);
    console.info(
      "C4_E1_COMPLETE_MATCH_JSON=" +
        JSON.stringify({
          scenario: "SOV-03/04 WAR-04/12 LEVY-04",
          before,
          after: balances(game),
          ticks: game.ticks(),
          firstLevy: receipts,
          donorDebit: debits,
          replayCommitments: commitments,
          finalCampaigns,
          winner: winner(game),
          prizes: game.nationalVictoryRoster()?.prizes,
          digest: digest(game),
        }),
    );
  }, 120_000);
});
