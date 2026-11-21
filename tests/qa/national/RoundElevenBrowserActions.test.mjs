// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  corroboratePublicEmpire,
  reconcilePoliticalReceipt,
  safeFailureCode,
  sanitizeAcceptanceEvent,
  sanitizePacketEvidence,
  verifyDistinctLiveSessions,
  verifyThreeLivePrincipals,
  verifyPrivateInvitation,
} from "../../../scripts/national-qa/browser-r11-political-verdict.mjs";
import {
  acceptRadialTarget,
  classifyFoundingEvidence,
  describePanel,
  distinctPeacePrincipal,
  unobstructedCanvasPoint,
} from "../../../scripts/national-qa/browser-r11-verdict.mjs";

function createPanel(expanded = true) {
  const panel = document.createElement("national-diplomacy-panel");
  const toggle = document.createElement("button");
  toggle.setAttribute("aria-controls", "national-diplomacy-content");
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  panel.append(toggle);
  return { panel, toggle };
}
const input = {
  actorId: "a",
  empireId: "Empire_A",
  requestId: "fr_abc",
  issuedTick: 10,
  tick: 12,
  paused: false,
  snapshotTick: 12,
  uiConfirmed: true,
  results: [
    {
      type: "national_found_empire",
      actorId: "a",
      recipientId: "a",
      empireId: "Empire_A",
      requestId: "fr_abc",
      accepted: true,
      tick: 11,
      sequence: 5,
    },
  ],
  publicEmpires: [{ id: "Empire_A", leaderId: "a", memberIds: ["a"] }],
};
describe("R11 E5 visual map input occlusion gate", () => {
  it("reads an actual visible panel toggle, rejecting absent or invalid state", () => {
    const { panel, toggle } = createPanel(true);
    expect(describePanel(toggle, panel)).toMatchObject({
      valid: true,
      expanded: true,
    });
    toggle.setAttribute("aria-expanded", "false");
    expect(describePanel(toggle, panel)).toMatchObject({
      valid: true,
      expanded: false,
    });
    toggle.setAttribute("aria-expanded", "unknown");
    expect(describePanel(toggle, panel).valid).toBe(false);
    expect(describePanel(null, panel).valid).toBe(false);
  });
  it("rejects a touch obscured by the actual panel and chooses only unobstructed canvas", () => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 390,
      height: 750,
    });
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 390,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 844,
    });
    const modal = document.createElement("div");
    document.elementFromPoint = (_x, y) => (y < 450 ? modal : canvas);
    expect(
      unobstructedCanvasPoint(document, canvas, [
        [0.5, 0.2],
        [0.5, 0.8],
      ]),
    ).toEqual({ x: 195, y: 600 });
    document.elementFromPoint = () => modal;
    expect(unobstructedCanvasPoint(document, canvas, [[0.5, 0.8]])).toBeNull();
  });
});
describe("R11 E5 authentic founding lifecycle and ownership", () => {
  it("accepts only actor-matched receipt, current public roster, and UI confirmation", () => {
    expect(classifyFoundingEvidence(input)).toMatchObject({
      status: "accepted",
      reason: "AUTHENTIC_FOUNDING_AND_ROSTER",
    });
    expect(
      classifyFoundingEvidence({ ...input, uiConfirmed: false }).reason,
    ).toBe("FOUNDING_UI_CONFIRMATION_MISSING");
    expect(
      classifyFoundingEvidence({ ...input, publicEmpires: [] }).reason,
    ).toBe("FOUNDING_PUBLIC_ROSTER_MISSING");
  });
  it("separates paused tick, stalled tick, and missing result instead of timing out generically", () => {
    expect(
      classifyFoundingEvidence({
        ...input,
        results: [],
        tick: 10,
        paused: true,
      }).reason,
    ).toBe("GAME_PAUSED_NO_FOUNDING_TICK");
    expect(
      classifyFoundingEvidence({
        ...input,
        results: [],
        tick: 10,
        paused: false,
      }).reason,
    ).toBe("GAME_TICK_NOT_ADVANCING");
    expect(
      classifyFoundingEvidence({ ...input, results: [], tick: 12 }).reason,
    ).toBe("FOUNDING_RECEIPT_ABSENT");
  });
  it("fails closed on cross-actor, contradictory and negative engine receipts", () => {
    const foreign = { ...input.results[0], recipientId: "b" };
    expect(
      classifyFoundingEvidence({ ...input, results: [foreign] }).reason,
    ).toBe("FOUNDING_RECEIPT_ACTOR_MISMATCH");
    expect(
      classifyFoundingEvidence({
        ...input,
        results: [input.results[0], { ...input.results[0], accepted: false }],
      }).reason,
    ).toBe("FOUNDING_CONTRADICTORY_RECEIPTS");
    expect(
      classifyFoundingEvidence({
        ...input,
        results: [{ ...input.results[0], accepted: false }],
      }).status,
    ).toBe("rejected");
    expect(
      classifyFoundingEvidence({
        ...input,
        results: [
          {
            ...input.results[0],
            sequence: -1,
          },
        ],
      }).reason,
    ).toBe("FOUNDING_RECEIPT_TICK_OR_SEQUENCE_INVALID");
    expect(
      classifyFoundingEvidence({
        ...input,
        results: [
          {
            ...input.results[0],
            tick: 9,
          },
        ],
      }).status,
    ).toBe("blocked");
  });

  it("never accepts future receipts or a roster older than its receipt", () => {
    const future = classifyFoundingEvidence({
      ...input,
      tick: 10,
    });
    expect(future).toMatchObject({
      status: "pending",
      reason: "FOUNDING_VIEW_BEHIND_RECEIPT",
    });
    const stale = classifyFoundingEvidence({
      ...input,
      snapshotTick: 10,
    });
    expect(stale).toMatchObject({
      status: "pending",
      reason: "FOUNDING_PUBLIC_ROSTER_MISSING",
    });
  });
  it("rejects divergent accepted receipts but permits identical journal and view copies", () => {
    expect(
      classifyFoundingEvidence({
        ...input,
        results: [input.results[0], { ...input.results[0], sequence: 9 }],
      }).reason,
    ).toBe("FOUNDING_CONTRADICTORY_RECEIPTS");
    expect(
      classifyFoundingEvidence({
        ...input,
        results: [input.results[0], { ...input.results[0] }],
      }).status,
    ).toBe("accepted");
    expect(
      classifyFoundingEvidence({
        ...input,
        results: [{ ...input.results[0], accepted: undefined }],
      }).reason,
    ).toBe("FOUNDING_RECEIPT_STATUS_INVALID");
  });
});
describe("R11 E5 genuine radial and peace authority gates", () => {
  it("cannot accept a radial action for a wrong target or disabled Attack", () => {
    expect(
      acceptRadialTarget({
        expectedId: "enemy",
        actualId: "enemy",
        buttonEnabled: true,
      }).accepted,
    ).toBe(true);
    expect(
      acceptRadialTarget({
        expectedId: "enemy",
        actualId: "other",
        buttonEnabled: true,
      }).accepted,
    ).toBe(false);
    expect(
      acceptRadialTarget({
        expectedId: "enemy",
        actualId: "enemy",
        buttonEnabled: false,
      }).reason,
    ).toBe("RADIAL_ATTACK_DISABLED");
    expect(
      acceptRadialTarget({
        expectedId: "enemy",
        actualId: null,
        buttonEnabled: true,
      }).accepted,
    ).toBe(false);
  });
  it("requires an opposing principal, exact unaccepted motion and active war", () => {
    const motion = {
      id: "m",
      proposedBy: "nation-a",
      layerId: "w",
      acceptedTick: null,
    };
    const layer = { id: "w", endedTick: null };
    const args = {
      proposerId: "nation-a",
      acceptorId: "nation-b",
      motionId: "m",
      warId: "w",
      offeredMotion: motion,
      warLayer: layer,
    };
    expect(distinctPeacePrincipal(args).accepted).toBe(true);
    expect(
      distinctPeacePrincipal({ ...args, acceptorId: "nation-a" }).reason,
    ).toBe("OPPOSING_PRINCIPAL_REQUIRED");
    expect(
      distinctPeacePrincipal({ ...args, warLayer: { ...layer, endedTick: 22 } })
        .accepted,
    ).toBe(false);
    expect(
      distinctPeacePrincipal({
        ...args,
        offeredMotion: { ...motion, proposedBy: "someone-else" },
      }).accepted,
    ).toBe(false);
  });
});

describe("R11 E5 independent two-principal political acceptance", () => {
  const empireId = "R11_Browser_QA";
  const founderId = "legit-a";
  const candidateId = "legit-b";
  const gameId = "auth-real-game";
  const founder = {
    gameId,
    actorId: founderId,
    spectator: false,
    spawned: true,
    ownedTiles: 42,
    tick: 120,
    politicsTick: 120,
    empires: [{ id: empireId, leaderId: founderId, memberIds: [founderId] }],
  };
  const candidate = {
    gameId,
    actorId: candidateId,
    spectator: false,
    spawned: true,
    ownedTiles: 31,
    tick: 120,
    politicsTick: 120,
    empires: founder.empires,
  };
  const receipt = (type, actorId, targetId, accepted = true) => ({
    type,
    actorId,
    recipientId: actorId,
    commandTargetId: empireId,
    requestId: "np_" + "2".repeat(32),
    sequence: 17,
    tick: 119,
    accepted,
    reason: accepted ? "accepted" : "political-rule",
  });
  const args = (type, actorId, targetId, members = [founderId]) => ({
    type,
    actorId,
    targetId,
    empireId,
    requestId: "np_" + "2".repeat(32),
    issuedTick: 118,
    currentTick: 120,
    politicsTick: 120,
    results: [receipt(type, actorId, targetId)],
    empires: [{ id: empireId, leaderId: founderId, memberIds: members }],
  });

  it("requires independently admitted distinct spawned players in the SAME game", () => {
    expect(
      verifyDistinctLiveSessions(founder, candidate, candidateId).accepted,
    ).toBe(true);
    expect(
      verifyDistinctLiveSessions(
        founder,
        { ...candidate, actorId: founderId },
        candidateId,
      ).accepted,
    ).toBe(false);
    expect(
      verifyDistinctLiveSessions(
        founder,
        { ...candidate, gameId: "another-game" },
        candidateId,
      ).accepted,
    ).toBe(false);
    expect(
      verifyDistinctLiveSessions(
        founder,
        { ...candidate, spectator: true },
        candidateId,
      ).accepted,
    ).toBe(false);
    expect(
      verifyDistinctLiveSessions(
        founder,
        { ...candidate, spawned: false },
        candidateId,
      ).accepted,
    ).toBe(false);
    expect(
      verifyDistinctLiveSessions(
        founder,
        { ...candidate, ownedTiles: 0 },
        candidateId,
      ).accepted,
    ).toBe(false);
    expect(
      verifyDistinctLiveSessions(
        founder,
        { ...candidate, actorId: "unauthorized" },
        candidateId,
      ).accepted,
    ).toBe(false);
  });

  it("never conflates accepted OFFER receipt with the recipient-only private invitation", () => {
    const offer = {
      empireId,
      candidateId,
      recipientId: candidateId,
      proposerId: founderId,
    };
    const valid = {
      founderId,
      recipientId: candidateId,
      empireId,
      recipientTick: 120,
      founderView: { version: 1, recipientId: founderId, offers: [] },
      recipientView: { version: 1, recipientId: candidateId, offers: [offer] },
    };
    expect(verifyPrivateInvitation(valid).accepted).toBe(true);
    expect(
      verifyPrivateInvitation({ ...valid, recipientView: null }).accepted,
    ).toBe(false);
    expect(
      verifyPrivateInvitation({
        ...valid,
        recipientView: { ...valid.recipientView, recipientId: founderId },
      }).accepted,
    ).toBe(false);
    expect(
      verifyPrivateInvitation({
        ...valid,
        recipientView: {
          ...valid.recipientView,
          offers: [{ ...offer, candidateId: "other" }],
        },
      }).accepted,
    ).toBe(false);
    expect(
      verifyPrivateInvitation({
        ...valid,
        recipientView: { ...valid.recipientView, offers: [offer, offer] },
      }).accepted,
    ).toBe(false);
    expect(
      verifyPrivateInvitation({
        ...valid,
        founderView: { ...valid.founderView, offers: [offer] },
      }).reason,
    ).toBe("POLITICAL_PRIVATE_INVITATION_LEAKED_TO_SENDER");
    // A sender can legitimately receive OTHER invitations addressed to it.
    const ownOffer = {
      empireId: "Another_Empire",
      candidateId: founderId,
      recipientId: founderId,
      proposerId: "third-player",
    };
    expect(
      verifyPrivateInvitation({
        ...valid,
        founderView: {
          ...valid.founderView,
          offers: [ownOffer],
        },
      }),
    ).toMatchObject({
      accepted: true,
      reason: "AUTHENTIC_RECIPIENT_ONLY_INVITATION",
    });
    // A legitimate sender packet must not camouflage a leaked invitation.
    expect(
      verifyPrivateInvitation({
        ...valid,
        founderView: {
          ...valid.founderView,
          offers: [ownOffer, offer],
        },
      }).reason,
    ).toBe("POLITICAL_PRIVATE_INVITATION_LEAKED_TO_SENDER");
    // A malformed foreign packet that is NOT the exact private offer
    // remains a fail-closed sender-view mismatch, never an accepted view.
    expect(
      verifyPrivateInvitation({
        ...valid,
        founderView: {
          ...valid.founderView,
          offers: [{ ...offer, proposerId: "different-sender" }],
        },
      }).reason,
    ).toBe("POLITICAL_SENDER_PRIVATE_VIEW_MISMATCH");
  });

  it("correlates real founder OFFER receipt but does not certify invitation delivery from that alone", () => {
    const actual = reconcilePoliticalReceipt(
      args("national_offer_empire", founderId, candidateId),
    );
    expect(actual).toMatchObject({ accepted: true, receiptTick: 119 });
    expect(
      reconcilePoliticalReceipt({
        ...args("national_offer_empire", founderId, candidateId),
        results: [],
      }).reason,
    ).toBe("POLITICAL_AUTHENTIC_RECEIPT_ABSENT");
    expect(
      reconcilePoliticalReceipt({
        ...args("national_offer_empire", founderId, candidateId),
        results: [
          {
            ...receipt("national_offer_empire", founderId, candidateId),
            recipientId: candidateId,
          },
        ],
      }).reason,
    ).toBe("POLITICAL_FORGED_OR_FOREIGN_RECEIPT");
  });

  it("requires authentic recipient ACCEPT receipt AND fresh two-view membership", () => {
    const before = args("national_accept_empire", candidateId, candidateId);
    expect(reconcilePoliticalReceipt(before).accepted).toBe(false);
    const after = {
      ...before,
      empires: [
        {
          id: empireId,
          leaderId: founderId,
          memberIds: [founderId, candidateId],
        },
      ],
    };
    expect(reconcilePoliticalReceipt(after).accepted).toBe(true);
    const observed = {
      emperor: { ...founder, empires: after.empires },
      recipient: { ...candidate, empires: after.empires },
      empireId,
      leaderId: founderId,
      memberIds: [founderId, candidateId],
      minTick: 119,
    };
    expect(corroboratePublicEmpire(observed).accepted).toBe(true);
    expect(
      corroboratePublicEmpire({
        ...observed,
        recipient: { ...candidate, politicsTick: 118 },
      }).accepted,
    ).toBe(false);
    expect(
      corroboratePublicEmpire({
        ...observed,
        recipient: { ...candidate, empires: founder.empires },
      }).accepted,
    ).toBe(false);
  });

  it("only accepts an actual crown receipt with member successor and both fresh leader views", () => {
    const change = {
      ...args("national_transfer_crown", founderId, candidateId, [
        founderId,
        candidateId,
      ]),
      empires: [
        {
          id: empireId,
          leaderId: candidateId,
          memberIds: [founderId, candidateId],
        },
      ],
    };
    expect(reconcilePoliticalReceipt(change).accepted).toBe(true);
    expect(
      reconcilePoliticalReceipt({ ...change, empires: founder.empires })
        .accepted,
    ).toBe(false);
    expect(
      reconcilePoliticalReceipt({
        ...change,
        results: [
          change.results[0],
          {
            ...change.results[0],
            accepted: false,
            reason: "political-rule",
            sequence: 18,
          },
        ],
      }).reason,
    ).toBe("POLITICAL_CONTRADICTORY_RECEIPTS");
    expect(
      reconcilePoliticalReceipt({
        ...change,
        results: [{ ...change.results[0], tick: 117 }],
      }).accepted,
    ).toBe(false);
    expect(
      reconcilePoliticalReceipt({
        ...change,
        results: [{ ...change.results[0], requestId: "np_" + "f".repeat(32) }],
      }).accepted,
    ).toBe(false);
  });

  it("sanitizes all foreign receipts, candidate details and private packets from external evidence", () => {
    const evidence = sanitizePacketEvidence([
      {
        tick: 120,
        sequence: 2,
        hasTerritoryDelta: true,
        publicPolitics: { empires: [{ id: "SENSITIVE_EMPIRE" }] },
        accessionOffers: { offers: [{ proposerId: "PRIVATE_PROPOSER" }] },
        commandResults: [
          { requestId: "PRIVATE_TOKEN", actorId: "PRIVATE_ACTOR" },
        ],
        rawFog: { canary: "PRIVATE_FOG" },
      },
    ]);
    expect(evidence).toEqual([
      {
        tick: 120,
        sequence: 2,
        hasTerritoryDelta: true,
        hasPublicPolitics: true,
        hasCurrentConflicts: false,
        hasRecipientAccessionView: true,
        commandResultCount: 1,
        hasAuthoritativeAttackDelta: false,
        hasAuthoritativeMotion: false,
      },
    ]);
    const flattened = JSON.stringify(evidence);
    for (const secret of [
      "SENSITIVE_EMPIRE",
      "PRIVATE_PROPOSER",
      "PRIVATE_TOKEN",
      "PRIVATE_ACTOR",
      "PRIVATE_FOG",
    ]) {
      expect(flattened).not.toContain(secret);
    }
  });
});

describe("R11 E5 acceptance flags survive privacy projection", () => {
  it("retains only the actual six-principal-proof booleans", () => {
    expect(
      sanitizeAcceptanceEvent({
        name: "political-membership-confirmed-by-both",
        recipientAccepted: true,
        founderRosterAgrees: true,
        recipientId: "PRIVATE_RECIPIENT",
      }),
    ).toEqual({
      name: "political-membership-confirmed-by-both",
      recipientAccepted: true,
      founderRosterAgrees: true,
    });
    expect(
      sanitizeAcceptanceEvent({
        name: "war-opponent-identity-verified",
        differentPrincipal: true,
        sameGameId: true,
        targetNotEmpireMember: true,
        actorId: "PRIVATE_ACTOR",
      }),
    ).toEqual({
      name: "war-opponent-identity-verified",
      differentPrincipal: true,
      sameGameId: true,
      targetNotEmpireMember: true,
    });
  });
});

describe("R11 E5 complete privacy proof fails closed on absent sender view", () => {
  const offer = {
    empireId: "R11_Browser_QA",
    candidateId: "b",
    proposerId: "a",
    recipientId: "b",
  };
  const valid = {
    founderId: "a",
    recipientId: "b",
    empireId: offer.empireId,
    recipientTick: 50,
    recipientView: { version: 1, recipientId: "b", offers: [offer] },
    founderView: { version: 1, recipientId: "a", offers: [] },
  };
  it("refuses to certify privacy when the sender private view is unverified", () => {
    expect(verifyPrivateInvitation(valid).accepted).toBe(true);
    expect(
      verifyPrivateInvitation({ ...valid, founderView: null }).reason,
    ).toBe("POLITICAL_SENDER_PRIVATE_VIEW_UNVERIFIED");
    expect(
      verifyPrivateInvitation({
        ...valid,
        founderView: { ...valid.founderView, recipientId: "b" },
      }).reason,
    ).toBe("POLITICAL_SENDER_PRIVATE_VIEW_UNVERIFIED");
    expect(
      verifyPrivateInvitation({
        ...valid,
        founderView: {
          ...valid.founderView,
          offers: [{ ...offer, recipientId: "a", candidateId: "b" }],
        },
      }).reason,
    ).toBe("POLITICAL_SENDER_PRIVATE_VIEW_MISMATCH");
  });
  it("rejects unknown spectator state even if actor and tick appear valid", () => {
    const a = {
      gameId: "g",
      actorId: "a",
      spawned: true,
      ownedTiles: 3,
      tick: 7,
      spectator: false,
    };
    const b = { ...a, actorId: "b", spectator: undefined };
    expect(verifyDistinctLiveSessions(a, b, "b").reason).toBe(
      "POLITICAL_SPECTATOR_OR_INACTIVE",
    );
  });
});


describe("Class Four source-only A/B/C browser topology", () => {
  const A = {
    gameId: "same-authoritative-game",
    actorId: "a",
    tick: 120,
    politicsTick: 120,
    spectator: false,
    spawned: true,
    ownedTiles: 10,
    empires: [{ id: "empire", leaderId: "b", memberIds: ["a", "b"] }],
  };
  const B = { ...A, actorId: "b" };
  const C = { ...A, actorId: "c" };
  it("requires three living distinct same-game principals and an outside enemy", () => {
    expect(verifyThreeLivePrincipals(A, B, C).accepted).toBe(true);
    expect(
      verifyThreeLivePrincipals(A, B, { ...C, actorId: "b" }).accepted,
    ).toBe(false);
    expect(
      verifyThreeLivePrincipals(A, B, { ...C, gameId: "other" }).accepted,
    ).toBe(false);
    expect(
      verifyThreeLivePrincipals(A, B, { ...C, spectator: true }).accepted,
    ).toBe(false);
    expect(
      verifyThreeLivePrincipals(A, B, {
        ...C,
        empires: [{ id: "empire", leaderId: "b", memberIds: ["a", "b", "c"] }],
      }).accepted,
    ).toBe(false);
  });
  it("fails closed when outside principal lacks the current public empire view", () => {
    expect(verifyThreeLivePrincipals(A, B, { ...C, empires: [] }).reason).toBe(
      "POLITICAL_THIRD_VIEW_ROSTER_UNVERIFIED",
    );
    expect(
      verifyThreeLivePrincipals(
        { ...A, empires: [] },
        B,
        C,
      ).reason,
    ).toBe("POLITICAL_THREE_PRINCIPAL_ROSTER_NOT_CURRENT");
  });
});

describe("R11 E5 sanitized physical-browser evidence", () => {
  it("never prints raw private invitations, request nonces, URLs or UI body text", () => {
    const secret = "PRIVATE_RECIPIENT_CANARY_TOKEN";
    const result = sanitizeAcceptanceEvent({
      name: "stage-failed",
      stage: "recipient-invitation",
      elapsedMs: 1250,
      error:
        "Error: POLITICAL_PRIVATE_INVITATION_NOT_DELIVERED_OWNER_E3 " + secret,
      requestId: secret,
      recipientId: secret,
      targetId: secret,
      text: "private human chat " + secret,
      observed: { body: secret },
      workerPackets: [{ secret }],
    });
    const flat = JSON.stringify(result);
    expect(result.name).toBe("stage-failed");
    expect(result.stage).toBe("recipient-invitation");
    expect(result.error).toContain("POLITICAL_PRIVATE_INVITATION");
    expect(flat).not.toContain(secret);
    expect(flat).not.toContain("workerPackets");
    expect(flat).not.toContain("requestId");
  });
  it("retains actual screenshot labels, stage identity and unsigned GPU status", () => {
    expect(
      sanitizeAcceptanceEvent({
        name: "screenshot",
        label: "political-crown-former-emperor-revoked",
        packetCount: 12,
        requestId: "np_" + "f".repeat(32),
      }),
    ).toEqual({
      name: "screenshot",
      label: "political-crown-former-emperor-revoked",
      packetCount: 12,
    });
    expect(
      sanitizeAcceptanceEvent({
        name: "strict-hardware-renderer-attestation",
        accepted: false,
      }),
    ).toEqual({
      name: "strict-hardware-renderer-attestation",
      accepted: false,
    });
    expect(safeFailureCode("random personal PRIVATE CANARY")).toBe(
      "UNCLASSIFIED_ACCEPTANCE_FAILURE",
    );
  });
});
