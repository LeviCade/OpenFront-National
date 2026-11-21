import { describe, expect, it } from "vitest";
import {
  C2_PATHS,
  classifySoloOrLegacy,
  classifyPrivateNational,
  verifyPrivateBrowserTopology,
} from "../../../scripts/national-qa/browser-c2-verdict.mjs";

const sha = "2cfe3d4f91f28df61c7ebd7c429c9fdca674daf0";
const proof = (mode) => {
  const config = C2_PATHS[mode];
  const events = [
    ...config.stages.map((stage) => ({ name: "stage-complete", stage })),
    ...config.screenshots.map((label) => ({ name: "screenshot", label })),
  ];
  if (config.kind === "legacy") {
    events.push(
      {
        name: "legacy-ffa-verified",
        nationalPanelAbsent: true,
        workerPacketCount: 12,
      },
      {
        name: "legacy-actual-map-interaction-authoritative-update",
        playerTiles: 6,
        lastTick: 12,
        via: mode.endsWith("mobile") ? "touch" : "mouse",
      },
    );
  } else {
    events.push(
      {
        name: "solo-transport-admission-observed",
        gameTypeIsSolo: true,
        actorPresent: true,
        gameIdPresent: true,
        tick: 1,
      },
      {
        name: "engine-spawn-verified",
        unobstructedInputs: 1,
        tickBefore: 1,
        tickAfter: 4,
      },
      {
        name: "founding-real-click-submitted",
        actorCorrelated: true,
        requestFingerprint: "0123456789abcdef",
      },
      {
        name: "authoritative-empire-accepted",
        verified: true,
        authenticPublicRoster: true,
        recipientCorrelated: true,
      },
      { name: "authoritative-war-declared", receiptTick: 8, sequence: 6 },
      {
        name: "real-target-aware-radial-attack",
        targetMatch: true,
        enabled: true,
        pointer: mode.endsWith("mobile") ? "touch" : "mouse",
      },
      {
        name: "solo-real-battle-engine-correlated",
        opponentDamaged: true,
        troopLoss: true,
        territoryLoss: false,
      },
      { name: "authoritative-combat-impact", actualOpponentLoss: true },
      {
        name: "authoritative-solo-playability-complete",
        founded: true,
        spawned: true,
        warDeclared: true,
        realRadialAttack: true,
        opponentDamaged: true,
        liveTick: 19,
      },
    );
  }
  return {
    exactSource: sha,
    scenarioKind: config.kind,
    viewport: config.viewport,
    events,
    errors: [],
    console: [],
    networkErrors: [],
    workerPackets: [{ tick: 8, sequence: 2 }],
    actualHardware: {
      browser: { product: "Chrome/144" },
      webgl1: { shaderPixel: [51, 102, 153, 255] },
      webgl: { renderer: "WebGL", shaderPixel: [51, 102, 153, 255] },
    },
    submittedFounding: { authenticRequestObserved: true },
  };
};
const result = (
  mode,
  report = proof(mode),
  labels = C2_PATHS[mode].screenshots,
) =>
  classifySoloOrLegacy({
    mode,
    report,
    screenshotLabels: labels,
    exitCode: 0,
    expectedSha: sha,
  });

describe("C2 E5 proof rejects optimistic browser and release claims", () => {
  for (const mode of Object.keys(C2_PATHS)) {
    it("classifies source-only witness for " + mode, () => {
      const verdict = result(mode);
      expect(verdict.gameplay).toBe("PASS");
      expect(verdict.hardware).toBe("BLOCKED");
      expect(verdict.certifiedRelease).toBe(false);
    });
  }
  it("does not require fake B/C players for Solo", () => {
    expect(C2_PATHS["national-solo-desktop"].args).toEqual(["--solo"]);
    expect(C2_PATHS["national-solo-mobile"].args).toEqual([
      "--solo",
      "--mobile",
    ]);
  });
  it("rejects source mismatch despite optimistic pass", () => {
    const report = proof("national-solo-desktop");
    report.exactSource = "f".repeat(40);
    report.gameplayPassed = true;
    expect(result("national-solo-desktop", report).firstFailure.code).toBe(
      "SOURCE_SHA_MISMATCH_OR_MISSING",
    );
  });
  it("requires real PNG files as well as screenshot events", () => {
    expect(
      result("legacy-mobile", proof("legacy-mobile"), ["home"]).gameplay,
    ).toBe("FAIL");
  });
  it("rejects screen events without genuine founding/roster", () => {
    const report = proof("national-solo-mobile");
    report.events = report.events.filter(
      (e) => e.name !== "authoritative-empire-accepted",
    );
    expect(
      result("national-solo-mobile", report).checksFailed.some(
        (x) => x.code === "FOUNDING_RECEIPT_OR_ROSTER_MISSING",
      ),
    ).toBe(true);
  });
  it("rejects a radial click that never produces actual engine damage", () => {
    const report = proof("national-solo-desktop");
    report.events = report.events.filter(
      (e) => e.name !== "solo-real-battle-engine-correlated",
    );
    expect(
      result("national-solo-desktop", report).checksFailed.some(
        (x) => x.code === "REAL_RADIAL_BATTLE_DAMAGE_UNPROVEN",
      ),
    ).toBe(true);
  });
  it("routes an actual sanitized WebGL failure to E6 before missing downstream stages", () => {
    const report = proof("national-solo-desktop");
    report.errors = [{
      stage: "start",
      error: "REAL_CHROMIUM_GPU_REQUIRED: WebGL gate",
    }];
    report.events.push({ name: "stage-failed", stage: "start" });
    const verdict = result("national-solo-desktop", report);
    expect(verdict.gameplay).toBe("FAIL");
    expect(verdict.firstFailedStage).toBe("start");
    expect(verdict.firstFailure).toEqual({
      code: "REAL_CHROMIUM_GPU_REQUIRED: WebGL gate",
      owner: "E6/DIAGNOSTIC_ENVIRONMENT",
    });
    expect(verdict.hardware).toBe("BLOCKED");
  });
  it("refuses a browser runtime exception even if other evidence appears sound", () => {
    const report = proof("legacy-desktop");
    report.console = [{ severity: "exception" }];
    const verdict = result("legacy-desktop", report);
    expect(verdict.gameplay).toBe("FAIL");
    expect(verdict.checksFailed.some((entry) =>
      entry.code === "BROWSER_CONSOLE_ERRORS_UNREVIEWED")).toBe(true);
  });
  it("rejects a software renderer even when browser draws", () => {
    const report = proof("legacy-desktop");
    report.events.push({
      name: "strict-hardware-renderer-attestation",
      accepted: true,
      reason: "SIGNED_PHYSICAL_GPU_VERIFIED",
    });
    expect(result("legacy-desktop", report).hardware).toBe("BLOCKED");
    report.actualHardware.webgl.shaderPixel = [0, 0, 0, 0];
    expect(result("legacy-desktop", report).gameplay).toBe("FAIL");
  });
  it("rejects duplicated auth profiles and a different match", () => {
    const seats = [9222, 9223, 9224].map((port) => ({
      cdpPort: port,
      connected: true,
      browserTargetType: "page",
      browserProduct: "Chrome/144",
      principalId: "A",
      matchId: "server-match",
      hostAdmitted: true,
      serverOwnedProjection: true,
      serverTick: 12,
      visibleMapRendered: true,
      spectator: false,
    }));
    expect(verifyPrivateBrowserTopology(seats).reason).toBe(
      "THREE_INDEPENDENT_VERIFIED_ACCOUNTS_REQUIRED",
    );
    seats[1].principalId = "B";
    seats[2].principalId = "C";
    expect(verifyPrivateBrowserTopology(seats).accepted).toBe(true);
    seats[2].matchId = "fake-other-match";
    expect(verifyPrivateBrowserTopology(seats).accepted).toBe(false);
    seats[2].matchId = "server-match";
    seats[2].spectator = true;
    expect(verifyPrivateBrowserTopology(seats).accepted).toBe(false);
  });
  it("never promotes a three-browser smoke without E6 witness", () => {
    const verdict = classifyPrivateNational({
      topology: { accepted: true },
      joined: true,
      bilateralAccession: true,
      privateViewsDifferent: true,
      warReceipt: true,
      opponentPeace: true,
      reconnectRevokedOldSocket: true,
      spectatorDenied: true,
      hostWitnessVerified: false,
    });
    expect(verdict.gameplay).toBe("BLOCKED");
    expect(verdict.firstFailure).toBe(
      "INDEPENDENT_TRUSTED_HOST_WITNESS_MISSING",
    );
  });
});
