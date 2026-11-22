/**
 * Read-only NATIONAL projection adapter for authenticated game packets.
 *
 * No client-created empire registry. The engine owns every leadership and
 * membership change. The UI displays nothing as confirmed before it receives
 * an actual worker/GameRunner projection.
 *
 * E1/E3 packet contract: GameUpdateViewData.nationalPolitics is a complete
 * PUBLIC projection every NATIONAL tick; nationalCommandResults contains the
 * current viewer's accepted/rejected commands. It must be filtered upstream.
 */
import { readNationalPublicPacts, type NationalPublicPactView } from "@openfront/engine-api/game/NationalPactView";

export interface NationalPublicEmpire {
  id: string;
  leaderId: string;
  memberIds: readonly string[];
}

export interface NationalUngovernableWarning {
  empireId: string;
  deadlineMs: number;
  remainingMs: number;
  blockedByAssetDisposition: boolean;
}

export interface NationalPublicPolitics {
  pacts?: readonly NationalPublicPactView[];
  empires: readonly NationalPublicEmpire[];
  warnings: readonly NationalUngovernableWarning[];
}

export interface NationalFoundingResult {
  type: "national_found_empire";
  actorId: string;
  /** E2 wire: recipient is bound to the authoritative viewer. */
  recipientId: string;
  empireId: string;
  accepted: boolean;
  /** Deterministic engine tick; never inferred from UI dispatch. */
  tick?: number;
  reason?: string;
  requestId?: string;
  /** E1's monotonically increasing authoritative journal receipt. */
  sequence?: number;
}

/** E3 must send the authenticated recipient's invitations separately from the
 * public roster. An absent packet is UNKNOWN, not an empty invitation list. */
export interface NationalAccessionOffer {
  readonly empireId: string;
  readonly candidateId: string;
  readonly proposerId: string;
  readonly recipientId: string;
}

export interface NationalAccessionView {
  readonly version: 1;
  readonly recipientId: string;
  readonly offers: readonly NationalAccessionOffer[];
}

export type NationalPoliticalAction =
  | "national_offer_empire"
  | "national_accept_empire"
  | "national_transfer_crown";

export interface NationalPoliticalResult {
  readonly type: NationalPoliticalAction;
  readonly actorId: string;
  readonly recipientId: string;
  readonly commandTargetId: string;
  readonly accepted: boolean;
  readonly tick: number;
  readonly sequence: number;
  readonly requestId: string;
  readonly reason: string;
}

const EMPIRE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FOUNDING_REQUEST_ID = /^nf_[0-9a-f]{32}$/;

/** Opaque 128-bit ID for ONE user click. No clock/counter/Math.random fallback. */
export function createNationalFoundingRequestId(): string {
  const random = globalThis.crypto?.getRandomValues;
  if (typeof random !== "function") {
    throw new Error("Secure request identity is unavailable.");
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `nf_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Each actual accession/crown click has a fresh cryptographic receipt ID. */
export function createNationalPoliticalRequestId(): string {
  if (typeof globalThis.crypto?.getRandomValues !== "function")
    throw new Error("Secure political request identity is unavailable.");
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `np_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Distinct 128-bit opaque token for ONE NATIONAL WAR/peace click. */
export function createNationalDiplomacyRequestId(): string {
  const random = globalThis.crypto?.getRandomValues;
  if (typeof random !== "function")
    throw new Error("Secure diplomacy request identity is unavailable.");
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `nc_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function validNationalFoundingRequestId(
  value: unknown,
): value is string {
  return typeof value === "string" && FOUNDING_REQUEST_ID.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validEmpireId(id: string): boolean {
  return EMPIRE_ID.test(id);
}

/** Fail closed on malformed or absent game packets; never synthesize a roster. */
export function readNationalPolitics(
  source: unknown,
): NationalPublicPolitics | null {
  if (!record(source) || !Array.isArray(source.empires)) return null;
  const empires: NationalPublicEmpire[] = [];
  const seen = new Set<string>();
  const members = new Set<string>();
  for (const empire of source.empires) {
    if (
      !record(empire) ||
      typeof empire.id !== "string" ||
      !validEmpireId(empire.id) ||
      seen.has(empire.id) ||
      typeof empire.leaderId !== "string" ||
      !Array.isArray(empire.memberIds) ||
      empire.memberIds.length === 0 ||
      !empire.memberIds.every(
        (id: unknown) => typeof id === "string" && id.length > 0,
      ) ||
      !empire.memberIds.includes(empire.leaderId)
    ) {
      return null;
    }
    for (const id of empire.memberIds as string[]) {
      if (members.has(id)) return null;
      members.add(id);
    }
    seen.add(empire.id);
    empires.push({
      id: empire.id,
      leaderId: empire.leaderId,
      memberIds: [...empire.memberIds],
    });
  }
  const warnings: NationalUngovernableWarning[] = [];
  if (source.warnings !== undefined) {
    if (!Array.isArray(source.warnings)) return null;
    const warningIds = new Set<string>();
    for (const warning of source.warnings) {
      if (
        !record(warning) ||
        typeof warning.empireId !== "string" ||
        !seen.has(warning.empireId) ||
        warningIds.has(warning.empireId) ||
        typeof warning.blockedByAssetDisposition !== "boolean" ||
        typeof warning.deadlineMs !== "number" ||
        !Number.isSafeInteger(warning.deadlineMs) ||
        warning.deadlineMs < 0 ||
        typeof warning.remainingMs !== "number" ||
        !Number.isSafeInteger(warning.remainingMs) ||
        warning.remainingMs < 0
      ) {
        return null;
      }
      warningIds.add(warning.empireId);
      warnings.push({
        empireId: warning.empireId,
        deadlineMs: warning.deadlineMs,
        remainingMs: warning.remainingMs,
        blockedByAssetDisposition: warning.blockedByAssetDisposition,
      });
    }
  }
  const pacts = source.pacts === undefined ? undefined : readNationalPublicPacts(source.pacts);
  if (pacts === null || pacts?.some(pact=>pact.memberIds.some(id=>members.has(id)))) return null;
  return { empires, warnings, ...(pacts === undefined ? {} : {pacts}) };
}

/** Reject the WHOLE invitation projection if it is missing, foreign,
 * malformed or duplicated. A sender may never read an invitee's offers. */
export function readNationalAccessionOffers(
  source: unknown,
  authenticatedActorId: string | null,
): NationalAccessionView | null {
  if (
    !authenticatedActorId ||
    !record(source) ||
    source.version !== 1 ||
    source.recipientId !== authenticatedActorId ||
    !Array.isArray(source.offers) ||
    source.offers.length > 256
  )
    return null;
  const offers: NationalAccessionOffer[] = [];
  const seen = new Set<string>();
  for (const item of source.offers) {
    if (
      !record(item) ||
      typeof item.empireId !== "string" ||
      !validEmpireId(item.empireId) ||
      typeof item.candidateId !== "string" ||
      !validNationalWarReference(item.candidateId) ||
      (item.candidateId !== authenticatedActorId &&
        item.proposerId !== item.candidateId) ||
      item.recipientId !== authenticatedActorId ||
      typeof item.proposerId !== "string" ||
      !validNationalWarReference(item.proposerId)
    )
      return null;
    const key = item.empireId + ":" + item.candidateId;
    if (seen.has(key)) return null;
    seen.add(key);
    offers.push({
      empireId: item.empireId,
      candidateId: item.candidateId,
      proposerId: item.proposerId,
      recipientId: authenticatedActorId,
    });
  }
  return { version: 1, recipientId: authenticatedActorId, offers };
}

/** Only exact actor-private E1 journal receipts; never infer from UI dispatch. */
export function readNationalPoliticalResults(
  source: unknown,
  authenticatedActorId: string | null,
): NationalPoliticalResult[] {
  if (!authenticatedActorId || !Array.isArray(source)) return [];
  const results: NationalPoliticalResult[] = [];
  for (const item of source) {
    if (
      !record(item) ||
      (item.type !== "national_offer_empire" &&
        item.type !== "national_accept_empire" &&
        item.type !== "national_transfer_crown") ||
      item.actorId !== authenticatedActorId ||
      item.recipientId !== authenticatedActorId ||
      typeof item.commandTargetId !== "string" ||
      !validNationalWarReference(item.commandTargetId) ||
      typeof item.accepted !== "boolean" ||
      !Number.isSafeInteger(item.tick) ||
      (item.tick as number) < 0 ||
      !Number.isSafeInteger(item.sequence) ||
      (item.sequence as number) < 0 ||
      typeof item.requestId !== "string" ||
      !/^np_[0-9a-f]{32}$/.test(item.requestId) ||
      (item.reason !== "accepted" &&
        item.reason !== "actor-inactive" &&
        item.reason !== "political-rule") ||
      item.accepted !== (item.reason === "accepted")
    )
      continue;
    results.push({
      type: item.type,
      actorId: authenticatedActorId,
      recipientId: authenticatedActorId,
      commandTargetId: item.commandTargetId,
      accepted: item.accepted,
      tick: item.tick as number,
      sequence: item.sequence as number,
      requestId: item.requestId,
      reason: item.reason,
    });
  }
  return results;
}

/** A short recipient-only window survives slow HUD refresh, not disconnect. */
export function retainNationalPoliticalResults(
  previous: readonly NationalPoliticalResult[],
  received: readonly NationalPoliticalResult[],
  tick: number,
  reset: boolean,
): readonly NationalPoliticalResult[] {
  const retained = new Map<string, NationalPoliticalResult>();
  for (const result of [...(reset ? [] : previous), ...received]) {
    if (result.tick > tick || result.tick < tick - 240) continue;
    retained.set(
      `${result.actorId}:${result.requestId}:${result.sequence}:${result.type}:${result.commandTargetId}:${result.accepted}:${result.tick}`,
      result,
    );
  }
  return [...retained.values()].slice(-32);
}

export function readNationalFoundingResults(
  source: unknown,
): NationalFoundingResult[] {
  if (!Array.isArray(source)) return [];
  const results: NationalFoundingResult[] = [];
  for (const item of source) {
    if (
      !record(item) ||
      item.type !== "national_found_empire" ||
      typeof item.actorId !== "string" ||
      typeof item.recipientId !== "string" ||
      item.recipientId !== item.actorId ||
      typeof item.empireId !== "string" ||
      !validEmpireId(item.empireId) ||
      typeof item.accepted !== "boolean"
    ) {
      continue;
    }
    results.push({
      type: "national_found_empire",
      actorId: item.actorId,
      recipientId: item.recipientId,
      empireId: item.empireId,
      accepted: item.accepted,
      ...(typeof item.tick === "number" &&
      Number.isSafeInteger(item.tick) &&
      item.tick >= 0
        ? { tick: item.tick }
        : {}),
      ...(typeof item.requestId === "string" &&
      item.requestId.length > 0 &&
      item.requestId.length <= 256
        ? { requestId: item.requestId }
        : {}),
      ...(typeof item.sequence === "number" &&
      Number.isSafeInteger(item.sequence) &&
      item.sequence >= 0
        ? { sequence: item.sequence }
        : {}),
      ...(typeof item.reason === "string"
        ? { reason: item.reason.slice(0, 240) }
        : {}),
    });
  }
  return results;
}

export function empireForMember(
  politics: NationalPublicPolitics | null,
  memberId: string,
): NationalPublicEmpire | null {
  return (
    politics?.empires.find((empire) => empire.memberIds.includes(memberId)) ??
    null
  );
}

/**
 * UI-side eligibility only. The authenticated engine is the final authority,
 * and it rechecks all political prerequisites at execution time.
 */
export function foundingUnavailableReason(state: {
  national: boolean;
  solo: boolean;
  trustedPrivate?: boolean;
  replay: boolean;
  spawned: boolean;
  alive: boolean;
  spectator: boolean;
  memberEmpire: NationalPublicEmpire | null;
  pending: boolean;
}): string | null {
  if (
    !state.national ||
    !(state.solo || state.trustedPrivate) ||
    state.replay
  ) {
    return "Empire founding requires a live authorized NATIONAL match.";
  }
  if (!state.spawned) return "Spawn before founding an empire.";
  if (!state.alive || state.spectator) {
    return "Only an active, living nation can found an empire.";
  }
  if (state.memberEmpire) {
    return "Your nation already belongs to an empire.";
  }
  if (state.pending) return "A founding command is awaiting game confirmation.";
  return null;
}

/**
 * NATIONAL WAR/peace UI is legal only for an active, spawned, authenticated
 * Solo principal with a current public political projection. An event bus
 * dispatch is never an authoritative accepted outcome.
 */
export function nationalWarActionUnavailableReason(state: {
  national: boolean;
  solo: boolean;
  trustedPrivate?: boolean;
  replay: boolean;
  spawned: boolean;
  alive: boolean;
  spectator: boolean;
  hasPublicPolitics: boolean;
}): string | null {
  if (!state.national || !(state.solo || state.trustedPrivate) || state.replay)
    return "War and peace require a live authorized NATIONAL match.";
  if (!state.spawned) return "Spawn before issuing diplomacy commands.";
  if (!state.alive || state.spectator)
    return "Only a living, active nation may issue diplomacy commands.";
  if (!state.hasPublicPolitics)
    return "Awaiting current authoritative NATIONAL political state.";
  return null;
}

/** Engine IDs may contain colon-separated deterministic ordinals. */
export function validNationalWarReference(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 256 &&
    !Array.from(value).some((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

/**
 * E3's optional, per-authenticated-recipient public WAR/peace projection.
 * This is NOT a WAR ledger or a client-derived snapshot. A missing, stale,
 * partial, foreign or malformed packet provides no evidence of execution.
 */
export interface NationalConflictSide {
  readonly kind: "nation" | "empire";
  readonly id: string;
}
export interface NationalPublicWarLayer {
  readonly id: string;
  readonly scope: "national" | "imperial";
  readonly first: NationalConflictSide;
  readonly second: NationalConflictSide;
  readonly declaredBy: string;
  readonly startedTick: number;
  readonly endedTick: number | null;
}
export interface NationalPublicPeaceMotion {
  readonly id: string;
  readonly layerId: string;
  readonly proposedBy: string;
  readonly proposingSide: 0 | 1;
  readonly proposedTick: number;
  readonly acceptedTick: number | null;
  readonly acceptedBy: string | null;
}
export interface NationalPublicConflicts {
  readonly version: 1;
  readonly recipientId: string;
  readonly layers: readonly NationalPublicWarLayer[];
  readonly motions: readonly NationalPublicPeaceMotion[];
}

function validConflictSide(value: unknown): value is NationalConflictSide {
  return (
    record(value) &&
    (value.kind === "nation" || value.kind === "empire") &&
    typeof value.id === "string" &&
    validNationalWarReference(value.id)
  );
}

/** Validate the COMPLETE E3 DTO before exposing even one war or motion. */
export function readNationalConflicts(
  source: unknown,
  authenticatedActorId: string | null,
  packetTick?: number,
): NationalPublicConflicts | null {
  if (
    !authenticatedActorId ||
    (packetTick !== undefined &&
      (!Number.isSafeInteger(packetTick) || packetTick < 0)) ||
    !record(source) ||
    source.version !== 1 ||
    source.recipientId !== authenticatedActorId ||
    !Array.isArray(source.layers) ||
    !Array.isArray(source.motions) ||
    source.layers.length > 512 ||
    source.motions.length > 512
  )
    return null;
  const layers: NationalPublicWarLayer[] = [];
  const seenLayers = new Set<string>();
  for (const row of source.layers) {
    if (
      !record(row) ||
      typeof row.id !== "string" ||
      !validNationalWarReference(row.id) ||
      seenLayers.has(row.id) ||
      (row.scope !== "national" && row.scope !== "imperial") ||
      !validConflictSide(row.first) ||
      !validConflictSide(row.second) ||
      (row.first.kind === row.second.kind && row.first.id === row.second.id) ||
      (row.scope === "national" &&
        (row.first.kind !== "nation" || row.second.kind !== "nation")) ||
      (row.scope === "imperial" &&
        row.first.kind !== "empire" &&
        row.second.kind !== "empire") ||
      typeof row.declaredBy !== "string" ||
      !validNationalWarReference(row.declaredBy) ||
      !Number.isSafeInteger(row.startedTick) ||
      (row.startedTick as number) < 0 ||
      (packetTick !== undefined && (row.startedTick as number) > packetTick) ||
      (row.endedTick !== null &&
        (!Number.isSafeInteger(row.endedTick) ||
          (row.endedTick as number) < (row.startedTick as number) ||
          (packetTick !== undefined && (row.endedTick as number) > packetTick)))
    )
      return null;
    seenLayers.add(row.id);
    layers.push({
      id: row.id,
      scope: row.scope,
      first: { ...row.first },
      second: { ...row.second },
      declaredBy: row.declaredBy,
      startedTick: row.startedTick as number,
      endedTick: row.endedTick as number | null,
    });
  }
  const motions: NationalPublicPeaceMotion[] = [];
  const seenMotions = new Set<string>();
  for (const row of source.motions) {
    if (
      !record(row) ||
      typeof row.id !== "string" ||
      !validNationalWarReference(row.id) ||
      seenMotions.has(row.id) ||
      typeof row.layerId !== "string" ||
      !seenLayers.has(row.layerId) ||
      typeof row.proposedBy !== "string" ||
      !validNationalWarReference(row.proposedBy) ||
      (row.proposingSide !== 0 && row.proposingSide !== 1) ||
      !Number.isSafeInteger(row.proposedTick) ||
      (row.proposedTick as number) < 0 ||
      (packetTick !== undefined && (row.proposedTick as number) > packetTick) ||
      (row.acceptedTick !== null &&
        (!Number.isSafeInteger(row.acceptedTick) ||
          (row.acceptedTick as number) < (row.proposedTick as number) ||
          (packetTick !== undefined &&
            (row.acceptedTick as number) > packetTick))) ||
      (row.acceptedBy !== null &&
        (typeof row.acceptedBy !== "string" ||
          !validNationalWarReference(row.acceptedBy))) ||
      (row.acceptedTick === null) !== (row.acceptedBy === null)
    )
      return null;
    const layer = layers.find((entry) => entry.id === row.layerId)!;
    if (
      (row.proposedTick as number) < layer.startedTick ||
      (row.acceptedTick !== null && row.acceptedTick !== layer.endedTick)
    )
      return null;
    seenMotions.add(row.id);
    motions.push({
      id: row.id,
      layerId: row.layerId,
      proposedBy: row.proposedBy,
      proposingSide: row.proposingSide,
      proposedTick: row.proposedTick as number,
      acceptedTick: row.acceptedTick as number | null,
      acceptedBy: row.acceptedBy as string | null,
    });
  }
  return { version: 1, recipientId: authenticatedActorId, layers, motions };
}

export interface NationalDiplomacyAttempt {
  readonly commandType: NationalDiplomacyResult["type"];
  readonly actorId: string;
  readonly issuedTick: number;
  readonly scope?: "national" | "imperial";
  readonly ownEmpireId?: string;
  readonly targetKind?: "nation" | "empire";
  readonly targetId?: string;
  readonly warId?: string;
  readonly motionId?: string;
}

/** Reconcile a REAL accepted journal result with the SAME current public state. */
export function confirmedNationalDiplomacy(
  attempt: NationalDiplomacyAttempt,
  result: NationalDiplomacyResult,
  projection: NationalPublicConflicts | null,
  projectionTick: number | null,
): string | null {
  if (
    !result.accepted ||
    result.actorId !== attempt.actorId ||
    result.recipientId !== attempt.actorId ||
    result.type !== attempt.commandType ||
    result.tick < attempt.issuedTick ||
    projection === null ||
    projection.recipientId !== attempt.actorId ||
    projectionTick === null ||
    projectionTick < result.tick
  )
    return null;
  const layer = projection.layers.find((item) => item.id === result.warId);
  if (!layer) return null;
  if (attempt.commandType === "national_declare_war") {
    if (
      layer.endedTick !== null ||
      layer.startedTick < attempt.issuedTick ||
      layer.startedTick > result.tick ||
      layer.scope !== attempt.scope ||
      layer.declaredBy !== attempt.actorId ||
      layer.second.id !== attempt.targetId ||
      layer.second.kind !== attempt.targetKind ||
      (attempt.scope === "national" &&
        (layer.first.kind !== "nation" ||
          layer.first.id !== attempt.actorId)) ||
      (attempt.scope === "imperial" &&
        (layer.first.kind !== "empire" ||
          layer.first.id !== attempt.ownEmpireId))
    )
      return null;
    return `War confirmed by game: ${layer.id} is active.`;
  }
  if (!result.motionId) return null;
  const motion = projection.motions.find((item) => item.id === result.motionId);
  if (!motion || motion.layerId !== layer.id) return null;
  if (attempt.commandType === "national_propose_peace") {
    if (
      attempt.warId !== layer.id ||
      motion.proposedBy !== attempt.actorId ||
      motion.proposedTick < attempt.issuedTick ||
      motion.proposedTick > result.tick
    )
      return null;
    return `Peace proposal confirmed by game: motion ${motion.id} for war ${layer.id}.`;
  }
  if (
    attempt.commandType === "national_accept_peace" &&
    attempt.motionId === motion.id &&
    motion.acceptedBy === attempt.actorId &&
    motion.acceptedTick !== null &&
    motion.acceptedTick >= attempt.issuedTick &&
    motion.acceptedTick <= result.tick &&
    layer.endedTick === motion.acceptedTick
  )
    return `Peace accepted by game: war layer ${layer.id} ended. Other war layers may remain active.`;
  return null;
}

/** E1/E3 recipient-scoped WAR/peace outcomes, NEVER inferred from intent enqueue. */
export interface NationalDiplomacyResult {
  readonly type:
    | "national_declare_war"
    | "national_propose_peace"
    | "national_accept_peace";
  readonly actorId: string;
  readonly recipientId: string;
  readonly accepted: boolean;
  readonly tick: number;
  readonly sequence: number;
  readonly requestId: string;
  readonly warId?: string;
  readonly motionId?: string;
  readonly reason?: string;
}

const DIPLOMACY_REQUEST_ID = /^nc_[0-9a-f]{32}$/;

/** Strictly reject uncorrelated, malformed or foreign-looking receipts. */
export function readNationalDiplomacyResults(
  source: unknown,
): NationalDiplomacyResult[] {
  if (!Array.isArray(source)) return [];
  const results: NationalDiplomacyResult[] = [];
  for (const entry of source) {
    if (
      !record(entry) ||
      ![
        "national_declare_war",
        "national_propose_peace",
        "national_accept_peace",
      ].includes(String(entry.type)) ||
      typeof entry.actorId !== "string" ||
      entry.actorId.length === 0 ||
      typeof entry.recipientId !== "string" ||
      entry.recipientId !== entry.actorId ||
      typeof entry.accepted !== "boolean" ||
      typeof entry.requestId !== "string" ||
      !DIPLOMACY_REQUEST_ID.test(entry.requestId) ||
      !Number.isSafeInteger(entry.sequence) ||
      (entry.sequence as number) < 0 ||
      !Number.isSafeInteger(entry.tick) ||
      (entry.tick as number) < 0 ||
      (entry.warId !== undefined &&
        (typeof entry.warId !== "string" ||
          !validNationalWarReference(entry.warId))) ||
      (entry.motionId !== undefined &&
        (typeof entry.motionId !== "string" ||
          !validNationalWarReference(entry.motionId))) ||
      (entry.reason !== undefined && typeof entry.reason !== "string")
    )
      continue;
    results.push({
      type: entry.type as NationalDiplomacyResult["type"],
      actorId: entry.actorId,
      recipientId: entry.recipientId,
      accepted: entry.accepted,
      tick: entry.tick as number,
      sequence: entry.sequence as number,
      requestId: entry.requestId,
      ...(typeof entry.warId === "string" ? { warId: entry.warId } : {}),
      ...(typeof entry.motionId === "string"
        ? { motionId: entry.motionId }
        : {}),
      ...(typeof entry.reason === "string"
        ? { reason: entry.reason.slice(0, 240) }
        : {}),
    });
  }
  return results;
}

/** Brief client-only retention compensates for one-shot worker delivery. */
export function retainNationalDiplomacyResults(
  previous: readonly NationalDiplomacyResult[],
  received: readonly NationalDiplomacyResult[],
  tick: number,
  reset: boolean,
): readonly NationalDiplomacyResult[] {
  const entries = new Map<string, NationalDiplomacyResult>();
  for (const result of [...(reset ? [] : previous), ...received]) {
    if (result.tick > tick || result.tick < tick - 240) continue;
    const key = [
      result.actorId,
      result.recipientId,
      result.requestId,
      result.sequence,
      result.type,
      result.tick,
      result.accepted,
      result.reason ?? "",
      result.warId ?? "",
      result.motionId ?? "",
    ].join(":");
    entries.set(key, result);
  }
  return [...entries.values()].slice(-32);
}

/** Session-scoped, UI-only request bookkeeping. Never a political projection. */
export interface NationalFoundingAttempt {
  /** Must be the exact opaque request token placed on the engine intent. */
  readonly requestId: string;
  readonly gameId: string;
  readonly actorId: string;
  readonly empireId: string;
  readonly issuedTick: number;
  readonly acceptedResultSeen: boolean;
}

export type NationalFoundingDecision =
  | { phase: "pending"; acceptedResultSeen: boolean }
  | { phase: "accepted"; acceptedResultSeen: true }
  | { phase: "rejected"; reason: string; acceptedResultSeen: boolean }
  | { phase: "unknown"; reason: string; acceptedResultSeen: boolean };

/**
 * A matching accepted command AND same-empire authoritative membership are
 * required to display "founding confirmed". A roster alone (e.g. restore)
 * proves membership, never that THIS button press was accepted.
 *
 * Reject journal entries from another game/player, stale previous attempts,
 * rewound replay ticks or a different empire. A rejected command is final.
 */
export function reconcileNationalFounding(
  attempt: NationalFoundingAttempt,
  view: {
    gameId: string;
    actorId: string;
    tick: number;
    politics: NationalPublicPolitics | null;
    results: readonly NationalFoundingResult[];
  },
): NationalFoundingDecision {
  if (
    view.gameId !== attempt.gameId ||
    view.actorId !== attempt.actorId ||
    view.tick < attempt.issuedTick
  ) {
    return {
      phase: "unknown",
      reason: "The game session changed. Founding was not confirmed.",
      acceptedResultSeen: attempt.acceptedResultSeen,
    };
  }

  // Exact receipt matching is mandatory. E1 journals requestId+sequence;
  // an unrelated same-tick command, even with the same actor and empire,
  // must never accept or reject THIS click.
  const matches = view.results.filter(
    (entry) =>
      entry.requestId === attempt.requestId &&
      typeof entry.sequence === "number" &&
      Number.isSafeInteger(entry.sequence) &&
      entry.sequence >= 0 &&
      entry.actorId === attempt.actorId &&
      entry.recipientId === attempt.actorId &&
      entry.empireId === attempt.empireId &&
      typeof entry.tick === "number" &&
      // GameImpl journals during tick T and increments before packet T+1.
      entry.tick >= attempt.issuedTick &&
      entry.tick <= view.tick,
  );
  const outcome = matches[0];
  if (
    matches.some(
      (entry) =>
        entry.sequence !== outcome.sequence ||
        entry.accepted !== outcome.accepted ||
        entry.tick !== outcome.tick ||
        entry.reason !== outcome.reason,
    )
  ) {
    return {
      phase: "unknown",
      reason:
        "The game returned inconsistent founding receipts. No result was confirmed.",
      acceptedResultSeen: false,
    };
  }
  if (outcome?.accepted === false) {
    return {
      phase: "rejected",
      reason: outcome.reason ?? "The game rejected empire founding.",
      acceptedResultSeen: false,
    };
  }
  const acceptedResultSeen =
    attempt.acceptedResultSeen || outcome?.accepted === true;
  const member = empireForMember(view.politics, attempt.actorId);
  if (
    acceptedResultSeen &&
    member?.id === attempt.empireId &&
    member.leaderId === attempt.actorId
  ) {
    return { phase: "accepted", acceptedResultSeen: true };
  }
  // Missing/invalid packets are NOT evidence of acceptance or rejection.
  if (view.tick - attempt.issuedTick >= 200) {
    return {
      phase: "unknown",
      reason:
        "No final founding confirmation arrived. Check the verified empire roster before retrying.",
      acceptedResultSeen,
    };
  }
  return { phase: "pending", acceptedResultSeen };
}

/** Retain E3 one-shot results while slower HUD controllers refresh. */
export function retainNationalFoundingReceipts(
  previous: readonly NationalFoundingResult[],
  received: readonly NationalFoundingResult[],
  tick: number,
  reset: boolean,
): readonly NationalFoundingResult[] {
  const seen = new Map<string, NationalFoundingResult>();
  for (const result of [...(reset ? [] : previous), ...received]) {
    if (
      typeof result.tick !== "number" ||
      result.tick > tick ||
      result.tick < tick - 240
    ) {
      continue;
    }
    seen.set(
      `${result.actorId}:${result.recipientId}:${result.requestId ?? "missing"}:${result.sequence ?? "missing"}:${result.empireId}:${result.tick}:${result.accepted}:${result.reason ?? "none"}`,
      result,
    );
  }
  return [...seen.values()].slice(-32);
}
