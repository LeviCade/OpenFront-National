/**
 * TEMPORARY ENGINEER 4 FORMAT DIAGNOSTIC.
 * Formats throwaway copies of owned files using the repository's exact
 * pinned oxfmt binary, and prints their replacements for PR repair.
 * Does not change tracked source files. DELETE AFTER APPLYING RESULTS.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";

const files = [
  "src/client/NationalDiplomacyPanel.ts",
  "src/client/SinglePlayerModal.ts",
  "src/client/Transport.ts",
  "src/client/hud/layers/GameRightSidebar.ts",
  "src/client/view/GameView.ts",
  "tests/ui/national/NationalDiplomacyPanel.test.ts",
  "tests/ui/national/NationalDiplomacyState.test.ts",
  "tests/ui/national/NationalFoundingWire.test.ts"
];

describe("temporary owned-file formatter probe", () => {
  it("prints exact pinned-oxfmt output, leaving tracked files untouched", () => {
    for (const file of files) {
      const copy = file.replace(/\\.ts$/, ".format-probe.ts");
      try {
        writeFileSync(copy, readFileSync(file));
        execFileSync("./node_modules/.bin/oxfmt", ["--write", copy], {
          encoding: "utf8",
        });
        const formatted = readFileSync(copy).toString("base64");
        process.stdout.write(`NATIONAL_FORMAT_RESULT|${file}|${formatted}\n`);
      } finally {
        rmSync(copy, { force: true });
      }
    }
  });
});
