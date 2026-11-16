import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

describe("Temporary E3 exact patch formatter capture", () => {
  it("captures only the newly changed E3 files in pinned format", () => {
    const files = [
      "packages/engine/src/GameRunner.ts",
      "packages/engine/src/worker/Worker.worker.ts",
      "tests/national/NationalLiveObservation.test.ts",
      "packages/engine/src/national/README.md"
];
    const root = resolve(".");
    const tmp = mkdtempSync(join(tmpdir(), "e3-patchfmt-"));
    try {
      copyFileSync(join(root, ".oxfmtrc.json"), join(tmp, ".oxfmtrc.json"));
      for (const file of files) {
        const target = join(tmp, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(join(root, file)));
      }
      execFileSync(join(root, "node_modules", ".bin", "oxfmt"),
        ["--write", ...files], { cwd: tmp, timeout: 25000 });
      for (let f = 0; f < files.length; f++) {
        const encoded = readFileSync(join(tmp, files[f])).toString("base64");
        for (let i = 0; i < encoded.length; i += 700) {
          console.info("E3PATCHFMT|" + f + "|" + Math.floor(i / 700) + "|" +
            encoded.slice(i, i + 700));
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
