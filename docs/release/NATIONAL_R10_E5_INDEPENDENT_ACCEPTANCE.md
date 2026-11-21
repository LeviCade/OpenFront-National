# Round Ten — independent real-playability QA contract

**Authority:** Engineer #5 owns `scripts/national-qa/**`, `tests/qa/national/**` and release verification; E6 owns GPU workflow/dispatcher and publication of sanitized evidence; E4 UI, E2 combat, E1 political receipt, E3 recipient filtering. **Integration:** `stage3/integration-20261115`. **Starting immutable SHA:** `0e52b5eeb7490ce83898f2a9696732c7e7d6b21c`.

## Source of truth and historical failure

GPU diagnostic [#44881965453](https://github.com/LeviCade/OpenFront-National/actions/runs/44881965453), worker job `136778995772`, ended **FAILURE**, not a release certificate. On owner-operated physical Intel HD 4600 / VirGL, NATIONAL desktop and NATIONAL mobile **exited 1**. Legacy/FFA desktop and mobile **exited 0**, but the artifact collector sought `browser-legacy-desktop` and `browser-legacy-mobile`; the actual E5 paths are `browser-legacy-ffa-desktop` and `browser-legacy-ffa-mobile`. Consequently legacy detailed `acceptance.json` evidence was missed. The 740-byte prior uploaded diagnostic is bounded summary, not screenshots, actual full receipts or live-war acceptance. The exact NATIONAL failing stage must come from original in-guest reports; do not guess its reason based on elapsed time alone.

## Four independent scenarios

| Scenario           | Browser harness args | Actual browser report path                                         |
| ------------------ | -------------------- | ------------------------------------------------------------------ |
| NATIONAL desktop   | none                 | `national-qa-artifacts/browser-national-desktop/acceptance.json`   |
| NATIONAL mobile    | `--mobile`           | `national-qa-artifacts/browser-national-mobile/acceptance.json`    |
| Legacy FFA desktop | `--legacy`           | `national-qa-artifacts/browser-legacy-ffa-desktop/acceptance.json` |
| Legacy FFA mobile  | `--legacy --mobile`  | `national-qa-artifacts/browser-legacy-ffa-mobile/acceptance.json`  |

Success needs actual running HUD + canvas and real game action. NATIONAL additionally needs spawn, click-origin founding, accepted journal receipt and public roster, hostile duplicate rejection, accepted WAR declaration plus public active war state, real map assault with authoritative troop/motion change, peace proposal and acceptance with matching receipt and ended public layer, and when reachable genuine replay/victory. No synthetic worker/game writes or intent-only green. A missing step is **BLOCKED**, not `PASS`.

## Three different verdicts

1. **Source/independent QA:** exact PR HEAD, tests, typecheck, formatting, lint, build, dependency audit.
2. **Rendered gameplay:** four independent reports + screenshots, CDP console/GL shader results and properly matched authoritative recipient-specific packet receipts, stages and interaction.
3. **Release security:** separately signed physical host witness, pinned out-of-guest public-key trust root, exact SHA/run binding, protected server authority/fog, all restricted media rights, dev and production advisories, and actual full-game replay.

The `trusted-gpu-keys.json` allowlist remains intentionally empty pending independent host key enrollment. A renderer, shader pixel or self-signed guest proof alone never passes release attestation. Never copy protected upstream media. Issue #5 remains OPEN for 40 inherited media candidates (2 fonts + 38 audio) and missing gameplay/menu music; Issue #6 remains OPEN pending exact merged security acceptance and residual development-dependency review.

## Negative testing and evidence hygiene

For real GameRunner independently verify forged actor claims, nonexistent/foreign clients, expired recipients and fog, replay collisions, conflicting or foreign receipts, raw state export denial, and deterministic snapshot/replay. Reports written in the guest can contain private packet material and must **not** be uploaded to a public GitHub workflow unchanged. E6 must sanitize, bound and redact every exported summary, keeping genuine raw logs/PNG private to approved operators. Never publish request tokens, full snapshots, network query credentials or private fog.
