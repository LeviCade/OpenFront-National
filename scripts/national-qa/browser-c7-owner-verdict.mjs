import { classifyFunctional } from "../national-gpu-ci/owner-functional-witness.mjs";
import {
  MODES,
  physicalGameplayContract,
  summarizeBrowserEvidence,
} from "../national-gpu-ci/sanitize-browser-evidence.mjs";

const terminalKinds = new Set(["NATIONAL_SOVEREIGN", "NATIONAL_IMPERIAL"]);
const failureCodes = new Set([
  "REAL_CHROMIUM_GPU_REQUIRED: WebGL gate",
  "TIMED_OUT: authoritative evidence",
  "OWNER_FUNCTIONAL_CONFIGURATION_UNVERIFIED",
  "OWNER_FUNCTIONAL_MATCH_IDENTITY_MISSING",
  "OWNER_FUNCTIONAL_LEGACY_ATTACK_OBSERVER_MISSING",
  "OWNER_FUNCTIONAL_LEGACY_COMBAT_NOT_OBSERVED",
  "SOLO_WAR_TARGET_NOT_LIVING_OPPONENT",
  "TARGET_AWARE_MAP_ANCHOR_MISSING_OWNER_E4",
  "TARGET_AWARE_RADIAL_MENU_MISSING_OWNER_E4",
  "SOLO_OPPONENT_DAMAGE_ABSENT",
  "SPAWN_NOT_ACCEPTED_AFTER_REAL_MAP_INPUT",
]);

export function classifyOwnerResolution(mode, sha, exitCode, report, software = false) {
  const base = classifyFunctional(mode, sha, exitCode, report);
  const summary = summarizeBrowserEvidence(report, sha);
  const events = Array.isArray(report?.events) ? report.events : [];
  const unique = (name) => {
    const matches = events.filter((e) => e?.name === name);
    return matches.length === 1 ? matches[0] : null;
  };
  const legacy = mode.startsWith("legacy-");
  const result = unique("authoritative-game-resolution");
  const config = unique("owner-functional-bounded-native-config");
  const combat = unique("legacy-real-combat-engine-correlated");
  const battle = unique("authoritative-solo-playability-complete");
  const inputName = mode.endsWith("mobile") ? "actual-touch-input" : "actual-mouse-input";
  const inputObserved = events.some((e) => e?.name === inputName);
  const modeMatches = MODES.includes(mode) && report?.scenarioKind === (legacy ? "legacy" : "national-solo") && report?.viewport === (mode.endsWith("mobile") ? "390x844 mobile" : "1280x800 desktop") && report?.hardwareAcceptanceRequired === false;
  const terminalObserved =
    modeMatches && base.sourceMatches &&
    result?.verified === true &&
    result.uiConfirmed === true &&
    result.sameGameId === true &&
    Number.isSafeInteger(result.tick) &&
    result.tick > 0 &&
    (legacy
      ? result.classification === "LEGACY_WINNER" &&
        combat?.actorCorrelated === true &&
        combat.observedEngineChange === true &&
        combat.sameGameId === true &&
        combat.input === (mode.endsWith("mobile") ? "touch" : "mouse") &&
        Number.isSafeInteger(combat.tick) &&
        combat.tick > 0 &&
        result.tick >= combat.tick
      : terminalKinds.has(result.classification) &&
        Number.isSafeInteger(battle?.liveTick) &&
        result.tick >= battle.liveTick);
  const accepted =
    !software &&
    MODES.includes(mode) &&
    base.functionalGameplayObserved &&
    physicalGameplayContract(report, mode) &&
    config?.verified === true &&
    unique("owner-functional-launch-config")?.verified === true &&
    inputObserved &&
    terminalObserved &&
    Array.isArray(report.restrictedRuntimeAssets) && report.restrictedRuntimeAssets.length === 0;
  return {
    mode,
    sourceMatches: base.sourceMatches,
    stageReached: summary.stageReached,
    completedStages: summary.completedStages,
    rendererAndShadersObserved: !software && base.rendererAndShadersObserved,
    renderer: summary.hardware.renderer,
    webgl1ShaderPixel: summary.hardware.webgl1ShaderPixel,
    webgl2ShaderPixel: summary.hardware.webgl2ShaderPixel,
    inputObserved,
    nativeConfigurationObserved: config?.verified === true,
    terminalObserved,
    terminalTick: terminalObserved ? result.tick : null,
    terminalKind: terminalObserved ? result.classification : null,
    gameplayObserved: accepted,
    reason: accepted
      ? "OWNER_FUNCTIONAL_GAMEPLAY_NOT_RELEASE"
      : software
        ? "SOFTWARE_ONLY_NOT_GPU_EVIDENCE"
        : !base.rendererAndShadersObserved
          ? base.reason
          : !terminalObserved
            ? "TERMINAL_GAMEPLAY_NOT_OBSERVED"
            : !accepted
              ? "INCOMPLETE_OWNER_FUNCTIONAL_CONTRACT"
              : base.reason,
    failureCodes: (Array.isArray(report?.errors) ? report.errors : [])
      .map((e) => failureCodes.has(e?.error) ? e.error : "OTHER_BROWSER_FAILURE")
      .slice(0, 8),
    releaseCertified: false,
    signedPreflightAccepted: false,
    independentGameplayWitness: false,
  };
}
