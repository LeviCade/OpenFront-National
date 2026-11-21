# R11 E5 — Independent four-mode real Chromium gameplay acceptance

**Branch** `feature/r11-e5-real-browser-qa-20261121`; founding commit `a712eabb92e8c6f20d7154e9f77471a0c83a29be`. Integrates into `stage3/integration-20261115` only after Conductor review.

## Independent baseline audit — not a release certificate

Owner-operated [four-mode Skybot run #44920010367](https://github.com/LeviCade/OpenFront-National/actions/runs/44920010367), artifact `14713027849`, diagnostic SHA `80aa1582792640269865fb635adfe0f964d38315`:

| Mode               | Report          | First failure  | Evidence                                                                                                                        |
| ------------------ | --------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| NATIONAL desktop   | FAIL            | `found-empire` | Spawn passed; actual founded click pending; clock 00:00; no accepted/rejected result in sanitized evidence (7 observed packets) |
| NATIONAL mobile    | FAIL            | `spawn`        | Expanded diplomacy panel covers map; tutorial still prompts spawn (68 observed packets)                                         |
| Legacy FFA desktop | PASS diagnostic | None           | 3 screenshots; _not_ a public release pass                                                                                      |
| Legacy FFA mobile  | PASS diagnostic | None           | 3 screenshots; _not_ a public release pass                                                                                      |

Intel VirGL WebGL1/2 shader probes worked but `hardware.proofAccepted=false` and `releaseCertified=false`. This evidence does not establish independent signed host attestation.

## R11 E5 repairs and strict requirements

1. **Mobile map input:** Observe actual `national-diplomacy-panel button[aria-controls="national-diplomacy-content"]` state; close via real CDP mouse/touch; require `aria-expanded=false`; choose only a hit-tested visible canvas point not covered by a HUD overlay; genuine Chrome input; require `GameView.myPlayer().hasSpawned()` and `numTilesOwned()>0`; only then reopen the panel through its real header and require the enabled Found Empire control. No DOM `.click()`, direct spawn command, forged Game state, or privileged debugger mutation.
2. **Desktop founding:** Observe engine tick before and after action, `isPaused`, request nonce and actor, current `GameView.nationalFoundingResults`, recipient-scoped worker journal, current public `nationalPolitics.empires`, and actual UI confirmation. Bounded checks separately report `GAME_PAUSED_NO_FOUNDING_TICK` / `GAME_TICK_NOT_ADVANCING` (E2), `FOUNDING_RECEIPT_ABSENT` or `FOUNDING_PUBLIC_ROSTER_MISSING` (E3/E1), `FOUNDING_UI_CONFIRMATION_MISSING` (E4), or authentic engine rejection (E2). Any fraudulent, replayed, foreign or internally inconsistent receipt fails.
3. **True human WAR:** The harness no longer chooses arbitrary canvas points. It requires an E4 **visible read-only target-map anchor** `[data-national-map-target-id="<exact opponent PlayerID>"]`, positioned over an unobstructed actual enemy tile, and a genuine `.radial-menu-container[data-target-player-id="<same PlayerID>"]` with enabled `.center-button-hitbox` Attack action. Browser uses real CDP secondary mouse or mobile touch to open and trigger the actual radial. The resulting `SendAttackIntentEvent.targetID` and actor's GameView outgoing attack target must equal the declared WAR target, plus independent worker attack packet and enemy troop/territory loss. If E4 has not yet exposed these **read-only accessibility/automation affordances**, the harness fails `TARGET_AWARE_MAP_ANCHOR_MISSING_OWNER_E4` or `RADIAL_TARGET_NOT_AUTHENTICATED` rather than inventing input. E4 owns map/radial UI. This contract never provides a backdoor to fire attacks.
4. **Peace requires two principals:** An originator of a `national_propose_peace` motion cannot also accept it. The actual opposing authenticated session must render the same current motion and WAR; verify `proposerId !== acceptorId` _before_ click, then match recipient-scoped accepted receipt and ended canonical layer. Until E2/E4 support the opposing actor session, the browser explicitly fails `PEACE_OPPOSING_AUTHORIZED_SESSION_REQUIRED_OWNER_E2_E4` and cannot pass.
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

## First Conductor's Second Class — combined-game browser acceptance

**Reviewed exact combined source:** PR #75 at `fc04a88d82a827708a9ee0e48984ceb5e2288dfc` (five engineers, base `a712eabb92e8c6f20d7154e9f77471a0c83a29be`). PR #75 source is **RED** at compiler boundaries before any new real Skybot proof. E2 must close `NationalFoundEmpireExecution.ts:78`'s missing `set-national-peace-delegation` union; E3 must close `NationalPoliticalPacket.ts:240`'s missing E1 receipt type and `NationalAccessionPacketsR11.test.ts:346`'s widened `version:1` type. Conductor merges corrected heads. No E5 score or hardware pass.

### Real UI change: do not reopen the mobile panel before spawn

E4 now renders the pre-spawn diplomacy header **collapsed** with an explicit map-spawn prompt. E5 previously opened it at the start of its spawn stage. The updated flow **observes** the real `aria-expanded` value, closes only when necessary using a genuine CDP touch or mouse event, checks canvas hit-testing against `document.elementFromPoint`, clicks only an uncovered map region, requires the real `GameView.myPlayer().hasSpawned() && numTilesOwned()>0`, then reopens the real header for founding. The founding receipt still requires the correct cryptographic `nf_` request token, sequence, actor, recipient, and **actual `nationalPoliticsTick()`** fresh enough to cover the accepted result; `g.ticks()` is not political-projection freshness. The original duplicate rejection used a stale `R5_Browser_QA` empire ID; this is corrected to the actual R11 ID.

### Multi-actor accession and crown — no game-state mutation

NATIONAL acceptance stages are now:
`found-empire` → `rejected-founding` (separate adversarial negative) → `offer-accession` → `recipient-invitation` → `recipient-acceptance` → `transfer-crown` → actual WAR/assault/impact/opposing peace.

1. The first player's visible `#national-accession-candidate` selector and `#national-offer-accession` button must emit a real `SendNationalOfferEmpireIntentEvent` with an `np_[a-f0-9]{32}` nonce. The accepted recipient-scoped `GameView.nationalPoliticalResults()` must match type/actor/nonce/empire ID/sequence/tick, and a new public `nationalPoliticsTick` must certify the actual emperor roster. An accepted offer **does not** prove invitation delivery.
2. **Existing independent second player session**: E6 must provision a separately admitted, already-running Chromium browser in the *same live game* and supply `NATIONAL_QA_PEER_CDP_PORT` on loopback. E5 only attaches to that existing Chrome page; it does not spawn a second fake principal, open a new lobby, or set `game.myPlayer`. The second live `GameView` must have another actor ID equal to the selected recipient, same `gameID()`, valid non-spectator spawn, current tick, and its own `nationalAccessionOffers()` whose `recipientId`, `candidateId`, `proposerId`, and `empireId` exactly match. The founder must not receive the recipient's invitation.
3. The second Chromium player uses **real CDP pointer and native keyboard** to select `#national-invitation-empire` and click `#national-accept-accession`. E5 merely observes its EventBus request. The recipient's own accepted result and fresh membership roster must reconcile with the founder's independent fresh public roster. A forged foreign receipt, inactive actor, expired/missing offer or contradictory snapshot fails.
4. The founder's real `#national-crown-successor` and `#national-transfer-crown` must produce a fresh accepted `np_` receipt and both independent current rosters must now name the recipient emperor. Former emperor's privileged `#national-offer-accession` and `#national-transfer-crown` must disappear.
5. WAR acceptance still requires the **E4 read-only map-target anchor and exact recipient-labelled native radial** (not currently present in the combined 24-file PR). Actual attack send, E2 engine outgoing motion, E3 public combat and opponent troops/tile loss must all agree. Peace acceptance uses a separate active Chromium principal identified as the *actual declared WAR target*. If accession recipient is not that target, E6 must supply `NATIONAL_QA_PEACE_CDP_PORT` for that real opposing browser; self-accepting the originator's offer is prohibited. Both principals must see the correct ended WAR layer and the accepting opponent's own principal-scoped receipt.

**Expected failure when E6 does not have multiple lawful admitted browser actors:** `POLITICAL_SECOND_AUTHORIZED_BROWSER_SESSION_MISSING_OWNER_E2_E4_E6` at `recipient-invitation`. That is a **legitimate failing outcome**, not a source-test PASS nor permission to bypass. If the current Solo model cannot admit two independent authorized human principals, E2/E4/Conductor must supply an authentic multi-actor route before declaring UI acceptance. E5 cannot manufacture one.

### Four separately attributable reports; no private packet leak

E5 preserves the four paths and fails closed for missing screenshot/stage/receipt, wrong actor or public roster, fake radial combat, same-player peace, signed-GPU absence and E6 host cleanup. The NATIONAL diagnostic additionally requires three publicly shareable founder-view screenshots `political-offer-accepted`, `political-member-joined-founders-view`, `political-crown-former-emperor-revoked` and **six independent political/opposing-principal proof events**. Recipient-only invitation UI and its raw private `nationalAccessionOffers` are **never saved as screenshots or serialized into the shareable acceptance report**. Only presence flags, bounded event types, frame labels, tick/sequence counters, boolean proof and SHA256 request fingerprints may leave the browser. The worker evidence projection drops all raw `nationalCommandResults`, `nationalAccessionOffers`, raw DOM text, request nonces, player names and hidden fog/troop state. E6 must preserve the exact-source signing/attestation gate; shader pixels on SwiftShader or unsigned VirGL are not accepted.

### Explicit second-class owner contracts

- **E2 / issue #64:** Repair combined compiler union; prove authentic founder execution, second admitted GameClient player, real invitation/consent execution and opposed WAR/peace source behavior. Report independently if a Solo match inherently lacks an independent human recipient.
- **E3 / issue #65:** Repair combined DTO unions and `version:1` typing; deliver private invitation to *only its recipient* and matching private accepted/rejected results; keep current `nationalPoliticsTick()` and `nationalConflictsTick()`; no private stdout.
- **E4 / issue #66:** Preserve collapsed pre-spawn panel and actual controls; provide a **real game-owned enemy tile** read-only marker `[data-national-map-target-id="<PlayerID>"]` geometrically linked to the current map/camera plus a **real radial** `.radial-menu-container[data-target-player-id="<same PlayerID>"]`; provide real second user session path. No QA-only command bypass.
- **E6 / issue #68:** Arrange legal independent browser players and exact-SHA two-session CDP connection, correct separate four-mode reports and signed physical-host evidence, no private invitation screenshots. No hardware dispatch without Conductor authorization.
- **Conductor / issue #48:** Re-assemble E1/E2/E3/E4/E5 and corrected E6 source, rerun source gates efficiently, then authorize at most one new physical GPU diagnostic when actually ready.

**Official completion remains 38%. No new physical hardware run has occurred in E5.**
