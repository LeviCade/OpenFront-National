import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Temporary diagnostic to capture Oxfmt's exact source output in CI logs.
 * Runs on disposable copies only; NEVER mutates repository files.
 * Remove this file after updating the real source files from its output.
 */
describe("NATIONAL Engineer 2 formatter diagnostic", () => {
  it("formats temporary copies without changing checked-out files", () => {
    if (!process.env.CI) return;
    const sources = [
      "packages/engine/src/national/conflict/WarLedger.ts",
      "packages/engine/src/national/conflict/DefenseLevy.ts",
      "tests/national/Conflict.test.ts",
      "packages/engine/src/national/conflict/README.md",
    ];
    const dir = mkdtempSync(join(process.cwd(), ".e2-format-probe-"));
    try {
      sources.forEach((source, index) => {
        const temporary = join(dir, `source-${index}.${source.endsWith(".md") ? "md" : "ts"}`);
        copyFileSync(source, temporary);
        const result = spawnSync("./node_modules/.bin/oxfmt", ["--write", temporary], {
          cwd: process.cwd(),
          encoding: "utf8",
        });
        expect(result.status, result.stderr || result.stdout).toBe(0);
        const formatted = readFileSync(temporary);
        console.log(`NATIONAL_E2_FMT|${source}|${formatted.toString("base64")}`);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
