/**
 * The single GameImpl-owned per-principal NATIONAL journal and human sight
 * memory. Both are saved in GameSnapshot v4; neither is public game state.
 *
 * E1 owns persistence and authority. E3 owns collecting observations and
 * deciding which verified principal receives an outbound packet.
 */
import type { PlayerID } from "@openfront/engine-api/game/GameTypes";
import { z } from "zod";
import type {
  LastKnownAsset,
  NationalSightMemory,
} from "../observation/NationalObservation";

const identity = z.string().min(1).max(256);
const tick = z.number().int().nonnegative();
const politicalCommandKind = z.enum([
  "offer-empire",
  "accept-empire",
  "transfer-crown",
  "set-national-peace-delegation",
  "found-pact",
  "invite-pact",
  "accept-pact",
  "propose-pact-amendment",
  "approve-pact-amendment",
  "betray-pact",
  "expel-pact",
]);
export type NationalPoliticalCommandKind = z.infer<typeof politicalCommandKind>;
const warCommandKind = z.enum([
  "national_declare_war",
  "national_propose_peace",
  "national_accept_peace",
]);
export type NationalWarCommandKind = z.infer<typeof warCommandKind>;
const warReason = z.enum([
  "accepted",
  "actor-inactive",
  "invalid-war-command",
  "war-rule",
]);
export type NationalWarCommandReason = z.infer<typeof warReason>;
const commandOutcome = z.object({
  sequence: tick,
  requestId: identity,
  actorId: identity,
  empireId: z.string().max(256),
  /** Absent means legacy Found Empire; one canonical receipt list for ALL commands. */
  commandKind: z.union([politicalCommandKind, warCommandKind]).optional(),
  commandTargetId: identity.optional(),
  /** Private canonical payload identity; never included in recipient results. */
  commandFingerprint: z.string().min(1).max(4096).optional(),
  /** WAR receipts are delivered to the authenticated initiating principal. */
  recipientId: identity.optional(),
  /** Safe engine-owned references, only present for accepted WAR commands. */
  warId: identity.optional(),
  motionId: identity.optional(),
  tick,
  accepted: z.boolean(),
  reason: z.enum([
    "accepted",
    "actor-inactive",
    "invalid-empire-id",
    "political-rule",
    "invalid-war-command",
    "war-rule",
  ]),
});
export type NationalFoundEmpireResult = z.infer<typeof commandOutcome>;
export type NationalWarCommandOutcome = {
  sequence: number;
  requestId: string;
  actorId: string;
  /** E3 must match this to the authenticated receiving player, never broadcast. */
  recipientId: string;
  commandKind: NationalWarCommandKind;
  commandTargetId: string;
  tick: number;
  accepted: boolean;
  reason: NationalWarCommandReason;
  warId?: string;
  motionId?: string;
};
export type NationalPoliticalCommandResult = Omit<
  NationalFoundEmpireResult,
  "commandFingerprint" | "commandKind" | "commandTargetId" | "recipientId"
> & {
  /** Authenticated request owner, not the proposed accession invitee. */
  recipientId: string;
  commandKind: NationalPoliticalCommandKind;
  commandTargetId: string;
};

/** Private journal internals never cross to E3's recipient-facing port. */
function politicalResultView(
  result: NationalFoundEmpireResult,
): NationalPoliticalCommandResult {
  if (
    result.commandKind === undefined ||
    result.commandTargetId === undefined ||
    (result.recipientId !== undefined && result.recipientId !== result.actorId)
  )
    throw new Error("NATIONAL journal: missing political result identity");
  return {
    sequence: result.sequence,
    requestId: result.requestId,
    actorId: result.actorId,
    recipientId: result.recipientId ?? result.actorId,
    empireId: result.empireId,
    commandKind: politicalCommandKind.parse(result.commandKind),
    commandTargetId: result.commandTargetId,
    tick: result.tick,
    accepted: result.accepted,
    reason: result.reason,
  };
}

/** Only public-safe data from the shared private journal is exposed to E3. */
function warResultView(
  result: NationalFoundEmpireResult,
): NationalWarCommandOutcome {
  if (
    result.commandTargetId === undefined ||
    result.recipientId === undefined ||
    result.recipientId !== result.actorId
  )
    throw new Error("NATIONAL journal: invalid WAR outcome recipient");
  return {
    sequence: result.sequence,
    requestId: result.requestId,
    actorId: result.actorId,
    recipientId: result.recipientId,
    commandKind: warCommandKind.parse(result.commandKind),
    commandTargetId: result.commandTargetId,
    tick: result.tick,
    accepted: result.accepted,
    reason: warReason.parse(result.reason),
    ...(result.warId === undefined ? {} : { warId: result.warId }),
    ...(result.motionId === undefined ? {} : { motionId: result.motionId }),
  };
}
const asset = z.object({
  id: identity,
  ownerId: identity,
  kind: z.enum(["army", "structure", "warship", "transport", "trade-ship"]),
  x: tick,
  y: tick,
  lastSeenTick: tick,
  sourceNationId: identity.optional(),
});
const memory = z.object({
  observerId: identity,
  assets: z.array(asset).max(4096),
});
export const NationalGovernanceSnapshotSchema = z.object({
  version: z.literal(1),
  nextSequence: tick,
  /** Last 128 results for E3 recipient delivery. */
  results: z.array(commandOutcome).max(128),
  /** Immutable request receipts for the match lifetime; never silently evict. */
  receipts: z.array(commandOutcome).max(16_384),
  /** One authoritative memory record per verified human principal. */
  memories: z.array(memory).max(1024),
});
export type NationalGovernanceSnapshot = z.infer<
  typeof NationalGovernanceSnapshotSchema
>;

export type FoundEmpireReason =
  | "accepted"
  | "actor-inactive"
  | "invalid-empire-id"
  | "political-rule";
export const NATIONAL_RESULT_RETENTION = 128;
/** Hard lifetime admission limit, NOT a sliding replay window. */
export const NATIONAL_REQUEST_RETENTION = 16_384;
export const NATIONAL_SIGHT_RETENTION_TICKS = 60;

export class NationalGovernanceState {
  private nextSequence = 0;
  private results: NationalFoundEmpireResult[] = [];
  private receipts: NationalFoundEmpireResult[] = [];
  /** Index over SAME canonical receipts, never a second command journal. */
  private readonly receiptIndex = new Map<string, NationalFoundEmpireResult>();
  private readonly memories = new Map<PlayerID, NationalSightMemory>();

  /**
   * A request ID is unique across the entire authoritative Game.
   * On exact replay, do not execute the founder transition a second time.
   * Actor/empire mismatch for the same request ID rejects as a forgery.
   */
  recordFoundEmpire(
    actorId: PlayerID,
    empireId: string,
    gameTick: number,
    suppliedRequestId: string | null,
    perform: () => FoundEmpireReason,
  ): NationalFoundEmpireResult {
    return this.recordCommand(
      actorId,
      empireId,
      gameTick,
      suppliedRequestId,
      perform,
      null,
    );
  }

  /** The SAME receipts and sequence used by Found Empire; no second ledger. */
  recordPoliticalCommand(
    actorId: PlayerID,
    commandKind: NationalPoliticalCommandKind,
    targetId: string,
    gameTick: number,
    suppliedRequestId: string | null,
    commandFingerprint: string,
    perform: () => FoundEmpireReason,
    mayReplayAccepted?: () => boolean,
  ): NationalPoliticalCommandResult {
    return politicalResultView(
      this.recordCommand(
        actorId,
        targetId,
        gameTick,
        suppliedRequestId,
        perform,
        commandKind,
        commandFingerprint,
        null,
        mayReplayAccepted,
      ),
    );
  }

  /** WAR/peace joins the SAME sequence, request receipts, and GameSnapshot. */
  recordWarCommand(
    actorId: PlayerID,
    commandKind: NationalWarCommandKind,
    targetId: string,
    gameTick: number,
    suppliedRequestId: string | null,
    commandFingerprint: string,
    references: { warId?: string; motionId?: string },
    perform: () => NationalWarCommandReason,
    mayReplayAccepted?: () => boolean,
  ): NationalWarCommandOutcome {
    return warResultView(
      this.recordCommand(
        actorId,
        targetId,
        gameTick,
        suppliedRequestId,
        perform,
        commandKind,
        commandFingerprint,
        { recipientId: actorId, ...references },
        mayReplayAccepted,
      ),
    );
  }

  private recordCommand(
    actorId: PlayerID,
    empireId: string,
    gameTick: number,
    suppliedRequestId: string | null,
    perform: () => NationalFoundEmpireResult["reason"],
    commandKind: NationalPoliticalCommandKind | NationalWarCommandKind | null,
    commandFingerprint: string | null = null,
    warReferences: {
      recipientId: string;
      warId?: string;
      motionId?: string;
    } | null = null,
    mayReplayAccepted?: () => boolean,
  ): NationalFoundEmpireResult {
    if (
      commandKind !== null &&
      (commandFingerprint === null ||
        commandFingerprint.length < 1 ||
        commandFingerprint.length > 4096)
    )
      throw new Error("NATIONAL journal: invalid command payload identity");
    if (warReferences !== null) {
      warCommandKind.parse(commandKind);
      identity.parse(warReferences.recipientId);
      if (warReferences.recipientId !== actorId)
        throw new Error("NATIONAL command journal: mismatched WAR recipient");
      if (warReferences.warId !== undefined)
        identity.parse(warReferences.warId);
      if (warReferences.motionId !== undefined)
        identity.parse(warReferences.motionId);
    }
    if (!Number.isSafeInteger(gameTick) || gameTick < 0)
      throw new Error("NATIONAL command journal: invalid tick");
    identity.parse(actorId);
    let requestId =
      suppliedRequestId ?? `auto:${gameTick}:${this.nextSequence}`;
    identity.parse(requestId);
    // Explicit caller tokens and legacy auto-generated IDs share one journal.
    // An adversary could otherwise preclaim the next predictable auto token
    // and suppress a different actor's legitimate legacy founding command.
    // Skip retained collisions deterministically; NEVER reinterpret an
    // explicit duplicate, which must still be idempotent or rejected.
    if (suppliedRequestId === null) {
      while (this.receiptIndex.has(requestId)) {
        if (this.nextSequence === Number.MAX_SAFE_INTEGER)
          throw new Error("NATIONAL command journal: sequence exhausted");
        requestId = `auto:${gameTick}:${++this.nextSequence}`;
      }
    }
    const existing = this.receiptIndex.get(requestId);
    if (existing) {
      if (
        existing.actorId !== actorId ||
        existing.empireId !== empireId ||
        (existing.commandKind ?? null) !== commandKind ||
        (existing.commandFingerprint ?? null) !== commandFingerprint
      )
        throw new Error("NATIONAL command journal: reused foreign request ID");
      // A once-accepted response is NOT a transferable authorization token.
      // Check the incumbent sovereign using the Game-owned political/WAR
      // state before returning it. Do not mutate or replace old receipts.
      if (existing.accepted && mayReplayAccepted && !mayReplayAccepted())
        throw new Error("NATIONAL: stale sovereign replay authority");
      return { ...existing };
    }
    if (this.nextSequence === Number.MAX_SAFE_INTEGER)
      throw new Error("NATIONAL command journal: sequence exhausted");
    // A full journal fails CLOSED. Never forget an accepted WAR/peace token:
    // after a sliding-window eviction, a settled war could be redeclared by
    // the same old client request with a new engine-generated war ID.
    if (this.receipts.length >= NATIONAL_REQUEST_RETENTION)
      throw new Error("NATIONAL command journal: lifetime request cap reached");
    const reason = perform();
    const result: NationalFoundEmpireResult = {
      sequence: this.nextSequence++,
      requestId,
      actorId,
      empireId,
      ...(commandKind === null
        ? {}
        : {
            commandKind,
            commandTargetId: empireId,
            commandFingerprint: commandFingerprint!,
            // All non-founder receipts are private to the initiating actor;
            // accession invitees learn offers through an independent, filtered
            // read port, not by receiving another player's command receipt.
            recipientId: actorId,
          }),
      ...(warReferences === null
        ? {}
        : {
            recipientId: warReferences.recipientId,
            ...(reason === "accepted"
              ? {
                  ...(warReferences.warId === undefined
                    ? {}
                    : { warId: warReferences.warId }),
                  ...(warReferences.motionId === undefined
                    ? {}
                    : { motionId: warReferences.motionId }),
                }
              : {}),
          }),
      tick: gameTick,
      accepted: reason === "accepted",
      reason,
    };
    commandOutcome.parse(result);
    this.results.push(result);
    this.receipts.push(result);
    this.receiptIndex.set(requestId, result);
    this.results = this.results.slice(-NATIONAL_RESULT_RETENTION);
    return { ...result };
  }

  /** Recipient-facing; unknown or different principals have no access. */
  resultsFor(actorId: PlayerID): readonly NationalFoundEmpireResult[] {
    return this.results
      .filter((r) => r.actorId === actorId && r.commandKind === undefined)
      .map((r) => ({ ...r }));
  }

  /** Private constitutional/political results, excluding WAR receipts. */
  politicalResultsFor(
    actorId: PlayerID,
  ): readonly NationalPoliticalCommandResult[] {
    return this.results
      .filter(
        (r) =>
          r.actorId === actorId &&
          politicalCommandKind.safeParse(r.commandKind).success,
      )
      .map((r) => politicalResultView(r));
  }

  /** Private WAR results, excluding founding and constitutional receipts. */
  warResultsFor(actorId: PlayerID): readonly NationalWarCommandOutcome[] {
    return this.results
      .filter(
        (r) =>
          r.actorId === actorId &&
          warCommandKind.safeParse(r.commandKind).success,
      )
      .map((r) => warResultView(r));
  }

  /**
   * Only verified GameImpl observer IDs enter here. The validator is the
   * *current* live reciprocal empire-membership check, never a saved grant.
   */
  writeMemory(
    principal: PlayerID,
    raw: NationalSightMemory,
    gameTick: number,
    mayInheritFrom: (sourceId: PlayerID) => boolean,
  ): void {
    identity.parse(principal);
    const accepted = memory.parse(raw);
    if (accepted.observerId !== principal)
      throw new Error("NATIONAL sight: wrong observer principal");
    const seen = new Set<string>();
    for (const entry of accepted.assets) {
      if (seen.has(entry.id) || entry.lastSeenTick > gameTick)
        throw new Error("NATIONAL sight: duplicate or future observation");
      seen.add(entry.id);
      if (
        entry.sourceNationId !== undefined &&
        entry.sourceNationId !== principal &&
        !mayInheritFrom(entry.sourceNationId)
      ) {
        throw new Error("NATIONAL sight: no current empire intelligence grant");
      }
    }
    this.memories.set(principal, {
      observerId: principal,
      assets: accepted.assets.map((x) => ({ ...x })),
    });
  }

  /** Remove expired and newly unauthorized shared sightings from saved truth. */
  revokeMemory(
    gameTick: number,
    isCurrentHuman: (observerId: PlayerID) => boolean,
    mayInherit: (observerId: PlayerID, sourceId: PlayerID) => boolean,
  ): void {
    for (const [observerId, remembered] of this.memories) {
      if (!isCurrentHuman(observerId)) {
        this.memories.delete(observerId);
        continue;
      }
      const retained = remembered.assets.filter(
        (item) =>
          item.lastSeenTick <= gameTick &&
          gameTick - item.lastSeenTick <= NATIONAL_SIGHT_RETENTION_TICKS &&
          (item.sourceNationId === undefined ||
            item.sourceNationId === observerId ||
            mayInherit(observerId, item.sourceNationId)),
      );
      this.memories.set(observerId, {
        observerId,
        assets: retained.map((asset) => ({ ...asset })),
      });
    }
  }

  readMemory(observerId: PlayerID): NationalSightMemory | null {
    const record = this.memories.get(observerId);
    return record
      ? {
          observerId: record.observerId,
          assets: record.assets.map((asset) => ({ ...asset })),
        }
      : null;
  }

  snapshot(): NationalGovernanceSnapshot {
    return NationalGovernanceSnapshotSchema.parse({
      version: 1,
      nextSequence: this.nextSequence,
      results: this.results,
      receipts: this.receipts,
      memories: [...this.memories.values()].sort((a, b) =>
        a.observerId < b.observerId ? -1 : a.observerId > b.observerId ? 1 : 0,
      ),
    });
  }

  /**
   * Full validation before state replacement. The caller then calls revoke
   * against ACTUAL restored Game identities and current empire membership.
   */
  restore(raw: unknown, gameTick: number): void {
    const saved = NationalGovernanceSnapshotSchema.parse(raw);
    const requests = new Set<string>();
    const sequences = new Set<number>();
    let largest = -1;
    for (const receipt of saved.receipts) {
      if (
        requests.has(receipt.requestId) ||
        sequences.has(receipt.sequence) ||
        receipt.tick > gameTick ||
        receipt.sequence >= saved.nextSequence ||
        receipt.accepted !== (receipt.reason === "accepted") ||
        (receipt.commandKind !== undefined &&
          (receipt.commandTargetId !== receipt.empireId ||
            receipt.commandFingerprint === undefined)) ||
        (receipt.commandKind === undefined &&
          (receipt.commandTargetId !== undefined ||
            receipt.commandFingerprint !== undefined))
      )
        throw new Error("NATIONAL journal: invalid or future receipt");
      const isWar = warCommandKind.safeParse(receipt.commandKind).success;
      const isPolitical = politicalCommandKind.safeParse(
        receipt.commandKind,
      ).success;
      if (
        (isWar &&
          (receipt.recipientId !== receipt.actorId ||
            !warReason.safeParse(receipt.reason).success ||
            (receipt.accepted &&
              (receipt.warId === undefined ||
                (receipt.commandKind === "national_propose_peace" &&
                  receipt.motionId === undefined) ||
                (receipt.commandKind === "national_accept_peace" &&
                  receipt.motionId === undefined))) ||
            (!receipt.accepted &&
              (receipt.warId !== undefined ||
                receipt.motionId !== undefined)) ||
            (receipt.commandKind === "national_declare_war" &&
              receipt.motionId !== undefined))) ||
        (!isWar &&
          (receipt.warId !== undefined ||
            receipt.motionId !== undefined ||
            (isPolitical
              ? receipt.recipientId !== undefined &&
                receipt.recipientId !== receipt.actorId
              : receipt.recipientId !== undefined)))
      )
        throw new Error("NATIONAL journal: invalid WAR receipt");
      requests.add(receipt.requestId);
      sequences.add(receipt.sequence);
      largest = Math.max(largest, receipt.sequence);
    }
    if (
      largest >= saved.nextSequence ||
      saved.results.some(
        (entry) =>
          !saved.receipts.some(
            (r) =>
              r.requestId === entry.requestId &&
              JSON.stringify(r) === JSON.stringify(entry),
          ),
      )
    )
      throw new Error("NATIONAL journal: inconsistent results");
    const seen = new Set<string>();
    for (const row of saved.memories) {
      if (seen.has(row.observerId))
        throw new Error("NATIONAL sight: duplicate principal");
      seen.add(row.observerId);
      const assetIds = new Set<string>();
      for (const item of row.assets) {
        if (assetIds.has(item.id) || item.lastSeenTick > gameTick)
          throw new Error("NATIONAL sight: invalid restored asset");
        assetIds.add(item.id);
      }
    }
    this.nextSequence = saved.nextSequence;
    this.results = saved.results.map((r) => ({ ...r }));
    this.receipts = saved.receipts.map((r) => ({ ...r }));
    this.receiptIndex.clear();
    for (const receipt of this.receipts)
      this.receiptIndex.set(receipt.requestId, receipt);
    this.memories.clear();
    for (const record of saved.memories)
      this.memories.set(record.observerId, {
        observerId: record.observerId,
        assets: record.assets.map((a) => ({ ...a })) as LastKnownAsset[],
      });
  }
}
