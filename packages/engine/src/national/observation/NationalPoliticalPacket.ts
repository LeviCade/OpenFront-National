/**
 * Worker-bound projection of E1's authenticated, versioned Found Empire
 * journal. Only E1 knows command success. The browser's requested target,
 * pending intent, public roster or a previous command's acceptance are never
 * command receipts.
 *
 * E3 owns per-runner delivery, not political results or persistent journals.
 */
import type { Game, Player } from "../../game/Game";

interface AuthoritativeFounderOutcome {
  readonly sequence: number;
  readonly requestId: string;
  readonly actorId: string;
  readonly empireId: string;
  readonly accepted: boolean;
  readonly tick: number;
  readonly reason: string;
}

type JournalGame = Game & {
  nationalCommandResults?: (
    actor: Player,
  ) => readonly AuthoritativeFounderOutcome[];
};

export interface OutboundFounderResult {
  readonly recipientId: string;
  readonly actorId: string;
  readonly type: "national_found_empire";
  readonly accepted: boolean;
  readonly tick: number;
  /** Exact E1 receipt. Required to match one specific UI click. */
  readonly sequence: number;
  readonly requestId: string;
  readonly empireId: string;
  readonly reason: string;
}

/**
 * Tracks deliveries by BOTH authoritative sequence and opaque requestId.
 * A highest-sequence-only cursor drops a delayed result when the transport
 * returns journal entries out of order. This state is per authenticated
 * GameRunner principal, never globally shared or persisted as game truth.
 */
export interface NationalResultDeliveryState {
  readonly seenSequences: Map<number, string>;
  readonly seenRequests: Map<string, number>;
  /** Detect contradictory accepted/rejected payloads for the same receipt. */
  readonly seenProofs: Map<number, string>;
  maxSequence: number;
}

// E1 retains 128 journal events; keep four windows to tolerate reordering
// without growing a per-runner set forever. Older events are not fresh UI
// acknowledgements, even if a corrupted journal resurrects them.
const RESULT_REORDER_WINDOW = 512;
const VALID_REASONS = new Set([
  "accepted",
  "actor-inactive",
  "invalid-empire-id",
  "political-rule",
]);

function validRecord(
  record: AuthoritativeFounderOutcome,
  game: Game,
): void {
  if (
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 0 ||
    !Number.isSafeInteger(record.tick) ||
    record.tick < 0 ||
    record.tick > game.ticks() ||
    typeof record.requestId !== "string" ||
    record.requestId.length < 1 ||
    record.requestId.length > 256 ||
    typeof record.empireId !== "string" ||
    record.empireId.length > 256 ||
    typeof record.actorId !== "string" ||
    record.actorId.length < 1 ||
    record.actorId.length > 256 ||
    typeof record.accepted !== "boolean" ||
    !VALID_REASONS.has(record.reason) ||
    record.accepted !== (record.reason === "accepted")
  ) {
    throw new Error("NATIONAL invalid authoritative founder receipt");
  }
}

function readActorJournal(
  game: Game,
  actor: Player,
): readonly AuthoritativeFounderOutcome[] {
  const read = (game as JournalGame).nationalCommandResults;
  if (typeof read !== "function") return [];
  // The caller resolves actor from the current runner clientID; E1 checks
  // that this is its actual registered Player object, not a forged ID.
  return read.call(game, actor);
}

export function emptyNationalResultDeliveryState(): NationalResultDeliveryState {
  return {
    seenSequences: new Map(),
    seenRequests: new Map(),
    seenProofs: new Map(),
    maxSequence: -1,
  };
}

/**
 * Reconnect/restore: already journaled outcomes must not create a new toast.
 * The public roster is restored independently from E1 political state.
 */
export function initialNationalResultDeliveryState(
  game: Game,
  actor: Player,
): NationalResultDeliveryState {
  const state = emptyNationalResultDeliveryState();
  void actorNationalResults(game, actor, state);
  return state;
}

/**
 * Project only the authenticated actor's real E1 results. Validate a complete
 * journal batch BEFORE any output or delivery cursor changes, then sort it by
 * E1's monotonic sequence. Exact duplicate receipts are idempotent; different
 * receipts sharing either sequence or requestId are rejected fail-closed.
 */
export function actorNationalResults(
  game: Game,
  actor: Player,
  state: NationalResultDeliveryState,
): readonly OutboundFounderResult[] {
  const journal = readActorJournal(game, actor);
  const ordered: AuthoritativeFounderOutcome[] = [];
  const batchSequences = new Map<number, string>();
  const batchRequests = new Map<string, number>();
  const batchProofs = new Map<number, string>();

  for (const record of journal) {
    // E1's resultsFor(actor) already scopes the journal. Recheck here so a
    // future engine change cannot send a foreign actor's private receipt.
    if (record.actorId !== actor.id()) continue;
    validRecord(record, game);
    const proof = JSON.stringify([
      record.sequence,
      record.requestId,
      record.actorId,
      record.empireId,
      record.accepted,
      record.tick,
      record.reason,
    ]);
    const existingSequence = batchSequences.get(record.sequence);
    const existingRequest = batchRequests.get(record.requestId);
    if (
      (existingSequence !== undefined &&
        existingSequence !== record.requestId) ||
      (existingRequest !== undefined &&
        existingRequest !== record.sequence) ||
      (batchProofs.has(record.sequence) &&
        batchProofs.get(record.sequence) !== proof)
    ) {
      throw new Error("NATIONAL conflicting authoritative founder receipts");
    }
    // A duplicated exact receipt in one read is still a single response.
    if (existingSequence !== undefined) continue;
    batchSequences.set(record.sequence, record.requestId);
    batchRequests.set(record.requestId, record.sequence);
    batchProofs.set(record.sequence, proof);
    ordered.push(record);
  }
  ordered.sort((a, b) => a.sequence - b.sequence);

  // Validate against the prior delivery state without mutating it on
  // conflict. An old (already expired) journal sequence may not re-announce
  // a stale acceptance after a very long reconnect/session.
  for (const record of ordered) {
    const usedRequest = state.seenRequests.get(record.requestId);
    const usedSequence = state.seenSequences.get(record.sequence);
    if (
      (usedRequest !== undefined && usedRequest !== record.sequence) ||
      (usedSequence !== undefined && usedSequence !== record.requestId) ||
      (state.seenProofs.has(record.sequence) &&
        state.seenProofs.get(record.sequence) !==
          batchProofs.get(record.sequence))
    ) {
      throw new Error("NATIONAL conflicting delivered founder receipt");
    }
  }

  const results: OutboundFounderResult[] = [];
  for (const record of ordered) {
    if (
      record.sequence <= state.maxSequence - RESULT_REORDER_WINDOW ||
      state.seenSequences.has(record.sequence) ||
      state.seenRequests.has(record.requestId)
    ) {
      continue;
    }
    results.push({
      recipientId: actor.id(),
      actorId: actor.id(),
      type: "national_found_empire",
      accepted: record.accepted,
      tick: record.tick,
      sequence: record.sequence,
      requestId: record.requestId,
      empireId: record.empireId,
      // E1's bounded reason enum, never raw engine exception text.
      reason: record.reason,
    });
    state.seenSequences.set(record.sequence, record.requestId);
    state.seenRequests.set(record.requestId, record.sequence);
    state.seenProofs.set(record.sequence, batchProofs.get(record.sequence)!);
    state.maxSequence = Math.max(state.maxSequence, record.sequence);
  }

  const floor = state.maxSequence - RESULT_REORDER_WINDOW;
  for (const [seq, requestId] of state.seenSequences) {
    if (seq > floor) continue;
    state.seenSequences.delete(seq);
    state.seenRequests.delete(requestId);
    state.seenProofs.delete(seq);
  }
  return results;
}
