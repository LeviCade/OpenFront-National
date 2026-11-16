import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, unlinkSync } from "node:fs";
import { it } from "vitest";

/** Temporary post-public-view exact formatting audit; deleted before review. */
it("prints canonical formatter output from disposable Round Four files", () => {
  const files = [
    "packages/engine/src/national/NationalRuntime.ts",
    "packages/engine/src/game/Game.ts",
    "packages/engine/src/game/GameImpl.ts",
    "tests/national/LiveWarPoliticalState.test.ts",
    "packages/engine/src/national/politics/ROUND4_WAR_STATE.md",
  ];
  const tmp = files.map((p) => p.replace(/\.(ts|md)$/, ".formatprobe.$1"));
  try {
    files.forEach((p, i) => copyFileSync(p, tmp[i]));
    execFileSync("./node_modules/.bin/oxfmt", ["--write", ...tmp], {
      stdio: "pipe", encoding: "utf8",
    });
    tmp.forEach((p, index) => {
      const encoded = JSON.stringify(readFileSync(p, "utf8"));
      const step = 900, total = Math.ceil(encoded.length / step);
      for (let n = 0; n < total; n++)
        console.log(
          "NATIONAL_FMT_R4B|" + index + "|" + n + "|" + total + "|" +
            encoded.slice(n * step, (n + 1) * step),
        );
    });
  } finally {
    tmp.forEach((p) => { try { unlinkSync(p); } catch { /* scratch only */ } });
  }
});
