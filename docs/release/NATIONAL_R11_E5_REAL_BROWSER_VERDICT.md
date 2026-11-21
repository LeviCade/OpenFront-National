# R11 E5 — Independent four-mode real Chromium gameplay acceptance

**Branch** `feature/r11-e5-real-browser-qa-20261121`; founding commit `a712eabb92e8c6f20d7154e9f77471a0c83a29be`. Integrates into `stage3/integration-20261115` only after Conductor review.

## Independent baseline audit — not a release certificate

Owner-operated [four-mode Skybot run #44920010367](https://github.com/LeviCade/OpenFront-National/actions/runs/44920010367), artifact `14713027849`, diagnostic SHA `80aa1582792640269865fb635adfe0f964d38315`:

| Mode | Report | First failure | Evidence |
| --- | --- | --- | --- |
| NATIONAL desktop | FAIL | `found-empire` | Spawn passed; actual founded click pending; clock 00:00; no accepted/rejected result in sanitized evidence (7 observed packets) |
| NATIONAL mobile | FAIL | `spawn` | Expanded diplomacy panel covers map; tutorial still prompts spawn (68 observed packets) |
| Legacy FFA desktop | PASS diagnostic | None | 3 screenshots; *not* a public release pass |
| Legacy FFA mobile | PASS diagnostic | None | 3 screenshots; *not* a public release pass |

Intel VirGL WebGL1/2 shader probes worked but `hardware.proofAccepted=false` and `releaseCertified=false`. This evidence does not establish independent signed host attestation.

## R11 E5 repairs and strict requirements

1. **Mobile map input:** Observe actual `national-diplomacy-panel button[aria-controls="national-diplomacy-content"]` state; close via real CDP mouse/touch; require `aria-expanded=false`; choose only a hit-tested visible canvas point not covered by a HUD overlay; genuine Chrome input; require `GameView.myPlayer().hasSpawned()` and `numTilesOwned()>0`; only then reopen the panel through its real header and require the enabled Found Empire control. No DOM `.click()`, direct spawn command, forged Game state, or privileged debugger mutation.
2. **Desktop founding:** Observe engine tick before and after action, `isPaused`, request nonce and actor, current `GameView.nationalFoundingResults`, recipient-scoped worker journal, current public `nationalPolitics.empires`, and actual UI confirmation. Bounded checks separately report `GAME_PAUSED_NO_FOUNDING_TICK` / `GAME_TICK_NOT_ADVANCING` (E2), `FOUNDING_RECEIPT_ABSENT` or `FOUNDING_PUBLIC_ROSTER_MISSING` (E3/E1), `FOUNDING_UI_CONFIRMATION_MISSING` (E4), or authentic engine rejection (E2). Any fraudulent, replayed, foreign or internally inconsistent receipt fails.
3. **True human WAR:** The harness no longer chooses arbitrary canvas points. It requires an E4 **visible read-only target-map anchor** `[data-national-map-target-id="<exact opponent PlayerID>"]`, positioned over an unobstructed actual enemy tile, and a genuine `.radial-menu-container[data-target-player-id="<same PlayerID>"]` with enabled `.center-button-hitbox` Attack action. Browser uses real CDP secondary mouse or mobile touch to open and trigger the actual radial. The resulting `SendAttackIntentEvent.targetID` and actor's GameView outgoing attack target must equal the declared WAR target, plus independent worker attack packet and enemy troop/territory loss. If E4 has not yet exposed these **read-only accessibility/automation affordances**, the harness fails `TARGET_AWARE_MAP_ANCHOR_MISSING_OWNER_E4` or `RADIAL_TARGET_NOT_AUTHENTICATED` rather than inventing input. E4 owns map/radial UI. This contract never provides a backdoor to fire attacks.
4. **Peace requires two principals:** An originator of a `national_propose_peace` motion cannot also accept it. The actual opposing authenticated session must render the same current motion and WAR; verify `proposerId !== acceptorId` *before* click, then match recipient-scoped accepted receipt and ended canonical layer. Until E2/E4 support the opposing actor session, the browser explicitly fails `PEACE_OPPOSING_AUTHORIZED_SESSION_REQUIRED_OWNER_E2_E4` and cannot pass.
5. **Evidence integrity:** The four independent report paths remain `national-qa-artifacts/browser-national-desktop/acceptance.json`, `browser-national-mobile/acceptance.json`, `browser-legacy-ffa-desktop/acceptance.json`, `browser-legacy-ffa-mobile/acceptance.json`. Required screenshot stage labels must be present in `events`; missing reports, stages, screenshots, physical attestation or integrity proof fail closed. Raw worker receipts, opponent private troop counts, snapshots and fog are not published as sanitized external artifact data. Host/controller trust root, signed SHA/nonce/run binding and WebGL proof are separate from source/gameplay diagnostics.

## Cross-engineer handoffs

- **E2 (#64):** Diagnose the 00:00 tick and actual accepted/rejected founding command execution. Supply recipient-authenticated opposing-principal peace hook; do not make own-side peace valid.
- **E3 (#65):** Ensure current recipient-scoped `nationalFoundingResults`, command results, and public roster consistently reach GameView and worker; never leak another recipient's outcomes. Distinguish journal lag from actual engine rejection.
- **E4 (#66):** Accessible real panel header toggle with `aria-expanded`, unobstructed map tile, two read-only target markers documented above, and enabled real radial center Attack. Do not add QA-only command emission or a synthetic success. Make opposing-authorized user/session actually operable.
- **E6 (#68):** Preserve four reports, capture image count + first stage, exact run SHA, sanitized founding classification, and signed host attestations. Owner/Conductor must approve any new GPU run; E5 does **not** trigger one.
- **Conductor (#48):** Integrate source and check targeted tests before authorizing a GPU diagnostic. No change to official 38% or M9 release scoring without accepted evidence.

## Deterministic tests

`tests/qa/national/RoundElevenBrowserActions.test.mjs` covers panel state, true canvas occlusion detection, actor/request/receipt and tick diagnostics, malformed/foreign receipts, radial target matching, and distinct principal peace. Existing hostile-packet, snapshots, replay and all four report gates remain. `BrowserVerdict.test.mjs` additionally rejects absent screenshots on exit 0.

**Source tests are not a substitute for a successful actual Chromium playthrough.** This document never claims they are.
