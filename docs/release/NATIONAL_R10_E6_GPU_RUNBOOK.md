# NATIONAL Round Ten — E6 Skybot four-mode evidence

**Source owner:** E6. **Conductor merges/promotes.** Round Ten founding SHA: `0e52b5eeb7490ce83898f2a9696732c7e7d6b21c`. This runbook is for [Issue #54](https://github.com/LeviCade/OpenFront-National/issues/54).

## Root cause from real GPU run #44881965453

Skybot rendered actual Intel HD4600 VirGL WebGL1/WebGL2 shaders in an authorized disposable KVM. NATIONAL desktop/mobile failed at `spawn` (exit 1 each). Legacy desktop/mobile exited 0, but the prior collector searched `browser-legacy-desktop` and `browser-legacy-mobile`; E5 actually writes `browser-legacy-ffa-desktop` and `browser-legacy-ffa-mobile`. Those exit-zero values were **not accepted gameplay evidence**.

## Implemented routes

**Diagnostic (unsigned):** `.github/workflows/national-r10-owner-gpu-diagnostic.yml` runs on one intentional `LeviCade` push to the exact assigned E6 feature branch, restricted to changes in that workflow file. Fixed owner, repository, event, branch and immutable SHA ancestry; Skybot separately checks current writer permission before JIT. It uses `skybot-ci-gpu`, pinned Headless Shell, `gl-egl`, Node 24.15.0/npm 12.1.0 and a single install. `NATIONAL_REQUIRE_HARDWARE_GPU=0` prevents any claim of E5 signed acceptance.

**Strict release:** `.github/workflows/national-hardware-acceptance.yml` remains default-`main` `workflow_dispatch` only, full 40-digit candidate SHA descended from accepted R9 and reachable from canonical integration or the optional Conductor-owned `stage3/r10-reviewed-gpu-20261121` ref. It requires `NATIONAL_REQUIRE_HARDWARE_GPU=1` plus externally verified signer-provided `NATIONAL_GPU_ATTESTATION_FILE`, `NATIONAL_GPU_PUBLIC_KEY_FILE` and `NATIONAL_GPU_ATTESTATION_CHALLENGE`. No unsigned diagnostic is interchangeable with this signed gate. Existing `main` still has the obsolete `[self-hosted,gpu]` matrix; **only the Conductor may promote the reviewed strict workflow entrypoint to main**.

Both routes call `run-four-modes.sh`: one runner, one dependency setup, four serial **real E5 Chromium** processes. Reports are precisely mapped to E5 folders, each process produces separate `scenario`, `exitCode`, result and sanitized stage classification even after earlier failures. A missing report, failed source match, wrong viewport, lack of actual WebGL1+2 shader pixels or missing authoritative stage cannot become a PASS merely from process exit 0.

`sanitize-browser-evidence.mjs --kind diagnostic|release` writes `gpu/public/<kind>/{national-desktop,national-mobile,legacy-desktop,legacy-mobile,summary}.json`. Only allowlisted renderer/pixel, stage names, packet **counts**, process outcomes and bounded vetted PNGs are published. Raw logs, worker packets, fog, URLs, console data and signer material stay inside disposable guest. All summaries set `releaseCertified=false` and `hostCleanupVerified=false` until independently proven.

## Validation / follow-up

Cheap workflow test: `node --test scripts/national-gpu-ci/verify-workflow.mjs`; sanitizer tests: `npx --no-install vitest run --project node scripts/national-gpu-ci/sanitize-browser-evidence.test.mjs` (as applicable to the repo Vitest configuration). Source lint/format/build and gameplay evidence are separate verdicts; local tests do not certify gameplay.

**Independent post-job host audit required:** physical Skybot operator checks VM destroyed, renderD128 ACL restored, GPU and global lease released, RAM overlay and EFI residue absent, JIT runner deregistered and CPU runners unaffected. E6 cannot assert these from within the guest. Record run ID and operator-signed postflight witness in Issue #54.

Current release remains blocked until a verified out-of-guest Ed25519 signer and enrolled E5 trust root, four real gameplay passes, protected authority/fog security, asset provenance #5 and security issue #6 are resolved.
