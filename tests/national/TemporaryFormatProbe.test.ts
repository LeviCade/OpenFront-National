import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, unlinkSync } from "node:fs";
import { it } from "vitest";

/** Temporary CI-only formatter evidence; removed before final review. */
it("prints formatted E1 round-two files without touching tracked source", () => {
  const files = [
    "packages/engine/src/national/politics/PoliticalAuthorityAdapter.ts",
    "tests/national/PoliticalAuthorityAdapter.test.ts",
    "packages/engine/src/national/politics/ROUND2_ADAPTER.md",
  ];
  const probes = files.map((f) => f.replace(/\.(ts|md)$/, ".formatprobe.$1"));
  try {
    files.forEach((file, i) => copyFileSync(file, probes[i]));
    execFileSync("./node_modules/.bin/oxfmt", ["--write", ...probes], {
      encoding: "utf8",
      stdio: "pipe",
    });
    probes.forEach((file, index) => {
      const value = JSON.stringify(readFileSync(file, "utf8"));
      const chunkSize = 900;
      const length = Math.ceil(value.length / chunkSize);
      for (let part = 0; part < length; part++) {
        console.log(
          "NATIONAL_FMT_R2|" +
            index +
            "|" +
            part +
            "|" +
            length +
            "|" +
            value.slice(part * chunkSize, (part + 1) * chunkSize),
        );
      }
    });
  } finally {
    probes.forEach((p) => {
      try {
        unlinkSync(p);
      } catch {
        // Preserve original formatting failure if a scratch copy vanished.
      }
    });
  }
});
