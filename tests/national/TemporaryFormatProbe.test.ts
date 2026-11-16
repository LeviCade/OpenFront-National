import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, unlinkSync } from "node:fs";
import { it } from "vitest";

/** Temporary exact oxfmt evidence, deleted in the final commit. */
it("emits round-four formatted source from scratch copies only", () => {
  const files = [
    "packages/engine/src/national/politics/NationalWarState.ts",
    "packages/engine/src/game/Game.ts",
    "packages/engine/src/game/GameImpl.ts",
    "tests/national/LiveWarPoliticalState.test.ts",
    "packages/engine/src/national/politics/ROUND4_WAR_STATE.md",
  ];
  const tmp = files.map((p) => p.replace(/\.(ts|md)$/, ".formatprobe.$1"));
  try {
    files.forEach((file, i) => copyFileSync(file, tmp[i]));
    execFileSync("./node_modules/.bin/oxfmt", ["--write", ...tmp], {
      stdio: "pipe",
      encoding: "utf8",
    });
    tmp.forEach((file, index) => {
      const value = JSON.stringify(readFileSync(file, "utf8"));
      const size = 900;
      const count = Math.ceil(value.length / size);
      for (let part = 0; part < count; part++) {
        console.log(
          "NATIONAL_FMT_R4|" + index + "|" + part + "|" + count + "|" +
            value.slice(part * size, (part + 1) * size),
        );
      }
    });
  } finally {
    tmp.forEach((p) => {
      try { unlinkSync(p); } catch { /* never change the original tracked source */ }
    });
  }
});
