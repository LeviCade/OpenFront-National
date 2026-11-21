/**
 * R11 E1 NEW M5/WAR-05 vertical slice: persisted, revocable imperial
 * NATIONAL peace delegation alters the actual Game-owned WAR ledger.
 *
 * Existing R10 founding/accession/crown mechanics are setup, NOT claimed
 * as new. E2 owns adding the new grant/revoke stamped wire intent; until
 * that separate owner change is integrated, grants enter through E2's
 * existing snapshot-safe NationalFoundEmpireExecution and real GameRunner.
 * NATIONAL peace proposals/acceptance below ARE genuinely stamped wire intents.
 */
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationalFoundEmpireExecution } from "@openfront/engine/execution/NationalFoundEmpireExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameSnapshot } from "@openfront/engine/game/GameImpl";
import { GameRunner } from "@openfront/engine/GameRunner";
import type { NationalCommand } from "@openfront/engine/national/NationalRuntime";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const id = "r11-governance";
const empire = "r11_empire";
const people = [
  new PlayerInfo("Ruler", PlayerType.Human, "R11CLIA1", "R11RULE1"),
  new PlayerInfo("Member", PlayerType.Human, "R11CLIB1", "R11MEMB1"),
  new PlayerInfo("Outside", PlayerType.Human, "R11CLIC1", "R11OUTS1"),
  new PlayerInfo("Foreign", PlayerType.Human, "R11CLID1", "R11OUTS2"),
];
const [A, B, C, D] = people.map((x) => x.id);
const [ca, cb, cc, cd] = people.map((x) => x.clientID!);

async function spawned(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, people);
  for (let i = 0; i < people.length; i++) {
    const x = i % 2 === 0 ? 25 : 75;
    const y = i < 2 ? 25 : 75;
    game.addExecution(new SpawnExecution(id, people[i], game.ref(x, y)));
  }
  game.executeNextTick();
  game.executeNextTick();
  for (const info of people)
    expect(game.player(info.id).hasSpawned()).toBe(true);
  return game;
}

function principal(game: Game, clientID: string) {
  const errors: string[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, id, undefined),
    (packet) => {
      if ("errMsg" in packet) errors.push(packet.errMsg);
    },
    // E3 owns the NEW political-result packet mapping. Until that separate
    // packet contract lands, exercise authenticated stamped Executor input
    // without impersonating an E3-verified private browser recipient.
    undefined,
  );
  return { runner, errors, clientID };
}

type Principal = ReturnType<typeof principal>;
function advance(
  game: Game,
  actor: Principal,
  command?: Record<string, unknown>,
) {
  actor.runner.addTurn({
    turnNumber: game.ticks(),
    intents: command
      ? [StampedIntentSchema.parse({ ...command, clientID: actor.clientID })]
      : [],
  });
  expect(actor.runner.executeNextTick()).toBe(true);
}
function click(game: Game, actor: Principal, command: Record<string, unknown>) {
  advance(game, actor, command);
  advance(game, actor);
}
function grant(
  game: Game,
  actor: Principal,
  memberId: string,
  enabled: boolean,
  requestId: string,
) {
  const command: Exclude<NationalCommand, { kind: "found-empire" }> = {
    kind: "set-national-peace-delegation",
    empireId: empire,
    memberId,
    enabled,
  };
  // E2's actual tick-executed command class, awaiting E2's new intent schema.
  game.addExecution(
    new NationalFoundEmpireExecution(
      game.player(people.find((p) => p.clientID === actor.clientID)!.id),
      "",
      command,
      requestId,
    ),
  );
  advance(game, actor);
  advance(game, actor);
}
function lastWar(game: Game, actorId: string, requestId: string) {
  const receipt = game
    .nationalWarCommandResults(game.player(actorId))
    .find((r) => r.requestId === requestId);
  expect(receipt).toBeDefined();
  return receipt!;
}
function lastPolicy(game: Game, actorId: string, requestId: string) {
  const receipt = game
    .nationalPoliticalCommandResults(game.player(actorId))
    .find((r) => r.requestId === requestId);
  expect(receipt).toBeDefined();
  return receipt!;
}
function delegated(game: Game): string[] {
  const policy = game.nationalPoliticalAuthority();
  expect(policy).not.toBeNull();
  return game.nationalPoliticalAuthority()!.maySettleNational(B) ? [B] : [];
}

describe("R11 new live imperial NATIONAL peace delegation (M5/WAR-05)", () => {
  it("emperor grants/revokes member national peace; stamped war changes, imperial exclusivity, replay and crown wipe", async () => {
    const game = await spawned();
    const a = principal(game, ca);
    const b = principal(game, cb);
    const c = principal(game, cc);
    const d = principal(game, cd);
    click(game, a, {
      type: "national_found_empire",
      empireId: empire,
      requestId: "r11-found",
    });
    click(game, a, {
      type: "national_offer_empire",
      empireId: empire,
      candidateId: B,
      requestId: "r11-offer",
    });
    click(game, b, {
      type: "national_accept_empire",
      empireId: empire,
      candidateId: B,
      requestId: "r11-accept",
    });
    expect(game.nationalPoliticalAuthority()?.membersOf(empire)).toEqual(
      [A, B].sort(),
    );
    expect(delegated(game)).toEqual([]);

    // Emperor starts a real national war ON BEHALF OF B.
    click(game, a, {
      type: "national_declare_war",
      scope: "national",
      nationId: B,
      targetId: C,
      targetKind: "nation",
      requestId: "r11-war-national",
    });
    const national = lastWar(game, A, "r11-war-national");
    expect(national.accepted).toBe(true);
    const nationalId = national.warId!;
    // Independently, the empire itself is at war with D.
    click(game, a, {
      type: "national_declare_war",
      scope: "imperial",
      nationId: A,
      targetId: D,
      targetKind: "nation",
      requestId: "r11-war-imperial",
    });
    const imperial = lastWar(game, A, "r11-war-imperial");
    expect(imperial.accepted).toBe(true);
    const imperialId = imperial.warId!;
    expect(game.nationalWarState()?.wars.layers).toHaveLength(2);

    click(game, b, {
      type: "national_propose_peace",
      warId: nationalId,
      requestId: "r11-denied-unappointed",
    });
    expect(lastWar(game, B, "r11-denied-unappointed").accepted).toBe(false);
    grant(game, c, B, true, "r11-forged-outsider");
    expect(lastPolicy(game, C, "r11-forged-outsider").accepted).toBe(false);
    grant(game, b, B, true, "r11-forged-member");
    expect(lastPolicy(game, B, "r11-forged-member").accepted).toBe(false);
    expect(delegated(game)).toEqual([]);

    grant(game, a, B, true, "r11-grant-first");
    expect(lastPolicy(game, A, "r11-grant-first")).toMatchObject({
      accepted: true,
      actorId: A,
      recipientId: A,
      commandKind: "set-national-peace-delegation",
    });
    expect(delegated(game)).toEqual([B]);
    expect(game.nationalPoliticalAuthority()?.mayDeclareNational(B)).toBe(
      false,
    );
    click(game, b, {
      type: "national_propose_peace",
      warId: imperialId,
      requestId: "r11-denied-imperial",
    });
    expect(lastWar(game, B, "r11-denied-imperial").accepted).toBe(false);

    // Revocation changes law immediately and does not touch the WAR ledgers.
    const beforeRevoke = game.nationalWarState()?.wars.layers;
    grant(game, a, B, false, "r11-revoke");
    expect(lastPolicy(game, A, "r11-revoke").accepted).toBe(true);
    expect(game.nationalWarState()?.wars.layers).toEqual(beforeRevoke);
    click(game, b, {
      type: "national_propose_peace",
      warId: nationalId,
      requestId: "r11-denied-revoked",
    });
    expect(lastWar(game, B, "r11-denied-revoked").accepted).toBe(false);

    grant(game, a, B, true, "r11-grant-second");
    expect(lastPolicy(game, A, "r11-grant-second").accepted).toBe(true);
    click(game, b, {
      type: "national_propose_peace",
      warId: nationalId,
      requestId: "r11-delegate-peace",
    });
    const peace = lastWar(game, B, "r11-delegate-peace");
    expect(peace.accepted).toBe(true);
    expect(peace.motionId).toBeDefined();
    click(game, c, {
      type: "national_accept_peace",
      motionId: peace.motionId,
      requestId: "r11-accept-delegated-peace",
    });
    expect(lastWar(game, C, "r11-accept-delegated-peace").accepted).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(B, C)).toBe(false);
    expect(game.nationalWarAuthority()?.authorizeOffensiveAction(B, C)).toBe(
      false,
    );
    expect(game.nationalWarAuthority()?.atWar(B, D)).toBe(true);
    expect(
      game.nationalWarState()?.wars.layers.find((l) => l.id === imperialId)
        ?.endedTick,
    ).toBeNull();

    // Pre-transfer snapshot has a real grant. Reconnect/replay preserves it.
    const {
      restored: withGrant,
      bytes,
      again,
    } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(withGrant.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(
      true,
    );
    expect(
      readVersioned(
        GameSnapshot,
        snapshotGameData(withGrant).game,
      ).national?.politics.empires.find((e) => e.id === empire)
        ?.delegatedNationalPeace,
    ).toEqual([B]);
    expect(withGrant.nationalWarState()).toEqual(game.nationalWarState());

    // Old throne appointments expire atomically upon lawful succession.
    click(game, a, {
      type: "national_transfer_crown",
      empireId: empire,
      successorId: B,
      requestId: "r11-crown",
    });
    expect(lastPolicy(game, A, "r11-crown").accepted).toBe(true);
    expect(game.nationalPoliticalAuthority()?.emperorOf(empire)).toBe(B);
    expect(
      readVersioned(
        GameSnapshot,
        snapshotGameData(game).game,
      ).national?.politics.empires.find((e) => e.id === empire)
        ?.delegatedNationalPeace,
    ).toBeUndefined();
    expect(game.nationalPoliticalAuthority()?.maySettleNational(A)).toBe(false);
    expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(true);
    // A's target is now a valid subordinate. ONLY A's former status denies.
    grant(game, a, A, true, "r11-former-grant");
    expect(lastPolicy(game, A, "r11-former-grant").accepted).toBe(false);
    // The reigning successor can grant and rescind that SAME lawful power.
    grant(game, b, A, true, "r11-successor-grant");
    expect(lastPolicy(game, B, "r11-successor-grant").accepted).toBe(true);
    expect(game.nationalPoliticalAuthority()?.maySettleNational(A)).toBe(true);
    grant(game, b, A, false, "r11-successor-revoke");
    expect(lastPolicy(game, B, "r11-successor-revoke").accepted).toBe(true);
    expect(game.nationalPoliticalAuthority()?.maySettleNational(A)).toBe(false);
    click(game, a, {
      type: "national_propose_peace",
      warId: imperialId,
      requestId: "r11-former-imperial",
    });
    expect(lastWar(game, A, "r11-former-imperial").accepted).toBe(false);
    click(game, b, {
      type: "national_propose_peace",
      warId: imperialId,
      requestId: "r11-new-ruler-imperial",
    });
    expect(lastWar(game, B, "r11-new-ruler-imperial").accepted).toBe(true);
    expect(
      game.nationalWarState()?.wars.layers.find((l) => l.id === imperialId)
        ?.endedTick,
    ).toBeNull();
    expect(game.nationalVictoryRoster()).toBeNull();

    const {
      restored,
      bytes: crownBytes,
      again: crownAgain,
    } = await roundTrip(game, "plains");
    expect(crownAgain).toEqual(crownBytes);
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    expect(restored.nationalPoliticalAuthority()?.emperorOf(empire)).toBe(B);
    expect(restored.nationalPoliticalAuthority()?.maySettleNational(A)).toBe(
      false,
    );
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    const restoredViewer = principal(restored, ca);
    for (let i = 0; i < 3; i++) {
      advance(game, a);
      advance(restored, restoredViewer);
      expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    }
    expect(restoredViewer.errors).toEqual([]);
    for (const actor of [a, b, c, d]) expect(actor.errors).toEqual([]);
  });

  it("refuses fake policy principals and invalid heirs without changing canonical snapshot", async () => {
    const game = await spawned();
    const a = principal(game, ca);
    const b = principal(game, cb);
    click(game, a, {
      type: "national_found_empire",
      empireId: empire,
      requestId: "r11-2-found",
    });
    click(game, a, {
      type: "national_offer_empire",
      empireId: empire,
      candidateId: B,
      requestId: "r11-2-offer",
    });
    click(game, b, {
      type: "national_accept_empire",
      empireId: empire,
      candidateId: B,
      requestId: "r11-2-join",
    });
    const before = snapshotGameData(game);
    const forged = new Proxy(game.player(A), {});
    // A borrowed Player is not registered; cannot become an imperial principal.
    expect(() =>
      game.performNationalPoliticalCommandWithOutcome(
        forged,
        {
          kind: "set-national-peace-delegation",
          empireId: empire,
          memberId: B,
          enabled: true,
        },
        "r11-2-forged",
      ),
    ).toThrow(/forged actor/);
    expect(snapshotGameData(game)).toEqual(before);
    grant(game, a, C, true, "r11-2-foreign-target");
    expect(lastPolicy(game, A, "r11-2-foreign-target").accepted).toBe(false);
    expect(game.nationalPoliticalAuthority()?.maySettleNational(C)).toBe(true);
    expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(false);
    grant(game, a, A, true, "r11-2-self");
    expect(lastPolicy(game, A, "r11-2-self").accepted).toBe(false);
    grant(game, a, B, true, "r11-2-valid");
    expect(lastPolicy(game, A, "r11-2-valid").accepted).toBe(true);
    grant(game, a, B, true, "r11-2-duplicate-policy");
    expect(lastPolicy(game, A, "r11-2-duplicate-policy").accepted).toBe(false);
    const beforeReplay = game.nationalPoliticalCommandResults(game.player(A));
    grant(game, a, B, true, "r11-2-valid");
    expect(game.nationalPoliticalCommandResults(game.player(A))).toEqual(
      beforeReplay,
    );
  });

  it("wipes delegated peace for a surviving subordinate when a THIRD member inherits the crown", async () => {
    const game = await spawned();
    const a = principal(game, ca);
    const b = principal(game, cb);
    const c = principal(game, cc);
    const d = principal(game, cd);
    click(game, a, {
      type: "national_found_empire",
      empireId: empire,
      requestId: "r11-third-found",
    });
    for (const [recipient, player, token] of [
      [b, B, "bravo"],
      [c, C, "charlie"],
    ] as const) {
      click(game, a, {
        type: "national_offer_empire",
        empireId: empire,
        candidateId: player,
        requestId: "r11-third-offer-" + token,
      });
      expect(game.nationalAccessionOffers(game.player(player))).toHaveLength(1);
      expect(game.nationalAccessionOffers(game.player(D))).toEqual([]);
      click(game, recipient, {
        type: "national_accept_empire",
        empireId: empire,
        candidateId: player,
        requestId: "r11-third-accept-" + token,
      });
    }
    expect(game.nationalPoliticalAuthority()?.membersOf(empire)).toEqual(
      [A, B, C].sort(),
    );

    click(game, a, {
      type: "national_declare_war",
      scope: "national",
      nationId: B,
      targetId: D,
      targetKind: "nation",
      requestId: "r11-third-national-war",
    });
    const national = lastWar(game, A, "r11-third-national-war");
    expect(national.accepted).toBe(true);
    click(game, a, {
      type: "national_declare_war",
      scope: "imperial",
      nationId: A,
      targetId: D,
      targetKind: "nation",
      requestId: "r11-third-imperial-war",
    });
    const imperial = lastWar(game, A, "r11-third-imperial-war");
    expect(imperial.accepted).toBe(true);
    const before = game.nationalWarState()?.wars.layers;
    expect(before).toHaveLength(2);

    grant(game, a, B, true, "r11-third-first-grant");
    expect(lastPolicy(game, A, "r11-third-first-grant").accepted).toBe(true);
    expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(true);

    // B remains a subordinate when a different member (C) inherits.
    click(game, a, {
      type: "national_transfer_crown",
      empireId: empire,
      successorId: C,
      requestId: "r11-third-transfer",
    });
    expect(lastPolicy(game, A, "r11-third-transfer").accepted).toBe(true);
    expect(game.nationalPoliticalAuthority()?.emperorOf(empire)).toBe(C);
    expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(false);
    expect(game.nationalWarState()?.wars.layers).toEqual(before);
    expect(
      readVersioned(
        GameSnapshot,
        snapshotGameData(game).game,
      ).national?.politics.empires.find((x) => x.id === empire)
        ?.delegatedNationalPeace,
    ).toBeUndefined();
    click(game, b, {
      type: "national_propose_peace",
      warId: national.warId,
      requestId: "r11-third-denied-after-transfer",
    });
    expect(lastWar(game, B, "r11-third-denied-after-transfer").accepted).toBe(
      false,
    );
    grant(game, a, B, true, "r11-third-former-crown-denied");
    expect(lastPolicy(game, A, "r11-third-former-crown-denied").accepted).toBe(
      false,
    );

    // New emperor C, not the old crown A, may restore B's national-only right.
    grant(game, c, B, true, "r11-third-successor-grant");
    expect(lastPolicy(game, C, "r11-third-successor-grant").accepted).toBe(
      true,
    );
    expect(game.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(true);
    click(game, b, {
      type: "national_propose_peace",
      warId: imperial.warId,
      requestId: "r11-third-imperial-denied",
    });
    expect(lastWar(game, B, "r11-third-imperial-denied").accepted).toBe(false);
    click(game, b, {
      type: "national_propose_peace",
      warId: national.warId,
      requestId: "r11-third-national-proposal",
    });
    const peace = lastWar(game, B, "r11-third-national-proposal");
    expect(peace.accepted).toBe(true);
    click(game, d, {
      type: "national_accept_peace",
      motionId: peace.motionId,
      requestId: "r11-third-foreign-accept",
    });
    expect(lastWar(game, D, "r11-third-foreign-accept").accepted).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(B, D)).toBe(true);
    expect(
      game
        .nationalWarState()
        ?.wars.layers.find((layer) => layer.id === imperial.warId)?.endedTick,
    ).toBeNull();
    expect(
      game
        .nationalWarState()
        ?.wars.layers.find((layer) => layer.id === national.warId)?.endedTick,
    ).not.toBeNull();

    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(restored.nationalPoliticalAuthority()?.emperorOf(empire)).toBe(C);
    expect(restored.nationalPoliticalAuthority()?.maySettleNational(B)).toBe(
      true,
    );
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    const twin = principal(restored, ca);
    for (let i = 0; i < 3; i++) {
      advance(game, a);
      advance(restored, twin);
      expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    }
  });
});
