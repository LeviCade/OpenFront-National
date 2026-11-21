/**
 * Second Conductor / Class One / E5 independent browser acceptance verdicts.
 *
 * Read-only. No synthetic actors, intents or authoritative results.
 * A source unit test never substitutes for a browser or independent E6 witness.
 */
export const C2_PATHS = Object.freeze({
  "national-solo-desktop": {
    kind: "national-solo",
    viewport: "1280x800 desktop",
    args: ["--solo"],
    stages: [
      "home",
      "solo",
      "national-mode",
      "start",
      "spawn",
      "found-empire",
      "declare-war",
      "map-assault",
      "combat-impact",
      "solo-playability-complete",
    ],
    screenshots: [
      "home",
      "solo-modal",
      "game-hud",
      "spawn-unobstructed-map",
      "player-spawned",
      "founding-request",
      "confirmed-empire",
      "declared-war-live",
      "radial-attack-enabled",
      "combat-impact-canonical",
      "solo-battle-authoritative",
    ],
  },
  "national-solo-mobile": {
    kind: "national-solo",
    viewport: "390x844 mobile",
    args: ["--solo", "--mobile"],
    stages: [
      "home",
      "solo",
      "national-mode",
      "start",
      "spawn",
      "found-empire",
      "declare-war",
      "map-assault",
      "combat-impact",
      "solo-playability-complete",
    ],
    screenshots: [
      "home",
      "solo-modal",
      "game-hud",
      "spawn-unobstructed-map",
      "player-spawned",
      "founding-request",
      "confirmed-empire",
      "declared-war-live",
      "radial-attack-enabled",
      "combat-impact-canonical",
      "solo-battle-authoritative",
    ],
  },
  "legacy-desktop": {
    kind: "legacy",
    viewport: "1280x800 desktop",
    args: ["--legacy"],
    stages: [
      "home",
      "solo",
      "legacy-configuration",
      "legacy-ffa",
      "legacy-player-action",
    ],
    screenshots: [
      "home",
      "solo-modal",
      "legacy-ffa-game-hud",
      "legacy-player-action",
    ],
  },
  "legacy-mobile": {
    kind: "legacy",
    viewport: "390x844 mobile",
    args: ["--legacy", "--mobile"],
    stages: [
      "home",
      "solo",
      "legacy-configuration",
      "legacy-ffa",
      "legacy-player-action",
    ],
    screenshots: [
      "home",
      "solo-modal",
      "legacy-ffa-game-hud",
      "legacy-player-action",
    ],
  },
});
const SHA = /^[a-f0-9]{40}$/;
const PIXEL = "51,102,153,255";
const validTick = (v) => Number.isSafeInteger(v) && v >= 0;
const events = (r) => (Array.isArray(r?.events) ? r.events : []);
const find = (r, name, predicate = () => true) =>
  events(r).find((e) => e?.name === name && predicate(e)) ?? null;
const error = (code, owner) => ({ code, owner });
const passed = (a) => a.every(Boolean);

export function classifySoloOrLegacy({
  mode,
  report,
  exitCode,
  expectedSha,
  screenshotLabels = [],
}) {
  const config = C2_PATHS[mode];
  if (!config) throw Error("UNKNOWN_C2_BROWSER_MODE");
  const failures = [];
  const add = (condition, code, owner) => {
    if (!condition) failures.push(error(code, owner));
  };
  const sourceOkay =
    SHA.test(expectedSha ?? "") && report?.exactSource === expectedSha;
  add(sourceOkay, "SOURCE_SHA_MISMATCH_OR_MISSING", "E5/E6");
  add(report?.scenarioKind === config.kind, "SCENARIO_KIND_MISMATCH", "E5");
  add(report?.viewport === config.viewport, "VIEWPORT_MISMATCH", "E5");
  add(exitCode === 0, "BROWSER_PROCESS_FAILED", "E5");
  add(!!report && Array.isArray(report.events), "BROWSER_REPORT_MISSING", "E5");
  const completed = events(report)
    .filter((e) => e?.name === "stage-complete" && typeof e.stage === "string")
    .map((e) => e.stage);
  let position = -1;
  for (const stage of config.stages) {
    const next = completed.indexOf(stage, position + 1);
    if (next < 0)
      failures.push(error("STAGE_MISSING_OR_OUT_OF_ORDER:" + stage, "E5"));
    else position = next;
  }
  const screenshotEvents = new Set(
    events(report)
      .filter((e) => e?.name === "screenshot")
      .map((e) => e.label),
  );
  const actualFiles = new Set(screenshotLabels);
  for (const label of config.screenshots) {
    add(
      screenshotEvents.has(label) && actualFiles.has(label),
      "SCREENSHOT_MISSING_OR_INVALID:" + label,
      "E5",
    );
  }
  // Neither a Chrome shader test nor a guest-reported attestation is an
  // independently signed, post-teardown physical GPU witness.
  const webgl = report?.actualHardware;
  const shaderOkay = [
    webgl?.webgl1?.shaderPixel,
    webgl?.webgl?.shaderPixel,
  ].every((pixels) => Array.isArray(pixels) && pixels.join(",") === PIXEL);
  const rendererPresent =
    typeof webgl?.webgl?.renderer === "string" &&
    webgl.webgl.renderer.length > 0 &&
    typeof webgl?.browser?.product === "string";
  add(
    rendererPresent && shaderOkay,
    "BROWSER_WEBGL_RENDERING_UNPROVEN",
    "E5/E6",
  );
  add(
    Array.isArray(report?.workerPackets) && report.workerPackets.length > 0,
    "ACTUAL_GAME_WORKER_PACKETS_MISSING",
    "E5/E2",
  );
  const firstFailure = events(report).find((e) => e?.name === "stage-failed");
  add(!firstFailure, "REAL_BROWSER_STAGE_FAILED", "E5");
  add(
    !Array.isArray(report?.errors) || report.errors.length === 0,
    "BROWSER_REPORTED_ERRORS",
    "E5",
  );
  if (config.kind === "national-solo") {
    const spawn = find(
      report,
      "engine-spawn-verified",
      (e) =>
        e.unobstructedInputs > 0 &&
        validTick(e.tickBefore) &&
        validTick(e.tickAfter) &&
        e.tickAfter >= e.tickBefore,
    );
    add(!!spawn, "REAL_SPAWN_NOT_CORROBORATED", "E4/E5");
    add(
      !!find(
        report,
        "solo-transport-admission-observed",
        (e) =>
          e.gameTypeIsSolo === true &&
          e.actorPresent === true &&
          e.gameIdPresent === true &&
          validTick(e.tick),
      ),
      "SOLO_GAMEVIEW_ADMISSION_MISSING",
      "E4/E5",
    );
    add(
      !!find(
        report,
        "founding-real-click-submitted",
        (e) =>
          e.actorCorrelated === true &&
          /^[a-f0-9]{16}$/.test(e.requestFingerprint ?? ""),
      ) &&
        report?.submittedFounding?.authenticRequestObserved === true &&
        !!find(
          report,
          "authoritative-empire-accepted",
          (e) =>
            e.verified === true &&
            e.authenticPublicRoster === true &&
            e.recipientCorrelated === true,
        ),
      "FOUNDING_RECEIPT_OR_ROSTER_MISSING",
      "E1/E3/E4",
    );
    add(
      !!find(
        report,
        "authoritative-war-declared",
        (e) => validTick(e.receiptTick) && validTick(e.sequence),
      ),
      "WAR_RECEIPT_MISSING",
      "E1/E2/E4",
    );
    add(
      !!find(
        report,
        "real-target-aware-radial-attack",
        (e) =>
          e.targetMatch === true &&
          e.enabled === true &&
          (e.pointer === "mouse" || e.pointer === "touch"),
      ) &&
        !!find(
          report,
          "solo-real-battle-engine-correlated",
          (e) =>
            e.opponentDamaged === true &&
            (e.troopLoss === true || e.territoryLoss === true),
        ) &&
        !!find(
          report,
          "authoritative-combat-impact",
          (e) => e.actualOpponentLoss === true,
        ) &&
        !!find(
          report,
          "authoritative-solo-playability-complete",
          (e) =>
            passed([
              e.founded,
              e.spawned,
              e.warDeclared,
              e.realRadialAttack,
              e.opponentDamaged,
            ]) && validTick(e.liveTick),
        ),
      "REAL_RADIAL_BATTLE_DAMAGE_UNPROVEN",
      "E1/E2/E4/E5",
    );
    add(
      !completed.includes("trusted-three-principal-host"),
      "SOLO_WRONGLY_REQUIRES_MULTIPLAYER",
      "E5",
    );
  } else {
    add(
      !!find(
        report,
        "legacy-ffa-verified",
        (e) => e.nationalPanelAbsent === true && e.workerPacketCount > 0,
      ) &&
        !!find(
          report,
          "legacy-actual-map-interaction-authoritative-update",
          (e) =>
            e.playerTiles > 0 &&
            validTick(e.lastTick) &&
            (e.via === "mouse" || e.via === "touch"),
        ),
      "LEGACY_INPUT_OR_ENGINE_UPDATE_MISSING",
      "E4/E5",
    );
  }
  const consoleErrorCount = Array.isArray(report?.console)
    ? report.console.filter(
        (entry) =>
          entry?.severity === "error" || entry?.severity === "exception",
      ).length
    : null;
  add(consoleErrorCount === 0, "BROWSER_CONSOLE_ERRORS_UNREVIEWED", "E4/E5");
  // Browser reporter already applies safeFailureCode to original text.
  // Reject arbitrary input here as defense against secret-bearing error logs.
  const reported = Array.isArray(report?.errors) ? report.errors[0] : null;
  const code = reported?.error;
  const safeCode =
    typeof code === "string" &&
    (/^[A-Z][A-Z0-9_]{4,90}$/.test(code) ||
      code === "REAL_CHROMIUM_GPU_REQUIRED: WebGL gate")
      ? code
      : null;
  const stageOwner = safeCode?.startsWith("REAL_CHROMIUM_GPU_REQUIRED")
    ? "E6/DIAGNOSTIC_ENVIRONMENT"
    : safeCode?.startsWith("SPAWN")
      ? "E4/E5"
      : safeCode?.startsWith("FOUNDING")
        ? "E1/E3/E4"
        : safeCode?.startsWith("POLITICAL")
          ? "E2/E3/E4"
          : "E5";
  const gameplay = failures.length === 0 ? "PASS" : "FAIL";
  return {
    mode,
    source: sourceOkay ? expectedSha : null,
    gameplay,
    hardware: "BLOCKED",
    hardwareReason: "E6_INDEPENDENT_PHYSICAL_HOST_WITNESS_REQUIRED",
    firstFailure: safeCode
      ? error(safeCode, stageOwner)
      : failures[0] ?? null,
    checksFailed: failures,
    completedStages: completed.slice(0, 24),
    firstFailedStage: firstFailure?.stage ?? report?.errors?.[0]?.stage ?? null,
    consoleErrorCount,
    networkErrorCount: Array.isArray(report?.networkErrors)
      ? report.networkErrors.filter((entry) => entry?.failed).length
      : null,
    workerPacketCount: Array.isArray(report?.workerPackets)
      ? report.workerPackets.length
      : 0,
    screenshotCount: actualFiles.size,
    webglShaderPassed: shaderOkay,
    // Untrusted WebGL/browser claims never set hardware=PASS.
    certifiedRelease: false,
  };
}

/** A/B/C must be actual connected CDP profiles, not names invented by QA. */
export function verifyPrivateBrowserTopology(sessions) {
  if (!Array.isArray(sessions) || sessions.length !== 3)
    return {
      accepted: false,
      reason: "THREE_REAL_BROWSERS_REQUIRED",
      owner: "E2/E5",
    };
  const ports = sessions.map((s) => s?.cdpPort);
  if (
    !ports.every((p) => Number.isSafeInteger(p) && p > 0 && p <= 65535) ||
    new Set(ports).size !== 3
  )
    return {
      accepted: false,
      reason: "THREE_DISTINCT_CDP_PORTS_REQUIRED",
      owner: "E5",
    };
  if (
    sessions.some(
      (s) =>
        s.connected !== true ||
        s.browserTargetType !== "page" ||
        typeof s.browserProduct !== "string" ||
        !/^(?:HeadlessChrome|Chrome)\/[0-9]/.test(s.browserProduct),
    )
  )
    return {
      accepted: false,
      reason: "REAL_CHROMIUM_SESSIONS_NOT_VERIFIED",
      owner: "E5",
    };
  const ids = sessions.map((s) => s.principalId);
  const matches = sessions.map((s) => s.matchId);
  if (
    !ids.every((id) => typeof id === "string" && id.length > 0) ||
    new Set(ids).size !== 3
  )
    return {
      accepted: false,
      reason: "THREE_INDEPENDENT_VERIFIED_ACCOUNTS_REQUIRED",
      owner: "E2",
    };
  if (
    !matches.every(
      (id) => typeof id === "string" && id.length > 0 && id === matches[0],
    )
  )
    return {
      accepted: false,
      reason: "THREE_BROWSERS_NOT_ONE_SERVER_MATCH",
      owner: "E2",
    };
  if (
    !sessions.every(
      (s) =>
        s.hostAdmitted === true &&
        s.serverOwnedProjection === true &&
        validTick(s.serverTick) &&
        s.visibleMapRendered === true &&
        s.spectator === false,
    )
  )
    return {
      accepted: false,
      reason: "TRUSTED_PRIVATE_HOST_OR_MAP_UNVERIFIED",
      owner: "E2/E3/E4",
    };
  // Matching browser claims cannot independently attest E2's server. The
  // external operator must verify the trusted host and private projection.
  return {
    accepted: true,
    reason: "LIVE_THREE_BROWSER_TOPOLOGY_ONLY",
    owner: "E5",
  };
}

export function classifyPrivateNational({
  topology,
  joined,
  bilateralAccession,
  warReceipt,
  opponentPeace,
  privateViewsDifferent,
  reconnectRevokedOldSocket,
  spectatorDenied,
  hostWitnessVerified,
}) {
  if (!topology?.accepted)
    return {
      gameplay: "BLOCKED",
      owner: topology?.owner ?? "E2",
      firstFailure: topology?.reason ?? "THREE_REAL_BROWSERS_REQUIRED",
      hardware: "BLOCKED",
    };
  const checks = [
    [joined === true, "THREE_HOSTED_SEATS_NOT_OBSERVED", "E2"],
    [
      privateViewsDifferent === true,
      "RECIPIENT_PRIVATE_PROJECTION_NOT_PROVEN",
      "E3",
    ],
    [bilateralAccession === true, "ACCESSION_CONSENT_MISSING", "E1/E4"],
    [warReceipt === true, "WAR_AUTHORITY_RECEIPT_MISSING", "E1/E2"],
    [opponentPeace === true, "OPPOSING_PRINCIPAL_PEACE_MISSING", "E1/E4"],
    [reconnectRevokedOldSocket === true, "STALE_SOCKET_NOT_REVOKED", "E2"],
    [spectatorDenied === true, "SPECTATOR_COMMAND_NOT_DENIED", "E2/E4"],
    [
      hostWitnessVerified === true,
      "INDEPENDENT_TRUSTED_HOST_WITNESS_MISSING",
      "E6",
    ],
  ];
  const blocked = checks.find(([valid]) => !valid);
  return {
    gameplay: blocked ? "BLOCKED" : "PASS",
    owner: blocked?.[2] ?? "E5",
    firstFailure: blocked?.[1] ?? null,
    hardware: "BLOCKED",
    // Release requires E6 postflight and evidence digest beyond host preflight.
    certifiedRelease: false,
  };
}
