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
}

const EMPIRE_ID = /^[A-Za-z0-9_-]{1,64}$/;

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
  return { empires, warnings };
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
      ...(typeof item.requestId === "string" && item.requestId.length > 0
        ? { requestId: item.requestId }
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
  replay: boolean;
  spawned: boolean;
  alive: boolean;
  spectator: boolean;
  memberEmpire: NationalPublicEmpire | null;
  pending: boolean;
}): string | null {
  if (!state.national || !state.solo || state.replay) {
    return "Empire founding is available only in a live NATIONAL Solo game.";
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

/** Session-scoped, UI-only request bookkeeping. Never a political projection. */
export interface NationalFoundingAttempt {
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

  const outcome = view.results.find(
    (entry) =>
      entry.actorId === attempt.actorId &&
      entry.recipientId === attempt.actorId &&
      entry.empireId === attempt.empireId &&
      typeof entry.tick === "number" &&
      entry.tick > attempt.issuedTick &&
      entry.tick <= view.tick,
  );
  if (outcome?.accepted === false) {
    return {
      phase: "rejected",
      reason: outcome.reason ?? "The game rejected empire founding.",
      acceptedResultSeen: attempt.acceptedResultSeen,
    };
  }
  const acceptedResultSeen = attempt.acceptedResultSeen ||
    outcome?.accepted === true;
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
      reason: "No final founding confirmation arrived. Check the verified empire roster before retrying.",
      acceptedResultSeen,
    };
  }
  return { phase: "pending", acceptedResultSeen };
}
