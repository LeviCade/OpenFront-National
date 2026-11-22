import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishHostRecordOnce, verifyRunGrant } from "./host-run-grant.mjs";

const ref = "stage3/conductor4-class2-integration-20261122";
const expected = {
  repository: "LeviCade/OpenFront-National", repositoryId: "1459234894",
  sourceSha: "a".repeat(40), approvedStagingSha: "a".repeat(40),
  approvedStagingRef: ref, runId: "123", runAttempt: "1", jobId: "456",
  runnerId: "789", runnerName: "skybot-gpu-openfront-national-12345678",
  challenge: "b".repeat(64),
};
const now = 1780000002000;
const times = { runStartedAtMs: now - 2000, jobCompletedAtMs: null };
const grant = {
  ...expected, kind: "skybot-physical-run-grant-v1",
  workflow: ".github/workflows/national-hardware-acceptance.yml",
  physicalMode: "four-mode-release",
  modes: ["national-desktop", "national-mobile", "legacy-desktop", "legacy-mobile"],
  issuedAtMs: now - 1000, expiresAtMs: now + 60000,
};
const check = (g = grant, t = times, phase = "preflight", mode = "national-desktop", n = now) =>
  verifyRunGrant(g, expected, t, phase, mode, n);

test("current class four-mode grant and completed postflight", () => {
  check();
  for (const mode of grant.modes.slice(1)) check(grant, times, "refresh-preflight", mode);
  verifyRunGrant(grant, expected, { ...times, jobCompletedAtMs: now + 1 }, "postflight", undefined, now + 2);
});
test("each immutable identity field independently rejects substitution and omission", () => {
  for (const key of Object.keys(expected)) {
    assert.throws(() => check({ ...grant, [key]: "wrong" }), /IDENTITY_MISMATCH/);
    const missing = { ...grant }; delete missing[key];
    assert.throws(() => check(missing), /IDENTITY_MISMATCH/);
  }
});
test("no diagnostic, incomplete, duplicated, reordered or foreign workflow grant", () => {
  for (const changed of [
    { physicalMode: "diagnostic" }, { workflow: "other.yml" },
    { modes: grant.modes.slice(1) }, { modes: [...grant.modes].reverse() },
    { modes: Array(4).fill(grant.modes[0]) }, { kind: "other" },
  ]) assert.throws(() => check({ ...grant, ...changed }), /IDENTITY_MISMATCH/);
});
test("reject future, stale, overlong, pre-job and malformed grants", () => {
  for (const changed of [
    { issuedAtMs: now + 1 }, { expiresAtMs: now - 1 },
    { expiresAtMs: now + 7200001 }, { issuedAtMs: now - 3000 },
    { expiresAtMs: "later" }, { issuedAtMs: 0 },
  ]) assert.throws(() => check({ ...grant, ...changed }), /TIME_INVALID/);
});
test("reject unsigned mode substitution, completed preflight, and incomplete or future postflight", () => {
  assert.throws(() => check(grant, times, "preflight", "legacy-mobile"), /PHASE_INVALID/);
  assert.throws(() => check(grant, times, "refresh-preflight", "national-desktop"), /PHASE_INVALID/);
  assert.throws(() => check(grant, { ...times, jobCompletedAtMs: now }), /PHASE_INVALID/);
  for (const completion of [null, now + 1, now - 1500]) {
    assert.throws(() => verifyRunGrant(grant, expected, { ...times, jobCompletedAtMs: completion }, "postflight", undefined, now), /PHASE_INVALID/);
  }
});

test("grant digest binds issuance window and identities, not JSON ordering", () => {
  const digest = check();
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, check(Object.fromEntries(Object.entries(grant).reverse())));
  assert.notEqual(digest, check({ ...grant, issuedAtMs: now - 999 }));
  assert.notEqual(digest, check({ ...grant, expiresAtMs: now + 60001 }));
});
test("durable host record publication refuses replacement and symlink targets", () => {
  const dir = mkdtempSync(join(tmpdir(), "host-record-once-"));
  try {
    publishHostRecordOnce(dir, "reservation.json", { first: true });
    assert.throws(() => publishHostRecordOnce(dir, "reservation.json", { first: false }), /EEXIST/);
    assert.equal(JSON.parse(readFileSync(join(dir, "reservation.json"), "utf8")).first, true);
    symlinkSync(join(dir, "missing.json"), join(dir, "dangling.json"));
    assert.throws(() => publishHostRecordOnce(dir, "dangling.json", {}), /EEXIST/);
    assert.throws(() => publishHostRecordOnce(dir, "../escape.json", {}), /NAME_INVALID/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
