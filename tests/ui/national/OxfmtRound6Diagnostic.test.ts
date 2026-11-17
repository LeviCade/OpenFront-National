/**
 * Temporary Round Six formatter diagnostic. Writes only throwaway
 * .formatter-probe.ts copies; no tracked source is modified. Remove after use.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";

const files = [
  "src/client/NationalDiplomacyState.ts",
  "src/client/NationalDiplomacyPanel.ts",
  "src/client/Transport.ts",
  "tests/ui/national/NationalFoundingConfirmation.test.ts",
  "tests/ui/national/NationalDiplomacyPanel.test.ts",
  "tests/ui/national/NationalFoundingWire.test.ts"
];

describe("E4 pinned formatter proof", () => {
  it("prints canonical oxfmt copies for client-owned Round Six files", () => {
    for (const file of files) {
      const copy = `${file.slice(0, -3)}.formatter-probe.ts`;
      try {
        writeFileSync(copy, readFileSync(file));
        execFileSync("./node_modules/.bin/oxfmt", ["--write", copy]);
        process.stdout.write(`E4_FORMAT_RESULT|${file}|${readFileSync(copy).toString("base64")}\n`);
      } finally {
        rmSync(copy, { force: true });
      }
    }
  });
});
