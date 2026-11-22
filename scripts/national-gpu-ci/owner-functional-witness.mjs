#!/usr/bin/env node
// Owner-operated functional observation. Never a Skybot release certificate.
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STAGE = "stage3/conductor4-class2-integration-20261122";
const MODES = ["national-desktop", "national-mobile", "legacy-desktop", "legacy-mobile"];
const SHA = /^[0-9a-f]{40}$/;
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|swrast|lavapipe|basic render driver|microsoft basic|mesa offscreen/i;
const KNOWN_DEVICE = /intel|amd|radeon|nvidia|geforce|apple|adreno|mali|powervr|arc graphics/i;
const PIXEL = [51, 102, 153, 255];
const pixel = (a) => Array.isArray(a) && a.length === 4 && PIXEL.every((n, i) => a[i] === n);

export function classifyFunctional(mode, sha, exitCode, report) {
  const result = {
    mode,
    sourceMatches: false,
    rendererAndShadersObserved: false,
    functionalGameplayObserved: false,
    independentGameplayWitness: false,
    physicalDeviceInventory: "UNVERIFIED_BY_TOOL",
    signedPreflightAccepted: false,
    authenticatedArtifactCustody: false,
    physicalTeardownObserved: false,
    releaseCertified: false,
    reason: "REPORT_MISSING_OR_WRONG_SOURCE",
  };
  if (!MODES.includes(mode) || !SHA.test(sha) || report?.exactSource !== sha) return result;
  result.sourceMatches = true;
  const legacy = mode.startsWith("legacy-");
  const mobile = mode.endsWith("mobile");
  if (report.scenarioKind !== (legacy ? "legacy" : "national-solo") ||
      report.viewport !== (mobile ? "390x844 mobile" : "1280x800 desktop") ||
      report.hardwareAcceptanceRequired !== false) {
    result.reason = "WRONG_FUNCTIONAL_MODE_OR_LANE";
    return result;
  }
  const gl1 = report.actualHardware?.webgl1;
  const gl2 = report.actualHardware?.webgl;
  const valid = (gl) => gl?.supported === true && gl.contextLost === false &&
    gl.glError === 0 && !gl.shaderFailure && pixel(gl.shaderPixel) &&
    typeof gl.unmaskedRenderer === "string" && gl.unmaskedRenderer.length <= 240 &&
    typeof gl.unmaskedVendor === "string" &&
    KNOWN_DEVICE.test(gl.unmaskedRenderer) &&
    !SOFTWARE.test(gl.unmaskedRenderer + " " + gl.unmaskedVendor);
  if (!valid(gl1) || !valid(gl2) || gl1.unmaskedRenderer !== gl2.unmaskedRenderer) {
    result.reason = "HARDWARE_RENDERER_OR_SHADER_NOT_OBSERVED";
    return result;
  }
  result.rendererAndShadersObserved = true;
  result.renderer = gl2.unmaskedRenderer;
  if (exitCode !== 0 || !Array.isArray(report.errors) || report.errors.length !== 0 ||
      !Array.isArray(report.events)) {
    result.reason = "BROWSER_PROCESS_OR_REPORT_FAILED";
    return result;
  }
  const events = report.events;
  const completed = (stage) => events.some((e) => e?.name === "stage-complete" && e.stage === stage);
  const unique = (name) => {
    const matches = events.filter((e) => e?.name === name);
    return matches.length === 1 ? matches[0] : null;
  };
  const solo = unique("authoritative-solo-playability-complete");
  const stage = legacy ? "legacy-player-action" : "solo-playability-complete";
  const evidence = legacy
    ? completed("legacy-ffa") && unique("legacy-ffa-verified") &&
      unique("legacy-actual-map-interaction-authoritative-update")
    : !!solo && ["founded", "spawned", "warDeclared", "realRadialAttack", "opponentDamaged"]
      .every((field) => solo[field] === true) &&
      Number.isSafeInteger(solo.liveTick) && solo.liveTick > 0 &&
      Number.isSafeInteger(solo.workerPacketCount) && solo.workerPacketCount > 0;
  if (report.stage !== stage || !completed(stage) || !evidence) {
    result.reason = "AUTHORITATIVE_GAMEPLAY_NOT_COMPLETED";
    return result;
  }
  result.functionalGameplayObserved = true;
  result.reason = "OWNER_FUNCTIONAL_OBSERVATION_NOT_CERTIFICATION";
  return result;
}

function git(args) {
  const out = spawnSync("git", args, { encoding: "utf8", timeout: 30000 });
  if (out.status !== 0) throw Error("EXACT_SOURCE_CHECK_FAILED");
  return out.stdout.trim();
}

function assertSource(sha, remote = false) {
  if (git(["rev-parse", "HEAD"]) !== sha ||
      git(["status", "--porcelain", "--untracked-files=normal"]) !== "")
    throw Error("EXACT_REVIEWED_CHECKOUT_REQUIRED");
  if (remote) {
    const origin = git(["remote", "get-url", "origin"]);
    if (!/^(?:https:\/\/github[.]com\/|git@github[.]com:)LeviCade\/OpenFront-National(?:[.]git)?$/.test(origin))
      throw Error("OFFICIAL_ORIGIN_REQUIRED");
    const ref = "refs/heads/" + STAGE;
    if (git(["ls-remote", "--exit-code", "origin", ref]) !== sha + "\t" + ref)
      throw Error("COLLECTIVE_STAGING_CHANGED");
  }
}
function main() {
  if (process.env.GITHUB_ACTIONS === "true" || process.argv.length !== 3)
    throw Error("OWNER_LOCAL_EXECUTION_ONLY");
  const sha = process.argv[2];
  if (!SHA.test(sha)) throw Error("EXACT_REVIEWED_SHA_REQUIRED");
  if (git(["rev-parse", "--show-toplevel"]) !== process.cwd())
    throw Error("RUN_FROM_REVIEWED_REPOSITORY_ROOT");
  assertSource(sha, true);
  const chrome = process.env.CHROME_BIN;
  if (!chrome || resolve(chrome) !== chrome) throw Error("ABSOLUTE_OWNER_CHROME_BIN_REQUIRED");
  accessSync(chrome, constants.X_OK);
  if (!lstatSync(chrome).isFile()) throw Error("OWNER_CHROME_BIN_NOT_FILE");
  const root = "national-qa-artifacts";
  if (existsSync(root)) throw Error("FRESH_CHECKOUT_WITHOUT_STALE_REPORTS_REQUIRED");
  mkdirSync(root);
  const results = [];
  for (const mode of MODES) {
    const legacy = mode.startsWith("legacy-");
    const flags = [legacy ? "--legacy" : "--solo"];
    if (mode.endsWith("mobile")) flags.push("--mobile");
    const out = spawnSync(process.execPath, ["scripts/national-qa/browser-gameplay.mjs", ...flags], {
      stdio: "inherit",
      timeout: 205000,
      killSignal: "SIGKILL",
      env: {
        ...process.env,
        NATIONAL_REQUIRE_HARDWARE_GPU: "0",
        NATIONAL_QA_SOFTWARE_CDP: "0",
        NATIONAL_GPU_CANDIDATE_SHA: sha,
        GITHUB_SHA: sha,
      },
    });
    assertSource(sha);
    const folder = legacy ? "browser-legacy-ffa-" + mode.split("-")[1] : "browser-" + mode;
    const path = join(root, folder, "acceptance.json");
    let report;
    if (existsSync(path) && lstatSync(path).isFile() && lstatSync(path).size <= 4000000) {
      try { report = JSON.parse(readFileSync(path, "utf8")); } catch { /* blocked */ }
    }
    results.push(classifyFunctional(mode, sha, out.status, report));
  }
  assertSource(sha, true);
  const summary = { lane: "owner-functional", sourceSha: sha, results, releaseCertified: false };
  writeFileSync(join(root, "owner-functional-witness.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(summary));
  if (!results.every((r) => r.functionalGameplayObserved)) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error("OWNER_FUNCTIONAL_BLOCKED=" + (/^[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "OPERATOR_PREREQUISITE_UNAVAILABLE"));
    process.exitCode = 1;
  }
}
