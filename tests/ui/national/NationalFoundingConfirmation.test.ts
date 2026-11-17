import { describe, expect, it } from "vitest";
import {
  readNationalPolitics,
  retainNationalFoundingReceipts,
  readNationalFoundingResults,
  reconcileNationalFounding,
  type NationalFoundingAttempt,
  type NationalPublicPolitics,
  type NationalFoundingResult,
} from "../../../src/client/NationalDiplomacyState";

const requestId = "nf_" + "a".repeat(32);
const otherRequestId = "nf_" + "b".repeat(32);

const attempt: NationalFoundingAttempt = {
  requestId,
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
  requestId,
  sequence: 3,
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
    expect(
      reconcileNationalFounding(attempt, { ...view, politics: roster }),
    ).toEqual({
      phase: "pending",
      acceptedResultSeen: false,
    });
    expect(
      reconcileNationalFounding(attempt, {
        ...view,
        results: [{ ...accepted, tick: 10 }],
        politics: roster,
      }).phase,
    ).toBe("accepted");
    expect(
      reconcileNationalFounding(attempt, { ...view, results: [accepted] }),
    ).toEqual({
      phase: "pending",
      acceptedResultSeen: true,
    });
    expect(
      reconcileNationalFounding(attempt, {
        ...view,
        results: [accepted],
        politics: roster,
      }),
    ).toEqual({
      phase: "accepted",
      acceptedResultSeen: true,
    });
    expect(
      reconcileNationalFounding(
        { ...attempt, acceptedResultSeen: true },
        { ...view, politics: roster },
      ),
    ).toEqual({
      phase: "accepted",
      acceptedResultSeen: true,
    });
  });

  it("rejects a past journal entry, another empire, another actor, and wrong recipient", () => {
    const wrong = [
      { ...accepted, tick: 9 },
      { ...accepted, tick: 8 },
      { ...accepted, empireId: "Other" },
      { ...accepted, actorId: "nation-b" },
      { ...accepted, recipientId: "nation-b" },
      { ...accepted, requestId: otherRequestId },
      { ...accepted, requestId: undefined },
      { ...accepted, sequence: undefined },
    ];
    for (const result of wrong) {
      expect(
        reconcileNationalFounding(attempt, {
          ...view,
          politics: roster,
          results: [result],
        }).phase,
      ).toBe("pending");
    }
    expect(
      readNationalFoundingResults([{ ...accepted, recipientId: "nation-b" }]),
    ).toEqual([]);
  });

  it("shows real rejection reason even if a stale roster suggests membership", () => {
    const result = {
      ...accepted,
      accepted: false,
      reason: "political-rule",
    };
    expect(
      reconcileNationalFounding(attempt, {
        ...view,
        politics: roster,
        results: [result],
      }),
    ).toEqual({
      phase: "rejected",
      reason: "political-rule",
      acceptedResultSeen: false,
    });
  });

  it("does not confirm an empire belonging to another actor, or one with a different emperor", () => {
    const wrongLeader: NationalPublicPolitics = {
      empires: [
        {
          id: "Atlas",
          leaderId: "nation-b",
          memberIds: ["nation-b", "nation-a"],
        },
      ],
      warnings: [],
    };
    expect(
      reconcileNationalFounding(attempt, {
        ...view,
        politics: wrongLeader,
        results: [accepted],
      }).phase,
    ).toBe("pending");
  });

  it("fails safely for rewound game, changed session and missing results after a bounded tick horizon", () => {
    expect(
      reconcileNationalFounding(attempt, { ...view, gameId: "new-game" }).phase,
    ).toBe("unknown");
    expect(
      reconcileNationalFounding(attempt, { ...view, actorId: "new-actor" })
        .phase,
    ).toBe("unknown");
    expect(reconcileNationalFounding(attempt, { ...view, tick: 9 }).phase).toBe(
      "unknown",
    );
    expect(
      reconcileNationalFounding(attempt, {
        ...view,
        tick: 210,
        results: [],
      }).phase,
    ).toBe("unknown");
  });
});

describe("NATIONAL Ungovernable public warning packets", () => {
  it("displays only real, valid warning details for a current empire", () => {
    const source = {
      empires: [{ id: "Atlas", leaderId: "nation-a", memberIds: ["nation-a"] }],
      warnings: [
        {
          empireId: "Atlas",
          deadlineMs: 30000,
          remainingMs: 5000,
          blockedByAssetDisposition: true,
        },
      ],
      victory: null,
    };
    expect(readNationalPolitics(source)?.warnings).toEqual(source.warnings);
    expect(
      readNationalPolitics({
        ...source,
        warnings: [{ ...source.warnings[0], remainingMs: -1 }],
      }),
    ).toBeNull();
    expect(
      readNationalPolitics({
        ...source,
        warnings: [{ ...source.warnings[0], empireId: "Unknown" }],
      }),
    ).toBeNull();
    expect(
      readNationalPolitics({
        ...source,
        warnings: [source.warnings[0], source.warnings[0]],
      }),
    ).toBeNull();
  });

  it("never synthesizes warnings from absent packets", () => {
    expect(readNationalPolitics(null)).toBeNull();
    expect(readNationalPolitics({ empires: [] })?.warnings).toEqual([]);
  });
});

describe("exact E1 request identity under same-tick races", () => {
  it("never accepts an identical actor/empire command from another request on the same tick", () => {
    const unrelated = { ...accepted, tick: 10, requestId: otherRequestId, sequence: 2 };
    expect(
      reconcileNationalFounding(attempt, {
        ...view,
        politics: roster,
        results: [unrelated],
      }).phase,
    ).toBe("pending");
    expect(
      reconcileNationalFounding(attempt, {
        ...view,
        politics: roster,
        results: [unrelated, { ...accepted, tick: 10 }],
      }).phase,
    ).toBe("accepted");
  });

  it("reorders repeated records safely and ignores an unrelated rejection", () => {
    const rejection = {
      ...accepted,
      requestId: otherRequestId,
      sequence: 1,
      accepted: false,
      reason: "political-rule",
    };
    for (const results of [[rejection, accepted], [accepted, rejection]]) {
      expect(
        reconcileNationalFounding(attempt, {
          ...view,
          politics: roster,
          results,
        }).phase,
      ).toBe("accepted");
    }
    expect(
      reconcileNationalFounding(attempt, {
        ...view,
        politics: roster,
        results: [rejection],
      }).phase,
    ).toBe("pending");
  });

  it("never chooses an outcome from contradictory E1 receipts for one request", () => {
    const rejection = {
      ...accepted,
      accepted: false,
      reason: "political-rule",
    };
    expect(
      reconcileNationalFounding(attempt, {
        ...view,
        politics: roster,
        results: [accepted, rejection],
      }).phase,
    ).toBe("unknown");
    expect(
      reconcileNationalFounding(attempt, {
        ...view,
        politics: roster,
        results: [accepted, { ...accepted, sequence: 999 }],
      }).phase,
    ).toBe("unknown");
  });

  it("only applies an exact matching rejected engine result, never a past success", () => {
    const pastSuccess = { ...accepted, requestId: otherRequestId, sequence: 1 };
    const realRejection = {
      ...accepted,
      accepted: false,
      reason: "actor-inactive",
      sequence: 4,
    };
    expect(
      reconcileNationalFounding(attempt, {
        ...view,
        politics: roster,
        results: [pastSuccess, realRejection],
      }),
    ).toEqual({
      phase: "rejected",
      reason: "actor-inactive",
      acceptedResultSeen: false,
    });
  });

  it("keeps one-shot identical same-tick receipts distinct by requestId and sequence", () => {
    const first = { ...accepted, tick: 10, sequence: 1 };
    const second = {
      ...accepted,
      tick: 10,
      sequence: 2,
      requestId: otherRequestId,
      accepted: false,
      reason: "political-rule",
    };
    expect(
      retainNationalFoundingReceipts([], [first, second], 11, false),
    ).toHaveLength(2);
  });
});

describe("E3 one-shot command-result buffering", () => {
  it("survives an empty next tick until the slower HUD refresh, without duplicate receipts", () => {
    const first = retainNationalFoundingReceipts([], [accepted], 11, false);
    expect(first).toEqual([accepted]);
    const next = retainNationalFoundingReceipts(first, [], 12, false);
    expect(next).toEqual([accepted]);
    expect(
      retainNationalFoundingReceipts(next, [accepted], 13, false),
    ).toHaveLength(1);
  });

  it("drops an expired receipt, future result, and all old events on disconnect/rewind", () => {
    expect(retainNationalFoundingReceipts([accepted], [], 252, false)).toEqual(
      [],
    );
    expect(retainNationalFoundingReceipts([accepted], [], 12, true)).toEqual(
      [],
    );
    expect(
      retainNationalFoundingReceipts(
        [],
        [{ ...accepted, tick: 15 }],
        12,
        false,
      ),
    ).toEqual([]);
  });

  it("keeps a bounded journal when many events arrive", () => {
    const events = Array.from({ length: 100 }, (_, i) => ({
      ...accepted,
      empireId: `Empire_${i}`,
      tick: i + 1,
    }));
    expect(retainNationalFoundingReceipts([], events, 100, false)).toHaveLength(
      32,
    );
  });
});
