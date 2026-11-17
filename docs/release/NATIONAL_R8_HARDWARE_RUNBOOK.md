# NATIONAL Round Eight — executable real-hardware browser release gate

**Source base:** `5e956e13f9e3b054c15cfd75110284c5a48fdd5c` (accepted dev integration). **Owner:** E5. **Public release:** BLOCKED until four real browser traces and authority, assets, dependencies are resolved.

## Why hosted Chrome cannot certify this build

GitHub-hosted Chrome 157 reported WebGL2 via `ANGLE Vulkan SwiftShader Device (Subzero)` and the game's actual WebGL gate correctly refused to start. WebGL2 *presence*, a homepage screenshot, or `--enable-unsafe-swiftshader` is not hardware evidence. Never pass `--use-angle=swiftshader` or bypass the application's WebGL gate. E5 additionally fails hardware QA if Chromium's unmasked renderer is absent/generic or identifies SwiftShader, llvmpipe, lavapipe, softpipe or software rasterization. This attestation is diagnostic, not a cryptographic attestation of the host.

## Provision a real runner (macOS or Linux)

1. Provide an actual physically/virtually passed-through GPU, correct OS graphics drivers, headless-compatible EGL/Metal/X11 display, Google Chrome or Chromium, Git, Node 24.15.0, npm 12.1.0, and renderer introspection utilities (`glxinfo` on Linux, `system_profiler SPDisplaysDataType` on macOS; `nvidia-smi` for NVIDIA).
2. In GitHub repository **Settings → Actions → Runners → New self-hosted runner**, select the matching OS/architecture and execute GitHub's generated **download, configure and start** commands **on the hardware host**, using GitHub's current ephemeral registration token. Never commit the token. Add the custom label `gpu` (the installed default-branch workflow selects `[self-hosted, gpu]`). Linux service users must have access to the actual display/GPU; macOS users need an active graphics session.
3. Verify that the runner appears **Online** with `self-hosted` and `gpu` labels. GitHub's runner registry was not exposed through the available audit integration, so E5 does not claim an online runner without separate evidence.
4. From **Actions → NATIONAL — Real GPU browser gameplay acceptance → Run workflow**, enter the **40-character merged or staging candidate SHA**. The default-branch workflow rejects commit hashes outside approved integration/staging ancestry. A new *unmerged* E5 feature-branch commit cannot be used until Conductor integrates it into approved ancestry; locally test the branch directly before merge.
5. For local branch testing on the hardware host:
   ```sh
   git checkout feature/r8-e5-browser-release-security
   npm run inst
   npm run typecheck && npm test && npm run lint && npm run format:check && npm run build-prod
   export NATIONAL_REQUIRE_HARDWARE_GPU=1
   export CHROME_BIN="$(command -v google-chrome || command -v chromium)"
   node scripts/national-qa/browser-gameplay.mjs
   node scripts/national-qa/browser-gameplay.mjs --mobile
   node scripts/national-qa/browser-gameplay.mjs --legacy
   node scripts/national-qa/browser-gameplay.mjs --mobile --legacy
   ```
   On macOS, set `CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`. If needed for an actual GPU only, set `NATIONAL_CHROME_ANGLE_BACKEND=gl` or `vulkan`; never `swiftshader`.
6. Archive each run's `national-qa-artifacts/browser-*/acceptance.json`, `*.png`, actual unmasked WebGL renderer, CDP console/network diagnostics and worker-scoped receipts. The browser tester requires **HUD/spawn → exact accepted and rejected Found Empire tokens → trusted save/restore → sovereign victory** for NATIONAL; legacy FFA must independently reach running gameplay. Do not assert absent WAR/peace, keyboard or touch coverage from these traces: add real input/action evidence before those release criteria are scored.

## Hard security boundaries

Browser-owned worker is **not secure against a modified local client**, regardless of packet filtering or fake hosted saves. Never unseal/export the raw hidden full-game snapshot. E1's trusted-host authenticated save/reload must prove principal authorization, state confidentiality, restore identity, stale/foreign recipient rejection, and no replayed founder toast. Until this is exercised on an actual protected host, browser save/restore remains a release blocker.

## Exact verdict as authored

No usable GPU renderer or hardware-backed four-mode run was available in the E5 audit environment; no browser PASS, screenshot of spawned HUD or live victory is claimed. Dependency and restricted-asset gates are independent of this infrastructure blocker.
