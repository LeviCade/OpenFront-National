#!/usr/bin/env node
/**
 * Skybot host-only witness adapter. Must be installed and invoked by a
 * privileged, independently reviewed Skybot controller service, NEVER by a
 * disposable GitHub Actions guest. It neither creates nor enrolls keys.
 *
 * A signed observation requires ALL of: GitHub control-plane identity,
 * actual host GPU/VM state, out-of-guest controller telemetry, root-only key.
 * A false/missing input means NO signature, not a best-effort certificate.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyIndependentRelease } from "./verify-independent-release.mjs";

export const HOST_ROOT = "/etc/skybot-ci/national-gpu-release";
export const REPOSITORY = "LeviCade/OpenFront-National";
export const REPOSITORY_ID = "1459234894";
export const APPROVED_STAGING = "stage3/class4-six-owner-reciprocal-20261121";
export const OVERLAY_DIR = "/var/lib/libvirt/images/ci-disposable/overlays";
const SHA = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const NUM = /^[1-9][0-9]*$/;
const RUNNER = /^skybot-ci-gpu-[a-zA-Z0-9-]{4,80}$/;
const RENDER = "/dev/dri/renderD128";
const LEASE = "/run/skybot-ci/intel-virgl-acl.lease";
const PIXEL = [51, 102, 153, 255];
const digest = (b) => createHash("sha256").update(b).digest("hex");
const requireTrue = (condition, code) => {
  if (!condition) throw Error(code);
};
const same = (a, b) => String(a) === String(b);
const exactPixel = (a) =>
  Array.isArray(a) && a.length === 4 && PIXEL.every((v, i) => a[i] === v);
const millis = (v) => {
  const result = Date.parse(v);
  requireTrue(Number.isSafeInteger(result), "GITHUB_TIMESTAMP_UNVERIFIED");
  return result;
};

export function verifyControllerRun({ expected, repository, run, job, stage, ancestry, permission }) {
  requireTrue(
    expected?.repository === REPOSITORY &&
      same(expected.repositoryId, REPOSITORY_ID) &&
      SHA.test(expected.sourceSha ?? "") &&
      NUM.test(String(expected.runId ?? "")) &&
      NUM.test(String(expected.runAttempt ?? "")) &&
      NUM.test(String(expected.jobId ?? "")) &&
      NUM.test(String(expected.runnerId ?? "")) &&
      RUNNER.test(expected.runnerName ?? "") &&
      HEX64.test(expected.challenge ?? "") &&
      expected.approvedStagingRef === APPROVED_STAGING &&
      SHA.test(expected.approvedStagingSha ?? "") &&
      expected.sourceSha === expected.approvedStagingSha,
    "TRUSTED_RUN_CONTEXT_INCOMPLETE",
  );
  requireTrue(
    same(repository?.id, REPOSITORY_ID) &&
      repository.full_name === REPOSITORY &&
      repository.private === false &&
      same(run?.repository?.id, REPOSITORY_ID) &&
      run.repository.full_name === REPOSITORY &&
      same(run.id, expected.runId) &&
      same(run.run_attempt, expected.runAttempt) &&
      run.event === "workflow_dispatch" &&
      ["queued", "in_progress", "completed"].includes(run.status) &&
      same(job?.id, expected.jobId) &&
      same(job.run_id ?? expected.runId, expected.runId) &&
      same(job.run_attempt ?? expected.runAttempt, expected.runAttempt) &&
      same(job.runner_id, expected.runnerId) &&
      job.runner_name === expected.runnerName &&
      ["queued", "in_progress", "completed"].includes(job.status),
    "GITHUB_JOB_RUN_RUNNER_MISMATCH",
  );
  const actor = Number(run.run_attempt) > 1 ? run.triggering_actor : run.actor;
  requireTrue(
    actor?.id > 0 &&
      permission?.user?.id === actor.id &&
      permission.user.login === actor.login &&
      ["write", "maintain", "admin"].includes(permission.permission) &&
      (!permission.role_name ||
        ["write", "maintain", "admin"].includes(permission.role_name)),
    "GITHUB_INITIATOR_NOT_AUTHORIZED",
  );
  requireTrue(
    stage?.ref === "refs/heads/" + APPROVED_STAGING &&
      stage.object?.sha === expected.approvedStagingSha &&
      ancestry?.status === "identical" &&
      ancestry.merge_base_commit?.sha === expected.sourceSha &&
      ancestry.base_commit?.sha === expected.sourceSha,
    "CONDUCTOR_SOURCE_ANCESTRY_UNVERIFIED",
  );
  return {
    runStartedAtMs: millis(job.started_at),
    jobCompletedAtMs: job.completed_at ? millis(job.completed_at) : null,
  };
}

/** Root-owned files can originate from the controller only. Guest uploads
 * are NEVER read from these paths and guest paths are NEVER accepted. */
export function checkRootFile(path, uid = 0) {
  const st = lstatSync(path);
  requireTrue(st.isFile() && !st.isSymbolicLink(), "HOST_FILE_SYMLINK_OR_TYPE");
  requireTrue(st.uid === uid && st.gid === 0 && (st.mode & 0o777) === 0o600,
    "HOST_FILE_OWNER_OR_MODE");
  return st;
}

export function checkRootDirectory(path, uid = 0) {
  const st = lstatSync(path);
  requireTrue(st.isDirectory() && !st.isSymbolicLink(), "HOST_DIRECTORY_UNTRUSTED");
  requireTrue(st.uid === uid && st.gid === 0 && (st.mode & 0o777) === 0o700,
    "HOST_DIRECTORY_OWNER_OR_MODE");
}
const readRoot = (name) => {
  const file = join(HOST_ROOT, name);
  checkRootFile(file);
  return readFileSync(file);
};
const readRootJson = (name) => JSON.parse(readRoot(name).toString("utf8"));
const execHost = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", timeout: 15000,
    maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const gpuIdentity = () => {
  requireTrue(lstatSync(RENDER).isCharacterDevice() &&
    !lstatSync(RENDER).isSymbolicLink(), "PHYSICAL_RENDER_NODE_UNAVAILABLE");
  requireTrue(readFileSync("/sys/class/drm/renderD128/device/vendor", "utf8").trim()
    === "0x8086", "PHYSICAL_GPU_VENDOR_MISMATCH");
  requireTrue(readFileSync("/sys/class/drm/renderD128/device/device", "utf8").trim()
    === "0x0412", "PHYSICAL_GPU_DEVICE_MISMATCH");
  requireTrue(readlinkSync("/sys/class/drm/renderD128/device/driver").split("/").at(-1)
    === "i915", "PHYSICAL_GPU_DRIVER_MISMATCH");
  return {
    deviceVendorId: "8086",
    deviceId: "0412",
    driver: "i915",
    renderNode: RENDER,
  };
};
const actualACL = () => execHost("getfacl", ["-cp", RENDER]).split("\n");
const physicalDomain = (name) => {
  const xml = execHost("virsh", ["-c", "qemu:///system", "dumpxml", name]);
  requireTrue(
    xml.includes("<name>" + name + "</name>") &&
      /<domain type=['"]kvm['"][ >]/.test(xml) &&
      xml.includes(RENDER) &&
      /<gl\b/.test(xml),
    "PHYSICAL_GPU_DOMAIN_NOT_BOUND",
  );
};

/** Execute on physical Skybot root host; do not replace with guest flags. */
export function probePhysicalPreflight(expected) {
  const host = gpuIdentity();
  const marker = lstatSync(LEASE);
  requireTrue(marker.isFile() && !marker.isSymbolicLink() &&
    marker.uid === 0 && (marker.mode & 0o777) === 0o600,
  "HOST_GPU_LEASE_NOT_ROOT_OWNED");
  requireTrue(readFileSync(LEASE, "utf8") ===
    "node=/dev/dri/renderD128\npci=0000:00:02.0\n",
  "HOST_GPU_LEASE_CONTENT_MISMATCH");
  requireTrue(actualACL().includes("user:libvirt-qemu:rw-"),
    "HOST_GPU_ACL_NOT_GRANTED");
  physicalDomain(expected.runnerName);
  return { ...host, virtualization: "kvm", virglTransportVerified: true,
    physicallyVerified: true, gpuAccessLeaseVerified: true };
}

/** Read-only postflight probes; protected unrelated VMs are NOT modified. */
export function probePhysicalPostflight(expected) {
  const host = gpuIdentity();
  const names = execHost("virsh", ["-c", "qemu:///system", "list", "--all", "--name"])
    .split("\n").filter(Boolean);
  requireTrue(!names.includes(expected.runnerName), "GUEST_VM_STILL_REGISTERED");
  // existsSync follows symlinks and would miss a broken, still-present marker.
  let leaseAbsent = false;
  try {
    lstatSync(LEASE);
  } catch (error) {
    if (error?.code === "ENOENT") leaseAbsent = true;
    else throw error;
  }
  requireTrue(leaseAbsent, "HOST_GPU_LEASE_NOT_RELEASED");
  requireTrue(!actualACL().some((x) => x.startsWith("user:libvirt-qemu:")),
    "HOST_GPU_ACL_NOT_REVOKED");
  const mounts = readFileSync("/proc/self/mountinfo", "utf8").split("\n");
  requireTrue(mounts.some((line) =>
    line.split(" - ")[0]?.split(" ")[4] === OVERLAY_DIR &&
    line.split(" - ")[1]?.startsWith("tmpfs ")),
  "HOST_OVERLAY_TMPFS_NOT_VERIFIED");
  for (const suffix of [".qcow2", "_VARS.fd"]) {
    requireTrue(!existsSync(join(OVERLAY_DIR, expected.runnerName + suffix)),
      "GUEST_OVERLAY_OR_EFI_RETAINED");
  }
  requireTrue(!readdirSync(OVERLAY_DIR).some((name) =>
    name === expected.runnerName + ".qcow2" ||
    name === expected.runnerName + "_VARS.fd"),
  "GUEST_RESIDUE_RETAINED");
  return host;
}

export function validateControllerObservation(observation, expected) {
  requireTrue(
    observation?.kind === "skybot-out-of-guest-webgl-observation-v1" &&
      same(observation.jobId, expected.jobId) &&
      same(observation.runId, expected.runId) &&
      same(observation.runAttempt, expected.runAttempt) &&
      same(observation.runnerId, expected.runnerId) &&
      observation.runnerName === expected.runnerName &&
      observation.sourceSha === expected.sourceSha &&
      observation.observedCheckoutSha === expected.sourceSha &&
      observation.challenge === expected.challenge &&
      observation.observedByController === true &&
      Number.isSafeInteger(observation.observedAtMs),
    "OUT_OF_GUEST_WEBGL_OBSERVER_MISSING",
  );
  const guest = observation.guest;
  requireTrue(
    guest?.hardwareBackedVerified === true &&
      guest.backend === "virgl" &&
      typeof guest.renderer === "string" &&
      /virgl/i.test(guest.renderer) &&
      guest.webgl1Renderer === guest.renderer &&
      exactPixel(guest.webgl1ShaderPixel) &&
      exactPixel(guest.webgl2ShaderPixel),
    "CONTROLLER_GPU_SHADER_OBSERVATION_INVALID",
  );
  return guest;
}

export function verifyControllerTeardown(teardown, expected, jobCompletedAtMs) {
  requireTrue(
    teardown?.kind === "skybot-host-teardown-v1" &&
      same(teardown.jobId, expected.jobId) &&
      same(teardown.runId, expected.runId) &&
      same(teardown.runnerId, expected.runnerId) &&
      teardown.runnerName === expected.runnerName &&
      teardown.challenge === expected.challenge &&
      Number.isSafeInteger(teardown.observedAtMs) &&
      teardown.observedAtMs >= jobCompletedAtMs &&
      teardown.vmDestroyed === true &&
      teardown.gpuLeaseReleased === true &&
      teardown.overlayDestroyed === true &&
      teardown.browserProcessesTerminated === true &&
      teardown.privateLogsDestroyed === true &&
      teardown.cpuCapacityUnaffected === true &&
      teardown.ephemeralRunnerDeregistered === true,
    "CONTROLLER_POST_TERMINATION_WITNESS_MISSING",
  );
  return {
    vmDestroyed: true,
    gpuLeaseReleased: true,
    renderNodeAclRestored: true,
    overlayDestroyed: true,
    tmpfsResidueCleared: true,
    efiResidueCleared: true,
    browserProcessesTerminated: true,
    privateLogsDestroyed: true,
    ephemeralRunnerDeregistered: true,
    cpuCapacityUnaffected: true,
  };
}

export function signedHostRecord(payload, privateKeyPem, enrolled, hostTrust) {
  const key = createPrivateKey(privateKeyPem);
  requireTrue(key.asymmetricKeyType === "ed25519", "HOST_SIGNER_KEY_INVALID");
  const pem = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
  const fingerprint = digest(Buffer.from(pem, "utf8"));
  requireTrue(
    enrolled?.includes(fingerprint) && hostTrust?.includes(fingerprint),
    "HOST_ED25519_KEY_NOT_INDEPENDENTLY_ENROLLED",
  );
  return {
    payload,
    signature: sign(null, Buffer.from(JSON.stringify(payload), "utf8"), key)
      .toString("base64"),
  };
}
const bound = (expected) => ({
  version: 1,
  repository: REPOSITORY,
  repositoryId: REPOSITORY_ID,
  sourceSha: expected.sourceSha,
  runId: String(expected.runId),
  runAttempt: String(expected.runAttempt),
  jobId: String(expected.jobId),
  runnerName: expected.runnerName,
  runnerId: String(expected.runnerId),
  challenge: expected.challenge,
});
export function createHostPreflight(expected, times, physical, guest, now) {
  requireTrue(Number.isSafeInteger(now) &&
    now >= times.runStartedAtMs - 30000 &&
    times.jobCompletedAtMs === null,
    "HOST_PREFLIGHT_JOB_NOT_RUNNING");
  return {
    ...bound(expected),
    issuedAtMs: now,
    expiresAtMs: now + 120000,
    host: physical,
    guest,
  };
}
export function createHostPostflight(expected, times, physical, cleanup, summaryBytes, now) {
  requireTrue(Number.isSafeInteger(now) &&
    Number.isSafeInteger(times.jobCompletedAtMs) &&
    now >= times.jobCompletedAtMs &&
    now <= times.jobCompletedAtMs + 3600000 &&
    Buffer.isBuffer(summaryBytes) &&
    summaryBytes.length >= 16 && summaryBytes.length <= 1000000,
    "HOST_POSTFLIGHT_EVIDENCE_OR_TIME_INVALID");
  return {
    ...bound(expected),
    purpose: "skybot-gpu-postflight-v1",
    observedAtMs: now,
    host: physical,
    cleanup,
    evidenceSha256: digest(summaryBytes),
  };
}

async function githubGet(token, path) {
  const response = await fetch("https://api.github.com" + path, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Skybot-Host-GPU-Witness",
    },
    signal: AbortSignal.timeout(10000),
  });
  requireTrue(response.status === 200, "GITHUB_CONTROL_PLANE_UNAVAILABLE");
  return response.json();
}
async function controllerContext(token, expected) {
  const prefix = "/repos/" + REPOSITORY;
  const [repository, run, job, stage, ancestry] = await Promise.all([
    githubGet(token, prefix),
    githubGet(token, prefix + "/actions/runs/" + expected.runId),
    githubGet(token, prefix + "/actions/jobs/" + expected.jobId),
    githubGet(token, prefix + "/git/ref/heads/" + APPROVED_STAGING),
    githubGet(token, prefix + "/compare/" +
      expected.sourceSha + "..." + expected.approvedStagingSha),
  ]);
  const actor = Number(run.run_attempt) > 1 ? run.triggering_actor : run.actor;
  requireTrue(typeof actor?.login === "string" &&
    /^[A-Za-z0-9-]{1,39}$/.test(actor.login),
  "GITHUB_ACTOR_UNVERIFIED");
  const permission = await githubGet(token, prefix + "/collaborators/" +
    actor.login + "/permission");
  const times = verifyControllerRun({ expected, repository, run, job, stage,
    ancestry, permission });
  return { times, prefix };
}
const safeWrite = (name, obj) => {
  const dest = join(HOST_ROOT, name);
  requireTrue(!existsSync(dest), "HOST_PROOF_OVERWRITE_FORBIDDEN");
  const temporary = join(HOST_ROOT, "." + name + "." + process.pid);
  requireTrue(!existsSync(temporary), "HOST_PROOF_TEMPFILE_COLLISION");
  writeFileSync(temporary, JSON.stringify(obj, null, 2) + "\n", {
    mode: 0o600, flag: "wx",
  });
  renameSync(temporary, dest);
};
const assertHostOnly = () => {
  requireTrue(process.getuid?.() === 0 &&
    process.env.GITHUB_ACTIONS !== "true",
  "HOST_ONLY_ROOT_CONTROLLER_REQUIRED");
  checkRootDirectory(HOST_ROOT);
  checkRootFile(fileURLToPath(import.meta.url));
};
async function main() {
  assertHostOnly();
  const phase = process.argv[2];
  requireTrue(["preflight", "postflight"].includes(phase) &&
    process.argv.length === 3, "UNAPPROVED_HOST_WITNESS_ACTION");
  const expected = readRootJson("trusted-github-run-context.json");
  const token = readRoot("github-token").toString("utf8").trim();
  requireTrue(token.length > 20 && !/\s/.test(token),
    "GITHUB_HOST_READ_TOKEN_NOT_PROVISIONED");
  const { times, prefix } = await controllerContext(token, expected);
  const privateKey = readRoot("controller-ed25519-private.pem");
  const pinned = JSON.parse(readFileSync(
    fileURLToPath(new URL("../national-qa/trusted-gpu-keys.json", import.meta.url)),
    "utf8"));
  const policy = readRootJson("host-trust-policy.json");
  const enrolled = pinned.trustedEd25519PublicKeySha256;
  const hostTrust = policy.trustedEd25519PublicKeySha256;
  let payload;
  if (phase === "preflight") {
    const physical = probePhysicalPreflight(expected);
    const observed = readRootJson("controller-gpu-observation.json");
    const guest = validateControllerObservation(observed, expected);
    requireTrue(Math.abs(Date.now() - observed.observedAtMs) <= 120000,
      "OUT_OF_GUEST_WEBGL_OBSERVATION_STALE");
    payload = createHostPreflight(expected, times, physical, guest, Date.now());
    safeWrite("controller-preflight.json",
      signedHostRecord(payload, privateKey, enrolled, hostTrust));
  } else {
    requireTrue(times.jobCompletedAtMs !== null,
      "HOST_POSTFLIGHT_JOB_NOT_COMPLETED");
    const physical = probePhysicalPostflight(expected);
    const runnerRegistry = await githubGet(token, prefix +
      "/actions/runners?per_page=100");
    requireTrue(runnerRegistry.total_count <= 100 &&
      Array.isArray(runnerRegistry.runners) &&
      runnerRegistry.runners.every((r) => !same(r.id, expected.runnerId)),
    "GITHUB_EPHEMERAL_RUNNER_NOT_DEREGISTERED");
    const cleanupEvidence = readRootJson("controller-teardown-observation.json");
    const cleanup = verifyControllerTeardown(
      cleanupEvidence, expected, times.jobCompletedAtMs);
    const summaryBytes = readRoot("verified-artifacts/summary.json");
    payload = createHostPostflight(expected, times, physical, cleanup,
      summaryBytes, Date.now());
    safeWrite("controller-postflight.json",
      signedHostRecord(payload, privateKey, enrolled, hostTrust));
    const pem = createPublicKey(createPrivateKey(privateKey))
      .export({ type: "spki", format: "pem" }).toString();
    requireTrue(readRoot("host-public-key.pem").toString("utf8") === pem,
      "HOST_PUBLIC_KEY_MISMATCH");
    const verdict = verifyIndependentRelease({
      summaryBytes,
      artifactRoot: join(HOST_ROOT, "verified-artifacts"),
      preflight: readRootJson("controller-preflight.json"),
      postflight: readRootJson("controller-postflight.json"),
      trustedPublicKeyPem: pem,
      enrolledFingerprints: enrolled,
      hostTrustedFingerprints: hostTrust,
      expected: {
        ...expected,
        runStartedAtMs: times.runStartedAtMs,
        jobCompletedAtMs: times.jobCompletedAtMs,
      },
    });
    requireTrue(verdict.accepted && verdict.releaseCertified,
      "HOST_SIGNED_PROOF_GAMEPLAY_NOT_RELEASE_CERTIFIED");
  }
  console.info("SKYBOT_HOST_WITNESS_" + phase.toUpperCase() +
    "=SIGNED_OUT_OF_GUEST (not a gameplay release verdict)");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const code = /^[A-Z0-9_]+$/.test(err?.message ?? "")
      ? err.message : "HOST_WITNESS_DEPENDENCY_UNAVAILABLE";
    console.error("SKYBOT_HOST_WITNESS_BLOCKED=" + code);
    process.exitCode = 1;
  });
}
