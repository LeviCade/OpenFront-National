import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** TEMPORARY: capture exact formatter output in CI; DELETE before final. */
describe("E2 R4 exact formatter probe", () => {
  it("captures official repository formatting on disposable file copies", () => {
    if (!process.env.CI) return;
    const sources = [
      "packages/engine/src/game/PlayerImpl.ts",
      "packages/engine/src/execution/NationalWarExecution.ts",
      "packages/engine/src/execution/AttackExecution.ts",
      "packages/engine/src/execution/ExecutionManager.ts",
      "packages/engine-api/src/Schemas.ts",
      "packages/engine/src/snapshot/ExecutionRegistry.ts",
      "tests/core/snapshot/FullGameSnapshot.test.ts",
      "tests/national/ConflictLiveGame.test.ts",
    ];
    const dir = mkdtempSync(join(process.cwd(), ".national-e2-r4-fmt-"));
    try {
      sources.forEach((source, index) => {
        const copy = join(dir, `file-${index}.ts`);
        copyFileSync(source, copy);
        const result = spawnSync("./node_modules/.bin/oxfmt", ["--write", copy], {
          cwd: process.cwd(),
          encoding: "utf8",
        });
        expect(result.status, result.stderr || result.stdout).toBe(0);
        console.log(`E2_R4_FORMAT|${source}|${readFileSync(copy).toString("base64")}`);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
