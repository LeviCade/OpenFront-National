# NATIONAL R11 — E4 Class Three: real human player journey contract

**Status:** source-level contract, **NOT** hardware acceptance. Owner E4; E5 owns Chromium/CDP; E2 owns trusted server/protocol and execution; E3 owns recipient-only private packets; E6/Conductor authorize physical GPU. Source reviewed against combined candidate `f28d601e2fcb6211ff69cab6b9745c36c910edc6`, E4 `ed734c1ace65ece91e2f9a0f48e84d023187893a`. Conductor must verify new heads before staging. Official project completion **38%**.

## 0. Accept/reject rules

1. **An EventBus UI event is not a server-stamped intent.** Record the emitted request ID, Transport gate result, LocalServer/GameServer stamped actor and turn number, WorkerClient/GameRunner actual tick, E1 authenticated result, E3 recipient-filtered view, and current public roster. Do not infer later stages from a button click.
2. **Recipient privacy and session isolation are absolute.** Only the current authenticated human sees `nationalAccessionOffers`; absent is UNKNOWN, empty means no active invitation. Sender's receipt never proves B saw an offer. No fake B, spoofed clientID, mirrored local game, or QA-only command emission.
3. **A game is not physically playable just because source CI is green.** Hardware must show browser screenshots and real CDP actions, WebGL device identification, actual game state deltas, real opponent identity, and retained failure stages. Never relax WebGL/signed-host checks.
4. **Shared-match political proof is NOT currently enabled in Solo.** A proper server-hosted Private NATIONAL match is a proposed integration path, not an existing deliverable. Until the server validates/persists that configuration and the client enables the mode, report the two-principal test as BLOCKED.

## 1. Spawn at 390 × 844 — actual touch

Game: `GameType.Singleplayer`, `nationalMode === true`, not replay. Test on real GPU with viewport 390 × 844. Before human spawn, `national-diplomacy-panel button[aria-controls="national-diplomacy-content"]` must exist with `aria-expanded="false"`; E4's `refresh()` refuses expanded mobile pre-spawn. **Do not call `setPanelExpanded(true)` before spawn**. E5 corrected this sequencing in its newest R11 script.

Use the actual visible input map canvas and `document.elementFromPoint(x,y)`; require the hit resolves to that input surface, not the diplomacy panel/HUD. Send genuine CDP `Input.dispatchTouchEvent` touchStart/touchEnd at an unobstructed land tile. Listen passively for `MouseUpEvent` and `SendSpawnIntentEvent`, then require a later authenticated `GameView.myPlayer().hasSpawned() === true`, `numTilesOwned() > 0`, `!inSpawnPhase()`, and a progressing game update. A touch without the Game's player tile ownership is a **fail**. Only then use the actual header to expand the diplomacy panel; verify `aria-expanded=true` and available Found Empire action. Repeat at 1280 × 800 with authentic desktop mouse; test orientation changes separately without inserting artificial touch input.

## 2. Found Empire — exact click → worker → roster

Input: `#national-empire-id` and its containing `button[type=submit]` ("Found Empire") within `national-diplomacy-panel`. E4 uses `SendNationalFoundEmpireIntentEvent` with opaque `nf_[0-9a-f]{32}`. The panel exposes `[data-national-founding-request-id]` and `[data-national-founding-actor-id]` on `[data-national-founding-tick]`. These are **read-only correlation metadata**, not a success proof.

At click time capture: `game.gameID()`, `game.myPlayer().id()`, issued `game.ticks()`, `game.isPaused()` when supported, and `game.nationalPoliticsTick()`. At each subsequent actual worker tick capture transport gate allow/drop, `LocalServer.paused` or server-received stamped actor, turn sequence, `GameView.nationalFoundingResults()` exact actor/recipient/request/empire/sequence/tick, and `GameView.nationalPolitics()`. **00:00 HUD clock does not establish a stopped Game tick**. R10 showed 7 worker packets, zero accepted/rejected founder results; its logs could not locate the precise drop. Never assert a fixed cause from the screenshot.

Success requires **both** an accepted E1 `national_found_empire` receipt with exact opaque ID and matching current authoritative public empire roster at/after receipt tick (leader the human actor, actor in member IDs). A genuine rejected receipt is a *rejection* with reason; if no trusted response arrives, UI stays unconfirmed/unknown. `GameView.isPaused()===true` requires investigating legitimate pause semantics; never bypass them.

## 3. Accession, recipient-private invitation and crown succession

Use actual selectors in `NationalDiplomacyPanel.ts`:

| Operation | Human action | Real authority/evidence |
| --- | --- | --- |
| A offers B accession | select B in `#national-accession-candidate`, click `#national-offer-accession` | A is current E1 emperor; UI emits `SendNationalOfferEmpireIntentEvent`, opaque `np_[0-9a-f]{32}`, E2 stamps A, E1 accept/reject receipt scoped to A. No claim B received it. |
| B sees invitation | `#national-invitation-empire` contains A's empire | B's separately authenticated `GameView.nationalAccessionOffers()` has `{version:1,recipientId:B,offers:[{empireId,candidateId:B,proposerId:A,recipientId:B}]}`; sender A MUST NOT see B's invitation. |
| B accepts | select that exact current private offer, click `#national-accept-accession` | E2 stamps B (the UI's target candidate must be B), E1 emits accepted/rejected `national_accept_empire` for B, fresh canonical empire `memberIds` includes B. |
| A crowns B | select B in `#national-crown-successor`, click `#national-transfer-crown` | E2 stamps A, E1 emits `national_transfer_crown` matched to A's `np_` and `commandTargetId=empireId`; public roster at or after receipt shows `leaderId===B`, B still a member. |
| Role revocation | render both A and B after authoritative receipt and roster | A no longer has `#national-offer-accession` / `#national-transfer-crown`, B now has emperor-only authority. Old invite cache invalidated. No optimistic role switches. |

Read-only result: `[data-national-political-status]` must not claim accepted outcome from EventBus alone. `GameView.nationalPoliticalResults()` is actor/recipient-bound. Check exact `type`, `requestId`, `actorId`, `recipientId`, `commandTargetId`, sequence, and issued/current tick; authoritative `nationalPoliticsTick() >= receipt.tick`. Require **both** real browser viewers after crown; prove A's lost powers, not just B's gained powers. Replays and spectators cannot send commands; wrong candidate, duplicate/stale/foreign invitation, conflicting results and disconnected sessions must fail closed.

## 4. Existing authentic two-browser transport: Private lobby, NOT Solo

**Source-proven route:** `HostLobbyModal` + `JoinLobbyModal` can join distinct clients to one server-hosted `GameServer` through remote `Transport.connectRemote()` (`Transport.isLocal=false`). `GameServer.joinClient` admits players **before match start**; once started, a new different identity is a spectator or rejected. `GameServer.handleClientMessage("intent")` calls `handleIntent` with the server's real `client.clientID`; the server builds the single shared `gameStartInfo.players` roster. **Separate browser profiles, distinct authenticated accounts and different persistent IDs** are essential.

**CURRENT BLOCKERS (do NOT use a developer-only bypass):**

- `SinglePlayerModal.startGame()` gives Solo `gameType:Singleplayer`, one local `LocalServer`, one human. Opening a second Solo window is another Game, not a peer.
- `HostLobbyModal` does not offer NATIONAL, and the server's `src/server/ConfigPatch.ts:COPIED_KEYS` does not include `nationalMode`; a host patch containing the flag would be silently discarded. The current official private lobby never establishes a server-validated NATIONAL match.
- `GameRightSidebar`, `NationalDiplomacyPanel` and `Transport.nationalDiplomacyWireEnabled` restrict NATIONAL political interaction to `GameType.Singleplayer`. Extending only the UI or manually setting a client field creates a fake or rejected experience, not authenticated end-to-end gameplay.

**Required E2 + server owner integration, BEFORE E4 widens UI permissions:**
1. Add explicit server-authoritative opt-in for `nationalMode` only to an eligible **unlisted Private, FFA, pre-start** lobby, with compatible difficulty/map/nation setup, no cheats, no passive Public promotion, and validated realm restrictions. Do not casually add a writable flag to every game mode or let guests modify it. E2/server owner must define/exercise the exact privileged host request, wire schema and transition rules, including rejection/negative tests.
2. Preserve lobby creator/match permissions and distinct authenticated identities; start only after both A and B have joined as active, non-spectating humans. Verify one `GameServer`, one gameID, both client IDs in start roster, a shared actual turn stream, `Transport.isLocal === false`, and each client's `GameView.myPlayer().id()` distinct.
3. After that server facility is real, E4 may **narrowly** extend `GameRightSidebar`, `NationalDiplomacyPanel`, `Transport.nationalDiplomacyWireEnabled`, and `foundingUnavailableReason` / `nationalWarActionUnavailableReason` to allow **only** server-validated NATIONAL Private in addition to Solo. Never enable this on arbitrary Public or replay. Add real private-lobby UI affordance only behind the server-proven capability.
4. E3 delivers private `nationalAccessionOffers` to each exact viewer using real GameRunner projections; confirm sender A cannot inspect B's offer via client/worker/replay. E5 drives two **independent CDP connections** to already-admitted A/B browsers, never manually fabricating `playerView`, `clientID`, `nationalAccessionOffers`, or a privileged receipt.
5. At present E5 must report `POLITICAL_SECOND_AUTHORIZED_BROWSER_SESSION_MISSING_OWNER_E2_E4_E6` as an honest blocker. No two-browser acceptance is claimed before the infrastructure is actually enabled and demonstrated.

## 5. WAR → native radial Attack → real consequence → opposing peace

On the active, authenticated human's panel, select `#national-war-target` (eligible opponent nation) and click `#national-declare-war` with the intended `#national-war-scope`. Require accepted E1 `national_declare_war` receipt `nc_[0-9a-f]{32}` and a **fresh `GameView.nationalConflicts()`** including the actual active war. Merely selecting an enemy is not a WAR declaration.

Selecting a real target sends normal `GoToPlayerEvent`, not an attack. Collapse `button[aria-controls="national-diplomacy-content"]` before pointer work. Wait for visible `[data-national-map-target-id="<EXACT target PlayerID>"]`; its center coordinates come from `getBoundingClientRect()`. Verify the center is inside real input canvas, `document.elementFromPoint(x,y)` resolves to canvas, and `TransformHandler.screenToWorldCoordinates(x,y)` maps to land actually owned by target in `GameView.owner(tile)`. No guessed pixels or inaccessible labels.

At that **actual canvas point**: right-click via CDP pressed/released mouse button `right` on desktop; on mobile genuine CDP touchStart/touchEnd. The normal `InputHandler` emits `ContextMenuEvent`, `MainRadialMenu` loads real `myPlayer.actions(clickedTile)`, and the DOM `.radial-menu-container[data-target-player-id="<EXACT target PlayerID>"]` is shown. Require a genuine enabled `.center-button-hitbox` (computed cursor `pointer`, not `not-allowed`). Use real CDP click/touch on that center; verify `SendAttackIntentEvent.targetID`, positive troops, corresponding `GameView.myPlayer().outgoingAttacks()` plus **authoritative GameRunner troop, ownership or damage consequence**. A click or intent alone is NOT success. Targets eliminated or unowned in the meantime must revoke/disable actionable state. If center action is unavailable due to legitimate attack constraints, record a real blocked stage, never emit QA-only attacks.

For peace: `#national-peace-war-id` -> `#national-propose-peace` using real current E1 war ID, then **different authenticated opposing principal** receives the exact pending motion and uses `#national-peace-motion-id` -> `#national-accept-peace`. Confirm E1 accept receipt, ended war in latest `nationalConflicts` and matching `acceptedTick/endedTick`. The proposer can never self-accept, no spoofed opponent.

## 6. Required retained E5/E6 evidence, including failures

Retain exact source SHA and browser/device/viewport, mode and actual client gameID, the 390×844 collapsed panel and unobstructed spawn screenshot, real actor/clientID correlation (sanitized), actual CDP pointer coordinates/dispatch, Game tick/pause/turn evidence, actual outbound intent type and cryptographic request ID (hash in publicly shared reports), worker result type/sequence/recipient, canonical roster before/after, target-owned tile transform, target-labelled enabled radial screenshot, actual attack impact, and distinct two-principal peaceful settlement. Preserve legacy FFA desktop/mobile separately. Do not retain raw private invitations, secret tokens, other players' hidden troops, or sensitive state in publishable artifacts.

**Gate verdict:** R10 physical GPU [#44920010367](https://github.com/LeviCade/OpenFront-National/actions/runs/44920010367) is unsigned diagnostic with NATIONAL desktop founding failure/mobile spawn failure. Combined PR #75 must become exact-head source green and include E5's fixed browser before Conductor authorizes one properly witnessed physical-GPU scenario run. E4 provides source contract, not an unearned physical PASS.
