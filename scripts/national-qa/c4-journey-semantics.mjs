// Independent C4 semantic evidence oracle. Synthetic inputs are never gameplay.
const modes = ["national-solo-desktop","national-solo-mobile","legacy-desktop","legacy-mobile","private-national"];
const national = ["start","spawn","found","admit","war","attack","illegal","peace","crown","victory"];
const legacy = ["start","spawn","legacy-action"];
export function validateJourney(mode, browser, authority, trusted) {
  const fail = (reason) => ({ accepted: false, reason });
  const hex = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
  const id = (x) => typeof x === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(x);
  const count = (x) => Number.isSafeInteger(x) && x >= 0;
  const privateMode = mode === "private-national";
  const isLegacy = mode.startsWith("legacy-");
  const phases = isLegacy ? legacy : privateMode ? [...national, "reconnect", "cross-principal", "stale-socket", "replay", "spectator"] : national;
  if (!modes.includes(mode) || !trusted || !/^[a-f0-9]{40}$/.test(trusted.sourceSha ?? "") ||
      !browser || !authority || browser.sourceSha !== trusted.sourceSha ||
      authority.sourceSha !== trusted.sourceSha || browser.mode !== mode ||
      authority.mode !== mode) return fail("SOURCE_OR_MODE_MISMATCH");
  if (!id(browser.matchId) || browser.matchId !== authority.matchId ||
      authority.matchId !== trusted.matchId || !id(authority.runnerId) ||
      authority.runnerId !== trusted.runnerId) return fail("MATCH_OR_RUNNER_MISMATCH");
  if (!["owner-observed", "physical"].includes(trusted.executionKind) ||
      !["mouse", "touch"].includes(browser.pointer) ||
      (!privateMode && browser.pointer !== (mode.endsWith("mobile") ? "touch" : "mouse")) ||
      typeof browser.renderer !== "string" || !browser.renderer.trim() ||
      /swiftshader|llvmpipe|softpipe|software|lavapipe/i.test(browser.renderer) ||
      browser.renderer !== trusted.renderer) return fail("REAL_BROWSER_ENVIRONMENT_UNPROVEN");
  if (!Array.isArray(browser.transitions) || !Array.isArray(authority.transitions) ||
      browser.transitions.length !== phases.length || authority.transitions.length !== phases.length)
    return fail("TRANSITION_MISSING_OR_EXTRA");
  const requests = new Set();
  let lastTick = -1;
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i], b = browser.transitions[i], a = authority.transitions[i];
    if (!b || !a || b.phase !== phase || a.phase !== phase ||
        !hex(b.screenshotSha256)) return fail("TRANSITION_ORDER_OR_SCREENSHOT_" + phase);
    if (!id(a.actor) || a.actor !== b.actor || !id(a.requestId) ||
        a.requestId !== b.requestId || requests.has(a.requestId) ||
        !hex(a.receiptSha256) || a.receiptSha256 !== b.receiptSha256 ||
        !count(a.tickBefore) || !count(a.tickAfter) || a.tickAfter <= a.tickBefore ||
        a.tickBefore < lastTick || b.tickAfter !== a.tickAfter ||
        !hex(a.beforeStateSha256) || !hex(a.afterStateSha256))
      return fail("COMMAND_RECEIPT_OR_TICK_" + phase);
    requests.add(a.requestId);
    lastTick = a.tickAfter;
    const negative = ["illegal", "cross-principal", "stale-socket", "replay", "spectator"].includes(phase);
    if (a.outcome !== (negative ? "rejected" : "executed") ||
        (negative && (!id(a.rejectionCode) || a.commandEffects !== 0)) ||
        (!negative && a.beforeStateSha256 === a.afterStateSha256))
      return fail("AUTHORITATIVE_OUTCOME_" + phase);
    const before = a.before, after = a.after;
    if (!before || !after) return fail("STATE_MEASUREMENTS_" + phase);
    if (phase === "spawn" && !(before.tiles === 0 && count(after.tiles) && after.tiles > 0))
      return fail("SPAWN_NOT_OBSERVED");
    if (phase === "found" && !(before.organization === null && id(after.organization)))
      return fail("FOUNDING_NOT_OBSERVED");
    if (phase === "admit" && !(count(before.members) && count(after.members) &&
        after.members > before.members && id(a.target) && a.target !== a.actor))
      return fail("ADMISSION_NOT_OBSERVED");
    if (phase === "war" && !(before.war === false && after.war === true && id(a.target) && a.target !== a.actor))
      return fail("WAR_NOT_OBSERVED");
    if (phase === "attack" && !(id(a.target) && a.target !== a.actor && id(b.target) && b.target === a.target &&
        count(before.targetTiles) && count(after.targetTiles) && count(before.targetTroops) &&
        count(after.targetTroops) && count(before.actorTroops) && count(after.actorTroops) &&
        after.actorTroops < before.actorTroops &&
        (after.targetTiles < before.targetTiles || after.targetTroops < before.targetTroops)))
      return fail("MILITARY_EFFECT_NOT_OBSERVED");
    if (phase === "peace" && !(before.war === true && after.war === false && id(a.target) && a.target !== a.actor))
      return fail("PEACE_NOT_OBSERVED");
    if (phase === "crown" && !(id(before.crown) && id(after.crown) && before.crown !== after.crown))
      return fail("SUCCESSION_NOT_OBSERVED");
    if (phase === "victory" && !(count(before.sovereigns) && before.sovereigns > 1 &&
        after.sovereigns === 1 && after.winCheck === true && id(after.winner) &&
        before.winner === null && after.winner === after.soleSovereign))
      return fail("CONSTITUTIONAL_VICTORY_NOT_OBSERVED");
    if (phase === "legacy-action" && !(count(before.tiles) && count(after.tiles) &&
        after.tiles > before.tiles && after.nationalAuthority === false))
      return fail("LEGACY_EFFECT_NOT_OBSERVED");
    if (phase === "reconnect" && !(id(before.socket) && id(after.socket) &&
        before.socket !== after.socket && before.seat === after.seat && id(after.seat)))
      return fail("RECONNECT_NOT_OBSERVED");
  }
  if (privateMode) {
    if (authority.gameServerCount !== 1 || authority.gameRunnerCount !== 1 ||
        !id(authority.hostId) || authority.hostId !== trusted.hostId ||
        !["local-registered", "external-provider"].includes(authority.authKind) ||
        authority.authKind !== trusted.authKind || !Array.isArray(authority.seats) ||
        authority.seats.length !== 3 || !Array.isArray(browser.seats) || browser.seats.length !== 3)
      return fail("PRIVATE_HOST_OR_AUTH_UNPROVEN");
    for (const field of ["principal", "seatId", "profileId", "projectionBefore", "projectionAfter"]) {
      if (new Set(authority.seats.map(s => s?.[field])).size !== 3)
        return fail("DUPLICATE_PRIVATE_" + field);
    }
    for (const s of authority.seats) {
      const b = browser.seats.find(x => x?.seatId === s.seatId);
      if (!id(s.principal) || !id(s.seatId) || !id(s.profileId) ||
          !hex(s.projectionBefore) || !hex(s.projectionAfter) ||
          s.projectionBefore === s.projectionAfter || !count(s.tickBefore) ||
          !count(s.tickAfter) || s.tickAfter <= s.tickBefore ||
          !b || b.principal !== s.principal || b.profileId !== s.profileId ||
          b.matchId !== authority.matchId || b.projectionBefore !== s.projectionBefore ||
          b.projectionAfter !== s.projectionAfter || b.tickAfter !== s.tickAfter)
        return fail("PRIVATE_PROJECTION_OR_TICK_UNCORRELATED");
    }
    if (authority.transitions.some(a => !authority.seats.some(s => s.principal === a.actor)))
      return fail("PRIVATE_ACTOR_NOT_ADMITTED");
  }
  return { accepted: true, reason: "CORRELATED_JOURNEY", authKind: privateMode ? authority.authKind : null };
}
export const C4_MODES = Object.freeze([...modes]);
