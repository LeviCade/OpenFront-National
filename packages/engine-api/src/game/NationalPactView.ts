import {
  coalitionEligibleExpellers,
  coalitionExpulsionThreshold,
  extendedCoalitionTerms,
  boundedCoalitionInteger,
} from "./NationalCoalitionConstitution";
import { readNationalConfirmedVictory } from "./NationalVictoryView";

/** Detached wire contract. No engine state or client-derived political authority. */
export interface NationalPublicPactView {
  readonly id: string;
  readonly name: string;
  readonly kind: "NAP" | "MDA";
  readonly memberIds: readonly string[];
  readonly administratorId: string | null;
}
export interface NationalPactTerms {
  readonly admission:
    | "leader"
    | "unanimous"
    | "selected"
    | "majority"
    | "supermajority";
  readonly selectedApproverIds?: string[];
  readonly expulsion:
    | "leader"
    | "unanimous"
    | "forbidden"
    | "selected"
    | "majority"
    | "supermajority";
  readonly membershipCap?: number;
  readonly invitationDurationTicks?: number;
  readonly selectedExpellerIds?: string[];
  readonly defenseContributionBps?: number;
  readonly defenseReserveBps?: number;
}
export interface NationalPactDisclosure {
  readonly pactId: string;
  readonly relationship: "member" | "invited";
  readonly terms: NationalPactTerms;
  readonly constitutionVersion?: number;
  readonly extendedGovernance?: true;
  readonly invitationExpiresAtTick?: number;
  readonly expulsionBallots?: readonly {
    readonly targetId: string;
    readonly approvedBy: readonly string[];
  }[];
  readonly invitations?: readonly {
    readonly targetId: string;
    readonly approvedBy: readonly string[];
    readonly authorized: boolean;
    readonly expiresAtTick?: number;
  }[];
  readonly pendingAmendment?: {
    readonly defenseVersion?: number;
    readonly terms: NationalPactTerms;
    readonly administratorId: string | null;
    readonly approvedBy: readonly string[];
  };
}
export interface NationalPactDisclosureViewData {
  readonly version: 1;
  readonly recipientId: string;
  readonly pacts: readonly NationalPactDisclosure[];
}
/** E4 adds freshness and native socket epoch AFTER E1's canonical read. */
export interface NationalPactDisclosureWireData extends NationalPactDisclosureViewData {
  readonly tick: number;
  /** Required on trusted native frames, absent on Solo worker frames. */
  readonly streamId?: string;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function id(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !Array.from(value).some(
      (ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127,
    )
  );
}
function pactId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
function ids(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 4096 &&
    value.every(id) &&
    new Set(value).size === value.length
  );
}
function terms(value: unknown): NationalPactTerms | null {
  if (
    !record(value) ||
    !keys(value, [
      "admission",
      "expulsion",
      "selectedApproverIds",
      "selectedExpellerIds",
      "membershipCap",
      "invitationDurationTicks",
      "defenseContributionBps",
      "defenseReserveBps",
    ]) ||
    (value.admission !== "leader" &&
      value.admission !== "unanimous" &&
      value.admission !== "selected" &&
      value.admission !== "majority" &&
      value.admission !== "supermajority") ||
    (value.admission === "selected"
      ? !ids(value.selectedApproverIds) ||
        value.selectedApproverIds.length > 256
      : value.selectedApproverIds !== undefined) ||
    (value.expulsion !== "leader" &&
      value.expulsion !== "unanimous" &&
      value.expulsion !== "forbidden" &&
      value.expulsion !== "selected" &&
      value.expulsion !== "majority" &&
      value.expulsion !== "supermajority") ||
    (value.expulsion === "selected"
      ? !ids(value.selectedExpellerIds) ||
        value.selectedExpellerIds.length > 256
      : value.selectedExpellerIds !== undefined) ||
    (value.membershipCap !== undefined &&
      !boundedCoalitionInteger(value.membershipCap, 2, 256)) ||
    (value.invitationDurationTicks !== undefined &&
      !boundedCoalitionInteger(value.invitationDurationTicks, 1, 36000))
  )
    return null;
  const cap = value.defenseContributionBps;
  const reserve = value.defenseReserveBps;
  if (
    (cap !== undefined &&
      (typeof cap !== "number" ||
        !Number.isInteger(cap) ||
        cap < 0 ||
        cap > 1000)) ||
    (reserve !== undefined &&
      (typeof reserve !== "number" ||
        !Number.isInteger(reserve) ||
        reserve < 3000 ||
        reserve > 10000))
  )
    return null;
  return {
    admission: value.admission,
    expulsion: value.expulsion,
    ...(ids(value.selectedApproverIds)
      ? { selectedApproverIds: [...value.selectedApproverIds] }
      : {}),
    ...(ids(value.selectedExpellerIds)
      ? { selectedExpellerIds: [...value.selectedExpellerIds] }
      : {}),
    ...(typeof value.membershipCap === "number"
      ? { membershipCap: value.membershipCap }
      : {}),
    ...(typeof value.invitationDurationTicks === "number"
      ? { invitationDurationTicks: value.invitationDurationTicks }
      : {}),
    ...(cap === undefined ? {} : { defenseContributionBps: cap }),
    ...(reserve === undefined ? {} : { defenseReserveBps: reserve }),
  };
}
function hasDefenseTerms(terms: NationalPactTerms): boolean {
  return (
    terms.defenseContributionBps !== undefined ||
    terms.defenseReserveBps !== undefined
  );
}
/** Strict reader rejects nested extras. Producer separately selects public keys. */
export function readNationalPublicPacts(
  value: unknown,
): NationalPublicPactView[] | null {
  if (!Array.isArray(value) || value.length > 4096) return null;
  const out: NationalPublicPactView[] = [];
  const seen = new Set<string>();
  for (const p of value) {
    if (
      !record(p) ||
      !keys(p, ["id", "name", "kind", "memberIds", "administratorId"]) ||
      !pactId(p.id) ||
      seen.has(p.id) ||
      typeof p.name !== "string" ||
      p.name.length > 64 ||
      !p.name.trim() ||
      (p.kind !== "NAP" && p.kind !== "MDA") ||
      !ids(p.memberIds) ||
      !p.memberIds.length ||
      (p.administratorId !== null &&
        (!id(p.administratorId) || !p.memberIds.includes(p.administratorId)))
    )
      return null;
    seen.add(p.id);
    out.push({
      id: p.id,
      name: p.name,
      kind: p.kind,
      memberIds: [...p.memberIds],
      administratorId: p.administratorId,
    });
  }
  return out;
}
/** Current complete snapshot; never merge with old terms. Missing means unknown. */
export function readNationalPactDisclosure(
  value: unknown,
  actor: string | null,
  roster: readonly NationalPublicPactView[] | null,
  imperial: boolean,
): NationalPactDisclosureViewData | null {
  if (
    !actor ||
    !roster ||
    !record(value) ||
    !keys(value, ["version", "recipientId", "pacts"]) ||
    value.version !== 1 ||
    value.recipientId !== actor ||
    !Array.isArray(value.pacts) ||
    value.pacts.length > roster.length ||
    (imperial && value.pacts.length > 0)
  )
    return null;
  const out: NationalPactDisclosure[] = [];
  const seen = new Set<string>();
  for (const p of value.pacts) {
    if (
      !record(p) ||
      !keys(p, [
        "pactId",
        "relationship",
        "terms",
        "pendingAmendment",
        "constitutionVersion",
        "invitations",
        "extendedGovernance",
        "expulsionBallots",
        "invitationExpiresAtTick",
      ]) ||
      !pactId(p.pactId) ||
      seen.has(p.pactId) ||
      (p.relationship !== "member" && p.relationship !== "invited")
    )
      return null;
    const publicPact = roster.find((entry) => entry.id === p.pactId);
    const currentTerms = terms(p.terms);
    if (
      !publicPact ||
      !currentTerms ||
      (publicPact.kind !== "MDA" && hasDefenseTerms(currentTerms)) ||
      publicPact.memberIds.includes(actor) !== (p.relationship === "member")
    )
      return null;
    if (
      (p.extendedGovernance !== undefined && p.extendedGovernance !== true) ||
      (extendedCoalitionTerms(currentTerms) && p.extendedGovernance !== true) ||
      (currentTerms.membershipCap !== undefined &&
        currentTerms.membershipCap < publicPact.memberIds.length) ||
      (p.relationship === "invited" &&
        currentTerms.membershipCap === publicPact.memberIds.length) ||
      (currentTerms.selectedExpellerIds ?? []).some(
        (v) => !publicPact.memberIds.includes(v),
      ) ||
      (p.relationship === "invited" &&
      currentTerms.invitationDurationTicks !== undefined
        ? !boundedCoalitionInteger(
            p.invitationExpiresAtTick,
            1,
            Number.MAX_SAFE_INTEGER,
          )
        : p.invitationExpiresAtTick !== undefined)
    )
      return null;
    const election =
      p.extendedGovernance === true ||
      currentTerms.admission === "selected" ||
      currentTerms.admission === "majority" ||
      currentTerms.admission === "supermajority";
    if (election && publicPact.memberIds.length > 256) return null;
    if (
      (currentTerms.selectedApproverIds ?? []).some(
        (v) => !publicPact.memberIds.includes(v),
      ) ||
      (election
        ? typeof p.constitutionVersion !== "number" ||
          !Number.isSafeInteger(p.constitutionVersion) ||
          p.constitutionVersion <= 0 ||
          p.constitutionVersion >= Number.MAX_SAFE_INTEGER
        : p.constitutionVersion !== undefined || p.invitations !== undefined)
    )
      return null;
    let invitations: NationalPactDisclosure["invitations"];
    if (p.invitations !== undefined) {
      if (
        !election ||
        p.relationship !== "member" ||
        !Array.isArray(p.invitations) ||
        p.invitations.length > 256
      )
        return null;
      const records: NonNullable<
        NationalPactDisclosure["invitations"]
      >[number][] = [];
      const candidates = new Set<string>();
      const eligible =
        currentTerms.admission === "selected"
          ? (currentTerms.selectedApproverIds ?? [])
          : currentTerms.admission === "leader"
            ? publicPact.administratorId === null
              ? []
              : [publicPact.administratorId]
            : publicPact.memberIds;
      const required =
        currentTerms.admission === "majority"
          ? Math.floor(eligible.length / 2) + 1
          : currentTerms.admission === "supermajority"
            ? Math.ceil((eligible.length * 2) / 3)
            : eligible.length;
      for (const i of p.invitations) {
        if (
          !record(i) ||
          !keys(i, ["targetId", "approvedBy", "authorized", "expiresAtTick"]) ||
          (currentTerms.invitationDurationTicks === undefined
            ? i.expiresAtTick !== undefined
            : !boundedCoalitionInteger(
                i.expiresAtTick,
                1,
                Number.MAX_SAFE_INTEGER,
              )) ||
          !id(i.targetId) ||
          publicPact.memberIds.includes(i.targetId) ||
          candidates.has(i.targetId) ||
          !ids(i.approvedBy) ||
          i.approvedBy.length === 0 ||
          i.approvedBy.length > 256 ||
          !i.approvedBy.every((v) => eligible.includes(v)) ||
          typeof i.authorized !== "boolean" ||
          i.authorized !==
            (eligible.length > 0 && i.approvedBy.length >= required)
        )
          return null;
        candidates.add(i.targetId);
        records.push({
          targetId: i.targetId,
          approvedBy: [...i.approvedBy],
          authorized: i.authorized,
          ...(typeof i.expiresAtTick === "number"
            ? { expiresAtTick: i.expiresAtTick }
            : {}),
        });
      }
      invitations = records;
    } else if (election && p.relationship === "member") return null;
    if (
      currentTerms.membershipCap === publicPact.memberIds.length &&
      invitations?.length
    )
      return null;
    let expulsionBallots: NationalPactDisclosure["expulsionBallots"];
    if (p.extendedGovernance === true && p.relationship === "member") {
      if (!Array.isArray(p.expulsionBallots) || p.expulsionBallots.length > 256)
        return null;
      const seenTargets = new Set<string>();
      const ballots: NonNullable<
        NationalPactDisclosure["expulsionBallots"]
      >[number][] = [];
      for (const ballot of p.expulsionBallots) {
        if (
          !record(ballot) ||
          !keys(ballot, ["targetId", "approvedBy"]) ||
          !id(ballot.targetId) ||
          !publicPact.memberIds.includes(ballot.targetId) ||
          seenTargets.has(ballot.targetId) ||
          !ids(ballot.approvedBy)
        )
          return null;
        const eligible = coalitionEligibleExpellers(
          currentTerms,
          publicPact,
          ballot.targetId,
        );
        if (
          ballot.approvedBy.length === 0 ||
          ballot.approvedBy.length >=
            coalitionExpulsionThreshold(currentTerms, eligible.length) ||
          !ballot.approvedBy.every((v) => eligible.includes(v))
        )
          return null;
        seenTargets.add(ballot.targetId);
        ballots.push({
          targetId: ballot.targetId,
          approvedBy: [...ballot.approvedBy],
        });
      }
      expulsionBallots = ballots;
    } else if (p.expulsionBallots !== undefined) return null;
    let amendment: NationalPactDisclosure["pendingAmendment"];
    if (p.pendingAmendment !== undefined) {
      const a = p.pendingAmendment;
      if (
        p.relationship !== "member" ||
        !record(a) ||
        !keys(a, [
          "terms",
          "administratorId",
          "approvedBy",
          "defenseVersion",
        ]) ||
        (a.defenseVersion !== undefined &&
          (typeof a.defenseVersion !== "number" ||
            !Number.isSafeInteger(a.defenseVersion) ||
            a.defenseVersion <= 0)) ||
        !ids(a.approvedBy) ||
        a.approvedBy.length === publicPact.memberIds.length ||
        !a.approvedBy.every((v) => publicPact.memberIds.includes(v)) ||
        (a.administratorId !== null &&
          (!id(a.administratorId) ||
            !publicPact.memberIds.includes(a.administratorId)))
      )
        return null;
      const next = terms(a.terms);
      if (
        !next ||
        (publicPact.kind !== "MDA" && hasDefenseTerms(next)) ||
        (hasDefenseTerms(currentTerms) ||
          hasDefenseTerms(next) ||
          p.extendedGovernance === true ||
          extendedCoalitionTerms(next)) !==
          (a.defenseVersion !== undefined) ||
        (next.admission === "selected" && !next.selectedApproverIds?.length) ||
        (next.expulsion === "selected" && !next.selectedExpellerIds?.length) ||
        (next.selectedExpellerIds ?? []).some(
          (v) => !publicPact.memberIds.includes(v),
        ) ||
        (next.membershipCap !== undefined &&
          next.membershipCap < publicPact.memberIds.length) ||
        (next.selectedApproverIds ?? []).some(
          (v) => !publicPact.memberIds.includes(v),
        )
      )
        return null;
      amendment = {
        ...(typeof a.defenseVersion === "number"
          ? { defenseVersion: a.defenseVersion }
          : {}),
        terms: next,
        administratorId: a.administratorId,
        approvedBy: [...a.approvedBy],
      };
    }
    seen.add(p.pactId);
    out.push({
      pactId: p.pactId,
      relationship: p.relationship,
      terms: currentTerms,
      ...(p.extendedGovernance === true
        ? { extendedGovernance: true as const }
        : {}),
      ...(typeof p.invitationExpiresAtTick === "number"
        ? { invitationExpiresAtTick: p.invitationExpiresAtTick }
        : {}),
      ...(expulsionBallots === undefined ? {} : { expulsionBallots }),
      ...(typeof p.constitutionVersion === "number"
        ? { constitutionVersion: p.constitutionVersion }
        : {}),
      ...(invitations === undefined ? {} : { invitations }),
      ...(amendment ? { pendingAmendment: amendment } : {}),
    });
  }
  return { version: 1, recipientId: actor, pacts: out };
}
/** Read the current per-tick snapshot, bound to the current socket epoch where applicable. */
export function readNationalPactWireDisclosure(
  value: unknown,
  actor: string | null,
  roster: readonly NationalPublicPactView[] | null,
  imperial: boolean,
  tick: number,
  streamId?: string | null,
): NationalPactDisclosureViewData | null {
  if (
    !record(value) ||
    !keys(value, ["version", "recipientId", "pacts", "tick", "streamId"]) ||
    !Number.isSafeInteger(tick) ||
    tick < 0 ||
    value.tick !== tick ||
    streamId === null ||
    value.streamId !== streamId
  )
    return null;
  const decoded = readNationalPactDisclosure(
    {
      version: value.version,
      recipientId: value.recipientId,
      pacts: value.pacts,
    },
    actor,
    roster,
    imperial,
  );
  if (
    decoded?.pacts.some(
      (p) => {
        const duration = p.terms.invitationDurationTicks;
        const invalidDeadline = (deadline?: number) =>
          deadline !== undefined &&
          (deadline <= tick ||
            duration === undefined ||
            deadline - tick > duration);
        return (
          invalidDeadline(p.invitationExpiresAtTick) ||
          p.invitations?.some((i) => invalidDeadline(i.expiresAtTick))
        );
      },
    )
  )
    return null;
  return decoded;
}

/** Call at each native trust boundary, including public-only packets.
 * A public roster may never carry a private field at ANY nested level. */
export function validateNationalPactPacket(
  politics: unknown,
  disclosure: unknown,
  actor: string | null,
  tick: number,
  streamId?: string,
): void {
  if (politics !== undefined && !record(politics))
    throw new Error("NATIONAL invalid public politics");
  if (record(politics)) {
    if (
      !keys(politics, ["empires", "warnings", "victory", "pacts"]) ||
      !Array.isArray(politics.empires) ||
      politics.empires.some(
        (e) =>
          !record(e) ||
          !keys(e, ["id", "leaderId", "memberIds"]) ||
          !id(e.id) ||
          !id(e.leaderId) ||
          !ids(e.memberIds) ||
          !e.memberIds.includes(e.leaderId),
      ) ||
      (politics.warnings !== undefined &&
        (!Array.isArray(politics.warnings) ||
          politics.warnings.some(
            (w) =>
              !record(w) ||
              !keys(w, [
                "empireId",
                "deadlineMs",
                "remainingMs",
                "blockedByAssetDisposition",
              ]) ||
              !id(w.empireId) ||
              typeof w.deadlineMs !== "number" ||
              !Number.isFinite(w.deadlineMs) ||
              typeof w.remainingMs !== "number" ||
              !Number.isFinite(w.remainingMs) ||
              typeof w.blockedByAssetDisposition !== "boolean",
          ))) ||
      (politics.victory !== undefined &&
        politics.victory !== null &&
        (!record(politics.victory) ||
          !keys(politics.victory, [
            "sovereignPowerCount",
            "resolved",
            "confirmedTick",
            "prizes",
          ]) ||
          (politics.victory.confirmedTick !== undefined &&
            readNationalConfirmedVictory(politics.victory, tick) === null) ||
          !Number.isSafeInteger(politics.victory.sovereignPowerCount) ||
          typeof politics.victory.resolved !== "boolean" ||
          !Array.isArray(politics.victory.prizes) ||
          politics.victory.prizes.some(
            (p) =>
              !record(p) ||
              !id(p.nationId) ||
              (p.kind === "SovereignVictor"
                ? !keys(p, ["kind", "nationId"])
                : (p.kind !== "ImperialVictor" && p.kind !== "EmpireVictor") ||
                  !keys(p, ["kind", "nationId", "empireId"]) ||
                  !id(p.empireId)),
          )))
    )
      throw new Error("NATIONAL invalid public politics fields");
  }
  const roster =
    record(politics) && politics.pacts !== undefined
      ? readNationalPublicPacts(politics.pacts)
      : null;
  if (record(politics) && politics.pacts !== undefined && !roster)
    throw new Error("NATIONAL invalid public pact roster");
  const empireMembers = new Set<string>();
  if (record(politics) && Array.isArray(politics.empires)) {
    for (const e of politics.empires) {
      if (record(e) && Array.isArray(e.memberIds))
        for (const m of e.memberIds) {
          if (typeof m === "string") empireMembers.add(m);
        }
    }
  }
  if (roster?.some((p) => p.memberIds.some((m) => empireMembers.has(m))))
    throw new Error("NATIONAL imperial nation in ordinary pact roster");
  if (
    disclosure !== undefined &&
    !readNationalPactWireDisclosure(
      disclosure,
      actor,
      roster,
      actor !== null && empireMembers.has(actor),
      tick,
      streamId,
    )
  )
    throw new Error("NATIONAL invalid recipient pact disclosure");
}
