/**
 * E5 independently validates engine receipts against current recipient-visible
 * projections. Intent enqueue, DOM toast and screenshot are not evidence.
 * This module is read-only and never mutates an engine or Worker.
 */
export const SCENARIOS = Object.freeze({
  "national-desktop": {
    args: [],
    report: "national-qa-artifacts/browser-national-desktop/acceptance.json",
  },
  "national-mobile": {
    args: ["--mobile"],
    report: "national-qa-artifacts/browser-national-mobile/acceptance.json",
  },
  "legacy-ffa-desktop": {
    args: ["--legacy"],
    report: "national-qa-artifacts/browser-legacy-ffa-desktop/acceptance.json",
  },
  "legacy-ffa-mobile": {
    args: ["--legacy", "--mobile"],
    report: "national-qa-artifacts/browser-legacy-ffa-mobile/acceptance.json",
  },
});
const TYPES = new Set([
  "national_declare_war",
  "national_propose_peace",
  "national_accept_peace",
]);
const strictId = (id) =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= 256 &&
  Array.from(id).every(
    (ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127,
  );
const fail = (reason) => ({ accepted: false, reason });

/** Collapse repeated delivery of the SAME signed/recipient-scoped journal item. */
export function reconcileDiplomacyEvidence(
  packets,
  {
    type,
    requestId,
    actorId,
    issuedTick,
    targetId,
    warId,
    motionId,
    projection,
    projectionTick,
  },
) {
  if (
    !TYPES.has(type) ||
    !/^nc_[a-f0-9]{32}$/.test(requestId ?? "") ||
    !strictId(actorId) ||
    !Number.isSafeInteger(issuedTick) ||
    issuedTick < 0
  ) {
    return fail("INVALID_ACTION_CONTEXT");
  }
  if (!Array.isArray(packets)) return fail("WORKER_PACKETS_MISSING");
  const entries = packets
    .flatMap((packet) =>
      Array.isArray(packet?.commandResults) ? packet.commandResults : [],
    )
    .filter((entry) => entry?.requestId === requestId);
  if (!entries.length) return fail("MATCHING_ENGINE_RECEIPT_MISSING");
  const signatures = new Set(entries.map((entry) => JSON.stringify(entry)));
  if (signatures.size !== 1) return fail("CONFLICTING_OR_FOREIGN_RECEIPTS");
  const result = entries[0];
  if (
    result.type !== type ||
    result.actorId !== actorId ||
    result.recipientId !== actorId ||
    !Number.isSafeInteger(result.sequence) ||
    result.sequence < 0 ||
    !Number.isSafeInteger(result.tick) ||
    result.tick < issuedTick
  ) {
    return fail("FORGED_OR_UNSCOPED_ENGINE_RECEIPT");
  }
  if (result.accepted !== true) {
    return fail(
      result.accepted === false
        ? "ENGINE_REJECTED_ACTION"
        : "ENGINE_RESULT_UNDECIDED",
    );
  }
  if (
    !projection ||
    projection.version !== 1 ||
    projection.recipientId !== actorId ||
    !Array.isArray(projection.layers) ||
    !Array.isArray(projection.motions) ||
    !Number.isSafeInteger(projectionTick) ||
    projectionTick < result.tick
  ) {
    return fail("CURRENT_RECIPIENT_STATE_MISSING");
  }
  const layer = projection.layers.find((row) => row.id === result.warId);
  if (!layer || !strictId(layer.id)) return fail("GAME_WAR_LAYER_MISSING");
  if (type === "national_declare_war") {
    if (
      layer.scope !== "national" ||
      layer.first?.kind !== "nation" ||
      layer.first.id !== actorId ||
      layer.second?.kind !== "nation" ||
      layer.second.id !== targetId ||
      layer.declaredBy !== actorId ||
      layer.endedTick !== null ||
      !Number.isSafeInteger(layer.startedTick) ||
      layer.startedTick < issuedTick ||
      layer.startedTick > result.tick
    ) {
      return fail("WAR_LAYER_CONTRADICTS_RECEIPT");
    }
  } else {
    if (layer.id !== warId) return fail("WAR_ID_MISMATCH");
    const motion = projection.motions.find((row) => row.id === result.motionId);
    if (
      !motion ||
      motion.layerId !== layer.id ||
      !Number.isSafeInteger(motion.proposedTick)
    ) {
      return fail("PEACE_MOTION_MISSING");
    }
    if (type === "national_propose_peace") {
      if (
        motion.proposedBy !== actorId ||
        motion.proposedTick < issuedTick ||
        motion.proposedTick > result.tick ||
        motion.acceptedTick !== null
      ) {
        return fail("PEACE_PROPOSAL_CONTRADICTS_RECEIPT");
      }
    } else if (
      motion.id !== motionId ||
      motion.acceptedBy !== actorId ||
      !Number.isSafeInteger(motion.acceptedTick) ||
      motion.acceptedTick < issuedTick ||
      motion.acceptedTick > result.tick ||
      layer.endedTick !== motion.acceptedTick
    ) {
      return fail("PEACE_ACCEPTANCE_CONTRADICTS_RECEIPT");
    }
  }
  return {
    accepted: true,
    reason: "MATCHED_RECIPIENT_RECEIPT_AND_ENGINE_STATE",
    type,
    warId: layer.id,
    ...(strictId(result.motionId) ? { motionId: result.motionId } : {}),
    receiptTick: result.tick,
    sequence: result.sequence,
  };
}

/** Machine-readable, deliberately bounded summary; private raw packets stay on guest. */
export function summarizeBrowserReport(report, exitCode, scenario) {
  const config = SCENARIOS[scenario];
  if (!config) throw Error("UNKNOWN_SCENARIO");
  const completed = (Array.isArray(report?.events) ? report.events : [])
    .filter(
      (event) =>
        event?.name === "stage-complete" && typeof event.stage === "string",
    )
    .map((event) => event.stage.slice(0, 64));
  const safeStages = new Set([
    "boot",
    "home",
    "solo",
    "national-mode",
    "start",
    "spawn",
    "found-empire",
    "rejected-founding",
    "declare-war",
    "map-assault",
    "propose-peace",
    "accept-peace",
    "legacy-configuration",
    "legacy-ffa",
    "legacy-player-action",
    "combat-impact",
  ]);
  const normalizedStage = (value) =>
    typeof value === "string" && safeStages.has(value)
      ? value
      : "UNKNOWN_STAGE";
  // First observed failure wins. Cleanup errors and later repeats must never
  // overwrite the stage that actually blocked the user's game.
  const firstEventFailure = Array.isArray(report?.events)
    ? report.events.find(
        (event) =>
          event?.name === "stage-failed" && typeof event.stage === "string",
      )
    : null;
  const firstError = Array.isArray(report?.errors)
    ? report.errors.find((error) => error && typeof error.stage === "string")
    : null;
  const lastError = firstError;
  const failedStage =
    typeof firstEventFailure?.stage === "string"
      ? normalizedStage(firstEventFailure.stage)
      : typeof firstError?.stage === "string"
        ? normalizedStage(firstError.stage)
        : typeof report?.stage === "string" && exitCode !== 0
          ? normalizedStage(report.stage)
          : null;
  const required = scenario.startsWith("national-")
    ? [
        "home",
        "solo",
        "national-mode",
        "start",
        "spawn",
        "found-empire",
        "rejected-founding",
        "declare-war",
        "map-assault",
        "combat-impact",
        "propose-peace",
        "accept-peace",
      ]
    : [
        "home",
        "solo",
        "legacy-configuration",
        "legacy-ffa",
        "legacy-player-action",
      ];
  const missingStages = required.filter((s) => !completed.includes(s));
  const requiredScreenshots = scenario.startsWith("national-")
    ? [
        "home",
        "solo-modal",
        "game-hud",
        "spawn-unobstructed-map",
        "player-spawned",
        "founding-request",
        "confirmed-empire",
        "declared-war-live",
        "radial-attack-enabled",
        "map-assault-confirmed",
        "combat-impact-canonical",
        "peace-motion-proposed",
        "peace-accepted-ended-war",
      ]
    : ["home", "solo-modal", "legacy-ffa-game-hud", "legacy-player-action"];
  const capturedNames = Array.isArray(report?.events)
    ? report.events.flatMap((e) =>
        e?.name === "screenshot" && typeof e.label === "string"
          ? [e.label]
          : typeof e?.name === "string" &&
              Number.isSafeInteger(e.packetCount) &&
              Number.isSafeInteger(e.assetRequests)
            ? [e.name] // Historical pre-R11 capture used the label as name.
            : [],
      )
    : [];
  const missingScreenshots = requiredScreenshots.filter(
    (label) => !capturedNames.includes(label),
  );
  const code = Number.isInteger(exitCode) ? exitCode : -1;
  const hardware = (report?.events ?? []).some(
    (event) =>
      event?.name === "strict-hardware-renderer-attestation" &&
      event?.accepted === true,
  );
  const shader = [
    report?.actualHardware?.webgl1?.shaderPixel,
    report?.actualHardware?.webgl?.shaderPixel,
  ].every((p) => Array.isArray(p) && p.join(",") === "51,102,153,255");
  return {
    schema: 1,
    scenario,
    path: config.report,
    exactSource:
      typeof report?.exactSource === "string" &&
      /^[a-f0-9]{40}$/.test(report.exactSource)
        ? report.exactSource
        : null,
    exitCode: code,
    reported: !!report,
    completedStages: [...new Set(completed)].slice(0, 32),
    failedStage,
    failureHint: (() => {
      const message =
        typeof lastError?.error === "string" ? lastError.error : "";
      const match = [
        ["MAP_ATTACK_NOT_DISPATCHED", /MAP_ATTACK_NOT_DISPATCHED/],
        ["MAP_ASSAULT_ENGINE_MISSING", /MAP_ASSAULT_LACKS_ENGINE_STATE_CHANGE/],
        [
          "NO_ELIGIBLE_WAR_TARGET",
          /NO_REAL_SELECTABLE_GAME_TARGET|UI_SELECT_MISSING_OR_DISABLED/,
        ],
        [
          "PEACE_OTHER_PRINCIPAL_REQUIRED",
          /PEACE_ACCEPTANCE_NOT_SUBMITTED|ENGINE_REFERENCE_NOT_SELECTABLE/,
        ],
        ["CHROMIUM_NATIVE_SELECTION", /CHROMIUM_NATIVE_OPTION_NOT_SELECTED/],
        [
          "GPU_RELEASE_TRUST_MISSING",
          /GPU_RELEASE_TRUST_ROOT_NOT_ENROLLED|INDEPENDENT_HARDWARE_PROOF_MISSING/,
        ],
        ["WEBGL_SOFTWARE_FORBIDDEN", /SOFTWARE_RENDERER_FORBIDDEN|WebGL gate/],
        [
          "AUTHORITY_RECEIPT_MISSING",
          /receipt|GAME_WAR_LAYER_MISSING|Timed out/,
        ],
      ].find(([, pattern]) => pattern.test(message));
      return match?.[0] ?? (lastError ? "UNCLASSIFIED_STAGE_FAILURE" : null);
    })(),
    failureClass: !report
      ? "REPORT_MISSING"
      : code !== 0
        ? "GAMEPLAY_STAGE_FAILED"
        : missingStages.length
          ? "REQUIRED_STAGES_MISSING"
          : missingScreenshots.length
            ? "REQUIRED_SCREENSHOTS_MISSING"
            : null,
    missingStages,
    missingScreenshots,
    webglShadersMatch: shader,
    signedHardwareAttested: hardware,
    gameplayPassed:
      code === 0 &&
      missingStages.length === 0 &&
      missingScreenshots.length === 0,
    publicReleasePassed: false,
  };
}
