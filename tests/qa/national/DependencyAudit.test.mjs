import { describe, expect, it } from "vitest";
import {
  compareDependencyRisk,
  summarizeNpmAudit,
} from "../../../scripts/national-qa/security-audit.mjs";

const payload = (counts, vulnerabilities = {}) => ({
  metadata: { vulnerabilities: counts }, vulnerabilities,
});
const counts = (moderate = 0, high = 0) => ({
  info: 0, low: 0, moderate, high, critical: 0,
  total: moderate + high,
});

describe("R10 E5 fail-closed production versus development npm review", () => {
  it("distinguishes zero production from outstanding development advisories", () => {
    const production = summarizeNpmAudit(payload(counts()));
    const full = summarizeNpmAudit(payload(counts(1, 1), {
      "dev-builder": { severity: "high", isDirect: true, fixAvailable: false },
      "dev-tool": { severity: "moderate", isDirect: false, fixAvailable: true },
    }));
    expect(compareDependencyRisk(production, full)).toMatchObject({
      productionAdvisoriesZero: true,
      developmentReviewPending: true,
      publicReleaseSecurityCleared: false,
    });
  });
  it("never converts missing audit metadata or invalid counts to zero risk", () => {
    expect(() => summarizeNpmAudit({})).toThrow(/AUDIT_JSON_INCOMPLETE/);
    expect(() => summarizeNpmAudit(payload({
      ...counts(), total: -1,
    }))).toThrow(/COUNT_INVALID/);
    expect(() => summarizeNpmAudit(payload({
      ...counts(1), total: 0,
    }))).toThrow(/DO_NOT_SUM/);
  });
});
