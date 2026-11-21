/**
 * R11 E3: real E1 pending offers projected through real E2 GameRunner turns.
 * No cloned political registry, imaginary receipt, mock invitation authority,
 * client-selected observer, leaked pact terms, or stale actionable acceptance.
 */
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { NationalRuntime } from "@openfront/engine/national/NationalRuntime";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import {
  NationalOutboundFilter,
  projectNationalAccessionOffers,
  type NationalAccessionOffersView,
} from "@openfront/engine/national/observation/NationalOutbound";
import type { OutboundNationalResult } from "@openfront/engine/national/observation/NationalPoliticalPacket";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const A = new PlayerInfo("Emperor", PlayerType.Human, "R11CLIA1", "R11ACTA1");
const B = new PlayerInfo("Invitee", PlayerType.Human, "R11CLIB1", "R11ACTB1");
const C = new PlayerInfo("Foreign", PlayerType.Human, "R11CLIC1", "R11ACTC1");
const D = new PlayerInfo("Reverse", PlayerType.Human, "R11CLID1", "R11ACTD1");
const EMPIRE = "r11_real_empire";
const PLAYERS = [A, B, C, D];
const INTEGRATED_DELEGATION =
  typeof (
    NationalRuntime.prototype as typeof NationalRuntime.prototype & {
      hasDelegatedNationalPeace?: (memberId: string) => boolean;
    }
  ).hasDelegatedNationalPeace === "function";

type R11Packet = Omit<GameUpdateViewData, "nationalCommandResults"> & {
  readonly nationalCommandResults?: readonly OutboundNationalResult[];
  readonly nationalAccessionOffers?: NationalAccessionOffersView;
};

async function seeded(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, PLAYERS);
  PLAYERS.forEach((player, i) => {
    game.addExecution(
      new SpawnExecution(
        "r11-private-packets",
        player,
        game.ref(15 + 20 * i, 20 + 15 * i),
      ),
    );
  });
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const player of PLAYERS)
    expect(game.player(player.id).hasSpawned()).toBe(true);
  return game;
}

function session(game: Game, clientID?: string) {
  const packets: R11Packet[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, "r11-private-packets", clientID),
    (data) => {
      // The missing protocol fields are projected by E3; E2 owns their
      // introduction to the shared GameUpdateViewData declaration.
      if ("updates" in data) packets.push(data as R11Packet);
    },
    clientID,
  );
  const next = (command?: Record<string, unknown>): R11Packet => {
    runner.addTurn({
      turnNumber: game.ticks(),
      intents:
        command === undefined ? [] : [StampedIntentSchema.parse(command)],
    });
    expect(runner.executeNextTick()).toBe(true);
    return packets[packets.length - 1];
  };
  const send = (command: Record<string, unknown>): R11Packet => {
    next(command);
    return next();
  };
  const receipts = (requestId: string) =>
    packets
      .flatMap((p) => p.nationalCommandResults ?? [])
      .filter((result) => result.requestId === requestId);
  return { next, send, receipts, packets };
}

function order(
  type:
    | "national_offer_empire"
    | "national_accept_empire"
    | "national_transfer_crown",
  requestId: string,
  clientID: string,
  targetId: string,
) {
  return {
    type,
    empireId: EMPIRE,
    ...(type === "national_transfer_crown"
      ? { successorId: targetId }
      : { candidateId: targetId }),
    requestId,
    clientID,
  };
}
function found() {
  return {
    type: "national_found_empire",
    empireId: EMPIRE,
    requestId: "r11-found-a",
    clientID: A.clientID!,
  };
}
function offers(packet: R11Packet): NationalAccessionOffersView["offers"] {
  expect(packet.nationalAccessionOffers?.version).toBe(1);
  return packet.nationalAccessionOffers!.offers;
}

describe("R11 E3 recipient-only authoritative accession packet matrix", () => {
  it("emperor's actual offer reaches ONLY candidate, with actor-private accepted/rejected receipts", async () => {
    const game = await seeded();
    const emperor = session(game, A.clientID!);
    const invitee = session(game, B.clientID!);
    const foreign = session(game, C.clientID!);
    const spectator = session(game);
    emperor.send(found());
    expect(emperor.receipts("r11-found-a")).toEqual([
      expect.objectContaining({
        type: "national_found_empire",
        actorId: A.id,
        recipientId: A.id,
        requestId: "r11-found-a",
        accepted: true,
      }),
    ]);

    // Queuing a real stamped turn is pending, not authoritative acceptance.
    const pendingOffer = emperor.next(
      order("national_offer_empire", "r11-offer-b", A.clientID!, B.id),
    );
    expect(pendingOffer.nationalCommandResults).toBeUndefined();
    expect(emperor.receipts("r11-offer-b")).toEqual([]);
    // The next ordinary tick executes E2's command through the real E1 journal.
    emperor.next();
    expect(emperor.receipts("r11-offer-b")).toEqual([
      expect.objectContaining({
        type: "national_offer_empire",
        recipientId: A.id,
        actorId: A.id,
        requestId: "r11-offer-b",
        commandTargetId: EMPIRE,
        accepted: true,
        reason: "accepted",
      }),
    ]);
    expect(offers(invitee.next())).toEqual([
      {
        empireId: EMPIRE,
        candidateId: B.id,
        proposerId: A.id,
        recipientId: B.id,
      },
    ]);
    expect(offers(emperor.next())).toEqual([]);
    expect(offers(foreign.next())).toEqual([]);
    const anonymous = spectator.next();
    expect(anonymous).not.toHaveProperty("nationalAccessionOffers");
    expect(anonymous).not.toHaveProperty("nationalCommandResults");
    expect(
      foreign.packets.flatMap((p) => p.nationalCommandResults ?? []),
    ).toEqual([]);
    expect(
      invitee.packets.flatMap((p) => p.nationalCommandResults ?? []),
    ).toEqual([]);

    // A foreign human's ordinary stamped action cannot accept B's consent.
    foreign.send(
      order("national_accept_empire", "r11-forged-b", C.clientID!, B.id),
    );
    expect(foreign.receipts("r11-forged-b")).toEqual([
      expect.objectContaining({
        type: "national_accept_empire",
        actorId: C.id,
        recipientId: C.id,
        requestId: "r11-forged-b",
        accepted: false,
        reason: "political-rule",
      }),
    ]);
    expect(emperor.receipts("r11-forged-b")).toEqual([]);
    expect(invitee.receipts("r11-forged-b")).toEqual([]);
    expect(offers(invitee.next())).toHaveLength(1);

    const pendingAcceptance = invitee.next(
      order("national_accept_empire", "r11-accept-b", B.clientID!, B.id),
    );
    expect(offers(pendingAcceptance)).toHaveLength(1);
    expect(invitee.receipts("r11-accept-b")).toEqual([]);
    const confirmedAcceptance = invitee.next();
    expect(offers(confirmedAcceptance)).toEqual([]);
    expect(invitee.receipts("r11-accept-b")).toEqual([
      expect.objectContaining({
        type: "national_accept_empire",
        actorId: B.id,
        recipientId: B.id,
        requestId: "r11-accept-b",
        accepted: true,
        reason: "accepted",
      }),
    ]);
    expect(offers(invitee.next())).toEqual([]);
    expect(offers(foreign.next())).toEqual([]);
    expect(game.nationalPoliticalAuthority()?.empireOf(B.id)).toBe(EMPIRE);
    expect(emperor.next().nationalPolitics?.empires).toEqual([
      expect.objectContaining({
        id: EMPIRE,
        leaderId: A.id,
        memberIds: [A.id, B.id],
      }),
    ]);
    expect(emperor.receipts("r11-accept-b")).toEqual([]);
    expect(spectator.next()).not.toHaveProperty("nationalAccessionOffers");
  });

  it("reverse candidate-to-emperor consent reaches emperor, then crown transfer revokes pending invitations", async () => {
    const game = await seeded();
    const emperor = session(game, A.clientID!);
    const invitee = session(game, B.clientID!);
    const foreign = session(game, C.clientID!);
    const reverse = session(game, D.clientID!);
    emperor.send(found());
    emperor.send(
      order("national_offer_empire", "r11-offer-b2", A.clientID!, B.id),
    );
    invitee.send(
      order("national_accept_empire", "r11-join-b2", B.clientID!, B.id),
    );

    reverse.send(
      order("national_offer_empire", "r11-reverse-d", D.clientID!, D.id),
    );
    expect(offers(reverse.next())).toEqual([]);
    expect(offers(emperor.next())).toEqual([
      {
        empireId: EMPIRE,
        candidateId: D.id,
        proposerId: D.id,
        recipientId: A.id,
      },
    ]);
    expect(foreign.next().nationalAccessionOffers?.offers).toEqual([]);
    emperor.send(
      order("national_accept_empire", "r11-accept-d", A.clientID!, D.id),
    );
    expect(game.nationalPoliticalAuthority()?.empireOf(D.id)).toBe(EMPIRE);
    expect(offers(emperor.next())).toEqual([]);

    // Pending but unaccepted C must disappear on lawful crown transfer.
    emperor.send(
      order("national_offer_empire", "r11-offer-c", A.clientID!, C.id),
    );
    expect(offers(foreign.next())).toEqual([
      {
        empireId: EMPIRE,
        candidateId: C.id,
        proposerId: A.id,
        recipientId: C.id,
      },
    ]);
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(offers(session(restored, C.clientID!).next())).toHaveLength(1);
    // Old actor receipts are replay-suppressed but current invitations survive.
    expect(session(restored, A.clientID!).next()).not.toHaveProperty(
      "nationalCommandResults",
    );

    emperor.send(
      order("national_transfer_crown", "r11-transfer-b", A.clientID!, B.id),
    );
    expect(emperor.receipts("r11-transfer-b")).toEqual([
      expect.objectContaining({
        type: "national_transfer_crown",
        actorId: A.id,
        recipientId: A.id,
        requestId: "r11-transfer-b",
        commandTargetId: EMPIRE,
        accepted: true,
      }),
    ]);
    expect(game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(B.id);
    expect(offers(foreign.next())).toEqual([]);
    expect(offers(emperor.next())).toEqual([]);
    expect(offers(invitee.next())).toEqual([]);
    expect(reverse.next().nationalPolitics?.empires[0].leaderId).toBe(B.id);
    expect(invitee.receipts("r11-transfer-b")).toEqual([]);
    expect(foreign.receipts("r11-transfer-b")).toEqual([]);
    expect(
      session(game, C.clientID!).next().nationalAccessionOffers?.offers,
    ).toEqual([]);
    const final = await roundTrip(game, "plains");
    expect([...final.bytes]).toEqual([...final.again]);
    // Restoring the Game-owned journal must NOT recreate the invalidated
    // invitation as a new actionable offer or an old success toast.
    const restoredForeign = session(final.restored, C.clientID!).next();
    expect(offers(restoredForeign)).toEqual([]);
    expect(restoredForeign.nationalCommandResults).toBeUndefined();
  });

  it("a hostile packet cannot inject a foreign offer, private command receipt or complete E1 state", async () => {
    const game = await seeded();
    game.performNationalCommand(game.player(A.id), {
      kind: "found-empire",
      empireId: EMPIRE,
    });
    game.performNationalCommand(game.player(A.id), {
      kind: "offer-empire",
      empireId: EMPIRE,
      candidateId: B.id,
    });
    const legitimate = session(game, B.clientID!).next();
    const foreign = session(game, C.clientID!).next();
    const realOffer = offers(legitimate)[0];
    const poisoned: GameUpdateViewData = {
      ...legitimate,
      // The base packet is a correctly typed, but foreign, founder receipt.
      // Its recipient differs from the GameRunner viewer so it must vanish.
      nationalCommandResults: [
        {
          type: "national_found_empire",
          recipientId: B.id,
          actorId: B.id,
          accepted: true,
          sequence: 123,
          tick: 0,
          requestId: "forged_approval",
          empireId: EMPIRE,
          reason: "accepted",
        },
      ],
    };
    const forged = {
      ...poisoned,
      nationalAccessionOffers: {
        version: 1 as const,
        recipientId: C.id,
        offers: [
          {
            ...realOffer,
            recipientId: C.id,
            secretTerms: "PRIVATE_PACT_CANARY",
          },
        ],
      },
      privatePolitics: { terms: "PRIVATE_PACT_CANARY", hiddenTroops: 999991 },
    };
    const filter = new NationalOutboundFilter(game, C.id);
    const projected = filter.project(
      game,
      forged,
      collectLiveNationalObservation(game, C.id),
    ) as R11Packet;
    expect(offers(projected)).toEqual([]);
    expect(projected).not.toHaveProperty("privatePolitics");
    expect(projected).not.toHaveProperty("nationalCommandResults");
    expect(JSON.stringify(projected)).not.toContain("PRIVATE_PACT_CANARY");
    expect(JSON.stringify(projected)).not.toContain("999991");
    expect(offers(foreign)).toEqual([]);
    expect(projectNationalAccessionOffers(game, null)).toBeUndefined();
    expect(projectNationalAccessionOffers(game, C.id)?.offers).toEqual([]);
    expect(projectNationalAccessionOffers(game, B.id)?.offers).toEqual([
      realOffer,
    ]);
    expect(session(game).next()).not.toHaveProperty("nationalAccessionOffers");
  });
  /**
   * Runs only after E1, E2 and E4 have been assembled into the same source
   * tree. The old E3-only base lacks the real delegation intent entirely.
   * IMPORTANT: on the combined build this MUST be one executed test, not an
   * E4 parser mock or a skipped test, and the E4 export is mandatory.
   */
  it.runIf(INTEGRATED_DELEGATION)(
    "combined E1→E2→E3→E4 recipient and delegation receipts survive real ticks",
    async () => {
      // Use the actual E4 production parsers. A missing integration export is
      // an outright failure, never a substituted reader implemented by E3.
      const e4 = await import("../../src/client/NationalDiplomacyState");
      const readOffers: unknown = Reflect.get(e4, "readNationalAccessionOffers");
      const readPolitical: unknown = Reflect.get(
        e4,
        "readNationalPoliticalResults",
      );
      expect(typeof readOffers).toBe("function");
      expect(typeof readPolitical).toBe("function");
      if (typeof readOffers !== "function" || typeof readPolitical !== "function")
        throw new Error("R11 E3/E4 production wire reader missing");

      const game = await seeded();
      const emperor = session(game, A.clientID!);
      const candidate = session(game, D.clientID!);
      const invitee = session(game, B.clientID!);
      const outsider = session(game, C.clientID!);
      const spectator = session(game);
      const receiptId = (hex: string) => "np_" + hex.repeat(32);

      emperor.send(found());
      // E1 expressly permits a candidate to initiate accession into an
      // existing empire. In this direction the EMPEROR is the recipient;
      // candidateId must stay D (NOT be rewritten to A for E4).
      const issued = candidate.next(
        order(
          "national_offer_empire",
          receiptId("1"),
          D.clientID!,
          D.id,
        ),
      );
      expect(issued.nationalCommandResults).toBeUndefined();
      const emperorOffer = emperor.next();
      expect(emperorOffer.nationalAccessionOffers).toMatchObject({
        version: 1,
        recipientId: A.id,
        offers: [
          {
            empireId: EMPIRE,
            candidateId: D.id,
            proposerId: D.id,
            recipientId: A.id,
          },
        ],
      });
      // This is the missing cross-owner contract: E4 MUST recognize an
      // E3-projected, E1-real candidate→emperor offer as actionable.
      expect(readOffers(emperorOffer.nationalAccessionOffers, A.id)).toMatchObject({
        version: 1,
        recipientId: A.id,
        offers: [
          {
            empireId: EMPIRE,
            candidateId: D.id,
            proposerId: D.id,
            recipientId: A.id,
          },
        ],
      });
      expect(readOffers(emperorOffer.nationalAccessionOffers, C.id)).toBeNull();
      expect(offers(candidate.next())).toEqual([]);
      expect(offers(outsider.next())).toEqual([]);
      const anonymous = spectator.next();
      expect(anonymous).not.toHaveProperty("nationalAccessionOffers");
      expect(anonymous).not.toHaveProperty("nationalCommandResults");

      // Distinguish a pending E2 stamped acceptance from a real E1 receipt.
      const pendingAccept = emperor.next(
        order(
          "national_accept_empire",
          receiptId("2"),
          A.clientID!,
          D.id,
        ),
      );
      expect(offers(pendingAccept)).toHaveLength(1);
      expect(emperor.receipts(receiptId("2"))).toEqual([]);
      const accepted = emperor.next();
      expect(offers(accepted)).toEqual([]);
      expect(game.nationalPoliticalAuthority()?.empireOf(D.id)).toBe(EMPIRE);
      expect(
        readPolitical(accepted.nationalCommandResults, A.id),
      ).toEqual([
        expect.objectContaining({
          type: "national_accept_empire",
          actorId: A.id,
          recipientId: A.id,
          requestId: receiptId("2"),
          commandTargetId: EMPIRE,
          accepted: true,
        }),
      ]);
      expect(readPolitical(accepted.nationalCommandResults, B.id)).toEqual([]);
      expect(offers(invitee.next())).toEqual([]);

      // New E1 peace delegation is a DISTINCT political receipt from real
      // E2 authenticated stamped execution. No UI fake or Game helper call.
      const grantId = receiptId("3");
      const grantIntent = {
        type: "national_set_peace_delegation",
        empireId: EMPIRE,
        memberId: D.id,
        enabled: true,
        requestId: grantId,
        clientID: A.clientID!,
      };
      emperor.next(grantIntent);
      expect(emperor.receipts(grantId)).toEqual([]);
      const grantPacket = emperor.next();
      const canonical = game
        .nationalPoliticalCommandResults(game.player(A.id))
        .find((item) => item.requestId === grantId);
      expect(canonical).toMatchObject({
        actorId: A.id,
        recipientId: A.id,
        commandKind: "set-national-peace-delegation",
        commandTargetId: EMPIRE,
        accepted: true,
      });
      expect(game.nationalPoliticalAuthority()?.maySettleNational(D.id)).toBe(
        true,
      );
      const forwarded = grantPacket.nationalCommandResults?.find(
        (item) => item.requestId === grantId,
      );
      expect(forwarded).toMatchObject({
        actorId: canonical?.actorId,
        recipientId: canonical?.recipientId,
        type: "national_set_peace_delegation",
        requestId: canonical?.requestId,
        commandTargetId: canonical?.commandTargetId,
        sequence: canonical?.sequence,
        tick: canonical?.tick,
        accepted: canonical?.accepted,
        reason: canonical?.reason,
      });
      // The E4 accession result parser cannot mistake a delegation
      // receipt for consent to accession.
      expect(
        readPolitical(grantPacket.nationalCommandResults, A.id),
      ).toEqual([]);
      expect(invitee.next().nationalCommandResults).toBeUndefined();
      expect(outsider.next().nationalCommandResults).toBeUndefined();
      expect(spectator.next().nationalCommandResults).toBeUndefined();

      // A foreign country's own rejected request is private to THAT
      // foreign requester, not to the ruler or newly-admitted member.
      const rejectedId = receiptId("4");
      outsider.next({
        ...grantIntent,
        requestId: rejectedId,
        clientID: C.clientID!,
      });
      const refused = outsider.next();
      expect(refused.nationalCommandResults).toEqual([
        expect.objectContaining({
          type: "national_set_peace_delegation",
          actorId: C.id,
          recipientId: C.id,
          requestId: rejectedId,
          commandTargetId: EMPIRE,
          accepted: false,
          reason: "political-rule",
        }),
      ]);
      expect(emperor.next().nationalCommandResults).toBeUndefined();
      expect(candidate.next().nationalCommandResults).toBeUndefined();
      expect(spectator.next().nationalCommandResults).toBeUndefined();

      // Pending third-party offers become invalid on a real E1 crown
      // transfer; never display old actionable state after restore.
      emperor.send(
        order(
          "national_offer_empire",
          receiptId("5"),
          A.clientID!,
          B.id,
        ),
      );
      const beforeTransfer = invitee.next();
      expect(readOffers(beforeTransfer.nationalAccessionOffers, B.id)).toMatchObject({
        offers: [{ empireId: EMPIRE, candidateId: B.id, recipientId: B.id }],
      });
      emperor.send(
        order(
          "national_transfer_crown",
          receiptId("6"),
          A.clientID!,
          D.id,
        ),
      );
      const revoked = invitee.next();
      expect(readOffers(revoked.nationalAccessionOffers, B.id)).toMatchObject({
        offers: [],
      });
      expect(game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(D.id);
      const { restored, bytes, again } = await roundTrip(game, "plains");
      expect(again).toEqual(bytes);
      const postRestore = session(restored, B.clientID!).next();
      expect(
        readOffers(postRestore.nationalAccessionOffers, B.id),
      ).toMatchObject({ offers: [] });
      expect(postRestore.nationalCommandResults).toBeUndefined();
      expect(
        session(restored).next(),
      ).not.toHaveProperty("nationalAccessionOffers");
    },
  );

});
