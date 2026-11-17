/** Temporary pinned formatter probe, delete after exact client-test repair. */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";

describe("E4 exact panel formatting", () => {
  it("prints pinned formatter output from a throwaway copy", () => {
    const file = "tests/ui/national/NationalDiplomacyPanel.test.ts";
    const copy = "tests/ui/national/NationalDiplomacyPanel.formatter-probe.ts";
    try {
      writeFileSync(copy, readFileSync(file));
      execFileSync("./node_modules/.bin/oxfmt", ["--write", copy]);
      process.stdout.write(`E4_FORMAT_RESULT|${file}|${readFileSync(copy).toString("base64")}\n`);
    } finally {
      rmSync(copy, { force: true });
    }
  });
});
