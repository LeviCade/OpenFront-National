import { describe, expect, it } from "vitest";
import {
  readNationalPolitics,
  readNationalFoundingResults,
  reconcileNationalFounding,
  type NationalFoundingAttempt,
  type NationalPublicPolitics,
  type NationalFoundingResult,
} from "../../../src/client/NationalDiplomacyState";

const attempt: NationalFoundingAttempt = {
  gameId: "solo-one",
  actorId: "nation-a",
  empireId: "Atlas",
  issuedTick: 10,
  acceptedResultSeen: false,
};

const absent: NationalPublicPolitics = { empires: [], warnings: [] };
const roster: NationalPublicPolitics = {
  empires: [{ id: "Atlas", leaderId: "nation-a", memberIds: ["nation-a"] }],
  warnings: [],
};
const accepted: NationalFoundingResult = {
  type: "national_found_empire",
  recipientId: "nation-a",
  actorId: "nation-a",
  empireId: "Atlas",
  accepted: true,
  tick: 11,
};
const view = {
  gameId: "solo-one",
  actorId: "nation-a",
  tick: 11,
  politics: absent,
  results: [] as NationalFoundingResult[],
};

describe("NATIONAL confirmed founding decisions from authoritative DTOs", () => {
  it("requires BOTH fresh accepted journal and current exact leadership", () => {
    expect(reconcileNationalFounding(attempt, { ...view, politics: roster })).toEqual({
      phase: "pending",
      acceptedResultSeen: false,
    });
    expect(reconcileNationalFounding(attempt, { ...view, results: [accepted] })).toEqual({
      phase: "pending",
      acceptedResultSeen: true,
    });
    expect(reconcileNationalFounding(attempt, { ...view, results: [accepted], politics: roster })).toEqual({
      phase: "accepted",
      acceptedResultSeen: true,
    });
    expect(reconcileNationalFounding({ ...attempt, acceptedResultSeen: true }, { ...view, politics: roster })).toEqual({
      phase: "accepted",
      acceptedResultSeen: true,
    });
  });

  it("rejects a past journal entry, another empire, another actor, and wrong recipient", () => {
    const wrong = [
      { ...accepted, tick: 10 },
      { ...accepted, tick: 9 },
      { ...accepted, empireId: "Other" },
      { ...accepted, actorId: "nation-b" },
      { ...accepted, recipientId: "nation-b" },
    ];
    for (const result of wrong) {
      expect(reconcileNationalFounding(attempt, { ...view, politics: roster, results: [result] }).phase).toBe("pending");
    }
    expect(readNationalFoundingResults([{ ...accepted, recipientId: "nation-b" }])).toEqual([]);
  });

  it("shows real rejection reason even if a stale roster suggests membership", () => {
    const result = {
      ...accepted,
      accepted: false,
      reason: "political-rule",
    };
    expect(reconcileNationalFounding(attempt, { ...view, politics: roster, results: [result] })).toEqual({
      phase: "rejected",
      reason: "political-rule",
      acceptedResultSeen: false,
    });
  });

  it("does not confirm an empire belonging to another actor, or one with a different emperor", () => {
    const wrongLeader: NationalPublicPolitics = {
      empires: [{ id: "Atlas", leaderId: "nation-b", memberIds: ["nation-b", "nation-a"] }],
      warnings: [],
    };
    expect(reconcileNationalFounding(attempt, {
      ...view, politics: wrongLeader, results: [accepted],
    }).phase).toBe("pending");
  });

  it("fails safely for rewound game, changed session and missing results after a bounded tick horizon", () => {
    expect(reconcileNationalFounding(attempt, { ...view, gameId: "new-game" }).phase).toBe("unknown");
    expect(reconcileNationalFounding(attempt, { ...view, actorId: "new-actor" }).phase).toBe("unknown");
    expect(reconcileNationalFounding(attempt, { ...view, tick: 9 }).phase).toBe("unknown");
    expect(reconcileNationalFounding(attempt, {
      ...view, tick: 210, results: [],
    }).phase).toBe("unknown");
  });
});

describe("NATIONAL Ungovernable public warning packets", () => {
  it("displays only real, valid warning details for a current empire", () => {
    const source = {
      empires: [{ id: "Atlas", leaderId: "nation-a", memberIds: ["nation-a"] }],
      warnings: [{
        empireId: "Atlas",
        deadlineMs: 30000,
        remainingMs: 5000,
        blockedByAssetDisposition: true,
      }],
      victory: null,
    };
    expect(readNationalPolitics(source)?.warnings).toEqual(source.warnings);
    expect(readNationalPolitics({ ...source, warnings: [{ ...source.warnings[0], remainingMs: -1 }] })).toBeNull();
    expect(readNationalPolitics({ ...source, warnings: [{ ...source.warnings[0], empireId: "Unknown" }] })).toBeNull();
    expect(readNationalPolitics({ ...source, warnings: [source.warnings[0], source.warnings[0]] })).toBeNull();
  });

  it("never synthesizes warnings from absent packets", () => {
    expect(readNationalPolitics(null)).toBeNull();
    expect(readNationalPolitics({ empires: [] })?.warnings).toEqual([]);
  });
});
