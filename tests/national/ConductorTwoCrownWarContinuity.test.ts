/**
 * C2 / Class One / E1 — WAR-12 sovereign transition with outstanding real
 * national+imperial wars, hostile queued commands and immutable request receipts.
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
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
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
    {} as Client["ws"],
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
  const host = new TrustedNationalMatch(
    MATCH,
    runner,
    clients,
    () => {},
  );
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
    m.game.nationalPublicPoliticalView()?.empires.some(
      (e) => e.id === EMPIRE && e.leaderId === A,
    ),
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
  expect(layer(m.game, national.warId).scope).toBe("national");
  expect(layer(m.game, imperial.warId).scope).toBe("imperial");
  return { nationalId: national.warId, imperialId: imperial.warId };
}

describe("Conductor Two E1 — WAR-12 incumbent succession and hostile host authority", () => {
  it("keeps both formal war layers and an existing enemy peace motion across A→C crown transfer; rejects A's queued imperial orders while C negotiates lawfully", async () => {
    const m = await createMatch();
    const { nationalId, imperialId } = await atWar(m);
    act(m, 0, { ...delegate(B, true), requestId: "c2_old_delegate" });
    expect(political(m.game, A, "c2_old_delegate").accepted).toBe(true);
    act(m, 3, {
      type: "national_propose_peace",
      warId: imperialId,
      requestId: "c2_enemy_offer",
    });
    const motion = military(m.game, D, "c2_enemy_offer");
    expect(motion.accepted).toBe(true);
    const warsBefore = m.game.nationalWarState()?.wars.layers;
    expect(warsBefore).toHaveLength(2);

    // Order matters: GameRunner executes the queued crown transfer BEFORE
    // A's previously admitted imperial acceptance, declaration, and grant.
    admit(m, m.clients[0], {
      type: "national_transfer_crown",
      empireId: EMPIRE,
      successorId: C,
      requestId: "c2_transfer_to_c",
    });
    admit(m, m.clients[0], {
      type: "national_accept_peace",
      motionId: motion.motionId,
      requestId: "c2_queued_old_imperial_accept",
    });
    admit(m, m.clients[0], {
      type: "national_declare_war",
      scope: "imperial",
      nationId: A,
      targetId: E,
      targetKind: "nation",
      requestId: "c2_queued_old_imperial_war",
    });
    admit(m, m.clients[0], {
      ...delegate(B, false),
      requestId: "c2_queued_old_revoke",
    });
    m.host.tick(); // admission+execution initialization only
    const { restored, bytes, again } = await roundTrip(m.game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(m.game));
    m.host.tick();
    restored.executeNextTick();
    expect(canonical(m.game)).toEqual(canonical(restored));
    expect(political(m.game, A, "c2_transfer_to_c").accepted).toBe(true);
    expect(m.game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(C);
    expect(m.game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(false);
    expect(military(m.game, A, "c2_queued_old_imperial_accept").accepted).toBe(false);
    expect(military(m.game, A, "c2_queued_old_imperial_war").accepted).toBe(false);
    expect(political(m.game, A, "c2_queued_old_revoke").accepted).toBe(false);
    expect(m.game.nationalWarState()?.wars.layers).toEqual(warsBefore);
    expect(layer(m.game, nationalId).endedTick).toBeNull();
    expect(layer(m.game, imperialId).endedTick).toBeNull();
    expect(
      m.game.nationalWarState()?.wars.motions.find(
        (x) => x.id === motion.motionId,
      )?.acceptedTick,
    ).toBeNull();

    act(m, 2, {
      type: "national_accept_peace",
      motionId: motion.motionId,
      requestId: "c2_successor_accept",
    });
    const lawful = military(m.game, C, "c2_successor_accept");
    expect(lawful.accepted).toBe(true);
    expect(layer(m.game, imperialId).endedTick).not.toBeNull();
    expect(layer(m.game, nationalId).endedTick).toBeNull();
    expect(m.game.nationalWarAuthority()?.atWar(A, D)).toBe(false);
    expect(m.game.nationalWarAuthority()?.atWar(B, D)).toBe(true);

    // C may delegate B's own national peace, never empire-wide authority.
    act(m, 2, { ...delegate(B, true), requestId: "c2_c_delegates_b" });
    expect(political(m.game, C, "c2_c_delegates_b").accepted).toBe(true);
    act(m, 1, {
      type: "national_propose_peace",
      warId: nationalId,
      requestId: "c2_b_national_offer",
    });
    const nationalMotion = military(m.game, B, "c2_b_national_offer");
    expect(nationalMotion.accepted).toBe(true);
    act(m, 3, {
      type: "national_accept_peace",
      motionId: nationalMotion.motionId,
      requestId: "c2_d_national_accept",
    });
    expect(military(m.game, D, "c2_d_national_accept").accepted).toBe(true);
    expect(layer(m.game, nationalId).endedTick).not.toBeNull();
  });

  it("denies old A's formerly accepted imperial and constitutional receipts after crown loss while preserving lawful same-ruler idempotence", async () => {
    const m = await createMatch();
    const { imperialId } = await atWar(m);
    const before = snapshotGameData(m.game);
    const first = m.game.performNationalWarCommandWithOutcome(
      m.game.player(A),
      {
        kind: "declare-imperial",
        warId: "c2_idempotent_war_id",
        aggressor: { kind: "empire", id: EMPIRE },
        target: { kind: "nation", id: D },
      },
      "c2_imperial_e_d",
      OLD_A,
    );
    expect(first.accepted).toBe(true);
    expect(first.warId).toBe(imperialId);
    expect(snapshotGameData(m.game)).toEqual(before);

    act(m, 0, {
      type: "national_transfer_crown",
      empireId: EMPIRE,
      successorId: C,
      requestId: "c2_transfer_receipt",
    });
    expect(m.game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(C);
    const afterCrown = snapshotGameData(m.game);
    expect(() =>
      m.game.performNationalWarCommandWithOutcome(
        m.game.player(A),
        {
          kind: "declare-imperial",
          warId: "c2_old_idempotent_other_id",
          aggressor: { kind: "empire", id: EMPIRE },
          target: { kind: "nation", id: D },
        },
        "c2_imperial_e_d",
        OLD_A,
      ),
    ).toThrow(/stale sovereign replay authority/);
    expect(() =>
      m.game.performNationalPoliticalCommandWithOutcome(
        m.game.player(A),
        { kind: "transfer-crown", empireId: EMPIRE, successorId: C },
        "c2_transfer_receipt",
        OLD_A,
      ),
    ).toThrow(/stale sovereign replay authority/);
    expect(snapshotGameData(m.game)).toEqual(afterCrown);
    // The canonical original accepted receipt is retained, not overwritten.
    expect(military(m.game, A, "c2_imperial_e_d").accepted).toBe(true);
    expect(political(m.game, A, "c2_transfer_receipt").accepted).toBe(true);
  });

  it("rejects forged spectators, foreign request-ID reuse, same-side peace and snapshotted stale-session commands; accepts legitimate replacement controller", async () => {
    const m = await createMatch();
    const { nationalId, imperialId } = await atWar(m);
    expect(
      m.host.submit({ ...m.clients[4] } as Client, {
        type: "national_transfer_crown",
        empireId: EMPIRE,
        successorId: C,
        requestId: "c2_forged_seat",
      }),
    ).toBe(false);
    // Incoming clientID is NOT a sovereign credential.
    act(m, 3, {
      type: "national_transfer_crown",
      empireId: EMPIRE,
      successorId: C,
      requestId: "c2_foreign_crown",
      clientID: OLD_A,
    });
    expect(political(m.game, D, "c2_foreign_crown").accepted).toBe(false);
    // Request ID belonged to A's already accepted imperial war; D cannot
    // recycle its receipt to execute a different command or see acceptance.
    const receiptCount = m.game.nationalWarCommandResults(m.game.player(D)).length;
    act(m, 3, {
      type: "national_propose_peace",
      warId: imperialId,
      requestId: "c2_imperial_e_d",
    });
    expect(m.game.nationalWarCommandResults(m.game.player(D))).toHaveLength(
      receiptCount,
    );

    act(m, 3, {
      type: "national_propose_peace",
      warId: imperialId,
      requestId: "c2_opponent_offer",
    });
    const motion = military(m.game, D, "c2_opponent_offer");
    expect(motion.accepted).toBe(true);
    act(m, 3, {
      type: "national_accept_peace",
      motionId: motion.motionId,
      requestId: "c2_same_side_illegal",
    });
    expect(military(m.game, D, "c2_same_side_illegal").accepted).toBe(false);
    expect(layer(m.game, imperialId).endedTick).toBeNull();

    // OLD session already passed server admission; its pending imperial
    // accept cannot execute after takeover of the SAME Player instance.
    admit(m, m.clients[0], {
      type: "national_accept_peace",
      motionId: motion.motionId,
      requestId: "c2_queued_stale_peace",
    });
    m.host.tick();
    const { restored, bytes, again } = await roundTrip(m.game, "plains");
    expect(again).toEqual(bytes);
    const prior = m.game.nationalWarCommandResults(m.game.player(A));
    m.game.takeoverPlayer(m.game.player(A), NEW_A);
    restored.takeoverPlayer(restored.player(A), NEW_A);
    m.host.tick();
    restored.executeNextTick();
    expect(canonical(m.game)).toEqual(canonical(restored));
    expect(m.game.nationalWarCommandResults(m.game.player(A))).toEqual(prior);
    expect(layer(m.game, imperialId).endedTick).toBeNull();

    // Existing authenticated sockets are retired before fresh server seats.
    for (const client of m.clients) m.host.revokeRecipient(client);
    const replacement = seat(NEW_A, "acct-new-controller");
    const newHost = new TrustedNationalMatch(
      MATCH,
      m.runner,
      [replacement, ...m.clients.slice(1)],
      () => {},
    );
    expect(
      newHost.submit(m.clients[0], {
        type: "national_accept_peace",
        motionId: motion.motionId,
        requestId: "c2_old_retry",
      }),
    ).toBe(false);
    expect(
      newHost.submit(replacement, {
        type: "national_accept_peace",
        motionId: motion.motionId,
        requestId: "c2_new_accept",
      }),
    ).toBe(true);
    newHost.tick();
    newHost.tick();
    expect(military(m.game, A, "c2_new_accept").accepted).toBe(true);
    expect(layer(m.game, imperialId).endedTick).not.toBeNull();
    expect(layer(m.game, nationalId).endedTick).toBeNull();
  });
});
