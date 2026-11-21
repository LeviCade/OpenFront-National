/**
 * R11 E5 independent, read-only browser acceptance checks.
 * This module authorizes NO input or state changes. All actions come from CDP.
 */
export const PANEL_TOGGLE =
  'national-diplomacy-panel button[aria-controls="national-diplomacy-content"]';

export function describePanel(toggle, panel) {
  if (!toggle || !panel || !panel.contains(toggle)) {
    return { valid: false, expanded: null, reason: "PANEL_TOGGLE_MISSING" };
  }
  const expanded = toggle.getAttribute("aria-expanded");
  if (expanded !== "true" && expanded !== "false") {
    return {
      valid: false,
      expanded: null,
      reason: "PANEL_EXPANSION_STATE_MISSING",
    };
  }
  return { valid: true, expanded: expanded === "true", reason: "OK" };
}

/** Reject a tap when the actual topmost visible element is UI, not map. */
export function unobstructedCanvasPoint(doc, canvas, fractions) {
  if (
    !canvas ||
    typeof canvas.getBoundingClientRect !== "function" ||
    !doc ||
    typeof doc.elementFromPoint !== "function"
  )
    return null;
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 150 && rect.height > 100)) return null;
  for (const [u, v] of fractions) {
    if (!(u > 0 && u < 1 && v > 0 && v < 1)) continue;
    const x = Math.round(rect.x + u * rect.width);
    const y = Math.round(rect.y + v * rect.height);
    if (
      x < 8 ||
      y < 8 ||
      x > doc.documentElement.clientWidth - 8 ||
      y > doc.documentElement.clientHeight - 8
    )
      continue;
    const hit = doc.elementFromPoint(x, y);
    if (hit === canvas || canvas.contains(hit)) return { x, y };
  }
  return null;
}

export function classifyFoundingEvidence({
  actorId,
  empireId,
  requestId,
  issuedTick,
  tick,
  paused,
  results,
  publicEmpires,
  uiConfirmed,
  snapshotTick,
}) {
  if (
    typeof actorId !== "string" ||
    !actorId ||
    typeof empireId !== "string" ||
    !empireId ||
    typeof requestId !== "string" ||
    !requestId ||
    !Number.isSafeInteger(issuedTick) ||
    issuedTick < 0
  )
    return {
      status: "blocked",
      reason: "FOUNDING_CONTEXT_INVALID",
      owner: "E5",
    };
  const reports = Array.isArray(results) ? results : [];
  const matching = reports.filter((r) => r?.requestId === requestId);
  if (
    matching.some(
      (r) =>
        r.actorId !== actorId ||
        r.recipientId !== actorId ||
        r.empireId !== empireId ||
        r.type !== "national_found_empire",
    )
  ) {
    return {
      status: "blocked",
      reason: "FOUNDING_RECEIPT_ACTOR_MISMATCH",
      owner: "E3",
    };
  }
  if (
    matching.some(
      (r) =>
        !Number.isSafeInteger(r.sequence) ||
        r.sequence < 0 ||
        !Number.isSafeInteger(r.tick) ||
        r.tick < issuedTick,
    )
  ) {
    return {
      status: "blocked",
      reason: "FOUNDING_RECEIPT_TICK_OR_SEQUENCE_INVALID",
      owner: "E3",
    };
  }
  const accepted = matching.filter((r) => r.accepted === true);
  const rejected = matching.filter((r) => r.accepted === false);
  if (accepted.length && rejected.length) {
    return {
      status: "blocked",
      reason: "FOUNDING_CONTRADICTORY_RECEIPTS",
      owner: "E3",
    };
  }
  if (rejected.length)
    return {
      status: "rejected",
      reason: "ENGINE_REJECTED_FOUNDING",
      owner: "E2",
    };
  const roster =
    Array.isArray(publicEmpires) &&
    publicEmpires.some(
      (e) =>
        e?.id === empireId &&
        e.leaderId === actorId &&
        Array.isArray(e.memberIds) &&
        e.memberIds.includes(actorId),
    );
  const tickValid = Number.isSafeInteger(tick) && tick >= issuedTick;
  const projectionCurrent =
    Number.isSafeInteger(snapshotTick) && snapshotTick >= issuedTick;
  if (
    accepted.length &&
    roster &&
    uiConfirmed === true &&
    tickValid &&
    projectionCurrent
  ) {
    return {
      status: "accepted",
      reason: "AUTHENTIC_FOUNDING_AND_ROSTER",
      owner: null,
    };
  }
  if (!tickValid)
    return { status: "blocked", reason: "GAME_TICK_INVALID", owner: "E2" };
  if (tick === issuedTick && !accepted.length)
    return {
      status: "pending",
      reason:
        paused === true
          ? "GAME_PAUSED_NO_FOUNDING_TICK"
          : "GAME_TICK_NOT_ADVANCING",
      owner: "E2",
    };
  if (!accepted.length)
    return {
      status: "pending",
      reason: "FOUNDING_RECEIPT_ABSENT",
      owner: "E3",
    };
  if (!roster || !projectionCurrent)
    return {
      status: "pending",
      reason: "FOUNDING_PUBLIC_ROSTER_MISSING",
      owner: "E3",
    };
  return {
    status: "pending",
    reason: "FOUNDING_UI_CONFIRMATION_MISSING",
    owner: "E4",
  };
}

/**
 * An attack may only use E4's live, target-labelled radial menu. No direct
 * EventBus attack emit, guessing map coordinates, or DOM.click is acceptable.
 */
export function acceptRadialTarget({ expectedId, actualId, buttonEnabled }) {
  if (typeof expectedId !== "string" || !expectedId)
    return { accepted: false, reason: "WAR_TARGET_UNSET" };
  if (actualId !== expectedId)
    return { accepted: false, reason: "RADIAL_TARGET_NOT_AUTHENTICATED" };
  if (buttonEnabled !== true)
    return { accepted: false, reason: "RADIAL_ATTACK_DISABLED" };
  return { accepted: true, reason: "TARGETED_RADIAL_ATTACK_AVAILABLE" };
}

export function distinctPeacePrincipal({
  proposerId,
  acceptorId,
  motionId,
  warId,
  offeredMotion,
  warLayer,
}) {
  if (
    typeof proposerId !== "string" ||
    !proposerId ||
    typeof acceptorId !== "string" ||
    !acceptorId ||
    proposerId === acceptorId
  )
    return { accepted: false, reason: "OPPOSING_PRINCIPAL_REQUIRED" };
  if (
    !offeredMotion ||
    offeredMotion.id !== motionId ||
    offeredMotion.proposedBy !== proposerId ||
    offeredMotion.layerId !== warId ||
    offeredMotion.acceptedTick !== null
  )
    return { accepted: false, reason: "UNMATCHED_OFFER" };
  if (!warLayer || warLayer.id !== warId || warLayer.endedTick !== null)
    return { accepted: false, reason: "WAR_NOT_ACTIVE" };
  return { accepted: true, reason: "OPPOSING_PRINCIPAL_VALID" };
}
