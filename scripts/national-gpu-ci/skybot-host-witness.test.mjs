import { strict as assert } from "node:assert";
import {
  createHash,
  generateKeyPairSync,
  verify,
} from "node:crypto";
import { test } from "vitest";
import {
  APPROVED_STAGING,
  REPOSITORY,
  REPOSITORY_ID,
  verifyControllerRun,
  validateControllerObservation,
  verifyControllerTeardown,
  signedHostRecord,
  createHostPreflight,
  createHostPostflight,
} from "./skybot-host-witness.mjs";

const SHA = "a".repeat(40);
const CHALLENGE = "b".repeat(64);
const STAGE_SHA = SHA;
const NOW = 1_780_000_000_000;
const expected = Object.freeze({
  repository: REPOSITORY,
  repositoryId: REPOSITORY_ID,
  sourceSha: SHA,
  runId: "44920010367",
  runAttempt: "1",
  jobId: "14920010367",
  runnerName: "skybot-ci-gpu-real-job",
  runnerId: "12345",
  challenge: CHALLENGE,
  approvedStagingRef: APPROVED_STAGING,
  approvedStagingSha: STAGE_SHA,
});
const proof = () => ({
  expected: { ...expected },
  repository: { id: Number(REPOSITORY_ID), full_name: REPOSITORY, private: false },
  run: {
    id: Number(expected.runId),
    run_attempt: 1,
    event: "workflow_dispatch",
    status: "in_progress",
    repository: { id: Number(REPOSITORY_ID), full_name: REPOSITORY },
    actor: { id: 9, login: "authorized-writer" },
    triggering_actor: { id: 9, login: "authorized-writer" },
  },
  job: {
    id: Number(expected.jobId),
    run_id: Number(expected.runId),
    run_attempt: 1,
    status: "in_progress",
    runner_id: Number(expected.runnerId),
    runner_name: expected.runnerName,
    started_at: new Date(NOW).toISOString(),
    completed_at: null,
  },
  stage: {
    ref: "refs/heads/" + APPROVED_STAGING,
    object: { sha: STAGE_SHA },
  },
  ancestry: {
    status: "identical",
    merge_base_commit: { sha: SHA },
    base_commit: { sha: SHA },
  },
  permission: {
    permission: "write",
    user: { id: 9, login: "authorized-writer" },
  },
});
const observation = () => ({
  kind: "skybot-out-of-guest-webgl-observation-v1",
  observedByController: true,
  observedAtMs: NOW + 1_000,
  jobId: expected.jobId,
  runId: expected.runId,
  runAttempt: expected.runAttempt,
  runnerId: expected.runnerId,
  runnerName: expected.runnerName,
  sourceSha: expected.sourceSha,
  observedCheckoutSha: expected.sourceSha,
  challenge: expected.challenge,
  guest: {
    hardwareBackedVerified: true,
    backend: "virgl",
    renderer: "ANGLE (Mesa, virgl Intel(R) HD Graphics 4600)",
    webgl1Renderer: "ANGLE (Mesa, virgl Intel(R) HD Graphics 4600)",
    webgl1ShaderPixel: [51, 102, 153, 255],
    webgl2ShaderPixel: [51, 102, 153, 255],
  },
});
const teardown = () => ({
  kind: "skybot-host-teardown-v1",
  observedAtMs: NOW + 110_000,
  jobId: expected.jobId,
  runId: expected.runId,
  runnerId: expected.runnerId,
  runnerName: expected.runnerName,
  challenge: expected.challenge,
  vmDestroyed: true,
  gpuLeaseReleased: true,
  overlayDestroyed: true,
  browserProcessesTerminated: true,
  privateLogsDestroyed: true,
  cpuCapacityUnaffected: true,
  ephemeralRunnerDeregistered: true,
});
const rejectWith = (code, fn) => assert.throws(fn, (e) => e?.message === code);

test("source, repository ID, workflow attempt, runner ID, stage and writer must bind to real GitHub control plane", () => {
  const p = proof();
  assert.deepEqual(verifyControllerRun(p), {
    runStartedAtMs: NOW,
    jobCompletedAtMs: null,
  });
  for (const [section, key, value, reason] of [
    ["expected", "sourceSha", "f".repeat(40), "CONDUCTOR_SOURCE_ANCESTRY_UNVERIFIED"],
    ["run", "run_attempt", 2, "GITHUB_JOB_RUN_RUNNER_MISMATCH"],
    ["job", "runner_id", 222, "GITHUB_JOB_RUN_RUNNER_MISMATCH"],
    ["stage", "ref", "refs/heads/feature/unreviewed", "CONDUCTOR_SOURCE_ANCESTRY_UNVERIFIED"],
  ]) {
    const broken = proof();
    broken[section][key] = value;
    rejectWith(reason, () => verifyControllerRun(broken));
  }
  const differentRepo = proof();
  differentRepo.repository.id = 1;
  rejectWith("GITHUB_JOB_RUN_RUNNER_MISMATCH", () =>
    verifyControllerRun(differentRepo));
  const badPermission = proof();
  badPermission.permission.permission = "read";
  rejectWith("GITHUB_INITIATOR_NOT_AUTHORIZED", () =>
    verifyControllerRun(badPermission));
  const replay = proof();
  replay.run.run_attempt = 2;
  replay.expected.runAttempt = "2";
  replay.job.run_attempt = 2;
  replay.run.triggering_actor = { id: 10, login: "outsider" };
  rejectWith("GITHUB_INITIATOR_NOT_AUTHORIZED", () =>
    verifyControllerRun(replay));
  const staleStage = proof();
  staleStage.ancestry.merge_base_commit.sha = "d".repeat(40);
  rejectWith("CONDUCTOR_SOURCE_ANCESTRY_UNVERIFIED", () =>
    verifyControllerRun(staleStage));
});

test("guest-published shader claims cannot replace out-of-guest controller observation", () => {
  const o = observation();
  assert.equal(validateControllerObservation(o, expected).backend, "virgl");
  for (const [key, value] of [
    ["observedByController", false],
    ["jobId", "999"],
    ["runnerId", "42"],
    ["challenge", "f".repeat(64)],
    ["sourceSha", "d".repeat(40)],
    ["observedCheckoutSha", "d".repeat(40)],
  ]) {
    const tampered = { ...o, [key]: value };
    rejectWith("OUT_OF_GUEST_WEBGL_OBSERVER_MISSING", () =>
      validateControllerObservation(tampered, expected));
  }
  const noShader = observation();
  noShader.guest.webgl1ShaderPixel = [0, 0, 0, 0];
  rejectWith("CONTROLLER_GPU_SHADER_OBSERVATION_INVALID", () =>
    validateControllerObservation(noShader, expected));
});

test("host teardown must independently account for private logs, CPU slots and JIT deregistration", () => {
  const t = teardown();
  const result = verifyControllerTeardown(t, expected, NOW + 90_000);
  assert.equal(Object.keys(result).length, 10);
  assert.ok(Object.values(result).every((x) => x === true));
  for (const property of [
    "vmDestroyed",
    "gpuLeaseReleased",
    "overlayDestroyed",
    "browserProcessesTerminated",
    "privateLogsDestroyed",
    "cpuCapacityUnaffected",
    "ephemeralRunnerDeregistered",
  ]) {
    const invalid = { ...t, [property]: false };
    rejectWith("CONTROLLER_POST_TERMINATION_WITNESS_MISSING", () =>
      verifyControllerTeardown(invalid, expected, NOW + 90_000));
  }
  rejectWith("CONTROLLER_POST_TERMINATION_WITNESS_MISSING", () =>
    verifyControllerTeardown(t, expected, NOW + 120_000));
});

test("synthetic Ed25519 signer respects independent dual enrollment and immutable bytes", () => {
  const keys = generateKeyPairSync("ed25519");
  const privatePem = keys.privateKey.export({ format: "pem", type: "pkcs8" });
  const publicPem = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
  const fp = createHash("sha256").update(publicPem).digest("hex");
  const payload = { sourceSha: SHA, runId: expected.runId, nonce: CHALLENGE };
  const signed = signedHostRecord(payload, privatePem, [fp], [fp]);
  assert.equal(
    verify(null, Buffer.from(JSON.stringify(payload)), keys.publicKey,
      Buffer.from(signed.signature, "base64")),
    true,
  );
  assert.equal(
    verify(null, Buffer.from(JSON.stringify({ ...payload, runId: "1" })),
      keys.publicKey, Buffer.from(signed.signature, "base64")),
    false,
  );
  rejectWith("HOST_ED25519_KEY_NOT_INDEPENDENTLY_ENROLLED", () =>
    signedHostRecord(payload, privatePem, [], [fp]));
  rejectWith("HOST_ED25519_KEY_NOT_INDEPENDENTLY_ENROLLED", () =>
    signedHostRecord(payload, privatePem, [fp], []));
});

test("preflight has bounded freshness and postflight requires job completion plus byte-exact digest", () => {
  const times = { runStartedAtMs: NOW, jobCompletedAtMs: null };
  const host = {
    deviceVendorId: "8086", deviceId: "0412",
    driver: "i915", renderNode: "/dev/dri/renderD128",
    physicallyVerified: true,
  };
  const preflight = createHostPreflight(expected, times, host,
    observation().guest, NOW + 1_000);
  assert.equal(preflight.jobId, expected.jobId);
  assert.equal(preflight.expiresAtMs - preflight.issuedAtMs, 120_000);
  rejectWith("HOST_PREFLIGHT_JOB_NOT_RUNNING", () =>
    createHostPreflight(expected, { ...times, jobCompletedAtMs: NOW + 90_000 },
      host, observation().guest, NOW));
  const summaryBytes = Buffer.from('{"lane":"release","proof":false}');
  const complete = { ...times, jobCompletedAtMs: NOW + 90_000 };
  const postflight = createHostPostflight(expected, complete, host,
    verifyControllerTeardown(teardown(), expected, complete.jobCompletedAtMs),
    summaryBytes, NOW + 110_000);
  assert.equal(postflight.jobId, expected.jobId);
  assert.equal(postflight.evidenceSha256,
    createHash("sha256").update(summaryBytes).digest("hex"));
  rejectWith("HOST_POSTFLIGHT_EVIDENCE_OR_TIME_INVALID", () =>
    createHostPostflight(expected, times, host, {}, summaryBytes, NOW));
});
