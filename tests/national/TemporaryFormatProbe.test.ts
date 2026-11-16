import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, unlinkSync } from "node:fs";
import { it } from "vitest";

/** One-off round-three formatter diagnostic, removed before review. */
it("prints exact formatted E1 R3 changes from disposable copies", () => {
  const paths = [
    "packages/engine/src/game/Game.ts",
    "packages/engine/src/game/GameImpl.ts",
    "packages/engine/src/national/NationalRuntime.ts",
    "packages/engine/src/execution/NationalFoundEmpireExecution.ts",
    "packages/engine/src/national/politics/sovereignty.ts",
    "tests/national/LiveSovereignty.test.ts",
    "packages/engine/src/national/politics/ROUND3_LIVE_ENGINE.md",
  ];
  const tmp = paths.map((p) => p.replace(/\.(ts|md)$/, ".formatprobe.$1"));
  try {
    paths.forEach((file, i) => copyFileSync(file, tmp[i]));
    execFileSync("./node_modules/.bin/oxfmt", ["--write", ...tmp], {
      encoding: "utf8",
      stdio: "pipe",
    });
    tmp.forEach((file, index) => {
      const val = JSON.stringify(readFileSync(file, "utf8"));
      const step = 900;
      const total = Math.ceil(val.length / step);
      for (let part = 0; part < total; part++) {
        console.log(
          "NATIONAL_FMT_R3|" + index + "|" + part + "|" + total + "|" +
            val.slice(part * step, (part + 1) * step),
        );
      }
    });
  } finally {
    tmp.forEach((path) => {
      try { unlinkSync(path); } catch { /* preserve primary failure */ }
    });
  }
});
