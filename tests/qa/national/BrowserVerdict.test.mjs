import { describe, expect, it } from "vitest";
import {
  SCENARIOS,
  reconcileDiplomacyEvidence,
  summarizeBrowserReport,
} from "../../../scripts/national-qa/browser-verdict.mjs";

const actorId = "player_one";
const targetId = "player_two";
const warId = "war_42";
const motionId = "motion_20";
const requestId = "nc_" + "a".repeat(32);
const tick = 100;
const receipt = {
  type: "national_declare_war",
  requestId,
  actorId,
  recipientId: actorId,
  sequence: 42,
  tick: 101,
  accepted: true,
  warId,
};
const war = {
  id: warId,
  scope: "national",
  first: { kind: "nation", id: actorId },
  second: { kind: "nation", id: targetId },
  declaredBy: actorId,
  startedTick: 101,
  endedTick: null,
};
const projection = {
  version: 1,
  recipientId: actorId,
  layers: [war],
  motions: [],
};
const match = (packets, extra = {}) =>
  reconcileDiplomacyEvidence(packets, {
    type: "national_declare_war",
    requestId,
    actorId,
    issuedTick: tick,
    targetId,
    projection,
    projectionTick: 101,
    ...extra,
  });

describe("R10 E5 independent receipt and live conflict reconciliation", () => {
  it("accepts matching real-shaped recipient journal and ACTIVE war layer", () => {
    expect(match([{ commandResults: [receipt] }])).toMatchObject({
      accepted: true,
      warId,
      receiptTick: 101,
      reason: "MATCHED_RECIPIENT_RECEIPT_AND_ENGINE_STATE",
    });
  });
  it("rejects foreign, forged, missing, contradictory and replayed receipts", () => {
    expect(match([]).reason).toBe("MATCHING_ENGINE_RECEIPT_MISSING");
    expect(
      match([{ commandResults: [{ ...receipt, actorId: targetId }] }]).reason,
    ).toBe("FORGED_OR_UNSCOPED_ENGINE_RECEIPT");
    expect(
      match([{ commandResults: [{ ...receipt, recipientId: targetId }] }])
        .accepted,
    ).toBe(false);
    expect(
      match([{ commandResults: [receipt, { ...receipt, accepted: false }] }])
        .reason,
    ).toBe("CONFLICTING_OR_FOREIGN_RECEIPTS");
    expect(
      match([{ commandResults: [{ ...receipt, tick: 99 }] }]).accepted,
    ).toBe(false);
    expect(
      match([{ commandResults: [receipt] }], { projectionTick: 99 }).accepted,
    ).toBe(false);
    expect(
      match([{ commandResults: [receipt] }], {
        projection: { ...projection, recipientId: targetId },
      }).accepted,
    ).toBe(false);
    expect(
      match([{ commandResults: [receipt] }], {
        projection: { ...projection, layers: [{ ...war, endedTick: 101 }] },
      }).accepted,
    ).toBe(false);
    expect(
      match([{ commandResults: [receipt] }], { targetId: "wrong" }).accepted,
    ).toBe(false);
  });
  it("rejects forged positive UI toast with actual engine rejection", () => {
    expect(
      match([
        {
          commandResults: [
            { ...receipt, accepted: false, reason: "not-authorized" },
          ],
        },
      ]),
    ).toMatchObject({
      accepted: false,
      reason: "ENGINE_REJECTED_ACTION",
    });
  });
  it("reconciles peace proposal only with engine-issued motion and matched recipient", () => {
    const p = {
      ...receipt,
      type: "national_propose_peace",
      requestId: "nc_" + "b".repeat(32),
      tick: 104,
      motionId,
    };
    const conflicts = {
      ...projection,
      motions: [
        {
          id: motionId,
          layerId: warId,
          proposedBy: actorId,
          proposingSide: 0,
          proposedTick: 104,
          acceptedTick: null,
          acceptedBy: null,
        },
      ],
    };
    const attempt = {
      type: p.type,
      requestId: p.requestId,
      actorId,
      issuedTick: 103,
      warId,
      projection: conflicts,
      projectionTick: 104,
    };
    expect(
      reconcileDiplomacyEvidence([{ commandResults: [p] }], attempt).accepted,
    ).toBe(true);
    expect(
      reconcileDiplomacyEvidence([{ commandResults: [p] }], {
        ...attempt,
        projection: {
          ...conflicts,
          motions: [{ ...conflicts.motions[0], proposedBy: targetId }],
        },
      }).accepted,
    ).toBe(false);
  });
  it("requires opposite side's true acceptance and ENDED war", () => {
    const p = {
      ...receipt,
      type: "national_accept_peace",
      requestId: "nc_" + "c".repeat(32),
      actorId: targetId,
      recipientId: targetId,
      tick: 110,
      motionId,
    };
    const attempt = {
      type: p.type,
      requestId: p.requestId,
      actorId: targetId,
      issuedTick: 108,
      warId,
      motionId,
      projectionTick: 110,
      projection: {
        ...projection,
        recipientId: targetId,
        layers: [{ ...war, endedTick: 110 }],
        motions: [
          {
            id: motionId,
            layerId: warId,
            proposedBy: actorId,
            proposingSide: 0,
            proposedTick: 104,
            acceptedTick: 110,
            acceptedBy: targetId,
          },
        ],
      },
    };
    expect(
      reconcileDiplomacyEvidence([{ commandResults: [p] }], attempt).accepted,
    ).toBe(true);
    expect(
      reconcileDiplomacyEvidence([{ commandResults: [p] }], {
        ...attempt,
        actorId,
      }).accepted,
    ).toBe(false);
    expect(
      reconcileDiplomacyEvidence([{ commandResults: [p] }], {
        ...attempt,
        projection: { ...attempt.projection, layers: [war] },
      }).accepted,
    ).toBe(false);
  });
});

describe("R10 E5 four-mode report evidence", () => {
  it("fixes historic legacy/FFA path mismatch without changing E6 workflow", () => {
    expect(SCENARIOS["legacy-ffa-desktop"].report).toBe(
      "national-qa-artifacts/browser-legacy-ffa-desktop/acceptance.json",
    );
    expect(SCENARIOS["legacy-ffa-mobile"].report).toBe(
      "national-qa-artifacts/browser-legacy-ffa-mobile/acceptance.json",
    );
  });
  it("cannot pass a menu, empty legacy record, or successful process with no actions", () => {
    for (const mode of Object.keys(SCENARIOS)) {
      const result = summarizeBrowserReport(
        {
          exactSource: "a".repeat(40),
          stage: "home",
          events: [{ name: "stage-complete", stage: "home" }],
        },
        0,
        mode,
      );
      expect(result.gameplayPassed).toBe(false);
      expect(result.missingStages.length).toBeGreaterThan(0);
      expect(result.publicReleasePassed).toBe(false);
    }
  });
  it("reports first failed stage without exposing raw Worker packets", () => {
    const summary = summarizeBrowserReport(
      {
        exactSource: "f".repeat(40),
        stage: "spawn",
        events: [{ name: "stage-complete", stage: "home" }],
        errors: [{ stage: "spawn", error: "raw fog: secret_value" }],
        workerPackets: [{ secret: "private" }],
      },
      1,
      "national-mobile",
    );
    expect(summary.failedStage).toBe("spawn");
    expect(summary.gameplayPassed).toBe(false);
    expect(JSON.stringify(summary)).not.toContain("secret_value");
    expect(JSON.stringify(summary)).not.toContain("private");
  });
});

describe("R10 E5 first-failure preservation and evidence absence", () => {
  it("reports the first actual browser failure, not a later cleanup error", () => {
    const summary = summarizeBrowserReport(
      {
        stage: "start",
        events: [
          { name: "stage-complete", stage: "home" },
          { name: "stage-failed", stage: "solo" },
          { name: "stage-failed", stage: "start" },
        ],
        errors: [
          { stage: "start", error: "follow-on error" },
          { stage: "solo", error: "prior root cause" },
        ],
      },
      1,
      "national-mobile",
    );
    expect(summary.failedStage).toBe("solo");
    expect(summary.gameplayPassed).toBe(false);
  });

  it("never treats exit zero with a missing report as a passing game", () => {
    const summary = summarizeBrowserReport(null, 0, "legacy-ffa-desktop");
    expect(summary.reported).toBe(false);
    expect(summary.failureClass).toBe("REPORT_MISSING");
    expect(summary.gameplayPassed).toBe(false);
  });

  it("requires combat impact and legacy difficulty reversal as real stages", () => {
    const national = summarizeBrowserReport(
      {
        events: [{ name: "stage-complete", stage: "map-assault" }],
      },
      0,
      "national-desktop",
    );
    expect(national.missingStages).toContain("combat-impact");
    const legacy = summarizeBrowserReport(
      {
        events: [{ name: "stage-complete", stage: "legacy-ffa" }],
      },
      0,
      "legacy-ffa-mobile",
    );
    expect(legacy.missingStages).toContain("legacy-configuration");
  });

  it("four report filenames retain -ffa- for both legacy viewports", () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual([
      "legacy-ffa-desktop",
      "legacy-ffa-mobile",
      "national-desktop",
      "national-mobile",
    ]);
    expect(
      Object.values(SCENARIOS).every((entry) =>
        entry.report.endsWith("/acceptance.json"),
      ),
    ).toBe(true);
  });
});

describe("R11 E5 four-mode screenshot fail-closed gate", () => {
  it("missing screenshot fails despite exit=0 and all stage-complete markers", () => {
    for (const [mode, config] of Object.entries(SCENARIOS)) {
      const events = (
        mode.startsWith("national-")
          ? [
              "home",
              "solo",
              "national-mode",
              "start",
              "spawn",
              "found-empire",
              "rejected-founding",
              "offer-accession",
              "recipient-invitation",
              "recipient-acceptance",
              "transfer-crown",
              "declare-war",
              "map-assault",
              "combat-impact",
              "propose-peace",
              "accept-peace",
            ]
          : [
              "home",
              "solo",
              "legacy-configuration",
              "legacy-ffa",
              "legacy-player-action",
            ]
      ).map((stage) => ({ name: "stage-complete", stage }));
      const report = summarizeBrowserReport({ events }, 0, mode);
      expect(report.missingStages).toEqual([]);
      expect(report.missingScreenshots.length).toBeGreaterThan(0);
      expect(report.failureClass).toBe("REQUIRED_SCREENSHOTS_MISSING");
      expect(report.gameplayPassed).toBe(false);
      expect(report.path).toBe(config.report);
    }
  });
});

describe("R11 E5 combined political+WAR four-mode verdict cannot fake success", () => {
  const complete = [
    "home","solo","national-mode","start","spawn","found-empire",
    "rejected-founding","offer-accession","recipient-invitation",
    "recipient-acceptance","transfer-crown","declare-war","map-assault",
    "combat-impact","propose-peace","accept-peace",
  ].map(stage=>({name:"stage-complete",stage}));
  const screenshots = [
    "home","solo-modal","game-hud","spawn-unobstructed-map",
    "player-spawned","founding-request","confirmed-empire",
    "political-offer-accepted","political-member-joined-founders-view",
    "political-crown-former-emperor-revoked","declared-war-live",
    "radial-attack-enabled","map-assault-confirmed",
    "combat-impact-canonical","peace-motion-proposed","peace-accepted-ended-war",
  ].map(label=>({name:"screenshot",label}));
  const proofs = [
    {name:"political-recipient-private-invitation",recipientOnly:true,secondAuthenticatedSession:true,originatingOfferReceiptMatched:true},
    {name:"political-accept-real-recipient-click",differentPrincipal:true,realCdpInput:true},
    {name:"political-membership-confirmed-by-both",recipientAccepted:true,founderRosterAgrees:true},
    {name:"political-crown-confirmed-by-both",formerEmperorRevoked:true,successorIsDifferentPrincipal:true},
    {name:"peace-real-opponent-click",differentPrincipal:true,realCdpInput:true},
    {name:"authoritative-peace-accepted",differentPrincipal:true,warEndedInBothViews:true},
  ];
  it("fails if an apparent full UI flow never proved independently authenticated players",()=>{
    for(const mode of ["national-desktop","national-mobile"]) {
      const base = {exactSource:"a".repeat(40),events:[...complete,...screenshots]};
      const fail=summarizeBrowserReport(base,0,mode);
      expect(fail.missingStages).toEqual([]);
      expect(fail.missingScreenshots).toEqual([]);
      expect(fail.failureClass).toBe("AUTHENTIC_MULTI_PRINCIPAL_EVIDENCE_MISSING");
      expect(fail.authenticMultiPrincipalEvidence).toBe(false);
      expect(fail.gameplayPassed).toBe(false);
    }
  });
  it("rejects each missing / forged principal, private invitation and bilateral roster proof",()=>{
    for(const [index,record] of proofs.entries()) {
      for(const variation of [
        proofs.filter((_,i)=>i!==index),
        proofs.map((r,i)=>i===index?{...r,...Object.fromEntries(
          Object.entries(record).filter(([k,v])=>k!=="name"&&v===true)
            .map(([k])=>[k,false]),
        )}:r),
      ]) {
        const result=summarizeBrowserReport({
          exactSource:"a".repeat(40),events:[...complete,...screenshots,...variation],
        },0,"national-mobile");
        expect(result.authenticMultiPrincipalEvidence).toBe(false);
        expect(result.gameplayPassed).toBe(false);
      }
    }
  });
  it("reports complete stage + screenshots + distinct principal markers separately from signed hardware",()=>{
    const result=summarizeBrowserReport({
      exactSource:"b".repeat(40),events:[...complete,...screenshots,...proofs],
    },0,"national-desktop");
    expect(result.authenticMultiPrincipalEvidence).toBe(true);
    expect(result.missingStages).toEqual([]);
    expect(result.missingScreenshots).toEqual([]);
    expect(result.gameplayPassed).toBe(true);
    // A diagnostic browser stage success is NOT signed independent release.
    expect(result.signedHardwareAttested).toBe(false);
    expect(result.publicReleasePassed).toBe(false);
  });
  it("preserves first failed political stage without leaking packet secrets",()=>{
    const r=summarizeBrowserReport({
      exactSource:"c".repeat(40),
      stage:"recipient-invitation",
      events:[{name:"stage-complete",stage:"offer-accession"},
        {name:"stage-failed",stage:"recipient-invitation"}],
      errors:[{stage:"recipient-invitation",
        error:"POLITICAL_SECOND_AUTHORIZED_BROWSER_SESSION_MISSING_OWNER_E2_E4_E6 rawPRIVATE"}],
      workerPackets:[{privateInvitation:"SECRET" }],
    },1,"national-mobile");
    expect(r.failedStage).toBe("recipient-invitation");
    expect(r.failureHint).toBe("POLITICAL_SECOND_SESSION_MISSING");
    expect(JSON.stringify(r)).not.toContain("rawPRIVATE");
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
});
