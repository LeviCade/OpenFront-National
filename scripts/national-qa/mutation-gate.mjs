#!/usr/bin/env node
/**
 * Strict E5 Round Six negative controls. This script changes source files
 * ONLY in the disposable CI checkout, executes genuine independent tests,
 * proves the expected assertion turns RED, then restores exact bytes.
 *
 * It NEVER commits engine/client/wire changes or interprets compile errors,
 * unrelated failures, missing tests, or timeouts as a successful mutation.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = "national-qa-artifacts/mutations";
mkdirSync(dir, { recursive: true });
const cases = [
  {
    id: "missing-war-authorization",
    file: "packages/engine/src/execution/NationalWarExecution.ts",
    before:
      "return authority\n    ? authority.authorizeOffensiveAction(attackerId, targetId)\n    : targetId === null;",
    after: "return true;",
    suite: "tests/e2e/national/RoundFiveWarLevy.test.ts",
    name: "WAR-01 unauthorized attack is rejected without troop debit",
  },
  {
    id: "bypass-stale-cas",
    file: "packages/engine/src/game/PlayerImpl.ts",
    before: "if (row.player._troops !== expected)",
    after: "if (false && row.player._troops !== expected)",
    suite: "tests/e2e/national/RoundFiveWarLevy.test.ts",
    name: "LEVY-05/06 actual CAS rejects stale and duplicate funding",
  },
  {
    id: "leak-foreign-player",
    file: "packages/engine/src/national/observation/NationalOutbound.ts",
    before:
      "const players = rawPlayer.map((u) =>\n      u.id === ownID ? { ...u } : publicPlayer(u),\n    );",
    after: "const players = rawPlayer.map((u) => ({ ...u }));",
    suite: "tests/qa/national/PacketCanaries.test.ts",
    name: "does not emit hidden troops, ships, diplomatic text",
  },
];
const outcomes = [];
let failed = false;

function command(cmd, args) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });
}
const sha = command("git", ["rev-parse", "HEAD"]).stdout.trim();
for (const entry of cases) {
  const original = readFileSync(entry.file, "utf8");
  const matches = original.split(entry.before).length - 1;
  if (matches !== 1) {
    outcomes.push({
      id: entry.id,
      verdict: "FAIL",
      reason: "Source mutation anchor not found exactly once",
      count: matches,
    });
    failed = true;
    continue;
  }
  let result;
  try {
    writeFileSync(entry.file, original.replace(entry.before, entry.after));
    result = command("node_modules/.bin/vitest", [
      "run",
      "--project",
      "node",
      entry.suite,
      "-t",
      entry.name,
    ]);
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    writeFileSync(dir + "/" + entry.id + ".log", output);
    // Require the targeted test to report an ASSERTION failure, not a
    // compilation, test discovery, import, timeout or environment error.
    const targetFailed =
      result.status !== 0 &&
      !result.error &&
      !result.signal &&
      output.includes(entry.name) &&
      /FAIL|Failed Tests|AssertionError|unauthorized packet disclosure/.test(
        output,
      ) &&
      !/Error parsing|Failed to resolve|No test files found|Timed out/.test(
        output,
      );
    outcomes.push({
      id: entry.id,
      verdict: targetFailed ? "PASS (gate rejected mutation)" : "FAIL",
      targetedAssertionFailed: targetFailed,
      exitCode: result.status,
      timedOut: Boolean(result.error ?? result.signal),
      test: entry.name,
    });
    if (!targetFailed) failed = true;
  } finally {
    writeFileSync(entry.file, original);
  }
}
const check = command("git", [
  "diff",
  "--exit-code",
  "--",
  ...cases.map((entry) => entry.file),
]);
if (check.status !== 0) {
  failed = true;
  outcomes.push({
    id: "restore-original-source",
    verdict: "FAIL",
    reason: "Mutation probe left production source modified",
  });
}
const report = {
  exactSource: sha,
  results: outcomes,
  verdict: failed ? "FAIL" : "PASS",
};
writeFileSync(dir + "/results.json", JSON.stringify(report, null, 2) + "\n");
console.info("QA_R6_MUTATION_GATE " + JSON.stringify(report));
if (failed) process.exitCode = 1;
