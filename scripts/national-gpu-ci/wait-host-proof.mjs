#!/usr/bin/env node
/**
 * Guest READ-ONLY acceptance of a host-delivered PUBLIC, per-mode proof.
 * NEVER signs, invents an enrollment, or treats a local renderer as a host.
 * It validates run/attempt/source/runner/nonce, Ed25519 signature and TTL.
 * E5 still independently probes actual Chrome WebGL shader pixels.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const GUEST_PROOF_ROOT = "/run/skybot-ci-national-gpu-proof";
export const GPU_MODES = [
  "national-desktop",
  "national-mobile",
  "legacy-desktop",
  "legacy-mobile",
];
const SHA = /^[0-9a-f]{40}$/;
const NONCE = /^[0-9a-f]{64}$/;
const DECIMAL = /^[1-9][0-9]*$/;
const RUNNER =
  /^(?:skybot-gpu-openfront-national-[0-9a-f]{8}|skybot-ci-gpu-[a-zA-Z0-9-]{4,80})$/;

const reject = (code) => {
  throw Error(code);
};
export function verifyPublicModeProof(
  mode,
  proof,
  publicPem,
  challenge,
  enrolled,
  expected,
  now,
) {
  if (
    !GPU_MODES.includes(mode) ||
    !SHA.test(expected.sourceSha ?? "") ||
    !DECIMAL.test(String(expected.runId ?? "")) ||
    !DECIMAL.test(String(expected.runAttempt ?? "")) ||
    !RUNNER.test(expected.runnerName ?? "") ||
    !NONCE.test(challenge) ||
    !Array.isArray(enrolled)
  ) {
    reject("UNTRUSTED_HARDWARE_RUN_CONTEXT");
  }
  if (
    typeof publicPem !== "string" ||
    !enrolled.includes(
      createHash("sha256").update(publicPem, "utf8").digest("hex"),
    )
  ) {
    reject("HOST_PUBLIC_KEY_NOT_ENROLLED");
  }
  if (
    !proof ||
    !proof.payload ||
    typeof proof.signature !== "string" ||
    Object.hasOwn(proof, "publicKey") ||
    Object.hasOwn(proof, "trustedPublicKey") ||
    !/^(?:[A-Za-z0-9+/]{4}){21}(?:[A-Za-z0-9+/]{2}==)$/.test(proof.signature)
  ) {
    reject("HOST_PROOF_SIGNATURE_MISSING");
  }
  const p = proof.payload;
  if (
    p.version !== 1 ||
    p.mode !== mode ||
    p.repository !== "LeviCade/OpenFront-National" ||
    String(p.repositoryId) !== "1459234894" ||
    p.sourceSha !== expected.sourceSha ||
    String(p.runId) !== String(expected.runId) ||
    String(p.runAttempt) !== String(expected.runAttempt) ||
    p.runnerName !== expected.runnerName ||
    !DECIMAL.test(String(p.jobId ?? "")) ||
    !DECIMAL.test(String(p.runnerId ?? "")) ||
    p.challenge !== challenge
  ) {
    reject("HOST_PROOF_RUN_OR_MODE_MISMATCH");
  }
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(p.issuedAtMs) ||
    !Number.isSafeInteger(p.expiresAtMs) ||
    p.issuedAtMs > now + 30_000 ||
    now - p.issuedAtMs > 120_000 ||
    p.expiresAtMs <= now ||
    p.expiresAtMs - p.issuedAtMs > 120_000
  ) {
    reject("HOST_PROOF_EXPIRED_OR_REPLAYED");
  }
  const h = p.host;
  if (
    h?.physicallyVerified !== true ||
    h.gpuAccessLeaseVerified !== true ||
    h.deviceVendorId !== "8086" ||
    h.deviceId !== "0412" ||
    h.driver !== "i915" ||
    h.renderNode !== "/dev/dri/renderD128" ||
    h.virtualization !== "kvm" ||
    h.virglTransportVerified !== true
  ) {
    reject("PHYSICAL_GPU_HOST_CHAIN_MISSING");
  }
  const key = createPublicKey(publicPem);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !verify(
      null,
      Buffer.from(JSON.stringify(p), "utf8"),
      key,
      Buffer.from(proof.signature, "base64"),
    )
  ) {
    reject("HOST_PROOF_ED25519_SIGNATURE_INVALID");
  }
  return true;
}

/**
 * Validate the live numeric JIT runner/job independently against the public
 * GitHub Actions control plane. Never infer jobId from a guest environment
 * string, the workflow label, or the signer's own payload.
 */
export function verifyGitHubJobBinding(payload, jobs, expected) {
  if (
    !jobs ||
    !Number.isSafeInteger(jobs.total_count) ||
    jobs.total_count < 1 ||
    jobs.total_count > 100 ||
    !Array.isArray(jobs.jobs) ||
    jobs.jobs.length !== jobs.total_count
  ) {
    reject("GITHUB_JOB_INVENTORY_INCOMPLETE");
  }
  const candidates = jobs.jobs.filter(
    (job) =>
      String(job.run_id) === String(expected.runId) &&
      String(job.run_attempt) === String(expected.runAttempt) &&
      job.runner_name === expected.runnerName &&
      String(job.runner_id) === String(payload.runnerId) &&
      job.status === "in_progress",
  );
  if (
    candidates.length !== 1 ||
    String(candidates[0].id) !== String(payload.jobId)
  ) {
    reject("HOST_PROOF_GITHUB_JOB_RUNNER_MISMATCH");
  }
  return true;
}
function readPublicFile(path, maxSize) {
  const stats = lstatSync(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size === 0 ||
    stats.size > maxSize
  )
    reject("PUBLIC_HOST_FILE_UNTRUSTED");
  return readFileSync(path, "utf8");
}
export function validatePublicHandoff(mode, expected, now = Date.now()) {
  if (!GPU_MODES.includes(mode)) reject("UNAPPROVED_GPU_SCENARIO");
  const pem = readPublicFile(
    join(GUEST_PROOF_ROOT, "host-public-key.pem"),
    2048,
  );
  const challenge = readPublicFile(
    join(GUEST_PROOF_ROOT, "challenge"),
    80,
  ).trim();
  const signed = JSON.parse(
    readPublicFile(
      join(GUEST_PROOF_ROOT, "controller-preflight-" + mode + ".json"),
      8192,
    ),
  );
  const trusted = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../national-qa/trusted-gpu-keys.json", import.meta.url),
      ),
      "utf8",
    ),
  ).trustedEd25519PublicKeySha256;
  verifyPublicModeProof(mode, signed, pem, challenge, trusted, expected, now);
  return signed.payload;
}
async function cli() {
  const mode = process.argv[2];
  if (!GPU_MODES.includes(mode) || process.argv.length !== 3)
    reject("UNAPPROVED_GPU_SCENARIO");
  const expected = {
    sourceSha: process.env.NATIONAL_GPU_CANDIDATE_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    runnerName: process.env.RUNNER_NAME,
  };
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    try {
      const signedPayload = validatePublicHandoff(mode, expected);
      // Public repository API, no credential/token or private job data.
      const response = await fetch(
        "https://api.github.com/repos/LeviCade/OpenFront-National/actions/runs/" +
          expected.runId +
          "/jobs?per_page=100",
        {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) reject("GITHUB_JOB_VERIFICATION_UNAVAILABLE");
      verifyGitHubJobBinding(await response.json(), signedPayload, expected);
      console.info(
        "E6_PUBLIC_HOST_PROOF=" + mode + ":ED25519_VERIFIED_NOT_RELEASE",
      );
      return;
    } catch (e) {
      // Missing/stale proof waits for fresh controller delivery; an existing
      // explicit cryptographic rejection cannot be silently bypassed.
      if (
        e?.message &&
        !["ENOENT", "HOST_PROOF_EXPIRED_OR_REPLAYED"].includes(e.message) &&
        e.code !== "ENOENT"
      ) {
        throw e;
      }
      await sleep(1000);
    }
  }
  reject("PHYSICAL_HOST_PER_MODE_PROOF_NOT_DELIVERED");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli().catch((e) => {
    const code = /^[A-Z0-9_]+$/.test(e?.message ?? "")
      ? e.message
      : "PHYSICAL_HOST_PROOF_UNAVAILABLE";
    console.error("E6_MODE_BLOCKED=" + code);
    process.exitCode = 1;
  });
}
