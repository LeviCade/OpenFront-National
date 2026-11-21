# NATIONAL Round Ten — E2 authentic gameplay contract

Source owner: Engineer #2 · Source PR [#58](https://github.com/LeviCade/OpenFront-National/pull/58) · Independent browser QA: E4/E5/E6 · Conductor integration [#62](https://github.com/LeviCade/OpenFront-National/pull/62).

## Scope and truth boundary

The accepted combat backend is `GameRunner` → server-stamped `Executor` → `NationalWarExecution` / `AttackExecution` → the **same Game-owned** WAR/LEVY/MDA authority. A UI dispatch is **not** acceptance. A simulated button, direct `Game` mutation in browser tests, fabricated command packet, software-rendered WebGL or test-only combat path is **not** gameplay evidence. Preserve existing legacy FFA behavior.

## Ordinary desktop and mobile player sequence

1. Open Solo mode. In `single-player-modal game-config-settings`, activate the real `button[data-national-difficulty]` and verify its `aria-pressed="true"`; start the game. Confirm the actual authoritative game configuration has `nationalMode === true`. The old checkbox `input[aria-label="Enable NATIONAL sovereignty in Solo"]` no longer exists. Legacy mode must remain selectable and must not show the NATIONAL controls.
2. Spawn the human normally on a passable free tile using native pointer input. On mobile, tap the normal map to spawn and later use its existing tap/context-menu interaction for combat. Wait for the actual spawned, alive player in GameView. A second authenticated human must be present for opposing acceptance; AI nations may also participate as true `NationExecution` players.
3. In `NationalDiplomacyPanel`, select a real living adjacent rival in `#national-war-target` (and `#national-war-target-kind` as applicable). Click `#national-declare-war` once. Assert emitted server-stamped `national_declare_war` matches the authenticated player, has an opaque `nc_[0-9a-f]{32}` request ID, and eventually produces an **E1 recipient-bound accepted result** with the same request ID, actor, recipient, sequence, tick and public active WAR layer. Do not infer success from the click.
4. Use **ordinary map attack input**, not a diplomacy button or a direct test hook. Choose a valid enemy-bordered target, commit a real positive troop amount, and observe the standard `attack` intent. Confirm the attack is engine-authorized, actual attacker troop balance decreases, actual defender troops fight, actual border ownership changes or a genuine ongoing attack is present, and real MDA supporters (when configured) debit existing balances before territorial loss. No imaginary reinforcement or duplicate donor spend.
5. On the active WAR layer, select the live ID in `#national-peace-war-id`; click `#national-propose-peace`. The opposite authenticated participant receives the existing proposal under its own private authorized view; select it in `#national-peace-motion-id` and click `#national-accept-peace`. Assert **real accepted journal results** for both sides and the public WAR transition. An initiating side cannot accept its own proposal.
6. Attempt another map assault against the now-peaceful nation: **no** new attack, troop debit, MDA debit, damage or territory change. If a second independent WAR layer still legally authorizes combat, that **other** layer remains valid; peace ends only the settled layer. Exercise a stale/mismatched request ID and forged client ID as rejection cases without match termination.
7. Capture authoritative view packet deltas, actual Game-owned troop/tile/WAR/LEVY snapshots, deterministic complete snapshot/replay, desktop 1280×800 and mobile 390×844 interaction evidence, and **real GPU-rendered** browser evidence. Keep real-GPU, secrecy, and asset-trust verdicts separate from source-unit-test green.

## AI execution bridge to E3

The two bots are real `NationExecution` instances, never simulated planner outputs. Each uses `collectLiveNationalObservation(game, ownPlayerId)`, calls E3's `planNationalInterest`, invokes **`Game.performNationalWarCommandWithOutcome`** for a legal observed frontier, feeds the returned full `NationalWarCommandOutcome` unchanged to E3's `recordNationalWarOutcome(observation, previousMemory, receipt)`, and queues existing `AttackExecution` **only** on an accepted and still-current Game-authorized WAR.

E3 exclusively owns rejected-target selection and its bounded 180-tick cooldown (max 16 entries). E2 owns the execution hook, snapshot codec and actual attack. The execution codec persists optional `rejectedWarTargets` and `lastWarOutcomeSequence` from E3 without altering the WAR ledger. Public WAR-start/end observation can wake the E3 event-aware planner before its normal cadence; private peace motion IDs, enemy hidden troops, or nonrecipient command receipts cannot.

## Verification map

- E2 canonical live human sequence and conservation: `tests/national/RoundTenLiveCombatRunner.test.ts`
- E2 real two-bot + one-human GameRunner / peace / replay: `tests/national/RoundTenNationExecutionBridge.test.ts`
- E2 stamped empire offer/accept/crown route: `tests/national/RoundTenEmpireWire.test.ts`
- E3 own planner, privacy, rejection/cooldown: `tests/national/NationalCampaignRoundtripR10.test.ts`
- Independent E5 browser controls must follow the current E4 NATIONAL difficulty button and exact human input sequence above.

No self-merge, no release/security acceptance from source checks alone. Exact source SHAs and failures belong in Issues #50/#51/#48.
