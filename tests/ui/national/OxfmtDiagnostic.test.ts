/**
 * Temporary exact-oxfmt diagnostic for E4 owned files; does NOT mutate
 * tracked code. Remove this test after applying its logs' canonical output.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";

const files = [
  "src/client/NationalDiplomacyPanel.ts",
  "src/client/NationalDiplomacyState.ts",
  "src/client/Transport.ts",
  "src/client/hud/layers/GameRightSidebar.ts",
  "src/client/view/GameView.ts",
  "tests/ui/national/NationalDiplomacyPanel.test.ts",
  "tests/ui/national/NationalDiplomacyState.test.ts",
  "tests/ui/national/NationalFoundingConfirmation.test.ts",
  "tests/ui/national/NationalFoundingWire.test.ts"
];

describe("temporary E4 pinned formatter diagnostic", () => {
  it("prints exact format replacements as UTF8 base64 with no tracked changes", () => {
    for (const file of files) {
      const copy = `${file.slice(0, -3)}.formatter-probe.ts`;
      try {
        writeFileSync(copy, readFileSync(file));
        execFileSync("./node_modules/.bin/oxfmt", ["--write", copy]);
        process.stdout.write(
          `E4_FORMAT_RESULT|${file}|${readFileSync(copy).toString("base64")}\n`,
        );
      } finally {
        rmSync(copy, { force: true });
      }
    }
  });
});
