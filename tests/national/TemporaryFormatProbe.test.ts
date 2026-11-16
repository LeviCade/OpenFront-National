import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, unlinkSync } from "node:fs";
import { it } from "vitest";

/** One-off exact project formatter evidence. Removed before PR review. */
it("reports formatted E1 R5 source from disposable file copies", () => {
  const paths = [
    "packages/engine/src/game/Game.ts",
    "packages/engine/src/game/GameImpl.ts",
    "packages/engine/src/national/NationalRuntime.ts",
    "packages/engine/src/execution/NationalFoundEmpireExecution.ts",
    "packages/engine/src/national/politics/NationalGovernanceState.ts",
    "tests/national/PoliticalMdaOutcomesMemory.test.ts",
    "packages/engine/src/national/politics/ROUND5_DATA_CONTRACT.md",
  ];
  const scratch = paths.map((p) => p.replace(/\.(ts|md)$/, ".r5formatprobe.$1"));
  try {
    paths.forEach((p, index) => copyFileSync(p, scratch[index]));
    execFileSync("./node_modules/.bin/oxfmt", ["--write", ...scratch], {
      encoding: "utf8",
      stdio: "pipe",
    });
    scratch.forEach((p, index) => {
      const json = JSON.stringify(readFileSync(p, "utf8"));
      const chunkSize = 900;
      const total = Math.ceil(json.length / chunkSize);
      for (let part = 0; part < total; part++)
        console.log(
          "NATIONAL_FMT_R5|" + index + "|" + part + "|" + total + "|" +
            json.slice(part * chunkSize, (part + 1) * chunkSize),
        );
    });
  } finally {
    scratch.forEach((p) => {
      try { unlinkSync(p); } catch { /* scratch-only cleanup */ }
    });
  }
});
