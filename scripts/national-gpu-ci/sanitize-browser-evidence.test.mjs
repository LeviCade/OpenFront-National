import { strict as assert } from "node:assert";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  MODES,
  publishEvidence,
  summarizeBrowserEvidence,
} from "./sanitize-browser-evidence.mjs";

const SHA = "a".repeat(40);
const PIXEL = [51, 102, 153, 255];
const verified = {
  name: "strict-hardware-renderer-attestation",
  accepted: true,
  reason: "SIGNED_HOST_BACKED_VIRGL_VERIFIED",
};
const sample = () => ({
  exactSource: SHA,
  stage: "found-empire",
  elapsedMs: 100,
  actualHardware: {
    webgl: {
      unmaskedRenderer:
        "ANGLE (Mesa, virgl (Mesa Intel(R) HD Graphics 4600 (HSW GT2)), OpenGL ES 3.2)",
      shaderPixel: PIXEL,
    },
    webgl1: { shaderPixel: PIXEL },
  },
  events: [verified, { name: "stage-complete", stage: "home" }],
  errors: [{ error: "UNPUBLISHABLE_CONSOLE_TOKEN=secret-123" }],
  browserConsole: [{ text: "UNPUBLISHABLE_CONSOLE_TOKEN=secret-123" }],
  workerPackets: [
    {
      type: "worker_game_update",
      privateFog: "UNPUBLISHABLE_PRIVATE_FOG=secret-123",
      commandResults: [
        { accepted: true, requestId: "UNPUBLISHABLE_AUTH_TOKEN" },
        { accepted: false, reason: "UNPUBLISHABLE_PRIVATE_REASON" },
      ],
      publicPolitics: { empires: [{ id: "public" }] },
    },
  ],
  runtimeAssetRequests: [
    {
      origin: "https://secret.example",
      path: "/UNPUBLISHABLE_AUTH_TOKEN.mp3",
    },
  ],
  restrictedRuntimeAssets: [],
  networkErrors: [],
});

test("redacted report reveals only schema-listed performance and GPU evidence", () => {
  const result = summarizeBrowserEvidence(sample(), SHA);
  assert.equal(result.hardware.proofAccepted, true);
  assert.equal(result.sourceMatches, true);
  assert.deepEqual(result.completedStages, ["home"]);
  assert.deepEqual(result.packetCounts, {
    observed: 1,
    withPublicPolitics: 1,
    acceptedResults: 1,
    rejectedResults: 1,
  });
  const text = JSON.stringify(result);
  for (const marker of [
    "UNPUBLISHABLE",
    "privateFog",
    "browserConsole",
    "runtimeAssetRequests",
    "requestId",
  ])
    assert.ok(!text.includes(marker), "leak marker: " + marker);
});

test("mismatched source or absent independently verified hardware never passes", () => {
  assert.equal(
    summarizeBrowserEvidence(sample(), "b".repeat(40)).sourceMatches,
    false,
  );
  assert.equal(
    summarizeBrowserEvidence(sample(), SHA).hardware.proofAccepted,
    true,
  );
  const forged = sample();
  forged.events = [{ ...verified, accepted: false }];
  assert.equal(
    summarizeBrowserEvidence(forged, SHA).hardware.proofAccepted,
    false,
  );
});

test("publish four separate reports; reject absent proof and nonmatching source", () => {
  const dir = mkdtempSync(join(tmpdir(), "national-gpu-public-"));
  try {
    mkdirSync(join(dir, "gpu"), { recursive: true });
    writeFileSync(
      join(dir, "gpu", "scenarios.jsonl"),
      MODES.map((scenario) =>
        JSON.stringify({ scenario, result: "PASS", exitCode: 0 }),
      ).join("\n") + "\n",
    );
    for (const mode of MODES) {
      const target = join(dir, "browser-" + mode);
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, "acceptance.json"), JSON.stringify(sample()));
      writeFileSync(
        join(target, "home.png"),
        Buffer.from("89504e470d0a1a0a", "hex"),
      );
    }
    assert.equal(publishEvidence(dir, SHA), true);
    const published = JSON.parse(
      readFileSync(join(dir, "gpu", "public", "summary.json"), "utf8"),
    );
    assert.deepEqual(Object.keys(published.modes), MODES);
    for (const mode of MODES) {
      assert.deepEqual(published.modes[mode].screenshotNames, ["home.png"]);
      assert.equal(published.modes[mode].hardware.proofAccepted, true);
    }
    assert.ok(!JSON.stringify(published).includes("UNPUBLISHABLE"));
    const changed = sample();
    changed.exactSource = "b".repeat(40);
    writeFileSync(
      join(dir, "browser-national-mobile", "acceptance.json"),
      JSON.stringify(changed),
    );
    assert.equal(publishEvidence(dir, SHA), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("symlink named .png does not permit reading arbitrary filesystem content", () => {
  const dir = mkdtempSync(join(tmpdir(), "national-gpu-public-symlink-"));
  try {
    mkdirSync(join(dir, "gpu"), { recursive: true });
    const browser = join(dir, "browser-national-desktop");
    mkdirSync(browser, { recursive: true });
    writeFileSync(join(dir, "secret.txt"), "UNPUBLISHABLE_TOKEN_FROM_SYMLINK");
    symlinkSync(join(dir, "secret.txt"), join(browser, "home.png"));
    publishEvidence(dir, SHA);
    assert.ok(
      !readFileSync(
        join(dir, "gpu", "public", "summary.json"),
        "utf8",
      ).includes("UNPUBLISHABLE_TOKEN_FROM_SYMLINK"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
