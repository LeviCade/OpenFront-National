import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("E5 second-wave pinned oxfmt capture (temporary)", () => {
  it("records formatter output for E5 source copies, never the checkout", () => {
    const files = [
      "scripts/national-qa/browser-gameplay.mjs",
      "scripts/national-qa/browser-verdict.mjs",
      "scripts/national-qa/solo-selection.mjs",
      "tests/qa/national/BrowserVerdict.test.mjs",
      "tests/qa/national/RoundTenSoloSelection.test.mjs",
    ];
    const scratch = mkdtempSync(resolve(".e5-second-wave-formatter-"));
    try {
      for (const file of files) {
        const copy = resolve(scratch, file);
        mkdirSync(resolve(copy, ".."), { recursive: true });
        copyFileSync(file, copy);
      }
      const result = spawnSync(
        resolve("node_modules/.bin/oxfmt"),
        ["--write", ...files.map((path) => resolve(scratch, path))],
        {
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, String(result.stderr)).toBe(0);
      for (const file of files) {
        const dest = resolve("national-qa-artifacts/r6/e5-formatted", file);
        mkdirSync(resolve(dest, ".."), { recursive: true });
        copyFileSync(resolve(scratch, file), dest);
        const bytes = readFileSync(dest);
        expect(bytes.length).toBeGreaterThan(0);
        // Reconstruct exact contents from bounded log chunks via the private
        // GitHub connector. Source only; no secrets, tokens or generated media.
        const base64 = bytes.toString("base64");
        const count = Math.ceil(base64.length / 4000);
        for (let index = 0; index < count; index++) {
          console.info(
            "E5_FMT_CHUNK " +
              JSON.stringify({
                path: file,
                index,
                count,
                payload: base64.slice(index * 4000, (index + 1) * 4000),
              }),
          );
        }
      }
      console.info("E5_SECOND_WAVE_FORMATTED_FILES_CAPTURED=" + files.length);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
