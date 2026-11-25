// C6C2-E2-COALITION-VOTES: reuse the authenticated four-seat fixture, not old gameplay claims.
import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { readNationalPactDisclosure } from "@openfront/engine-api/game/NationalPactView";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { NationalRuntime } from "@openfront/engine/national/NationalRuntime";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Client } from "../../src/server/Client";
import { TrustedNationalMatch } from "../../src/server/national/TrustedNationalMatch";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const GAME_ID = "C6C2PACT02";
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
  return attach(game);
}

function attach(game: Game) {
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

function gameHash(game: Game): number {
  return (game as unknown as { hash(): number }).hash();
}

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

const pactId = "c6c2_votes";
type Policy = "majority" | "supermajority" | "selected";

function command(
  m: Match,
  client: Client,
  actor: string,
  requestId: string,
  intent: Record<string, unknown>,
  accepted = true,
) {
  issue(m, client, { pactId, requestId, ...intent });
  expect(political(m.game, actor, requestId).accepted).toBe(accepted);
}

function memberView(m: Match, id = A) {
  const view = m.game
    .nationalPactViewsFor(m.game.player(id))
    .find((entry) => entry.id === pactId);
  expect(view).toBeDefined();
  return view!;
}

async function established(policy: Policy) {
  const m = await match();
  command(m, m.a, A, "found", {
    type: "national_found_pact",
    name: "C6C2 threshold witness",
    pactKind: "MDA",
    terms: { admission: "leader", expulsion: "forbidden" },
  });
  command(m, m.a, A, "invite-b", {
    type: "national_invite_pact",
    candidateId: B,
  });
  command(m, m.b, B, "accept-b", { type: "national_accept_pact" });
  command(m, m.a, A, "invite-c", {
    type: "national_invite_pact",
    candidateId: C,
  });
  command(m, m.c, C, "accept-c", { type: "national_accept_pact" });
  expect(new Set(m.game.nationalMdaAllies(A))).toEqual(new Set([B, C]));
  command(m, m.a, A, "amend", {
    type: "national_propose_pact_amendment",
    administratorId: A,
    terms: {
      admission: policy,
      expulsion: "forbidden",
      ...(policy === "selected" ? { selectedApproverIds: [A, B] } : {}),
    },
  });
  command(m, m.b, B, "amend-b", { type: "national_approve_pact_amendment" });
  expect(memberView(m).terms.admission).toBe("leader");
  command(
    m,
    m.d,
    D,
    "amend-outsider",
    {
      type: "national_approve_pact_amendment",
      clientID: CCLIENT,
    },
    false,
  );
  expect(memberView(m).terms.admission).toBe("leader");
  command(m, m.c, C, "amend-c", { type: "national_approve_pact_amendment" });
  expect(memberView(m).terms.admission).toBe(policy);
  expect(memberView(m).constitutionVersion).toBeGreaterThan(0);
  return m;
}

function election(
  version: number,
  action: "propose" | "approve" | "withdraw",
  candidateId = D,
) {
  return {
    type: "national_invite_pact",
    candidateId,
    admissionAction: action,
    constitutionVersion: version,
  };
}

function accept(version: number) {
  return { type: "national_accept_pact", constitutionVersion: version };
}

function assertNoInvite(m: Match) {
  expect(m.game.nationalPactViewsFor(m.game.player(D))).toEqual([]);
  expect(m.game.nationalPactDisclosure(m.game.player(D))?.pacts).toEqual([]);
  expect(m.game.nationalMdaAllies(D)).toEqual([]);
}

describe("C6C2-E2-COALITION-VOTES: authenticated political transitions", () => {
  it.each(["majority", "supermajority", "selected"] as const)(
    "%s: one vote fails, two distinct eligible votes authorize, applicant joins only by consent",
    async (policy) => {
      const m = await established(policy);
      const epoch = memberView(m).constitutionVersion!;
      command(m, m.a, A, "propose-d", election(epoch, "propose"));
      expect(memberView(m).invitations).toEqual([
        { targetId: D, approvedBy: [A], authorized: false },
      ]);
      assertNoInvite(m);
      command(m, m.d, D, "premature-accept", accept(epoch), false);
      command(
        m,
        m.d,
        D,
        "premature-withdraw",
        election(epoch, "withdraw"),
        false,
      );
      command(
        m,
        m.d,
        D,
        "forged-vote",
        {
          ...election(epoch, "approve"),
          clientID: BCLIENT,
        },
        false,
      );
      command(m, m.a, A, "duplicate-vote", election(epoch, "approve"), false);
      command(m, m.b, B, "stale-vote", election(epoch + 1, "approve"), false);
      command(
        m,
        m.b,
        B,
        "invalid-candidate",
        election(epoch, "propose", A),
        false,
      );
      if (policy === "selected")
        command(m, m.c, C, "not-selected", election(epoch, "approve"), false);
      assertNoInvite(m);
      const pending = await roundTrip(m.game, "plains");
      expect(pending.again).toEqual(pending.bytes);
      const replay = attach(pending.restored);
      for (const current of [m, replay]) {
        command(current, current.b, B, "vote-b", election(epoch, "approve"));
        expect(memberView(current).invitations[0]).toEqual({
          targetId: D,
          approvedBy: [A, B].sort(),
          authorized: true,
        });
        expect(current.game.nationalMdaAllies(D)).toEqual([]);
        const disclosure = current.game.nationalPactDisclosure(
          current.game.player(D),
        )!;
        expect(disclosure.pacts[0].relationship).toBe("invited");
        expect(disclosure.pacts[0].invitations).toBeUndefined();
        const roster = current.game.nationalPublicPoliticalView()!.pacts!;
        expect(
          readNationalPactDisclosure(disclosure, A, roster, false),
        ).toBeNull();
        command(
          current,
          current.c,
          C,
          "wrong-acceptor",
          {
            ...accept(epoch),
            clientID: DCLIENT,
          },
          false,
        );
        expect(current.game.nationalMdaAllies(D)).toEqual([]);
        command(current, current.d, D, "consent-d", accept(epoch));
        expect(new Set(current.game.nationalMdaAllies(D))).toEqual(
          new Set([A, B, C]),
        );
        expect(new Set(current.game.nationalMdaAllies(A))).toEqual(
          new Set([B, C, D]),
        );
        expect(memberView(current).memberIds).toEqual([A, B, C, D].sort());
        expect(memberView(current).invitations).toEqual([]);
        expect(memberView(current).constitutionVersion).toBeGreaterThan(epoch);
      }
      const final = await roundTrip(m.game, "plains");
      expect(final.again).toEqual(final.bytes);
      expect(final.restored.nationalMdaAllies(D)).toEqual(
        m.game.nationalMdaAllies(D),
      );
      const replayFinal = await roundTrip(replay.game, "plains");
      expect(replayFinal.bytes).toEqual(final.bytes);
      expect(gameHash(replay.game)).toBe(gameHash(m.game));
      const digest = createHash("sha256").update(final.bytes).digest("hex");
      console.log(
        "C6C2-E2-COALITION-VOTES",
        policy,
        policy === "selected"
          ? "1/2 => 2/2 eligible => 4 members"
          : "1/3 => 2/3 => 4 members",
        "snapshot_sha256",
        digest,
        "replay_hash",
        gameHash(m.game),
      );
    },
  );

  it("revokes a departed approver and a candidate entering an empire; preserves Betray and non-expulsion", async () => {
    const m = await established("majority");
    const epoch = memberView(m).constitutionVersion!;
    command(m, m.a, A, "propose-d", election(epoch, "propose"));
    command(m, m.b, B, "vote-b", election(epoch, "approve"));
    command(
      m,
      m.a,
      A,
      "forbidden-expel",
      {
        type: "national_expel_pact",
        memberId: B,
      },
      false,
    );
    command(m, m.b, B, "sovereign-betray", { type: "national_betray_pact" });
    const changed = memberView(m).constitutionVersion!;
    expect(changed).toBeGreaterThan(epoch);
    expect(memberView(m).invitations).toEqual([]);
    assertNoInvite(m);
    command(m, m.b, B, "departed-voter", election(changed, "approve"), false);
    command(m, m.d, D, "revoked-accept", accept(epoch), false);
    command(m, m.a, A, "propose-again", election(changed, "propose"));
    command(m, m.c, C, "vote-c", election(changed, "approve"));
    issue(m, m.d, {
      type: "national_found_empire",
      empireId: "independent_d",
      requestId: "found-d-empire",
    });
    expect(m.game.nationalPoliticalAuthority()?.empireOf(D)).toBe(
      "independent_d",
    );
    expect(memberView(m).invitations).toEqual([]);
    assertNoInvite(m);
    const current = memberView(m).constitutionVersion!;
    command(m, m.a, A, "empire-candidate", election(current, "propose"), false);
    command(m, m.d, D, "empire-voter", election(current, "approve", B), false);
  });

  it("withdrawal revokes the entire election epoch and cannot be forged", async () => {
    const m = await established("supermajority");
    const epoch = memberView(m).constitutionVersion!;
    command(m, m.a, A, "propose-d", election(epoch, "propose"));
    command(m, m.b, B, "vote-b", election(epoch, "approve"));
    command(
      m,
      m.c,
      C,
      "forged-withdraw",
      {
        ...election(epoch, "withdraw"),
        clientID: DCLIENT,
      },
      false,
    );
    command(m, m.d, D, "withdraw-d", election(epoch, "withdraw"));
    expect(memberView(m).invitations).toEqual([]);
    assertNoInvite(m);
    command(m, m.a, A, "stale-propose", election(epoch, "propose"), false);
    command(m, m.d, D, "stale-accept", accept(epoch), false);
  });

  it("fails closed on corrupted versioned snapshots, but round-trips unmodified legacy v1", () => {
    const runtime = new NationalRuntime([A, B, C, D]);
    runtime.perform(A, {
      kind: "found-pact",
      pactId,
      name: "legacy",
      pactKind: "MDA",
      terms: { admission: "leader", expulsion: "forbidden" },
    });
    const legacy = runtime.snapshot();
    expect(legacy.politics.admissionEpoch).toBeUndefined();
    expect(NationalRuntime.restore(legacy, [A, B, C, D], 0).snapshot()).toEqual(
      legacy,
    );
    runtime.perform(A, {
      kind: "propose-pact-amendment",
      pactId,
      administratorId: A,
      terms: { admission: "majority", expulsion: "forbidden" },
    });
    const version = runtime.snapshot().politics.pacts[0].constitutionVersion!;
    runtime.perform(A, {
      kind: "invite-pact",
      pactId,
      candidateId: D,
      constitutionVersion: version,
      admissionAction: "propose",
    });
    const saved = runtime.snapshot();
    for (const corrupt of [
      (x: typeof saved) => {
        x.politics.pacts[0].invitations[0].approvedBy = [A, A];
      },
      (x: typeof saved) => {
        x.politics.pacts[0].invitations[0].approvedBy = [D];
      },
      (x: typeof saved) => {
        x.politics.pacts[0].invitations[0].constitutionVersion = version + 1;
      },
      (x: typeof saved) => {
        delete x.politics.admissionEpoch;
      },
      (x: typeof saved) => {
        delete x.politics.pacts[0].invitations[0].proposerId;
      },
      (x: typeof saved) => {
        x.politics.pacts[0].invitations = Array(257).fill(
          x.politics.pacts[0].invitations[0],
        );
      },
    ]) {
      const bad = structuredClone(saved);
      corrupt(bad);
      expect(() => NationalRuntime.restore(bad, [A, B, C, D], 0)).toThrow();
    }
  });

  it("five-member electorate distinguishes majority from two-thirds", () => {
    const ids = [A, B, C, "C6EXTRAE", "C6EXTRAF", D];
    const members = ids.slice(0, 5);
    for (const policy of ["majority", "supermajority"] as const) {
      const runtime = new NationalRuntime(ids);
      runtime.perform(A, {
        kind: "found-pact",
        pactId,
        name: "Five",
        pactKind: "MDA",
        terms: { admission: "leader", expulsion: "forbidden" },
      });
      for (const id of members.slice(1)) {
        runtime.perform(A, { kind: "invite-pact", pactId, candidateId: id });
        runtime.perform(id, { kind: "accept-pact", pactId });
      }
      runtime.perform(A, {
        kind: "propose-pact-amendment",
        pactId,
        administratorId: A,
        terms: { admission: policy, expulsion: "forbidden" },
      });
      for (const id of members.slice(1))
        runtime.perform(id, { kind: "approve-pact-amendment", pactId });
      const version = runtime.snapshot().politics.pacts[0].constitutionVersion!;
      runtime.perform(A, {
        kind: "invite-pact",
        pactId,
        candidateId: D,
        admissionAction: "propose",
        constitutionVersion: version,
      });
      const approve = (id: string) =>
        runtime.perform(id, {
          kind: "invite-pact",
          pactId,
          candidateId: D,
          admissionAction: "approve",
          constitutionVersion: version,
        });
      approve(B);
      approve(C);
      const consent = () =>
        runtime.perform(D, {
          kind: "accept-pact",
          pactId,
          constitutionVersion: version,
        });
      if (policy === "supermajority") {
        expect(consent).toThrow();
        expect(runtime.snapshot().politics.pacts[0].memberIds).toHaveLength(5);
        approve(members[3]);
      }
      consent();
      expect(runtime.snapshot().politics.pacts[0].memberIds).toHaveLength(6);
    }
  });

  it("legacy NATIONAL-disabled FFA cannot execute threshold governance", async () => {
    const game = await setup(
      "plains",
      {
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
        nationalMode: false,
      },
      people,
    );
    expect(() =>
      game.performNationalCommand(game.player(A), {
        kind: "found-pact",
        pactId,
        name: "invalid",
        pactKind: "NAP",
        terms: { admission: "majority", expulsion: "forbidden" },
      }),
    ).toThrow(/NATIONAL/);
  });
});
