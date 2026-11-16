import { describe, expect, it } from "vitest";
import {
  empireForMember,
  foundingUnavailableReason,
  readNationalFoundingResults,
  readNationalPolitics,
  validEmpireId,
} from "../../../src/client/NationalDiplomacyState";

describe("NATIONAL read-only political projection", () => {
  const verified = {
    empires: [
      {
        id: "North_Union",
        leaderId: "nation-a",
        memberIds: ["nation-a", "nation-b"],
      },
    ],
  };

  it("never creates an empire from an absent or malformed packet", () => {
    expect(readNationalPolitics(undefined)).toBeNull();
    expect(readNationalPolitics({ empires: "not a roster" })).toBeNull();
    expect(
      readNationalPolitics({
        empires: [{ ...verified.empires[0], memberIds: [] }],
      }),
    ).toBeNull();
    expect(
      readNationalPolitics({
        empires: [{ ...verified.empires[0], leaderId: "intruder" }],
      }),
    ).toBeNull();
  });

  it("only identifies membership and emperor from a valid game projection", () => {
    const politics = readNationalPolitics(verified);
    expect(empireForMember(politics, "nation-a")?.leaderId).toBe("nation-a");
    expect(empireForMember(politics, "nation-b")?.id).toBe("North_Union");
    expect(empireForMember(politics, "nation-c")).toBeNull();
    expect(readNationalPolitics({ empires: [] })?.empires).toEqual([]);
  });

  it("rejects overlapping membership and duplicate empire IDs", () => {
    expect(
      readNationalPolitics({
        empires: [
          verified.empires[0],
          { id: "South", leaderId: "nation-b", memberIds: ["nation-b"] },
        ],
      }),
    ).toBeNull();
    expect(
      readNationalPolitics({
        empires: [verified.empires[0], verified.empires[0]],
      }),
    ).toBeNull();
  });

  it("only consumes authenticated-style game command outcomes and never assumes acceptance", () => {
    expect(readNationalFoundingResults(undefined)).toEqual([]);
    expect(
      readNationalFoundingResults([
        {
          type: "national_found_empire",
          actorId: "nation-a",
          empireId: "North_Union",
          accepted: true,
        },
        {
          type: "national_found_empire",
          actorId: "nation-b",
          empireId: "North_Union",
          accepted: false,
          reason: "already member",
        },
        {
          type: "national_found_empire",
          actorId: "nation-b",
          empireId: "North_Union",
        },
        {
          type: "attack",
          actorId: "nation-a",
          empireId: "North_Union",
          accepted: true,
        },
      ]),
    ).toHaveLength(2);
  });

  it("validates wire IDs before sending", () => {
    expect(validEmpireId("Atlas-23_B")).toBe(true);
    for (const bad of ["", "contains space", "../oops", "😎", "a".repeat(65)]) {
      expect(validEmpireId(bad)).toBe(false);
    }
  });
});

describe("NATIONAL founding eligibility", () => {
  const active = {
    national: true,
    solo: true,
    replay: false,
    spawned: true,
    alive: true,
    spectator: false,
    memberEmpire: null,
    pending: false,
  };

  it("enables a legal candidate in a live NATIONAL solo", () => {
    expect(foundingUnavailableReason(active)).toBeNull();
  });

  it("disables ordinary FFA, replays, pre-spawn, dead, and already-member controls", () => {
    expect(
      foundingUnavailableReason({ ...active, national: false }),
    ).toBeTruthy();
    expect(foundingUnavailableReason({ ...active, solo: false })).toBeTruthy();
    expect(foundingUnavailableReason({ ...active, replay: true })).toBeTruthy();
    expect(
      foundingUnavailableReason({ ...active, spawned: false }),
    ).toBeTruthy();
    expect(foundingUnavailableReason({ ...active, alive: false })).toBeTruthy();
    expect(
      foundingUnavailableReason({ ...active, spectator: true }),
    ).toBeTruthy();
    expect(
      foundingUnavailableReason({
        ...active,
        memberEmpire: { id: "X", leaderId: "n", memberIds: ["n"] },
      }),
    ).toBeTruthy();
    expect(
      foundingUnavailableReason({ ...active, pending: true }),
    ).toBeTruthy();
  });
});
