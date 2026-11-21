import { strict as assert } from "node:assert";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "vitest";
import {
  GPU_MODES,
  verifyPublicModeProof,
  verifyGitHubJobBinding,
} from "./wait-host-proof.mjs";

const NOW = 1780000000000;
const SOURCE = "a".repeat(40);
const NONCE = "b".repeat(64);
const expected = {
  sourceSha: SOURCE,
  runId: "44920010367",
  runAttempt: "1",
  runnerName: "skybot-gpu-openfront-national-452d86d9",
};
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
const enrolled = [createHash("sha256").update(pem, "utf8").digest("hex")];
function proof(mode) {
  const payload = {
    version: 1,
    mode,
    repository: "LeviCade/OpenFront-National",
    repositoryId: "1459234894",
    sourceSha: SOURCE,
    runId: expected.runId,
    runAttempt: expected.runAttempt,
    jobId: "136893771460",
    runnerName: expected.runnerName,
    runnerId: "26",
    challenge: NONCE,
    issuedAtMs: NOW - 1000,
    expiresAtMs: NOW + 118000,
    host: {
      physicallyVerified: true,
      gpuAccessLeaseVerified: true,
      deviceVendorId: "8086",
      deviceId: "0412",
      driver: "i915",
      renderNode: "/dev/dri/renderD128",
      virtualization: "kvm",
      virglTransportVerified: true,
    },
  };
  return {
    payload,
    signature: sign(
      null,
      Buffer.from(JSON.stringify(payload), "utf8"),
      privateKey,
    ).toString("base64"),
  };
}
const refuse = (code, cb) => assert.throws(cb, (e) => e?.message === code);
test("every serial scenario validates an independently bound, short-lived public Ed25519 proof", () => {
  for (const mode of GPU_MODES) {
    assert.equal(
      verifyPublicModeProof(
        mode,
        proof(mode),
        pem,
        NONCE,
        enrolled,
        expected,
        NOW,
      ),
      true,
    );
  }
});
test("forged mode, SHA, runner, nonce and attempt cannot be waved through", () => {
  const p = proof("national-desktop");
  for (const [field, value] of [
    ["mode", "national-mobile"],
    ["sourceSha", "f".repeat(40)],
    ["runnerName", "skybot-gpu-openfront-national-11111111"],
    ["challenge", "c".repeat(64)],
    ["runAttempt", "2"],
    ["jobId", "99"],
  ]) {
    const fake = { ...p, payload: { ...p.payload, [field]: value } };
    const reason =
      field === "jobId"
        ? "HOST_PROOF_ED25519_SIGNATURE_INVALID"
        : "HOST_PROOF_RUN_OR_MODE_MISMATCH";
    refuse(reason, () =>
      verifyPublicModeProof(
        "national-desktop",
        fake,
        pem,
        NONCE,
        enrolled,
        expected,
        NOW,
      ),
    );
  }
});
test("independent enrollment, expiry, host GPU chain and signature are required", () => {
  const p = proof("national-desktop");
  refuse("HOST_PUBLIC_KEY_NOT_ENROLLED", () =>
    verifyPublicModeProof("national-desktop", p, pem, NONCE, [], expected, NOW),
  );
  refuse("HOST_PROOF_EXPIRED_OR_REPLAYED", () =>
    verifyPublicModeProof(
      "national-desktop",
      p,
      pem,
      NONCE,
      enrolled,
      expected,
      NOW + 121000,
    ),
  );
  const missingGPU = {
    ...p,
    payload: {
      ...p.payload,
      host: { ...p.payload.host, gpuAccessLeaseVerified: false },
    },
  };
  refuse("PHYSICAL_GPU_HOST_CHAIN_MISSING", () =>
    verifyPublicModeProof(
      "national-desktop",
      missingGPU,
      pem,
      NONCE,
      enrolled,
      expected,
      NOW,
    ),
  );
  const forged = { ...p, signature: "A".repeat(86) + "==" };
  refuse("HOST_PROOF_ED25519_SIGNATURE_INVALID", () =>
    verifyPublicModeProof(
      "national-desktop",
      forged,
      pem,
      NONCE,
      enrolled,
      expected,
      NOW,
    ),
  );
});

test("independent public GitHub control plane binds actual numeric job and runner IDs", () => {
  const p = proof("national-desktop");
  const authoritative = {
    total_count: 1,
    jobs: [
      {
        id: 136893771460,
        run_id: Number(expected.runId),
        run_attempt: Number(expected.runAttempt),
        runner_name: expected.runnerName,
        runner_id: 26,
        status: "in_progress",
      },
    ],
  };
  assert.equal(
    verifyPublicModeProof(
      "national-desktop",
      p,
      pem,
      NONCE,
      enrolled,
      expected,
      NOW,
    ),
    true,
  );
  assert.equal(
    verifyGitHubJobBinding(p.payload, authoritative, expected),
    true,
  );
  const changedId = { ...p.payload, jobId: "136893771461" };
  const changedRunner = { ...p.payload, runnerId: "27" };
  for (const altered of [changedId, changedRunner]) {
    // An otherwise correctly signed record for a different job/runner
    // is not permitted to certify the current GitHub-assigned execution.
    const signed = {
      payload: altered,
      signature: sign(
        null,
        Buffer.from(JSON.stringify(altered), "utf8"),
        privateKey,
      ).toString("base64"),
    };
    assert.equal(
      verifyPublicModeProof(
        "national-desktop",
        signed,
        pem,
        NONCE,
        enrolled,
        expected,
        NOW,
      ),
      true,
    );
    refuse("HOST_PROOF_GITHUB_JOB_RUNNER_MISMATCH", () =>
      verifyGitHubJobBinding(signed.payload, authoritative, expected),
    );
  }
  for (const bad of [
    { ...authoritative, total_count: 101 },
    { ...authoritative, total_count: 2 },
    { ...authoritative, jobs: [] },
  ]) {
    refuse("GITHUB_JOB_INVENTORY_INCOMPLETE", () =>
      verifyGitHubJobBinding(p.payload, bad, expected),
    );
  }
  for (const badJob of [
    { ...authoritative.jobs[0], runner_name: "skybot-ci-gpu" },
    { ...authoritative.jobs[0], run_attempt: 2 },
    { ...authoritative.jobs[0], status: "completed" },
    { ...authoritative.jobs[0], run_id: 1234 },
  ]) {
    refuse("HOST_PROOF_GITHUB_JOB_RUNNER_MISMATCH", () =>
      verifyGitHubJobBinding(
        p.payload,
        { total_count: 1, jobs: [badJob] },
        expected,
      ),
    );
  }
});
