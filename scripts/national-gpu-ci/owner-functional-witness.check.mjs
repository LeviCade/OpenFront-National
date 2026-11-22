import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyFunctional } from "./owner-functional-witness.mjs";

const sha = "a".repeat(40);
const gl = {
  supported: true,
  contextLost: false,
  glError: 0,
  shaderPixel: [51, 102, 153, 255],
  unmaskedRenderer: "ANGLE (Apple, Apple M5 Max)",
  unmaskedVendor: "Apple",
};
function report(mode) {
  const legacy = mode.startsWith("legacy-");
  const stage = legacy ? "legacy-player-action" : "solo-playability-complete";
  return {
    exactSource: sha,
    stage,
    viewport: mode.endsWith("mobile") ? "390x844 mobile" : "1280x800 desktop",
    scenarioKind: legacy ? "legacy" : "national-solo",
    hardwareAcceptanceRequired: false,
    errors: [],
    actualHardware: { webgl1: { ...gl }, webgl: { ...gl } },
    events: [
      { name: "stage-complete", stage },
      ...(legacy
        ? [
            { name: "stage-complete", stage: "legacy-ffa" },
            { name: "legacy-ffa-verified" },
            { name: "legacy-actual-map-interaction-authoritative-update" },
          ]
        : [
            {
              name: "authoritative-solo-playability-complete",
              founded: true,
              spawned: true,
              warDeclared: true,
              realRadialAttack: true,
              opponentDamaged: true,
              liveTick: 100,
              workerPacketCount: 4,
            },
          ]),
    ],
  };
}
void test("all four synthetic positive reports remain explicitly non-certified and non-independent", () => {
  for (const mode of [
    "national-desktop",
    "national-mobile",
    "legacy-desktop",
    "legacy-mobile",
  ]) {
    const verdict = classifyFunctional(mode, sha, 0, report(mode));
    assert.equal(verdict.functionalGameplayObserved, true);
    assert.equal(verdict.rendererAndShadersObserved, true);
    assert.equal(verdict.releaseCertified, false);
    assert.equal(verdict.independentGameplayWitness, false);
    assert.equal(verdict.signedPreflightAccepted, false);
    assert.equal(verdict.physicalTeardownObserved, false);
  }
});
void test("software, generic, context loss, shader mismatch and renderer substitution fail", () => {
  for (const delta of [
    { unmaskedRenderer: "Google SwiftShader" },
    { unmaskedRenderer: "ANGLE" },
    { contextLost: true },
    { shaderPixel: [0, 0, 0, 0] },
    { glError: 1280 },
    { unmaskedRenderer: "NVIDIA different GPU" },
  ]) {
    const r = report("national-desktop");
    Object.assign(r.actualHardware.webgl, delta);
    assert.equal(
      classifyFunctional("national-desktop", sha, 0, r)
        .rendererAndShadersObserved,
      false,
    );
  }
});
void test("wrong scenario, stale source, browser failure or partial Solo are not functional passes", () => {
  const mode = "national-desktop";
  const r = report(mode);
  assert.equal(
    classifyFunctional(mode, sha, 1, r).functionalGameplayObserved,
    false,
  );
  for (const changed of [
    { scenarioKind: "national-three-player" },
    { exactSource: "b".repeat(40) },
    { viewport: "390x844 mobile" },
    { events: r.events.slice(0, 1) },
    { errors: [{}] },
  ]) {
    assert.equal(
      classifyFunctional(mode, sha, 0, { ...r, ...changed })
        .functionalGameplayObserved,
      false,
    );
  }
  r.events[1].opponentDamaged = false;
  assert.equal(
    classifyFunctional(mode, sha, 0, r).functionalGameplayObserved,
    false,
  );
});
