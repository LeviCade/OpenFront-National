import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const run = (strict = false) =>
  spawnSync(process.execPath, [
    "scripts/national-qa/asset-audit.mjs",
    ...(strict ? ["--strict-release"] : []),
  ], { encoding: "utf8" });

describe("R10 E5 inherited media and lawful release guard", () => {
  it("inventories every present media hash, actual music call site, and denies unreviewed release", () => {
    const sourceAudit = run();
    expect(sourceAudit.status).toBe(0);
    const report = JSON.parse(
      readFileSync("national-qa-artifacts/assets.json", "utf8"),
    );
    expect(report.status).toBe("PASS");
    expect(existsSync("proprietary")).toBe(false);
    expect(report.originReviewStatus).toBe("PENDING");
    for (const entry of report.resourceMediaProvenance) {
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.bytes).toBeGreaterThan(0);
      expect(entry.independentOriginReview).toBe("PENDING");
      expect(entry.path.startsWith("resources/")).toBe(true);
      expect(entry.path.includes("proprietary")).toBe(false);
    }
    for (const missing of report.missingMusic) {
      expect(existsSync("resources/" + missing)).toBe(false);
      const sites = report.musicCallSites.filter((s) => s.path === missing);
      expect(sites.length).toBeGreaterThan(0);
      for (const site of sites) {
        const lines = readFileSync(site.source, "utf8").split("\n");
        expect(lines[site.line - 1]).toContain(site.path);
      }
    }
    // A 0 shell-audit exit cannot override pending provenance or missing
    // audio. No protected upstream assets are fetched for this test.
    const releaseAudit = run(true);
    expect(releaseAudit.status).toBe(
      report.missingMusic.length || report.resourceMediaProvenance.length ? 1 : 0,
    );
    if (report.missingMusic.length || report.resourceMediaProvenance.length) {
      expect(report.publicReleaseReady).toBe(false);
    }
  });
});
