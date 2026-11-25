import { describe, expect, it } from "vitest";
import {
  assessmentPurchaseOutcome,
  readNationalAssessmentView,
} from "../../../src/client/NationalAssessmentClient";

const attempt = {
  gameId: "game-a",
  actorId: "payer-a",
  targetId: "nation-b",
  requestId: "np_" + "1".repeat(32),
  tick: 20,
};
const receipt = {
  payerId: attempt.actorId,
  targetId: attempt.targetId,
  requestId: attempt.requestId,
  effectiveTick: 21,
  outcome: "accepted",
  cost: "1200",
} as const;
const packet = {
  version: 1,
  recipientId: attempt.actorId,
  items: [],
  receipts: [receipt],
};
const read = (raw: unknown) =>
  readNationalAssessmentView(raw, attempt.actorId, 21);

describe("C6C2 E1 additional E4 exact assessment receipt consumer (not new credit)", () => {
  it("matches only the authoritative exact transaction in the bound game and principal", () => {
    const view = read(packet);
    expect(view).not.toBeNull();
    expect(
      assessmentPurchaseOutcome(view, attempt, "game-a", "payer-a", 21),
    ).toEqual(receipt);
    expect(
      assessmentPurchaseOutcome(view, attempt, "game-b", "payer-a", 21),
    ).toBeNull();
    expect(
      assessmentPurchaseOutcome(view, attempt, "game-a", "payer-b", 21),
    ).toBeNull();
    expect(
      assessmentPurchaseOutcome(view, attempt, "game-a", "payer-a", 19),
    ).toBeNull();
    expect(
      assessmentPurchaseOutcome(
        read({ ...packet, receipts: [{ ...receipt, requestId: "other" }] }),
        attempt,
        "game-a",
        "payer-a",
        21,
      ),
    ).toBeNull();
    expect(
      assessmentPurchaseOutcome(
        read({
          ...packet,
          receipts: [{ ...receipt, targetId: "another-nation" }],
        }),
        attempt,
        "game-a",
        "payer-a",
        21,
      ),
    ).toBeNull();
  });

  it("fails closed on malformed, duplicate, foreign, old and missing receipts", () => {
    for (const malformed of [
      { ...receipt, cost: "0" },
      { ...receipt, payerId: "other" },
      { ...receipt, effectiveTick: 22 },
      { ...receipt, targetId: attempt.actorId },
      { ...receipt, fabricatedTransaction: true },
    ])
      expect(read({ ...packet, receipts: [malformed] })).toBeNull();
    expect(read({ ...packet, receipts: [receipt, receipt] })).toBeNull();
    expect(
      assessmentPurchaseOutcome(
        read({ ...packet, receipts: [{ ...receipt, effectiveTick: 19 }] }),
        attempt,
        "game-a",
        "payer-a",
        21,
      ),
    ).toBeNull();
    expect(
      assessmentPurchaseOutcome(
        read({ version: 1, recipientId: attempt.actorId, items: [] }),
        attempt,
        "game-a",
        "payer-a",
        21,
      ),
    ).toBeNull();
  });

  it("displays denial only from an exact rejected zero-cost transaction", () => {
    const denied = { ...receipt, outcome: "rejected", cost: "0" };
    expect(
      assessmentPurchaseOutcome(
        read({ ...packet, receipts: [denied] }),
        attempt,
        "game-a",
        "payer-a",
        21,
      ),
    ).toEqual(denied);
    expect(
      read({ ...packet, receipts: [{ ...denied, cost: "1200" }] }),
    ).toBeNull();
  });
});
