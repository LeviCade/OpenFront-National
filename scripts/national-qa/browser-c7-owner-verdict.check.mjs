import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyOwnerResolution } from "./browser-c7-owner-verdict.mjs";
import { MODES, LEGACY_STAGES, SOLO_STAGES } from "../national-gpu-ci/sanitize-browser-evidence.mjs";

const sha = "a".repeat(40);
const gl = {
  supported: true,
  contextLost: false,
  glError: 0,
  shaderPixel: [51, 102, 153, 255],
  unmaskedRenderer: "ANGLE (Mesa, virgl (Mesa Intel(R) HD Graphics 4600 (HSW GT2)), OpenGL ES 3.2)",
  unmaskedVendor: "Intel",
};
function fixture(mode) {
  const legacy = mode.startsWith("legacy-");
  const mobile = mode.endsWith("mobile");
  const stages = legacy ? LEGACY_STAGES : SOLO_STAGES;
  return {
    exactSource: sha,
    scenarioKind: legacy ? "legacy" : "national-solo",
    viewport: mobile ? "390x844 mobile" : "1280x800 desktop",
    hardwareAcceptanceRequired: false,
    stage: stages.at(-1),
    errors: [],
    restrictedRuntimeAssets: [],
    actualHardware: { webgl1: { ...gl }, webgl: { ...gl } },
    events: [
      ...stages.map((stage) => ({ name: "stage-complete", stage })),
      { name: mobile ? "actual-touch-input" : "actual-mouse-input" },
      { name: "owner-functional-bounded-native-config", verified: true },
      ...(legacy
        ? [
            { name: "legacy-ffa-verified" },
            { name: "legacy-actual-map-interaction-authoritative-update" },
            {
              name: "legacy-real-combat-engine-correlated",
              actorCorrelated: true,
              observedEngineChange: true,
              sameGameId: true,
              tick: 100,
            },
          ]
        : [
            { name: "authoritative-empire-accepted", verified: true },
            { name: "authoritative-war-declared", uiConfirmed: true },
            { name: "authoritative-combat-impact" },
            { name: "solo-real-battle-engine-correlated", opponentDamaged: true, troopLoss: true },
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
      {
        name: "authoritative-game-resolution",
        verified: true,
        uiConfirmed: true,
        sameGameId: true,
        tick: 200,
        classification: legacy ? "LEGACY_WINNER" : "NATIONAL_IMPERIAL",
      },
    ],
  };
}
const run = (mode, report, code = 0, software = false) =>
  classifyOwnerResolution(mode, sha, code, report, software);
void test("four synthetic full journeys classify as owner-functional, never release", () => {
  for (const mode of MODES) {
    const result = run(mode, fixture(mode));
    assert.equal(result.gameplayObserved, true);
    assert.equal(result.terminalObserved, true);
    assert.equal(result.releaseCertified, false);
    assert.equal(result.signedPreflightAccepted, false);
    assert.equal(result.independentGameplayWitness, false);
  }
});
void test("combat-only and spawn-only cannot stand in for genuine resolution", () => {
  for (const mode of MODES) {
    const report = fixture(mode);
    report.events.pop();
    assert.equal(run(mode, report).gameplayObserved, false);
  }
});
void test("stale, duplicate, wrong-kind, hidden or uncorrelated terminal evidence fails", () => {
  for (const patch of [
    { tick: 99 },
    { tick: NaN },
    { classification: "LEGACY_WINNER" },
    { verified: false },
    { uiConfirmed: false },
    { sameGameId: false },
  ]) {
    const report = fixture("national-desktop");
    Object.assign(report.events.at(-1), patch);
    assert.equal(run("national-desktop", report).gameplayObserved, false);
  }
  const duplicate = fixture("legacy-desktop");
  duplicate.events.push(duplicate.events.at(-1));
  assert.equal(run("legacy-desktop", duplicate).gameplayObserved, false);
});
void test("software, missing touch, wrong head, errors and missing combat are not passes", () => {
  const mode = "legacy-mobile";
  for (const change of [
    (r) => { r.exactSource = "b".repeat(40); },
    (r) => { r.errors.push({ error: "private raw text" }); },
    (r) => { r.events = r.events.filter((e) => e.name !== "actual-touch-input"); },
    (r) => { r.events = r.events.filter((e) => e.name !== "legacy-real-combat-engine-correlated"); },
    (r) => { r.actualHardware.webgl1.unmaskedRenderer = "SwiftShader"; },
    (r) => { r.restrictedRuntimeAssets.push({}); },
  ]) {
    const report = fixture(mode);
    change(report);
    assert.equal(run(mode, report).gameplayObserved, false);
  }
  assert.equal(run(mode, fixture(mode), 1).gameplayObserved, false);
  assert.equal(run(mode, fixture(mode), 0, true).gameplayObserved, false);
});
