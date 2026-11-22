// Pure policy check. A grant never enrolls a signer or proves physical execution.
const MODES = Object.freeze([
  "national-desktop",
  "national-mobile",
  "legacy-desktop",
  "legacy-mobile",
]);
const IDENTITY = [
  "repository", "repositoryId", "sourceSha", "approvedStagingRef",
  "approvedStagingSha", "runId", "runAttempt", "jobId", "runnerId",
  "runnerName", "challenge",
];
const WORKFLOW = ".github/workflows/national-hardware-acceptance.yml";
const MAX_WINDOW = 2 * 60 * 60 * 1000;
const fail = (code) => { throw Error(code); };

export function verifyRunGrant(grant, expected, times, phase, mode, now) {
  if (
    grant?.kind !== "skybot-physical-run-grant-v1" ||
    grant.workflow !== WORKFLOW ||
    grant.physicalMode !== "four-mode-release" ||
    !Array.isArray(grant.modes) || grant.modes.length !== MODES.length ||
    !MODES.every((value, i) => grant.modes[i] === value) ||
    !IDENTITY.every((key) => typeof grant[key] === "string" &&
      grant[key].length > 0 && grant[key] === String(expected?.[key] ?? ""))
  ) fail("HOST_RUN_GRANT_IDENTITY_MISMATCH");
  const { issuedAtMs, expiresAtMs } = grant;
  const started = times?.runStartedAtMs;
  const completed = times?.jobCompletedAtMs;
  if (
    ![issuedAtMs, expiresAtMs, started, now].every(Number.isSafeInteger) ||
    started <= 0 || started > issuedAtMs || issuedAtMs > now ||
    now > expiresAtMs || expiresAtMs <= issuedAtMs ||
    expiresAtMs - started > MAX_WINDOW
  ) fail("HOST_RUN_GRANT_TIME_INVALID");
  if (phase === "postflight") {
    if (mode !== undefined || !Number.isSafeInteger(completed) ||
        completed <= issuedAtMs || completed > now) {
      fail("HOST_RUN_GRANT_PHASE_INVALID");
    }
  } else if (
    completed !== null ||
    !((phase === "preflight" && mode === MODES[0]) ||
      (phase === "refresh-preflight" && MODES.slice(1).includes(mode)))
  ) fail("HOST_RUN_GRANT_PHASE_INVALID");
}
