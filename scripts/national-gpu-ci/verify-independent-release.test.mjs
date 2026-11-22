import { strict as assert } from "node:assert";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  MODES,
  verifyIndependentRelease,
} from "./verify-independent-release.mjs";

const sourceSha = "a".repeat(40);
const challenge = "b".repeat(64);
const RUN_START = 1_780_000_000_000;
const COMPLETE = RUN_START + 90_000;
const NOW = COMPLETE + 20_000;
const pixel = [51, 102, 153, 255];
const renderer =
  "ANGLE (Mesa, virgl (Mesa Intel(R) HD Graphics 4600 (HSW GT2)), OpenGL ES 3.2)";
const digest = (v) => createHash("sha256").update(v).digest("hex");
const SIGNED_CLEANUP = {
  vmDestroyed: true,
  gpuLeaseReleased: true,
  renderNodeAclRestored: true,
  overlayDestroyed: true,
  tmpfsResidueCleared: true,
  efiResidueCleared: true,
  browserProcessesTerminated: true,
  privateLogsDestroyed: true,
  ephemeralRunnerDeregistered: true,
  cpuCapacityUnaffected: true,
};
const syntheticPng = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  Buffer.alloc(60, 5),
  Buffer.from("0000000049454e44ae426082", "hex"),
]);

/** Synthetic-only signing fixtures; these never represent real Skybot evidence. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "r11-e6-host-proof-test-"));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const enrolled = digest(publicKey.export({ type: "spki", format: "der" }));
  const expected = {
    repository: "LeviCade/OpenFront-National",
    repositoryId: "1459234894",
    sourceSha,
    runId: "44920010367",
    runAttempt: "1",
    jobId: "14920010367",
    runnerName: "skybot-gpu-openfront-national-452d86d9",
    runnerId: "12345",
    challenge,
    runStartedAtMs: RUN_START,
    jobCompletedAtMs: COMPLETE,
  };
  const modeReports = {};
  for (const mode of MODES) {
    const filename = "home.png";
    const dir = join(root, mode);
    mkdirSync(dir);
    writeFileSync(join(dir, filename), syntheticPng);
    const view = mode.endsWith("mobile")
      ? "390x844 mobile"
      : "1280x800 desktop";
    modeReports[mode] = {
      scenario: mode,
      outcome: "UNVERIFIED",
      reason: "SIGNED_WITNESS_NOT_VERIFIED",
      firstFailedStage: null,
      releaseCertified: false,
      exitCode: 0,
      stageComplete: true,
      reportPresent: true,
      sourceMatches: true,
      exactSource: sourceSha,
      expectedViewport: view,
      actualViewport: view,
      viewportMatches: true,
      laneMatches: true,
      screenshotCount: 1,
      screenshotNames: [filename],
      screenshotSha256: { [filename]: digest(syntheticPng) },
      hardware: {
        diagnosticObserved: true,
        renderer,
        webgl1ShaderPixel: pixel,
        webgl2ShaderPixel: pixel,
      },
    };
  }
  const summary = {
    schema: 3,
    expectedSourceSha: sourceSha,
    exactCandidateSha: sourceSha,
    lane: "release",
    releaseCertified: false,
    hostCleanupVerified: false,
    modes: modeReports,
  };
  const preflight = {
    version: 1,
    ...Object.fromEntries(
      Object.entries(expected).filter(
        ([k]) => !["runStartedAtMs", "jobCompletedAtMs"].includes(k),
      ),
    ),
    purpose: "skybot-gpu-preflight-v1",
    issuedAtMs: RUN_START,
    expiresAtMs: RUN_START + 60_000,
    host: {
      physicallyVerified: true,
      gpuAccessLeaseVerified: true,
      deviceVendorId: "8086",
      deviceId: "0412",
      driver: "i915",
      renderNode: "/dev/dri/renderD128",
      virtualization: "kvm",
      virglTransportVerified: true,
    },
    guest: {
      hardwareBackedVerified: true,
      backend: "virgl",
      renderer,
      webgl1Renderer: renderer,
      webgl1ShaderPixel: pixel,
      webgl2ShaderPixel: pixel,
    },
  };
  const cleanup = {
    version: 1,
    purpose: "skybot-gpu-postflight-v1",
    ...Object.fromEntries(
      Object.entries(expected).filter(
        ([k]) => !["runStartedAtMs", "jobCompletedAtMs"].includes(k),
      ),
    ),
    observedAtMs: COMPLETE + 1000,
    host: {
      deviceVendorId: "8086",
      deviceId: "0412",
      driver: "i915",
      renderNode: "/dev/dri/renderD128",
    },
    cleanup: { ...SIGNED_CLEANUP },
    evidenceSha256: "",
  };
  const wrap = (payload) => ({
    payload,
    signature: sign(
      null,
      Buffer.from(JSON.stringify(payload)),
      privateKey,
    ).toString("base64"),
  });
  const args = {
    artifactRoot: root,
    trustedPublicKeyPem: pem,
    enrolledFingerprints: [enrolled],
    hostTrustedFingerprints: [enrolled],
    expected,
    now: NOW,
    summaryBytes: Buffer.from(JSON.stringify(summary)),
    preflight: wrap(preflight),
    postflight: null,
  };
  const sync = () => {
    cleanup.evidenceSha256 = digest(args.summaryBytes);
    args.postflight = wrap(cleanup);
  };
  sync();
  return {
    root,
    args,
    summary,
    preflight,
    cleanup,
    sync,
    wrap,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("synthetic signed preflight and postflight bind all four modes and all screenshots", () => {
  const f = fixture();
  try {
    const result = verifyIndependentRelease(f.args);
    assert.equal(result.accepted, true);
    assert.equal(result.releaseCertified, true);
    assert.equal(result.hostCleanupVerified, true);
    assert.deepEqual(result.modes, MODES);
    assert.equal(result.sourceSha, sourceSha);
    assert.equal(result.runId, f.args.expected.runId);
  } finally {
    f.dispose();
  }
});

test("empty/mismatched pinned roots and guest-provided key always reject", () => {
  const f = fixture();
  try {
    assert.equal(
      verifyIndependentRelease({ ...f.args, enrolledFingerprints: [] }).reason,
      "OUT_OF_GUEST_TRUST_ROOT_NOT_ENROLLED",
    );
    assert.equal(
      verifyIndependentRelease({ ...f.args, hostTrustedFingerprints: [] })
        .accepted,
      false,
    );
    assert.equal(
      verifyIndependentRelease({
        ...f.args,
        hostTrustedFingerprints: ["0".repeat(64)],
      }).reason,
      "TRUST_ROOT_FINGERPRINT_MISMATCH",
    );
    assert.equal(
      verifyIndependentRelease({
        ...f.args,
        preflight: {
          ...f.args.preflight,
          publicKey: f.args.trustedPublicKeyPem,
        },
      }).reason,
      "PREFLIGHT_SIGNATURE_INVALID_OR_MISSING",
    );
  } finally {
    f.dispose();
  }
});

test("tampered Ed25519 signature or source/run/runner/nonce binding rejects", () => {
  const f = fixture();
  try {
    const mutated = {
      ...f.args.preflight,
      payload: { ...f.args.preflight.payload, runnerId: "5" },
    };
    assert.equal(
      verifyIndependentRelease({ ...f.args, preflight: mutated }).reason,
      "PREFLIGHT_SIGNATURE_INVALID_OR_MISSING",
    );
    for (const [field, value] of [
      ["sourceSha", "f".repeat(40)],
      ["runId", "40000000000"],
      ["runAttempt", "3"],
      ["jobId", "799"],
      ["runnerName", "stranger-runner"],
      ["runnerId", "99999"],
      ["challenge", "e".repeat(64)],
    ]) {
      const expected = { ...f.args.expected, [field]: value };
      assert.equal(
        verifyIndependentRelease({ ...f.args, expected }).accepted,
        false,
        field,
      );
    }
    const tampered = { ...f.args.postflight, signature: "A".repeat(86) + "==" };
    assert.equal(
      verifyIndependentRelease({ ...f.args, postflight: tampered }).reason,
      "POSTFLIGHT_SIGNATURE_INVALID_OR_MISSING",
    );
  } finally {
    f.dispose();
  }
});

test("freshness and post-job ordering are mandatory", () => {
  const f = fixture();
  try {
    f.preflight.issuedAtMs = RUN_START - 300_000;
    f.args.preflight = f.wrap(f.preflight);
    assert.equal(
      verifyIndependentRelease(f.args).reason,
      "HOST_WITNESS_TIMESTAMP_INVALID",
    );
    f.preflight.issuedAtMs = RUN_START;
    f.args.preflight = f.wrap(f.preflight);
    f.cleanup.observedAtMs = COMPLETE - 500;
    f.sync();
    assert.equal(
      verifyIndependentRelease(f.args).reason,
      "HOST_WITNESS_TIMESTAMP_INVALID",
    );
    f.cleanup.observedAtMs = COMPLETE + 1000;
    f.sync();
    assert.equal(verifyIndependentRelease(f.args).accepted, true);
  } finally {
    f.dispose();
  }
});

test("every physical teardown and deregistration fact must be signed true", () => {
  const f = fixture();
  try {
    for (const name of Object.keys(SIGNED_CLEANUP)) {
      f.cleanup.cleanup[name] = false;
      f.sync();
      assert.equal(
        verifyIndependentRelease(f.args).reason,
        "INDEPENDENT_HOST_CLEANUP_INCOMPLETE",
        name,
      );
      f.cleanup.cleanup[name] = true;
    }
    f.sync();
    assert.equal(verifyIndependentRelease(f.args).accepted, true);
  } finally {
    f.dispose();
  }
});

test("missing, divergent, symlinked and modified screenshots fail closed", () => {
  const f = fixture();
  try {
    const p = join(f.root, "legacy-desktop", "home.png");
    writeFileSync(p, Buffer.alloc(70, 1));
    assert.equal(
      verifyIndependentRelease(f.args).reason,
      "SCREENSHOT_PNG_INVALID_legacy-desktop",
    );
    const png = Buffer.from(syntheticPng);
    png[20] ^= 0x1;
    writeFileSync(p, png);
    assert.equal(
      verifyIndependentRelease(f.args).reason,
      "SCREENSHOT_DIGEST_MISMATCH_legacy-desktop",
    );
    unlinkSync(p);
    assert.equal(
      verifyIndependentRelease(f.args).reason,
      "SCREENSHOT_MISSING_legacy-desktop",
    );
    symlinkSync(join(f.root, "legacy-mobile", "home.png"), p);
    assert.equal(
      verifyIndependentRelease(f.args).reason,
      "SCREENSHOT_SYMLINK_OR_SIZE_legacy-desktop",
    );
  } finally {
    f.dispose();
  }
});

test("wrong lane, missing mode, failing NATIONAL gameplay and forged guest certification reject", () => {
  const f = fixture();
  try {
    const mutate = (fn) => {
      fn(f.summary);
      f.args.summaryBytes = Buffer.from(JSON.stringify(f.summary));
      f.sync();
      return verifyIndependentRelease(f.args);
    };
    assert.equal(
      mutate((s) => {
        s.lane = "diagnostic";
      }).reason,
      "UNTRUSTED_OR_INCOMPLETE_RELEASE_SUMMARY",
    );
    assert.equal(
      mutate((s) => {
        s.lane = "release";
        delete s.modes["legacy-mobile"];
      }).reason,
      "UNTRUSTED_OR_INCOMPLETE_RELEASE_SUMMARY",
    );
    assert.equal(
      mutate((s) => {
        s.modes["legacy-mobile"] = {
          ...s.modes["legacy-desktop"],
          scenario: "legacy-mobile",
        };
      }).accepted,
      false,
    );
    assert.equal(
      mutate((s) => {
        s.modes["national-desktop"].outcome = "FAIL";
      }).reason,
      "GAMEPLAY_MODE_EVIDENCE_INCOMPLETE_national-desktop",
    );
    assert.equal(
      mutate((s) => {
        s.modes["national-desktop"].outcome = "UNVERIFIED";
        s.modes["national-desktop"].reason = "GAMEPLAY_STAGE_FOUND_EMPIRE";
      }).reason,
      "GAMEPLAY_MODE_EVIDENCE_INCOMPLETE_national-desktop",
    );
    assert.equal(
      mutate((s) => {
        s.modes["national-desktop"].reason = "SIGNED_WITNESS_NOT_VERIFIED";
        s.modes["national-desktop"].firstFailedStage = "found-empire";
      }).reason,
      "GAMEPLAY_MODE_EVIDENCE_INCOMPLETE_national-desktop",
    );
    assert.equal(
      mutate((s) => {
        s.modes["national-desktop"].firstFailedStage = null;
        s.modes["national-desktop"].releaseCertified = true;
      }).reason,
      "GAMEPLAY_MODE_EVIDENCE_INCOMPLETE_national-desktop",
    );
    assert.equal(
      mutate((s) => {
        s.modes["national-desktop"].releaseCertified = false;
        s.modes["national-desktop"].exitCode = 1;
        s.modes["national-desktop"].outcome = "FAIL";
      }).reason,
      "GAMEPLAY_MODE_EVIDENCE_INCOMPLETE_national-desktop",
    );
    assert.equal(
      mutate((s) => {
        s.modes["national-desktop"].exitCode = 0;
        s.releaseCertified = true;
      }).reason,
      "UNTRUSTED_OR_INCOMPLETE_RELEASE_SUMMARY",
    );
  } finally {
    f.dispose();
  }
});

test("evidence summary digest cannot be swapped after host postflight signature", () => {
  const f = fixture();
  try {
    f.args.summaryBytes = Buffer.from(
      JSON.stringify({ ...f.summary, source: "tampered" }),
    );
    assert.equal(
      verifyIndependentRelease(f.args).reason,
      "EVIDENCE_DIGEST_MISMATCH",
    );
  } finally {
    f.dispose();
  }
});

test("signed postflight-shaped object cannot replace a preflight", () => {
  const f = fixture();
  try {
    f.preflight.purpose = "skybot-gpu-postflight-v1";
    f.args.preflight = f.wrap(f.preflight);
    assert.equal(
      verifyIndependentRelease(f.args).reason,
      "SIGNATURE_RUN_BINDING_MISMATCH",
    );
  } finally {
    f.dispose();
  }
});
