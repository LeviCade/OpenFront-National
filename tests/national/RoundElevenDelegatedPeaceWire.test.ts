/**
 * R11 E2 / First Conductor Second Class: the new M5 grant/revoke command is
 * authenticated by stamped clientID, stored by E2 snapshot, and executed by
 * E1's Game-owned journal. No mocked principal, no substituted direct helper.
 *
 * The FIRST test runs on standalone E2 source. The E1 vertical slice runs
 * when E1's separately owned NationalRuntime lands in the assembled tree;
 * R11 combined CI MUST execute it, not skip or treat a draft as acceptance.
 */
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationalFoundEmpireExecution } from "@openfront/engine/execution/NationalFoundEmpireExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { NationalRuntime } from "@openfront/engine/national/NationalRuntime";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const MATCH = "r11-e2-peace-grant";
const EMPIRE = "r11_delegate_empire";
const people = [
  new PlayerInfo("Emperor", PlayerType.Human, "R11GOVC1", "R11GOVE1"),
  new PlayerInfo("Member", PlayerType.Human, "R11GOVC2", "R11GOVM2"),
  new PlayerInfo("Opponent", PlayerType.Human, "R11GOVC3", "R11GOVO3"),
  new PlayerInfo("Imperial foe", PlayerType.Human, "R11GOVC4", "R11GOVO4"),
];
const [A, B, C, D] = people.map((p) => p.id);
const [CA, CB, CC, CD] = people.map((p) => p.clientID!);
const E1_DELEGATION_INTEGRATED =
  typeof (
    NationalRuntime.prototype as typeof NationalRuntime.prototype & {
      hasDelegatedNationalPeace?: (memberId: string) => boolean;
    }
  ).hasDelegatedNationalPeace === "function";

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
  for (const person of people)
    expect(game.player(person.id).hasSpawned()).toBe(true);
  return game;
}
function connect(game: Game, clientID: string) {
  const packets: GameUpdateViewData[] = [];
  const errors: string[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, MATCH, clientID),
    (packet) => {
      if ("updates" in packet) packets.push(packet);
      else errors.push(String(packet.errMsg));
    },
    clientID,
  );
  return { runner, packets, errors, clientID };
}
type Session = ReturnType<typeof connect>;
function turn(game: Game, session: Session, intent?: Record<string, unknown>) {
  session.runner.addTurn({
    turnNumber: game.ticks(),
    intents: intent
      ? [StampedIntentSchema.parse({ ...intent, clientID: session.clientID })]
      : [],
  });
  expect(session.runner.executeNextTick()).toBe(true);
}
function click(game: Game, session: Session, intent: Record<string, unknown>) {
  turn(game, session, intent);
  turn(game, session);
}
function grant(
  game: Game,
  session: Session,
  enabled: boolean,
  requestId: string,
  memberId = B,
) {
  click(game, session, {
    type: "national_set_peace_delegation",
    empireId: EMPIRE,
    memberId,
    enabled,
    requestId,
  });
}
function policy(game: Game, actor: string, requestId: string) {
  const receipt = game
    .nationalPoliticalCommandResults(game.player(actor))
    .find((entry) => entry.requestId === requestId);
  expect(receipt).toBeDefined();
  return receipt!;
}
function war(game: Game, actor: string, requestId: string) {
  const receipt = game
    .nationalWarCommandResults(game.player(actor))
    .find((entry) => entry.requestId === requestId);
  expect(receipt).toBeDefined();
  return receipt!;
}
function privateResults(session: Session) {
  return session.packets.flatMap((p) => p.nationalCommandResults ?? []);
}

describe("R11 E2 authenticated national-peace delegation execution", () => {
  it("strictly validates and preserves a pending, actor-bound new command in snapshot", async () => {
    expect(() =>
      StampedIntentSchema.parse({
        type: "national_set_peace_delegation",
        clientID: CA,
        empireId: EMPIRE,
        memberId: B,
        enabled: "yes",
        requestId: "r11_wrong_bool",
      }),
    ).toThrow();
    expect(() =>
      StampedIntentSchema.parse({
        type: "national_set_peace_delegation",
        clientID: CA,
        empireId: EMPIRE,
        memberId: B,
        enabled: true,
        requestId: "illegal token with spaces",
      }),
    ).toThrow();
    const game = await match();
    const command = StampedIntentSchema.parse({
      type: "national_set_peace_delegation",
      empireId: EMPIRE,
      memberId: B,
      enabled: true,
      requestId: "r11_pending_snapshot",
      clientID: CA,
    });
    const wrongIdentity = StampedIntentSchema.parse({
      ...command,
      clientID: "R11NOBODY",
    });
    const manager = new Executor(game, MATCH, CA);
    const rejectedExec = manager.createExec(wrongIdentity);
    expect(rejectedExec.constructor.name).toBe("NoOpExecution");
    const authentic = manager.createExec(command);
    expect(authentic).toBeInstanceOf(NationalFoundEmpireExecution);
    game.addExecution(authentic);
    // This is the exact unsettled execution state that E2's v3 Zod union
    // failed to encode when E1 first introduced the new kind.
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    expect(
      restored.executions().some(
        (e) => e instanceof NationalFoundEmpireExecution && e.isActive(),
      ),
    ).toBe(true);
  });

  it.runIf(E1_DELEGATION_INTEGRATED)(
    "real stamped E1 grant/revoke, member settlement, separate imperial law, crown wipe and recipient replay",
    async () => {
      const game = await match();
      const ruler = connect(game, CA);
      const member = connect(game, CB);
      const opposing = connect(game, CC);
      const imperialFoe = connect(game, CD);
      click(game, ruler, {
        type: "national_found_empire",
        empireId: EMPIRE,
        requestId: "r11_gov_found",
      });
      click(game, ruler, {
        type: "national_offer_empire",
        empireId: EMPIRE,
        candidateId: B,
        requestId: "r11_gov_offer",
      });
      click(game, member, {
        type: "national_accept_empire",
        empireId: EMPIRE,
        candidateId: B,
        requestId: "r11_gov_accept",
      });
      expect(game.nationalPoliticalAuthority()?.membersOf(EMPIRE)).toEqual(
        [A, B].sort(),
      );
      expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(false);

      // The reigning emperor (A) starts a NATIONAL B-C war and a separate
      // IMPERIAL war against D, both through normal stamped GameRunner turns.
      click(game, ruler, {
        type: "national_declare_war",
        scope: "national",
        nationId: B,
        targetKind: "nation",
        targetId: C,
        requestId: "r11_gov_national_war",
      });
      const national = war(game, A, "r11_gov_national_war");
      expect(national.accepted).toBe(true);
      click(game, ruler, {
        type: "national_declare_war",
        scope: "imperial",
        nationId: A,
        targetKind: "nation",
        targetId: D,
        requestId: "r11_gov_imperial_war",
      });
      const imperial = war(game, A, "r11_gov_imperial_war");
      expect(imperial.accepted).toBe(true);
      const nationalId = national.warId!;
      const imperialId = imperial.warId!;

      click(game, member, {
        type: "national_propose_peace",
        warId: nationalId,
        requestId: "r11_pregrant_deny",
      });
      expect(war(game, B, "r11_pregrant_deny").accepted).toBe(false);
      grant(game, opposing, true, "r11_foreign_forgery");
      expect(policy(game, C, "r11_foreign_forgery").accepted).toBe(false);
      grant(game, member, true, "r11_member_forgery");
      expect(policy(game, B, "r11_member_forgery").accepted).toBe(false);
      expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(false);

      grant(game, ruler, true, "r11_emperor_grant");
      expect(policy(game, A, "r11_emperor_grant")).toMatchObject({
        accepted: true,
        actorId: A,
        recipientId: A,
        commandKind: "set-national-peace-delegation",
        commandTargetId: EMPIRE,
      });
      expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(true);
      expect(game.nationalPoliticalAuthority()?.mayDeclareNational(B)).toBe(false);
      // E3 alone projects the actual actor-bound receipt, not E2.
      expect(
        privateResults(ruler).filter((entry) => entry.requestId === "r11_emperor_grant"),
      ).toEqual([
        expect.objectContaining({
          type: "national_set_peace_delegation",
          actorId: A,
          recipientId: A,
          accepted: true,
          commandTargetId: EMPIRE,
        }),
      ]);
      expect(
        privateResults(member).some((r) => r.requestId === "r11_emperor_grant"),
      ).toBe(false);
      expect(
        privateResults(opposing).some((r) => r.requestId === "r11_emperor_grant"),
      ).toBe(false);

      // Delegation is NATIONAL ONLY; the same actor cannot settle IMPERIAL.
      click(game, member, {
        type: "national_propose_peace",
        warId: imperialId,
        requestId: "r11_no_imperial_member",
      });
      expect(war(game, B, "r11_no_imperial_member").accepted).toBe(false);

      const layersBeforeRevoke = game.nationalWarState()?.wars.layers;
      grant(game, ruler, false, "r11_emperor_revoke");
      expect(policy(game, A, "r11_emperor_revoke").accepted).toBe(true);
      expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(false);
      expect(game.nationalWarState()?.wars.layers).toEqual(layersBeforeRevoke);
      click(game, member, {
        type: "national_propose_peace",
        warId: nationalId,
        requestId: "r11_revoked_deny",
      });
      expect(war(game, B, "r11_revoked_deny").accepted).toBe(false);

      grant(game, ruler, true, "r11_granted_again");
      expect(policy(game, A, "r11_granted_again").accepted).toBe(true);
      click(game, member, {
        type: "national_propose_peace",
        warId: nationalId,
        requestId: "r11_member_proposes",
      });
      const proposal = war(game, B, "r11_member_proposes");
      expect(proposal.accepted).toBe(true);
      expect(proposal.motionId).toBeDefined();
      click(game, opposing, {
        type: "national_accept_peace",
        motionId: proposal.motionId,
        requestId: "r11_opponent_accepts",
      });
      expect(war(game, C, "r11_opponent_accepts").accepted).toBe(true);
      expect(game.nationalWarAuthority()?.atWar(B, C)).toBe(false);
      expect(game.nationalWarAuthority()?.atWar(B, D)).toBe(true);
      expect(game.nationalWarState()?.wars.layers.find((l) => l.id === imperialId)?.endedTick).toBeNull();
      expect(privateResults(member).some((x) => x.requestId === "r11_member_proposes" && x.recipientId === B)).toBe(true);
      expect(privateResults(opposing).some((x) => x.requestId === "r11_opponent_accepts" && x.recipientId === C)).toBe(true);
      // A foreign participant cannot see either of those private results.
      turn(game, imperialFoe);
      expect(privateResults(imperialFoe)).toEqual([]);
      const { restored: withGrant, bytes, again } = await roundTrip(game, "plains");
      expect(again).toEqual(bytes);
      expect(withGrant.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(true);

      click(game, ruler, {
        type: "national_transfer_crown",
        empireId: EMPIRE,
        successorId: B,
        requestId: "r11_appoint_new_emperor",
      });
      expect(policy(game, A, "r11_appoint_new_emperor").accepted).toBe(true);
      expect(game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(B);
      expect(game.nationalPoliticalAuthority()?.maySettleNational(A)).toBe(false);
      // Former A cannot appoint itself; new emperor B may lawfully grant
      // A, then immediately revoke. No stale appointment persists.
      grant(game, ruler, true, "r11_former_emperor_cannot_grant", A);
      expect(policy(game, A, "r11_former_emperor_cannot_grant").accepted).toBe(false);
      grant(game, member, true, "r11_new_emperor_grants", A);
      expect(policy(game, B, "r11_new_emperor_grants").accepted).toBe(true);
      expect(game.nationalPoliticalAuthority()?.maySettleNational(A)).toBe(true);
      grant(game, member, false, "r11_new_emperor_revokes", A);
      expect(policy(game, B, "r11_new_emperor_revokes").accepted).toBe(true);
      expect(game.nationalPoliticalAuthority()?.maySettleNational(A)).toBe(false);
      click(game, ruler, {
        type: "national_propose_peace",
        warId: imperialId,
        requestId: "r11_former_imperial_denied",
      });
      expect(war(game, A, "r11_former_imperial_denied").accepted).toBe(false);
      click(game, member, {
        type: "national_propose_peace",
        warId: imperialId,
        requestId: "r11_new_imperial_proposal",
      });
      expect(war(game, B, "r11_new_imperial_proposal").accepted).toBe(true);

      const { restored, bytes: finalBytes, again: finalAgain } = await roundTrip(game, "plains");
      expect(finalAgain).toEqual(finalBytes);
      expect(restored.nationalWarState()).toEqual(game.nationalWarState());
      expect(restored.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(B);
      const replaySession = connect(restored, CA);
      for (let i = 0; i < 3; i++) {
        turn(game, ruler);
        turn(restored, replaySession);
        // Game-state replay identity is independent of E3's packet cursors.
        expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
      }
      expect(replaySession.errors).toEqual([]);
      expect(ruler.errors).toEqual([]);
      expect(member.errors).toEqual([]);
      expect(opposing.errors).toEqual([]);
      expect(imperialFoe.errors).toEqual([]);
    },
  );
});
