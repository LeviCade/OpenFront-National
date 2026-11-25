import { validateTreatyDefenseTerms } from "../conflict/NationalTreatyDefensePolicy";

/**
 * NATIONAL political rules — isolated deterministic projection (D-003..D-013).
 *
 * This is NOT the conductor-owned PoliticalIdentity, Coalition, wire schema,
 * command router, or authoritative snapshot. The M0 adapter must map those
 * canonical objects into/out of this pure projection. No GameImpl edits here.
 * Every operation is immutable; no clock, random source, combat or treasury I/O.
 */

export const IMPERIAL_CRISIS_MS = 10_000;
export const METRIC_KEYS = [
  "land",
  "maxPopulation",
  "activePopulation",
  "cities",
  "factories",
  "ports",
  "silos",
  "warships",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];
export type PoliticsMetrics = Record<MetricKey, number>;

export interface PoliticsNation {
  id: string;
  alive: boolean;
  metrics: PoliticsMetrics;
}

export type PactKind = "NAP" | "MDA";
export type VoteRule = "leader" | "unanimous";
export type ExpulsionRule =
  | VoteRule
  | "forbidden"
  | "selected"
  | "majority"
  | "supermajority";
export type AdmissionRule =
  | VoteRule
  | "selected"
  | "majority"
  | "supermajority";
export type AdmissionAction = "propose" | "approve" | "withdraw";
const MAX_ADMISSION_RECORDS = 256;
const MAX_ADMISSION_VOTERS = 256;

export interface PactTerms {
  admission: AdmissionRule;
  expulsion: ExpulsionRule;
  /** All explicitly named current approvers must consent; no implicit delegation. */
  selectedApproverIds?: string[];
  /** Optional maximum total signatories, including the administrator. */
  membershipCap?: number;
  /** Relative invitation lifetime in 100 ms simulation ticks. */
  invitationDurationTicks?: number;
  /** Separate from admission approvers; the proposed target cannot vote. */
  selectedExpellerIds?: string[];
  readonly defenseContributionBps?: number;
  readonly defenseReserveBps?: number;
}

export interface PactInvitation {
  targetId: string;
  approvedBy: string[];
  /** Required for threshold elections; absent in historic invitations. */
  constitutionVersion?: number;
  proposerId?: string;
  expiresAtMs?: number;
}

export interface PactAmendment {
  /** Globally monotonic identity for a proposal touching MDA defense terms. */
  defenseVersion?: number;
  terms: PactTerms;
  administratorId: string | null;
  /** Each vote comes from a distinct registered Game actor. */
  approvedBy: string[];
}

export interface PactExpulsionBallot {
  targetId: string;
  constitutionVersion: number;
  approvedBy: string[];
}

export interface PoliticsPact {
  id: string;
  name: string;
  kind: PactKind;
  memberIds: string[];
  /** null means a departed administrator has not yet been replaced by unanimity. */
  administratorId: string | null;
  terms: PactTerms;
  invitations: PactInvitation[];
  /** Globally allocated, never reused for a recreated pact ID. */
  constitutionVersion?: number;
  /** Optional for existing v1 snapshots; never a public packet field. */
  pendingAmendment?: PactAmendment;
  /** Once opted in, retain versioned authority even if all optional terms are removed. */
  extendedGovernance?: true;
  expulsionBallots?: PactExpulsionBallot[];
}

export interface PoliticsEmpire {
  id: string;
  leaderId: string;
  memberIds: string[];
  /** Deadline in deterministic simulation milliseconds, never wall-clock time. */
  crisisDeadlineMs: number | null;
  /** Emperor-approved subordinate NATIONAL peace authority; not imperial. */
  delegatedNationalPeace?: string[];
  /** Revocable, member-specific authority to DECLARE national (never imperial) war. */
  delegatedNationalDeclarations?: string[];
  /** Default is none; never invent intervention for a v1 empire. */
  accessionWarResponse?: "none" | "imperial";
  /** Current crown's standing response to an authorized invasion of a member. */
  standingDefenseResponse?: "none" | "assist" | "imperial" | "both";
  /** Mandatory compare-and-swap epoch for imperial WAR policy mutations. */
  warPolicyVersion?: number;
}

export interface EmpireAccessionOffer {
  empireId: string;
  candidateId: string;
  proposerId: string;
  recipientId: string;
}

export interface PoliticsProjection {
  nations: PoliticsNation[];
  pacts: PoliticsPact[];
  empires: PoliticsEmpire[];
  accessionOffers: EmpireAccessionOffer[];
  simulationMs: number;
  /** Optional for original v1 snapshots. Monotonic across pact lifetimes. */
  admissionEpoch?: number;
  defenseAmendmentSequence?: number;
}

export type PoliticalPrize =
  | { kind: "SovereignVictor"; nationId: string }
  | { kind: "ImperialVictor"; nationId: string; empireId: string }
  | { kind: "EmpireVictor"; nationId: string; empireId: string };

export interface LastSovereignResult {
  sovereignPowerCount: number;
  resolved: boolean;
  prizes: PoliticalPrize[];
}

function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("NATIONAL politics: " + message);
}

function unique(items: string[]): boolean {
  return new Set(items).size === items.length;
}

function sorted(items: string[]): string[] {
  return [...items].sort();
}

export function usesAdmissionElection(rule: AdmissionRule): boolean {
  return rule === "selected" || rule === "majority" || rule === "supermajority";
}

export function hasExtendedPactTerms(terms: PactTerms): boolean {
  return (
    terms.membershipCap !== undefined ||
    terms.invitationDurationTicks !== undefined ||
    terms.expulsion === "selected" ||
    terms.expulsion === "majority" ||
    terms.expulsion === "supermajority"
  );
}

export function usesVersionedPact(p: PoliticsPact): boolean {
  return (
    p.extendedGovernance === true || usesAdmissionElection(p.terms.admission)
  );
}

export function clonePactTerms(terms: PactTerms): PactTerms {
  return {
    ...terms,
    ...(terms.selectedApproverIds === undefined
      ? {}
      : { selectedApproverIds: [...terms.selectedApproverIds] }),
    ...(terms.selectedExpellerIds === undefined
      ? {}
      : { selectedExpellerIds: [...terms.selectedExpellerIds] }),
  };
}

function validEpoch(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value < Number.MAX_SAFE_INTEGER
  );
}

function validatePactTerms(
  terms: PactTerms,
  members: string[],
  requireSelected: boolean,
): void {
  requireRule(
    ["leader", "unanimous", "selected", "majority", "supermajority"].includes(
      terms.admission,
    ),
    "invalid admission rule",
  );
  requireRule(
    [
      "leader",
      "unanimous",
      "forbidden",
      "selected",
      "majority",
      "supermajority",
    ].includes(terms.expulsion),
    "invalid expulsion rule",
  );
  requireRule(
    terms.membershipCap === undefined ||
      (Number.isSafeInteger(terms.membershipCap) &&
        terms.membershipCap >= Math.max(2, members.length) &&
        terms.membershipCap <= MAX_ADMISSION_VOTERS),
    "invalid membership cap or cap below current membership",
  );
  requireRule(
    terms.invitationDurationTicks === undefined ||
      (Number.isSafeInteger(terms.invitationDurationTicks) &&
        terms.invitationDurationTicks >= 1 &&
        terms.invitationDurationTicks <= 36000),
    "invalid invitation lifetime",
  );
  const expellers = terms.selectedExpellerIds;
  requireRule(
    terms.expulsion === "selected"
      ? Array.isArray(expellers) &&
          expellers.length <= MAX_ADMISSION_VOTERS &&
          (!requireSelected || expellers.length > 0) &&
          unique(expellers) &&
          expellers.every((id) => members.includes(id))
      : expellers === undefined,
    "invalid selected expulsion approvers",
  );
  const selected = terms.selectedApproverIds;
  requireRule(
    terms.admission === "selected"
      ? Array.isArray(selected) &&
          selected.length <= MAX_ADMISSION_VOTERS &&
          (!requireSelected || selected.length > 0) &&
          unique(selected) &&
          selected.every((id) => members.includes(id))
      : selected === undefined,
    "invalid selected admission approvers",
  );
}

function eligibleAdmissionVoters(p: PoliticsPact): string[] {
  if (p.terms.admission === "leader")
    return p.administratorId === null ? [] : [p.administratorId];
  if (p.terms.admission === "selected")
    return (p.terms.selectedApproverIds ?? []).filter((id) =>
      p.memberIds.includes(id),
    );
  return p.memberIds;
}

/** One shared predicate for the actual accept transition and all disclosures. */
export function pactAdmissionAuthorized(
  p: PoliticsPact,
  approvedBy: readonly string[],
): boolean {
  if (
    p.terms.membershipCap !== undefined &&
    p.memberIds.length >= p.terms.membershipCap
  )
    return false;
  const eligible = eligibleAdmissionVoters(p);
  if (eligible.length === 0) return false;
  const votes = eligible.filter((id) => approvedBy.includes(id)).length;
  const required =
    p.terms.admission === "majority"
      ? Math.floor(eligible.length / 2) + 1
      : p.terms.admission === "supermajority"
        ? Math.ceil((2 * eligible.length) / 3)
        : eligible.length;
  return votes >= required;
}

/** Electorate is the current roster minus the proposed target. Ties fail.
 * Strict majority = floor(n/2)+1; supermajority = ceil(2n/3).
 * Selected and unanimous require every eligible voter; empty electorates deny.
 */
export function eligibleExpulsionVoters(
  p: PoliticsPact,
  targetId: string,
): string[] {
  if (p.terms.expulsion === "forbidden") return [];
  const voters =
    p.terms.expulsion === "leader"
      ? p.administratorId === null
        ? []
        : [p.administratorId]
      : p.terms.expulsion === "selected"
        ? (p.terms.selectedExpellerIds ?? [])
        : p.memberIds;
  return voters.filter((id) => id !== targetId && p.memberIds.includes(id));
}

export function expulsionThreshold(
  p: PoliticsPact,
  eligibleCount: number,
): number {
  if (eligibleCount === 0) return 1;
  if (p.terms.expulsion === "majority")
    return Math.floor(eligibleCount / 2) + 1;
  if (p.terms.expulsion === "supermajority")
    return Math.ceil((2 * eligibleCount) / 3);
  return eligibleCount;
}

/** Membership/policy changes revoke all ballots. A candidate-only loss
 * rotates the epoch but preserves other candidates' lawfully cast ballots.
 * The global epoch prevents old commands from targeting a recycled pact ID.
 */
function revokeAdmissionElections(
  world: PoliticsProjection,
  p: PoliticsPact,
  excludedCandidateId?: string,
  preserveExisting = false,
): void {
  const epoch = (world.admissionEpoch ?? 0) + 1;
  requireRule(validEpoch(epoch), "admission epoch exhausted");
  world.admissionEpoch = epoch;
  p.constitutionVersion = epoch;
  const preserve = excludedCandidateId !== undefined || preserveExisting;
  p.invitations = !preserve
    ? []
    : p.invitations
        .filter((i) => i.targetId !== excludedCandidateId)
        .map((i) => ({ ...i, constitutionVersion: epoch }));
  if (!preserve) delete p.expulsionBallots;
  else if (p.expulsionBallots)
    p.expulsionBallots = p.expulsionBallots.map((b) => ({
      ...b,
      constitutionVersion: epoch,
    }));
}

function checkElectionVersion(p: PoliticsPact, expected?: number): void {
  requireRule(
    usesVersionedPact(p)
      ? validEpoch(expected) && expected === p.constitutionVersion
      : expected === undefined,
    "stale or invalid admission constitution version",
  );
}

function updateAdmissionAfterDeparture(
  world: PoliticsProjection,
  p: PoliticsPact,
  id: string,
): void {
  if (p.terms.admission === "selected")
    p.terms.selectedApproverIds = (p.terms.selectedApproverIds ?? []).filter(
      (member) => member !== id,
    );
  if (p.terms.expulsion === "selected")
    p.terms.selectedExpellerIds = (p.terms.selectedExpellerIds ?? []).filter(
      (member) => member !== id,
    );
  if (usesVersionedPact(p)) revokeAdmissionElections(world, p);
}

function installPactTerms(
  world: PoliticsProjection,
  p: PoliticsPact,
  terms: PactTerms,
): void {
  validatePactTerms(terms, p.memberIds, true);
  if (hasExtendedPactTerms(terms)) p.extendedGovernance = true;
  const governed =
    usesVersionedPact(p) || usesAdmissionElection(terms.admission);
  p.terms = clonePactTerms(terms);
  if (governed) revokeAdmissionElections(world, p);
}

/** Internal immutable transition copy, also used for atomic live sync. */
export function clonePoliticalProjection(
  world: PoliticsProjection,
): PoliticsProjection {
  return copy(world);
}

function copy(world: PoliticsProjection): PoliticsProjection {
  return {
    nations: world.nations.map((n) => ({ ...n, metrics: { ...n.metrics } })),
    pacts: world.pacts.map((p) => ({
      ...p,
      terms: clonePactTerms(p.terms),
      memberIds: [...p.memberIds],
      invitations: p.invitations.map((i) => ({
        ...i,
        approvedBy: [...i.approvedBy],
      })),
      ...(p.expulsionBallots === undefined
        ? {}
        : {
            expulsionBallots: p.expulsionBallots.map((b) => ({
              ...b,
              approvedBy: [...b.approvedBy],
            })),
          }),
      ...(p.pendingAmendment
        ? {
            pendingAmendment: {
              ...(p.pendingAmendment.defenseVersion === undefined
                ? {}
                : { defenseVersion: p.pendingAmendment.defenseVersion }),
              terms: clonePactTerms(p.pendingAmendment.terms),
              administratorId: p.pendingAmendment.administratorId,
              approvedBy: [...p.pendingAmendment.approvedBy],
            },
          }
        : {}),
    })),
    empires: world.empires.map((e) => ({
      ...e,
      memberIds: [...e.memberIds],
      ...(e.delegatedNationalPeace === undefined
        ? {}
        : { delegatedNationalPeace: [...e.delegatedNationalPeace] }),
      ...(e.delegatedNationalDeclarations === undefined
        ? {}
        : {
            delegatedNationalDeclarations: [...e.delegatedNationalDeclarations],
          }),
    })),
    accessionOffers: world.accessionOffers.map((o) => ({ ...o })),
    simulationMs: world.simulationMs,
    ...(world.admissionEpoch === undefined
      ? {}
      : { admissionEpoch: world.admissionEpoch }),
    ...(world.defenseAmendmentSequence === undefined
      ? {}
      : { defenseAmendmentSequence: world.defenseAmendmentSequence }),
  };
}

export function initialPolitics(nations: PoliticsNation[]): PoliticsProjection {
  const world: PoliticsProjection = {
    nations: nations.map((n) => ({ ...n, metrics: { ...n.metrics } })),
    pacts: [],
    empires: [],
    accessionOffers: [],
    simulationMs: 0,
  };
  validatePolitics(world);
  return world;
}

function hasDefenseTerms(terms: PactTerms): boolean {
  return (
    terms.defenseContributionBps !== undefined ||
    terms.defenseReserveBps !== undefined
  );
}

/** Validate persisted projection boundaries before executing or evaluating rules. */
export function validatePolitics(world: PoliticsProjection): void {
  requireRule(
    Number.isSafeInteger(world.simulationMs) && world.simulationMs >= 0,
    "invalid simulation clock",
  );
  requireRule(
    world.admissionEpoch === undefined || validEpoch(world.admissionEpoch),
    "invalid global admission epoch",
  );
  const pactEpochs = new Set<number>();
  requireRule(
    Number.isSafeInteger(world.defenseAmendmentSequence ?? 0) &&
      (world.defenseAmendmentSequence ?? 0) >= 0,
    "invalid defense amendment sequence",
  );
  const pendingDefenseVersions = new Set<number>();
  requireRule(unique(world.nations.map((n) => n.id)), "duplicate nation");
  requireRule(unique(world.pacts.map((p) => p.id)), "duplicate pact");
  requireRule(unique(world.empires.map((e) => e.id)), "duplicate empire");
  const nationById = new Map(world.nations.map((n) => [n.id, n]));
  const empireMemberIds: string[] = [];
  for (const n of world.nations) {
    requireRule(n.id.length > 0, "empty nation id");
    for (const key of METRIC_KEYS) {
      requireRule(
        Number.isSafeInteger(n.metrics[key]) && n.metrics[key] >= 0,
        "invalid " + key,
      );
    }
  }
  for (const e of world.empires) {
    requireRule(e.id.length > 0 && e.memberIds.length > 0, "empty empire");
    requireRule(unique(e.memberIds), "duplicate empire member");
    requireRule(
      e.memberIds.includes(e.leaderId),
      "imperial leader not a member",
    );
    requireRule(
      e.crisisDeadlineMs === null ||
        (Number.isSafeInteger(e.crisisDeadlineMs) && e.crisisDeadlineMs >= 0),
      "invalid crisis deadline",
    );
    const delegates = e.delegatedNationalPeace ?? [];
    requireRule(
      Array.isArray(delegates) &&
        unique(delegates) &&
        delegates.every(
          (id) =>
            typeof id === "string" &&
            id !== e.leaderId &&
            e.memberIds.includes(id),
        ),
      "invalid imperial national-peace delegation",
    );
    const declarers = e.delegatedNationalDeclarations ?? [];
    requireRule(
      Array.isArray(declarers) &&
        unique(declarers) &&
        declarers.every(
          (id) =>
            typeof id === "string" &&
            id !== e.leaderId &&
            e.memberIds.includes(id),
        ),
      "invalid imperial national-declaration delegation",
    );
    requireRule(
      e.accessionWarResponse === undefined ||
        e.accessionWarResponse === "none" ||
        e.accessionWarResponse === "imperial",
      "invalid imperial accession WAR response",
    );
    requireRule(
      e.standingDefenseResponse === undefined ||
        ["none", "assist", "imperial", "both"].includes(
          e.standingDefenseResponse,
        ),
      "invalid imperial standing DEFENSE response",
    );
    requireRule(
      e.warPolicyVersion === undefined ||
        (Number.isSafeInteger(e.warPolicyVersion) &&
          e.warPolicyVersion >= 0 &&
          e.warPolicyVersion < Number.MAX_SAFE_INTEGER),
      "invalid imperial WAR policy version",
    );
    for (const id of e.memberIds) {
      requireRule(nationById.get(id)?.alive, "empire member does not survive");
      empireMemberIds.push(id);
    }
  }
  requireRule(unique(empireMemberIds), "nation in multiple empires");
  for (const p of world.pacts) {
    requireRule(
      p.id.length > 0 && p.name.length > 0,
      "invalid pact identifier",
    );
    requireRule(p.kind === "NAP" || p.kind === "MDA", "invalid pact type");
    validateTreatyDefenseTerms(p.kind, p.terms);
    validatePactTerms(p.terms, p.memberIds, false);
    requireRule(
      (p.extendedGovernance === undefined || p.extendedGovernance === true) &&
        (!hasExtendedPactTerms(p.terms) || p.extendedGovernance === true),
      "invalid extended constitution marker",
    );
    const election = usesVersionedPact(p);
    if (p.constitutionVersion !== undefined) {
      requireRule(
        validEpoch(p.constitutionVersion) &&
          p.constitutionVersion <= (world.admissionEpoch ?? 0) &&
          !pactEpochs.has(p.constitutionVersion),
        "invalid or reused pact constitution version",
      );
      pactEpochs.add(p.constitutionVersion);
    }
    if (election)
      requireRule(
        p.constitutionVersion !== undefined &&
          p.memberIds.length <= MAX_ADMISSION_VOTERS &&
          p.invitations.length <= MAX_ADMISSION_RECORDS,
        "invalid threshold pact bounds",
      );
    requireRule(
      p.memberIds.length > 0 && unique(p.memberIds),
      "invalid pact roster",
    );
    requireRule(
      p.administratorId === null || p.memberIds.includes(p.administratorId),
      "administrator not a member",
    );
    if (p.pendingAmendment !== undefined) {
      const proposed = p.pendingAmendment;
      validateTreatyDefenseTerms(p.kind, proposed.terms);
      if (
        hasDefenseTerms(p.terms) ||
        hasDefenseTerms(proposed.terms) ||
        p.extendedGovernance ||
        hasExtendedPactTerms(proposed.terms)
      ) {
        const version = proposed.defenseVersion;
        requireRule(
          version !== undefined &&
            Number.isSafeInteger(version) &&
            version > 0 &&
            version <= (world.defenseAmendmentSequence ?? 0) &&
            !pendingDefenseVersions.has(version),
          "invalid defense amendment version",
        );
        pendingDefenseVersions.add(version);
      } else {
        requireRule(
          proposed.defenseVersion === undefined,
          "unexpected defense version",
        );
      }
      validatePactTerms(proposed.terms, p.memberIds, true);
      requireRule(
        proposed.administratorId === null ||
          p.memberIds.includes(proposed.administratorId),
        "pending amendment administrator not a member",
      );
      requireRule(
        proposed.approvedBy.length > 0 &&
          unique(proposed.approvedBy) &&
          proposed.approvedBy.every((id) => p.memberIds.includes(id)),
        "invalid authenticated amendment votes",
      );
    }
    for (const id of p.memberIds) {
      requireRule(nationById.get(id)?.alive, "pact member does not survive");
      requireRule(
        !empireMemberIds.includes(id),
        "imperial member in outside pact",
      );
    }
    requireRule(
      unique(p.invitations.map((i) => i.targetId)),
      "duplicate pact invitation",
    );
    if (p.expulsionBallots !== undefined) {
      requireRule(
        p.extendedGovernance === true &&
          p.expulsionBallots.length > 0 &&
          p.expulsionBallots.length <= MAX_ADMISSION_RECORDS &&
          unique(p.expulsionBallots.map((b) => b.targetId)),
        "invalid expulsion ballot records",
      );
      for (const b of p.expulsionBallots) {
        const eligible = eligibleExpulsionVoters(p, b.targetId);
        requireRule(
          p.memberIds.includes(b.targetId) &&
            b.constitutionVersion === p.constitutionVersion &&
            b.approvedBy.length > 0 &&
            unique(b.approvedBy) &&
            b.approvedBy.every((id) => eligible.includes(id)) &&
            b.approvedBy.length < expulsionThreshold(p, eligible.length),
          "invalid pending expulsion ballot",
        );
      }
    }
    requireRule(
      p.terms.membershipCap === undefined ||
        p.memberIds.length < p.terms.membershipCap ||
        p.invitations.length === 0,
      "full pact has pending invitations",
    );
    for (const invitation of p.invitations) {
      requireRule(
        p.terms.invitationDurationTicks === undefined
          ? invitation.expiresAtMs === undefined
          : invitation.expiresAtMs !== undefined &&
              Number.isSafeInteger(invitation.expiresAtMs) &&
              invitation.expiresAtMs % 100 === 0 &&
              invitation.expiresAtMs > world.simulationMs &&
              invitation.expiresAtMs <=
                world.simulationMs + p.terms.invitationDurationTicks * 100,
        "invalid or expired invitation deadline",
      );
      requireRule(
        nationById.get(invitation.targetId)?.alive &&
          !p.memberIds.includes(invitation.targetId) &&
          !empireMemberIds.includes(invitation.targetId),
        "invalid pact invitation recipient",
      );
      requireRule(
        unique(invitation.approvedBy) &&
          invitation.approvedBy.every((id) => p.memberIds.includes(id)),
        "invalid pact admission votes",
      );
      if (election) {
        requireRule(
          invitation.constitutionVersion === p.constitutionVersion &&
            typeof invitation.proposerId === "string" &&
            invitation.approvedBy.includes(invitation.proposerId) &&
            invitation.approvedBy.length <= MAX_ADMISSION_VOTERS &&
            invitation.approvedBy.every((id) =>
              eligibleAdmissionVoters(p).includes(id),
            ),
          "invalid versioned admission ballot",
        );
      } else {
        requireRule(
          invitation.constitutionVersion === undefined &&
            invitation.proposerId === undefined,
          "unexpected legacy admission ballot version",
        );
      }
    }
  }
  requireRule(
    unique(world.accessionOffers.map((o) => o.empireId + "\0" + o.candidateId)),
    "duplicate empire accession offer",
  );
  for (const offer of world.accessionOffers) {
    const empire = world.empires.find((e) => e.id === offer.empireId);
    requireRule(empire !== undefined, "offer references missing empire");
    requireRule(
      nationById.get(offer.candidateId)?.alive &&
        !empireMemberIds.includes(offer.candidateId),
      "offer candidate not independent",
    );
    requireRule(
      (offer.proposerId === empire.leaderId &&
        offer.recipientId === offer.candidateId) ||
        (offer.proposerId === offer.candidateId &&
          offer.recipientId === empire.leaderId),
      "invalid accession consent direction",
    );
  }
}

function living(world: PoliticsProjection, id: string): PoliticsNation {
  const n = world.nations.find((n) => n.id === id);
  requireRule(n?.alive, "nation is missing or eliminated: " + id);
  return n;
}

function pact(world: PoliticsProjection, id: string): PoliticsPact {
  const p = world.pacts.find((p) => p.id === id);
  requireRule(p !== undefined, "unknown pact: " + id);
  return p;
}

function empire(world: PoliticsProjection, id: string): PoliticsEmpire {
  const e = world.empires.find((e) => e.id === id);
  requireRule(e !== undefined, "unknown empire: " + id);
  return e;
}

export function empireOf(
  world: PoliticsProjection,
  nationId: string,
): string | null {
  return world.empires.find((e) => e.memberIds.includes(nationId))?.id ?? null;
}

function independent(world: PoliticsProjection, id: string): void {
  living(world, id);
  requireRule(
    empireOf(world, id) === null,
    "imperial states have exclusive membership",
  );
}

function removePactMember(world: PoliticsProjection, id: string): void {
  world.pacts = world.pacts.flatMap((p) => {
    if (!p.memberIds.includes(id)) {
      if (usesVersionedPact(p) && p.invitations.some((i) => i.targetId === id))
        revokeAdmissionElections(world, p, id);
      else p.invitations = p.invitations.filter((i) => i.targetId !== id);
      return [p];
    }
    p.memberIds = p.memberIds.filter((m) => m !== id);
    // An old roster cannot authorize a new roster's constitution.
    delete p.pendingAmendment;
    p.invitations = p.invitations
      .filter((i) => i.targetId !== id)
      .map((i) => ({ ...i, approvedBy: i.approvedBy.filter((v) => v !== id) }));
    if (p.administratorId === id) p.administratorId = null;
    updateAdmissionAfterDeparture(world, p, id);
    // A one-party contract has no second signatory; its last member remains sovereign.
    return p.memberIds.length >= 2 ? [p] : [];
  });
}

function advance(world: PoliticsProjection, simulationMs: number): void {
  requireRule(
    Number.isSafeInteger(simulationMs) && simulationMs >= world.simulationMs,
    "clock must be monotonic",
  );
  world.simulationMs = simulationMs;
  for (const p of world.pacts) {
    const active = p.invitations.filter(
      (i) => i.expiresAtMs === undefined || i.expiresAtMs > simulationMs,
    );
    if (active.length !== p.invitations.length) {
      p.invitations = active;
      revokeAdmissionElections(world, p, undefined, true);
    }
  }
}

/** No ordinary pact can merge powers for victory purposes (SOV-01, 02, 03, 07). */
export function lastSovereignVictory(
  world: PoliticsProjection,
): LastSovereignResult {
  validatePolitics(world);
  const independentNations = world.nations
    .filter((n) => n.alive && empireOf(world, n.id) === null)
    .map((n) => n.id);
  const count = independentNations.length + world.empires.length;
  if (count !== 1)
    return { sovereignPowerCount: count, resolved: false, prizes: [] };
  if (independentNations.length === 1) {
    return {
      sovereignPowerCount: 1,
      resolved: true,
      prizes: [{ kind: "SovereignVictor", nationId: independentNations[0] }],
    };
  }
  const e = world.empires[0];
  return {
    sovereignPowerCount: 1,
    resolved: true,
    prizes: [
      { kind: "ImperialVictor", nationId: e.leaderId, empireId: e.id },
      ...sorted(e.memberIds.filter((id) => id !== e.leaderId)).map(
        (nationId): PoliticalPrize => ({
          kind: "EmpireVictor",
          nationId,
          empireId: e.id,
        }),
      ),
    ],
  };
}

export function foundPact(
  world: PoliticsProjection,
  input: {
    id: string;
    name: string;
    kind: PactKind;
    founderId: string;
    terms: PactTerms;
  },
): PoliticsProjection {
  validatePolitics(world);
  independent(world, input.founderId);
  requireRule(
    !world.pacts.some((p) => p.id === input.id),
    "pact id already used",
  );
  const next = copy(world);
  validatePactTerms(input.terms, [input.founderId], true);
  next.pacts.push({
    id: input.id,
    name: input.name,
    kind: input.kind,
    memberIds: [input.founderId],
    administratorId: input.founderId,
    terms: clonePactTerms(input.terms),
    invitations: [],
    ...(hasExtendedPactTerms(input.terms)
      ? { extendedGovernance: true as const }
      : {}),
  });
  if (usesVersionedPact(pact(next, input.id)))
    revokeAdmissionElections(next, pact(next, input.id));
  validatePolitics(next);
  return next;
}

export function inviteToPact(
  world: PoliticsProjection,
  pactId: string,
  proposerId: string,
  candidateId: string,
  constitutionVersion?: number,
): PoliticsProjection {
  validatePolitics(world);
  independent(world, candidateId);
  const p = pact(world, pactId);
  checkElectionVersion(p, constitutionVersion);
  requireRule(p.memberIds.includes(proposerId), "not a pact member");
  requireRule(
    p.terms.membershipCap === undefined ||
      p.memberIds.length < p.terms.membershipCap,
    "membership cap reached",
  );
  const election = usesVersionedPact(p);
  if (election)
    requireRule(
      eligibleAdmissionVoters(p).includes(proposerId) &&
        p.invitations.length < MAX_ADMISSION_RECORDS &&
        p.memberIds.length < MAX_ADMISSION_VOTERS,
      "ineligible proposer or admission capacity reached",
    );
  requireRule(!p.memberIds.includes(candidateId), "already a member");
  requireRule(
    !p.invitations.some((i) => i.targetId === candidateId),
    "invitation already pending",
  );
  if (p.terms.admission === "leader")
    requireRule(p.administratorId === proposerId, "leader must invite");
  const next = copy(world);
  pact(next, pactId).invitations.push({
    targetId: candidateId,
    approvedBy: [proposerId],
    ...(election ? { constitutionVersion, proposerId } : {}),
    ...(p.terms.invitationDurationTicks === undefined
      ? {}
      : {
          expiresAtMs:
            (Math.floor(world.simulationMs / 100) +
              p.terms.invitationDurationTicks) *
            100,
        }),
  });
  validatePolitics(next);
  return next;
}

export function approvePactInvitation(
  world: PoliticsProjection,
  pactId: string,
  voterId: string,
  candidateId: string,
  constitutionVersion?: number,
): PoliticsProjection {
  validatePolitics(world);
  const p = pact(world, pactId);
  checkElectionVersion(p, constitutionVersion);
  requireRule(p.memberIds.includes(voterId), "approval requires member");
  const i = p.invitations.find((i) => i.targetId === candidateId);
  requireRule(i !== undefined, "invitation missing");
  if (usesVersionedPact(p))
    requireRule(
      eligibleAdmissionVoters(p).includes(voterId) &&
        !i.approvedBy.includes(voterId),
      "ineligible or duplicate admission voter",
    );
  if (p.terms.admission === "leader")
    requireRule(voterId === p.administratorId, "leader approval required");
  const next = copy(world);
  const invitation = pact(next, pactId).invitations.find(
    (i) => i.targetId === candidateId,
  )!;
  invitation.approvedBy = sorted([
    ...new Set([...invitation.approvedBy, voterId]),
  ]);
  validatePolitics(next);
  return next;
}

/** Only the actual applicant can withdraw; revoke the epoch to prevent replay. */
export function withdrawPactInvitation(
  world: PoliticsProjection,
  pactId: string,
  actorId: string,
  candidateId: string,
  constitutionVersion?: number,
): PoliticsProjection {
  validatePolitics(world);
  independent(world, actorId);
  const p = pact(world, pactId);
  checkElectionVersion(p, constitutionVersion);
  requireRule(
    usesVersionedPact(p) &&
      actorId === candidateId &&
      p.invitations.some(
        (i) =>
          i.targetId === actorId && pactAdmissionAuthorized(p, i.approvedBy),
      ),
    "only an authorized applicant may withdraw",
  );
  const next = copy(world);
  revokeAdmissionElections(next, pact(next, pactId), actorId);
  validatePolitics(next);
  return next;
}

export function acceptPactInvitation(
  world: PoliticsProjection,
  pactId: string,
  candidateId: string,
  constitutionVersion?: number,
): PoliticsProjection {
  validatePolitics(world);
  independent(world, candidateId);
  const p = pact(world, pactId);
  checkElectionVersion(p, constitutionVersion);
  const invitation = p.invitations.find((i) => i.targetId === candidateId);
  requireRule(invitation !== undefined, "no invitation to accept");
  requireRule(
    p.terms.membershipCap === undefined ||
      p.memberIds.length < p.terms.membershipCap,
    "membership cap reached",
  );
  requireRule(
    invitation.expiresAtMs === undefined ||
      world.simulationMs < invitation.expiresAtMs,
    "invitation expired",
  );
  requireRule(
    pactAdmissionAuthorized(p, invitation.approvedBy),
    "constitutional admission approvals missing",
  );
  const next = copy(world);
  const target = pact(next, pactId);
  target.memberIds = sorted([...target.memberIds, candidateId]);
  delete target.pendingAmendment;
  target.invitations = target.invitations.filter(
    (i) => i.targetId !== candidateId,
  );
  if (usesVersionedPact(target)) revokeAdmissionElections(next, target);
  validatePolitics(next);
  return next;
}

export function amendPact(
  world: PoliticsProjection,
  pactId: string,
  proposed: { terms: PactTerms; administratorId: string | null },
  consentingMemberIds: string[],
): PoliticsProjection {
  validatePolitics(world);
  const p = pact(world, pactId);
  requireRule(
    unique(consentingMemberIds) &&
      consentingMemberIds.length === p.memberIds.length &&
      p.memberIds.every((id) => consentingMemberIds.includes(id)),
    "unanimous constitutional consent required",
  );
  requireRule(
    proposed.administratorId === null ||
      p.memberIds.includes(proposed.administratorId),
    "administrator must be a member",
  );
  const next = copy(world);
  const target = pact(next, pactId);
  installPactTerms(next, target, proposed.terms);
  target.administratorId = proposed.administratorId;
  delete target.pendingAmendment;
  validatePolitics(next);
  return next;
}

/**
 * Propose a constitutional change as the real, Game-authenticated actor.
 * Never accept a client-supplied roster of consenting voters.
 */
export function proposePactAmendment(
  world: PoliticsProjection,
  pactId: string,
  actorId: string,
  proposed: { terms: PactTerms; administratorId: string | null },
): PoliticsProjection {
  validatePolitics(world);
  const current = pact(world, pactId);
  requireRule(current.memberIds.includes(actorId), "amendment requires member");
  requireRule(
    current.pendingAmendment === undefined,
    "constitutional amendment already pending",
  );
  requireRule(
    proposed.administratorId === null ||
      current.memberIds.includes(proposed.administratorId),
    "administrator must be a member",
  );
  const next = copy(world);
  const target = pact(next, pactId);
  const versioned =
    hasDefenseTerms(current.terms) ||
    hasDefenseTerms(proposed.terms) ||
    current.extendedGovernance === true ||
    hasExtendedPactTerms(proposed.terms);
  const defenseVersion = (next.defenseAmendmentSequence ?? 0) + 1;
  if (versioned) {
    requireRule(
      Number.isSafeInteger(defenseVersion),
      "defense version exhausted",
    );
    next.defenseAmendmentSequence = defenseVersion;
  }
  target.pendingAmendment = {
    ...(versioned ? { defenseVersion } : {}),
    terms: clonePactTerms(proposed.terms),
    administratorId: proposed.administratorId,
    approvedBy: [actorId],
  };
  // A one-member pact has exactly one constitutional voter.
  if (target.memberIds.length === 1) {
    installPactTerms(next, target, proposed.terms);
    target.administratorId = proposed.administratorId;
    delete target.pendingAmendment;
  }
  validatePolitics(next);
  return next;
}

/** Commit only when every CURRENT member has separately authenticated a vote. */
export function approvePactAmendment(
  world: PoliticsProjection,
  pactId: string,
  actorId: string,
  expectedDefenseVersion?: number,
  reject = false,
): PoliticsProjection {
  validatePolitics(world);
  const current = pact(world, pactId);
  requireRule(current.memberIds.includes(actorId), "amendment requires member");
  requireRule(
    current.pendingAmendment !== undefined,
    "constitutional amendment not pending",
  );
  requireRule(
    current.pendingAmendment.defenseVersion === expectedDefenseVersion,
    "stale defense amendment version",
  );
  const next = copy(world);
  const target = pact(next, pactId);
  const pending = target.pendingAmendment!;
  if (reject) {
    requireRule(
      expectedDefenseVersion !== undefined,
      "versioned amendment rejection required",
    );
    delete target.pendingAmendment;
    validatePolitics(next);
    return next;
  }
  pending.approvedBy = sorted([...new Set([...pending.approvedBy, actorId])]);
  if (target.memberIds.every((id) => pending.approvedBy.includes(id))) {
    installPactTerms(next, target, pending.terms);
    target.administratorId = pending.administratorId;
    delete target.pendingAmendment;
  }
  validatePolitics(next);
  return next;
}

export function expelPactMember(
  world: PoliticsProjection,
  pactId: string,
  actorId: string,
  targetId: string,
  approvingIds: string[] = [],
): PoliticsProjection {
  validatePolitics(world);
  const p = pact(world, pactId);
  requireRule(p.memberIds.includes(targetId), "target not a pact member");
  requireRule(p.memberIds.includes(actorId), "actor not a pact member");
  requireRule(actorId !== targetId, "use Betray for voluntary withdrawal");
  requireRule(!p.extendedGovernance, "versioned expulsion ballot required");
  requireRule(
    p.terms.expulsion !== "forbidden",
    "discretionary expulsion forbidden",
  );
  if (p.terms.expulsion === "leader") {
    requireRule(p.administratorId === actorId, "only pact leader may expel");
  } else {
    requireRule(
      unique(approvingIds) &&
        p.memberIds.every((id) => id === targetId || approvingIds.includes(id)),
      "remaining members must consent to expulsion",
    );
  }
  const next = copy(world);
  removeMemberFromOnePact(next, pactId, targetId);
  validatePolitics(next);
  return next;
}

/** One authenticated actor casts one vote. No client-supplied vote roster.
 * Reaching the threshold immediately executes the ordinary expulsion transition.
 */
export function votePactExpulsion(
  world: PoliticsProjection,
  pactId: string,
  actorId: string,
  targetId: string,
  constitutionVersion: number,
): PoliticsProjection {
  validatePolitics(world);
  const p = pact(world, pactId);
  requireRule(p.extendedGovernance === true, "extended constitution required");
  checkElectionVersion(p, constitutionVersion);
  requireRule(p.memberIds.includes(targetId), "target not a pact member");
  const eligible = eligibleExpulsionVoters(p, targetId);
  requireRule(eligible.includes(actorId), "ineligible expulsion voter");
  const existing = p.expulsionBallots?.find((b) => b.targetId === targetId);
  requireRule(
    !existing?.approvedBy.includes(actorId),
    "duplicate expulsion vote",
  );
  const next = copy(world);
  const target = pact(next, pactId);
  const approvedBy = sorted([...(existing?.approvedBy ?? []), actorId]);
  if (approvedBy.length >= expulsionThreshold(p, eligible.length)) {
    removeMemberFromOnePact(next, pactId, targetId);
  } else {
    const ballots = target.expulsionBallots ?? [];
    requireRule(
      existing !== undefined || ballots.length < MAX_ADMISSION_RECORDS,
      "too many expulsion ballots",
    );
    target.expulsionBallots = [
      ...ballots.filter((b) => b.targetId !== targetId),
      { targetId, constitutionVersion, approvedBy },
    ].sort((a, b) =>
      a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0,
    );
  }
  validatePolitics(next);
  return next;
}

function removeMemberFromOnePact(
  world: PoliticsProjection,
  pactId: string,
  memberId: string,
): void {
  const target = pact(world, pactId);
  target.memberIds = target.memberIds.filter((id) => id !== memberId);
  delete target.pendingAmendment;
  target.invitations = target.invitations.map((i) => ({
    ...i,
    approvedBy: i.approvedBy.filter((id) => id !== memberId),
  }));
  if (target.administratorId === memberId) target.administratorId = null;
  updateAdmissionAfterDeparture(world, target, memberId);
  if (target.memberIds.length < 2)
    world.pacts = world.pacts.filter((p) => p.id !== pactId);
}

/** Immediate, nonwaivable sovereign exit even when discretionary expulsion is prohibited. */
export function betrayPact(
  world: PoliticsProjection,
  pactId: string,
  betrayerId: string,
): PoliticsProjection {
  validatePolitics(world);
  independent(world, betrayerId);
  requireRule(
    pact(world, pactId).memberIds.includes(betrayerId),
    "not a member",
  );
  const next = copy(world);
  removeMemberFromOnePact(next, pactId, betrayerId);
  validatePolitics(next);
  return next;
}

/**
 * Treaty legality only: caller MUST separately enforce the formal-war rules.
 * Caller must atomically commit returned state with an authorized game attack.
 * Without explicit confirmation, no treaty is severed (COAL-05).
 */
export function preparePactAttack(
  world: PoliticsProjection,
  aggressorId: string,
  defenderId: string,
  confirmBetrayal: boolean,
): { state: PoliticsProjection; betrayedPactIds: string[] } {
  validatePolitics(world);
  living(world, aggressorId);
  living(world, defenderId);
  requireRule(aggressorId !== defenderId, "cannot attack self");
  const shared = sorted(
    world.pacts
      .filter(
        (p) =>
          p.memberIds.includes(aggressorId) && p.memberIds.includes(defenderId),
      )
      .map((p) => p.id),
  );
  requireRule(
    shared.length === 0 || confirmBetrayal,
    "betrayal confirmation required before co-member attack",
  );
  let next = world;
  for (const pactId of shared) next = betrayPact(next, pactId, aggressorId);
  return { state: next, betrayedPactIds: shared };
}

export function foundEmpire(
  world: PoliticsProjection,
  empireId: string,
  founderId: string,
): PoliticsProjection {
  validatePolitics(world);
  independent(world, founderId);
  requireRule(
    !world.empires.some((e) => e.id === empireId),
    "empire id already used",
  );
  const next = copy(world);
  removePactMember(next, founderId);
  // The founder is no longer an independent accession candidate. Invalidate
  // every outstanding invitation before validating the new exclusive roster.
  // Otherwise a sovereign's earlier invitation could block founding forever.
  next.accessionOffers = next.accessionOffers.filter(
    (offer) => offer.candidateId !== founderId,
  );
  next.empires.push({
    id: empireId,
    leaderId: founderId,
    memberIds: [founderId],
    crisisDeadlineMs: null,
  });
  validatePolitics(next);
  return next;
}

export function proposeEmpireAccession(
  world: PoliticsProjection,
  empireId: string,
  proposerId: string,
  candidateId: string,
): PoliticsProjection {
  validatePolitics(world);
  independent(world, candidateId);
  const e = empire(world, empireId);
  requireRule(
    proposerId === e.leaderId || proposerId === candidateId,
    "only candidate or emperor may propose accession",
  );
  requireRule(
    !world.accessionOffers.some(
      (o) => o.empireId === empireId && o.candidateId === candidateId,
    ),
    "accession offer already pending",
  );
  const next = copy(world);
  next.accessionOffers.push({
    empireId,
    proposerId,
    candidateId,
    recipientId: proposerId === candidateId ? e.leaderId : candidateId,
  });
  validatePolitics(next);
  return next;
}

/** Both sides consent. Ordinary pact exits are atomic; individual wars are not changed. */
export function acceptEmpireAccession(
  world: PoliticsProjection,
  empireId: string,
  recipientId: string,
  candidateId: string,
): PoliticsProjection {
  validatePolitics(world);
  independent(world, candidateId);
  const offer = world.accessionOffers.find(
    (o) => o.empireId === empireId && o.candidateId === candidateId,
  );
  requireRule(
    offer !== undefined && offer.recipientId === recipientId,
    "recipient consent required",
  );
  const next = copy(world);
  removePactMember(next, candidateId);
  const e = empire(next, empireId);
  e.memberIds = sorted([...e.memberIds, candidateId]);
  next.accessionOffers = next.accessionOffers.filter(
    (o) => o.candidateId !== candidateId,
  );
  validatePolitics(next);
  return next;
}

/**
 * M5/WAR-05: emperor grants or withdraws a subordinate's authority to
 * negotiate only THAT MEMBER'S national war. The canonical WAR ledger reads
 * this Game-snapshotted policy through PoliticalAuthorityAdapter; imperial
 * war remains exclusively the incumbent emperor's responsibility.
 */
export function setNationalPeaceDelegation(
  world: PoliticsProjection,
  empireId: string,
  actorId: string,
  memberId: string,
  enabled: boolean,
): PoliticsProjection {
  validatePolitics(world);
  const current = empire(world, empireId);
  requireRule(
    current.leaderId === actorId,
    "only incumbent emperor may change national peace delegation",
  );
  requireRule(
    current.memberIds.includes(memberId) && memberId !== current.leaderId,
    "national peace delegate must be a surviving subordinate member",
  );
  requireRule(typeof enabled === "boolean", "invalid delegation policy");
  const delegates = current.delegatedNationalPeace ?? [];
  requireRule(
    delegates.includes(memberId) !== enabled,
    "national peace delegation already in requested state",
  );
  const next = copy(world);
  const target = empire(next, empireId);
  const updated = enabled
    ? sorted([...delegates, memberId])
    : delegates.filter((id) => id !== memberId);
  // Omit the empty policy, preserving the original v1 snapshots exactly.
  if (updated.length > 0) target.delegatedNationalPeace = updated;
  else delete target.delegatedNationalPeace;
  target.warPolicyVersion = (target.warPolicyVersion ?? 0) + 1;
  validatePolitics(next);
  return next;
}

/**
 * WAR-08: a single crown-authored, CAS-guarded policy transaction.
 * An old policy version cannot overwrite succession, revocation, or a prior
 * change. The default never escalates preexisting independent national wars.
 * This never delegates imperial diplomacy.
 */
export function setImperialWarPolicy(
  world: PoliticsProjection,
  empireId: string,
  actorId: string,
  expectedVersion: number,
  response: "none" | "imperial",
  declarationDelegates: readonly string[],
  peaceDelegates: readonly string[],
): PoliticsProjection {
  validatePolitics(world);
  const current = empire(world, empireId);
  requireRule(
    current.leaderId === actorId,
    "only incumbent emperor may change WAR policy",
  );
  requireRule(
    Number.isSafeInteger(expectedVersion) &&
      expectedVersion >= 0 &&
      expectedVersion === (current.warPolicyVersion ?? 0),
    "stale imperial WAR policy version",
  );
  requireRule(
    response === "none" || response === "imperial",
    "invalid imperial WAR response",
  );
  const validDelegates = (ids: readonly string[]) =>
    Array.isArray(ids) &&
    new Set(ids).size === ids.length &&
    ids.every(
      (id) =>
        typeof id === "string" &&
        id !== current.leaderId &&
        current.memberIds.includes(id),
    );
  requireRule(
    validDelegates(declarationDelegates) && validDelegates(peaceDelegates),
    "invalid imperial WAR delegates",
  );
  const next = copy(world);
  const target = empire(next, empireId);
  target.accessionWarResponse = response;
  if (declarationDelegates.length)
    target.delegatedNationalDeclarations = sorted([...declarationDelegates]);
  else delete target.delegatedNationalDeclarations;
  if (peaceDelegates.length)
    target.delegatedNationalPeace = sorted([...peaceDelegates]);
  else delete target.delegatedNationalPeace;
  target.warPolicyVersion = expectedVersion + 1;
  validatePolitics(next);
  return next;
}

/**
 * D-011: separate incoming-attack doctrine from accession-time WAR policy.
 * Shares the existing WAR epoch so either amendment revokes queued grants.
 * The current crown is the only writer. Transfer of the crown revokes the
 * outgoing emperor's doctrine and invalidates all stale policy CAS epochs.
 */
export function setImperialStandingDefensePolicy(
  world: PoliticsProjection,
  empireId: string,
  actorId: string,
  expectedVersion: number,
  response: "none" | "assist" | "imperial" | "both",
): PoliticsProjection {
  validatePolitics(world);
  const current = empire(world, empireId);
  requireRule(
    current.leaderId === actorId,
    "only incumbent emperor may change DEFENSE policy",
  );
  requireRule(
    Number.isSafeInteger(expectedVersion) &&
      expectedVersion >= 0 &&
      expectedVersion === (current.warPolicyVersion ?? 0),
    "stale imperial DEFENSE policy version",
  );
  requireRule(
    response === "none" ||
      response === "assist" ||
      response === "imperial" ||
      response === "both",
    "invalid imperial DEFENSE response",
  );
  const next = copy(world);
  const target = empire(next, empireId);
  target.standingDefenseResponse = response;
  target.warPolicyVersion = expectedVersion + 1;
  validatePolitics(next);
  return next;
}

/** Emperor may always transfer to a *surviving constituent*, without changing empire identity. */
export function transferCrown(
  world: PoliticsProjection,
  empireId: string,
  actorId: string,
  successorId: string,
  simulationMs: number = world.simulationMs,
): PoliticsProjection {
  validatePolitics(world);
  const e = empire(world, empireId);
  requireRule(
    e.leaderId === actorId,
    "only the incumbent emperor may transfer the crown",
  );
  requireRule(
    e.memberIds.includes(successorId) && successorId !== actorId,
    "invalid successor",
  );
  requireRule(
    e.crisisDeadlineMs === null || simulationMs < e.crisisDeadlineMs,
    "Ungovernable deadline already expired",
  );
  const next = copy(world);
  advance(next, simulationMs);
  const target = empire(next, empireId);
  target.leaderId = successorId;
  target.crisisDeadlineMs = null;
  // An old crown's standing WAR response cannot commit after succession.
  // The new emperor must affirmatively authorize a fresh attack-time doctrine.
  delete target.standingDefenseResponse;
  // Grants are appointments of the outgoing crown: NONE survive succession.
  // The successor may issue fresh grants through a new authenticated command.
  delete target.delegatedNationalPeace;
  delete target.delegatedNationalDeclarations;
  target.warPolicyVersion = (target.warPolicyVersion ?? 0) + 1;
  // Outstanding accession offers from the old emperor are invalidated.
  next.accessionOffers = next.accessionOffers.filter(
    (o) => o.empireId !== empireId,
  );
  validatePolitics(next);
  return next;
}

function dissolve(world: PoliticsProjection, empireId: string): void {
  world.empires = world.empires.filter((e) => e.id !== empireId);
  world.accessionOffers = world.accessionOffers.filter(
    (o) => o.empireId !== empireId,
  );
}

/** Politics-only dissolution. Fiscal/army redistribution awaits conductor M0 accounting. */
export function dissolveEmpire(
  world: PoliticsProjection,
  empireId: string,
  actorId: string,
): PoliticsProjection {
  validatePolitics(world);
  requireRule(
    empire(world, empireId).leaderId === actorId,
    "only emperor may voluntarily dissolve",
  );
  const next = copy(world);
  dissolve(next, empireId);
  validatePolitics(next);
  return next;
}

/** Applies death before victory evaluation, dissolving a leaderless empire atomically. */
export function eliminatePoliticalNation(
  world: PoliticsProjection,
  nationId: string,
): PoliticsProjection {
  validatePolitics(world);
  living(world, nationId);
  const next = copy(world);
  next.nations.find((n) => n.id === nationId)!.alive = false;
  removePactMember(next, nationId);
  for (const e of [...next.empires]) {
    if (!e.memberIds.includes(nationId)) continue;
    if (e.leaderId === nationId) dissolve(next, e.id);
    else {
      e.memberIds = e.memberIds.filter((id) => id !== nationId);
      if (e.delegatedNationalPeace !== undefined)
        e.delegatedNationalPeace = e.delegatedNationalPeace.filter(
          (id) => id !== nationId,
        );
      if (e.delegatedNationalDeclarations !== undefined)
        e.delegatedNationalDeclarations =
          e.delegatedNationalDeclarations.filter((id) => id !== nationId);
      e.warPolicyVersion = (e.warPolicyVersion ?? 0) + 1;
    }
  }
  next.accessionOffers = next.accessionOffers.filter(
    (o) =>
      o.candidateId !== nationId &&
      o.proposerId !== nationId &&
      o.recipientId !== nationId,
  );
  validatePolitics(next);
  return next;
}

function strictlyWeakest(
  world: PoliticsProjection,
  e: PoliticsEmpire,
): boolean {
  const rivals = e.memberIds.filter((id) => id !== e.leaderId);
  if (rivals.length === 0) return false;
  const ruler = living(world, e.leaderId);
  return METRIC_KEYS.every((key) =>
    rivals.every((id) => ruler.metrics[key] < living(world, id).metrics[key]),
  );
}

/** Tick-bound, strict eight-metric, ten-second window. No Date.now() or implicit timers. */
export function evaluateUngovernable(
  world: PoliticsProjection,
  simulationMs: number,
  /** False until the emperor's pooled assets have a conservation-safe owner. */
  allowCollapse = true,
): {
  state: PoliticsProjection;
  warnings: { empireId: string; deadlineMs: number }[];
  collapsed: string[];
} {
  validatePolitics(world);
  const next = copy(world);
  advance(next, simulationMs);
  const warnings: { empireId: string; deadlineMs: number }[] = [];
  const collapsed: string[] = [];
  for (const e of sorted(next.empires.map((e) => e.id))) {
    const target = empire(next, e);
    if (!strictlyWeakest(next, target)) {
      target.crisisDeadlineMs = null;
      continue;
    }
    target.crisisDeadlineMs ??= simulationMs + IMPERIAL_CRISIS_MS;
    if (simulationMs >= target.crisisDeadlineMs && allowCollapse) {
      collapsed.push(e);
      dissolve(next, e);
    } else {
      // When disposition is unapproved, retain the expired deadline as a
      // durable blocked warning; never dissolve and strand pooled assets.
      warnings.push({ empireId: e, deadlineMs: target.crisisDeadlineMs });
    }
  }
  validatePolitics(next);
  return { state: next, warnings, collapsed };
}

/**
 * Deliberately whitelisted public view. Never serialize PoliticsProjection
 * itself as a client payload: it contains private treaty terms and invitations.
 */
export function viewPact(
  world: PoliticsProjection,
  pactId: string,
  viewerId: string | null,
): {
  id: string;
  name: string;
  kind: PactKind;
  memberIds: string[];
  administratorId: string | null;
  terms?: PactTerms;
} {
  validatePolitics(world);
  const p = pact(world, pactId);
  const invited = p.invitations.some(
    (i) => i.targetId === viewerId && pactAdmissionAuthorized(p, i.approvedBy),
  );
  const privileged =
    viewerId !== null && (p.memberIds.includes(viewerId) || invited);
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    memberIds: [...p.memberIds],
    administratorId: p.administratorId,
    ...(privileged ? { terms: clonePactTerms(p.terms) } : {}),
  };
}
