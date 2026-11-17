/**
 * E3 outbound adapter for E1's actual, bounded per-actor command journal.
 * Never infer success from a queued intent, client payload, or local roster.
 * E1 owns acceptance/rejection and persistence; E2 owns wire DTO types.
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
  readonly empireId: string;
  readonly reason: string;
}

/**
 * Result stream is never read by requested ID. The caller must resolve the
 * current authenticated principal first, and E1 rechecks the actual Player.
 */
export function actorNationalResults(
  game: Game,
  actor: Player,
  afterSequence: number,
): {
  readonly latestSequence: number;
  readonly results: readonly OutboundFounderResult[];
} {
  const read = (game as JournalGame).nationalCommandResults;
  if (typeof read !== "function") {
    return { latestSequence: afterSequence, results: [] };
  }
  const journal = read.call(game, actor);
  let latestSequence = afterSequence;
  const results: OutboundFounderResult[] = [];
  for (const record of journal) {
    if (record.actorId !== actor.id()) continue;
    if (
      !Number.isSafeInteger(record.sequence) ||
      record.sequence < 0 ||
      !Number.isSafeInteger(record.tick) ||
      record.tick < 0 ||
      record.tick > game.ticks()
    ) {
      throw new Error("NATIONAL invalid authoritative outcome sequence");
    }
    if (record.sequence <= afterSequence) continue;
    latestSequence = Math.max(latestSequence, record.sequence);
    results.push({
      recipientId: actor.id(),
      actorId: actor.id(),
      type: "national_found_empire",
      accepted: record.accepted,
      tick: record.tick,
      empireId: record.empireId,
      // E1 only supplies bounded, whitelisted reason enum values.
      reason: record.reason,
    });
  }
  return { latestSequence, results };
}

/** Reconnect starts with actual political state, NOT stale approval toast. */
export function currentNationalResultCursor(game: Game, actor: Player): number {
  return actorNationalResults(game, actor, -1).latestSequence;
}
