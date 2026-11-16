import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Temporary non-mutating CI formatter capture; REMOVE before final commit. */
describe("NATIONAL Engineer #2 Round Two formatter diagnostic", () => {
  it("captures oxfmt results only on disposable copies", () => {
    if (!process.env.CI) return;
    const sources = [
      "packages/engine/src/national/conflict/DefenseLevy.ts",
      "packages/engine/src/national/conflict/README.md",
      "tests/national/Conflict.test.ts",
      "tests/national/DefenseLevyAtomic.test.ts",
    ];
    const dir = mkdtempSync(join(process.cwd(), ".e2-r2-format-probe-"));
    try {
      sources.forEach((source, index) => {
        const temporary = join(
          dir,
          `source-${index}.${source.endsWith(".md") ? "md" : "ts"}`,
        );
        copyFileSync(source, temporary);
        const result = spawnSync("./node_modules/.bin/oxfmt", ["--write", temporary], {
          cwd: process.cwd(),
          encoding: "utf8",
        });
        expect(result.status, result.stderr || result.stdout).toBe(0);
        console.log(
          `NATIONAL_E2_R2_FMT|${source}|${readFileSync(temporary).toString("base64")}`,
        );
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
