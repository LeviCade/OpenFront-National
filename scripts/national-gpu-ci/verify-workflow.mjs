#!/usr/bin/env node
// E6 workflow contract: cheap, no GPU, node modules, or remote CI required.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(
  new URL(
    "../../.github/workflows/national-hardware-acceptance.yml",
    import.meta.url,
  ),
  "utf8",
);

const diagnostic = readFileSync(
  new URL(
    "../../.github/workflows/national-r10-owner-gpu-diagnostic.yml",
    import.meta.url,
  ),
  "utf8",
);
const runner = readFileSync(
  new URL("./run-four-modes.sh", import.meta.url),
  "utf8",
);

void test("strict default-main dispatch, owner admission and immutable Class Five staging", () => {
  assert.ok(source.includes("  workflow_dispatch:"));
  assert.match(source, /^    runs-on: skybot-ci-gpu$/m);
  assert.doesNotMatch(source, /pull_request:|matrix:/);
  for (const required of [
    "github.repository == 'LeviCade/OpenFront-National'",
    "github.event_name == 'workflow_dispatch'",
    "github.ref == 'refs/heads/main'",
    'test "$GITHUB_REF" = refs/heads/main',
    "fc6ad9c7b3c142aae0c454d532cd929c13aa8a0f",
    'git merge-base --is-ancestor "$BASE_SHA" "$NATIONAL_GPU_CANDIDATE_SHA"',
    'test "$(git rev-parse "$staging")" = "$NATIONAL_GPU_CANDIDATE_SHA"',
    "stage3/class5-trusted-national-vertical-20261121",
    "persist-credentials: false",
    "NATIONAL_GPU_ATTESTATION_FILE",
    "NATIONAL_GPU_PUBLIC_KEY_FILE",
    "NATIONAL_GPU_ATTESTATION_CHALLENGE",
    'NATIONAL_REQUIRE_HARDWARE_GPU: "1"',
    "run-four-modes.sh release",
    "path: national-qa-artifacts/gpu/public/release/",
  ])
    assert.ok(source.includes(required), "Missing strict: " + required);
});

void test("diagnostic is owner-only, feature-path-filtered and cannot certify release", () => {
  assert.ok(diagnostic.includes("  push:"));
  assert.doesNotMatch(diagnostic, /pull_request:|workflow_dispatch:|matrix:/);
  for (const required of [
    "github.actor == 'LeviCade'",
    "github.repository == 'LeviCade/OpenFront-National'",
    "refs/heads/stage3/r10-four-green-source-candidate-20261121",
    "refs/heads/stage3/r10-reviewed-gpu-20261121",
    "REFUSED: diagnostic must use Conductor-reviewed staging ref",
    "scripts/national-gpu-ci/OWNER_GPU_DIAGNOSTIC_TRIGGER",
    'test "$GITHUB_ACTOR" = LeviCade',
    "0e52b5eeb7490ce83898f2a9696732c7e7d6b21c",
    'NATIONAL_REQUIRE_HARDWARE_GPU: "0"',
    "run-four-modes.sh diagnostic",
    "path: national-qa-artifacts/gpu/public/diagnostic/",
  ])
    assert.ok(diagnostic.includes(required), "Missing diagnostic: " + required);
});

void test("one pinned installation, one real GPU runner and four serial browser modes", () => {
  for (const workflow of [source, diagnostic]) {
    for (const marker of [
      "runs-on: skybot-ci-gpu",
      "24.15.0",
      "npm@12.1.0",
      "npm run inst",
      "CHROME_BIN: /opt/skybot-gpu-runtime/chrome-headless-shell-linux64/chrome-headless-shell",
      "NATIONAL_CHROME_ANGLE_BACKEND: gl-egl",
      "persist-credentials: false",
    ])
      assert.ok(workflow.includes(marker), marker);
    assert.equal((workflow.match(/npm run inst/g) ?? []).length, 1);
    assert.doesNotMatch(
      workflow,
      /swiftshader|--enable-unsafe-swiftshader|--disable-gpu/i,
    );
  }
  assert.match(
    runner,
    /for mode in national-desktop national-mobile legacy-desktop legacy-mobile/,
  );
  assert.ok(runner.includes('wait-host-proof.mjs "$mode"'));
  assert.ok(runner.includes("NATIONAL_GPU_ATTESTATION_FILE"));
  assert.ok(runner.includes("NATIONAL_GPU_ATTESTATION_CHALLENGE"));
  assert.ok(runner.includes("node scripts/national-qa/browser-gameplay.mjs"));
  assert.match(runner, /sanitize-browser-evidence[.]mjs --kind/);
  assert.doesNotMatch(runner, /cat .*log|tail -n|grep .*log/);
});

void test("git ancestry denies stale ancestors and unrelated sibling sources", () => {
  const dir = mkdtempSync(join(tmpdir(), "r10-gpu-ancestry-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const commit = (name) =>
    git(
      "-c",
      "user.name=E6",
      "-c",
      "user.email=e6@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      name,
    );
  const ancestor = (a, b) => {
    try {
      git("merge-base", "--is-ancestor", a, b);
      return true;
    } catch {
      return false;
    }
  };
  try {
    git("init", "-q");
    commit("accepted base");
    const base = git("rev-parse", "HEAD");
    commit("reviewed change");
    const reviewed = git("rev-parse", "HEAD");
    commit("Conductor staging");
    const staging = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "unreviewed-sibling", base);
    commit("unreviewed sibling");
    const sibling = git("rev-parse", "HEAD");
    assert.equal(ancestor(base, reviewed), true);
    assert.equal(ancestor(reviewed, staging), true);
    assert.equal(ancestor(reviewed, base), false);
    assert.equal(ancestor(sibling, staging), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
