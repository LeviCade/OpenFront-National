/**
 * Worker-bound projection of E1's authenticated, versioned NATIONAL
 * journal. Only E1 knows command success. The browser's requested target,
 * pending intent, public roster or a previous command's acceptance are never
 * command receipts.
 *
 * E3 owns per-runner delivery, not political results or persistent journals.
 */
import type { Game, Player } from "../../game/Game";

/** E1's ONE Game-owned journal. The new command-specific ports are filtered
 * views of the same persistent sequence space, not independent authorities. */
interface AuthoritativeFounderOutcome {
  readonly sequence: number;
  readonly requestId: string;
  readonly actorId: string;
  readonly empireId?: string;
  readonly accepted: boolean;
  readonly tick: number;
  readonly reason: string;
  readonly commandKind?:
    | NationalPoliticalKind
    | NationalWarKind
    | "national_declare_war"
    | "national_propose_peace"
    | "national_accept_peace";
  /** E1 WAR results have an explicit independent authenticated recipient. */
  readonly recipientId?: string;
  /** E1 may use a typed result name or command kind on the WAR read port. */
  readonly kind?: NationalWarKind;
  readonly type?:
    | "national_declare_war"
    | "national_propose_peace"
    | "national_accept_peace";
  readonly commandTargetId?: string;
  readonly warId?: string;
  readonly motionId?: string;
}

const POLITICAL_TYPES = {
  "offer-empire": "national_offer_empire",
  "accept-empire": "national_accept_empire",
  "transfer-crown": "national_transfer_crown",
  "found-pact": "national_found_pact",
  "invite-pact": "national_invite_pact",
  "accept-pact": "national_accept_pact",
  "propose-pact-amendment": "national_propose_pact_amendment",
  "approve-pact-amendment": "national_approve_pact_amendment",
  "betray-pact": "national_betray_pact",
  "expel-pact": "national_expel_pact",
} as const;
const WAR_TYPES = {
  "declare-national": "national_declare_war",
  "declare-imperial": "national_declare_war",
  "propose-peace": "national_propose_peace",
  "accept-peace": "national_accept_peace",
} as const;
type NationalPoliticalKind = keyof typeof POLITICAL_TYPES;
type NationalWarKind = keyof typeof WAR_TYPES;
type NationalResultType =
  | "national_found_empire"
  | (typeof POLITICAL_TYPES)[NationalPoliticalKind]
  | (typeof WAR_TYPES)[NationalWarKind];
const WAR_REQUEST = /^[A-Za-z0-9_-]{1,128}$/;
const safeId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  !Array.from(value).some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127;
  });

type JournalGame = Game & {
  nationalCommandResults?: (
    actor: Player,
  ) => readonly AuthoritativeFounderOutcome[];
  nationalPoliticalCommandResults?: (
    actor: Player,
  ) => readonly AuthoritativeFounderOutcome[];
  /** Optional until E1's real WAR/peace outcome port lands. Never synthetic. */
  nationalWarCommandResults?: (
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

/** Actor-private E1 outcomes. Every field is explicitly allowed for its type.
 * E2 owns the engine-api schema extension for non-founding political types. */
export interface OutboundOtherResult {
  readonly recipientId: string;
  readonly actorId: string;
  readonly type: Exclude<NationalResultType, "national_found_empire">;
  readonly accepted: boolean;
  readonly tick: number;
  readonly sequence: number;
  readonly requestId: string;
  readonly reason: string;
  readonly commandTargetId?: string;
  readonly warId?: string;
  readonly motionId?: string;
}

export type OutboundNationalResult = OutboundFounderResult | OutboundOtherResult;

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
  "invalid-war-command",
  "war-rule",
]);

function validRecord(record: AuthoritativeFounderOutcome, game: Game): void {
  if (
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 0 ||
    !Number.isSafeInteger(record.tick) ||
    record.tick < 0 ||
    record.tick > game.ticks() ||
    typeof record.requestId !== "string" ||
    record.requestId.length < 1 ||
    record.requestId.length > 256 ||
    (record.recipientId !== undefined && !safeId(record.recipientId)) ||
    (record.empireId !== undefined &&
      (typeof record.empireId !== "string" ||
        record.empireId.length > 256)) ||
    (record.commandKind === undefined && !safeId(record.empireId)) ||
    (record.commandKind !== undefined &&
      Object.prototype.hasOwnProperty.call(WAR_TYPES, record.commandKind) &&
      !safeId(record.recipientId)) ||
    (record.commandKind !== undefined &&
      !Object.prototype.hasOwnProperty.call(
        POLITICAL_TYPES,
        record.commandKind,
      ) &&
      !Object.prototype.hasOwnProperty.call(WAR_TYPES, record.commandKind)) ||
    (record.commandKind !== undefined &&
      Object.prototype.hasOwnProperty.call(POLITICAL_TYPES, record.commandKind) &&
      !safeId(record.commandTargetId)) ||
    (record.commandTargetId !== undefined &&
      !safeId(record.commandTargetId)) ||
    (record.warId !== undefined && !safeId(record.warId)) ||
    (record.motionId !== undefined && !safeId(record.motionId)) ||
    (record.accepted &&
      (record.commandKind === "declare-national" ||
        record.commandKind === "declare-imperial") &&
      !safeId(record.warId)) ||
    (record.accepted &&
      record.commandKind === "propose-peace" &&
      (!safeId(record.warId) || !safeId(record.motionId))) ||
    (record.accepted &&
      record.commandKind === "accept-peace" &&
      (!safeId(record.warId) || !safeId(record.motionId))) ||
    typeof record.actorId !== "string" ||
    record.actorId.length < 1 ||
    record.actorId.length > 256 ||
    typeof record.accepted !== "boolean" ||
    !VALID_REASONS.has(record.reason) ||
    (record.commandKind === undefined &&
      !["accepted", "actor-inactive", "invalid-empire-id", "political-rule"].includes(
        record.reason,
      )) ||
    (record.commandKind !== undefined &&
      Object.prototype.hasOwnProperty.call(POLITICAL_TYPES, record.commandKind) &&
      !["accepted", "actor-inactive", "political-rule"].includes(record.reason)) ||
    (record.commandKind !== undefined &&
      Object.prototype.hasOwnProperty.call(WAR_TYPES, record.commandKind) &&
      (![
        "accepted",
        "actor-inactive",
        "invalid-war-command",
        "war-rule",
      ].includes(record.reason) ||
        (!record.accepted &&
          (record.warId !== undefined || record.motionId !== undefined)) ||
        ((record.commandKind === "declare-national" ||
          record.commandKind === "declare-imperial") &&
          record.motionId !== undefined))) ||
    record.accepted !== (record.reason === "accepted")
  ) {
    throw new Error("NATIONAL invalid authoritative founder receipt");
  }
}

function readActorJournal(
  game: Game,
  actor: Player,
): readonly AuthoritativeFounderOutcome[] {
  const source = game as JournalGame;
  // All three methods are E1-owned filtered reads of ONE journal. A separate
  // WAR method is optional until E1 integrates it; absence means NO receipt.
  // The caller resolves actor from the actual registered clientID.
  const war = typeof source.nationalWarCommandResults === "function"
    ? source.nationalWarCommandResults(actor)
    : [];
  return [
    ...(typeof source.nationalCommandResults === "function"
      ? source.nationalCommandResults(actor)
      : []),
    ...(typeof source.nationalPoliticalCommandResults === "function"
      ? source.nationalPoliticalCommandResults(actor)
      : []),
    ...war.map((record) => {
      // Normalize only explicit authoritative E1 WAR result types. No type is
      // derived from a public conflict or a client-submitted command.
      const sourceKind = record.commandKind ?? record.kind ?? record.type;
      const kind =
        sourceKind === "national_declare_war"
          ? "declare-national"
          : sourceKind === "national_propose_peace"
            ? "propose-peace"
            : sourceKind === "national_accept_peace"
              ? "accept-peace"
              : sourceKind;
      if (
        record.kind !== undefined &&
        record.commandKind !== undefined &&
        record.kind !== record.commandKind
      )
        throw new Error("NATIONAL contradictory authoritative WAR kind");
      return { ...record, commandKind: kind };
    }),
  ];
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
): readonly OutboundNationalResult[] {
  const journal = readActorJournal(game, actor);
  const ordered: AuthoritativeFounderOutcome[] = [];
  const batchSequences = new Map<number, string>();
  const batchRequests = new Map<string, number>();
  const batchProofs = new Map<number, string>();

  for (const record of journal) {
    // E1's resultsFor(actor) already scopes the journal. Recheck here so a
    // future engine change cannot send a foreign actor's private receipt.
    if (record.actorId !== actor.id()) continue;
    if (
      record.recipientId !== undefined &&
      record.recipientId !== actor.id()
    )
      continue;
    validRecord(record, game);
    const proof = JSON.stringify([
      record.sequence,
      record.requestId,
      record.actorId,
      record.recipientId ?? null,
      record.empireId,
      record.accepted,
      record.tick,
      record.reason,
      record.commandKind ?? null,
      record.commandTargetId ?? null,
      record.warId ?? null,
      record.motionId ?? null,
    ]);
    const existingSequence = batchSequences.get(record.sequence);
    const existingRequest = batchRequests.get(record.requestId);
    if (
      (existingSequence !== undefined &&
        existingSequence !== record.requestId) ||
      (existingRequest !== undefined && existingRequest !== record.sequence) ||
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

  const results: OutboundNationalResult[] = [];
  for (const record of ordered) {
    if (
      record.sequence <= state.maxSequence - RESULT_REORDER_WINDOW ||
      state.seenSequences.has(record.sequence) ||
      state.seenRequests.has(record.requestId)
    ) {
      continue;
    }
    const base = {
      recipientId: actor.id(),
      actorId: actor.id(),
      accepted: record.accepted,
      tick: record.tick,
      sequence: record.sequence,
      requestId: record.requestId,
      // E1's bounded reason enum, never raw engine exception text.
      reason: record.reason,
    };
    if (record.commandKind === undefined) {
      results.push({
        ...base,
        type: "national_found_empire",
        empireId: record.empireId!,
      });
    } else if (
      Object.prototype.hasOwnProperty.call(WAR_TYPES, record.commandKind)
    ) {
      // WAR receipts only correlate to E2-issued tokens, never E1's auto:
      // journal IDs. Every war/motion ref MUST come from E1, not the roster.
      if (WAR_REQUEST.test(record.requestId)) {
        const kind = record.commandKind as NationalWarKind;
        results.push({
          ...base,
          type: WAR_TYPES[kind],
          ...(record.warId === undefined ? {} : { warId: record.warId }),
          ...(record.motionId === undefined ? {} : { motionId: record.motionId }),
        });
      }
    } else {
      const kind = record.commandKind as NationalPoliticalKind;
      results.push({
        ...base,
        type: POLITICAL_TYPES[kind],
        commandTargetId: record.commandTargetId,
      });
    }
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
