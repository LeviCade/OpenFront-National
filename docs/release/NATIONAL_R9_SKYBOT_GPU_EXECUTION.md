# NATIONAL R9 — E6 Skybot GPU execution runbook

**Scope:** only the GPU Actions workflow and its cheap contract validator. E5 owns the browser/attestation scripts; the Conductor owns merges and default-branch promotion. Source draft: [OpenFront-National PR #46](https://github.com/LeviCade/OpenFront-National/pull/46).

## Current operational status

Skybot-CI [PR #243](https://github.com/LeviCade/Skybot-CI/pull/243) and its independent physical WebGL evidence establish that Intel HD Graphics 4600 with VirGL **can** render accelerated WebGL1 and WebGL2. This does **not** establish game play-through, nor does it provide the fresh out-of-guest signature now required by E5. OpenFront release remains blocked.

## Dispatch contract

The reviewed `.github/workflows/national-hardware-acceptance.yml` must be installed as a **default-`main` workflow** by Conductor review before GitHub's manual dispatch can reach it. Select `Run workflow` on `main` and provide an exact 40-character SHA. Source gate checks (1) candidate descends from canonical integration base `42e2b5d0a6372737b78178e5be49da7b76383d0a` and (2) candidate is reachable from current approved staging/integration HEAD. Unreviewed feature tips and arbitrary commits fail. A SHA alone is not a review.

GitHub verifies the dispatching identity; Skybot's job-aware controller separately requires current owner/write/maintain/admin permission before admitting the `skybot-ci-gpu` job. Do not grant fork authors runner access or change Skybot/host configuration from this PR. No workflow checkout token is persisted.

## One-guest execution

1. GPU admitted to **one** disposable, nonroot `skybot-ci-gpu` KVM guest.
2. Validate default-branch dispatch and exact reviewed source. Capture source SHA in `national-qa-artifacts/gpu/sha.txt`.
3. Validate pinned Chrome Headless Shell at `/opt/skybot-gpu-runtime/chrome-headless-shell-linux64/chrome-headless-shell`; capture guest `/dev/dri`, DRM driver, PCI vendor and optional `glxinfo -B`.
4. E5's current contract additionally requires `NATIONAL_GPU_ATTESTATION_FILE` (host/controller signed JSON), `NATIONAL_GPU_PUBLIC_KEY_FILE` (trusted, independently provisioned public key) and `NATIONAL_GPU_ATTESTATION_CHALLENGE` (64 hex chars) **before dependency installation**. The host must sign fresh source/run ID/attempt/runner/challenge/host+guest witness data. Private signing material may NEVER be inside the guest or from the browser.
5. Node `24.15.0`, npm `12.1.0`, single `npm run inst`, followed by four real E5 scenarios: NATIONAL desktop/mobile and legacy FFA desktop/mobile. Each mode writes its own log, independent exit status in `scenarios.jsonl`, E5 screenshots and redacted CDP/worker report. No mode may inherit a pass from another. Whole job fails on any failure.
6. Upload bounded public-repository artifacts even after failure. Review provenance and privacy of any packet fields before using public artifacts as release evidence.

**Current signer blocker:** Skybot's physically verified CI jobs do not, by themselves, produce this E5 per-invocation signed proof. Neither this workflow nor an arbitrary shell in a VM can claim to be the trusted host signer. The authorized Skybot operator/Conductor must implement or authorize that trust interface separately. This lane fails before the expensive npm/gameplay stage when proof is missing. No fabricated pass.

## Evidence requirements and verification

Run the cheap workflow contract locally with `node --test scripts/national-gpu-ci/verify-workflow.mjs`. Source unit success is not GPU success. An actual successful GitHub run must show same-SHA source, positive WebGL1/WebGL2 shader samples, hardware-backed VirGL chain, screenshots past menu (HUD, spawn and interactions), authoritative packets/acceptance/rejection, and scenario-specific outcome/failed stages. E5's trust-store, fog, replay, and missing licensed asset blockers remain independent release gates.

After the job, host/operator evidence must confirm disposable VM teardown, overlay empty, render ACL and lease removed, runner JIT registration gone, and normal CPU runners unaffected. This repo-only PR **does not** prove physical cleanup without an authorized host audit. Track driver/guest/host vs browser/gameplay failures separately; never rerun an unchanged GPU failure just to collect another red check.

## Known limitation

Manual dispatch is not available until reviewed default-branch promotion. E6 tools can read GitHub run evidence, but cannot directly operate the physical Skybot host or supply the missing independent signer. The job will remain red or unrun until those prerequisites are satisfied. This is intended fail-closed behavior.

## Public artifact confidentiality

The original browser keeps its rich CDP, worker, console, URL and failure logs inside the disposable guest. E6's `sanitize-browser-evidence.mjs` publishes _only_ allowlisted scenario status, exact candidate SHA, stage names, receipt counts, accepted hardware/renderer/pixel observations, and expected PNG screenshots. It rejects symlinks, non-PNG data and unrecognized stages. **No raw `acceptance.json`, process logs, hardware inventory, console or worker packet objects are uploaded.** The scope-specific child `GITHUB_SHA` is explicitly the reviewed checkout SHA, not the default-branch workflow SHA. Full E5 local assertions still execute against the original evidence.
