// Independent E5 regression using the existing Class Five real TrustedNationalMatch fixture.
// No browser, GPU, real-account or process-recovery claim.
import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { describe, expect, it } from "vitest";
import { Client } from "../../src/server/Client";
import { TrustedNationalMatch } from "../../src/server/national/TrustedNationalMatch";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const GAME_ID = "E5C2PACT01";
const OLD = "C5SEATAX1";
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
    { readyState: 1 } as Client["ws"],
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
function political(game: Match["game"], id: string, token: string) {
  const receipt = game
    .nationalPoliticalCommandResults(game.player(id))
    .find((x) => x.requestId === token);
  expect(receipt).toBeDefined();
  return receipt!;
}

describe("E5 Class Two: stamped constitutional consent and defensive membership", () => {
  it("requires independent votes, rejects unauthorized consent and changes real MDA donor eligibility", async () => {
    const m = await match();
    const pactId = "e5_c2_live_mda";
    const terms = { admission: "leader", expulsion: "forbidden" };
    function command(
      actor: Client,
      id: string,
      requestId: string,
      intent: Record<string, unknown>,
      accepted: boolean,
    ) {
      issue(m, actor, { ...intent, pactId, requestId });
      expect(political(m.game, id, requestId).accepted).toBe(accepted);
    }
    command(m.a, A, "e5_found", {
      type: "national_found_pact",
      name: "Witness MDA",
      pactKind: "MDA",
      terms,
    }, true);
    command(m.a, A, "e5_invite_b", {
      type: "national_invite_pact",
      candidateId: B,
    }, true);
    command(m.d, D, "e5_outsider_accept", {
      type: "national_accept_pact",
      clientID: BCLIENT,
    }, false);
    expect(m.game.nationalMdaAllies(A)).toEqual([]);
    command(m.b, B, "e5_accept_b", {
      type: "national_accept_pact",
    }, true);
    expect(m.game.nationalMdaAllies(A)).toEqual([B]);
    command(m.a, A, "e5_invite_c", {
      type: "national_invite_pact",
      candidateId: C,
    }, true);
    command(m.c, C, "e5_accept_c", {
      type: "national_accept_pact",
    }, true);
    expect(new Set(m.game.nationalMdaAllies(A))).toEqual(new Set([B, C]));
    const expel = { type: "national_expel_pact", memberId: C };
    command(m.a, A, "e5_forbidden_expel", expel, false);
    command(m.a, A, "e5_amend", {
      type: "national_propose_pact_amendment",
      terms: { admission: "leader", expulsion: "leader" },
      administratorId: A,
    }, true);
    command(m.d, D, "e5_outsider_vote", {
      type: "national_approve_pact_amendment",
      clientID: CCLIENT,
    }, false);
    command(m.b, B, "e5_bravo_vote", {
      type: "national_approve_pact_amendment",
    }, true);
    command(m.b, B, "e5_bravo_repeat", {
      type: "national_approve_pact_amendment",
    }, true);
    command(m.a, A, "e5_missing_charlie_vote", expel, false);
    expect(new Set(m.game.nationalMdaAllies(A))).toEqual(new Set([B, C]));
    command(m.c, C, "e5_charlie_vote", {
      type: "national_approve_pact_amendment",
    }, true);
    command(m.b, B, "e5_nonadmin_expel", expel, false);
    command(m.a, A, "e5_lawful_expel", expel, true);
    expect(m.game.nationalMdaAllies(A)).toEqual([B]);
    expect(m.game.nationalMdaAllies(C)).toEqual([]);
    command(m.b, B, "e5_leave", { type: "national_betray_pact" }, true);
    expect(m.game.nationalMdaAllies(A)).toEqual([]);
    expect(m.game.nationalMdaAllies(B)).toEqual([]);
    command(m.b, B, "e5_leave_again", { type: "national_betray_pact" }, false);
    const { bytes, restored, again } = await roundTrip(m.game, "plains");
    expect(again).toEqual(bytes);
    expect(restored.nationalMdaAllies(A)).toEqual([]);
    expect(restored.nationalPoliticalCommandResults(restored.player(B))).toEqual(
      m.game.nationalPoliticalCommandResults(m.game.player(B)),
    );
    // This asserts recipient isolation of the private command result, not
    // invited UI availability of constitutional terms (a separate lane).
    const outside = JSON.stringify(m.received.get(DCLIENT));
    expect(outside).not.toContain("e5_charlie_vote");
    expect(outside).not.toContain("e5_lawful_expel");
    expect(outside).not.toContain("e5_leave_again");
  });
});
