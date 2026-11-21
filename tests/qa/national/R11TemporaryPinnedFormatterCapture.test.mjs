import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// One-time pinned formatter export for E5-owned files. It never changes the
// checkout or any workflow and contains no private packets or screenshot data.
describe("R11 E5 temporary pinned formatter verification", () => {
  it("records exact pinned oxfmt source output from isolated scratch copies", () => {
    const paths = [
      "scripts/national-qa/browser-gameplay.mjs",
      "scripts/national-qa/browser-r11-verdict.mjs",
      "scripts/national-qa/browser-verdict.mjs",
      "tests/qa/national/RoundElevenBrowserActions.test.mjs",
      "tests/qa/national/BrowserVerdict.test.mjs",
      "docs/release/NATIONAL_R11_E5_REAL_BROWSER_VERDICT.md",
    ];
    const scratch = mkdtempSync(resolve(".r11-e5-oxfmt-"));
    try {
      for (const path of paths) {
        const copy = resolve(scratch, path);
        mkdirSync(resolve(copy, ".."), { recursive: true });
        copyFileSync(path, copy);
      }
      const format = spawnSync(
        resolve("node_modules/.bin/oxfmt"),
        ["--write", ...paths.map((path) => resolve(scratch, path))],
        { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      expect(format.error).toBeUndefined();
      expect(format.status, String(format.stderr)).toBe(0);
      for (const path of paths) {
        const formatted = readFileSync(resolve(scratch, path));
        const base64 = formatted.toString("base64");
        const count = Math.ceil(base64.length / 3800);
        for (let index = 0; index < count; index++) {
          console.info("E5_R11_FORMAT " + JSON.stringify({
            path, index, count,
            payload: base64.slice(index * 3800, (index + 1) * 3800),
          }));
        }
      }
      console.info("E5_R11_PINNED_FORMAT_EXPORT_COMPLETE=" + paths.length);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
