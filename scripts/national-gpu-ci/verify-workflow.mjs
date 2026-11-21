#!/usr/bin/env node
// E6 workflow contract: cheap, no GPU, node modules, or remote CI required.
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "node:test";

const source = readFileSync(
  new URL("../../.github/workflows/national-hardware-acceptance.yml", import.meta.url),
  "utf8",
);

void test("workflow is manual-only and uses exactly one trusted GPU slot", () => {
  assert.match(source, /^on:\n  workflow_dispatch:/m);
  assert.match(source, /^  gpu-browser:\s*$/m);
  assert.deepEqual(
    [...source.split(/^jobs:\s*$/m)[1].matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map((m) => m[1]),
    ["gpu-browser"],
  );
  assert.match(source, /^    runs-on: skybot-ci-gpu$/m);
  assert.doesNotMatch(source, /runs-on: \[self-hosted, gpu\]|\bmatrix:|pull_request:|push:/);
  assert.match(source, /^  contents: read$/m);
});

void test("source gate pins immutable SHA and both ancestry directions", () => {
  for (const required of [
    "42e2b5d0a6372737b78178e5be49da7b76383d0a",
    "stage3/integration-20261115",
    "stage3/round6-combined-acceptance-20261116",
    "git merge-base --is-ancestor \"$BASE_SHA\" \"$NATIONAL_GPU_CANDIDATE_SHA\"",
    "git merge-base --is-ancestor \"$NATIONAL_GPU_CANDIDATE_SHA\" \"$staging\"",
    "test \"$GITHUB_REF\" = refs/heads/main",
    "git checkout --detach \"$NATIONAL_GPU_CANDIDATE_SHA\"",
    "persist-credentials: false",
  ]) assert.ok(source.includes(required), "missing source gate: " + required);
});

void test("one install then all four real E5 browser scenarios", () => {
  for (const required of [
    "CHROME_BIN: /opt/skybot-gpu-runtime/chrome-headless-shell-linux64/chrome-headless-shell",
    "NATIONAL_CHROME_ANGLE_BACKEND: gl-egl",
    'NATIONAL_REQUIRE_HARDWARE_GPU: "1"',
    'node-version: "24.15.0"',
    "npm@12.1.0",
    "npm run inst",
    "national-desktop national-mobile legacy-desktop legacy-mobile",
    "args=(--mobile)",
    "args=(--legacy)",
    "args=(--mobile --legacy)",
    "node scripts/national-qa/browser-gameplay.mjs",
    "scenarios.jsonl",
    "if: always()",
  ]) assert.ok(source.includes(required), "missing required stage: " + required);
  assert.equal((source.match(/npm run inst/g) ?? []).length, 1);
  assert.equal((source.match(/node scripts\/national-qa\/browser-gameplay\.mjs/g) ?? []).length, 1);
});

void test("hardware proof cannot be forged inside disposable guest", () => {
  for (const required of [
    "NATIONAL_GPU_ATTESTATION_FILE",
    "NATIONAL_GPU_PUBLIC_KEY_FILE",
    "NATIONAL_GPU_ATTESTATION_CHALLENGE",
    "trusted host-signed attestation not provisioned",
    "guest-inventory.txt",
  ]) assert.ok(source.includes(required), "missing proof gate: " + required);
  assert.doesNotMatch(source, /swiftshader|--disable-gpu|--enable-unsafe-swiftshader/);
  assert.doesNotMatch(source, /openssl .*genpkey|ssh-keygen .*ed25519/);
});
