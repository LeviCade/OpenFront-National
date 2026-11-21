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

/**
 * Deterministic, genuine pointer search for mobile and desktop spawn.
 * Coordinates never prove land ownership; CDP + GameView must establish it.
 */
export function soloSpawnFractions() {
  const points = [
    [0.55, 0.55],
    [0.4, 0.4],
    [0.6, 0.42],
    [0.3, 0.55],
    [0.7, 0.6],
    [0.2, 0.4],
  ];
  for (const y of [0.25, 0.4, 0.55, 0.7, 0.82]) {
    for (const x of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      if (!points.some(([u, v]) => u === x && v === y))
        points.push([x, y]);
    }
  }
  return points;
}

/** A real click is insufficient without engine packets and opponent damage. */
export function classifySoloBattleEvidence({
  targetId,
  emitted,
  before,
  after,
  outgoingBefore,
  outgoingAfter,
  packets,
  firstSequence,
}) {
  if (
    typeof targetId !== "string" ||
    !targetId ||
    before?.id !== targetId ||
    after?.id !== targetId ||
    !Number.isSafeInteger(before?.tiles) ||
    !Number.isSafeInteger(after?.tiles)
  )
    return { accepted: false, reason: "SOLO_COMBAT_TARGET_INVALID" };
  if (
    !Array.isArray(emitted) ||
    !emitted.some(
      (e) =>
        e?.targetId === targetId &&
        Number.isFinite(e.troops) &&
        e.troops > 0,
    )
  )
    return { accepted: false, reason: "SOLO_REAL_RADIAL_ATTACK_ABSENT" };
  if (
    !Number.isSafeInteger(outgoingBefore) ||
    !Number.isSafeInteger(outgoingAfter) ||
    outgoingAfter <= outgoingBefore ||
    !Number.isSafeInteger(firstSequence) ||
    !Array.isArray(packets) ||
    !packets.some(
      (p) =>
        p?.sequence > firstSequence &&
        (p.hasAuthoritativeAttackDelta === true ||
          p.hasAuthoritativeMotion === true),
    )
  )
    return { accepted: false, reason: "SOLO_ATTACK_ENGINE_DELTA_ABSENT" };
  const troopLoss =
    Number.isFinite(before.troops) &&
    Number.isFinite(after.troops) &&
    after.troops < before.troops;
  const territoryLoss = after.tiles < before.tiles;
  if (!troopLoss && !territoryLoss)
    return { accepted: false, reason: "SOLO_OPPONENT_DAMAGE_ABSENT" };
  return {
    accepted: true,
    reason: "SOLO_REAL_RADIAL_COMBAT_IMPACT",
    troopLoss,
    territoryLoss,
  };
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
  if (matching.some((r) => r.accepted !== true && r.accepted !== false)) {
    return {
      status: "blocked",
      reason: "FOUNDING_RECEIPT_STATUS_INVALID",
      owner: "E3",
    };
  }
  // Multiple channels may repeat the same immutable receipt, but disagreeing
  // sequence/tick/outcome for one request must never qualify as acceptance.
  const signatures = new Set(
    matching.map((r) =>
      [
        r.type,
        r.actorId,
        r.recipientId,
        r.empireId,
        r.requestId,
        r.tick,
        r.sequence,
        r.accepted,
      ].join(":"),
    ),
  );
  const accepted = matching.filter((r) => r.accepted === true);
  const rejected = matching.filter((r) => r.accepted === false);
  if (signatures.size > 1 || (accepted.length && rejected.length)) {
    return {
      status: "blocked",
      reason: "FOUNDING_CONTRADICTORY_RECEIPTS",
      owner: "E3",
    };
  }
  const tickValid = Number.isSafeInteger(tick) && tick >= issuedTick;
  if (!tickValid)
    return { status: "blocked", reason: "GAME_TICK_INVALID", owner: "E2" };
  // A receipt may arrive before GameView and the public roster catch up.
  // Neither an optimistic HUD message nor an older projection is authority.
  const receiptTick = matching.length ? matching[0].tick : null;
  if (receiptTick !== null && tick < receiptTick)
    return {
      status: "pending",
      reason: "FOUNDING_VIEW_BEHIND_RECEIPT",
      owner: "E2/E3",
    };
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
  const projectionCurrent =
    Number.isSafeInteger(snapshotTick) &&
    snapshotTick >= (receiptTick ?? issuedTick);
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
