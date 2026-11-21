#!/usr/bin/env node
/**
 * E6 public artifact boundary. The browser may produce rich private packet,
 * console, URL and host diagnostics. None of those raw files leave the guest.
 * This publisher explicitly allowlists scalar acceptance observations.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MODES = [
  "national-desktop",
  "national-mobile",
  "legacy-desktop",
  "legacy-mobile",
];
const STAGES = new Set([
  "boot", "home", "solo", "legacy-ffa", "national-mode", "start",
  "spawn", "found-empire", "rejected-founding", "save-restore", "sovereign-victory",
]);
const SCREENSHOTS = new Set([
  "home", "solo-modal", "legacy-ffa-game-hud", "national-enabled",
  "game-hud", "diplomacy-before-spawn", "player-spawned",
  "founding-request", "confirmed-empire", "founding-rejected",
  "saved-confirmed", "restored-roster", "sovereign-victory",
]);
const PNG_MAGIC = Buffer.from("89504e470d0a1a0a", "hex");
const screenshotName = (value) => {
  if (!value.endsWith(".png")) return false;
  const label = value.slice(0, -4);
  return SCREENSHOTS.has(label) ||
    (label.startsWith("failure-") && STAGES.has(label.slice(8)));
};
const SHA = /^[a-f0-9]{40}$/;
const VERIFIED = new Set([
  "SIGNED_HOST_BACKED_VIRGL_VERIFIED",
  "SIGNED_PHYSICAL_GPU_VERIFIED",
]);
const number = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
const stage = (value) =>
  STAGES.has(value) ? value : null;

export function summarizeBrowserEvidence(report, expectedSha) {
  const sourceMatches =
    typeof expectedSha === "string" &&
    SHA.test(expectedSha) &&
    report?.exactSource === expectedSha;
  const events = Array.isArray(report?.events) ? report.events : [];
  const packets = Array.isArray(report?.workerPackets) ? report.workerPackets : [];
  const attest = events.find((entry) => entry?.name === "strict-hardware-renderer-attestation");
  const sourceHardware = report?.actualHardware?.webgl;
  const renderer = sourceHardware?.unmaskedRenderer;
  const rendererSafe =
    typeof renderer === "string" &&
    /^ANGLE [(]Mesa, virgl [(]Mesa Intel[(]R[)] HD Graphics 4600 [(]HSW GT2[)][)], OpenGL ES 3[.]2[)]$/.test(renderer)
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
      webgl1ShaderPixel: Array.isArray(report?.actualHardware?.webgl1?.shaderPixel)
        ? report.actualHardware.webgl1.shaderPixel.filter((n) => Number.isInteger(n) && n >= 0 && n <= 255).slice(0, 4)
        : [],
      webgl2ShaderPixel: Array.isArray(sourceHardware?.shaderPixel)
        ? sourceHardware.shaderPixel.filter((n) => Number.isInteger(n) && n >= 0 && n <= 255).slice(0, 4)
        : [],
    },
    completedStages: events
      .filter((event) => event?.name === "stage-complete")
      .map((event) => stage(event?.stage))
      .filter(Boolean)
      .slice(0, 40),
    packetCounts: {
      observed: packets.length,
      withPublicPolitics: packets.filter((p) => p?.publicPolitics !== null).length,
      acceptedResults: packets.reduce(
        (sum, p) => sum + (Array.isArray(p?.commandResults)
          ? p.commandResults.filter((r) => r?.accepted === true).length
          : 0),
        0,
      ),
      rejectedResults: packets.reduce(
        (sum, p) => sum + (Array.isArray(p?.commandResults)
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

export function publishEvidence(root, expectedSha) {
  const publicDir = join(root, "gpu", "public");
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
    ) recorded.set(candidate.scenario, candidate);
  }
  let valid = lines.length === MODES.length && recorded.size === MODES.length;
  const result = {
    schema: 1,
    expectedSourceSha: SHA.test(expectedSha ?? "") ? expectedSha : null,
    modes: {},
  };
  for (const mode of MODES) {
    const origin = join(root, "browser-" + mode);
    const file = join(origin, "acceptance.json");
    let raw = null;
    if (existsSync(file) && lstatSync(file).isFile() && lstatSync(file).size <= 4_000_000) {
      try {
        raw = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        raw = null;
      }
    }
    const summary = summarizeBrowserEvidence(raw, expectedSha);
    const status = recorded.get(mode);
    if (!summary.sourceMatches || (status?.result !== "PASS" && status?.result !== "FAIL")) valid = false;
    if (status?.result === "PASS" && !summary.hardware.proofAccepted) valid = false;
    const images = [];
    if (existsSync(origin)) {
      const outputDir = join(publicDir, mode);
      mkdirSync(outputDir, { recursive: true });
      for (const name of readdirSync(origin).sort()) {
        if (!screenshotName(name) || images.length >= 30) continue;
        const path = join(origin, name);
        const info = lstatSync(path);
        if (!info.isFile() || info.size > 8_000_000 || info.size < PNG_MAGIC.length) continue;
        if (!readFileSync(path).subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) continue;
        copyFileSync(path, join(outputDir, name));
        images.push(name);
      }
    }
    result.modes[mode] = {
      outcome: status?.result ?? "NOT_RUN",
      exitCode: number(status?.exitCode),
      ...summary,
      screenshotNames: images,
    };
  }
  writeFileSync(join(publicDir, "summary.json"), JSON.stringify(result, null, 2) + "\n");
  return valid;
}

if (process.argv[1]?.endsWith("sanitize-browser-evidence.mjs")) {
  const valid = publishEvidence(
    process.env.NATIONAL_QA_ARTIFACT_ROOT ?? "national-qa-artifacts",
    process.env.NATIONAL_GPU_CANDIDATE_SHA,
  );
  console.info("PUBLIC_GPU_EVIDENCE=" + (valid ? "VALID" : "INCOMPLETE_OR_UNTRUSTED"));
  if (!valid) process.exitCode = 1;
}
