// C7C1-E1: exercise new constitutional outcomes through the original authenticated match fixture.
import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { readNationalPactDisclosure } from "@openfront/engine-api/game/NationalPactView";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { NationalRuntime } from "@openfront/engine/national/NationalRuntime";
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
} from "@openfront/shared/ZbinWire";
import { describe, expect, it } from "vitest";
import { pactActionAllowed } from "../../src/client/NationalPactState";
import { Client } from "../../src/server/Client";
import { encodeNationalRecipientProjection } from "../../src/server/national/NationalRecipientWire";
import { TrustedNationalMatch } from "../../src/server/national/TrustedNationalMatch";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const GAME_ID = "C7C1PACT01";
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
  const received = new Map<string, GameUpdateViewData[]>();
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

const pactId = "c7c1_constitution";

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

function wireFrame(m: Match, client: Client): GameUpdateViewData {
  const frames = m.received.get(client.clientID) ?? [];
  const packet = frames[frames.length - 1];
  expect(packet).toBeDefined();
  const decoded = decodeServerMessage(
    encodeServerMessage(
      {
        type: "national_projection",
        tick: packet!.tick,
        payload: encodeNationalRecipientProjection(packet!),
      },
      undefined,
    ),
    undefined,
  );
  if (decoded.type !== "national_projection")
    throw new Error("wrong native projection frame");
  return JSON.parse(decoded.payload) as GameUpdateViewData;
}

function assertNoInvite(m: Match) {
  expect(m.game.nationalPactViewsFor(m.game.player(D))).toEqual([]);
  expect(m.game.nationalPactDisclosure(m.game.player(D))?.pacts).toEqual([]);
  expect(m.game.nationalMdaAllies(D)).toEqual([]);
  const frame = wireFrame(m, m.d);
  expect(frame.nationalPactDisclosure?.pacts ?? []).toEqual([]);
  expect(JSON.stringify(frame.nationalPolitics)).not.toMatch(
    /"terms"|"approvedBy"|"invitations"|"constitutionVersion"/,
  );
}

async function found(cap: number, duration = 200) {
  const m = await match();
  const intent = {
    type: "national_found_pact_v2",
    pactId,
    requestId: "found-constitution",
    name: "Constitution witness",
    pactKind: "MDA",
    terms: {
      admission: "leader",
      expulsion: "majority",
      membershipCap: cap,
      invitationDurationTicks: duration,
    },
  } as const;
  const decoded = decodeClientMessage(
    encodeClientMessage({ type: "intent", intent }, undefined),
    undefined,
  );
  if (decoded.type !== "intent") throw new Error("native intent expected");
  expect(decoded.intent).toEqual(intent);
  issue(m, m.a, decoded.intent);
  expect(political(m.game, A, intent.requestId).accepted).toBe(true);
  expect(memberView(m).terms.membershipCap).toBe(cap);
  expect(memberView(m).terms.invitationDurationTicks).toBe(duration);
  return m;
}
function invite(m: Match, id: string, requestId: string) {
  const version = memberView(m).constitutionVersion!;
  command(m, m.a, A, requestId, {
    type: "national_invite_pact",
    candidateId: id,
    admissionAction: "propose",
    constitutionVersion: version,
  });
  return version;
}
function consent(
  m: Match,
  client: Client,
  actor: string,
  version: number,
  requestId: string,
  accepted = true,
) {
  command(
    m,
    client,
    actor,
    requestId,
    { type: "national_accept_pact", constitutionVersion: version },
    accepted,
  );
}
function vote(
  m: Match,
  client: Client,
  actor: string,
  targetId: string,
  version: number,
  requestId: string,
  accepted = true,
) {
  command(
    m,
    client,
    actor,
    requestId,
    {
      type: "national_expel_pact_v2",
      memberId: targetId,
      constitutionVersion: version,
    },
    accepted,
  );
}

describe("C7C1E1 authenticated extended coalition constitution", () => {
  it("two final-slot consents queued together admit exactly one; replay restores the same queued commands", async () => {
    const m = await found(2);
    const version = invite(m, B, "invite-b");
    expect(invite(m, C, "invite-c")).toBe(version);
    assertNoInvite(m);
    const b = wireFrame(m, m.b).nationalPactDisclosure!;
    expect(b.pacts[0]).toMatchObject({
      relationship: "invited",
      terms: { membershipCap: 2 },
    });
    expect(b.pacts[0].invitations).toBeUndefined();
    expect(b.pacts[0].expulsionBallots).toBeUndefined();
    expect(
      readNationalPactDisclosure(
        b,
        D,
        m.game.nationalPublicPoliticalView()!.pacts!,
        false,
      ),
    ).toBeNull();
    expect(
      m.host.submit(m.b, {
        type: "national_accept_pact",
        pactId,
        requestId: "final-slot-b",
        constitutionVersion: version,
      }),
    ).toBe(true);
    expect(
      m.host.submit(m.c, {
        type: "national_accept_pact",
        pactId,
        requestId: "final-slot-c",
        constitutionVersion: version,
      }),
    ).toBe(true);
    expect(m.host.tick().committedIntents).toBe(2);
    const queued = await roundTrip(m.game, "plains");
    const replay = attach(queued.restored);
    expect(queued.again).toEqual(queued.bytes);
    for (const current of [m, replay]) {
      current.host.tick();
      expect(political(current.game, B, "final-slot-b").accepted).toBe(true);
      expect(political(current.game, C, "final-slot-c").accepted).toBe(false);
      expect(memberView(current).memberIds).toEqual([A, B].sort());
      expect(memberView(current).invitations).toEqual([]);
      expect(current.game.nationalMdaAllies(C)).toEqual([]);
      expect(current.game.nationalMdaAllies(B)).toEqual([A]);
      expect(memberView(current).constitutionVersion).toBeGreaterThan(version);
    }
    const final = await roundTrip(m.game, "plains");
    const restored = await roundTrip(replay.game, "plains");
    expect(restored.bytes).toEqual(final.bytes);
    expect(gameHash(replay.game)).toBe(gameHash(m.game));
    command(
      m,
      m.a,
      A,
      "full-pact",
      {
        type: "national_invite_pact",
        candidateId: D,
        admissionAction: "propose",
        constitutionVersion: memberView(m).constitutionVersion,
      },
      false,
    );
    console.info(
      "C7C1E1_FINAL_SLOT=2 competing consents, 1 accepted, 2/2 members",
    );
  });

  it("expires at the authoritative tick boundary and a renewed invitation rejects the stale epoch", async () => {
    const m = await found(3, 12);
    const version = invite(m, D, "invite-expiring");
    const deadline = memberView(m).invitations[0].expiresAtTick!;
    expect(deadline).toBeGreaterThan(m.game.ticks());
    while (m.game.ticks() < deadline - 1) m.host.tick();
    expect(
      m.game.nationalPactDisclosure(m.game.player(D))?.pacts[0]
        .invitationExpiresAtTick,
    ).toBe(deadline);
    m.host.tick();
    expect(m.game.ticks()).toBe(deadline);
    assertNoInvite(m);
    expect(memberView(m).invitations).toEqual([]);
    const renewed = invite(m, D, "invite-renewed");
    expect(renewed).toBeGreaterThan(version);
    consent(m, m.d, D, version, "expired-consent", false);
    consent(m, m.d, D, renewed, "fresh-consent");
    expect(memberView(m).memberIds).toEqual([A, D].sort());
    console.info("C7C1E1_EXPIRY", { deadline, version, renewed });
  });

  it("records separate authenticated expulsion votes, excludes target and outsider, preserves snapshot and immediate Betray", async () => {
    const m = await found(4);
    consent(m, m.b, B, invite(m, B, "add-b"), "b-consent");
    consent(m, m.c, C, invite(m, C, "add-c"), "c-consent");
    const version = memberView(m).constitutionVersion!;
    vote(m, m.a, A, C, version, "vote-a");
    expect(memberView(m).memberIds).toHaveLength(3);
    expect(memberView(m).expulsionBallots).toEqual([
      { targetId: C, approvedBy: [A] },
    ]);
    vote(m, m.a, A, C, version, "duplicate", false);
    vote(m, m.c, C, C, version, "target-vote", false);
    vote(m, m.d, D, C, version, "outsider-vote", false);
    assertNoInvite(m);
    const frame = wireFrame(m, m.b).nationalPactDisclosure!;
    expect(frame.pacts[0].expulsionBallots).toEqual([
      { targetId: C, approvedBy: [A] },
    ]);
    const roster = m.game.nationalPublicPoliticalView()!.pacts!;
    expect(
      pactActionAllowed(
        {
          type: "national_expel_pact_v2",
          pactId,
          memberId: C,
          constitutionVersion: version,
        },
        { actor: B, roster, disclosure: frame, independentCandidates: [] },
      ),
    ).toBe(true);
    const pending = await roundTrip(m.game, "plains");
    expect(pending.again).toEqual(pending.bytes);
    const replay = attach(pending.restored);
    for (const current of [m, replay]) {
      vote(current, current.b, B, C, version, "vote-b");
      expect(memberView(current).memberIds).toEqual([A, B].sort());
      expect(memberView(current).expulsionBallots).toEqual([]);
      expect(current.game.nationalMdaAllies(C)).toEqual([]);
      vote(current, current.b, B, A, version, "stale-expulsion", false);
      command(current, current.b, B, "immediate-betray", {
        type: "national_betray_pact",
      });
      expect(current.game.nationalMdaAllies(A)).toEqual([]);
    }
    const final = await roundTrip(m.game, "plains");
    expect((await roundTrip(replay.game, "plains")).bytes).toEqual(final.bytes);
    console.info(
      "C7C1E1_EXPULSION=2/2 eligible votes, target/outsider/duplicate rejected; Betray immediate",
    );
  });

  it("rejects a cap below current membership, invalidates rejected proposals, and requires all members for amendment", async () => {
    const m = await found(4);
    consent(m, m.b, B, invite(m, B, "join-b"), "b-accept");
    consent(m, m.c, C, invite(m, C, "join-c"), "c-accept");
    const amend = (cap: number) => ({
      type: "national_propose_pact_amendment_v2",
      administratorId: A,
      terms: {
        admission: "leader",
        expulsion: "forbidden",
        membershipCap: cap,
      },
    });
    command(m, m.a, A, "bad-cap", amend(2), false);
    expect(memberView(m).terms.membershipCap).toBe(4);
    command(m, m.a, A, "cap-3", amend(3));
    const oldVersion = memberView(m).pendingAmendment!.defenseVersion!;
    command(m, m.c, C, "reject-proposal", {
      type: "national_reject_pact_amendment_v2",
      expectedDefenseVersion: oldVersion,
    });
    expect(memberView(m).pendingAmendment).toBeNull();
    expect(memberView(m).terms.membershipCap).toBe(4);
    command(m, m.a, A, "cap-3-again", amend(3));
    const freshVersion = memberView(m).pendingAmendment!.defenseVersion!;
    expect(freshVersion).toBeGreaterThan(oldVersion);
    command(
      m,
      m.b,
      B,
      "stale-amendment",
      {
        type: "national_approve_pact_amendment",
        expectedDefenseVersion: oldVersion,
      },
      false,
    );
    command(m, m.b, B, "b-amendment", {
      type: "national_approve_pact_amendment",
      expectedDefenseVersion: freshVersion,
    });
    expect(memberView(m).terms.membershipCap).toBe(4);
    command(m, m.c, C, "c-amendment", {
      type: "national_approve_pact_amendment",
      expectedDefenseVersion: freshVersion,
    });
    expect(memberView(m).terms.membershipCap).toBe(3);
    expect(memberView(m).memberIds).toHaveLength(3);
    const before = m.game.player(C).troops();
    expect(
      m.game.performNationalPoliticalCommandWithOutcome(
        m.game.player(C),
        { kind: "betray-pact", pactId },
        "no-levy-betray",
        CCLIENT,
      ).accepted,
    ).toBe(true);
    expect(m.game.player(C).troops()).toBe(before);
    expect(m.game.nationalMdaAllies(C)).toEqual([]);
  });

  it("five eligible remaining voters need three majority or four supermajority votes", () => {
    const ids = [A, B, C, D, "C7EXTRAE", "C7EXTRAF"];
    for (const rule of ["majority", "supermajority"] as const) {
      const runtime = new NationalRuntime(ids);
      runtime.perform(A, {
        kind: "found-pact",
        pactId,
        name: "Six signatories",
        pactKind: "NAP",
        terms: { admission: "leader", expulsion: rule, membershipCap: 6 },
      });
      const current = () => runtime.snapshot().politics.pacts[0];
      for (const id of ids.slice(1)) {
        const version = current().constitutionVersion!;
        runtime.perform(A, {
          kind: "invite-pact",
          pactId,
          candidateId: id,
          constitutionVersion: version,
          admissionAction: "propose",
        });
        runtime.perform(id, {
          kind: "accept-pact",
          pactId,
          constitutionVersion: version,
        });
      }
      const version = current().constitutionVersion!;
      const target = ids[5];
      const ballot = (id: string) =>
        runtime.perform(id, {
          kind: "expel-pact",
          pactId,
          memberId: target,
          constitutionVersion: version,
        });
      expect(() => ballot(target)).toThrow();
      ballot(A);
      ballot(B);
      expect(current().memberIds).toHaveLength(6);
      ballot(C);
      if (rule === "supermajority") {
        expect(current().memberIds).toHaveLength(6);
        const pending = runtime.snapshot();
        expect(NationalRuntime.restore(pending, ids, 0).snapshot()).toEqual(
          pending,
        );
        const corrupt = structuredClone(pending);
        corrupt.politics.pacts[0].expulsionBallots![0].approvedBy.push(target);
        expect(() => NationalRuntime.restore(corrupt, ids, 0)).toThrow();
        ballot(D);
      }
      expect(current().memberIds).toHaveLength(5);
      expect(current().memberIds).not.toContain(target);
      expect(() => ballot(ids[4])).toThrow();
    }
  });

  it("selected expellers are independent of admission approvers and empire entry revokes pending ballots", () => {
    const runtime = new NationalRuntime([A, B, C, D]);
    runtime.perform(A, {
      kind: "found-pact",
      pactId,
      name: "Separate powers",
      pactKind: "NAP",
      terms: { admission: "leader", expulsion: "forbidden" },
    });
    for (const id of [B, C]) {
      runtime.perform(A, { kind: "invite-pact", pactId, candidateId: id });
      runtime.perform(id, { kind: "accept-pact", pactId });
    }
    runtime.perform(A, {
      kind: "propose-pact-amendment",
      pactId,
      administratorId: A,
      terms: {
        admission: "selected",
        selectedApproverIds: [A],
        expulsion: "selected",
        selectedExpellerIds: [B, C],
      },
    });
    const amendVersion =
      runtime.snapshot().politics.pacts[0].pendingAmendment!.defenseVersion!;
    for (const id of [B, C])
      runtime.perform(id, {
        kind: "approve-pact-amendment",
        pactId,
        expectedDefenseVersion: amendVersion,
      });
    const version = runtime.snapshot().politics.pacts[0].constitutionVersion!;
    expect(() =>
      runtime.perform(A, {
        kind: "expel-pact",
        pactId,
        memberId: C,
        constitutionVersion: version,
      }),
    ).toThrow();
    expect(() =>
      runtime.perform(B, {
        kind: "invite-pact",
        pactId,
        candidateId: D,
        constitutionVersion: version,
        admissionAction: "propose",
      }),
    ).toThrow();
    runtime.perform(B, {
      kind: "expel-pact",
      pactId,
      memberId: A,
      constitutionVersion: version,
    });
    expect(
      runtime.snapshot().politics.pacts[0].expulsionBallots?.[0].approvedBy,
    ).toEqual([B]);
    runtime.perform(C, { kind: "found-empire", empireId: "c7_empire" });
    const updated = runtime.snapshot().politics.pacts[0];
    expect(updated.memberIds).toEqual([A, B].sort());
    expect(updated.expulsionBallots).toBeUndefined();
    expect(updated.terms.selectedExpellerIds).toEqual([B]);
    expect(() =>
      runtime.perform(B, {
        kind: "expel-pact",
        pactId,
        memberId: A,
        constitutionVersion: version,
      }),
    ).toThrow();
  });

  it("does not enable any constitutional command in legacy FFA", async () => {
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
        name: "illegal",
        pactKind: "NAP",
        terms: { admission: "leader", expulsion: "majority", membershipCap: 3 },
      }),
    ).toThrow(/NATIONAL/);
  });
});
