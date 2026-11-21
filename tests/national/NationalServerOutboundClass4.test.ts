/**
 * Class Four E3: authenticated SERVER-owned private NATIONAL outbound source.
 * Real E1 Game + E2 stamped GameRunner commands; no fabricated political
 * authority, client-selected observer, mocked receipts or clone of Game state.
 * This test does not claim a server-hosted NATIONAL multiplayer transport.
 */
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { NationalServerRecipientSession } from "@openfront/engine/national/observation/NationalServerOutbound";
import { describe, expect, it } from "vitest";
import {
  readNationalAccessionOffers,
  readNationalPoliticalResults,
} from "../../src/client/NationalDiplomacyState";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const A = new PlayerInfo("Ruler", PlayerType.Human, "C4E3CL1A", "C4E3ACTA");
const B = new PlayerInfo("Invitee", PlayerType.Human, "C4E3CL2B", "C4E3ACTB");
const C = new PlayerInfo("Outsider", PlayerType.Human, "C4E3CL3C", "C4E3ACTC");
const D = new PlayerInfo("Candidate", PlayerType.Human, "C4E3CL4D", "C4E3ACTD");
const PEOPLE = [A, B, C, D];
const EMPIRE = "class4_e3_empire";
const RUN = "class4-e3-actual-game";

async function actualGame(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, PEOPLE);
  PEOPLE.forEach((p, i) =>
    game.addExecution(
      new SpawnExecution(RUN, p, game.ref(15 + 20 * i, 20 + 15 * i)),
    ),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const p of PEOPLE) expect(game.player(p.id).hasSpawned()).toBe(true);
  return game;
}

function runner(game: Game, clientID: string) {
  const packets: GameUpdateViewData[] = [];
  const g = new GameRunner(
    game,
    new Executor(game, RUN, clientID),
    (update) => {
      if ("updates" in update) packets.push(update);
      else throw new Error(update.errMsg);
    },
    clientID,
  );
  const next = (intent?: Record<string, unknown>) => {
    g.addTurn({
      turnNumber: game.ticks(),
      intents: intent === undefined ? [] : [StampedIntentSchema.parse(intent)],
    });
    expect(g.executeNextTick()).toBe(true);
    return packets[packets.length - 1];
  };
  const send = (intent: Record<string, unknown>) => {
    next(intent);
    return next();
  };
  return { next, send, packets };
}

function command(
  type:
    | "national_offer_empire"
    | "national_accept_empire"
    | "national_transfer_crown",
  suffix: string,
  clientID: string,
  candidateId: string,
) {
  return {
    type,
    clientID,
    empireId: EMPIRE,
    requestId: "np_" + suffix.repeat(32),
    ...(type === "national_transfer_crown"
      ? { successorId: candidateId }
      : { candidateId }),
  };
}

let connectionSerial = 0;
function binding(clientID: string | null, spectator = false) {
  return {
    clientID,
    sessionId: "trusted-socket-" + ++connectionSerial,
    connected: true,
    spectator,
    isConnected() {
      return this.connected;
    },
    isSpectator() {
      return this.spectator;
    },
  };
}
function outgoing(game: Game, clientID: string | null, spectator = false) {
  const link = binding(clientID, spectator);
  return { link, server: new NationalServerRecipientSession(game, link) };
}

describe("Class Four: trusted-host recipient-only NATIONAL outbound interface", () => {
  it("passes the REAL reciprocal candidate→emperor E1/E2/E3/E4 contract; recipient's actionable offer expires on acceptance/crown/snapshot", async () => {
    const game = await actualGame();
    const ruler = runner(game, A.clientID!);
    const candidate = runner(game, D.clientID!);
    const sendA = outgoing(game, A.clientID!);
    const sendB = outgoing(game, B.clientID!);
    const sendC = outgoing(game, C.clientID!);
    const sendD = outgoing(game, D.clientID!);
    const spectator = outgoing(game, null, true);

    ruler.send({
      type: "national_found_empire",
      clientID: A.clientID,
      empireId: EMPIRE,
      requestId: "nf_class4founder",
    });
    expect(sendA.server.projectPolitics()?.nationalCommandResults).toEqual([
      expect.objectContaining({
        type: "national_found_empire",
        actorId: A.id,
        recipientId: A.id,
        accepted: true,
      }),
    ]);
    expect(
      sendC.server.projectPolitics()?.nationalCommandResults,
    ).toBeUndefined();

    // Candidate D invites A. The genuine E1 invitation candidateId remains
    // D, while the recipient is emperor A. This broke the previous E4 reader.
    candidate.send(command("national_offer_empire", "1", D.clientID!, D.id));
    const incoming = sendA.server.projectPolitics();
    expect(incoming?.nationalAccessionOffers).toMatchObject({
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
    expect(
      readNationalAccessionOffers(incoming?.nationalAccessionOffers, A.id)
        ?.offers,
    ).toHaveLength(1);
    expect(
      readNationalAccessionOffers(incoming?.nationalAccessionOffers, C.id),
    ).toBeNull();
    expect(
      sendB.server.projectPolitics()?.nationalAccessionOffers?.offers,
    ).toEqual([]);
    expect(
      sendC.server.projectPolitics()?.nationalAccessionOffers?.offers,
    ).toEqual([]);
    expect(spectator.server.projectPolitics()).not.toHaveProperty(
      "nationalAccessionOffers",
    );
    expect(sendD.server.projectPolitics()?.nationalCommandResults).toEqual([
      expect.objectContaining({
        type: "national_offer_empire",
        actorId: D.id,
        recipientId: D.id,
        accepted: true,
      }),
    ]);
    expect(incoming?.nationalCommandResults).toBeUndefined();

    // E2 first queues, then E1 executes; only A may receive the result.
    ruler.next(command("national_accept_empire", "2", A.clientID!, D.id));
    expect(
      sendA.server.projectPolitics()?.nationalAccessionOffers?.offers,
    ).toHaveLength(1);
    expect(
      sendA.server.projectPolitics()?.nationalCommandResults,
    ).toBeUndefined();
    ruler.next();
    const accepted = sendA.server.projectPolitics();
    const receipt = accepted?.nationalCommandResults?.find(
      (r) => r.requestId === "np_" + "2".repeat(32),
    );
    expect(receipt).toMatchObject({
      type: "national_accept_empire",
      actorId: A.id,
      recipientId: A.id,
      commandTargetId: EMPIRE,
      accepted: true,
    });
    expect(
      readNationalPoliticalResults(accepted?.nationalCommandResults, A.id),
    ).toHaveLength(1);
    expect(accepted?.nationalAccessionOffers?.offers).toEqual([]);
    expect(game.nationalPoliticalAuthority()?.membersOf(EMPIRE)).toContain(
      D.id,
    );
    expect(
      sendD.server.projectPolitics()?.nationalCommandResults,
    ).toBeUndefined();
    expect(
      sendB.server.projectPolitics()?.nationalCommandResults,
    ).toBeUndefined();

    // A new, unrelated B invitation is current until succession invalidates
    // it. Old GAMESNAPSHOTS do not reannounce an already expired invitation.
    ruler.send(command("national_offer_empire", "3", A.clientID!, B.id));
    expect(
      sendB.server.projectPolitics()?.nationalAccessionOffers?.offers,
    ).toEqual([
      expect.objectContaining({ candidateId: B.id, recipientId: B.id }),
    ]);
    // The old socket cannot emit after disconnect; a distinct authenticated
    // connection may read the still-live E1 invitation, not old receipts.
    sendB.link.connected = false;
    expect(sendB.server.projectPolitics()).toBeNull();
    const rejoined = outgoing(game, B.clientID!);
    expect(rejoined.server.projectPolitics()?.nationalAccessionOffers?.offers).toHaveLength(1);
    expect(rejoined.server.projectPolitics()?.nationalCommandResults).toBeUndefined();
    ruler.send(command("national_transfer_crown", "4", A.clientID!, D.id));
    expect(game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(D.id);
    expect(rejoined.server.projectPolitics()?.nationalAccessionOffers?.offers).toEqual([]);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    const reconnectB = outgoing(restored, B.clientID!);
    expect(
      reconnectB.server.projectPolitics()?.nationalAccessionOffers?.offers,
    ).toEqual([]);
    expect(
      reconnectB.server.projectPolitics()?.nationalCommandResults,
    ).toBeUndefined();
    expect(
      sendA.server.projectPolitics()?.nationalAccessionOffers?.offers,
    ).toEqual([]);
  });

  it("preserves E1 delegated-peace actor/recipient/sequence/outcome; denies foreign results, swapped sessions, spectator and disconnected sockets", async () => {
    const game = await actualGame();
    const ruler = runner(game, A.clientID!);
    const foreign = runner(game, C.clientID!);
    const a = outgoing(game, A.clientID!);
    const b = outgoing(game, B.clientID!);
    const c = outgoing(game, C.clientID!);
    const anonymous = outgoing(game, null, true);
    const unknown = outgoing(game, "UNKNOWNID");
    ruler.send({
      type: "national_found_empire",
      clientID: A.clientID,
      empireId: EMPIRE,
      requestId: "nf_c4founder",
    });
    ruler.send(command("national_offer_empire", "5", A.clientID!, B.id));
    runner(game, B.clientID!).send(
      command("national_accept_empire", "6", B.clientID!, B.id),
    );
    // Ruler's pending result cursor is actor-only and can be advanced safely.
    a.server.projectPolitics();
    const grantId = "np_" + "7".repeat(32);
    ruler.next({
      type: "national_set_peace_delegation",
      empireId: EMPIRE,
      memberId: B.id,
      enabled: true,
      requestId: grantId,
      clientID: A.clientID,
    });
    expect(a.server.projectPolitics()?.nationalCommandResults).toBeUndefined();
    ruler.next();
    const canonical = game
      .nationalPoliticalCommandResults(game.player(A.id))
      .find((r) => r.requestId === grantId);
    const receipt = a.server
      .projectPolitics()
      ?.nationalCommandResults?.find((r) => r.requestId === grantId);
    expect(canonical?.accepted).toBe(true);
    expect(receipt).toMatchObject({
      type: "national_set_peace_delegation",
      actorId: canonical?.actorId,
      recipientId: canonical?.recipientId,
      requestId: canonical?.requestId,
      sequence: canonical?.sequence,
      tick: canonical?.tick,
      commandTargetId: canonical?.commandTargetId,
      accepted: canonical?.accepted,
      reason: canonical?.reason,
    });
    // B is entitled to its OWN prior acceptance receipt but never A's
    // new delegation command result.
    const ownB = b.server.projectPolitics()?.nationalCommandResults ?? [];
    expect(ownB.some((entry) => entry.requestId === grantId)).toBe(false);
    expect(c.server.projectPolitics()?.nationalCommandResults).toBeUndefined();
    expect(anonymous.server.projectPolitics()).not.toHaveProperty(
      "nationalCommandResults",
    );
    expect(unknown.server.projectPolitics()).not.toHaveProperty(
      "nationalCommandResults",
    );

    const denial = "np_" + "8".repeat(32);
    foreign.send({
      type: "national_set_peace_delegation",
      clientID: C.clientID,
      requestId: denial,
      empireId: EMPIRE,
      memberId: B.id,
      enabled: false,
    });
    expect(c.server.projectPolitics()?.nationalCommandResults).toEqual([
      expect.objectContaining({
        type: "national_set_peace_delegation",
        actorId: C.id,
        recipientId: C.id,
        accepted: false,
        requestId: denial,
        reason: "political-rule",
      }),
    ]);
    expect(a.server.projectPolitics()?.nationalCommandResults).toBeUndefined();

    // A connected attacker cannot promote a C-bound server session into A.
    c.link.clientID = A.clientID!;
    expect(c.server.projectPolitics()).toBeNull();
    c.link.clientID = C.clientID!;
    expect(c.server.projectPolitics()).toBeNull();
    // Same valid client ID on a different physical socket must not resurrect
    // another authenticated session's private delivery cursor.
    const recycled = outgoing(game, C.clientID!);
    recycled.link.sessionId = "different-authenticated-socket";
    expect(recycled.server.projectPolitics()).toBeNull();
    const freshA = outgoing(game, A.clientID!);
    expect(freshA.server.projectPolitics()?.nationalCommandResults).toBeUndefined();
    a.link.connected = false;
    expect(a.server.projectPolitics()).toBeNull();
    a.link.connected = true;
    expect(a.server.projectPolitics()).toBeNull();
    // Changing a former actor into a spectator must NEVER retain the old
    // private journal, even if it later toggles back.
    b.link.spectator = true;
    expect(b.server.projectPolitics()).toBeNull();
    b.link.spectator = false;
    expect(b.server.projectPolitics()).toBeNull();
    expect(
      anonymous.server.projectPolitics()?.nationalPolitics?.empires,
    ).toEqual([expect.objectContaining({ id: EMPIRE, leaderId: A.id })]);
  });

  it("never serializes E1 Game, foreign receipts, pact terms, hidden tiles/troops or unfiltered packed resource updates", async () => {
    const game = await actualGame();
    const ruler = runner(game, A.clientID!);
    ruler.send({
      type: "national_found_empire",
      clientID: A.clientID,
      empireId: EMPIRE,
      requestId: "nf_c4private",
    });
    const a = outgoing(game, A.clientID!);
    const c = outgoing(game, C.clientID!);
    const spectator = outgoing(game, null, true);
    const current = ruler.next(); // a real GameRunner-produced packet and tick

    // Honest server projector derives public roster/private facts from Game,
    // then E3's sight filter projects only lawful map visibility. Deliberately
    // poison additional transport fields to catch accidental raw spread.
    const unseen = [...game.player(A.id).tiles()].find(
      (tile) =>
        !collectLiveNationalObservation(game, C.id).visibleTiles.has(tile),
    );
    expect(unseen).toBeDefined();
    const poisoned = {
      ...current,
      privatePactTerms: { constitution: "SECRET_TERMS_C4" },
      hiddenTroops: { [A.id]: 999991 },
      nationalCommandResults: [
        {
          type: "national_found_empire",
          actorId: A.id,
          recipientId: A.id,
          requestId: "nf_forged",
          sequence: 888,
          tick: game.ticks(),
          accepted: true,
          reason: "accepted",
          empireId: EMPIRE,
        },
      ],
      packedTileUpdates: new Uint32Array([unseen!, 0xffffffff]),
      packedAttackUpdates: new Float64Array([1, 2, 3, 999991]),
      packedMotionPlans: new Uint32Array([999991]),
    } satisfies GameUpdateViewData & {
      privatePactTerms: { constitution: string };
      hiddenTroops: Record<string, number>;
    };

    const output = c.server.projectGameUpdate(poisoned);
    const pub = spectator.server.projectGameUpdate(poisoned);
    expect(output?.nationalPolitics?.empires).toEqual([
      expect.objectContaining({ id: EMPIRE, leaderId: A.id }),
    ]);
    expect(output).not.toHaveProperty("privatePactTerms");
    expect(output).not.toHaveProperty("hiddenTroops");
    expect(output).not.toHaveProperty("nationalCommandResults");
    expect(output).not.toHaveProperty("packedAttackUpdates");
    expect(output).not.toHaveProperty("packedMotionPlans");
    expect(output?.packedTileUpdates).toHaveLength(0);
    expect(pub).not.toHaveProperty("nationalAccessionOffers");
    expect(pub).not.toHaveProperty("nationalCommandResults");

    // E3 server political port is politics-only by construction. Neither
    // foreign resources nor raw Game internals are members of its wire type.
    const words = JSON.stringify(c.server.projectPolitics());
    expect(words).not.toContain("SECRET_TERMS_C4");
    expect(words).not.toContain("999991");
    expect(words).not.toContain('accessionOffers":');
    expect(words).not.toContain("nationalWarState");
    expect(words).not.toContain("privatePactTerms");
    const live = a.server.projectGameUpdate(current);
    expect(live?.nationalAccessionOffers?.recipientId).toBe(A.id);
    // A cannot reuse a stale frame from an earlier authoritative tick.
    ruler.next();
    expect(() => c.server.projectGameUpdate(current)).toThrow(
      "NATIONAL stale/mismatched server frame",
    );
  });
});
