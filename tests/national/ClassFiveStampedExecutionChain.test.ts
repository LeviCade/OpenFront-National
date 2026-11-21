/**
 * Fifth Class E1/E2 contract: the ORIGINAL server-authenticated clientID must
 * survive admission -> stamped Executor -> PENDING Execution -> snapshot
 * -> tick -> the ONE Game-owned authority and journal.
 *
 * This is a real server-owned, four-seat GameRunner using TrustedNationalMatch.
 * No client-simulated Private NATIONAL or fabricated browser principals.
 *
 * The intentional cross-owner integration gate FAILS if E2 drops the original
 * stamp, recovers it from mutable Player.clientID(), or strips it on snapshot.
 */
import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
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

const GAME_ID = "C5HOSTGAME";
const EMPIRE = "C5_SECURITY_EMPIRE";
const OLD = "C5SEATAX1";
const NEXT = "C5SEATAX2";
const BCLIENT = "C5SEATBX1";
const CCLIENT = "C5SEATCX1";
const DCLIENT = "C5SEATDX1";
const people = [
  new PlayerInfo("Emperor", PlayerType.Human, OLD, "C5RULERA"),
  new PlayerInfo("Member", PlayerType.Human, BCLIENT, "C5MEMBRB"),
  new PlayerInfo("Heir", PlayerType.Human, CCLIENT, "C5HEIRCC"),
  new PlayerInfo("Foreign", PlayerType.Human, DCLIENT, "C5FOREND"),
];
const [A, B, C, D] = people.map((p) => p.id);

/** Host-only capability; never emitted to a browser or ordinary EngineConfig. */
class PrivateHostConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}

function seat(clientID: string, account: string): Client {
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
    account,
    [],
  );
}

async function match() {
  const game = await setup(
    "plains",
    { gameType: GameType.Private, gameMode: GameMode.FFA, nationalMode: true },
    people,
    undefined,
    PrivateHostConfig,
  );
  const points: [number, number][] = [
    [20, 20],
    [80, 20],
    [20, 80],
    [80, 80],
  ];
  for (let i = 0; i < people.length; i++) {
    const [x, y] = points[i];
    game.addExecution(new SpawnExecution(GAME_ID, people[i], game.ref(x, y)));
  }
  game.executeNextTick();
  game.executeNextTick();
  for (const p of people) expect(game.player(p.id).hasSpawned()).toBe(true);
  const runner = new GameRunner(
    game,
    new Executor(game, GAME_ID, undefined),
    () => {},
    undefined,
  );
  const [a, b, c, d] = [
    seat(OLD, "account-a"),
    seat(BCLIENT, "account-b"),
    seat(CCLIENT, "account-c"),
    seat(DCLIENT, "account-d"),
  ];
  const received = new Map<string, unknown[]>();
  const host = new TrustedNationalMatch(
    GAME_ID,
    runner,
    [a, b, c, d],
    (client, packet) => {
      const frames = received.get(client.clientID) ?? [];
      frames.push(packet);
      received.set(client.clientID, frames);
    },
  );
  return { game, runner, host, a, b, c, d, received };
}
type Match = Awaited<ReturnType<typeof match>>;

function issue(m: Match, client: Client, intent: Record<string, unknown>) {
  expect(m.host.submit(client, intent)).toBe(true);
  const queued = m.host.tick();
  expect(queued.committedIntents).toBe(1);
  // Game initializes the execution first; the next authoritative server
  // tick invokes its command. No client drives a local GameRunner.
  m.host.tick();
}
function political(game: Game, id: string, token: string) {
  const receipt = game
    .nationalPoliticalCommandResults(game.player(id))
    .find((x) => x.requestId === token);
  expect(receipt).toBeDefined();
  return receipt!;
}
function war(game: Game, id: string, token: string) {
  const receipt = game
    .nationalWarCommandResults(game.player(id))
    .find((x) => x.requestId === token);
  expect(receipt).toBeDefined();
  return receipt!;
}
function founder(m: Match) {
  issue(m, m.a, {
    type: "national_found_empire",
    empireId: EMPIRE,
    requestId: "c5_found",
  });
  expect(
    m.game.nationalPublicPoliticalView()?.empires.some((e) => e.id === EMPIRE),
  ).toBe(true);
}
function join(m: Match, actor: Client, id: string, tag: string) {
  issue(m, m.a, {
    type: "national_offer_empire",
    empireId: EMPIRE,
    candidateId: id,
    requestId: "c5_offer_" + tag,
  });
  expect(political(m.game, A, "c5_offer_" + tag).accepted).toBe(true);
  issue(m, actor, {
    type: "national_accept_empire",
    empireId: EMPIRE,
    candidateId: id,
    requestId: "c5_accept_" + tag,
  });
  expect(political(m.game, id, "c5_accept_" + tag).accepted).toBe(true);
}
function delegation(id: string, enabled: boolean) {
  return {
    type: "national_set_peace_delegation",
    empireId: EMPIRE,
    memberId: id,
    enabled,
  };
}

/** Recreate only the server-authenticated seat, never reuse the old socket. */
function replacement(m: Match) {
  m.game.takeoverPlayer(m.game.player(A), NEXT);
  const newA = seat(NEXT, "replacement-account");
  const successorHost = new TrustedNationalMatch(
    GAME_ID,
    m.runner,
    [newA, m.b, m.c, m.d],
    () => {},
  );
  return { newA, successorHost };
}

describe("Class Five E1: ORIGINAL authenticated clientID crosses queued Game execution", () => {
  it("fails closed on Private human omission even before a journal lookup, while preserving legitimate Solo API", async () => {
    const m = await match();
    const before = snapshotGameData(m.game);
    expect(() =>
      m.game.performNationalFoundEmpireWithOutcome(
        m.game.player(A),
        EMPIRE,
        "c5_missing_found",
      ),
    ).toThrow(/missing authenticated actor session/);
    expect(() =>
      m.game.performNationalPoliticalCommandWithOutcome(
        m.game.player(A),
        {
          kind: "set-national-peace-delegation",
          empireId: EMPIRE,
          memberId: B,
          enabled: true,
        },
        "c5_missing_delegation",
      ),
    ).toThrow(/missing authenticated actor session/);
    expect(() =>
      m.game.performNationalWarCommandWithOutcome(
        m.game.player(A),
        {
          kind: "declare-national",
          warId: "c5_missing_war",
          aggressorId: A,
          targetId: D,
        },
        "c5_missing_war",
      ),
    ).toThrow(/missing authenticated actor session/);
    expect(snapshotGameData(m.game)).toEqual(before);

    // Engine internal policy APIs remain compatible outside trusted Private.
    const solo = await setup("plains", { nationalMode: true }, people);
    for (let i = 0; i < people.length; i++) {
      solo.addExecution(
        new SpawnExecution(GAME_ID, people[i], solo.ref(20 + i * 15, 20)),
      );
    }
    solo.executeNextTick();
    solo.executeNextTick();
    expect(
      solo.performNationalFoundEmpireWithOutcome(
        solo.player(A),
        "c5_solo_ok",
        "c5_solo_found",
      ).accepted,
    ).toBe(true);
  });

  it("executes authenticated server-stamped founding, bilateral accession, and crown changes through the actual queue", async () => {
    const m = await match();
    // Host MUST replace the attacker's browser-provided clientID.
    expect(
      m.host.submit(m.a, {
        type: "national_found_empire",
        empireId: EMPIRE,
        requestId: "c5_found",
        clientID: BCLIENT,
      }),
    ).toBe(true);
    m.host.tick();
    m.host.tick();
    expect(
      m.game
        .nationalPublicPoliticalView()
        ?.empires.some((e) => e.id === EMPIRE && e.leaderId === A),
    ).toBe(true);
    join(m, m.b, B, "b");
    join(m, m.c, C, "c");

    issue(m, m.a, { ...delegation(B, true), requestId: "c5_live_grant" });
    expect(political(m.game, A, "c5_live_grant").accepted).toBe(true);
    expect(m.game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(
      true,
    );
    issue(m, m.a, {
      type: "national_transfer_crown",
      empireId: EMPIRE,
      successorId: C,
      requestId: "c5_live_crown",
    });
    expect(political(m.game, A, "c5_live_crown").accepted).toBe(true);
    expect(m.game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(C);
    expect(m.game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(
      false,
    );
    issue(m, m.a, { ...delegation(B, true), requestId: "c5_old_ruler" });
    expect(political(m.game, A, "c5_old_ruler").accepted).toBe(false);
    issue(m, m.c, { ...delegation(B, true), requestId: "c5_new_ruler" });
    expect(political(m.game, C, "c5_new_ruler").accepted).toBe(true);
    expect(m.game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(
      true,
    );
    const { bytes, restored, again } = await roundTrip(m.game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(m.game));
  });

  it("carries the original stamp through a pending snapshot; stale emperor cannot replay an accepted grant or execute a queued revoke", async () => {
    const m = await match();
    founder(m);
    join(m, m.b, B, "b");
    issue(m, m.a, { ...delegation(B, true), requestId: "c5_grant_once" });
    expect(political(m.game, A, "c5_grant_once").accepted).toBe(true);
    const beforeReceipts = m.game.nationalPoliticalCommandResults(
      m.game.player(A),
    );

    // First server turn admits OLD's command; an execution is queued and
    // initialized but NOT yet ticked. Snapshot at precisely that boundary.
    expect(
      m.host.submit(m.a, {
        ...delegation(B, false),
        requestId: "c5_old_queued_revoke",
      }),
    ).toBe(true);
    m.host.tick();
    const { bytes, restored, again } = await roundTrip(m.game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(m.game));

    const { newA, successorHost } = replacement(m);
    restored.takeoverPlayer(restored.player(A), NEXT);
    const before = snapshotGameData(m.game);
    const beforeRestore = snapshotGameData(restored);

    // Executing OLD's already admitted action after takeover MUST be denied.
    // This also tests a restored pending execution, not merely live memory.
    m.host.tick();
    restored.executeNextTick();
    expect(snapshotGameData(m.game)).toEqual(snapshotGameData(restored));
    expect(m.game.nationalPoliticalCommandResults(m.game.player(A))).toEqual(
      beforeReceipts,
    );
    expect(m.game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(
      true,
    );
    expect(m.game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(A);
    expect(snapshotGameData(m.game)).not.toEqual(before);
    expect(snapshotGameData(restored)).not.toEqual(beforeRestore);

    // The old accepted token cannot be replayed from its prior session.
    expect(() =>
      m.game.performNationalPoliticalCommandWithOutcome(
        m.game.player(A),
        {
          kind: "set-national-peace-delegation",
          empireId: EMPIRE,
          memberId: B,
          enabled: true,
        },
        "c5_grant_once",
        OLD,
      ),
    ).toThrow(/stale authenticated actor session/);

    expect(
      successorHost.submit(newA, {
        ...delegation(B, false),
        requestId: "c5_legitimate_new_owner",
      }),
    ).toBe(true);
    successorHost.tick();
    successorHost.tick();
    expect(political(m.game, A, "c5_legitimate_new_owner").accepted).toBe(true);
    expect(m.game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(
      false,
    );
    expect(
      m.host.submit(m.a, {
        ...delegation(B, true),
        requestId: "c5_old_after_takeover",
      }),
    ).toBe(false);
  });

  it("blocks queued stale NATIONAL/IMPERIAL WAR and peace acceptance without blocking legitimate new controller or deterministic replay", async () => {
    const m = await match();
    founder(m);
    join(m, m.b, B, "b");
    issue(m, m.a, {
      type: "national_declare_war",
      scope: "national",
      nationId: B,
      targetId: D,
      targetKind: "nation",
      requestId: "c5_national_war",
    });
    const nw = war(m.game, A, "c5_national_war");
    expect(nw.accepted).toBe(true);
    issue(m, m.a, {
      type: "national_declare_war",
      scope: "imperial",
      nationId: A,
      targetId: D,
      targetKind: "nation",
      requestId: "c5_imperial_war",
    });
    const iw = war(m.game, A, "c5_imperial_war");
    expect(iw.accepted).toBe(true);
    issue(m, m.a, { ...delegation(B, true), requestId: "c5_peace_grant" });
    expect(political(m.game, A, "c5_peace_grant").accepted).toBe(true);
    issue(m, m.b, {
      type: "national_propose_peace",
      warId: iw.warId,
      requestId: "c5_imperial_member_denied",
    });
    expect(war(m.game, B, "c5_imperial_member_denied").accepted).toBe(false);
    issue(m, m.b, {
      type: "national_propose_peace",
      warId: nw.warId,
      requestId: "c5_member_peace",
    });
    const proposal = war(m.game, B, "c5_member_peace");
    expect(proposal.accepted).toBe(true);

    // Queue an opponent D's actual peace acceptance. Transfer D's same Player
    // object to a new session before pending execution tick, then restore.
    expect(
      m.host.submit(m.d, {
        type: "national_accept_peace",
        motionId: proposal.motionId,
        requestId: "c5_old_accept",
      }),
    ).toBe(true);
    m.host.tick();
    const { bytes, restored, again } = await roundTrip(m.game, "plains");
    expect(again).toEqual(bytes);
    m.game.takeoverPlayer(m.game.player(D), "C5SEATDX2");
    restored.takeoverPlayer(restored.player(D), "C5SEATDX2");
    m.host.tick();
    restored.executeNextTick();
    expect(snapshotGameData(m.game)).toEqual(snapshotGameData(restored));
    expect(
      m.game
        .nationalWarCommandResults(m.game.player(D))
        .some((r) => r.requestId === "c5_old_accept"),
    ).toBe(false);
    expect(
      m.game.nationalWarState()?.wars.layers.find((x) => x.id === nw.warId)
        ?.endedTick,
    ).toBeNull();
    expect(
      m.game.nationalWarState()?.wars.layers.find((x) => x.id === iw.warId)
        ?.endedTick,
    ).toBeNull();

    const newD = seat("C5SEATDX2", "replacement-d");
    const host2 = new TrustedNationalMatch(
      GAME_ID,
      m.runner,
      [m.a, m.b, m.c, newD],
      () => {},
    );
    expect(
      host2.submit(newD, {
        type: "national_accept_peace",
        motionId: proposal.motionId,
        requestId: "c5_new_accept",
      }),
    ).toBe(true);
    host2.tick();
    host2.tick();
    expect(war(m.game, D, "c5_new_accept").accepted).toBe(true);
    expect(
      m.game.nationalWarState()?.wars.layers.find((x) => x.id === nw.warId)
        ?.endedTick,
    ).not.toBeNull();
    expect(
      m.game.nationalWarState()?.wars.layers.find((x) => x.id === iw.warId)
        ?.endedTick,
    ).toBeNull();
  });
});
