/**
 * E5 independent NATIONAL political acceptance. Read-only projections from two
 * authenticated live GameViews. Never creates a player, command or result.
 * The proposer-side accepted offer is NOT proof of a recipient invitation.
 */
const receiptId = /^np_[a-f0-9]{32}$/;
const types = new Set([
  "national_offer_empire",
  "national_accept_empire",
  "national_transfer_crown",
]);
const validTick = (v) => Number.isSafeInteger(v) && v >= 0;
const fail = (reason, owner) => ({ accepted: false, reason, owner });

export function verifyDistinctLiveSessions(
  first,
  second,
  expectedCandidate = null,
) {
  if (
    !first ||
    !second ||
    typeof first.gameId !== "string" ||
    !first.gameId ||
    first.gameId !== second.gameId
  )
    return fail("POLITICAL_DIFFERENT_MATCH", "E2/E4");
  if (
    typeof first.actorId !== "string" ||
    !first.actorId ||
    typeof second.actorId !== "string" ||
    !second.actorId ||
    first.actorId === second.actorId
  )
    return fail("POLITICAL_DISTINCT_PRINCIPAL_REQUIRED", "E2/E4");
  if (expectedCandidate !== null && second.actorId !== expectedCandidate)
    return fail("POLITICAL_OPPONENT_ACTOR_MISMATCH", "E2/E4");
  if (
    first.spectator !== false ||
    second.spectator !== false ||
    first.spawned !== true ||
    second.spawned !== true ||
    !Number.isSafeInteger(first.ownedTiles) ||
    first.ownedTiles <= 0 ||
    !Number.isSafeInteger(second.ownedTiles) ||
    second.ownedTiles <= 0
  )
    return fail("POLITICAL_SPECTATOR_OR_INACTIVE", "E2/E4");
  if (!validTick(first.tick) || !validTick(second.tick))
    return fail("POLITICAL_INVALID_LIVE_TICKS", "E2/E3");
  return { accepted: true, reason: "DISTINCT_LIVE_PRINCIPALS" };
}

/**
 * E5 source-only topology check after real CDP admission of A, B and C.
 * Matching game IDs never attest a trusted NATIONAL server by themselves;
 * E2's protected host and E6's independent host witness are separate gates.
 */
export function verifyThreeLivePrincipals(founder, recipient, opponent) {
  for (const [first, second] of [
    [founder, recipient],
    [founder, opponent],
    [recipient, opponent],
  ]) {
    const pair = verifyDistinctLiveSessions(first, second);
    if (!pair.accepted) return pair;
  }
  const empire = founder.empires?.find(
    (e) =>
      e?.leaderId === recipient.actorId &&
      Array.isArray(e.memberIds) &&
      e.memberIds.includes(founder.actorId) &&
      e.memberIds.includes(recipient.actorId),
  );
  if (!empire)
    return fail("POLITICAL_THREE_PRINCIPAL_ROSTER_NOT_CURRENT", "E1/E3");
  if (empire.memberIds.includes(opponent.actorId))
    return fail("WAR_OPPONENT_IS_SAME_EMPIRE", "E2/E4");
  const otherView = opponent.empires?.find((e) => e?.id === empire.id);
  if (otherView?.memberIds?.includes(opponent.actorId))
    return fail("WAR_OPPONENT_IS_SAME_EMPIRE", "E2/E4");
  if (
    !otherView ||
    otherView.leaderId !== recipient.actorId ||
    !Array.isArray(otherView.memberIds) ||
    !otherView.memberIds.includes(founder.actorId) ||
    !otherView.memberIds.includes(recipient.actorId) ||
    !validTick(opponent.politicsTick) ||
    !validTick(founder.politicsTick)
  )
    return fail("POLITICAL_THIRD_VIEW_ROSTER_UNVERIFIED", "E3");
  return {
    accepted: true,
    reason: "THREE_LIVE_PRINCIPALS_SOURCE_TOPOLOGY_ONLY",
  };
}

/**
 * Exact recipient-only pending accession invitation. This is a CURRENT
 * authenticated GameView packet, not an original sender's optimistic receipt.
 */
export function verifyPrivateInvitation({
  founderId,
  recipientId,
  empireId,
  recipientView,
  recipientTick,
  founderView = null,
}) {
  if (
    typeof founderId !== "string" ||
    !founderId ||
    typeof recipientId !== "string" ||
    !recipientId ||
    founderId === recipientId ||
    typeof empireId !== "string" ||
    !empireId
  )
    return fail("POLITICAL_INVITATION_CONTEXT_INVALID", "E5");
  if (!validTick(recipientTick))
    return fail("POLITICAL_INVITATION_TICK_MISSING", "E3");
  if (
    !recipientView ||
    recipientView.version !== 1 ||
    recipientView.recipientId !== recipientId ||
    !Array.isArray(recipientView.offers)
  )
    return fail("POLITICAL_INVITATION_NOT_DELIVERED_TO_RECIPIENT", "E3");
  if (
    recipientView.offers.some(
      (o) =>
        !o || o.recipientId !== recipientId || o.candidateId !== recipientId,
    )
  )
    return fail("POLITICAL_FOREIGN_INVITATION_IN_RECIPIENT_VIEW", "E3");
  const actual = recipientView.offers.filter(
    (o) =>
      o.empireId === empireId &&
      o.proposerId === founderId &&
      o.recipientId === recipientId &&
      o.candidateId === recipientId,
  );
  if (actual.length !== 1)
    return fail("POLITICAL_INVITATION_ABSENT_OR_DUPLICATE", "E3");
  // The sender may see OTHER invitations addressed to itself, but never the
  // recipient's pending offer. No private packets are copied to reports.
  if (
    !founderView ||
    founderView.version !== 1 ||
    founderView.recipientId !== founderId ||
    !Array.isArray(founderView.offers)
  )
    return fail("POLITICAL_SENDER_PRIVATE_VIEW_UNVERIFIED", "E3");
  // An exact recipient-only invitation in the sender's independently
  // authenticated view is a disclosure, even though it ALSO violates the
  // sender-view ownership invariant. Classify the leak before the generic
  // mismatch; do not weaken either rejection rule.
  if (
    founderView.offers.some(
      (o) =>
        o?.empireId === empireId &&
        o.proposerId === founderId &&
        o.recipientId === recipientId &&
        o.candidateId === recipientId,
    )
  )
    return fail("POLITICAL_PRIVATE_INVITATION_LEAKED_TO_SENDER", "E3");
  if (
    founderView.offers.some(
      (o) => !o || o.recipientId !== founderId || o.candidateId !== founderId,
    )
  )
    return fail("POLITICAL_SENDER_PRIVATE_VIEW_MISMATCH", "E3");
  return { accepted: true, reason: "AUTHENTIC_RECIPIENT_ONLY_INVITATION" };
}

/**
 * Separate authentic click receipt and current canonical political roster.
 * Intent emission or a positive receipt alone is never a completed action.
 */
export function reconcilePoliticalReceipt({
  type,
  requestId,
  actorId,
  empireId,
  targetId,
  issuedTick,
  currentTick,
  politicsTick,
  results,
  empires,
}) {
  if (
    !types.has(type) ||
    !receiptId.test(requestId ?? "") ||
    typeof actorId !== "string" ||
    !actorId ||
    typeof targetId !== "string" ||
    !targetId ||
    typeof empireId !== "string" ||
    !empireId ||
    !validTick(issuedTick) ||
    !validTick(currentTick) ||
    currentTick < issuedTick
  )
    return fail("POLITICAL_ACTION_CONTEXT_INVALID", "E5");
  if (!Array.isArray(results))
    return fail("POLITICAL_RECEIPT_CHANNEL_UNAVAILABLE", "E3");
  const matches = results.filter((r) => r?.requestId === requestId);
  if (
    matches.some(
      (r) =>
        !r ||
        r.type !== type ||
        r.actorId !== actorId ||
        r.recipientId !== actorId ||
        r.commandTargetId !== empireId ||
        !validTick(r.tick) ||
        r.tick < issuedTick ||
        r.tick > currentTick ||
        !validTick(r.sequence) ||
        (r.accepted !== true && r.accepted !== false) ||
        (r.accepted === true && r.reason !== "accepted") ||
        (r.accepted === false &&
          r.reason !== "political-rule" &&
          r.reason !== "actor-inactive"),
    )
  )
    return fail("POLITICAL_FORGED_OR_FOREIGN_RECEIPT", "E3");
  const signatures = new Set(
    matches.map((r) =>
      [
        r.type,
        r.actorId,
        r.recipientId,
        r.commandTargetId,
        r.requestId,
        r.sequence,
        r.tick,
        r.accepted,
        r.reason,
      ].join(":"),
    ),
  );
  if (signatures.size > 1)
    return fail("POLITICAL_CONTRADICTORY_RECEIPTS", "E3");
  if (!matches.length)
    return fail("POLITICAL_AUTHENTIC_RECEIPT_ABSENT", "E2/E3");
  const receipt = matches[0];
  if (receipt.accepted === false)
    return fail("POLITICAL_ENGINE_REJECTED_" + receipt.reason, "E2");
  if (
    !validTick(politicsTick) ||
    politicsTick < receipt.tick ||
    !Array.isArray(empires)
  )
    return fail("POLITICAL_STALE_PUBLIC_PROJECTION", "E3");
  const empire = empires.find((e) => e?.id === empireId);
  if (
    !empire ||
    !Array.isArray(empire.memberIds) ||
    !empire.memberIds.includes(actorId)
  )
    return fail("POLITICAL_CANONICAL_EMPIRE_MISSING", "E1/E3");
  if (
    type === "national_offer_empire" &&
    (empire.leaderId !== actorId || empire.memberIds.includes(targetId))
  )
    return fail("POLITICAL_OFFER_ROSTER_CONTRADICTION", "E1/E3");
  if (
    type === "national_accept_empire" &&
    (actorId !== targetId || !empire.memberIds.includes(targetId))
  )
    return fail("POLITICAL_ACCEPTANCE_ROSTER_MISSING", "E1/E3");
  if (
    type === "national_transfer_crown" &&
    (empire.leaderId !== targetId ||
      !empire.memberIds.includes(targetId) ||
      actorId === targetId)
  )
    return fail("POLITICAL_CROWN_TRANSFER_ROSTER_MISSING", "E1/E3");
  return {
    accepted: true,
    reason: "AUTHENTIC_POLITICAL_RECEIPT_AND_ROSTER",
    receiptTick: receipt.tick,
    sequence: receipt.sequence,
  };
}

/** An acceptance transition must remain current for BOTH viewer sessions. */
export function corroboratePublicEmpire({
  emperor,
  recipient,
  empireId,
  leaderId,
  memberIds,
  minTick,
}) {
  if (
    !emperor ||
    !recipient ||
    emperor.gameId !== recipient.gameId ||
    emperor.actorId === recipient.actorId ||
    !validTick(minTick)
  )
    return fail("POLITICAL_CROSS_VIEW_SESSION_INVALID", "E2/E4");
  for (const view of [emperor, recipient]) {
    if (!validTick(view.politicsTick) || view.politicsTick < minTick)
      return fail("POLITICAL_CROSS_VIEW_STALE_ROSTER", "E3");
    const empires = view.empires;
    const row = Array.isArray(empires)
      ? empires.find((e) => e?.id === empireId)
      : null;
    if (
      !row ||
      row.leaderId !== leaderId ||
      !Array.isArray(row.memberIds) ||
      !memberIds.every((m) => row.memberIds.includes(m))
    )
      return fail("POLITICAL_CROSS_VIEW_ROSTER_MISMATCH", "E1/E3");
  }
  return { accepted: true, reason: "SAME_CANONICAL_ROSTER_IN_BOTH_VIEWS" };
}

/** Release summaries may contain counters and step labels, never private DTOs. */
export function sanitizePacketEvidence(packets) {
  if (!Array.isArray(packets)) return [];
  return packets.slice(-240).map((p) => ({
    sequence: validTick(p?.sequence) ? p.sequence : null,
    tick: validTick(p?.tick) ? p.tick : null,
    hasPublicPolitics: !!p?.publicPolitics,
    hasCurrentConflicts: !!p?.publicConflicts,
    hasRecipientAccessionView: !!p?.accessionOffers,
    commandResultCount: Array.isArray(p?.commandResults)
      ? p.commandResults.length
      : 0,
    hasAuthoritativeAttackDelta: p?.hasAuthoritativeAttackDelta === true,
    hasAuthoritativeMotion: p?.hasAuthoritativeMotion === true,
    hasTerritoryDelta: p?.hasTerritoryDelta === true,
  }));
}

/**
 * E6-publishable failure and event projection: report no player names,
 * invitation packets, command nonces, fog, browser body text or live secrets.
 */
const TRUSTED_ACCEPTANCE_FAILURE_CODES = Object.freeze([
  "NATIONAL_SOLO_CANNOT_PROVE_THREE_PRINCIPALS_OWNER_E2",
  "NATIONAL_TRUSTED_SERVER_MULTIPLAYER_REQUIRED_OWNER_E2",
  "FOUNDING_UI_PENDING_IDENTITY_MISMATCH_OWNER_E4",
  "FOUNDING_VIEW_BEHIND_RECEIPT",
  "POLITICAL_SECOND_AUTHORIZED_BROWSER_SESSION_MISSING_OWNER_E2_E4_E6",
  "POLITICAL_SECOND_LIVE_GAME_PAGE_MISSING_OWNER_E2_E4_E6",
  "POLITICAL_ACCEPT_NATIVE_CLICK_NOT_OBSERVED_OWNER_E4",
  "POLITICAL_PRIVATE_INVITATION_NOT_DELIVERED_OWNER_E3",
  "POLITICAL_SENDER_PRIVATE_VIEW_UNVERIFIED",
  "POLITICAL_SENDER_PRIVATE_VIEW_MISMATCH",
  "PEACE_SECOND_PRINCIPAL_REAL_CLICK_MISSING_OWNER_E4",
  "POLITICAL_FOUNDING_SESSION_UNAVAILABLE_OWNER_E2_E4",
  "WARNING_DEV_ADMIN_BOT_KEY_DO_NOT_USE_IN_PRODUCTION",
  "POLITICAL_FOUNDING_ROSTER_NOT_CURRENT_OWNER_E1_E3",
  "POLITICAL_PRIVATE_INVITATION_UNCONFIRMED_OWNER_E3",
  "POLITICAL_REAL_EVENTBUS_OBSERVER_MISSING_OWNER_E4",
  "POLITICAL_SECOND_CDP_SESSION_UNREACHABLE_OWNER_E6",
  "MAP_ATTACK_ON_DECLARED_WAR_TARGET_NOT_DISPATCHED",
  "POLITICAL_OFFER_REAL_CLICK_NOT_OBSERVED_OWNER_E4",
  "POLITICAL_SECOND_CLICK_OBSERVER_MISSING_OWNER_E4",
  "POLITICAL_FOUNDER_PRINCIPAL_CHANGED_OWNER_E2_E4",
  "POLITICAL_INVITATION_NOT_DELIVERED_TO_RECIPIENT",
  "POLITICAL_NO_LIVING_RECIPIENT_IN_UI_OWNER_E2_E4",
  "POLITICAL_RECIPIENT_SESSION_CHANGED_OWNER_E2_E4",
  "POLITICAL_FOREIGN_INVITATION_IN_RECIPIENT_VIEW",
  "POLITICAL_ACCEPT_SESSION_REPLACED_OWNER_E2_E4",
  "POLITICAL_PRIVATE_INVITATION_LEAKED_TO_SENDER",
  "WARNING_DEV_API_KEY_DO_NOT_USE_IN_PRODUCTION",
  "REAL_FOUNDING_REQUEST_ID_MISSING_OR_INVALID",
  "PEACE_OPPONENT_SESSION_CHANGED_OWNER_E2_E4",
  "POLITICAL_SECOND_CDP_PAGE_MISSING_OWNER_E6",
  "CANONICAL_WAR_TARGET_BASELINE_UNAVAILABLE",
  "POLITICAL_CROWN_ACTOR_CHANGED_OWNER_E2_E4",
  "POLITICAL_CROWN_CLICK_NOT_ACTUAL_OWNER_E4",
  "TARGET_AWARE_RADIAL_MENU_MISSING_OWNER_E4",
  "PEACE_AUTHENTIC_ENGINE_REJECTED_OWNER_E2",
  "POLITICAL_INVITATION_ABSENT_OR_DUPLICATE",
  "POLITICAL_SECOND_PANEL_NOT_OPEN_OWNER_E4",
  "POLITICAL_SELF_ACCESSION_OFFER_FORBIDDEN",
  "TARGET_AWARE_MAP_ANCHOR_MISSING_OWNER_E4",
  "POLITICAL_CROWN_FOUNDER_SESSION_MISSING",
  "POLITICAL_CROWN_TRANSFER_ROSTER_MISSING",
  "POLITICAL_SECOND_BROWSER_RUNTIME_FAILED",
  "POLITICAL_SECOND_PANEL_MISSING_OWNER_E4",
  "POLITICAL_SECOND_WATCH_TYPE_NOT_ALLOWED",
  "SPAWN_NOT_ACCEPTED_AFTER_REAL_MAP_INPUT",
  "SPAWN_PHASE_EXITED_WITHOUT_OWNERSHIP",
  "SOLO_TRANSPORT_ADMISSION_NOT_OBSERVED",
  "SOLO_WAR_TARGET_NOT_LIVING_OPPONENT",
  "SOLO_COMBAT_TARGET_INVALID",
  "SOLO_REAL_RADIAL_ATTACK_ABSENT",
  "SOLO_ATTACK_ENGINE_DELTA_ABSENT",
  "SOLO_OPPONENT_DAMAGE_ABSENT",
  "SOLO_GAMEPLAY_FINAL_AUTHORITY_MISSING",
  "WAR_OPPONENT_IS_SAME_EMPIRE_OWNER_E2_E4",
  "FOUNDING_ACTOR_NOT_CANONICALLY_SPAWNED",
  "FOUNDING_ACTOR_CHANGED_DURING_REQUEST",
  "PEACE_CLICK_DID_NOT_EMIT_REAL_REQUEST",
  "POLITICAL_DISTINCT_PRINCIPAL_REQUIRED",
  "POLITICAL_RECEIPT_CHANNEL_UNAVAILABLE",
  "POLITICAL_SECOND_SELECTOR_ID_REQUIRED",
  "FOUNDING_REAL_EVENTBUS_NOT_CONNECTED",
  "POLITICAL_AUTHENTIC_RECIPIENT_ABSENT",
  "POLITICAL_CROSS_VIEW_ROSTER_MISMATCH",
  "POLITICAL_CROSS_VIEW_SESSION_INVALID",
  "POLITICAL_INVITATION_CONTEXT_INVALID",
  "POLITICAL_OFFER_ROSTER_CONTRADICTION",
  "POLITICAL_SECOND_INPUT_TYPE_MISMATCH",
  "MAP_ASSAULT_LACKS_OWN_ENGINE_ATTACK",
  "POLITICAL_ACCEPTANCE_ROSTER_MISSING",
  "POLITICAL_FORGED_OR_FOREIGN_RECEIPT",
  "POLITICAL_SECOND_CDP_HOST_NOT_LOCAL",
  "SPAWN_DIPLOMACY_PANEL_STATE_MISSING",
  "WAR_CLICK_DID_NOT_EMIT_REAL_REQUEST",
  "WAR_EVENTBUS_OBSERVER_NOT_CONNECTED",
  "PEACE_CANONICAL_REFERENCES_MISSING",
  "POLITICAL_AUTHENTIC_RECEIPT_ABSENT",
  "POLITICAL_CANONICAL_EMPIRE_MISSING",
  "SPAWN_NO_UNOBSTRUCTED_CANVAS_POINT",
  "POLITICAL_CROSS_VIEW_STALE_ROSTER",
  "POLITICAL_INVITATION_TICK_MISSING",
  "POLITICAL_OPPONENT_ACTOR_MISMATCH",
  "POLITICAL_STALE_PUBLIC_PROJECTION",
  "POLITICAL_ACTION_CONTEXT_INVALID",
  "POLITICAL_CONTRADICTORY_RECEIPTS",
  "ENGINE_REJECTED_WAR_DECLARATION",
  "PEACE_REAL_WAR_OPPONENT_MISSING",
  "POLITICAL_SPECTATOR_OR_INACTIVE",
  "SPAWN_MAP_OBSCURED_BY_DIPLOMACY",
  "ENGINE_REJECTED_PEACE_PROPOSAL",
  "FOUNDING_GAMEVIEW_DISAPPEARED",
  "POLITICAL_INVALID_LIVE_TICKS",
  "POLITICAL_WATCH_TYPE_UNKNOWN",
  "WAR_TARGET_NOT_AUTHENTICATED",
  "PEACE_REAL_PROPOSER_MISSING",
  "SPAWN_GAMEVIEW_UNAVAILABLE",
  "POLITICAL_DIFFERENT_MATCH",
  "POLITICAL_ENGINE_REJECTED",
  "POLITICAL_CONTRADICTORY",
  "ENGINE_REJECTED_ACTION",
  "FOUNDING_UNRESOLVED",
  "POLITICAL_FORGED",
]);

export function safeFailureCode(value) {
  const message = String(value ?? "");
  if (message.includes("REAL_CHROMIUM_GPU_REQUIRED"))
    return "REAL_CHROMIUM_GPU_REQUIRED: WebGL gate";
  for (const code of TRUSTED_ACCEPTANCE_FAILURE_CODES) {
    if (message.includes(code)) return code;
  }
  if (/Timed out/i.test(message)) return "TIMED_OUT: authoritative evidence";
  if (message.includes("POLITICAL_")) return "POLITICAL_ACCEPTANCE_FAILURE";
  if (message.includes("FOUNDING_")) return "FOUNDING_ACCEPTANCE_FAILURE";
  if (message.includes("SPAWN_")) return "SPAWN_ACCEPTANCE_FAILURE";
  if (message.includes("PEACE_")) return "PEACE_ACCEPTANCE_FAILURE";
  return "UNCLASSIFIED_ACCEPTANCE_FAILURE";
}
const booleanFields = new Set([
  "accepted",
  "uiConfirmed",
  "verified",
  "sourceOnly",
  "spawned",
  "inSpawnPhase",
  "paused",
  "initiallyExpanded",
  "viaCdp",
  "recipientOnly",
  "recipientAccepted",
  "pendingUiObserved",
  "uiIdentityMatched",
  "nationalMode",
  "isSolo",
  "gameTypeIsSolo",
  "actorPresent",
  "gameIdPresent",
  "opponentHasTiles",
  "nativeSelect",
  "founded",
  "warDeclared",
  "realRadialAttack",
  "opponentDamaged",
  "troopLoss",
  "territoryLoss",
  "sameGameId",
  "targetNotEmpireMember",
  "secondAuthenticatedSession",
  "originatingOfferReceiptMatched",
  "differentPrincipal",
  "realCdpInput",
  "founderRosterAgrees",
  "formerEmperorRevoked",
  "successorIsDifferentPrincipal",
  "warEndedInBothViews",
  "targetMatch",
  "enabled",
  "targetCorrelated",
  "actorCorrelated",
  "recipientCorrelated",
  "observedEngineChange",
  "authenticPublicRoster",
  "unobstructed",
]);
const numericFields = new Set([
  "elapsedMs",
  "tick",
  "tickBefore",
  "tickAfter",
  "liveTick",
  "snapshotTick",
  "issuedTick",
  "receiptTick",
  "sequence",
  "attempt",
  "packetCount",
  "assetRequests",
  "restrictedAssets",
  "unobstructedInputs",
  "obstructedSamples",
  "workerPacketCount",
  "observedPackets",
  "matchedJournal",
  "matchedView",
  "requestCount",
  "stageCount",
]);
const textFields = new Set([
  "name",
  "stage",
  "label",
  "source",
  "input",
  "type",
  "reason",
  "classification",
  "owner",
  "requestFingerprint",
]);
export function sanitizeAcceptanceEvent(event) {
  if (!event || typeof event !== "object") return null;
  const out = {};
  for (const [key, val] of Object.entries(event)) {
    if (booleanFields.has(key) && typeof val === "boolean") out[key] = val;
    else if (numericFields.has(key) && validTick(val)) out[key] = val;
    else if (
      textFields.has(key) &&
      typeof val === "string" &&
      /^[A-Za-z0-9_:. -]{1,128}$/.test(val)
    )
      out[key] = val;
    else if (key === "error") out.error = safeFailureCode(val);
  }
  return out.name ? out : null;
}
