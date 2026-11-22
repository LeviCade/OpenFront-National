#!/usr/bin/env node
/**
 * E6 public artifact boundary. The browser may produce rich private packet,
 * console, URL and host diagnostics. None of those raw files leave the guest.
 * This publisher explicitly allowlists scalar acceptance observations.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  lstatSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const MODES = [
  "national-desktop",
  "national-mobile",
  "legacy-desktop",
  "legacy-mobile",
];
export const REPORT_FOLDERS = Object.freeze({
  "national-desktop": "browser-national-desktop",
  "national-mobile": "browser-national-mobile",
  "legacy-desktop": "browser-legacy-ffa-desktop",
  "legacy-mobile": "browser-legacy-ffa-mobile",
});
const pixelMatches = (value) =>
  Array.isArray(value) &&
  value.length === 4 &&
  [51, 102, 153, 255].every((n, i) => value[i] === n);
const STAGES = new Set([
  "boot",
  "home",
  "solo",
  "legacy-ffa",
  "legacy-configuration",
  "legacy-player-action",
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
  "save-restore",
  "sovereign-victory",
  "solo-playability-complete",
]);
const SCREENSHOTS = new Set([
  "home",
  "solo-modal",
  "legacy-ffa-game-hud",
  "legacy-difficulty-restored",
  "legacy-player-action",
  "national-enabled",
  "game-hud",
  "diplomacy-before-spawn",
  "spawn-unobstructed-map",
  "player-spawned",
  "founding-request",
  "confirmed-empire",
  "founding-rejected",
  "political-offer-accepted",
  "political-member-joined-founders-view",
  "political-crown-former-emperor-revoked",
  "declared-war-live",
  "radial-attack-enabled",
  "map-assault-confirmed",
  "combat-impact-canonical",
  "peace-motion-proposed",
  "peace-accepted-ended-war",
  "saved-confirmed",
  "restored-roster",
  "sovereign-victory",
  "solo-battle-authoritative",
]);
// E5 R11's real browser steps supersede R10's synthetic end-of-game labels.
// Require all checked-in gameplay steps and authoritative receipt checkpoints;
// merely reaching Found Empire or creating a screenshot is never a pass.
const R11_NATIONAL_STAGES = [
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
];
const R11_NATIONAL_RECEIPTS = [
  "authoritative-empire-accepted",
  "authoritative-duplicate-rejected",
  "political-offer-engine-accepted",
  "political-recipient-private-invitation",
  "political-membership-confirmed-by-both",
  "political-crown-confirmed-by-both",
  "authoritative-war-declared",
  "authoritative-combat-impact",
  "authoritative-peace-proposal",
  "authoritative-peace-accepted",
];
export const SOLO_STAGES = [
  "home",
  "solo",
  "national-mode",
  "start",
  "spawn",
  "found-empire",
  "declare-war",
  "map-assault",
  "combat-impact",
  "solo-playability-complete",
];
export const LEGACY_STAGES = [
  "home",
  "solo",
  "legacy-configuration",
  "legacy-ffa",
  "legacy-player-action",
];
export function physicalGameplayContract(raw, mode) {
  const legacy = mode.startsWith("legacy-");
  if (
    raw?.scenarioKind !== (legacy ? "legacy" : "national-solo") ||
    raw.stage !== (legacy ? "legacy-player-action" : "solo-playability-complete") ||
    !Array.isArray(raw.errors) ||
    raw.errors.length !== 0 ||
    !Array.isArray(raw.events)
  )
    return false;
  const events = raw.events;
  const complete = (legacy ? LEGACY_STAGES : SOLO_STAGES).every(
    (stage) =>
      events.filter((e) => e?.name === "stage-complete" && e.stage === stage)
        .length === 1,
  );
  if (!complete) return false;
  const unique = (name) => {
    const entries = events.filter((e) => e?.name === name);
    return entries.length === 1 ? entries[0] : null;
  };
  if (legacy)
    return !!(
      unique("legacy-ffa-verified") &&
      unique("legacy-actual-map-interaction-authoritative-update")
    );
  const end = unique("authoritative-solo-playability-complete");
  const battle = unique("solo-real-battle-engine-correlated");
  return !!(
    unique("authoritative-empire-accepted")?.verified === true &&
    unique("authoritative-war-declared")?.uiConfirmed === true &&
    unique("authoritative-combat-impact") &&
    battle?.opponentDamaged === true &&
    (battle.troopLoss === true || battle.territoryLoss === true) &&
    ["founded", "spawned", "warDeclared", "realRadialAttack", "opponentDamaged"].every(
      (name) => end?.[name] === true,
    ) &&
    Number.isSafeInteger(end.liveTick) &&
    end.liveTick > 0 &&
    Number.isSafeInteger(end.workerPacketCount) &&
    end.workerPacketCount > 0
  );
}
const PNG_MAGIC = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_IEND = Buffer.from("0000000049454e44ae426082", "hex");
const screenshotName = (value) => {
  if (!value.endsWith(".png")) return false;
  const label = value.slice(0, -4);
  return (
    SCREENSHOTS.has(label) ||
    (label.startsWith("failure-") && STAGES.has(label.slice(8)))
  );
};
const SHA = /^[a-f0-9]{40}$/;
const VERIFIED = new Set([
  "SIGNED_HOST_BACKED_VIRGL_VERIFIED",
  "SIGNED_PHYSICAL_GPU_VERIFIED",
]);
const number = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
const stage = (value) => (STAGES.has(value) ? value : null);

export function summarizeBrowserEvidence(report, expectedSha) {
  const sourceMatches =
    typeof expectedSha === "string" &&
    SHA.test(expectedSha) &&
    report?.exactSource === expectedSha;
  const events = Array.isArray(report?.events) ? report.events : [];
  const packets = Array.isArray(report?.workerPackets)
    ? report.workerPackets
    : [];
  const attest = events.find(
    (entry) => entry?.name === "strict-hardware-renderer-attestation",
  );
  const sourceHardware = report?.actualHardware?.webgl;
  const renderer = sourceHardware?.unmaskedRenderer;
  const rendererSafe =
    typeof renderer === "string" &&
    /^ANGLE [(]Mesa, virgl [(]Mesa Intel[(]R[)] HD Graphics 4600 [(]HSW GT2[)][)], OpenGL ES 3[.]2[)]$/.test(
      renderer,
    )
      ? renderer
      : null;
  return {
    exactSource: sourceMatches ? expectedSha : null,
    sourceMatches,
    stageReached: stage(report?.stage),
    elapsedMs: number(report?.elapsedMs),
    hardware: {
      proofAccepted: attest?.accepted === true && VERIFIED.has(attest?.reason),
      verdict: VERIFIED.has(attest?.reason) ? attest.reason : null,
      renderer: rendererSafe,
      webgl1ShaderPixel: Array.isArray(
        report?.actualHardware?.webgl1?.shaderPixel,
      )
        ? report.actualHardware.webgl1.shaderPixel
            .filter((n) => Number.isInteger(n) && n >= 0 && n <= 255)
            .slice(0, 4)
        : [],
      webgl2ShaderPixel: Array.isArray(sourceHardware?.shaderPixel)
        ? sourceHardware.shaderPixel
            .filter((n) => Number.isInteger(n) && n >= 0 && n <= 255)
            .slice(0, 4)
        : [],
    },
    completedStages: events
      .filter((event) => event?.name === "stage-complete")
      .map((event) => stage(event?.stage))
      .filter(Boolean)
      .slice(0, 40),
    packetCounts: {
      observed: packets.length,
      withPublicPolitics: packets.filter(
        (p) => p?.publicPolitics !== null && p?.publicPolitics !== undefined,
      ).length,
      acceptedResults: packets.reduce(
        (sum, p) =>
          sum +
          (Array.isArray(p?.commandResults)
            ? p.commandResults.filter((r) => r?.accepted === true).length
            : 0),
        0,
      ),
      rejectedResults: packets.reduce(
        (sum, p) =>
          sum +
          (Array.isArray(p?.commandResults)
            ? p.commandResults.filter((r) => r?.accepted === false).length
            : 0),
        0,
      ),
    },
    errorCount: Array.isArray(report?.errors) ? report.errors.length : 0,
    networkFailureCount: Array.isArray(report?.networkErrors)
      ? report.networkErrors.length
      : 0,
    restrictedAssetCount: Array.isArray(report?.restrictedRuntimeAssets)
      ? report.restrictedRuntimeAssets.length
      : 0,
  };
}

export function publishEvidence(root, expectedSha, kind = "release") {
  if (!["diagnostic", "release"].includes(kind)) {
    throw Error("Unrecognized GPU acceptance lane");
  }
  const publicDir = join(root, "gpu", "public", kind);
  // Never follow a symlink or publish unrelated files left by an earlier run.
  // A source-run evidence lane is immutable once written: reusing it is an
  // operator error, not permission to upload mixed/stale screenshots.
  for (const path of [
    root,
    join(root, "gpu"),
    join(root, "gpu", "public"),
    publicDir,
  ]) {
    if (existsSync(path) && !lstatSync(path).isDirectory()) {
      throw Error("PUBLIC_EVIDENCE_PATH_NOT_A_DIRECTORY");
    }
  }
  if (existsSync(publicDir) && readdirSync(publicDir).length !== 0) {
    throw Error("PUBLIC_EVIDENCE_DIRECTORY_NOT_EMPTY");
  }
  mkdirSync(publicDir, { recursive: true });
  const resultsPath = join(root, "gpu", "scenarios.jsonl");
  const lines = existsSync(resultsPath)
    ? readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  // Never publish arbitrary strings copied from JSON lines or the browser.
  const recorded = new Map();
  for (const line of lines.slice(0, 16)) {
    let candidate;
    try {
      candidate = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      MODES.includes(candidate?.scenario) &&
      !recorded.has(candidate.scenario) &&
      (candidate.result === "PASS" || candidate.result === "FAIL") &&
      Number.isInteger(candidate.exitCode)
    )
      recorded.set(candidate.scenario, candidate);
  }
  let valid = lines.length === MODES.length && recorded.size === MODES.length;
  const result = {
    schema: 1,
    expectedSourceSha: SHA.test(expectedSha ?? "") ? expectedSha : null,
    modes: {},
  };
  for (const mode of MODES) {
    const origin = join(root, REPORT_FOLDERS[mode]);
    const file = join(origin, "acceptance.json");
    let raw = null;
    if (
      existsSync(file) &&
      lstatSync(file).isFile() &&
      lstatSync(file).size <= 4_000_000
    ) {
      try {
        raw = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        raw = null;
      }
    }
    const summary = summarizeBrowserEvidence(raw, expectedSha);
    const status = recorded.get(mode);
    const expectedViewport = mode.endsWith("mobile")
      ? "390x844 mobile"
      : "1280x800 desktop";
    const actualViewport =
      raw?.viewport === "390x844 mobile" || raw?.viewport === "1280x800 desktop"
        ? raw.viewport
        : null;
    if (
      !summary.sourceMatches ||
      (status?.result !== "PASS" && status?.result !== "FAIL")
    )
      valid = false;
    const historicalEvents = Array.isArray(raw?.events) ? raw.events : [];
    const hasEvent = (name) =>
      historicalEvents.some((event) => event?.name === name);
    const stageComplete = kind === "release"
      ? physicalGameplayContract(raw, mode)
      : mode.startsWith("legacy-")
      ? ["legacy-ffa", "legacy-player-action"].every((s) =>
          summary.completedStages.includes(s),
        ) &&
        hasEvent("legacy-ffa-verified") &&
        hasEvent("legacy-actual-map-interaction-authoritative-update")
      : R11_NATIONAL_STAGES.every((s) => summary.completedStages.includes(s)) &&
        R11_NATIONAL_RECEIPTS.every(hasEvent);
    const gl1 = raw?.actualHardware?.webgl1;
    const gl2 = raw?.actualHardware?.webgl;
    const physicalDiagnostic =
      gl1?.supported === true &&
      gl2?.supported === true &&
      gl1.contextLost === false &&
      gl2.contextLost === false &&
      pixelMatches(gl1.shaderPixel) &&
      pixelMatches(gl2.shaderPixel) &&
      typeof gl1.unmaskedRenderer === "string" &&
      /virgl/i.test(gl1.unmaskedRenderer) &&
      !/swiftshader|llvmpipe|lavapipe|softpipe|software|swrast/i.test(
        gl1.unmaskedRenderer,
      ) &&
      summary.hardware.renderer !== null;
    // Browser JSON is guest-originated. Its "accepted" event is a CLAIM,
    // not a controller signature checked against a host-owned trust root.
    // Only verify-independent-release.mjs, running AFTER guest disposal,
    // can turn a complete release report into an independently certified PASS.
    const browserClaimedSignedProof =
      raw?.hardwareAcceptanceRequired === true &&
      summary.hardware.proofAccepted === true;
    const signed = false;
    const laneMatches =
      raw?.hardwareAcceptanceRequired === (kind === "release");
    const viewportMatches = actualViewport === expectedViewport;
    const statusExitMatches =
      status?.result === (status?.exitCode === 0 ? "PASS" : "FAIL");
    const reportedPass = status?.result === "PASS";
    const scenarioAccepted =
      summary.sourceMatches &&
      laneMatches &&
      viewportMatches &&
      statusExitMatches &&
      physicalDiagnostic &&
      stageComplete &&
      (kind === "diagnostic" || browserClaimedSignedProof);
    if (reportedPass && !scenarioAccepted) valid = false;
    if (!statusExitMatches) valid = false;
    let outcome = !status
      ? "NOT_RUN"
      : reportedPass
        ? scenarioAccepted && kind === "diagnostic"
          ? "PASS"
          : "UNVERIFIED"
        : "FAIL";
    let reason = !status
      ? "PROCESS_NOT_RUN"
      : !raw
        ? "REPORT_MISSING_OR_INVALID"
        : !summary.sourceMatches
          ? "SOURCE_MISMATCH"
          : !viewportMatches
            ? "VIEWPORT_MISMATCH"
            : !laneMatches
              ? "EVIDENCE_LANE_MISMATCH"
              : !physicalDiagnostic
                ? "GPU_OBSERVATION_INCOMPLETE"
                : status.exitCode !== 0
                  ? summary.stageReached
                    ? "GAMEPLAY_STAGE_" +
                      summary.stageReached.toUpperCase().replaceAll("-", "_")
                    : "BROWSER_PROCESS_FAILURE"
                  : !stageComplete
                    ? "GAMEPLAY_INCOMPLETE"
                    : kind === "release" && !browserClaimedSignedProof
                      ? "BROWSER_SIGNED_PREFLIGHT_NOT_REPORTED"
                      : kind === "release"
                        ? "SIGNED_WITNESS_NOT_VERIFIED"
                        : "NONE";
    summary.hardware.diagnosticObserved = physicalDiagnostic;
    summary.hardware.browserClaimedSignedProof = browserClaimedSignedProof;
    summary.hardware.proofAccepted = signed;
    summary.hardware.verdict = signed ? summary.hardware.verdict : null;
    const images = [];
    const screenshotSha256 = {};
    if (existsSync(origin) && lstatSync(origin).isDirectory()) {
      const outputDir = join(publicDir, mode);
      mkdirSync(outputDir, { recursive: true });
      for (const name of readdirSync(origin).sort()) {
        if (!screenshotName(name) || images.length >= 30) continue;
        const path = join(origin, name);
        const info = lstatSync(path);
        if (!info.isFile() || info.size < 45 || info.size > 4_000_000) continue;
        const png = readFileSync(path);
        if (
          !png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC) ||
          !png.subarray(-12).equals(PNG_IEND) ||
          png.subarray(12, 16).toString("ascii") !== "IHDR" ||
          png.readUInt32BE(16) < 1 ||
          png.readUInt32BE(16) > 4096 ||
          png.readUInt32BE(20) < 1 ||
          png.readUInt32BE(20) > 4096
        )
          continue;
        copyFileSync(path, join(outputDir, name));
        images.push(name);
        screenshotSha256[name] = createHash("sha256").update(png).digest("hex");
      }
    }
    const requiredScreenshot = mode.startsWith("legacy-")
      ? "legacy-player-action.png"
      : "solo-battle-authoritative.png";
    const screenshotReady =
      images.length > 0 && (kind !== "release" || images.includes(requiredScreenshot));
    if (reportedPass && scenarioAccepted && !screenshotReady) {
      valid = false;
      outcome = "UNVERIFIED";
      reason = "SCREENSHOT_MISSING";
    }
    result.modes[mode] = {
      scenario: mode,
      scenarioKind: ["legacy", "national-solo", "national-three-player"].includes(raw?.scenarioKind)
        ? raw.scenarioKind
        : null,
      reportPath: REPORT_FOLDERS[mode] + "/acceptance.json",
      outcome,
      reason,
      exitCode: number(status?.exitCode),
      stageComplete,
      viewportMatches,
      laneMatches,
      releaseCertified: false,
      evidenceReadyForHostReview:
        kind === "release" &&
        reportedPass &&
        scenarioAccepted &&
        screenshotReady,
      reportPresent: raw !== null,
      expectedViewport,
      actualViewport,
      firstFailedStage: status?.exitCode !== 0 ? summary.stageReached : null,
      screenshotCount: images.length,
      ...summary,
      screenshotNames: images,
      screenshotSha256,
    };
    writeFileSync(
      join(publicDir, mode + ".json"),
      JSON.stringify(result.modes[mode], null, 2) + "\n",
    );
  }
  result.schema = 4;
  result.lane = kind;
  result.exactCandidateSha = SHA.test(expectedSha ?? "") ? expectedSha : null;
  result.allModesPass =
    valid && MODES.every((mode) => result.modes[mode].outcome === "PASS");
  result.evidenceReadyForHostReview =
    kind === "release" &&
    valid &&
    MODES.every((mode) => result.modes[mode].evidenceReadyForHostReview);
  result.classification =
    kind === "diagnostic"
      ? "UNSIGNED_DIAGNOSTIC_NOT_RELEASE"
      : "E5_BROWSER_SIGNED_GATE_PENDING_HOST_CLEANUP";
  result.releaseCertified = false;
  result.hostCleanupVerified = false;
  writeFileSync(
    join(publicDir, "summary.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  // Successful transport of complete evidence is not release acceptance.
  return kind === "release"
    ? result.evidenceReadyForHostReview
    : result.allModesPass;
}

if (process.argv[1]?.endsWith("sanitize-browser-evidence.mjs")) {
  const index = process.argv.indexOf("--kind");
  const kind = index < 0 ? "release" : process.argv[index + 1];
  const valid = publishEvidence(
    process.env.NATIONAL_QA_ARTIFACT_ROOT ?? "national-qa-artifacts",
    process.env.NATIONAL_GPU_CANDIDATE_SHA,
    kind,
  );
  console.info(
    "PUBLIC_GPU_EVIDENCE=" +
      (valid
        ? kind === "release"
          ? "READY_FOR_INDEPENDENT_HOST_REVIEW_NOT_CERTIFIED"
          : "VALID_DIAGNOSTIC"
        : "INCOMPLETE_OR_UNTRUSTED"),
  );
  if (!valid) process.exitCode = 1;
}
