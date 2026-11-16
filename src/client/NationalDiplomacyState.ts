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

export interface NationalPublicPolitics {
  empires: readonly NationalPublicEmpire[];
}

export interface NationalFoundingResult {
  type: "national_found_empire";
  actorId: string;
  empireId: string;
  accepted: boolean;
  reason?: string;
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
  return { empires };
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
      typeof item.empireId !== "string" ||
      !validEmpireId(item.empireId) ||
      typeof item.accepted !== "boolean"
    ) {
      continue;
    }
    results.push({
      type: "national_found_empire",
      actorId: item.actorId,
      empireId: item.empireId,
      accepted: item.accepted,
      ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
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
