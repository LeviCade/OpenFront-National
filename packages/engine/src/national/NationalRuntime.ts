/**
 * M0: the engine's authoritative opt-in NATIONAL politics runtime.
 *
 * The political transition rules come from E1; this adapter binds them to
 * actual engine PlayerIDs and deterministic ticks. No data in this module is
 * itself a client observation or an AI input.
 */
import {
  Structures,
  UnitType,
  type PlayerID,
} from "@openfront/engine-api/game/GameTypes";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import {
  distributeImperialGold,
  splitWorkerIncome,
} from "./politics/ImperialAccounting";
import {
  distributeImperialTroops,
  hybridPoolCapacity,
  splitHybridGrowth,
  type ArmyCapacity,
} from "./politics/ImperialArmyAccounting";
import { PoliticalAuthorityAdapter } from "./politics/PoliticalAuthorityAdapter";
import {
  acceptEmpireAccession,
  acceptPactInvitation,
  approvePactInvitation,
  approvePactAmendment,
  clonePactTerms,
  pactAdmissionAuthorized,
  usesVersionedPact,
  hasExtendedPactTerms,
  eligibleExpulsionVoters,
  votePactExpulsion,
  withdrawPactInvitation,
  type AdmissionAction,
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
  setImperialWarPolicy,
  setImperialStandingDefensePolicy,
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
  admission: z.enum([
    "leader",
    "unanimous",
    "selected",
    "majority",
    "supermajority",
  ]),
  selectedApproverIds: z.array(z.string().min(1).max(256)).max(256).optional(),
  expulsion: z.enum([
    "leader",
    "unanimous",
    "forbidden",
    "selected",
    "majority",
    "supermajority",
  ]),
  membershipCap: z.number().int().min(2).max(256).optional(),
  invitationDurationTicks: z.number().int().min(1).max(36000).optional(),
  selectedExpellerIds: z.array(z.string().min(1).max(256)).max(256).optional(),
  defenseContributionBps: z.number().int().min(0).max(1000).optional(),
  defenseReserveBps: z.number().int().min(3000).max(10000).optional(),
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
      constitutionVersion: counter.optional(),
      extendedGovernance: z.literal(true).optional(),
      memberAdmissionEpochs: z
        .array(z.object({ memberId: z.string(), invitationVersion: counter }))
        .max(256)
        .optional(),
      expulsionBallots: z
        .array(
          z.object({
            targetId: z.string(),
            constitutionVersion: counter,
            approvedBy: z.array(z.string()),
          }),
        )
        .max(256)
        .optional(),
      invitations: z.array(
        z.object({
          targetId: z.string(),
          approvedBy: z.array(z.string()),
          constitutionVersion: counter.optional(),
          proposerId: z.string().min(1).max(256).optional(),
          expiresAtMs: counter.optional(),
        }),
      ),
      // Absent in older v1 snapshots. No authority is inferred from absence.
      pendingAmendment: z
        .object({
          defenseVersion: counter.optional(),
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
      delegatedNationalDeclarations: z.array(z.string()).optional(),
      accessionWarResponse: z.enum(["none", "imperial"]).optional(),
      standingDefenseResponse: z
        .enum(["none", "assist", "imperial", "both"])
        .optional(),
      warPolicyVersion: counter.optional(),
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
  admissionEpoch: counter.optional(),
  defenseAmendmentSequence: counter.optional(),
});

// One authority record per empire, attached to the canonical NATIONAL runtime.
// It is NOT a trade ledger; actual embargoes remain Player-owned.
const economicCharterSchema = z.object({
  empireId: z.string().min(1).max(64),
  version: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER - 1),
  ownerId: z.string(),
  delegateIds: z.array(z.string()).max(64),
  allowInternal: z.boolean(),
});
type EconomicCharterRow = z.infer<typeof economicCharterSchema>;

export interface NationalEconomicCharterView {
  readonly empireId: string;
  readonly version: number;
  readonly emperorId: string;
  readonly ownerId: string | null;
  readonly delegated: boolean;
  readonly allowInternal: boolean;
}

const exactGold = z.string().regex(/^(0|[1-9][0-9]*)$/);
export type ImperialRevenueClass = "workers" | "maritime" | "rail" | "piracy";
export type ImperialCommercialRevenueClass = Exclude<
  ImperialRevenueClass,
  "workers"
>;
export type ImperialRevenueClasses = Readonly<
  Record<ImperialRevenueClass, boolean>
>;
const allRevenueClasses: ImperialRevenueClasses = Object.freeze({
  workers: true,
  maritime: true,
  rail: true,
  piracy: true,
});
const revenueClassesSchema = z
  .object({
    workers: z.boolean(),
    maritime: z.boolean(),
    rail: z.boolean(),
    piracy: z.boolean(),
  })
  .strict();
/** A bounded, durable authorization record; no wallet or alternate treasury. */
const reliefAmount = z.string().regex(/^[1-9][0-9]{0,11}$/);
const reliefRequestSchema = z.object({
  reliefId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  empireId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  memberId: z.string().min(1),
  amount: reliefAmount,
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  version: z.number().int().min(0).max(1),
  decidedBy: z.string().min(1).nullable(),
});
export type ImperialReliefRequest = z.infer<typeof reliefRequestSchema>;

const administrationSchema = z.object({
  empireId: z.string(),
  workerIncomeBps: z.number().int().min(0).max(10_000),
  nonWorkerIncomeBps: z.number().int().min(0).max(10_000).optional(),
  /** V1 row extension: absent means zero fixed levy and all classes enabled. */
  fixedGoldPerPayout: exactGold.max(128).optional(),
  revenueClasses: revenueClassesSchema.optional(),
  revenuePolicyVersion: z.literal(1).optional(),
  allowedConstruction: z.array(z.enum(UnitType)).nullable(),
  treasury: exactGold,
  military: z
    .object({
      mode: z.enum(["decentralized", "hybrid", "centralized"]),
      thresholdBps: z.number().int().min(0).max(10_000),
      pool: exactGold,
      /** Cumulative contribution origins, not a second spendable reserve. */
      contributions: z
        .array(z.object({ memberId: z.string(), total: exactGold }))
        .optional(),
    })
    .optional(),
});
type AdministrationRow = z.infer<typeof administrationSchema>;

export type ImperialPolicy = {
  readonly workerIncomeBps: number;
  readonly nonWorkerIncomeBps?: number;
  /** Exact integer gold per paid event; percentage is applied first. */
  readonly fixedGoldPerPayout?: string;
  /** Omitted by legacy clients; the prior class policy is then retained. */
  readonly revenueClasses?: ImperialRevenueClasses;
  readonly allowedConstruction: UnitType[] | null;
};

export type NationalImperialAdministrationCommand =
  | { kind: "set-policy"; empireId: string; policy: ImperialPolicy }
  | {
      kind: "transfer-troops";
      empireId: string;
      sourceId: PlayerID;
      destinationId: PlayerID;
      amount: number;
    }
  | {
      kind: "build-structure";
      empireId: string;
      memberId: PlayerID;
      type: UnitType;
      tile: number;
    }
  | {
      kind: "upgrade-structure";
      empireId: string;
      memberId: PlayerID;
      unitId: number;
    }
  | {
      kind: "demolish-structure";
      empireId: string;
      memberId: PlayerID;
      unitId: number;
    }
  | { kind: "dissolve"; empireId: string }
  | {
      kind: "set-army-mode";
      empireId: string;
      mode: "decentralized" | "hybrid" | "centralized";
      thresholdBps: number;
    }
  | {
      kind: "release-imperial-troops";
      empireId: string;
      memberId: PlayerID;
      amount: number;
    }
  | {
      kind: "imperial-attack";
      empireId: string;
      memberId: PlayerID;
      targetId: PlayerID;
      amount: number;
    }
  | {
      kind: "set-war-policy";
      empireId: string;
      expectedVersion: number;
      response: "none" | "imperial";
      declarationDelegates: PlayerID[];
      peaceDelegates: PlayerID[];
    }
  | {
      kind: "set-standing-defense-policy";
      empireId: string;
      expectedVersion: number;
      response: "none" | "assist" | "imperial" | "both";
    }
  | {
      kind: "request-relief";
      empireId: string;
      reliefId: string;
      amount: string;
    }
  | {
      kind: "decide-relief";
      empireId: string;
      reliefId: string;
      expectedVersion: number;
      decision: "approve" | "reject";
    }
  | {
      kind: "set-economic-charter";
      empireId: string;
      expectedVersion: number;
      delegateIds: PlayerID[];
      allowInternal: boolean;
    }
  | {
      kind: "set-member-trade";
      empireId: string;
      expectedVersion: number;
      memberId: PlayerID;
      targetId: PlayerID;
      embargo: boolean;
    }
  | {
      kind: "respond-member-sanction";
      empireId: string;
      expectedVersion: number;
      memberId: PlayerID;
      sanctionId: string;
      decision: "comply" | "refuse";
    };

export interface NationalImperialAdministrationView extends Omit<
  ImperialPolicy,
  "allowedConstruction"
> {
  readonly allowedConstruction: readonly UnitType[] | null;
  readonly empireId: string;
  readonly fixedGoldPerPayout: string;
  readonly revenueClasses: ImperialRevenueClasses;
  readonly treasury: string;
  /** Emperor sees this empire's requests; a constituent sees only their own. */
  readonly reliefRequests: readonly ImperialReliefRequest[];
  readonly canAmend: boolean;
  readonly armyMode: "decentralized" | "hybrid" | "centralized";
  readonly hybridThresholdBps: number;
  readonly imperialTroops: string;
  readonly imperialTroopCapacity: string;
  readonly troopContributions: readonly { memberId: string; total: string }[];
  readonly warPolicyVersion: number;
  readonly accessionWarResponse: "none" | "imperial";
  readonly standingDefenseResponse: "none" | "assist" | "imperial" | "both";
  readonly nationalDeclarationDelegates: readonly PlayerID[];
  readonly nationalPeaceDelegates: readonly PlayerID[];
}

type ImperialDisposition = (
  credits: ReadonlyMap<PlayerID, bigint>,
  collapsedEmpireIds: readonly string[],
  troopCredits: ReadonlyMap<PlayerID, bigint>,
) => void;

function validateAdministration(row: AdministrationRow): void {
  if (row.military?.mode === "decentralized" && row.military.pool !== "0")
    throw new Error("NATIONAL: decentralized empire cannot own pooled troops");
  const allowed = row.allowedConstruction;
  if (
    allowed !== null &&
    (new Set(allowed).size !== allowed.length ||
      allowed.some(
        (type) => !Structures.has(type) && type !== UnitType.Warship,
      ))
  )
    throw new Error("NATIONAL: invalid construction categories");
}

export const NationalRuntimeSnapshotSchema = z.object({
  version: z.literal(1),
  lastTick: counter,
  politics: politicsSchema,
  administration: z.array(administrationSchema).optional(),
  /** Optional in original V1 snapshots; historical absence is an empty ledger. */
  reliefRequests: z.array(reliefRequestSchema).max(4096).optional(),
  unclaimedTreasury: exactGold.optional(),
  deferredTroops: z
    .array(z.object({ memberId: z.string(), amount: exactGold }))
    .optional(),
  unclaimedTroops: exactGold.optional(),
  economicCharters: z.array(economicCharterSchema).optional(),
});
export type NationalRuntimeSnapshot = z.infer<
  typeof NationalRuntimeSnapshotSchema
>;

/** These actions are authorized by the live GameImpl actor check. */
export type NationalCommand =
  | { kind: "found-empire"; empireId: string }
  | {
      kind: "imperial-administration";
      command: NationalImperialAdministrationCommand;
    }
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
  | {
      kind: "invite-pact";
      pactId: string;
      candidateId: PlayerID;
      admissionAction?: AdmissionAction;
      constitutionVersion?: number;
    }
  | { kind: "accept-pact"; pactId: string; constitutionVersion?: number }
  | {
      kind: "propose-pact-amendment";
      pactId: string;
      terms: PactTerms;
      administratorId: PlayerID | null;
      constitutionVersion?: number;
    }
  | {
      kind: "approve-pact-amendment";
      pactId: string;
      expectedDefenseVersion?: number;
      reject?: boolean;
    }
  | { kind: "betray-pact"; pactId: string }
  | {
      kind: "expel-pact";
      pactId: string;
      memberId: PlayerID;
      approvingIds?: PlayerID[];
      constitutionVersion?: number;
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
  readonly extendedGovernance?: true;
  readonly invitationExpiresAtTick?: number;
  readonly expulsionBallots?: readonly {
    readonly targetId: PlayerID;
    readonly approvedBy: readonly PlayerID[];
  }[];
  readonly constitutionVersion?: number;
  readonly terms: Readonly<PactTerms>;
  readonly invitations: readonly {
    readonly targetId: PlayerID;
    readonly approvedBy: readonly PlayerID[];
    readonly authorized: boolean;
    readonly expiresAtTick?: number;
  }[];
  readonly pendingAmendment: {
    readonly defenseVersion?: number;
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
    readonly extendedGovernance?: true;
    readonly invitationExpiresAtTick?: number;
    readonly expulsionBallots?: readonly {
      readonly targetId: PlayerID;
      readonly approvedBy: readonly PlayerID[];
    }[];
    readonly constitutionVersion?: number;
    readonly invitations?: readonly {
      readonly targetId: PlayerID;
      readonly approvedBy: readonly PlayerID[];
      readonly authorized: boolean;
      readonly expiresAtTick?: number;
    }[];
    readonly terms: Readonly<PactTerms>;
    readonly pendingAmendment?: {
      readonly defenseVersion?: number;
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
  readonly victory: (LastSovereignResult & { confirmedTick?: number }) | null;
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
  private reliefRequests = new Map<string, ImperialReliefRequest>();
  private economicCharters = new Map<string, EconomicCharterRow>();
  private unclaimedTreasury = 0n;
  private deferredTroops = new Map<PlayerID, bigint>();
  private unclaimedTroops = 0n;

  assertEmperor(actorId: PlayerID, empireId: string): void {
    requireCommandId(empireId);
    const empire = this.politics.empires.find((e) => e.id === empireId);
    if (
      !empire ||
      empire.leaderId !== actorId ||
      !this.politics.nations.some((n) => n.id === actorId && n.alive)
    )
      throw new Error(
        "NATIONAL: only the current emperor may administer an empire",
      );
  }

  /** Current crown owns all live grants; succession invalidates the former owner's grants. */
  economicCharterFor(memberId: PlayerID): NationalEconomicCharterView | null {
    const empire = this.politics.empires.find((e) =>
      e.memberIds.includes(memberId),
    );
    if (
      !empire ||
      !this.politics.nations.some((n) => n.id === memberId && n.alive)
    )
      return null;
    const row = this.economicCharters.get(empire.id);
    const active = row?.ownerId === empire.leaderId;
    return Object.freeze({
      empireId: empire.id,
      emperorId: empire.leaderId,
      ownerId: row?.ownerId ?? null,
      version: row?.version ?? 0,
      delegated:
        active &&
        row.delegateIds.includes(memberId) &&
        memberId !== empire.leaderId,
      allowInternal: active && row.allowInternal,
    });
  }

  private assertEconomicEpoch(
    actorId: PlayerID,
    empireId: string,
    expectedVersion: number,
  ): void {
    this.assertEmperor(actorId, empireId);
    const actual = this.economicCharters.get(empireId)?.version ?? 0;
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion !== actual ||
      actual >= Number.MAX_SAFE_INTEGER - 1
    )
      throw new Error("NATIONAL: stale imperial economic charter epoch");
  }

  setEconomicCharter(
    actorId: PlayerID,
    empireId: string,
    expectedVersion: number,
    delegateIds: readonly PlayerID[],
    allowInternal: boolean,
  ): void {
    this.assertEconomicEpoch(actorId, empireId, expectedVersion);
    const empire = this.politics.empires.find((e) => e.id === empireId)!;
    if (
      typeof allowInternal !== "boolean" ||
      delegateIds.length > 64 ||
      new Set(delegateIds).size !== delegateIds.length ||
      delegateIds.some(
        (id) =>
          id === actorId ||
          !empire.memberIds.includes(id) ||
          !this.politics.nations.some((n) => n.id === id && n.alive),
      )
    )
      throw new Error("NATIONAL: invalid imperial economic delegate");
    this.economicCharters.set(
      empireId,
      economicCharterSchema.parse({
        empireId,
        version: expectedVersion + 1,
        ownerId: actorId,
        delegateIds: [...delegateIds].sort(),
        allowInternal,
      }),
    );
  }

  /** Invoke only after a Game-owned embargo or sanction-response command commits. */
  advanceEconomicEpoch(
    actorId: PlayerID,
    empireId: string,
    expectedVersion: number,
  ): void {
    this.assertEconomicEpoch(actorId, empireId, expectedVersion);
    const prev = this.economicCharters.get(empireId);
    const sameOwner = prev?.ownerId === actorId;
    this.economicCharters.set(
      empireId,
      economicCharterSchema.parse({
        empireId,
        version: expectedVersion + 1,
        ownerId: actorId,
        delegateIds: sameOwner ? prev.delegateIds : [],
        allowInternal: sameOwner ? prev.allowInternal : false,
      }),
    );
  }

  /**
   * No delegation may survive succession or a lost constituent. Keep the
   * previous version as a monotonic compare-and-swap tombstone and advance
   * it exactly once on each actual political roster change.
   */
  private reconcileEconomicCharters(next: PoliticsProjection): void {
    for (const [empireId, charter] of this.economicCharters) {
      const empire = next.empires.find((item) => item.id === empireId);
      if (!empire) continue; // settleCollapsed permanently retires this row
      const sameCrown = charter.ownerId === empire.leaderId;
      const kept = sameCrown
        ? charter.delegateIds.filter((id) => empire.memberIds.includes(id))
        : [];
      if (sameCrown && kept.length === charter.delegateIds.length) continue;
      this.economicCharters.set(
        empireId,
        economicCharterSchema.parse({
          ...charter,
          ownerId: empire.leaderId,
          delegateIds: kept,
          allowInternal: sameCrown && charter.allowInternal,
          version:
            charter.version < Number.MAX_SAFE_INTEGER - 1
              ? charter.version + 1
              : Number.MAX_SAFE_INTEGER - 1,
        }),
      );
    }
  }

  setImperialPolicy(
    actorId: PlayerID,
    empireId: string,
    policy: ImperialPolicy,
  ): void {
    this.assertEmperor(actorId, empireId);
    const previous = this.administration.get(empireId);
    const row = administrationSchema.parse({
      empireId,
      workerIncomeBps: policy.workerIncomeBps,
      nonWorkerIncomeBps:
        policy.nonWorkerIncomeBps ?? previous?.nonWorkerIncomeBps ?? 0,
      fixedGoldPerPayout:
        policy.fixedGoldPerPayout ?? previous?.fixedGoldPerPayout ?? "0",
      revenueClasses:
        policy.revenueClasses ?? previous?.revenueClasses ?? allRevenueClasses,
      revenuePolicyVersion: 1,
      allowedConstruction: policy.allowedConstruction,
      treasury: previous?.treasury ?? "0",
      military: previous?.military,
    });
    validateAdministration(row);
    row.allowedConstruction?.sort();
    this.administration.set(empireId, row);
  }

  imperialAdministrationFor(
    memberId: PlayerID,
  ): NationalImperialAdministrationView | null {
    const empire = this.politics.empires.find((e) =>
      e.memberIds.includes(memberId),
    );
    if (
      !empire ||
      !this.politics.nations.some((n) => n.id === memberId && n.alive)
    )
      return null;
    const row = this.administration.get(empire.id);
    return Object.freeze({
      empireId: empire.id,
      workerIncomeBps: row?.workerIncomeBps ?? 0,
      nonWorkerIncomeBps: row?.nonWorkerIncomeBps ?? 0,
      fixedGoldPerPayout: row?.fixedGoldPerPayout ?? "0",
      revenueClasses: Object.freeze({
        ...(row?.revenueClasses ?? allRevenueClasses),
      }),
      allowedConstruction:
        row?.allowedConstruction === null ||
        row?.allowedConstruction === undefined
          ? null
          : Object.freeze([...row.allowedConstruction]),
      treasury: row?.treasury ?? "0",
      reliefRequests: Object.freeze(
        [...this.reliefRequests.values()]
          .filter(
            (request) =>
              request.empireId === empire.id &&
              (empire.leaderId === memberId || request.memberId === memberId),
          )
          .map((request) => Object.freeze({ ...request })),
      ),
      canAmend: empire.leaderId === memberId,
      armyMode: row?.military?.mode ?? "decentralized",
      hybridThresholdBps: row?.military?.thresholdBps ?? 6000,
      imperialTroops: row?.military?.pool ?? "0",
      imperialTroopCapacity:
        row?.military?.mode === "hybrid"
          ? hybridPoolCapacity(
              this.armySlots(this.politics, empire.memberIds),
              row.military.thresholdBps,
            ).toString()
          : row?.military?.mode === "centralized"
            ? this.armySlots(this.politics, empire.memberIds)
                .reduce(
                  (s, v) =>
                    s + (v.capacity > v.active ? v.capacity - v.active : 0n),
                  0n,
                )
                .toString()
            : "0",
      troopContributions: Object.freeze(
        (row?.military?.contributions ?? []).map((c) =>
          Object.freeze({ ...c }),
        ),
      ),
      warPolicyVersion: empire.warPolicyVersion ?? 0,
      accessionWarResponse: empire.accessionWarResponse ?? "none",
      standingDefenseResponse: empire.standingDefenseResponse ?? "none",
      nationalDeclarationDelegates: Object.freeze([
        ...(empire.delegatedNationalDeclarations ?? []),
      ]),
      nationalPeaceDelegates: Object.freeze([
        ...(empire.delegatedNationalPeace ?? []),
      ]),
    });
  }

  private armySlots(
    state: PoliticsProjection,
    ids: readonly PlayerID[],
  ): ArmyCapacity[] {
    const members = new Set(ids);
    return state.nations
      .filter((n) => n.alive && members.has(n.id))
      .map((n) => ({
        id: n.id,
        capacity: BigInt(n.metrics.maxPopulation),
        active: BigInt(n.metrics.activePopulation),
      }));
  }

  private addTroopFacts(
    state: PoliticsProjection,
    credits: ReadonlyMap<PlayerID, bigint>,
  ): void {
    for (const [id, amount] of credits) {
      const nation = state.nations.find((n) => n.id === id && n.alive);
      if (!nation || amount <= 0n)
        throw new Error("NATIONAL: invalid troop recipient");
      const total = BigInt(nation.metrics.activePopulation) + amount;
      if (
        total > BigInt(nation.metrics.maxPopulation) ||
        total > BigInt(Number.MAX_SAFE_INTEGER)
      )
        throw new Error("NATIONAL: troop allocation exceeds capacity");
      nation.metrics.activePopulation = Number(total);
    }
  }

  setArmyMode(
    actorId: PlayerID,
    empireId: string,
    mode: "decentralized" | "hybrid",
    thresholdBps: number,
    disposition: ImperialDisposition,
  ): void {
    this.assertEmperor(actorId, empireId);
    const empire = this.politics.empires.find((e) => e.id === empireId)!;
    const previous = this.administration.get(empireId);
    const pool = BigInt(previous?.military?.pool ?? "0");
    const row = administrationSchema.parse({
      empireId,
      workerIncomeBps: previous?.workerIncomeBps ?? 0,
      nonWorkerIncomeBps: previous?.nonWorkerIncomeBps ?? 0,
      fixedGoldPerPayout: previous?.fixedGoldPerPayout,
      revenueClasses: previous?.revenueClasses,
      revenuePolicyVersion: previous?.revenuePolicyVersion,
      allowedConstruction: previous?.allowedConstruction ?? null,
      treasury: previous?.treasury ?? "0",
      military: {
        mode,
        thresholdBps,
        pool: mode === "hybrid" ? pool.toString() : "0",
        contributions: previous?.military?.contributions ?? [],
      },
    });
    const slots = this.armySlots(this.politics, empire.memberIds);
    if (mode === "hybrid") {
      if (pool > hybridPoolCapacity(slots, thresholdBps))
        throw new Error(
          "NATIONAL: release excess pooled reserves before reducing hybrid cap",
        );
      this.administration.set(empireId, row);
      return;
    }
    const allocation = distributeImperialTroops(pool, slots);
    const next = clonePoliticalProjection(this.politics);
    const deferred = new Map(this.deferredTroops);
    for (const [id, amount] of allocation.deferred)
      deferred.set(id, (deferred.get(id) ?? 0n) + amount);
    this.addTroopFacts(next, allocation.active);
    validatePolitics(next);
    disposition(new Map(), [], allocation.active);
    this.administration.set(empireId, row);
    this.deferredTroops = deferred;
    this.unclaimedTroops += allocation.unclaimed;
    this.politics = next;
  }

  /** Converts standing troop balances only; existing attacks are already paid
   * by their sovereigns and are not withdrawn a second time. */
  centralizeImperialArmy(
    actorId: PlayerID,
    empireId: string,
    thresholdBps: number,
    balances: readonly { memberId: PlayerID; balance: number }[],
    commitActualDebits: () => void,
  ): void {
    this.assertEmperor(actorId, empireId);
    const empire = this.politics.empires.find((e) => e.id === empireId)!;
    const previous = this.administration.get(empireId);
    if (previous?.military?.mode === "centralized")
      throw new Error("NATIONAL: army already centralized");
    if (
      !Number.isSafeInteger(thresholdBps) ||
      thresholdBps < 0 ||
      thresholdBps > 10_000
    )
      throw new Error("NATIONAL: invalid army threshold");
    const slots = this.armySlots(this.politics, empire.memberIds);
    const supplied = new Map(balances.map((b) => [b.memberId, b.balance]));
    if (
      supplied.size !== slots.length ||
      balances.length !== slots.length ||
      slots.some(
        (s) =>
          !supplied.has(s.id) ||
          !Number.isSafeInteger(supplied.get(s.id)) ||
          BigInt(supplied.get(s.id)!) !== s.active,
      )
    )
      throw new Error(
        "NATIONAL: incomplete or stale constituent army balances",
      );
    const total = slots.reduce((s, slot) => s + slot.active, 0n);
    const next = clonePoliticalProjection(this.politics);
    const memberSet = new Set(slots.map((s) => s.id));
    for (const nation of next.nations)
      if (memberSet.has(nation.id)) nation.metrics.activePopulation = 0;
    validatePolitics(next);
    const contributions = new Map(
      (previous?.military?.contributions ?? []).map(
        (c) => [c.memberId, BigInt(c.total)] as const,
      ),
    );
    for (const slot of slots)
      contributions.set(
        slot.id,
        (contributions.get(slot.id) ?? 0n) + slot.active,
      );
    const row = administrationSchema.parse({
      empireId,
      workerIncomeBps: previous?.workerIncomeBps ?? 0,
      nonWorkerIncomeBps: previous?.nonWorkerIncomeBps ?? 0,
      fixedGoldPerPayout: previous?.fixedGoldPerPayout,
      revenueClasses: previous?.revenueClasses,
      revenuePolicyVersion: previous?.revenuePolicyVersion,
      allowedConstruction: previous?.allowedConstruction ?? null,
      treasury: previous?.treasury ?? "0",
      military: {
        mode: "centralized",
        thresholdBps,
        pool: (BigInt(previous?.military?.pool ?? "0") + total).toString(),
        contributions: [...contributions]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([memberId, value]) => ({ memberId, total: value.toString() })),
      },
    });
    validateAdministration(row);
    // The PlayerImpl CAS preflights *every* actual debit before mutation;
    // only then can canonical political accounts receive the corresponding sum.
    commitActualDebits();
    this.administration.set(empireId, row);
    this.politics = next;
  }

  /** A pooled reserve is a real separately owned balance, never a sum of wallets. */
  routeHybridGrowth(
    memberId: PlayerID,
    gross: bigint,
    liveSlots: (ids: readonly PlayerID[]) => readonly ArmyCapacity[],
  ): bigint {
    const empire = this.politics.empires.find((e) =>
      e.memberIds.includes(memberId),
    );
    const row = empire && this.administration.get(empire.id);
    const military = row?.military;
    if (
      !empire ||
      !military ||
      military.mode === "decentralized" ||
      gross <= 0n
    )
      return gross;
    const slots = liveSlots(empire.memberIds);
    const member = slots.find((s) => s.id === memberId);
    if (!member) return gross;
    const pool = BigInt(military.pool);
    const split =
      military.mode === "centralized"
        ? (() => {
            const capacity = slots.reduce(
              (s, v) =>
                s + (v.capacity > v.active ? v.capacity - v.active : 0n),
              0n,
            );
            const room = capacity > pool ? capacity - pool : 0n;
            const imperial = gross < room ? gross : room;
            return { personal: gross - imperial, imperial };
          })()
        : splitHybridGrowth(
            gross,
            member.active,
            member.capacity,
            military.thresholdBps,
            pool,
            hybridPoolCapacity(slots, military.thresholdBps),
          );
    military.pool = (pool + split.imperial).toString();
    if (split.imperial > 0n) {
      const contributions = new Map(
        (military.contributions ?? []).map(
          (c) => [c.memberId, BigInt(c.total)] as const,
        ),
      );
      contributions.set(
        memberId,
        (contributions.get(memberId) ?? 0n) + split.imperial,
      );
      military.contributions = [...contributions]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, total]) => ({ memberId: id, total: total.toString() }));
    }
    return split.personal;
  }

  releaseImperialTroops(
    actorId: PlayerID,
    empireId: string,
    memberId: PlayerID,
    amount: number,
    disposition: ImperialDisposition,
  ): void {
    this.assertEmperor(actorId, empireId);
    const empire = this.politics.empires.find((e) => e.id === empireId)!;
    const military = this.administration.get(empireId)?.military;
    if (
      !military ||
      military.mode === "decentralized" ||
      !empire.memberIds.includes(memberId) ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      BigInt(amount) > BigInt(military.pool)
    )
      throw new Error(
        "NATIONAL: invalid or unaffordable imperial reserve release",
      );
    const credits = new Map([[memberId, BigInt(amount)]]);
    const next = clonePoliticalProjection(this.politics);
    this.addTroopFacts(next, credits);
    validatePolitics(next);
    disposition(new Map(), [], credits);
    military.pool = (BigInt(military.pool) - BigInt(amount)).toString();
    this.politics = next;
  }

  deferredTroopsFor(memberId: PlayerID): string {
    return (this.deferredTroops.get(memberId) ?? 0n).toString();
  }

  /** Capacity-contraction overflow remains owned, inactive and redeemable. */
  redeemDeferredTroops(memberId: PlayerID, headroom: bigint): bigint {
    if (headroom <= 0n) return 0n;
    const claim = this.deferredTroops.get(memberId) ?? 0n;
    const amount = claim < headroom ? claim : headroom;
    if (amount === claim) this.deferredTroops.delete(memberId);
    else this.deferredTroops.set(memberId, claim - amount);
    return amount;
  }

  /** Worker production and named commercial origins enter at actual paid events only. */
  routeWorkerIncome(memberId: PlayerID, gross: bigint): bigint {
    return this.routeIncome(memberId, gross, "workers");
  }

  routeNonWorkerIncome(
    memberId: PlayerID,
    gross: bigint,
    source: ImperialCommercialRevenueClass,
  ): bigint {
    return this.routeIncome(memberId, gross, source);
  }

  /**
   * D-011: percent first (floor in integer basis points), then fixed gold
   * from the remainder. One gross payment equals retained + imperial exactly.
   * Neither generic addGold nor a missed/embargoed commerce event calls here.
   */
  private routeIncome(
    memberId: PlayerID,
    gross: bigint,
    source: ImperialRevenueClass,
  ): bigint {
    if (gross < 0n) throw new Error("NATIONAL: negative revenue payout");
    const empire = this.politics.empires.find((e) =>
      e.memberIds.includes(memberId),
    );
    const row = empire && this.administration.get(empire.id);
    if (!row || !(row.revenueClasses ?? allRevenueClasses)[source])
      return gross;
    const rate =
      source === "workers"
        ? row.workerIncomeBps
        : (row.nonWorkerIncomeBps ?? 0);
    const percent = splitWorkerIncome(gross, rate).imperial;
    const remaining = gross - percent;
    const fixed = BigInt(row.fixedGoldPerPayout ?? "0");
    const contribution = percent + (fixed < remaining ? fixed : remaining);
    if (contribution > 0n)
      row.treasury = (BigInt(row.treasury) + contribution).toString();
    return gross - contribution;
  }

  /**
   * Only a living *non-emperor* constituent may originate their own request.
   * Request IDs are global to this match and never reusable after settlement.
   */
  requestImperialRelief(
    actorId: PlayerID,
    empireId: string,
    reliefId: string,
    amount: string,
  ): void {
    requireCommandId(empireId);
    requireCommandId(reliefId);
    const empire = this.politics.empires.find((e) => e.id === empireId);
    if (
      !empire ||
      empire.leaderId === actorId ||
      !empire.memberIds.includes(actorId) ||
      !this.politics.nations.some((n) => n.id === actorId && n.alive)
    )
      throw new Error("NATIONAL: relief requires a living non-emperor member");
    if (!reliefAmount.safeParse(amount).success)
      throw new Error("NATIONAL: invalid bounded relief amount");
    if (this.reliefRequests.has(reliefId))
      throw new Error("NATIONAL: duplicate relief identifier");
    if (this.reliefRequests.size >= 4096)
      throw new Error("NATIONAL: relief ledger capacity reached");
    this.reliefRequests.set(reliefId, {
      reliefId,
      empireId,
      memberId: actorId,
      amount,
      status: "pending",
      version: 0,
      decidedBy: null,
    });
  }

  /**
   * Version-checked two-party authorization. All checks and wallet preflight
   * precede the one commit. The Game port stages a direct PlayerImpl balance
   * update, so a grant is spendable but NOT new economic production.
   */
  decideImperialRelief(
    actorId: PlayerID,
    empireId: string,
    reliefId: string,
    expectedVersion: number,
    decision: "approve" | "reject",
    prepareWalletCredit: (memberId: PlayerID, amount: bigint) => () => void,
  ): void {
    this.assertEmperor(actorId, empireId);
    requireCommandId(reliefId);
    const request = this.reliefRequests.get(reliefId);
    if (
      !request ||
      request.empireId !== empireId ||
      request.memberId === actorId ||
      request.status !== "pending" ||
      request.version !== expectedVersion ||
      expectedVersion !== 0 ||
      (decision !== "approve" && decision !== "reject")
    )
      throw new Error(
        "NATIONAL: stale, foreign or unauthorized relief decision",
      );
    const empire = this.politics.empires.find((e) => e.id === empireId)!;
    if (
      !empire.memberIds.includes(request.memberId) ||
      !this.politics.nations.some(
        (nation) => nation.id === request.memberId && nation.alive,
      )
    )
      throw new Error(
        "NATIONAL: relief recipient is no longer a living member",
      );
    const row = this.administration.get(empireId);
    const amount = BigInt(request.amount);
    if (decision === "approve") {
      if (!row || BigInt(row.treasury) < amount)
        throw new Error("NATIONAL: insufficient imperial relief treasury");
      const credit = prepareWalletCredit(request.memberId, amount);
      // The preflight returns an in-memory, nonthrowing Game PlayerImpl commit.
      // No independent currency balance, source counter, or earned-income levy.
      const oldTreasury = row.treasury;
      row.treasury = (BigInt(oldTreasury) - amount).toString();
      try {
        credit();
      } catch (error) {
        row.treasury = oldTreasury;
        throw error;
      }
    }
    this.reliefRequests.set(reliefId, {
      ...request,
      version: 1,
      status: decision === "approve" ? "approved" : "rejected",
      decidedBy: actorId,
    });
  }

  /** Treasury debits never transit a nation's personal wallet. */
  debitImperialConstruction(
    actorId: PlayerID,
    empireId: string,
    cost: bigint,
  ): void {
    this.assertEmperor(actorId, empireId);
    const row = this.administration.get(empireId);
    if (
      cost < 0n ||
      (!row && cost > 0n) ||
      (row && BigInt(row.treasury) < cost)
    )
      throw new Error("NATIONAL: insufficient imperial construction treasury");
    if (row) row.treasury = (BigInt(row.treasury) - cost).toString();
  }

  allowsConstruction(memberId: PlayerID, type: UnitType): boolean {
    // Internal projectiles, trade trains, transports, etc. are not subject to
    // this construction decree. Only player structures and warships are.
    if (!Structures.has(type) && type !== UnitType.Warship) return true;
    const empire = this.politics.empires.find((e) =>
      e.memberIds.includes(memberId),
    );
    if (!empire || empire.leaderId === memberId) return true;
    const allowed = this.administration.get(empire.id)?.allowedConstruction;
    return allowed === null || allowed === undefined || allowed.includes(type);
  }

  /** Prepare all dispositions before publishing the new sovereign state. */
  private settleCollapsed(
    next: PoliticsProjection,
    disposition?: ImperialDisposition,
  ): void {
    const survivingEmpires = new Set(next.empires.map((e) => e.id));
    const collapsed = this.politics.empires.filter(
      (e) => !survivingEmpires.has(e.id),
    );
    const live = new Set(next.nations.filter((n) => n.alive).map((n) => n.id));
    const credits = new Map<PlayerID, bigint>();
    let unclaimed = this.unclaimedTreasury;
    let unclaimedTroops = this.unclaimedTroops;
    const deferred = new Map(this.deferredTroops);
    const troopCredits = new Map<PlayerID, bigint>();
    for (const empire of collapsed) {
      const gold = BigInt(this.administration.get(empire.id)?.treasury ?? "0");
      const allocation = distributeImperialGold(
        gold,
        empire.leaderId,
        empire.memberIds.filter((id) => live.has(id)),
      );
      for (const [id, amount] of allocation.credits)
        credits.set(id, (credits.get(id) ?? 0n) + amount);
      unclaimed += allocation.unclaimed;
      const pool = BigInt(
        this.administration.get(empire.id)?.military?.pool ?? "0",
      );
      const army = distributeImperialTroops(
        pool,
        this.armySlots(next, empire.memberIds),
      );
      for (const [id, amount] of army.active)
        troopCredits.set(id, (troopCredits.get(id) ?? 0n) + amount);
      for (const [id, amount] of army.deferred)
        deferred.set(id, (deferred.get(id) ?? 0n) + amount);
      unclaimedTroops += army.unclaimed;
    }
    // Deferred reserves of eliminated nations have no surviving owner.
    for (const [id, amount] of deferred) {
      if (!live.has(id)) {
        unclaimedTroops += amount;
        deferred.delete(id);
      }
    }
    this.addTroopFacts(next, troopCredits);
    if (!disposition && (credits.size > 0 || troopCredits.size > 0))
      throw new Error("NATIONAL: treasury disposition engine port missing");
    // GameImpl's callback preflights every actual destination before mutating.
    if (collapsed.length > 0)
      disposition?.(credits, collapsed.map((e) => e.id).sort(), troopCredits);
    for (const empire of collapsed) {
      this.administration.delete(empire.id);
      this.economicCharters.delete(empire.id);
    }
    // A dead/expelled member or dissolved empire cannot retain a payable
    // request. Keep the ID and cancelled outcome for replay protection.
    for (const [id, request] of this.reliefRequests) {
      if (
        request.status === "pending" &&
        (!next.empires.some(
          (e) =>
            e.id === request.empireId && e.memberIds.includes(request.memberId),
        ) ||
          !next.nations.some((n) => n.id === request.memberId && n.alive))
      )
        this.reliefRequests.set(id, {
          ...request,
          status: "cancelled",
          version: 1,
        });
    }
    this.unclaimedTreasury = unclaimed;
    this.deferredTroops = deferred;
    this.unclaimedTroops = unclaimedTroops;
  }

  voluntarilyDissolve(
    actorId: PlayerID,
    empireId: string,
    disposition: ImperialDisposition,
  ): void {
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
        action === "peace"
          ? this.hasDelegatedNationalPeace(memberId)
          : this.hasDelegatedNationalDeclaration(memberId),
    );
  }

  /** Canonical persisted policy, never a second resource/authority registry. */
  hasDelegatedNationalDeclaration(memberId: PlayerID): boolean {
    return this.politics.empires.some(
      (e) =>
        e.leaderId !== memberId &&
        e.memberIds.includes(memberId) &&
        (e.delegatedNationalDeclarations ?? []).includes(memberId),
    );
  }

  hasDelegatedNationalPeace(memberId: PlayerID): boolean {
    return this.politics.empires.some(
      (e) =>
        e.leaderId !== memberId &&
        e.memberIds.includes(memberId) &&
        (e.delegatedNationalPeace ?? []).includes(memberId),
    );
  }

  warPolicyVersionFor(memberId: PlayerID): number | null {
    const empire = this.politics.empires.find((e) =>
      e.memberIds.includes(memberId),
    );
    return empire ? (empire.warPolicyVersion ?? 0) : null;
  }

  accessionWarResponseFor(empireId: string): "none" | "imperial" {
    return (
      this.politics.empires.find((e) => e.id === empireId)
        ?.accessionWarResponse ?? "none"
    );
  }

  /** Engine-only read: no client-supplied donor roster or claimed empire. */
  standingDefenseFor(defenderId: PlayerID): {
    readonly empireId: string;
    readonly response: "none" | "assist" | "imperial" | "both";
  } | null {
    if (!this.politics.nations.some((n) => n.id === defenderId && n.alive))
      return null;
    const empire = this.politics.empires.find((e) =>
      e.memberIds.includes(defenderId),
    );
    return empire
      ? {
          empireId: empire.id,
          response: empire.standingDefenseResponse ?? "none",
        }
      : null;
  }

  setStandingDefensePolicy(
    actorId: PlayerID,
    command: Extract<
      NationalImperialAdministrationCommand,
      { kind: "set-standing-defense-policy" }
    >,
  ): void {
    this.politics = setImperialStandingDefensePolicy(
      this.politics,
      command.empireId,
      actorId,
      command.expectedVersion,
      command.response,
    );
  }

  setWarPolicy(
    actorId: PlayerID,
    command: Extract<
      NationalImperialAdministrationCommand,
      { kind: "set-war-policy" }
    >,
  ): void {
    this.politics = setImperialWarPolicy(
      this.politics,
      command.empireId,
      actorId,
      command.expectedVersion,
      command.response,
      command.declarationDelegates,
      command.peaceDelegates,
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
    // Settlement distributes treasury and separately owned hybrid reserves.
    // Active and in-flight national troops retain their actual owners.
    next = evaluateUngovernable(
      next,
      tick * 100,
      disposition !== undefined,
    ).state;
    validatePolitics(next);
    this.settleCollapsed(next, disposition);
    this.reconcileEconomicCharters(next);
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
      this.politics.pacts
        .map((p) =>
          Object.freeze({
            id: p.id,
            name: p.name,
            kind: p.kind,
            memberIds: Object.freeze([...p.memberIds].sort()),
            administratorId: p.administratorId,
          }),
        )
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
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
        pactAdmissionAuthorized(p, approvedBy);
      const invited =
        !member &&
        p.invitations.some(
          (i) => i.targetId === recipientId && authorized(i.approvedBy),
        );
      if (!member && !invited) continue;
      const pending = member ? p.pendingAmendment : undefined;
      const expiry = invited
        ? p.invitations.find((i) => i.targetId === recipientId)?.expiresAtMs
        : undefined;
      views.push(
        Object.freeze({
          ...publicById.get(p.id)!,
          role: member ? "member" : "invited",
          terms: Object.freeze(clonePactTerms(p.terms)),
          ...(usesVersionedPact(p)
            ? { constitutionVersion: p.constitutionVersion }
            : {}),
          ...(p.extendedGovernance
            ? { extendedGovernance: true as const }
            : {}),
          ...(expiry === undefined
            ? {}
            : { invitationExpiresAtTick: expiry / 100 }),
          ...(member && p.extendedGovernance
            ? {
                expulsionBallots: Object.freeze(
                  (p.expulsionBallots ?? []).map((b) =>
                    Object.freeze({
                      targetId: b.targetId,
                      approvedBy: Object.freeze([...b.approvedBy]),
                    }),
                  ),
                ),
              }
            : {}),
          invitations: Object.freeze(
            member
              ? p.invitations.map((i) =>
                  Object.freeze({
                    targetId: i.targetId,
                    approvedBy: Object.freeze([...i.approvedBy].sort()),
                    authorized: authorized(i.approvedBy),
                    ...(i.expiresAtMs === undefined
                      ? {}
                      : { expiresAtTick: i.expiresAtMs / 100 }),
                  }),
                )
              : [],
          ),
          pendingAmendment: pending
            ? Object.freeze({
                ...(pending.defenseVersion === undefined
                  ? {}
                  : { defenseVersion: pending.defenseVersion }),
                terms: Object.freeze(clonePactTerms(pending.terms)),
                administratorId: pending.administratorId,
                approvedBy: Object.freeze([...pending.approvedBy].sort()),
                ownVote: pending.approvedBy.includes(recipientId),
              })
            : null,
          canAccept: invited,
          canApproveAmendment:
            pending !== undefined && !pending.approvedBy.includes(recipientId),
          canBetray: member,
          // The stamped command cannot impersonate other voters. A two-member
          // unanimous pact has only one remaining voter, the requesting member.
          expellableMemberIds: Object.freeze(
            member && p.extendedGovernance
              ? p.memberIds
                  .filter(
                    (id) =>
                      eligibleExpulsionVoters(p, id).includes(recipientId) &&
                      !p.expulsionBallots
                        ?.find((b) => b.targetId === id)
                        ?.approvedBy.includes(recipientId),
                  )
                  .sort()
              : member &&
                  ((p.terms.expulsion === "leader" &&
                    p.administratorId === recipientId) ||
                    (p.terms.expulsion === "unanimous" &&
                      p.memberIds.length === 2))
                ? p.memberIds.filter((id) => id !== recipientId).sort()
                : [],
          ),
        }),
      );
    }
    return Object.freeze(
      views.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    );
  }

  /** Historical receipts cannot be reused after the electorate/epoch changes. */
  mayReplayAdmission(
    actorId: PlayerID,
    command: Extract<NationalCommand, { kind: "invite-pact" | "accept-pact" }>,
  ): boolean {
    const p = this.politics.pacts.find((entry) => entry.id === command.pactId);
    if (command.constitutionVersion === undefined)
      return !p || !usesVersionedPact(p);
    if (!p || this.authority().empireOf(actorId) !== null) return false;
    if (command.kind === "accept-pact") {
      if (!p.memberIds.includes(actorId)) return false;
      return (
        !p.extendedGovernance ||
        p.memberAdmissionEpochs?.some(
          (entry) =>
            entry.memberId === actorId &&
            entry.invitationVersion === command.constitutionVersion,
        ) === true
      );
    }
    if (command.admissionAction === "withdraw")
      return (
        command.candidateId === actorId &&
        p.constitutionVersion === command.constitutionVersion
      );
    return (
      p.constitutionVersion === command.constitutionVersion &&
      p.memberIds.includes(actorId) &&
      p.invitations.some(
        (i) =>
          i.targetId === command.candidateId && i.approvedBy.includes(actorId),
      )
    );
  }

  mayReplayAmendment(
    actorId: PlayerID,
    command: Extract<
      NationalCommand,
      { kind: "propose-pact-amendment" | "approve-pact-amendment" }
    >,
  ): boolean {
    const p = this.politics.pacts.find((entry) => entry.id === command.pactId);
    if (command.kind === "propose-pact-amendment") {
      // A proposal receipt does not identify its resulting proposal generation.
      // Fail closed for extended proposals rather than revive an old receipt.
      return (
        command.constitutionVersion === undefined &&
        !hasExtendedPactTerms(command.terms) &&
        !p?.extendedGovernance
      );
    }
    if (command.expectedDefenseVersion === undefined)
      return !p?.extendedGovernance && command.reject !== true;
    return (
      command.reject !== true &&
      p !== undefined &&
      p.memberIds.includes(actorId) &&
      p.pendingAmendment?.defenseVersion === command.expectedDefenseVersion &&
      p.pendingAmendment.approvedBy.includes(actorId)
    );
  }

  mayReplayExpulsion(
    actorId: PlayerID,
    command: Extract<NationalCommand, { kind: "expel-pact" }>,
  ): boolean {
    const p = this.politics.pacts.find((entry) => entry.id === command.pactId);
    if (command.constitutionVersion === undefined)
      return !p || !p.extendedGovernance;
    return (
      p?.extendedGovernance === true &&
      p.constitutionVersion === command.constitutionVersion &&
      p.expulsionBallots?.some(
        (b) =>
          b.targetId === command.memberId && b.approvedBy.includes(actorId),
      ) === true
    );
  }

  /** Minimal canonical disclosure contract consumed by E4's strict encoder. */
  pactDisclosure(recipientId: PlayerID): NationalPactDisclosureViewData {
    return Object.freeze({
      version: 1 as const,
      recipientId,
      pacts: Object.freeze(
        this.pactViewsFor(recipientId).map((p) =>
          Object.freeze({
            pactId: p.id,
            relationship: p.role,
            terms: p.terms,
            ...(p.extendedGovernance
              ? { extendedGovernance: true as const }
              : {}),
            ...(p.invitationExpiresAtTick === undefined
              ? {}
              : { invitationExpiresAtTick: p.invitationExpiresAtTick }),
            ...(p.expulsionBallots === undefined
              ? {}
              : { expulsionBallots: p.expulsionBallots }),
            ...(p.constitutionVersion === undefined
              ? {}
              : {
                  constitutionVersion: p.constitutionVersion,
                  ...(p.role === "member"
                    ? { invitations: p.invitations }
                    : {}),
                }),
            ...(p.pendingAmendment
              ? {
                  pendingAmendment: Object.freeze({
                    ...(p.pendingAmendment.defenseVersion === undefined
                      ? {}
                      : { defenseVersion: p.pendingAmendment.defenseVersion }),
                    terms: p.pendingAmendment.terms,
                    administratorId: p.pendingAmendment.administratorId,
                    approvedBy: p.pendingAmendment.approvedBy,
                  }),
                }
              : {}),
          }),
        ),
      ),
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
        switch (command.admissionAction) {
          case undefined:
          case "propose":
            next = inviteToPact(
              this.politics,
              command.pactId,
              actorId,
              command.candidateId,
              command.constitutionVersion,
            );
            break;
          case "approve":
            if (command.constitutionVersion === undefined)
              throw new Error("NATIONAL: versioned admission vote required");
            next = approvePactInvitation(
              this.politics,
              command.pactId,
              actorId,
              command.candidateId,
              command.constitutionVersion,
            );
            break;
          case "withdraw":
            next = withdrawPactInvitation(
              this.politics,
              command.pactId,
              actorId,
              command.candidateId,
              command.constitutionVersion,
            );
            break;
          default:
            throw new Error("NATIONAL: invalid admission action");
        }
        break;
      case "accept-pact":
        requireCommandId(command.pactId);
        next = acceptPactInvitation(
          this.politics,
          command.pactId,
          actorId,
          command.constitutionVersion,
        );
        break;
      case "propose-pact-amendment":
        requireCommandId(command.pactId);
        next = proposePactAmendment(
          this.politics,
          command.pactId,
          actorId,
          {
            terms: command.terms,
            administratorId: command.administratorId,
          },
          command.constitutionVersion,
        );
        break;
      case "approve-pact-amendment":
        requireCommandId(command.pactId);
        next = approvePactAmendment(
          this.politics,
          command.pactId,
          actorId,
          command.expectedDefenseVersion,
          command.reject,
        );
        break;
      case "betray-pact":
        requireCommandId(command.pactId);
        next = betrayPact(this.politics, command.pactId, actorId);
        break;
      case "expel-pact":
        requireCommandId(command.pactId);
        // A single command cannot forge another member’s consent. Extended
        // pacts count separate authenticated ballots; legacy authority is unchanged.
        if (command.approvingIds?.some((id) => id !== actorId)) {
          throw new Error("NATIONAL: other members cannot be impersonated");
        }
        next =
          command.constitutionVersion === undefined
            ? expelPactMember(
                this.politics,
                command.pactId,
                actorId,
                command.memberId,
                command.approvingIds ?? [actorId],
              )
            : votePactExpulsion(
                this.politics,
                command.pactId,
                actorId,
                command.memberId,
                command.constitutionVersion,
              );
        break;
      default:
        throw new Error("NATIONAL: unsupported political command");
    }
    this.reconcileEconomicCharters(next);
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
      ...(this.administration.size > 0
        ? {
            administration: [...this.administration.values()].sort((a, b) =>
              a.empireId < b.empireId ? -1 : a.empireId > b.empireId ? 1 : 0,
            ),
          }
        : {}),
      ...(this.reliefRequests.size > 0
        ? {
            reliefRequests: [...this.reliefRequests.values()].sort((a, b) =>
              a.reliefId < b.reliefId ? -1 : a.reliefId > b.reliefId ? 1 : 0,
            ),
          }
        : {}),
      ...(this.unclaimedTreasury > 0n
        ? { unclaimedTreasury: this.unclaimedTreasury.toString() }
        : {}),
      ...(this.deferredTroops.size > 0
        ? {
            deferredTroops: [...this.deferredTroops]
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([memberId, amount]) => ({
                memberId,
                amount: amount.toString(),
              })),
          }
        : {}),
      ...(this.unclaimedTroops > 0n
        ? { unclaimedTroops: this.unclaimedTroops.toString() }
        : {}),
      ...(this.economicCharters.size > 0
        ? {
            economicCharters: [...this.economicCharters.values()].sort(
              (a, b) =>
                a.empireId < b.empireId ? -1 : a.empireId > b.empireId ? 1 : 0,
            ),
          }
        : {}),
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
      if (
        restored.administration.has(row.empireId) ||
        !saved.politics.empires.some((e) => e.id === row.empireId)
      )
        throw new Error("NATIONAL: duplicate or orphan imperial treasury");
      row.allowedConstruction?.sort();
      restored.administration.set(row.empireId, row);
    }
    for (const request of saved.reliefRequests ?? []) {
      const participant = saved.politics.nations.some(
        (n) => n.id === request.memberId,
      );
      const decisionPrincipal =
        request.decidedBy === null ||
        saved.politics.nations.some((n) => n.id === request.decidedBy);
      const validStatus =
        request.status === "pending"
          ? request.version === 0 && request.decidedBy === null
          : request.version === 1 &&
            (request.status === "cancelled"
              ? request.decidedBy === null
              : request.decidedBy !== null);
      if (
        restored.reliefRequests.has(request.reliefId) ||
        !participant ||
        !decisionPrincipal ||
        !validStatus ||
        (request.status === "pending" &&
          (!saved.politics.empires.some(
            (e) =>
              e.id === request.empireId &&
              e.memberIds.includes(request.memberId),
          ) ||
            !saved.politics.nations.some(
              (n) => n.id === request.memberId && n.alive,
            )))
      )
        throw new Error("NATIONAL: invalid or duplicate restored relief");
      restored.reliefRequests.set(request.reliefId, request);
    }
    for (const charter of saved.economicCharters ?? []) {
      const empire = saved.politics.empires.find(
        (e) => e.id === charter.empireId,
      );
      if (
        !empire ||
        restored.economicCharters.has(charter.empireId) ||
        !empire.memberIds.includes(charter.ownerId) ||
        new Set(charter.delegateIds).size !== charter.delegateIds.length ||
        charter.delegateIds.some(
          (id) => id === charter.ownerId || !empire.memberIds.includes(id),
        )
      )
        throw new Error(
          "NATIONAL: invalid or orphan imperial economic charter",
        );
      restored.economicCharters.set(charter.empireId, charter);
    }
    restored.unclaimedTreasury = BigInt(saved.unclaimedTreasury ?? "0");
    for (const claim of saved.deferredTroops ?? []) {
      if (
        restored.deferredTroops.has(claim.memberId) ||
        BigInt(claim.amount) <= 0n ||
        !saved.politics.nations.some((n) => n.id === claim.memberId && n.alive)
      )
        throw new Error("NATIONAL: invalid deferred troop claim");
      restored.deferredTroops.set(claim.memberId, BigInt(claim.amount));
    }
    restored.unclaimedTroops = BigInt(saved.unclaimedTroops ?? "0");
    return restored;
  }
}
