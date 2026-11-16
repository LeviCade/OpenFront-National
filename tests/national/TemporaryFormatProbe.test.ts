import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, unlinkSync } from "node:fs";
import { it } from "vitest";

/**
 * Temporary offline formatting diagnostic. Never changes tracked files.
 * Removed before the final PR revision.
 */
it("reports exact oxfmt output for scoped NATIONAL files", () => {
  const files = [
    "packages/engine/src/national/politics/sovereignty.ts",
    "tests/national/PoliticalState.test.ts",
    "packages/engine/src/national/politics/README.md",
  ];
  const probes = files.map((f) => f.replace(/\.(ts|md)$/, ".formatprobe.$1"));
  try {
    files.forEach((f, index) => copyFileSync(f, probes[index]));
    execFileSync("./node_modules/.bin/oxfmt", ["--write", ...probes], {
      encoding: "utf8",
      stdio: "pipe",
    });
    probes.forEach((p, fileIndex) => {
      const json = JSON.stringify(readFileSync(p, "utf8"));
      const width = 900;
      const count = Math.ceil(json.length / width);
      for (let part = 0; part < count; part++) {
        console.log(
          "NATIONAL_FMT|" +
            fileIndex +
            "|" +
            part +
            "|" +
            count +
            "|" +
            json.slice(part * width, (part + 1) * width),
        );
      }
    });
  } finally {
    probes.forEach((p) => {
      try {
        unlinkSync(p);
      } catch {
        // A missing transient probe is not a reason to mask an oxfmt error.
      }
    });
  }
});
