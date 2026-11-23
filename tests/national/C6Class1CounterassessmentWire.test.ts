import {
  validateNationalAssessmentPacket,
} from "@openfront/engine-api/game/NationalAssessmentView";
const report = {
  version: 1 as const,
  recipientId: "lawful-assessor",
  items: [{
    targetId: "shielded-target",
    paidBy: "lawful-assessor",
    confidence: "shielded-coarse-estimate" as const,
    effectiveTick: 50,
    expiresAtTick: 950,
    treasuryGoldBand: { lower: "10000", upperExclusive: "20000" },
    militaryTroopsBand: { lower: "400000", upperExclusive: "800000" },
  }],
};
describe("C6 E4: adversarial recipient-scoped shielded strength wire", () => {
  it("accepts only aligned 10000/400000 truthful-interval format with reduced confidence", () => {
    expect(() => validateNationalAssessmentPacket(
      report, report.recipientId, 51,
    )).not.toThrow();
    for (const item of [
      { ...report.items[0], confidence: "coarse-estimate" },
      { ...report.items[0], confidence: "hidden" },
      { ...report.items[0], confidence: undefined },
      { ...report.items[0], treasuryGoldBand: { lower: "10001", upperExclusive: "20001" } },
      { ...report.items[0], treasuryGoldBand: { lower: "10000", upperExclusive: "12500" } },
      { ...report.items[0], treasuryGoldBand: { lower: "10000", upperExclusive: "30000" } },
      { ...report.items[0], militaryTroopsBand: { lower: "400000", upperExclusive: "500000" } },
      { ...report.items[0], militaryTroopsBand: { lower: "1", upperExclusive: "400001" } },
      { ...report.items[0], exactGold: "13877" },
      { ...report.items[0], secretShieldRequestId: "private" },
    ]) {
      expect(() => validateNationalAssessmentPacket({
        ...report, items: [item],
      }, report.recipientId, 51)).toThrow();
    }
  });
  it("refuses cross-seat, spectator, forged time, oversized lists and fake raw state", () => {
    expect(() => validateNationalAssessmentPacket(report, "foreign", 51))
      .toThrow(/invalid recipient/);
    expect(() => validateNationalAssessmentPacket(report, null, 51))
      .toThrow(/invalid recipient/);
    expect(() => validateNationalAssessmentPacket(report, report.recipientId, 950))
      .toThrow(/invalid coarse lease/);
    expect(() => validateNationalAssessmentPacket({
      ...report, items: Array.from({length: 2049}, () => report.items[0]),
    }, report.recipientId, 51)).toThrow();
    expect(() => validateNationalAssessmentPacket({
      ...report, shields: [],
    }, report.recipientId, 51)).toThrow();
  });
});
