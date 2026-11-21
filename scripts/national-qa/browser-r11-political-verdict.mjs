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

export function verifyDistinctLiveSessions(first, second, expectedCandidate = null) {
  if (!first || !second ||
      typeof first.gameId !== "string" || !first.gameId ||
      first.gameId !== second.gameId) return fail("POLITICAL_DIFFERENT_MATCH", "E2/E4");
  if (typeof first.actorId !== "string" || !first.actorId ||
      typeof second.actorId !== "string" || !second.actorId ||
      first.actorId === second.actorId) return fail("POLITICAL_DISTINCT_PRINCIPAL_REQUIRED", "E2/E4");
  if (expectedCandidate !== null && second.actorId !== expectedCandidate)
    return fail("POLITICAL_OPPONENT_ACTOR_MISMATCH", "E2/E4");
  if (first.spectator === true || second.spectator === true ||
      first.spawned !== true || second.spawned !== true ||
      !Number.isSafeInteger(first.ownedTiles) || first.ownedTiles <= 0 ||
      !Number.isSafeInteger(second.ownedTiles) || second.ownedTiles <= 0)
    return fail("POLITICAL_SPECTATOR_OR_INACTIVE", "E2/E4");
  if (!validTick(first.tick) || !validTick(second.tick))
    return fail("POLITICAL_INVALID_LIVE_TICKS", "E2/E3");
  return { accepted: true, reason: "DISTINCT_LIVE_PRINCIPALS" };
}

/**
 * Exact recipient-only pending accession invitation. This is a CURRENT
 * authenticated GameView packet, not an original sender's optimistic receipt.
 */
export function verifyPrivateInvitation({
  founderId, recipientId, empireId, recipientView, recipientTick,
  founderView = null,
}) {
  if (typeof founderId !== "string" || !founderId ||
      typeof recipientId !== "string" || !recipientId ||
      founderId === recipientId || typeof empireId !== "string" || !empireId)
    return fail("POLITICAL_INVITATION_CONTEXT_INVALID", "E5");
  if (!validTick(recipientTick))
    return fail("POLITICAL_INVITATION_TICK_MISSING", "E3");
  if (!recipientView || recipientView.version !== 1 ||
      recipientView.recipientId !== recipientId ||
      !Array.isArray(recipientView.offers))
    return fail("POLITICAL_INVITATION_NOT_DELIVERED_TO_RECIPIENT", "E3");
  if (recipientView.offers.some(o =>
    !o || o.recipientId !== recipientId || o.candidateId !== recipientId))
    return fail("POLITICAL_FOREIGN_INVITATION_IN_RECIPIENT_VIEW", "E3");
  const actual = recipientView.offers.filter(o =>
    o.empireId === empireId && o.proposerId === founderId &&
    o.recipientId === recipientId && o.candidateId === recipientId);
  if (actual.length !== 1)
    return fail("POLITICAL_INVITATION_ABSENT_OR_DUPLICATE", "E3");
  // The sender may see OTHER invitations addressed to itself, but never the
  // recipient's pending offer. No private packets are copied to reports.
  if (founderView?.offers?.some(o =>
    o?.empireId === empireId && o?.candidateId === recipientId))
    return fail("POLITICAL_PRIVATE_INVITATION_LEAKED_TO_SENDER", "E3");
  return { accepted: true, reason: "AUTHENTIC_RECIPIENT_ONLY_INVITATION" };
}

/**
 * Separate authentic click receipt and current canonical political roster.
 * Intent emission or a positive receipt alone is never a completed action.
 */
export function reconcilePoliticalReceipt({
  type, requestId, actorId, empireId, targetId,
  issuedTick, currentTick, politicsTick, results, empires,
}) {
  if (!types.has(type) || !receiptId.test(requestId ?? "") ||
      typeof actorId !== "string" || !actorId ||
      typeof targetId !== "string" || !targetId ||
      typeof empireId !== "string" || !empireId ||
      !validTick(issuedTick) || !validTick(currentTick) ||
      currentTick < issuedTick)
    return fail("POLITICAL_ACTION_CONTEXT_INVALID", "E5");
  if (!Array.isArray(results))
    return fail("POLITICAL_RECEIPT_CHANNEL_UNAVAILABLE", "E3");
  const matches = results.filter(r => r?.requestId === requestId);
  if (matches.some(r =>
    !r || r.type !== type || r.actorId !== actorId ||
    r.recipientId !== actorId || r.commandTargetId !== empireId ||
    !validTick(r.tick) || r.tick < issuedTick || r.tick > currentTick ||
    !validTick(r.sequence) ||
    (r.accepted !== true && r.accepted !== false) ||
    (r.accepted === true && r.reason !== "accepted") ||
    (r.accepted === false &&
      r.reason !== "political-rule" && r.reason !== "actor-inactive")))
    return fail("POLITICAL_FORGED_OR_FOREIGN_RECEIPT", "E3");
  const signatures = new Set(matches.map(r =>
    [r.type, r.actorId, r.recipientId, r.commandTargetId,
      r.requestId, r.sequence, r.tick, r.accepted, r.reason].join(":")));
  if (signatures.size > 1)
    return fail("POLITICAL_CONTRADICTORY_RECEIPTS", "E3");
  if (!matches.length)
    return fail("POLITICAL_AUTHENTIC_RECEIPT_ABSENT", "E2/E3");
  const receipt = matches[0];
  if (receipt.accepted === false)
    return fail("POLITICAL_ENGINE_REJECTED_" + receipt.reason, "E2");
  if (!validTick(politicsTick) || politicsTick < receipt.tick ||
      !Array.isArray(empires))
    return fail("POLITICAL_STALE_PUBLIC_PROJECTION", "E3");
  const empire = empires.find(e => e?.id === empireId);
  if (!empire || !Array.isArray(empire.memberIds) ||
      !empire.memberIds.includes(actorId))
    return fail("POLITICAL_CANONICAL_EMPIRE_MISSING", "E1/E3");
  if (type === "national_offer_empire" &&
      (empire.leaderId !== actorId || empire.memberIds.includes(targetId)))
    return fail("POLITICAL_OFFER_ROSTER_CONTRADICTION", "E1/E3");
  if (type === "national_accept_empire" &&
      (actorId !== targetId || !empire.memberIds.includes(targetId)))
    return fail("POLITICAL_ACCEPTANCE_ROSTER_MISSING", "E1/E3");
  if (type === "national_transfer_crown" &&
      (empire.leaderId !== targetId || !empire.memberIds.includes(targetId) ||
       actorId === targetId))
    return fail("POLITICAL_CROWN_TRANSFER_ROSTER_MISSING", "E1/E3");
  return {
    accepted: true, reason: "AUTHENTIC_POLITICAL_RECEIPT_AND_ROSTER",
    receiptTick: receipt.tick, sequence: receipt.sequence,
  };
}

/** An acceptance transition must remain current for BOTH viewer sessions. */
export function corroboratePublicEmpire({
  emperor, recipient, empireId, leaderId, memberIds, minTick,
}) {
  if (!emperor || !recipient || emperor.gameId !== recipient.gameId ||
      emperor.actorId === recipient.actorId ||
      !validTick(minTick))
    return fail("POLITICAL_CROSS_VIEW_SESSION_INVALID", "E2/E4");
  for (const view of [emperor, recipient]) {
    if (!validTick(view.politicsTick) || view.politicsTick < minTick)
      return fail("POLITICAL_CROSS_VIEW_STALE_ROSTER", "E3");
    const empires = view.empires;
    const row = Array.isArray(empires)
      ? empires.find(e => e?.id === empireId) : null;
    if (!row || row.leaderId !== leaderId ||
        !Array.isArray(row.memberIds) ||
        !memberIds.every(m => row.memberIds.includes(m)))
      return fail("POLITICAL_CROSS_VIEW_ROSTER_MISMATCH", "E1/E3");
  }
  return {accepted:true,reason:"SAME_CANONICAL_ROSTER_IN_BOTH_VIEWS"};
}

/** Release summaries may contain counters and step labels, never private DTOs. */
export function sanitizePacketEvidence(packets) {
  if (!Array.isArray(packets)) return [];
  return packets.slice(-240).map(p => ({
    sequence: validTick(p?.sequence) ? p.sequence : null,
    tick: validTick(p?.tick) ? p.tick : null,
    hasPublicPolitics: !!p?.publicPolitics,
    hasCurrentConflicts: !!p?.publicConflicts,
    hasRecipientAccessionView: !!p?.accessionOffers,
    commandResultCount: Array.isArray(p?.commandResults)
      ? p.commandResults.length : 0,
    hasAuthoritativeAttackDelta: p?.hasAuthoritativeAttackDelta === true,
    hasAuthoritativeMotion: p?.hasAuthoritativeMotion === true,
    hasTerritoryDelta: p?.hasTerritoryDelta === true,
  }));
}

/**
 * E6-publishable failure and event projection: report no player names,
 * invitation packets, command nonces, fog, browser body text or live secrets.
 */
export function safeFailureCode(value) {
  const message = String(value ?? "");
  if (message.includes("REAL_CHROMIUM_GPU_REQUIRED"))
    return "REAL_CHROMIUM_GPU_REQUIRED: WebGL gate";
  if (/Timed out/i.test(message)) return "TIMED_OUT: authoritative evidence";
  const owned = message.match(/(?:[A-Z][A-Z0-9]{1,25}_){1,12}[A-Z0-9]{2,45}/);
  if (owned) return owned[0].slice(0,128);
  return "UNCLASSIFIED_ACCEPTANCE_FAILURE";
}
const booleanFields = new Set([
  "accepted","uiConfirmed","verified","sourceOnly","spawned",
  "inSpawnPhase","paused","initiallyExpanded","viaCdp",
  "recipientOnly","secondAuthenticatedSession","originatingOfferReceiptMatched",
  "differentPrincipal","realCdpInput","founderRosterAgrees",
  "formerEmperorRevoked","successorIsDifferentPrincipal",
  "warEndedInBothViews","targetMatch","enabled","targetCorrelated",
  "actorCorrelated","recipientCorrelated","observedEngineChange",
  "authenticPublicRoster","unobstructed",
]);
const numericFields = new Set([
  "elapsedMs","tick","tickBefore","tickAfter","receiptTick",
  "sequence","attempt","packetCount","assetRequests","restrictedAssets",
  "unobstructedInputs","observedPackets","matchedJournal","matchedView",
  "requestCount","stageCount",
]);
const textFields = new Set([
  "name","stage","label","source","input","type","reason",
  "classification","owner","requestFingerprint",
]);
export function sanitizeAcceptanceEvent(event) {
  if (!event || typeof event !== "object") return null;
  const out = {};
  for (const [key,val] of Object.entries(event)) {
    if (booleanFields.has(key) && typeof val === "boolean")
      out[key] = val;
    else if (numericFields.has(key) && validTick(val))
      out[key] = val;
    else if (textFields.has(key) && typeof val === "string" &&
             /^[A-Za-z0-9_:. -]{1,128}$/.test(val))
      out[key] = val;
    else if (key === "error")
      out.error = safeFailureCode(val);
  }
  return out.name ? out : null;
}
