import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Temporary isolated pinned-oxfmt probe; NEVER edits the checkout.
describe("E5 third-class exact formatter capture", () => {
  it("records pinned oxfmt bytes for the E5 political verifier", () => {
    const path = "scripts/national-qa/browser-r11-political-verdict.mjs";
    const scratch = mkdtempSync(resolve(".e5-r11-class3-format-"));
    try {
      const target = resolve(scratch, path);
      mkdirSync(resolve(target, ".."), { recursive: true });
      copyFileSync(path, target);
      const run = spawnSync(resolve("node_modules/.bin/oxfmt"), ["--write", target], {
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      expect(run.error).toBeUndefined();
      expect(run.status, String(run.stderr)).toBe(0);
      const formatted = readFileSync(target).toString("base64");
      const chunks = Math.ceil(formatted.length / 3500);
      for (let index = 0; index < chunks; index++) {
        console.info(
          "E5_CLASS3_FORMAT " +
            JSON.stringify({
              path,
              index,
              chunks,
              payload: formatted.slice(index * 3500, (index + 1) * 3500),
            }),
        );
      }
      console.info("E5_CLASS3_FORMAT_DONE=" + chunks);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
