/**
 * M0: the engine's authoritative opt-in NATIONAL politics runtime.
 *
 * The political transition rules come from E1; this adapter binds them to
 * actual engine PlayerIDs and deterministic ticks. No data in this module is
 * itself a client observation or an AI input.
 */
import type { PlayerID } from "@openfront/engine-api/game/GameTypes";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { PoliticalAuthorityAdapter } from "./politics/PoliticalAuthorityAdapter";
import {
  acceptEmpireAccession,
  acceptPactInvitation,
  approvePactAmendment,
  betrayPact,
  clonePoliticalProjection,
  eliminatePoliticalNation,
  evaluateUngovernable,
  expelPactMember,
  foundEmpire,
  foundPact,
  initialPolitics,
  inviteToPact,
  lastSovereignVictory,
  METRIC_KEYS,
  proposeEmpireAccession,
  proposePactAmendment,
  setNationalPeaceDelegation,
  transferCrown,
  validatePolitics,
  type LastSovereignResult,
  type PactKind,
  type PactTerms,
  type PoliticsMetrics,
  type PoliticsProjection,
} from "./politics/sovereignty";

const counter = z.number().int().nonnegative();
const metrics = z.object({
  land: counter,
  maxPopulation: counter,
  activePopulation: counter,
  cities: counter,
  factories: counter,
  ports: counter,
  silos: counter,
  warships: counter,
});
const pactTerms = z.object({
  admission: z.enum(["leader", "unanimous"]),
  expulsion: z.enum(["leader", "unanimous", "forbidden"]),
});
const politicsSchema = z.object({
  nations: z.array(
    z.object({
      id: z.string().min(1),
      alive: z.boolean(),
      metrics,
    }),
  ),
  pacts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(["NAP", "MDA"]),
      memberIds: z.array(z.string()),
      administratorId: z.string().nullable(),
      terms: pactTerms,
      invitations: z.array(
        z.object({
          targetId: z.string(),
          approvedBy: z.array(z.string()),
        }),
      ),
      // Absent in older v1 snapshots. No authority is inferred from absence.
      pendingAmendment: z
        .object({
          terms: pactTerms,
          administratorId: z.string().nullable(),
          approvedBy: z.array(z.string()),
        })
        .optional(),
    }),
  ),
  empires: z.array(
    z.object({
      id: z.string(),
      leaderId: z.string(),
      memberIds: z.array(z.string()),
      crisisDeadlineMs: counter.nullable(),
      // Older GameSnapshot v1 politics omit this; absent means DENY.
      delegatedNationalPeace: z.array(z.string()).optional(),
    }),
  ),
  accessionOffers: z.array(
    z.object({
      empireId: z.string(),
      candidateId: z.string(),
      proposerId: z.string(),
      recipientId: z.string(),
    }),
  ),
  simulationMs: counter,
});

export const NationalRuntimeSnapshotSchema = z.object({
  version: z.literal(1),
  lastTick: counter,
  politics: politicsSchema,
});
export type NationalRuntimeSnapshot = z.infer<
  typeof NationalRuntimeSnapshotSchema
>;

/** These actions are authorized by the live GameImpl actor check. */
export type NationalCommand =
  | { kind: "found-empire"; empireId: string }
  | { kind: "offer-empire"; empireId: string; candidateId: PlayerID }
  | { kind: "accept-empire"; empireId: string; candidateId: PlayerID }
  | { kind: "transfer-crown"; empireId: string; successorId: PlayerID }
  | {
      kind: "set-national-peace-delegation";
      empireId: string;
      memberId: PlayerID;
      enabled: boolean;
    }
  | {
      kind: "found-pact";
      pactId: string;
      name: string;
      pactKind: PactKind;
      terms: PactTerms;
    }
  | { kind: "invite-pact"; pactId: string; candidateId: PlayerID }
  | { kind: "accept-pact"; pactId: string }
  | {
      kind: "propose-pact-amendment";
      pactId: string;
      terms: PactTerms;
      administratorId: PlayerID | null;
    }
  | { kind: "approve-pact-amendment"; pactId: string }
  | { kind: "betray-pact"; pactId: string }
  | {
      kind: "expel-pact";
      pactId: string;
      memberId: PlayerID;
      approvingIds?: PlayerID[];
    };

export interface NationalLivePlayer {
  readonly id: PlayerID;
  readonly alive: boolean;
  readonly spawned: boolean;
  /** All eight readings come from an actual engine Player this tick. */
  readonly metrics: PoliticsMetrics;
  /** Explicitly resolved by the engine; not guessed from wall-clock delay. */
  readonly pendingSpawn?: boolean;
}

/**
 * Pending is the default while P5 (unspawned forfeit) is unratified.
 * The second policy is opt-in for deterministic scenario tests only.
 */
export type UnspawnedPolicy = "preserve-pending" | "forfeit-no-pending";
export interface NationalUngovernableWarning {
  empireId: string;
  deadlineMs: number;
  remainingMs: number;
  blockedByAssetDisposition: boolean;
}

/**
 * Whitelisted public political facts. No private pact terms, vote state,
 * hidden-war ledger, unsighted units, or spoofable client command results.
 */
/**
 * Private, recipient-bound accession invitation. E3 must never include these
 * in the unfiltered public empire roster or another player's packet.
 */
export interface NationalAccessionOfferView {
  readonly empireId: string;
  readonly candidateId: PlayerID;
  readonly proposerId: PlayerID;
  readonly recipientId: PlayerID;
}

export interface NationalPublicPoliticalView {
  readonly empires: readonly {
    readonly id: string;
    readonly leaderId: PlayerID;
    readonly memberIds: readonly PlayerID[];
  }[];
  readonly warnings: readonly NationalUngovernableWarning[];
  readonly victory: LastSovereignResult | null;
}

function requireCommandId(id: string): void {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error("NATIONAL: invalid political command identifier");
  }
}

function emptyMetrics(): PoliticsMetrics {
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])) as PoliticsMetrics;
}

/**
 * There is one instance per NATIONAL GameImpl. All writes flow through the
 * authoritative engine; legacy games do not construct this state.
 */
export class NationalRuntime {
  private politics: PoliticsProjection;
  private lastTick = 0;

  /** Read the same authoritative projection after every command or restore. */
  authority(): PoliticalAuthorityAdapter {
    return new PoliticalAuthorityAdapter(
      () => this.politics,
      (memberId, action) =>
        action === "peace" && this.hasDelegatedNationalPeace(memberId),
    );
  }

  /** Canonical persisted policy, never a second resource/authority registry. */
  hasDelegatedNationalPeace(memberId: PlayerID): boolean {
    return this.politics.empires.some(
      (e) =>
        e.leaderId !== memberId &&
        e.memberIds.includes(memberId) &&
        (e.delegatedNationalPeace ?? []).includes(memberId),
    );
  }

  constructor(ids: readonly PlayerID[]) {
    this.politics = initialPolitics(
      [...ids].map((id) => ({ id, alive: true, metrics: emptyMetrics() })),
    );
  }

  /**
   * Reconcile actual GameImpl players at the deterministic post-execution tick
   * boundary. No automatic Ungovernable collapse until treasury/army
   * redistribution is approved. The warning deadline stays in snapshots.
   */
  synchronize(
    players: readonly NationalLivePlayer[],
    tick: number,
    spawnPhaseEnded: boolean,
    unspawnedPolicy: UnspawnedPolicy = "preserve-pending",
  ): void {
    if (
      !Number.isSafeInteger(tick) ||
      tick < this.lastTick ||
      !Number.isSafeInteger(tick * 100)
    ) {
      throw new Error("NATIONAL: invalid or nonmonotonic simulation tick");
    }
    if (
      unspawnedPolicy !== "preserve-pending" &&
      unspawnedPolicy !== "forfeit-no-pending"
    ) {
      throw new Error("NATIONAL: invalid unspawned policy");
    }
    // Assemble the complete next tick off-state. Invalid engine facts must
    // never leave a partially updated sovereign registry.
    let next = clonePoliticalProjection(this.politics);
    const known = new Set(next.nations.map((n) => n.id));
    const live = new Map<PlayerID, NationalLivePlayer>();
    for (const player of players) {
      if (
        live.has(player.id) ||
        typeof player.id !== "string" ||
        player.id.length === 0
      ) {
        throw new Error("NATIONAL: invalid or duplicate player identity");
      }
      for (const key of METRIC_KEYS) {
        if (
          !Number.isSafeInteger(player.metrics[key]) ||
          player.metrics[key] < 0
        ) {
          throw new Error("NATIONAL: invalid live metric: " + key);
        }
      }
      live.set(player.id, player);
    }
    // Some AI/tribe player identities appear after the constructor.
    for (const player of players) {
      if (!known.has(player.id)) {
        next.nations.push({
          id: player.id,
          alive: true,
          metrics: emptyMetrics(),
        });
      }
    }
    for (const nation of next.nations) {
      const player = live.get(nation.id);
      if (!player) throw new Error("NATIONAL: missing real player identity");
      nation.metrics = { ...player.metrics };
    }
    if (spawnPhaseEnded) {
      for (const player of players) {
        const prior = next.nations.find((n) => n.id === player.id);
        const eliminated = player.spawned && !player.alive;
        const selectedForfeit =
          unspawnedPolicy === "forfeit-no-pending" &&
          !player.spawned &&
          player.pendingSpawn === false;
        if ((eliminated || selectedForfeit) && prior?.alive) {
          next = eliminatePoliticalNation(next, player.id);
        }
      }
    }
    next.simulationMs = tick * 100;
    // Explicitly defer dissolution on expiration. Deadlines are durable and
    // visible, so the 10-second warning remains real and replay deterministic.
    next = evaluateUngovernable(next, tick * 100, false).state;
    validatePolitics(next);
    this.politics = next;
    this.lastTick = tick;
  }

  /** Re-evaluated on demand; copy-only result, not mutable political state. */
  ungovernableWarnings(): NationalUngovernableWarning[] {
    return this.politics.empires
      .filter((e) => e.crisisDeadlineMs !== null)
      .map((e) => ({
        empireId: e.id,
        deadlineMs: e.crisisDeadlineMs!,
        remainingMs: Math.max(
          0,
          e.crisisDeadlineMs! - this.politics.simulationMs,
        ),
        blockedByAssetDisposition:
          this.politics.simulationMs >= e.crisisDeadlineMs!,
      }))
      .sort((a, b) =>
        a.empireId < b.empireId ? -1 : a.empireId > b.empireId ? 1 : 0,
      );
  }

  /**
   * Authoritative MDA membership only: never accepts client-supplied donors.
   * Excludes the defender, unknown/dead members, overlapping duplicates.
   * GameImpl additionally verifies actual spawned PlayerImpl identities.
   */
  mdaAllies(defenderId: PlayerID): readonly PlayerID[] {
    if (!this.politics.nations.some((n) => n.id === defenderId && n.alive)) {
      return [];
    }
    const alive = new Set(
      this.politics.nations.filter((n) => n.alive).map((n) => n.id),
    );
    const result = new Set<PlayerID>();
    for (const pact of this.politics.pacts) {
      if (pact.kind !== "MDA" || !pact.memberIds.includes(defenderId)) {
        continue;
      }
      for (const memberId of pact.memberIds) {
        if (memberId !== defenderId && alive.has(memberId)) {
          result.add(memberId);
        }
      }
    }
    return [...result].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** Read only offers TO this principal; never expose pending consent globally. */
  incomingAccessionOffers(
    recipientId: PlayerID,
  ): readonly NationalAccessionOfferView[] {
    return this.politics.accessionOffers
      .filter((offer) => offer.recipientId === recipientId)
      .map((offer) => ({
        empireId: offer.empireId,
        candidateId: offer.candidateId,
        proposerId: offer.proposerId,
        recipientId: offer.recipientId,
      }))
      .sort(
        (a, b) =>
          (a.empireId < b.empireId ? -1 : a.empireId > b.empireId ? 1 : 0) ||
          (a.candidateId < b.candidateId
            ? -1
            : a.candidateId > b.candidateId
              ? 1
              : 0),
      );
  }

  /** Copy-only, opt-in NATIONAL public facts for E3/E4's trusted UI bridge. */
  publicPoliticalView(): NationalPublicPoliticalView {
    return {
      empires: this.politics.empires
        .map((e) => ({
          id: e.id,
          leaderId: e.leaderId,
          memberIds: [...e.memberIds],
        }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      warnings: this.ungovernableWarnings(),
      victory: this.victoryRoster(),
    };
  }

  /** Accept only the actor resolved from the real GameImpl player registry. */
  perform(actorId: PlayerID, command: NationalCommand): void {
    if (!this.politics.nations.some((n) => n.id === actorId && n.alive)) {
      throw new Error("NATIONAL: dead or unrecognized actor");
    }
    let next: PoliticsProjection;
    switch (command.kind) {
      case "found-empire":
        requireCommandId(command.empireId);
        next = foundEmpire(this.politics, command.empireId, actorId);
        break;
      case "offer-empire":
        requireCommandId(command.empireId);
        next = proposeEmpireAccession(
          this.politics,
          command.empireId,
          actorId,
          command.candidateId,
        );
        break;
      case "accept-empire":
        requireCommandId(command.empireId);
        next = acceptEmpireAccession(
          this.politics,
          command.empireId,
          actorId,
          command.candidateId,
        );
        break;
      case "set-national-peace-delegation":
        requireCommandId(command.empireId);
        next = setNationalPeaceDelegation(
          this.politics,
          command.empireId,
          actorId,
          command.memberId,
          command.enabled,
        );
        break;
      case "transfer-crown":
        requireCommandId(command.empireId);
        next = transferCrown(
          this.politics,
          command.empireId,
          actorId,
          command.successorId,
        );
        break;
      case "found-pact":
        requireCommandId(command.pactId);
        next = foundPact(this.politics, {
          id: command.pactId,
          name: command.name,
          kind: command.pactKind,
          founderId: actorId,
          terms: command.terms,
        });
        break;
      case "invite-pact":
        requireCommandId(command.pactId);
        next = inviteToPact(
          this.politics,
          command.pactId,
          actorId,
          command.candidateId,
        );
        break;
      case "accept-pact":
        requireCommandId(command.pactId);
        next = acceptPactInvitation(this.politics, command.pactId, actorId);
        break;
      case "propose-pact-amendment":
        requireCommandId(command.pactId);
        next = proposePactAmendment(this.politics, command.pactId, actorId, {
          terms: command.terms,
          administratorId: command.administratorId,
        });
        break;
      case "approve-pact-amendment":
        requireCommandId(command.pactId);
        next = approvePactAmendment(this.politics, command.pactId, actorId);
        break;
      case "betray-pact":
        requireCommandId(command.pactId);
        next = betrayPact(this.politics, command.pactId, actorId);
        break;
      case "expel-pact":
        requireCommandId(command.pactId);
        // A single command cannot forge other members' unanimous consent.
        // Separate authenticated expulsion ballots must be implemented before
        // a unanimous-expulsion pact may be enforced through this port.
        if (command.approvingIds?.some((id) => id !== actorId)) {
          throw new Error("NATIONAL: other members cannot be impersonated");
        }
        next = expelPactMember(
          this.politics,
          command.pactId,
          actorId,
          command.memberId,
          command.approvingIds ?? [],
        );
        break;
      default:
        throw new Error("NATIONAL: unsupported political command");
    }
    this.politics = next;
  }

  /** Full, deterministic NATIONAL winner roster, including imperial members. */
  victoryRoster(): LastSovereignResult | null {
    const result = lastSovereignVictory(this.politics);
    return result.resolved ? result : null;
  }

  winner(): PlayerID | null {
    return this.victoryRoster()?.prizes[0]?.nationId ?? null;
  }

  snapshot(): NationalRuntimeSnapshot {
    validatePolitics(this.politics);
    // Only JSON primitives in the E1 pure state; copy to prevent caller writes.
    return NationalRuntimeSnapshotSchema.parse({
      version: 1,
      lastTick: this.lastTick,
      politics: this.politics,
    });
  }

  stateHash(): number {
    return simpleHash(JSON.stringify(this.snapshot()));
  }

  static restore(
    raw: unknown,
    actualIds: readonly PlayerID[],
    engineTick: number,
  ): NationalRuntime {
    const saved = NationalRuntimeSnapshotSchema.parse(raw);
    validatePolitics(saved.politics);
    if (
      saved.lastTick > engineTick ||
      saved.politics.simulationMs > engineTick * 100
    ) {
      throw new Error("NATIONAL: snapshot is from the future");
    }
    const ids = new Set(actualIds);
    if (
      ids.size !== actualIds.length ||
      ids.size !== saved.politics.nations.length ||
      saved.politics.nations.some((n) => !ids.has(n.id))
    ) {
      throw new Error("NATIONAL: snapshot identities differ from real players");
    }
    const restored = new NationalRuntime([]);
    restored.politics = saved.politics;
    restored.lastTick = saved.lastTick;
    return restored;
  }
}
