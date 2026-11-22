import { describe, expect, it } from "vitest";
import {
  readNationalPactDisclosure,
  readNationalPactWireDisclosure,
  readNationalPublicPacts,
  validateNationalPactPacket,
} from "@openfront/engine-api/game/NationalPactView";
import {
  pactActionAllowed,
  pactConsentKey,
  readPactReceipts,
  reconcilePactReceipt,
  retainPactReceipts,
  type PactContext,
} from "../../src/client/NationalPactState";

const terms = { admission: "leader", expulsion: "leader" } as const;
const p = { id: "pact", name: "North Sea", kind: "MDA", memberIds: ["a", "b"], administratorId: "a" } as const;
const roster = [p];
const politics = { empires: [], warnings: [], victory: null, pacts: roster };
const member = { pactId: p.id, relationship: "member", terms } as const;
const invited = { pactId: p.id, relationship: "invited", terms } as const;
const snapshot = { version: 1, recipientId: "a", pacts: [member] } as const;
const wire = { ...snapshot, tick: 7, streamId: "current-epoch" };
const amendment = { terms: { admission: "unanimous", expulsion: "forbidden" }, administratorId: "b", approvedBy: ["b"] } as const;
function context(): PactContext {
  return { actor: "a", roster, disclosure: snapshot, independentCandidates: ["c"] };
}

describe("C4 E4 recipient pact gate", () => {
  it("projects detached public roster and current membership without private nesting", () => {
    const result = readNationalPublicPacts(roster)!;
    expect(result).toEqual(roster);
    expect(result[0].memberIds).not.toBe(p.memberIds);
    expect(readNationalPactDisclosure(snapshot, "a", roster, false)).toEqual(snapshot);
    expect(readNationalPactDisclosure({ ...snapshot, recipientId: "c", pacts: [invited] }, "c", roster, false)?.pacts[0].terms).toEqual(terms);
    expect(readNationalPactDisclosure({ ...snapshot, pacts: [] }, "a", roster, false)?.pacts).toEqual([]);
    expect(readNationalPactDisclosure(undefined, "a", roster, false)).toBeNull();
  });
  it("rejects extra keys, malformed values, foreign/revoked identities and forbidden imperial disclosure", () => {
    for (const bad of [
      [{ ...p, terms }], [{ ...p, invitations: ["c"] }], [{ ...p, name: { private: terms } }],
      [{ ...p, memberIds: ["a", "a"] }], [{ ...p, administratorId: "c" }], [p, p],
    ]) expect(readNationalPublicPacts(bad)).toBeNull();
    for (const bad of [
      { ...snapshot, recipientId: "b" },
      { ...snapshot, pacts: [member, member] },
      { ...snapshot, pacts: [{ ...member, terms: { ...terms, secret: true } }] },
      { ...snapshot, pacts: [{ ...member, relationship: "invited" }] },
      { ...snapshot, pacts: [{ ...member, pendingAmendment: { ...amendment, approvedBy: ["c"] } }] },
      { ...snapshot, pacts: [{ ...member, pendingAmendment: { ...amendment, approvedBy: ["a", "b"] } }] },
    ]) expect(readNationalPactDisclosure(bad, "a", roster, false)).toBeNull();
    expect(readNationalPactDisclosure(snapshot, "a", roster, true)).toBeNull();
    expect(readNationalPactDisclosure(snapshot, "a", [{ ...p, memberIds: ["b"], administratorId: "b" }], false)).toBeNull();
    expect(readNationalPactDisclosure({ ...snapshot, recipientId: "c", pacts: [{ ...invited, pendingAmendment: amendment }] }, "c", roster, false)).toBeNull();
  });
  it("binds private lane to exact tick, map epoch and recipient; pre-spawn receives only public", () => {
    expect(readNationalPactWireDisclosure(wire, "a", roster, false, 7, "current-epoch")).toEqual(snapshot);
    for (const args of [[8, "current-epoch"], [7, "old-epoch"], [7, null], [7, undefined]] as const)
      expect(readNationalPactWireDisclosure(wire, "a", roster, false, args[0], args[1])).toBeNull();
    expect(() => validateNationalPactPacket(politics, wire, "a", 7, "current-epoch")).not.toThrow();
    expect(() => validateNationalPactPacket(politics, undefined, null, 7)).not.toThrow();
    expect(() => validateNationalPactPacket(politics, wire, null, 7)).toThrow();
    expect(() => validateNationalPactPacket(politics, wire, "b", 7, "current-epoch")).toThrow();
    for (const bad of [
      { ...politics, private: terms },
      { ...politics, pacts: [{ ...p, pendingAmendment: amendment }] },
      { ...politics, empires: [{ id: "e", leaderId: "z", memberIds: ["z"], secret: terms }] },
      { ...politics, empires: [{ id: { secret: terms }, leaderId: "z", memberIds: ["z"] }] },
      { ...politics, warnings: [{ empireId: "e", deadlineMs: terms, remainingMs: 1, blockedByAssetDisposition: false }] },
      { ...politics, victory: { sovereignPowerCount: 1, resolved: true, prizes: [{ kind: "SovereignVictor", nationId: "z", empireId: terms }] } },
      { ...politics, empires: [{ id: "e", leaderId: "a", memberIds: ["a"] }] },
    ]) expect(() => validateNationalPactPacket(bad, undefined, null, 7)).toThrow();
  });
  it("gates all seven actions, including unanimous/forbidden expulsions and changed proposals", () => {
    const c = context();
    expect(pactActionAllowed({ type: "national_found_pact", pactId: "new", name: "New", pactKind: "NAP", terms }, c)).toBe(true);
    expect(pactActionAllowed({ type: "national_invite_pact", pactId: p.id, candidateId: "c" }, c)).toBe(true);
    expect(pactActionAllowed({ type: "national_invite_pact", pactId: p.id, candidateId: "b" }, c)).toBe(false);
    expect(pactActionAllowed({ type: "national_betray_pact", pactId: p.id }, c)).toBe(true);
    expect(pactActionAllowed({ type: "national_expel_pact", pactId: p.id, memberId: "b" }, c)).toBe(true);
    expect(pactActionAllowed({ type: "national_propose_pact_amendment", pactId: p.id, terms, administratorId: "b" }, c)).toBe(true);
    const proposed = { ...c, disclosure: { ...snapshot, pacts: [{ ...member, pendingAmendment: amendment }] } };
    expect(pactActionAllowed({ type: "national_approve_pact_amendment", pactId: p.id }, proposed)).toBe(true);
    expect(pactConsentKey(c, p.id)).not.toEqual(pactConsentKey(proposed, p.id));
    expect(pactActionAllowed({ type: "national_accept_pact", pactId: p.id }, { ...c, actor: "c", disclosure: { version: 1, recipientId: "c", pacts: [invited] } })).toBe(true);
    for (const expulsion of ["forbidden", "unanimous"] as const)
      expect(pactActionAllowed({ type: "national_expel_pact", pactId: p.id, memberId: "b" }, { ...c, roster: [{ ...p, memberIds: ["a", "b", "c"] }], disclosure: { ...snapshot, pacts: [{ ...member, terms: { ...terms, expulsion } }] } })).toBe(false);
    expect(pactActionAllowed({ type: "national_expel_pact", pactId: p.id, memberId: "b" }, { ...c, disclosure: { ...snapshot, pacts: [{ ...member, terms: { ...terms, expulsion: "unanimous" } }] } })).toBe(true);
    expect(pactActionAllowed({ type: "national_betray_pact", pactId: p.id }, { ...c, disclosure: { ...snapshot, pacts: [] } })).toBe(false);
  });
  it("correlates all receipt dimensions; unknown stays unknown and contradictory receipts fail closed", () => {
    const requestId = "np_" + "a".repeat(32);
    const attempt = { requestId, actorId: "a", pactId: p.id, tick: 5, type: "national_betray_pact" } as const;
    const receipt = { requestId, actorId: "a", recipientId: "a", commandTargetId: p.id, type: attempt.type, tick: 6, sequence: 1, accepted: true, reason: "accepted" } as const;
    expect(readPactReceipts([receipt, { ...receipt, recipientId: "b" }, { ...receipt, actorId: "b" }, { ...receipt, tick: 9 }, { ...receipt, reason: "political-rule" }], "a", 7)).toEqual([receipt]);
    expect(reconcilePactReceipt([], attempt, 7)).toBe("pending");
    expect(reconcilePactReceipt([], attempt, 205)).toBe("unknown");
    expect(reconcilePactReceipt([{ ...receipt, commandTargetId: "other" }], attempt, 7)).toBe("pending");
    expect(reconcilePactReceipt([receipt], attempt, 7)).toBe("accepted");
    const rejected = { ...receipt, accepted: false, reason: "political-rule" };
    expect(reconcilePactReceipt([rejected], attempt, 7)).toBe("rejected");
    expect(reconcilePactReceipt(retainPactReceipts([receipt], [rejected], 7), attempt, 7)).toBe("conflict");
  });
});
