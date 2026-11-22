// Pure policy check. A grant never enrolls a signer or proves physical execution.
import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const MODES = Object.freeze([
  "national-desktop",
  "national-mobile",
  "legacy-desktop",
  "legacy-mobile",
]);
const IDENTITY = [
  "repository",
  "repositoryId",
  "sourceSha",
  "approvedStagingRef",
  "approvedStagingSha",
  "runId",
  "runAttempt",
  "jobId",
  "runnerId",
  "runnerName",
  "challenge",
];
const WORKFLOW = ".github/workflows/national-hardware-acceptance.yml";
const MAX_WINDOW = 2 * 60 * 60 * 1000;
const fail = (code) => {
  throw Error(code);
};

export function verifyRunGrant(grant, expected, times, phase, mode, now) {
  if (
    grant?.kind !== "skybot-physical-run-grant-v1" ||
    grant.workflow !== WORKFLOW ||
    grant.physicalMode !== "four-mode-release" ||
    !Array.isArray(grant.modes) ||
    grant.modes.length !== MODES.length ||
    !MODES.every((value, i) => grant.modes[i] === value) ||
    !IDENTITY.every(
      (key) =>
        typeof grant[key] === "string" &&
        grant[key].length > 0 &&
        grant[key] === String(expected?.[key] ?? ""),
    )
  )
    fail("HOST_RUN_GRANT_IDENTITY_MISMATCH");
  const { issuedAtMs, expiresAtMs } = grant;
  const started = times?.runStartedAtMs;
  const completed = times?.jobCompletedAtMs;
  if (
    ![issuedAtMs, expiresAtMs, started, now].every(Number.isSafeInteger) ||
    started <= 0 ||
    started > issuedAtMs ||
    issuedAtMs > now ||
    now > expiresAtMs ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - started > MAX_WINDOW
  )
    fail("HOST_RUN_GRANT_TIME_INVALID");
  if (phase === "postflight") {
    if (
      mode !== undefined ||
      !Number.isSafeInteger(completed) ||
      completed <= issuedAtMs ||
      completed > now
    )
      fail("HOST_RUN_GRANT_PHASE_INVALID");
  } else if (
    completed !== null ||
    !(
      (phase === "preflight" && mode === MODES[0]) ||
      (phase === "refresh-preflight" && MODES.slice(1).includes(mode))
    )
  )
    fail("HOST_RUN_GRANT_PHASE_INVALID");
  // Field order is fixed independently of JSON file formatting. Every
  // certificate must bind the same grant rather than merely the same nonce.
  return createHash("sha256")
    .update(
      JSON.stringify([
        grant.kind,
        grant.workflow,
        grant.physicalMode,
        ...IDENTITY.map((key) => grant[key]),
        ...grant.modes,
        issuedAtMs,
        expiresAtMs,
      ]),
    )
    .digest("hex");
}

// Caller must establish a protected, independently administered directory.
// Never overwrite another signing reservation or already-published receipt.
export function publishHostRecordOnce(directory, name, object) {
  if (!/^[a-z0-9-]+[.]json$/.test(name)) fail("HOST_RECORD_NAME_INVALID");
  const destination = join(directory, name);
  const temporary = join(directory, "." + name + "." + process.pid);
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(object, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temporary, destination);
    // Persist the reservation before calling the HSM, not just in page cache.
    const dir = openSync(directory, "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } finally {
    unlinkSync(temporary);
  }
}
