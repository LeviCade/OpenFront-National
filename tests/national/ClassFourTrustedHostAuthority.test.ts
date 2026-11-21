/**
 * E1 Fourth Class: trusted-host NATIONAL political authority and war boundary.
 *
 * A stamped Turn is an internal SERVER artifact, not a browser API. E2 must
 * authenticate and overwrite the sender's clientID before calling Executor.
 * These tests use the real Game/Executor/GameRunner and additionally verify
 * the Game-owned execution-session check when a queued actor is replaced.
 * They do NOT claim the current Private browser simulation is trusted.
 */
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const MATCH = "class4-e1-trusted-game";
const EMPIRE = "class4_security_empire";
const people = [
  new PlayerInfo("Crown", PlayerType.Human, "C4SESS_A1", "C4KING_A"),
  new PlayerInfo("Delegate", PlayerType.Human, "C4SESS_B1", "C4MEM_B"),
  new PlayerInfo("Heir", PlayerType.Human, "C4SESS_C1", "C4MEM_C"),
  new PlayerInfo("Foreign", PlayerType.Human, "C4SESS_D1", "C4OUT_D"),
];
const [A, B, C, D] = people.map((p) => p.id);
const [CA, CB, CC, CD] = people.map((p) => p.clientID!);
type Session = ReturnType<typeof connect>;

async function match(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, people);
  const cells: [number, number][] = [
    [25, 25],
    [75, 25],
    [25, 75],
    [75, 75],
  ];
  for (let i = 0; i < people.length; i++) {
    const [x, y] = cells[i];
    game.addExecution(new SpawnExecution(MATCH, people[i], game.ref(x, y)));
  }
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const p of people) expect(game.player(p.id).hasSpawned()).toBe(true);
  return game;
}

function connect(game: Game, clientID: string) {
  const packets: { nationalCommandResults?: readonly { requestId?: string; actorId: string; recipientId: string; type: string; accepted: boolean }[] }[] = [];
  const errors: string[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, MATCH, clientID),
    (packet) => {
      if ("updates" in packet) packets.push(packet);
      else errors.push(packet.errMsg);
    },
    clientID,
  );
  return { clientID, packets, errors, runner };
}
function tick(game: Game, session: Session, requested?: Record<string, unknown>) {
  session.runner.addTurn({
    turnNumber: game.ticks(),
    intents: requested
      ? [StampedIntentSchema.parse({ ...requested, clientID: session.clientID })]
      : [],
  });
  expect(session.runner.executeNextTick()).toBe(true);
}
function click(game: Game, session: Session, requested: Record<string, unknown>) {
  tick(game, session, requested);
  tick(game, session);
}
function receipt(game: Game, actor: string, token: string) {
  const found = game
    .nationalPoliticalCommandResults(game.player(actor))
    .find((r) => r.requestId === token);
  expect(found).toBeDefined();
  return found!;
}
function warReceipt(game: Game, actor: string, token: string) {
  const found = game
    .nationalWarCommandResults(game.player(actor))
    .find((r) => r.requestId === token);
  expect(found).toBeDefined();
  return found!;
}
function delegation(memberId: string, enabled: boolean) {
  return {
    kind: "set-national-peace-delegation" as const,
    empireId: EMPIRE,
    memberId,
    enabled,
  };
}
function grant(
  game: Game,
  session: Session,
  memberId: string,
  enabled: boolean,
  token: string,
) {
  click(game, session, {
    type: "national_set_peace_delegation",
    empireId: EMPIRE,
    memberId,
    enabled,
    requestId: token,
  });
}
function results(session: Session, token: string) {
  return session.packets
    .flatMap((p) => p.nationalCommandResults ?? [])
    .filter((r) => r.requestId === token);
}
function join(game: Game, a: Session, target: Session, targetId: string, tag: string) {
  click(game, a, {
    type: "national_offer_empire",
    empireId: EMPIRE,
    candidateId: targetId,
    requestId: "c4_offer_" + tag,
  });
  click(game, target, {
    type: "national_accept_empire",
    empireId: EMPIRE,
    candidateId: targetId,
    requestId: "c4_accept_" + tag,
  });
}

describe("Class Four Game-owned NATIONAL trusted-host execution authority", () => {
  it("rejects spoofed, mismatched, and stale controller identities BEFORE journal receipt lookup", async () => {
    const game = await match();
    const a = connect(game, CA);
    const b = connect(game, CB);
    const d = connect(game, CD);
    click(game, a, {
      type: "national_found_empire",
      empireId: EMPIRE,
      requestId: "c4_found_secure",
    });
    join(game, a, b, B, "member");
    const crown = game.player(A);
    const member = game.player(B);
    const forged = new Proxy(crown, {});

    // The authenticated server binds the ORIGINAL session at admission.
    // Identity and role are both rechecked by Game before a mutation.
    const before = snapshotGameData(game);
    expect(() =>
      game.performNationalPoliticalCommandWithOutcome(
        forged,
        delegation(B, true),
        "c4_proxy",
        CA,
      ),
    ).toThrow(/forged actor/);
    expect(() =>
      game.performNationalPoliticalCommandWithOutcome(
        crown,
        delegation(B, true),
        "c4_wrong_session",
        CB,
      ),
    ).toThrow(/stale authenticated actor session/);
    expect(() =>
      game.performNationalFoundEmpireWithOutcome(
        crown,
        "another_empire",
        "c4_forge_found",
        CB,
      ),
    ).toThrow(/stale authenticated actor session/);
    expect(() =>
      game.performNationalWarCommandWithOutcome(
        crown,
        {
          kind: "declare-national",
          warId: "c4_forbidden_war",
          aggressorId: B,
          targetId: D,
        },
        "c4_forge_war",
        CB,
      ),
    ).toThrow(/stale authenticated actor session/);
    expect(snapshotGameData(game)).toEqual(before);

    // A genuine foreign/member controller may submit but gets Game rejection.
    const memberRejected = game.performNationalPoliticalCommandWithOutcome(
      member,
      delegation(B, true),
      "c4_member_attempt",
      CB,
    );
    expect(memberRejected.accepted).toBe(false);
    const outsideRejected = game.performNationalPoliticalCommandWithOutcome(
      game.player(D),
      delegation(B, true),
      "c4_outside_attempt",
      CD,
    );
    expect(outsideRejected.accepted).toBe(false);
    expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(false);

    const granted = game.performNationalPoliticalCommandWithOutcome(
      crown,
      delegation(B, true),
      "c4_original_grant",
      CA,
    );
    expect(granted).toMatchObject({
      accepted: true,
      actorId: A,
      recipientId: A,
      commandTargetId: EMPIRE,
    });
    expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(true);

    // A takeover changes clientID ON THE SAME Player instance. Queued work
    // must retain CA, NOT read crown.clientID() at its later execution tick.
    game.takeoverPlayer(crown, "C4SESS_A2");
    expect(game.player(A)).toBe(crown);
    expect(game.playerByClientID(CA)).toBeNull();
    expect(game.playerByClientID("C4SESS_A2")).toBe(crown);
    const afterTakeover = snapshotGameData(game);
    for (const [cmd, token] of [
      [delegation(B, false), "c4_stale_revoke"],
      [delegation(B, true), "c4_original_grant"],
    ] as const) {
      expect(() =>
        game.performNationalPoliticalCommandWithOutcome(crown, cmd, token, CA),
      ).toThrow(/stale authenticated actor session/);
    }
    expect(() =>
      game.performNationalWarCommandWithOutcome(
        crown,
        {
          kind: "declare-national",
          warId: "c4_stale_war",
          aggressorId: B,
          targetId: D,
        },
        "c4_stale_war_token",
        CA,
      ),
    ).toThrow(/stale authenticated actor session/);
    expect(snapshotGameData(game)).toEqual(afterTakeover);
    expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(true);

    // The legitimate replacement controller may issue a fresh, lawful order.
    const newController = game.performNationalPoliticalCommandWithOutcome(
      crown,
      delegation(B, false),
      "c4_new_controller_revoke",
      "C4SESS_A2",
    );
    expect(newController.accepted).toBe(true);
    expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(false);
    expect(results(d, "c4_original_grant")).toEqual([]);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    expect(d.errors).toEqual([]);
  });

  it("keeps real stamped three-human authority and NATIONAL vs IMPERIAL WAR disjoint across crown transfer and replay", async () => {
    const game = await match();
    const a = connect(game, CA);
    const b = connect(game, CB);
    const c = connect(game, CC);
    const d = connect(game, CD);
    click(game, a, {
      type: "national_found_empire",
      empireId: EMPIRE,
      requestId: "c4_main_found",
    });
    join(game, a, b, B, "b");
    join(game, a, c, C, "c");
    expect(game.nationalPoliticalAuthority()?.membersOf(EMPIRE)).toEqual(
      [A, B, C].sort(),
    );
    click(game, a, {
      type: "national_declare_war",
      scope: "national",
      nationId: B,
      targetId: D,
      targetKind: "nation",
      requestId: "c4_member_war",
    });
    click(game, a, {
      type: "national_declare_war",
      scope: "imperial",
      nationId: A,
      targetId: D,
      targetKind: "nation",
      requestId: "c4_empire_war",
    });
    const national = warReceipt(game, A, "c4_member_war");
    const imperial = warReceipt(game, A, "c4_empire_war");
    expect(national.accepted).toBe(true);
    expect(imperial.accepted).toBe(true);
    expect(game.nationalWarState()?.wars.layers).toHaveLength(2);
    click(game, b, {
      type: "national_propose_peace",
      warId: national.warId,
      requestId: "c4_unappointed_denied",
    });
    expect(warReceipt(game, B, "c4_unappointed_denied").accepted).toBe(false);
    grant(game, d, B, true, "c4_foreign_grant");
    expect(receipt(game, D, "c4_foreign_grant").accepted).toBe(false);
    grant(game, a, B, true, "c4_emperor_grant");
    expect(receipt(game, A, "c4_emperor_grant").accepted).toBe(true);
    expect(results(a, "c4_emperor_grant")).toEqual([
      expect.objectContaining({
        accepted: true,
        type: "national_set_peace_delegation",
        actorId: A,
        recipientId: A,
      }),
    ]);
    expect(results(b, "c4_emperor_grant")).toEqual([]);
    expect(results(c, "c4_emperor_grant")).toEqual([]);
    expect(results(d, "c4_emperor_grant")).toEqual([]);
    expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(true);
    expect(game.nationalPoliticalAuthority()?.mayDeclareNational(B)).toBe(false);
    click(game, b, {
      type: "national_propose_peace",
      warId: imperial.warId,
      requestId: "c4_imperial_denied",
    });
    expect(warReceipt(game, B, "c4_imperial_denied").accepted).toBe(false);
    const priorWar = game.nationalWarState()?.wars.layers;
    grant(game, a, B, false, "c4_emperor_revoke");
    expect(receipt(game, A, "c4_emperor_revoke").accepted).toBe(true);
    expect(game.nationalWarState()?.wars.layers).toEqual(priorWar);
    click(game, b, {
      type: "national_propose_peace",
      warId: national.warId,
      requestId: "c4_revoked_denied",
    });
    expect(warReceipt(game, B, "c4_revoked_denied").accepted).toBe(false);
    grant(game, a, B, true, "c4_regrant");
    expect(receipt(game, A, "c4_regrant").accepted).toBe(true);
    click(game, a, {
      type: "national_transfer_crown",
      empireId: EMPIRE,
      successorId: C,
      requestId: "c4_third_crown",
    });
    expect(receipt(game, A, "c4_third_crown").accepted).toBe(true);
    expect(game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(C);
    expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(false);
    click(game, b, {
      type: "national_propose_peace",
      warId: national.warId,
      requestId: "c4_after_transfer_denied",
    });
    expect(warReceipt(game, B, "c4_after_transfer_denied").accepted).toBe(false);
    grant(game, a, B, true, "c4_old_crown_denied");
    expect(receipt(game, A, "c4_old_crown_denied").accepted).toBe(false);
    grant(game, c, B, true, "c4_new_crown_grant");
    expect(receipt(game, C, "c4_new_crown_grant").accepted).toBe(true);
    click(game, b, {
      type: "national_propose_peace",
      warId: national.warId,
      requestId: "c4_delegate_peace",
    });
    const proposal = warReceipt(game, B, "c4_delegate_peace");
    expect(proposal.accepted).toBe(true);
    click(game, d, {
      type: "national_accept_peace",
      motionId: proposal.motionId,
      requestId: "c4_opponent_accept",
    });
    expect(warReceipt(game, D, "c4_opponent_accept").accepted).toBe(true);
    expect(
      game.nationalWarState()?.wars.layers.find((x) => x.id === national.warId)
        ?.endedTick,
    ).not.toBeNull();
    expect(
      game.nationalWarState()?.wars.layers.find((x) => x.id === imperial.warId)
        ?.endedTick,
    ).toBeNull();

    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    const replay = connect(restored, CA);
    for (let i = 0; i < 3; i++) {
      tick(game, a);
      tick(restored, replay);
      expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    }
    for (const session of [a, b, c, d, replay])
      expect(session.errors).toEqual([]);
  });
});
