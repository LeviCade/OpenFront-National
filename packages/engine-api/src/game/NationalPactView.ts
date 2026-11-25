/** Detached wire contract. No engine state or client-derived political authority. */
export interface NationalPublicPactView {
  readonly id: string;
  readonly name: string;
  readonly kind: "NAP" | "MDA";
  readonly memberIds: readonly string[];
  readonly administratorId: string | null;
}
export interface NationalPactTerms {
  readonly admission: "leader" | "unanimous" | "selected" | "majority" | "supermajority";
  readonly selectedApproverIds?: string[];
  readonly expulsion: "leader" | "unanimous" | "forbidden";
}
export interface NationalPactDisclosure {
  readonly pactId: string;
  readonly relationship: "member" | "invited";
  readonly terms: NationalPactTerms;
  readonly constitutionVersion?: number;
  readonly invitations?: readonly {
    readonly targetId: string;
    readonly approvedBy: readonly string[];
    readonly authorized: boolean;
  }[];
  readonly pendingAmendment?: {
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
    !keys(value, ["admission", "expulsion", "selectedApproverIds"]) ||
    (value.admission !== "leader" &&
      value.admission !== "unanimous" &&
      value.admission !== "selected" &&
      value.admission !== "majority" &&
      value.admission !== "supermajority") ||
    (value.admission === "selected"
      ? !ids(value.selectedApproverIds) || value.selectedApproverIds.length > 256
      : value.selectedApproverIds !== undefined) ||
    (value.expulsion !== "leader" &&
      value.expulsion !== "unanimous" &&
      value.expulsion !== "forbidden")
  )
    return null;
  return {
    admission: value.admission,
    expulsion: value.expulsion,
    ...(ids(value.selectedApproverIds)
      ? { selectedApproverIds: [...value.selectedApproverIds] }
      : {}),
  };
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
        "pactId", "relationship", "terms", "pendingAmendment",
        "constitutionVersion", "invitations",
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
      publicPact.memberIds.includes(actor) !== (p.relationship === "member")
    )
      return null;
    const election = currentTerms.admission === "selected" ||
      currentTerms.admission === "majority" ||
      currentTerms.admission === "supermajority";
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
    ) return null;
    let invitations: NationalPactDisclosure["invitations"];
    if (p.invitations !== undefined) {
      if (
        !election || p.relationship !== "member" ||
        !Array.isArray(p.invitations) || p.invitations.length > 256
      ) return null;
      const records: NonNullable<NationalPactDisclosure["invitations"]>[number][] = [];
      const candidates = new Set<string>();
      const eligible = currentTerms.admission === "selected"
        ? currentTerms.selectedApproverIds ?? []
        : publicPact.memberIds;
      const required = currentTerms.admission === "majority"
        ? Math.floor(eligible.length / 2) + 1
        : currentTerms.admission === "supermajority"
          ? Math.ceil(eligible.length * 2 / 3)
          : eligible.length;
      for (const i of p.invitations) {
        if (
          !record(i) || !keys(i, ["targetId", "approvedBy", "authorized"]) ||
          !id(i.targetId) || publicPact.memberIds.includes(i.targetId) ||
          candidates.has(i.targetId) || !ids(i.approvedBy) ||
          i.approvedBy.length === 0 || i.approvedBy.length > 256 ||
          !i.approvedBy.every((v) => eligible.includes(v)) ||
          i.authorized !== (eligible.length > 0 && i.approvedBy.length >= required)
        ) return null;
        candidates.add(i.targetId);
        records.push({
          targetId: i.targetId, approvedBy: [...i.approvedBy], authorized: i.authorized,
        });
      }
      invitations = records;
    } else if (election && p.relationship === "member") return null;
    let amendment: NationalPactDisclosure["pendingAmendment"];
    if (p.pendingAmendment !== undefined) {
      const a = p.pendingAmendment;
      if (
        p.relationship !== "member" ||
        !record(a) ||
        !keys(a, ["terms", "administratorId", "approvedBy"]) ||
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
        (next.admission === "selected" && !next.selectedApproverIds?.length) ||
        (next.selectedApproverIds ?? []).some((v) => !publicPact.memberIds.includes(v))
      ) return null;
      amendment = {
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
  return readNationalPactDisclosure(
    {
      version: value.version,
      recipientId: value.recipientId,
      pacts: value.pacts,
    },
    actor,
    roster,
    imperial,
  );
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
            "prizes",
          ]) ||
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
