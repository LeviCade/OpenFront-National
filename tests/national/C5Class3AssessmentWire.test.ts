import { validateNationalAssessmentPacket } from "@openfront/engine-api/game/NationalAssessmentView";
import { NationalAssessmentViewSchema } from "@openfront/engine-api/game/NationalAssessmentView";

const valid = {
  version: 1 as const,
  recipientId: "authenticated-owner",
  items: [{
    targetId: "foreign-target",
    paidBy: "authenticated-owner",
    confidence: "coarse-estimate" as const,
    effectiveTick: 10,
    expiresAtTick: 910,
    treasuryGoldBand: { lower: "12500", upperExclusive: "15000" },
    militaryTroopsBand: { lower: "100000", upperExclusive: "200000" },
  }],
};
describe("M7 hostile trusted-host and browser statistical DTO", () => {
  it("requires the exact authenticated seat and bounded active lease", () => {
    expect(() => validateNationalAssessmentPacket(valid, "authenticated-owner", 11)).not.toThrow();
    expect(() => validateNationalAssessmentPacket(valid, "foreign-observer", 11)).toThrow(/invalid recipient/);
    expect(() => validateNationalAssessmentPacket(valid, null, 11)).toThrow(/invalid recipient/);
    expect(() => validateNationalAssessmentPacket(valid, "authenticated-owner", 910)).toThrow(/invalid coarse lease/);
    expect(() => validateNationalAssessmentPacket(valid, "authenticated-owner", 9)).toThrow(/invalid coarse lease/);
    expect(() => validateNationalAssessmentPacket(undefined, null, 11)).not.toThrow();
  });

  it("rejects exact-value smuggling, precision overrides, and confidential metadata", () => {
    const original = valid.items[0];
    const polluted = [
      { ...original, exactGold: "13777" },
      { ...original, militaryTroopsBand: { ...original.militaryTroopsBand, exact: 456789 } },
      { ...original, treasuryGoldBand: { lower: "12501", upperExclusive: "15001" } },
      { ...original, militaryTroopsBand: { lower: "100000", upperExclusive: "199999" } },
      { ...original, requestId: "private-journal-id" },
      { ...original, secretStructureLocations: [{ x: 12, y: 4 }] },
      { ...original, hiddenTreaties: [] },
      { ...original, transportLandingDestination: { x: 1, y: 1 } },
      { ...original, cost: "0" },
    ];
    for (const report of polluted) {
      expect(() => validateNationalAssessmentPacket({
        ...valid, items: [report],
      }, valid.recipientId, 11)).toThrow();
    }
    expect(NationalAssessmentViewSchema.safeParse({ ...valid, payerId: "hijack" }).success).toBe(false);
  });

  it("caps reports per seat and denies malformed or terminal reports", () => {
    expect(() => validateNationalAssessmentPacket({
      ...valid, items: Array.from({ length: 2049 }, () => valid.items[0]),
    }, valid.recipientId, 11)).toThrow();
    expect(() => validateNationalAssessmentPacket({
      ...valid, items: [{ ...valid.items[0], paidBy: valid.items[0].targetId }],
    }, valid.recipientId, 11)).toThrow(/invalid coarse lease/);
    expect(() => validateNationalAssessmentPacket({
      ...valid, items: [{
        ...valid.items[0],
        expiresAtTick: Number.MAX_SAFE_INTEGER,
      }],
    }, valid.recipientId, 11)).toThrow(/invalid coarse lease/);
  });
});
