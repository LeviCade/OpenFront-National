/**
 * M0: the engine's authoritative opt-in NATIONAL politics runtime.
 *
 * The political transition rules come from E1; this adapter binds them to
 * actual engine PlayerIDs and deterministic ticks. No data in this module is
 * itself a client observation or an AI input.
 */
import { Structures, UnitType, type PlayerID } from "@openfront/engine-api/game/GameTypes";
import { distributeImperialGold, splitWorkerIncome } from "./politics/ImperialAccounting";
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
  dissolveEmpire,
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

const exactGold = z.string().regex(/^(0|[1-9][0-9]*)$/);
const administrationSchema = z.object({
  empireId: z.string(),
  workerIncomeBps: z.number().int().min(0).max(10_000),
  allowedConstruction: z.array(z.enum(UnitType)).nullable(),
  treasury: exactGold,
});
type AdministrationRow = z.infer<typeof administrationSchema>;

export type ImperialPolicy = {
  readonly workerIncomeBps: number;
  readonly allowedConstruction: readonly UnitType[] | null;
};

export type NationalImperialAdministrationCommand =
  | { kind: "set-policy"; empireId: string; policy: ImperialPolicy }
  | { kind: "transfer-troops"; empireId: string; sourceId: PlayerID; destinationId: PlayerID; amount: number }
  | { kind: "build-structure"; empireId: string; memberId: PlayerID; type: UnitType; tile: number }
  | { kind: "dissolve"; empireId: string };

export interface NationalImperialAdministrationView extends ImperialPolicy {
  readonly empireId: string;
  readonly treasury: string;
  readonly canAmend: boolean;
}

type ImperialDisposition = (
  credits: ReadonlyMap<PlayerID, bigint>,
  collapsedEmpireIds: readonly string[],
) => void;

function validateAdministration(row: AdministrationRow): void {
  const allowed = row.allowedConstruction;
  if (allowed !== null &&
      (new Set(allowed).size !== allowed.length ||
       allowed.some((type) => !Structures.has(type) && type !== UnitType.Warship)))
    throw new Error("NATIONAL: invalid construction categories");
}

export const NationalRuntimeSnapshotSchema = z.object({
  version: z.literal(1),
  lastTick: counter,
  politics: politicsSchema,
  administration: z.array(administrationSchema).optional(),
  unclaimedTreasury: exactGold.optional(),
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

export interface NationalPublicPactView {
  readonly id: string;
  readonly name: string;
  readonly kind: PactKind;
  readonly memberIds: readonly PlayerID[];
  readonly administratorId: PlayerID | null;
}

export interface NationalRecipientPactView extends NationalPublicPactView {
  readonly role: "member" | "invited";
  readonly terms: Readonly<PactTerms>;
  readonly invitations: readonly {
    readonly targetId: PlayerID;
    readonly approvedBy: readonly PlayerID[];
    readonly authorized: boolean;
  }[];
  readonly pendingAmendment: {
    readonly terms: Readonly<PactTerms>;
    readonly administratorId: PlayerID | null;
    readonly approvedBy: readonly PlayerID[];
    readonly ownVote: boolean;
  } | null;
  readonly canAccept: boolean;
  readonly canApproveAmendment: boolean;
  readonly canBetray: boolean;
  readonly expellableMemberIds: readonly PlayerID[];
}

export interface NationalPactDisclosureViewData {
  readonly version: 1;
  readonly recipientId: PlayerID;
  readonly pacts: readonly {
    readonly pactId: string;
    readonly relationship: "member" | "invited";
    readonly terms: Readonly<PactTerms>;
    readonly pendingAmendment?: {
      readonly terms: Readonly<PactTerms>;
      readonly administratorId: PlayerID | null;
      readonly approvedBy: readonly PlayerID[];
    };
  }[];
}

export interface NationalPublicPoliticalView {
  readonly pacts?: readonly NationalPublicPactView[];
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
  private administration = new Map<string, AdministrationRow>();
  private unclaimedTreasury = 0n;

  assertEmperor(actorId: PlayerID, empireId: string): void {
    requireCommandId(empireId);
    const empire = this.politics.empires.find((e) => e.id === empireId);
    if (!empire || empire.leaderId !== actorId ||
        !this.politics.nations.some((n) => n.id === actorId && n.alive))
      throw new Error("NATIONAL: only the current emperor may administer an empire");
  }

  setImperialPolicy(actorId: PlayerID, empireId: string, policy: ImperialPolicy): void {
    this.assertEmperor(actorId, empireId);
    const row = administrationSchema.parse({
      empireId,
      workerIncomeBps: policy.workerIncomeBps,
      allowedConstruction: policy.allowedConstruction,
      treasury: this.administration.get(empireId)?.treasury ?? "0",
    });
    validateAdministration(row);
    row.allowedConstruction?.sort();
    this.administration.set(empireId, row);
  }

  imperialAdministrationFor(memberId: PlayerID): NationalImperialAdministrationView | null {
    const empire = this.politics.empires.find((e) => e.memberIds.includes(memberId));
    if (!empire || !this.politics.nations.some((n) => n.id === memberId && n.alive))
      return null;
    const row = this.administration.get(empire.id);
    return Object.freeze({
      empireId: empire.id,
      workerIncomeBps: row?.workerIncomeBps ?? 0,
      allowedConstruction: row?.allowedConstruction == null
        ? null : Object.freeze([...row.allowedConstruction]),
      treasury: row?.treasury ?? "0",
      canAmend: empire.leaderId === memberId,
    });
  }

  /** Only PlayerExecution's actual worker production enters this ledger. */
  routeWorkerIncome(memberId: PlayerID, gross: bigint): bigint {
    const empire = this.politics.empires.find((e) => e.memberIds.includes(memberId));
    const row = empire && this.administration.get(empire.id);
    if (!row || row.workerIncomeBps === 0) return gross;
    const split = splitWorkerIncome(gross, row.workerIncomeBps);
    row.treasury = (BigInt(row.treasury) + split.imperial).toString();
    return split.personal;
  }

  /** Treasury debits never transit a nation's personal wallet. */
  debitImperialConstruction(actorId: PlayerID, empireId: string, cost: bigint): void {
    this.assertEmperor(actorId, empireId);
    const row = this.administration.get(empireId);
    if (cost < 0n || (!row && cost > 0n) ||
        (row && BigInt(row.treasury) < cost))
      throw new Error("NATIONAL: insufficient imperial construction treasury");
    if (row) row.treasury = (BigInt(row.treasury) - cost).toString();
  }

  allowsConstruction(memberId: PlayerID, type: UnitType): boolean {
    // Internal projectiles, trade trains, transports, etc. are not subject to
    // this construction decree. Only player structures and warships are.
    if (!Structures.has(type) && type !== UnitType.Warship) return true;
    const empire = this.politics.empires.find((e) => e.memberIds.includes(memberId));
    if (!empire || empire.leaderId === memberId) return true;
    const allowed = this.administration.get(empire.id)?.allowedConstruction;
    return allowed == null || allowed.includes(type);
  }

  /** Prepare all dispositions before publishing the new sovereign state. */
  private settleCollapsed(next: PoliticsProjection, disposition?: ImperialDisposition): void {
    const survivingEmpires = new Set(next.empires.map((e) => e.id));
    const collapsed = this.politics.empires.filter((e) => !survivingEmpires.has(e.id));
    if (collapsed.length === 0) return;
    const live = new Set(next.nations.filter((n) => n.alive).map((n) => n.id));
    const credits = new Map<PlayerID, bigint>();
    let unclaimed = this.unclaimedTreasury;
    for (const empire of collapsed) {
      const gold = BigInt(this.administration.get(empire.id)?.treasury ?? "0");
      const allocation = distributeImperialGold(
        gold, empire.leaderId, empire.memberIds.filter((id) => live.has(id)),
      );
      for (const [id, amount] of allocation.credits)
        credits.set(id, (credits.get(id) ?? 0n) + amount);
      unclaimed += allocation.unclaimed;
    }
    if (!disposition && credits.size > 0)
      throw new Error("NATIONAL: treasury disposition engine port missing");
    // GameImpl's callback preflights every actual destination before mutating.
    disposition?.(credits, collapsed.map((e) => e.id).sort());
    for (const empire of collapsed) this.administration.delete(empire.id);
    this.unclaimedTreasury = unclaimed;
  }

  voluntarilyDissolve(actorId: PlayerID, empireId: string, disposition: ImperialDisposition): void {
    this.assertEmperor(actorId, empireId);
    const next = dissolveEmpire(this.politics, empireId, actorId);
    this.settleCollapsed(next, disposition);
    this.politics = next;
  }

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
   * boundary. Live GameImpl supplies the atomic asset disposition port.
   * Isolated projections without that port retain the historical warning.
   */
  synchronize(
    players: readonly NationalLivePlayer[],
    tick: number,
    spawnPhaseEnded: boolean,
    unspawnedPolicy: UnspawnedPolicy = "preserve-pending",
    disposition?: ImperialDisposition,
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
    // There is no pooled army in this implementation; national active and
    // deployed troops remain with their actual owners. Treasury settlement
    // and retirement of extinct sovereign war layers precede publication.
    next = evaluateUngovernable(next, tick * 100, disposition !== undefined).state;
    validatePolitics(next);
    this.settleCollapsed(next, disposition);
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

  /** D-017: public facts only, no terms or pending votes. */
  publicPactRoster(): readonly NationalPublicPactView[] {
    return Object.freeze(
      this.politics.pacts.map((p) => Object.freeze({
        id: p.id,
        name: p.name,
        kind: p.kind,
        memberIds: Object.freeze([...p.memberIds].sort()),
        administratorId: p.administratorId,
      })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }

  /** D-007/D-017: partial unanimous approval is not an actionable invitation. */
  pactViewsFor(recipientId: PlayerID): readonly NationalRecipientPactView[] {
    if (!this.politics.nations.some((n) => n.id === recipientId && n.alive))
      return [];
    if (this.politics.empires.some((e) => e.memberIds.includes(recipientId)))
      return [];
    const publicById = new Map(this.publicPactRoster().map((p) => [p.id, p]));
    const views: NationalRecipientPactView[] = [];
    for (const p of this.politics.pacts) {
      const member = p.memberIds.includes(recipientId);
      const authorized = (approvedBy: readonly PlayerID[]) =>
        p.terms.admission === "leader"
          ? p.administratorId !== null && approvedBy.includes(p.administratorId)
          : p.memberIds.every((id) => approvedBy.includes(id));
      const invited = !member && p.invitations.some((i) =>
        i.targetId === recipientId && authorized(i.approvedBy));
      if (!member && !invited) continue;
      const pending = member ? p.pendingAmendment : undefined;
      views.push(Object.freeze({
        ...publicById.get(p.id)!,
        role: member ? "member" : "invited",
        terms: Object.freeze({ ...p.terms }),
        invitations: Object.freeze(member ? p.invitations.map((i) =>
          Object.freeze({
            targetId: i.targetId,
            approvedBy: Object.freeze([...i.approvedBy].sort()),
            authorized: authorized(i.approvedBy),
          })) : []),
        pendingAmendment: pending ? Object.freeze({
          terms: Object.freeze({ ...pending.terms }),
          administratorId: pending.administratorId,
          approvedBy: Object.freeze([...pending.approvedBy].sort()),
          ownVote: pending.approvedBy.includes(recipientId),
        }) : null,
        canAccept: invited,
        canApproveAmendment: pending !== undefined &&
          !pending.approvedBy.includes(recipientId),
        canBetray: member,
        // The stamped command cannot impersonate other voters. A two-member
        // unanimous pact has only one remaining voter, the requesting member.
        expellableMemberIds: Object.freeze(member && (
          (p.terms.expulsion === "leader" && p.administratorId === recipientId) ||
          (p.terms.expulsion === "unanimous" && p.memberIds.length === 2)
        ) ? p.memberIds.filter((id) => id !== recipientId).sort() : []),
      }));
    }
    return Object.freeze(views.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Minimal canonical disclosure contract consumed by E4's strict encoder. */
  pactDisclosure(recipientId: PlayerID): NationalPactDisclosureViewData {
    return Object.freeze({
      version: 1 as const,
      recipientId,
      pacts: Object.freeze(this.pactViewsFor(recipientId).map((p) =>
        Object.freeze({
          pactId: p.id,
          relationship: p.role,
          terms: p.terms,
          ...(p.pendingAmendment ? {
            pendingAmendment: Object.freeze({
              terms: p.pendingAmendment.terms,
              administratorId: p.pendingAmendment.administratorId,
              approvedBy: p.pendingAmendment.approvedBy,
            }),
          } : {}),
        }),
      )),
    });
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
      pacts: this.publicPactRoster(),
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
          command.approvingIds ?? [actorId],
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
      ...(this.administration.size > 0 ? {
        administration: [...this.administration.values()].sort((a, b) =>
          a.empireId < b.empireId ? -1 : a.empireId > b.empireId ? 1 : 0),
      } : {}),
      ...(this.unclaimedTreasury > 0n ? { unclaimedTreasury: this.unclaimedTreasury.toString() } : {}),
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
    for (const row of saved.administration ?? []) {
      validateAdministration(row);
      if (restored.administration.has(row.empireId) ||
          !saved.politics.empires.some((e) => e.id === row.empireId))
        throw new Error("NATIONAL: duplicate or orphan imperial treasury");
      row.allowedConstruction?.sort();
      restored.administration.set(row.empireId, row);
    }
    restored.unclaimedTreasury = BigInt(saved.unclaimedTreasury ?? "0");
    return restored;
  }
}
