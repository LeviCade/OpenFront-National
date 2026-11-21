import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ONE-TIME, ISOLATED CI FORMATTING CAPTURE. Delete this test immediately
 * after consuming its source-only artifact. Never modifies tested source,
 * protected upstream assets, game state, runner workflow or release checks.
 */
describe("E5 pinned oxfmt source-only capture", () => {
  it("exports the exact pinned formatter output of E5-owned files", () => {
    const paths = [
      "docs/release/NATIONAL_R10_E5_INDEPENDENT_ACCEPTANCE.md",
      "scripts/national-qa/browser-gameplay.mjs",
      "scripts/national-qa/browser-verdict.mjs",
      "scripts/national-qa/security-audit.mjs",
      "tests/qa/national/AssetReleaseAudit.test.mjs",
      "tests/qa/national/BrowserVerdict.test.mjs",
      "tests/qa/national/DependencyAudit.test.mjs",
      "tests/qa/national/RoundTenHostileGameRunner.test.ts",
    ];
    const sandbox = mkdtempSync(join(process.cwd(), ".e5-pinned-formatter-"));
    try {
      for (const path of paths) {
        mkdirSync(resolve(sandbox, path, ".."), { recursive: true });
        copyFileSync(path, resolve(sandbox, path));
      }
      const binary = resolve("node_modules/.bin/oxfmt");
      const outcome = spawnSync(
        binary,
        ["--write", ...paths.map((p) => resolve(sandbox, p))],
        { encoding: "utf8", timeout: 30000, maxBuffer: 2_000_000 },
      );
      expect(outcome.error).toBeUndefined();
      expect(outcome.status, String(outcome.stderr)).toBe(0);
      for (const path of paths) {
        const formatted = resolve(sandbox, path);
        const output = resolve("national-qa-artifacts/r6/e5-formatted", path);
        mkdirSync(resolve(output, ".."), { recursive: true });
        copyFileSync(formatted, output);
        expect(readFileSync(output).length).toBeGreaterThan(0);
      }
      console.info("E5_FORMATTED_FILES_CAPTURED=" + paths.length);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
