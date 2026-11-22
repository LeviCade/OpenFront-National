/**
 * C3 / Class One / E1 — admitted human Attack becomes a real canonical
 * military consequence, with stale-session and restored execution fencing.
 *
 * This is the real server-owned GameRunner + Executor pipeline. Seat identity
 * comes from TrustedNationalMatch, never from a candidate/browser principal.
 * The sole Game political journal and WarLedger provide all verdicts.
 */
import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import {
  StampedIntentSchema,
  type GameConfig,
} from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it, vi } from "vitest";
import { Client } from "../../src/server/Client";
import { TrustedNationalMatch } from "../../src/server/national/TrustedNationalMatch";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const MATCH = "C2WAR12A";
const EMPIRE = "C2_WAR12_EMPIRE";
const OLD_A = "C2CNTRL01";
const NEW_A = "C2CNTRL02";
const [A, B, C, D, E] = [
  "C2RULERAA",
  "C2MEMBRBB",
  "C2HEIRCCC",
  "C2RIVALDD",
  "C2RIVALEE",
];
const members = [
  new PlayerInfo("Original emperor", PlayerType.Human, OLD_A, A),
  new PlayerInfo("National delegate", PlayerType.Human, "C2SEATB01", B),
  new PlayerInfo("Successor", PlayerType.Human, "C2SEATC01", C),
  new PlayerInfo("Foreign belligerent", PlayerType.Human, "C2SEATD01", D),
  new PlayerInfo("Other sovereign", PlayerType.Human, "C2SEATE01", E),
];

class PrivateHostConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}
function seat(clientID: string, user: string): Client {
  return new Client(
    clientID,
    "persistent-" + clientID,
    {} as NonNullable<Client["claims"]>,
    null,
    undefined,
    "127.0.0.1",
    clientID,
    null,
    { readyState: WebSocket.OPEN } as Client["ws"],
    undefined,
    user,
    [],
  );
}
async function createMatch() {
  const game = await setup(
    "plains",
    { nationalMode: true, gameType: GameType.Private, gameMode: GameMode.FFA },
    members,
    undefined,
    PrivateHostConfig,
  );
  const coords: [number, number][] = [
    [20, 20],
    [80, 20],
    [20, 80],
    [80, 80],
    [50, 50],
  ];
  members.forEach((p, i) => {
    const [x, y] = coords[i];
    game.addExecution(new SpawnExecution(MATCH, p, game.ref(x, y)));
  });
  game.executeNextTick();
  game.executeNextTick();
  for (const p of members) expect(game.player(p.id).hasSpawned()).toBe(true);

  const runner = new GameRunner(
    game,
    new Executor(game, MATCH, undefined),
    () => {},
    undefined,
  );
  const clients = [
    seat(OLD_A, "acct-original"),
    seat("C2SEATB01", "acct-b"),
    seat("C2SEATC01", "acct-c"),
    seat("C2SEATD01", "acct-d"),
    seat("C2SEATE01", "acct-e"),
  ] as const;
  const host = new TrustedNationalMatch(MATCH, runner, clients, () => {});
  return { game, runner, host, clients };
}
type Match = Awaited<ReturnType<typeof createMatch>>;

function admit(m: Match, client: Client, command: Record<string, unknown>) {
  expect(m.host.submit(client, command)).toBe(true);
}
function execute(m: Match) {
  const receipt = m.host.tick();
  expect(receipt.committedIntents).toBeGreaterThan(0);
  m.host.tick();
}
function act(m: Match, index: number, command: Record<string, unknown>) {
  admit(m, m.clients[index], command);
  execute(m);
}
function political(game: Game, actor: string, id: string) {
  const x = game
    .nationalPoliticalCommandResults(game.player(actor))
    .find((r) => r.requestId === id);
  expect(x).toBeDefined();
  return x!;
}
function military(game: Game, actor: string, id: string) {
  const x = game
    .nationalWarCommandResults(game.player(actor))
    .find((r) => r.requestId === id);
  expect(x).toBeDefined();
  return x!;
}
function founder(m: Match) {
  act(m, 0, {
    type: "national_found_empire",
    empireId: EMPIRE,
    requestId: "c2_found_a",
  });
  expect(
    m.game
      .nationalPublicPoliticalView()
      ?.empires.some((e) => e.id === EMPIRE && e.leaderId === A),
  ).toBe(true);
}
function join(m: Match, index: 1 | 2) {
  const id = index === 1 ? B : C;
  act(m, 0, {
    type: "national_offer_empire",
    empireId: EMPIRE,
    candidateId: id,
    requestId: "c2_offer_" + id,
  });
  expect(political(m.game, A, "c2_offer_" + id).accepted).toBe(true);
  act(m, index, {
    type: "national_accept_empire",
    empireId: EMPIRE,
    candidateId: id,
    requestId: "c2_join_" + id,
  });
  expect(political(m.game, id, "c2_join_" + id).accepted).toBe(true);
}
function delegate(memberId: string, enabled: boolean) {
  return {
    type: "national_set_peace_delegation",
    empireId: EMPIRE,
    memberId,
    enabled,
  };
}
function layer(game: Game, warId: string) {
  const item = game.nationalWarState()?.wars.layers.find((x) => x.id === warId);
  expect(item).toBeDefined();
  return item!;
}
function canonical(game: Game) {
  return {
    tick: game.ticks(),
    politics: game.nationalPublicPoliticalView(),
    wars: game.nationalWarState(),
    aPolitical: game.nationalPoliticalCommandResults(game.player(A)),
    aWar: game.nationalWarCommandResults(game.player(A)),
    cPolitical: game.nationalPoliticalCommandResults(game.player(C)),
    cWar: game.nationalWarCommandResults(game.player(C)),
    dWar: game.nationalWarCommandResults(game.player(D)),
  };
}
async function atWar(m: Match) {
  founder(m);
  join(m, 1);
  join(m, 2);
  act(m, 0, {
    type: "national_declare_war",
    scope: "national",
    nationId: B,
    targetId: D,
    targetKind: "nation",
    requestId: "c2_national_b_d",
  });
  const national = military(m.game, A, "c2_national_b_d");
  expect(national.accepted).toBe(true);
  act(m, 0, {
    type: "national_declare_war",
    scope: "imperial",
    nationId: A,
    targetId: D,
    targetKind: "nation",
    requestId: "c2_imperial_e_d",
  });
  const imperial = military(m.game, A, "c2_imperial_e_d");
  expect(imperial.accepted).toBe(true);
  expect(m.game.nationalWarAuthority()?.atWar(A, D)).toBe(true);
  expect(m.game.nationalWarAuthority()?.atWar(B, D)).toBe(true);
  expect(layer(m.game, national.warId!).scope).toBe("national");
  expect(layer(m.game, imperial.warId!).scope).toBe("imperial");
  expect(national.warId).toBeDefined();
  expect(imperial.warId).toBeDefined();
  return { nationalId: national.warId!, imperialId: imperial.warId! };
}

/** Only test geography is seeded; all WAR and combat operations are canonical. */
function front(game: Game, aggressorId: string, defenderId: string) {
  const aggressor = game.player(aggressorId);
  const defender = game.player(defenderId);
  for (let y = 33; y < 45; y++) {
    for (let x = 31; x < 50; x++) aggressor.conquer(game.ref(x, y));
    for (let x = 50; x < 69; x++) defender.conquer(game.ref(x, y));
  }
  game.executeNextTick();
  aggressor.setTroops(750_000);
  defender.setTroops(40_000);
}

/** Distinguishes socket admission, canonical turn commitment and real capture. */
function attackWitness(
  m: Match,
  index: number,
  aggressorId: string,
  defenderId: string,
) {
  const aggressor = m.game.player(aggressorId);
  const defender = m.game.player(defenderId);
  const before = {
    tick: m.game.ticks(),
    troops: aggressor.troops(),
    attackerTiles: aggressor.numTilesOwned(),
    defenderTiles: defender.numTilesOwned(),
  };
  const accepted = m.host.submit(m.clients[index], {
    type: "attack",
    targetID: defenderId,
    troops: 220_000,
    // Browser-provided clientID is discarded by trusted ingress.
    clientID: m.clients[(index + 1) % m.clients.length].clientID,
  });
  expect(accepted).toBe(true);
  const receipt = m.host.tick();
  expect(receipt.committedIntents).toBe(1);
  let observedArmy = aggressor.outgoingAttacks().length > 0;
  for (
    let i = 0;
    i < 40 && aggressor.numTilesOwned() === before.attackerTiles;
    i++
  ) {
    m.host.tick();
    observedArmy ||= aggressor.outgoingAttacks().length > 0;
  }
  const after = {
    tick: m.game.ticks(),
    troops: aggressor.troops(),
    attackerTiles: aggressor.numTilesOwned(),
    defenderTiles: defender.numTilesOwned(),
  };
  expect(observedArmy).toBe(true);
  expect(after.troops).toBeLessThan(before.troops);
  expect(after.attackerTiles).toBeGreaterThan(before.attackerTiles);
  expect(after.defenderTiles).toBeLessThan(before.defenderTiles);
  const witness = {
    kind: "c3-e1-real-combat-v1",
    principals: [A, C, D],
    aggressorId,
    defenderId,
    ingressAccepted: accepted,
    turnCommitted: receipt.committedIntents,
    armyObserved: observedArmy,
    territoryCaptured: after.attackerTiles > before.attackerTiles,
    before,
    after,
    replayDigest: receipt.replayDigest,
    path: "TrustedNationalMatch/GameRunner/Executor/AttackExecution",
  };
  console.info("C3_E1_COMBAT_WITNESS_JSON=" + JSON.stringify(witness));
  return witness;
}

describe("Third Conductor E1 — authoritative attack and succession combat", () => {
  it("turns a real authenticated A attack into actual troops spent and enemy territory captured", async () => {
    const m = await createMatch();
    const { imperialId } = await atWar(m);
    expect(layer(m.game, imperialId).endedTick).toBeNull();
    front(m.game, A, D);
    const witness = attackWitness(m, 0, A, D);
    expect(witness.territoryCaptured).toBe(true);
    expect(m.game.nationalWarAuthority()?.atWar(A, D)).toBe(true);
  });

  it("keeps pending peace and independent wars through A-to-C crown change; successor C attacks authoritatively", async () => {
    const m = await createMatch();
    const { imperialId, nationalId } = await atWar(m);
    act(m, 3, {
      type: "national_propose_peace",
      warId: imperialId,
      requestId: "c3_enemy_peace",
    });
    const motion = military(m.game, D, "c3_enemy_peace");
    expect(motion.accepted).toBe(true);
    act(m, 0, {
      type: "national_transfer_crown",
      empireId: EMPIRE,
      successorId: C,
      requestId: "c3_successor",
    });
    expect(political(m.game, A, "c3_successor").accepted).toBe(true);
    expect(m.game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(C);
    const politicsBefore = m.game.nationalPublicPoliticalView();
    act(m, 0, {
      type: "national_accept_peace",
      motionId: motion.motionId!,
      requestId: "c3_old_imperial_accept",
    });
    expect(military(m.game, A, "c3_old_imperial_accept").accepted).toBe(false);
    expect(m.game.nationalPublicPoliticalView()).toEqual(politicsBefore);
    expect(layer(m.game, imperialId).endedTick).toBeNull();
    expect(layer(m.game, nationalId).endedTick).toBeNull();
    expect(
      m.game
        .nationalWarState()
        ?.wars.motions.some(
          (x) => x.id === motion.motionId && x.acceptedTick === null,
        ),
    ).toBe(true);
    act(m, 2, { ...delegate(B, true), requestId: "c3_c_delegates_b" });
    expect(political(m.game, C, "c3_c_delegates_b").accepted).toBe(true);
    front(m.game, C, D);
    expect(attackWitness(m, 2, C, D).territoryCaptured).toBe(true);
    expect(layer(m.game, imperialId).endedTick).toBeNull();
  });

  it("snapshots a real active invasion with unresolved peace and replays identical battles after restart", async () => {
    const m = await createMatch();
    const { imperialId, nationalId } = await atWar(m);
    act(m, 3, {
      type: "national_propose_peace",
      warId: imperialId,
      requestId: "c3_restart_peace_pending",
    });
    const peace = military(m.game, D, "c3_restart_peace_pending");
    expect(peace.accepted).toBe(true);
    front(m.game, A, D);
    const tilesBeforeAttack = m.game.player(A).numTilesOwned();
    expect(
      m.host.submit(m.clients[0], {
        type: "attack",
        targetID: D,
        troops: 220_000,
      }),
    ).toBe(true);
    expect(m.host.tick().committedIntents).toBe(1);
    expect(m.game.player(A).outgoingAttacks().length).toBeGreaterThan(0);
    const { restored, bytes, again } = await roundTrip(m.game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(m.game));

    const militaryState = (game: Game) => ({
      tick: game.ticks(),
      aTroops: game.player(A).troops(),
      dTroops: game.player(D).troops(),
      aTiles: game.player(A).numTilesOwned(),
      dTiles: game.player(D).numTilesOwned(),
      attacks: game
        .player(A)
        .outgoingAttacks()
        .map((attack) => ({ id: attack.id(), troops: attack.troops() })),
      wars: game.nationalWarState(),
    });
    for (let i = 0; i < 8; i++) {
      m.host.tick();
      restored.executeNextTick();
      expect(militaryState(restored)).toEqual(militaryState(m.game));
    }
    expect(m.game.player(A).numTilesOwned()).toBeGreaterThan(tilesBeforeAttack);
    expect(layer(m.game, imperialId).endedTick).toBeNull();
    expect(layer(m.game, nationalId).endedTick).toBeNull();
    expect(
      m.game
        .nationalWarState()
        ?.wars.motions.some(
          (x) => x.id === peace.motionId && x.acceptedTick === null,
        ),
    ).toBe(true);
    console.info(
      "C3_E1_RESTART_WITNESS_JSON=" +
        JSON.stringify({
          kind: "c3-e1-in-flight-restart-v1",
          snapshotLength: bytes.length,
          pendingPeace: peace.motionId,
          militaryState: militaryState(m.game),
          source: "GameSnapshot/restoreGame/real AttackExecution",
        }),
    );
  });

  it("blocks a queued OLD-session human Attack before troop debit, identically after canonical snapshot restore", async () => {
    const m = await createMatch();
    await atWar(m);
    front(m.game, A, D);
    const oldAttack = new Executor(m.game, MATCH, undefined).createExec(
      StampedIntentSchema.parse({
        type: "attack",
        targetID: D,
        troops: 220_000,
        clientID: OLD_A,
      }),
    );
    m.game.addExecution(oldAttack);
    const { restored, bytes, again } = await roundTrip(m.game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(m.game));
    m.game.takeoverPlayer(m.game.player(A), NEW_A);
    restored.takeoverPlayer(restored.player(A), NEW_A);
    const oldTiles = m.game.player(A).numTilesOwned();
    const oldDebit = vi.spyOn(m.game.player(A), "removeTroops");
    const restoredDebit = vi.spyOn(restored.player(A), "removeTroops");
    m.game.executeNextTick();
    restored.executeNextTick();
    expect(oldDebit).not.toHaveBeenCalled();
    expect(restoredDebit).not.toHaveBeenCalled();
    oldDebit.mockRestore();
    restoredDebit.mockRestore();
    expect(m.game.player(A).numTilesOwned()).toBe(oldTiles);
    expect(m.game.player(A).outgoingAttacks()).toHaveLength(0);
    expect(restored.player(A).outgoingAttacks()).toHaveLength(0);
    expect(canonical(restored)).toEqual(canonical(m.game));
    expect(
      m.host.submit(m.clients[0], {
        type: "attack",
        targetID: D,
        troops: 220_000,
      }),
    ).toBe(false);
    for (const client of m.clients) m.host.revokeRecipient(client);
    const successor = seat(NEW_A, "acct-replacement");
    const replacementHost = new TrustedNationalMatch(
      MATCH,
      m.runner,
      [successor, ...m.clients.slice(1)],
      () => {},
    );
    expect(
      replacementHost.submit(successor, {
        type: "attack",
        targetID: D,
        troops: 220_000,
      }),
    ).toBe(true);
    const beforeTroops = m.game.player(A).troops();
    replacementHost.tick();
    replacementHost.tick();
    expect(m.game.player(A).troops()).toBeLessThan(beforeTroops);
  });

  it("revokes socket-disconnected pending Attack and refuses forged seat identity", async () => {
    const m = await createMatch();
    await atWar(m);
    front(m.game, A, D);
    expect(
      m.host.submit({ ...m.clients[0] } as Client, {
        type: "attack",
        targetID: D,
        troops: 220_000,
      }),
    ).toBe(false);
    expect(
      m.host.submit(m.clients[0], {
        type: "attack",
        targetID: D,
        troops: 220_000,
      }),
    ).toBe(true);
    const beforeTiles = m.game.player(A).numTilesOwned();
    m.host.revokeRecipient(m.clients[0]);
    expect(
      m.host.submit(m.clients[0], {
        type: "attack",
        targetID: D,
        troops: 220_000,
      }),
    ).toBe(false);
    expect(m.host.tick().committedIntents).toBe(0);
    m.host.tick();
    expect(m.game.player(A).outgoingAttacks()).toHaveLength(0);
    expect(m.game.player(A).numTilesOwned()).toBe(beforeTiles);
  });
});
