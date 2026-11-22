#!/usr/bin/env node
/**
 * E6 external release verifier. MUST execute outside the Skybot GPU guest.
 * A guest-written JSON report is never a host attestation or a cleanup receipt.
 * This module verifies two independently signed, run-bound host observations
 * against out-of-guest key material and the reviewed E5 fingerprint enrollment.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MODES = Object.freeze([
  "national-desktop",
  "national-mobile",
  "legacy-desktop",
  "legacy-mobile",
]);
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const DECIMAL = /^[1-9][0-9]*$/;
const EXPECTED_RENDER_PIXELS = [51, 102, 153, 255];
const REQUIRED_CLEANUP = Object.freeze([
  "vmDestroyed",
  "gpuLeaseReleased",
  "renderNodeAclRestored",
  "overlayDestroyed",
  "tmpfsResidueCleared",
  "efiResidueCleared",
  "browserProcessesTerminated",
  "privateLogsDestroyed",
  "ephemeralRunnerDeregistered",
  "cpuCapacityUnaffected",
]);
const REPOSITORY = "LeviCade/OpenFront-National";
const REPOSITORY_ID = "1459234894";
const rejection = (reason) => ({
  accepted: false,
  reason,
  releaseCertified: false,
});
const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => a === b;
const pixel = (v) =>
  Array.isArray(v) &&
  v.length === 4 &&
  EXPECTED_RENDER_PIXELS.every((n, i) => v[i] === n);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const unsignedJson = (v) => JSON.stringify(v);

/** The trusted fingerprints and PEM MUST be loaded outside the disposable guest. */
export function verifyIndependentRelease({
  summaryBytes,
  artifactRoot,
  preflight,
  postflight,
  trustedPublicKeyPem,
  enrolledFingerprints,
  hostTrustedFingerprints,
  expected,
  now = Date.now(),
}) {
  if (
    !isObject(expected) ||
    expected.repository !== REPOSITORY ||
    String(expected.repositoryId) !== REPOSITORY_ID ||
    !HEX40.test(expected.sourceSha ?? "") ||
    !DECIMAL.test(String(expected.runId ?? "")) ||
    !DECIMAL.test(String(expected.runAttempt ?? "")) ||
    !DECIMAL.test(String(expected.jobId ?? "")) ||
    !/^(?:skybot-gpu-openfront-national-[0-9a-f]{8}|skybot-ci-gpu-[a-zA-Z0-9-]{4,80})$/.test(
      expected.runnerName ?? "",
    ) ||
    !DECIMAL.test(String(expected.runnerId ?? "")) ||
    !HEX64.test(expected.challenge ?? "") ||
    !Number.isSafeInteger(expected.runStartedAtMs) ||
    !Number.isSafeInteger(expected.jobCompletedAtMs) ||
    expected.jobCompletedAtMs <= expected.runStartedAtMs ||
    !Number.isSafeInteger(now)
  )
    return rejection("TRUSTED_RUN_CONTEXT_INCOMPLETE");

  if (
    !Array.isArray(enrolledFingerprints) ||
    !Array.isArray(hostTrustedFingerprints) ||
    enrolledFingerprints.length === 0 ||
    hostTrustedFingerprints.length === 0 ||
    typeof trustedPublicKeyPem !== "string"
  )
    return rejection("OUT_OF_GUEST_TRUST_ROOT_NOT_ENROLLED");
  let key;
  try {
    key = createPublicKey(trustedPublicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") throw Error("not Ed25519");
  } catch {
    return rejection("INVALID_TRUSTED_ED25519_KEY");
  }
  // Key identity is canonical SPKI DER, not formatting-dependent PEM text.
  const fingerprint = sha256(key.export({ type: "spki", format: "der" }));
  if (
    !enrolledFingerprints.includes(fingerprint) ||
    !hostTrustedFingerprints.includes(fingerprint)
  )
    return rejection("TRUST_ROOT_FINGERPRINT_MISMATCH");
  const verifySignature = (proof) => {
    if (
      !isObject(proof) ||
      !isObject(proof.payload) ||
      typeof proof.signature !== "string" ||
      Object.hasOwn(proof, "trustedPublicKey") ||
      Object.hasOwn(proof, "publicKey") ||
      !/^(?:[A-Za-z0-9+/]{4}){21}(?:[A-Za-z0-9+/]{2}==)$/.test(proof.signature)
    )
      return false;
    try {
      const signature = Buffer.from(proof.signature, "base64");
      return (
        signature.length === 64 &&
        verify(
          null,
          Buffer.from(unsignedJson(proof.payload), "utf8"),
          key,
          signature,
        )
      );
    } catch {
      return false;
    }
  };
  if (!verifySignature(preflight))
    return rejection("PREFLIGHT_SIGNATURE_INVALID_OR_MISSING");
  if (!verifySignature(postflight))
    return rejection("POSTFLIGHT_SIGNATURE_INVALID_OR_MISSING");

  const bind = (p) =>
    p.version === 1 &&
    p.repository === REPOSITORY &&
    String(p.repositoryId) === REPOSITORY_ID &&
    same(p.sourceSha, expected.sourceSha) &&
    String(p.runId) === String(expected.runId) &&
    String(p.runAttempt) === String(expected.runAttempt) &&
    String(p.jobId) === String(expected.jobId) &&
    same(p.runnerName, expected.runnerName) &&
    String(p.runnerId) === String(expected.runnerId) &&
    same(p.challenge, expected.challenge);
  const before = preflight.payload;
  const after = postflight.payload;
  if (
    !bind(before) ||
    !bind(after) ||
    before.purpose !== "skybot-gpu-preflight-v1" ||
    after.purpose !== "skybot-gpu-postflight-v1"
  )
    return rejection("SIGNATURE_RUN_BINDING_MISMATCH");
  if (
    !Number.isSafeInteger(before.issuedAtMs) ||
    !Number.isSafeInteger(before.expiresAtMs) ||
    before.expiresAtMs <= before.issuedAtMs ||
    before.expiresAtMs - before.issuedAtMs > 120_000 ||
    before.expiresAtMs < expected.runStartedAtMs ||
    before.issuedAtMs < expected.runStartedAtMs - 120_000 ||
    before.issuedAtMs > expected.jobCompletedAtMs ||
    !Number.isSafeInteger(after.observedAtMs) ||
    after.observedAtMs < expected.jobCompletedAtMs ||
    after.observedAtMs > expected.jobCompletedAtMs + 3_600_000 ||
    after.observedAtMs > now + 30_000
  )
    return rejection("HOST_WITNESS_TIMESTAMP_INVALID");
  const host = before.host;
  if (
    !isObject(host) ||
    host.physicallyVerified !== true ||
    host.gpuAccessLeaseVerified !== true ||
    host.deviceVendorId !== "8086" ||
    host.deviceId !== "0412" ||
    host.driver !== "i915" ||
    host.renderNode !== "/dev/dri/renderD128" ||
    host.virtualization !== "kvm" ||
    host.virglTransportVerified !== true ||
    !isObject(after.host) ||
    after.host.deviceVendorId !== host.deviceVendorId ||
    after.host.deviceId !== host.deviceId ||
    after.host.renderNode !== host.renderNode ||
    after.host.driver !== host.driver
  )
    return rejection("PHYSICAL_GPU_HOST_IDENTITY_UNVERIFIED");
  if (
    !isObject(after.cleanup) ||
    REQUIRED_CLEANUP.some((field) => after.cleanup[field] !== true)
  )
    return rejection("INDEPENDENT_HOST_CLEANUP_INCOMPLETE");
  if (
    !Buffer.isBuffer(summaryBytes) ||
    summaryBytes.length < 16 ||
    summaryBytes.length > 1_000_000 ||
    !isObject(after) ||
    !HEX64.test(after.evidenceSha256 ?? "") ||
    after.evidenceSha256 !== sha256(summaryBytes)
  )
    return rejection("EVIDENCE_DIGEST_MISMATCH");

  let summary;
  try {
    summary = JSON.parse(summaryBytes.toString("utf8"));
  } catch {
    return rejection("EVIDENCE_JSON_INVALID");
  }
  if (
    !isObject(summary) ||
    summary.lane !== "release" ||
    summary.exactCandidateSha !== expected.sourceSha ||
    summary.expectedSourceSha !== expected.sourceSha ||
    summary.releaseCertified !== false ||
    summary.hostCleanupVerified !== false ||
    !isObject(summary.modes) ||
    Object.keys(summary.modes).length !== MODES.length
  )
    return rejection("UNTRUSTED_OR_INCOMPLETE_RELEASE_SUMMARY");
  if (
    !isObject(before.guest) ||
    before.guest.hardwareBackedVerified !== true ||
    before.guest.backend !== "virgl" ||
    !pixel(before.guest.webgl1ShaderPixel) ||
    !pixel(before.guest.webgl2ShaderPixel) ||
    typeof before.guest.renderer !== "string" ||
    !/virgl/i.test(before.guest.renderer) ||
    before.guest.webgl1Renderer !== before.guest.renderer
  )
    return rejection("SIGNED_GPU_SHADER_EVIDENCE_INCOMPLETE");
  if (typeof artifactRoot !== "string" || !artifactRoot)
    return rejection("ARTIFACT_DIRECTORY_MISSING");
  const root = resolve(artifactRoot);
  if (!existsSync(root) || !lstatSync(root).isDirectory())
    return rejection("ARTIFACT_DIRECTORY_UNTRUSTED");
  for (const mode of MODES) {
    const report = summary.modes[mode];
    if (
      !isObject(report) ||
      report.scenario !== mode ||
      // A postflight signer must not transform a guest-declared FAIL into PASS.
      // Guest release outcomes are deliberately UNVERIFIED until this gate;
      // failed/partial gameplay has a different reason, even if exitCode is 0.
      report.outcome !== "UNVERIFIED" ||
      report.reason !== "SIGNED_WITNESS_NOT_VERIFIED" ||
      report.firstFailedStage !== null ||
      report.releaseCertified !== false ||
      report.sourceMatches !== true ||
      report.exactSource !== expected.sourceSha ||
      report.reportPresent !== true ||
      report.stageComplete !== true ||
      report.exitCode !== 0 ||
      report.laneMatches !== true ||
      report.viewportMatches !== true ||
      report.expectedViewport !==
        (mode.endsWith("mobile") ? "390x844 mobile" : "1280x800 desktop") ||
      report.actualViewport !== report.expectedViewport ||
      !isObject(report.hardware) ||
      report.hardware.diagnosticObserved !== true ||
      report.hardware.renderer !== before.guest.renderer ||
      !pixel(report.hardware.webgl1ShaderPixel) ||
      !pixel(report.hardware.webgl2ShaderPixel) ||
      !Array.isArray(report.screenshotNames) ||
      report.screenshotNames.length === 0 ||
      report.screenshotNames.length > 30 ||
      report.screenshotCount !== report.screenshotNames.length ||
      !isObject(report.screenshotSha256)
    )
      return rejection("GAMEPLAY_MODE_EVIDENCE_INCOMPLETE_" + mode);
    const modeDir = join(root, mode);
    if (!existsSync(modeDir) || !lstatSync(modeDir).isDirectory())
      return rejection("SCREENSHOT_DIRECTORY_UNTRUSTED_" + mode);
    if (
      Object.keys(report.screenshotSha256).length !==
      report.screenshotNames.length
    )
      return rejection("SCREENSHOT_MANIFEST_INCOMPLETE_" + mode);
    const names = new Set();
    for (const filename of report.screenshotNames) {
      if (
        typeof filename !== "string" ||
        !/^[a-z0-9-]+\.png$/.test(filename) ||
        names.has(filename)
      )
        return rejection("SCREENSHOT_PATH_FORBIDDEN_" + mode);
      names.add(filename);
      const digest = report.screenshotSha256[filename];
      if (!HEX64.test(digest ?? ""))
        return rejection("SCREENSHOT_DIGEST_MISSING_" + mode);
      const filenameOnDisk = join(modeDir, filename);
      if (!existsSync(filenameOnDisk))
        return rejection("SCREENSHOT_MISSING_" + mode);
      const st = lstatSync(filenameOnDisk);
      if (!st.isFile() || st.size < 45 || st.size > 4_000_000)
        return rejection("SCREENSHOT_SYMLINK_OR_SIZE_" + mode);
      const bytes = readFileSync(filenameOnDisk);
      const magic = Buffer.from("89504e470d0a1a0a", "hex");
      const end = Buffer.from("0000000049454e44ae426082", "hex");
      if (
        !bytes.subarray(0, 8).equals(magic) ||
        !bytes.subarray(-12).equals(end)
      )
        return rejection("SCREENSHOT_PNG_INVALID_" + mode);
      if (sha256(bytes) !== digest)
        return rejection("SCREENSHOT_DIGEST_MISMATCH_" + mode);
    }
  }
  return {
    accepted: true,
    releaseCertified: true,
    hostCleanupVerified: true,
    signerFingerprint: fingerprint,
    sourceSha: expected.sourceSha,
    runId: String(expected.runId),
    runAttempt: String(expected.runAttempt),
    jobId: String(expected.jobId),
    runnerName: expected.runnerName,
    evidenceSha256: after.evidenceSha256,
    modes: [...MODES],
  };
}

/** Host-side CLI: no signature, enrollment or context comes from the guest artifact. */
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(dir, "../..");
  const rootDir = "/etc/skybot-ci/national-gpu-release";
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  let output;
  try {
    if (process.env.GITHUB_ACTIONS === "true")
      throw Error("REFUSED_IN_GITHUB_ACTIONS_GUEST");
    const ctx = readJson(join(rootDir, "trusted-github-run-context.json"));
    const pinned = readJson(
      join(repoRoot, "scripts/national-qa/trusted-gpu-keys.json"),
    );
    const hosted = readJson(join(rootDir, "host-trust-policy.json"));
    const checked = verifyIndependentRelease({
      summaryBytes: readFileSync(
        join(rootDir, "verified-artifacts", "summary.json"),
      ),
      artifactRoot: join(rootDir, "verified-artifacts"),
      preflight: readJson(join(rootDir, "controller-preflight.json")),
      postflight: readJson(join(rootDir, "controller-postflight.json")),
      trustedPublicKeyPem: readFileSync(
        join(rootDir, "host-public-key.pem"),
        "utf8",
      ),
      enrolledFingerprints: pinned.trustedEd25519PublicKeySha256,
      hostTrustedFingerprints: hosted.trustedEd25519PublicKeySha256,
      expected: ctx,
    });
    output = checked;
  } catch {
    output = rejection("TRUSTED_HOST_EVIDENCE_OR_CONTEXT_UNAVAILABLE");
  }
  console.log(JSON.stringify(output));
  if (!output.accepted) process.exitCode = 1;
}
