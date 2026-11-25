#!/usr/bin/env node
// Owner-only reviewed-ref diagnostic, distinct from strict release attestation.
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODES, REPORT_FOLDERS } from "../national-gpu-ci/sanitize-browser-evidence.mjs";
import { classifyOwnerResolution } from "./browser-c7-owner-verdict.mjs";

const refs = new Set([
  "refs/heads/stage3/c7c1-e5-graphical-acceptance",
  "refs/heads/stage3/conductor7-class1-integration-20261125",
]);
const founding = "00673dce1ff61c61e44b026e6bd8c7a92f642ff8";
const sha = process.env.NATIONAL_GPU_CANDIDATE_SHA;
const software = process.argv.includes("--software");
const git = (...args) => {
  const out = spawnSync("git", args, { encoding: "utf8", timeout: 30000 });
  if (out.status !== 0) throw Error("EXACT_SOURCE_CHECK_FAILED");
  return out.stdout.trim();
};
function assertSource() {
  if (
    git("rev-parse", "HEAD") !== sha ||
    git("diff", "--name-only", "HEAD", "--") !== ""
  ) throw Error("EXACT_REVIEWED_CHECKOUT_REQUIRED");
}
function assertAdmission() {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== "LeviCade/OpenFront-National" ||
    !refs.has(process.env.GITHUB_REF) ||
    !["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME) ||
    !/^[0-9a-f]{40}$/.test(sha ?? "") ||
    process.env.GITHUB_SHA !== sha ||
    process.env.NATIONAL_REQUIRE_HARDWARE_GPU !== "0" ||
    (software
      ? process.env.RUNNER_ENVIRONMENT !== "github-hosted" ||
        process.env.NATIONAL_QA_SOFTWARE_CDP !== "1"
      : process.env.GITHUB_ACTOR !== "LeviCade" ||
        process.env.RUNNER_ENVIRONMENT !== "self-hosted" ||
        process.getuid?.() === 0 ||
        process.env.NATIONAL_QA_SOFTWARE_CDP !== "0")
  ) throw Error("OWNER_FUNCTIONAL_ADMISSION_REFUSED");
  assertSource();
  git("merge-base", "--is-ancestor", founding, sha);
  if (!software &&
      git("ls-remote", "--exit-code", "origin", process.env.GITHUB_REF) !==
        sha + "\t" + process.env.GITHUB_REF)
    throw Error("OWNER_FUNCTIONAL_REVIEWED_REF_MOVED");
}
const root = "national-qa-artifacts";
const output = join(root, "c7-owner-functional");
const safeScreenshots = new Set([
  "home.png",
  "solo-modal.png",
  "national-enabled.png",
  "legacy-difficulty-restored.png",
  "player-spawned.png",
  "declared-war-live.png",
  "radial-attack-enabled.png",
  "combat-impact-canonical.png",
  "solo-battle-authoritative.png",
  "legacy-player-action.png",
  "sovereign-victory.png",
]);
function readReport(folder) {
  const path = join(folder, "acceptance.json");
  if (!existsSync(folder) || !lstatSync(folder).isDirectory() ||
      !existsSync(path) || !lstatSync(path).isFile() ||
      lstatSync(path).size > 4_000_000) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
function saveScreenshots(folder, mode, report) {
  if (report?.exactSource !== sha ||
      report?.scenarioKind !== (mode.startsWith("legacy-") ? "legacy" : "national-solo") ||
      report?.restrictedRuntimeAssets?.length !== 0) return [];
  const target = join(output, mode);
  const saved = [];
  mkdirSync(target);
  for (const name of safeScreenshots) {
    const path = join(folder, name);
    if (!existsSync(path)) continue;
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size < 45 || stat.size > 4_000_000) continue;
    const png = readFileSync(path);
    if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        png.subarray(-12).toString("hex") !== "0000000049454e44ae426082" ||
        png.subarray(12, 16).toString("ascii") !== "IHDR" ||
        png.readUInt32BE(16) < 1 || png.readUInt32BE(16) > 4096 ||
        png.readUInt32BE(20) < 1 || png.readUInt32BE(20) > 4096) continue;
    writeFileSync(join(target, name), png, { flag: "wx" });
    saved.push(name);
  }
  return saved;
}

assertAdmission();
if (existsSync(root)) throw Error("FRESH_CHECKOUT_WITHOUT_STALE_REPORTS_REQUIRED");
mkdirSync(output, { recursive: true });
const privateLogs = mkdtempSync(join(tmpdir(), "c7-owner-"));
const results = [];
let abnormal = false;
try {
  for (const mode of MODES) {
    if (abnormal) {
      results.push({ mode, reason: "NOT_RUN_AFTER_ABNORMAL_PROCESS", gameplayObserved: false });
      continue;
    }
    assertSource();
    const flags = [mode.startsWith("legacy-") ? "--legacy" : "--solo", "--owner-functional-resolution"];
    if (mode.endsWith("mobile")) flags.push("--mobile");
    const fd = openSync(join(privateLogs, mode + ".log"), "wx", 0o600);
    let out;
    try {
      out = spawnSync(
        "timeout",
        ["--kill-after=10s", "600s", process.execPath, "scripts/national-qa/browser-gameplay.mjs", ...flags],
        { stdio: ["ignore", fd, fd] },
      );
    } finally {
      closeSync(fd);
    }
    assertSource();
    const folder = join(root, REPORT_FOLDERS[mode]);
    const report = readReport(folder);
    const result = classifyOwnerResolution(mode, sha, out.status, report, software);
    result.exitCode = out.status;
    result.screenshots = saveScreenshots(folder, mode, report);
    if (result.gameplayObserved && !result.screenshots.includes("sovereign-victory.png")) {
      result.gameplayObserved = false;
      result.reason = "TERMINAL_SCREENSHOT_MISSING";
    }
    results.push(result);
    console.log(JSON.stringify(result));
    abnormal = Boolean(out.error || out.signal || [124, 137].includes(out.status));
  }
  assertAdmission();
} finally {
  rmSync(privateLogs, { recursive: true, force: true });
  const summary = {
    exactSource: sha,
    lane: software ? "software-only" : "owner-functional",
    results,
    allModesObserved: !software && results.length === MODES.length &&
      results.every((r) => r.gameplayObserved),
    releaseCertified: false,
    independentGameplayWitness: false,
  };
  writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
  if (!summary.allModesObserved) process.exitCode = 1;
}
