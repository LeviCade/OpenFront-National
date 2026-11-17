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
  "found-pact",
  "invite-pact",
  "accept-pact",
  "propose-pact-amendment",
  "approve-pact-amendment",
  "betray-pact",
  "expel-pact",
]);
export type NationalPoliticalCommandKind = z.infer<typeof politicalCommandKind>;
const commandOutcome = z.object({
  sequence: tick,
  requestId: identity,
  actorId: identity,
  empireId: z.string().max(256),
  /** Absent means legacy Found Empire; one canonical receipt list for ALL commands. */
  commandKind: politicalCommandKind.optional(),
  commandTargetId: identity.optional(),
  tick,
  accepted: z.boolean(),
  reason: z.enum([
    "accepted",
    "actor-inactive",
    "invalid-empire-id",
    "political-rule",
  ]),
});
export type NationalFoundEmpireResult = z.infer<typeof commandOutcome>;
export type NationalPoliticalCommandResult = NationalFoundEmpireResult & {
  commandKind: NationalPoliticalCommandKind;
  commandTargetId: string;
};
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
  /** Last 1024 request receipts enforce retry idempotence. */
  receipts: z.array(commandOutcome).max(1024),
  /** One authoritative memory record per verified human principal. */
  memories: z.array(memory).max(1024),
});
export type NationalGovernanceSnapshot = z.infer<
  typeof NationalGovernanceSnapshotSchema
>;

export type FoundEmpireReason = NationalFoundEmpireResult["reason"];
export const NATIONAL_RESULT_RETENTION = 128;
export const NATIONAL_REQUEST_RETENTION = 1024;
export const NATIONAL_SIGHT_RETENTION_TICKS = 60;

export class NationalGovernanceState {
  private nextSequence = 0;
  private results: NationalFoundEmpireResult[] = [];
  private receipts: NationalFoundEmpireResult[] = [];
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
    perform: () => FoundEmpireReason,
  ): NationalPoliticalCommandResult {
    return this.recordCommand(
      actorId,
      targetId,
      gameTick,
      suppliedRequestId,
      perform,
      commandKind,
    ) as NationalPoliticalCommandResult;
  }

  private recordCommand(
    actorId: PlayerID,
    empireId: string,
    gameTick: number,
    suppliedRequestId: string | null,
    perform: () => FoundEmpireReason,
    commandKind: NationalPoliticalCommandKind | null,
  ): NationalFoundEmpireResult {
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
      while (this.receipts.some((r) => r.requestId === requestId)) {
        if (this.nextSequence === Number.MAX_SAFE_INTEGER)
          throw new Error("NATIONAL command journal: sequence exhausted");
        requestId = `auto:${gameTick}:${++this.nextSequence}`;
      }
    }
    const existing = this.receipts.find((r) => r.requestId === requestId);
    if (existing) {
      if (
        existing.actorId !== actorId ||
        existing.empireId !== empireId ||
        (existing.commandKind ?? null) !== commandKind
      )
        throw new Error("NATIONAL command journal: reused foreign request ID");
      return { ...existing };
    }
    if (this.nextSequence === Number.MAX_SAFE_INTEGER)
      throw new Error("NATIONAL command journal: sequence exhausted");
    const reason = perform();
    const result: NationalFoundEmpireResult = {
      sequence: this.nextSequence++,
      requestId,
      actorId,
      empireId,
      ...(commandKind === null
        ? {}
        : { commandKind, commandTargetId: empireId }),
      tick: gameTick,
      accepted: reason === "accepted",
      reason,
    };
    commandOutcome.parse(result);
    this.results.push(result);
    this.receipts.push(result);
    this.results = this.results.slice(-NATIONAL_RESULT_RETENTION);
    this.receipts = this.receipts.slice(-NATIONAL_REQUEST_RETENTION);
    return { ...result };
  }

  /** Recipient-facing; unknown or different principals have no access. */
  resultsFor(actorId: PlayerID): readonly NationalFoundEmpireResult[] {
    return this.results
      .filter((r) => r.actorId === actorId && r.commandKind === undefined)
      .map((r) => ({ ...r }));
  }

  /** Future E3 delivery: private non-founder outcomes from this ONE journal. */
  politicalResultsFor(
    actorId: PlayerID,
  ): readonly NationalPoliticalCommandResult[] {
    return this.results
      .filter(
        (r): r is NationalPoliticalCommandResult =>
          r.actorId === actorId &&
          r.commandKind !== undefined &&
          r.commandTargetId !== undefined,
      )
      .map((r) => ({ ...r }));
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
          receipt.commandTargetId !== receipt.empireId)
      )
        throw new Error("NATIONAL journal: invalid or future receipt");
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
    this.memories.clear();
    for (const record of saved.memories)
      this.memories.set(record.observerId, {
        observerId: record.observerId,
        assets: record.assets.map((a) => ({ ...a })) as LastKnownAsset[],
      });
  }
}
