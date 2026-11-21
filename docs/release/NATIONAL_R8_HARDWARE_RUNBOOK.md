# NATIONAL Round Nine — hardware browser release runbook

**Owner:** Engineer #5 (browser and attestation), Engineer #6 (workflow/runner), Conductor (review + integration). **Release verdict:** BLOCKED.

Full normative witness details: [NATIONAL_R9_GPU_WITNESS_CONTRACT.md](NATIONAL_R9_GPU_WITNESS_CONTRACT.md). This supersedes the R8 unsigned-renderer instructions; previous source CI green is not full-gameplay evidence.

## Existing source evidence, not release evidence

The historical E5 PR #39 HEAD `b1ae75edcaefcc10c26c8d3e6c25d88e4892e58c` passed source baseline #44088877963, independent QA #44088877916, and combined source #44088877726 (GPU job **skipped**). That does not certify current R9 HEAD or any physical browser playthrough. Original hosted Chromium exposed a SwiftShader WebGL2 renderer; it did not reach a legitimate GPU-backed game and cannot be accepted.

## Physically authorized Skybot path

The observed Skybot device is Intel HD Graphics 4600 / 8086:0412 on i915 renderD128 via hardware-backed VirGL/KVM. Its GL-EGL launch change from draft PR #43 was incorporated into E5's browser harness without relaxing WebGL gates. E6 owns the workflow using verified `skybot-ci-gpu` runner and pinned `/opt/skybot-gpu-runtime/chrome-headless-shell-linux64/chrome-headless-shell`, on a trusted approved exact candidate. Do not add a duplicate workflow or commit GPU machine/controller changes in E5.

Before any browser can pass, Conductor must enroll the independently verified Skybot Ed25519 **public key fingerprint** in `scripts/national-qa/trusted-gpu-keys.json`, after confirming the private signing key stays *only* outside the disposable guest/job/browser. The checked-in allowlist initially contains no keys: a missing signer or untrusted key **fails closed**. E6 must provide a fresh signed witness + source/run/attempt/runner/challenge context per the normative contract.

## Execute genuine four-mode gameplay

With dependencies installed on a provisioned authorized GPU VM and a separately signed witness created for the exact run, use `NATIONAL_REQUIRE_HARDWARE_GPU=1`, `NATIONAL_CHROME_ANGLE_BACKEND=gl-egl`, `CHROME_BIN`, `NATIONAL_GPU_ATTESTATION_FILE`, `NATIONAL_GPU_PUBLIC_KEY_FILE`, `NATIONAL_GPU_ATTESTATION_CHALLENGE`, `NATIONAL_GPU_CANDIDATE_SHA` and the GitHub runner context. Then, on **one approved worker**:

```sh
node scripts/national-qa/browser-gameplay.mjs
node scripts/national-qa/browser-gameplay.mjs --mobile
node scripts/national-qa/browser-gameplay.mjs --legacy
node scripts/national-qa/browser-gameplay.mjs --legacy --mobile
```

The test writes separate `national-qa-artifacts/browser-national-desktop`, `browser-national-mobile`, `browser-legacy-ffa-desktop` and `browser-legacy-ffa-mobile` directories. Archive `acceptance.json`, every actual screenshot, CDP renderer/shader proof, console/network errors and sanitized worker receipts; keep the exact candidate SHA. Only mark individual scenarios passing when the real game passes. Browser homepage, menu screenshots, self-signed guest JSON, unverified `virgl` strings, SwiftShader, llvmpipe, lavapipe and synthetic packets are insufficient.

## Independent blockers

- **Gameplay:** authoritative WAR/peace recipient-scoped acceptance/rejection, real state changes, FFA tactics, game keyboard input, secure multiplayer/replay/victory flows are not yet proven by these scripts. No fabricated evidence.
- **Host confidentiality:** E1's in-memory save primitive is not deployed protected authority. Foreign-session, replay, forged-outcome, private fog and raw snapshot negative tests remain mandatory.
- **Assets (#5):** 40 inherited media files pending independent provenance review; four music tracks missing and strict release audit fails. Never copy protected upstream assets.
- **Dependencies (#6):** earlier source audit showed zero production advisories, but only an exact Conductor-integrated build can close the security issue.

**Public release remains BLOCKED until both actual hardware playthrough and protected-host, assets and security obligations are satisfied.**
