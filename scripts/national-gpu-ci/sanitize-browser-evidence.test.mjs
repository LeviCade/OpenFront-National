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
  stage: "sovereign-victory",
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
      const target = join(
        dir,
        mode.startsWith("legacy-")
          ? "browser-legacy-ffa-" + mode.split("-")[1]
          : "browser-" + mode,
      );
      mkdirSync(target, { recursive: true });
      const report = sample();
      report.hardwareAcceptanceRequired = false;
      report.viewport = mode.endsWith("mobile")
        ? "390x844 mobile"
        : "1280x800 desktop";
      report.actualHardware.webgl1 = {
        supported: true,
        contextLost: false,
        unmaskedRenderer: report.actualHardware.webgl.unmaskedRenderer,
        shaderPixel: PIXEL,
      };
      report.actualHardware.webgl.supported = true;
      report.actualHardware.webgl.contextLost = false;
      const legacy = mode.startsWith("legacy-");
      const completedStages = legacy
        ? ["legacy-ffa", "legacy-player-action"]
        : [
          "found-empire",
          "rejected-founding",
          "offer-accession",
          "recipient-invitation",
          "recipient-acceptance",
          "transfer-crown",
          "declare-war",
          "map-assault",
          "combat-impact",
          "propose-peace",
          "accept-peace"
        ];
      for (const finished of completedStages) {
        report.events.push({ name: "stage-complete", stage: finished });
      }
      if (legacy) {
        report.stage = "legacy-player-action";
        report.events.push(
          { name: "legacy-ffa-verified" },
          { name: "legacy-actual-map-interaction-authoritative-update" },
        );
      } else {
        report.stage = "accept-peace";
        report.events.push(
          { name: "authoritative-empire-accepted" },
          { name: "authoritative-duplicate-rejected" },
          { name: "political-offer-engine-accepted" },
          { name: "political-recipient-private-invitation" },
          { name: "political-membership-confirmed-by-both" },
          { name: "political-crown-confirmed-by-both" },
          { name: "authoritative-war-declared" },
          { name: "authoritative-combat-impact" },
          { name: "authoritative-peace-proposal" },
          { name: "authoritative-peace-accepted" },
        );
      }
      writeFileSync(join(target, "acceptance.json"), JSON.stringify(report));
      const screenshotName = legacy
        ? "legacy-player-action.png"
        : "peace-accepted-ended-war.png";
      writeFileSync(
        join(target, screenshotName),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPcEqDBwMDAxMDAwMDAAAAOxgEwdJw6WQAAAABJRU5ErkJggg==",
          "base64",
        ),
      );
    }
    assert.equal(publishEvidence(dir, SHA, "diagnostic"), true);
    const published = JSON.parse(
      readFileSync(
        join(dir, "gpu", "public", "diagnostic", "summary.json"),
        "utf8",
      ),
    );
    assert.deepEqual(Object.keys(published.modes), MODES);
    assert.equal(published.allModesPass, true);
    assert.equal(published.lane, "diagnostic");
    assert.equal(published.releaseCertified, false);
    for (const mode of MODES) {
      const modeData = JSON.parse(
        readFileSync(
          join(dir, "gpu", "public", "diagnostic", mode + ".json"),
          "utf8",
        ),
      );
      assert.equal(modeData.reportPresent, true);
      assert.equal(modeData.outcome, "PASS");
      assert.equal(modeData.expectedViewport, modeData.actualViewport);
      assert.equal(modeData.screenshotCount, 1);
      const screenshotName = mode.startsWith("legacy-")
        ? "legacy-player-action.png"
        : "peace-accepted-ended-war.png";
      assert.match(modeData.screenshotSha256[screenshotName], /^[a-f0-9]{64}$/);
      assert.equal(
        modeData.stageReached,
        mode.startsWith("legacy-") ? "legacy-player-action" : "accept-peace",
      );
    }
    for (const mode of MODES) {
      assert.deepEqual(published.modes[mode].screenshotNames, [
        mode.startsWith("legacy-")
          ? "legacy-player-action.png"
          : "peace-accepted-ended-war.png",
      ]);
      assert.equal(published.modes[mode].hardware.proofAccepted, false);
    }
    assert.ok(!JSON.stringify(published).includes("UNPUBLISHABLE"));
    // A signed-looking event in guest-owned JSON cannot certify a release.
    for (const mode of MODES) {
      const target = join(
        dir,
        mode.startsWith("legacy-")
          ? "browser-legacy-ffa-" + mode.split("-")[1]
          : "browser-" + mode,
      );
      const raw = JSON.parse(
        readFileSync(join(target, "acceptance.json"), "utf8"),
      );
      raw.hardwareAcceptanceRequired = true;
      writeFileSync(join(target, "acceptance.json"), JSON.stringify(raw));
    }
    // The first diagnostic lane is immutable; no mixed or stale artifacts.
    assert.throws(
      () => publishEvidence(dir, SHA, "diagnostic"),
      /PUBLIC_EVIDENCE_DIRECTORY_NOT_EMPTY/,
    );
    assert.equal(publishEvidence(dir, SHA, "release"), false);
    const untrusted = JSON.parse(
      readFileSync(
        join(dir, "gpu", "public", "release", "summary.json"),
        "utf8",
      ),
    );
    assert.equal(untrusted.releaseCertified, false);
    assert.equal(untrusted.allModesPass, false);
    for (const mode of MODES) {
      assert.equal(untrusted.modes[mode].outcome, "UNVERIFIED");
      assert.equal(untrusted.modes[mode].reason, "SIGNED_WITNESS_NOT_VERIFIED");
      assert.equal(untrusted.modes[mode].hardware.proofAccepted, false);
      assert.equal(
        untrusted.modes[mode].hardware.browserClaimedSignedProof,
        true,
      );
    }
    rmSync(join(dir, "gpu", "public", "diagnostic"), {
      recursive: true,
      force: true,
    });
    assert.equal(publishEvidence(dir, SHA, "diagnostic"), false);
    const unsigned = JSON.parse(
      readFileSync(
        join(dir, "gpu", "public", "diagnostic", "summary.json"),
        "utf8",
      ),
    );
    assert.equal(unsigned.releaseCertified, false);
    assert.equal(unsigned.hostCleanupVerified, false);
    assert.equal(unsigned.lane, "diagnostic");
    assert.equal(
      unsigned.modes["legacy-desktop"].hardware.proofAccepted,
      false,
    );
    const changed = sample();
    changed.exactSource = "b".repeat(40);
    writeFileSync(
      join(dir, "browser-national-mobile", "acceptance.json"),
      JSON.stringify(changed),
    );
    rmSync(join(dir, "gpu", "public", "release"), {
      recursive: true,
      force: true,
    });
    assert.equal(publishEvidence(dir, SHA, "release"), false);
    const invalid = JSON.parse(
      readFileSync(
        join(dir, "gpu", "public", "release", "national-mobile.json"),
        "utf8",
      ),
    );
    assert.equal(invalid.reason, "SOURCE_MISMATCH");
    assert.equal(invalid.outcome, "UNVERIFIED");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R11 E5 first-failure stage names survive redaction", () => {
  for (const stageName of [
    "offer-accession",
    "recipient-invitation",
    "transfer-crown",
    "combat-impact",
    "accept-peace",
    "legacy-player-action",
  ]) {
    const failed = sample();
    failed.stage = stageName;
    assert.equal(summarizeBrowserEvidence(failed, SHA).stageReached, stageName);
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
    assert.equal(publishEvidence(dir, SHA), false);
    assert.ok(
      !readFileSync(
        join(dir, "gpu", "public", "release", "summary.json"),
        "utf8",
      ).includes("UNPUBLISHABLE_TOKEN_FROM_SYMLINK"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing report and wrong viewport never turn exit zero into an accepted game", () => {
  const dir = mkdtempSync(join(tmpdir(), "national-gpu-missing-"));
  try {
    mkdirSync(join(dir, "gpu"), { recursive: true });
    writeFileSync(
      join(dir, "gpu", "scenarios.jsonl"),
      MODES.map((scenario) =>
        JSON.stringify({ scenario, result: "PASS", exitCode: 0 }),
      ).join("\n") + "\n",
    );
    assert.equal(publishEvidence(dir, SHA, "diagnostic"), false);
    const output = JSON.parse(
      readFileSync(
        join(dir, "gpu", "public", "diagnostic", "summary.json"),
        "utf8",
      ),
    );
    assert.equal(output.releaseCertified, false);
    assert.equal(output.allModesPass, false);
    assert.deepEqual(Object.keys(output.modes), MODES);
    for (const mode of MODES) {
      assert.equal(output.modes[mode].reportPresent, false);
      assert.equal(output.modes[mode].outcome, "UNVERIFIED");
      assert.equal(output.modes[mode].reason, "REPORT_MISSING_OR_INVALID");
      assert.equal(output.modes[mode].screenshotCount, 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
