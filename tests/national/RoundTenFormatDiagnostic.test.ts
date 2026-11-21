import { spawnSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

/** Temporary branch-only diagnostic: reveal the exact pinned formatter diff. */
it("prints the authoritative oxfmt diff for the Round Ten owned test", () => {
  const source = resolve("tests/national/RoundTenSovereignCommandLoop.test.ts");
  const temp = resolve("tests/national/.r10-oxfmt-probe.ts");
  const bin = resolve("node_modules/.bin/oxfmt");
  try {
    copyFileSync(source, temp);
    const formatted = spawnSync(bin, ["--write", temp], {
      encoding: "utf8",
    });
    expect(formatted.status).toBe(0);
    const diff = spawnSync("diff", ["-u", source, temp], {
      encoding: "utf8",
      maxBuffer: 2_000_000,
    });
    console.info(
      "\n=== ROUND TEN OXFMT EXACT DIFF BEGIN ===\n" +
        diff.stdout +
        "\n=== ROUND TEN OXFMT EXACT DIFF END ===\n",
    );
    expect([0, 1]).toContain(diff.status);
  } finally {
    rmSync(temp, { force: true });
  }
});
