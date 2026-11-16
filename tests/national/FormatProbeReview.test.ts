import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Temporary CI-only style probe; removed before final PR review. */
describe("national review formatter diagnostic", () => {
  it("captures exact oxfmt output for changed files", () => {
    if (!process.env.CI) return;
    const sources = [
      "packages/engine/src/national/conflict/DefenseLevy.ts",
      "packages/engine/src/national/conflict/WarLedger.ts",
      "tests/national/Conflict.test.ts",
      "tests/national/DefenseLevyAtomic.test.ts",
      "tests/national/ConflictReviewReplay.test.ts",
    ];
    const dir = mkdtempSync(join(process.cwd(), ".national-review-probe-"));
    try {
      sources.forEach((source, index) => {
        const temp = join(dir, `source-${index}.ts`);
        copyFileSync(source, temp);
        const result = spawnSync("./node_modules/.bin/oxfmt", ["--write", temp], {
          cwd: process.cwd(),
          encoding: "utf8",
        });
        expect(result.status, result.stderr || result.stdout).toBe(0);
        console.log(`NATIONAL_REVIEW_FMT|${source}|${readFileSync(temp).toString("base64")}`);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
