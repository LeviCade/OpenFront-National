# C5 Third Class E5 — Autonomous NATIONAL reconnaissance decision

Issue [#176](https://github.com/LeviCade/OpenFront-National/issues/176). This document accompanies an engineer-owned **DRAFT** PR to the Class Three integration branch. No point award, self-merge or release authorization is implied.

## Source authority and isolation

Founding SHA: `1c700c46ff981a5857ead6f4ad63636448b7478d`. The new `NationalReconStrategy` is a pure function of `NationalObservation` and bounded local `NationalReconMemory`. It cannot query `Game`, `Player`, foreign treasury, hidden troop strengths, unsighted ship positions or controller type. The same observation producer serves native human views and bots.

An observed enemy **structure** (within prior lawful geographical sight) is a valid center for a **500-gold, 90-tile, 600-tick** reconnaissance purchase. An unseen ship is **not** used to center reconnaissance. Purchase candidates must have a lawful land frontier, not be protected by WAR-side alliance or a coalition, and have either an active public WAR or a publicly larger peacetime neighbor. The bot declines redundant scouting of a presently observed military threat and prioritizes active WAR. Unowned expansion, insufficient troops, empire membership, missing anchor, weaker harmless peaceful rivals and fewer than 2,500 gold all suppress the purchase.

The sole authoritative execution is the inherited `Game.performNationalReconnaissance` on the exact game-owned Nation `Player` object. It charges the original `Player.removeGold(500n)` callback, registers the canonical `NationalReconnaissance` grant and enforces existing actor, target, coordinate, duplicate-token and snapshot restrictions. This is the game-owned handler reached by a human `national_buy_regional_recon` intent. Bots never masquerade as human sessions and cannot mutate a sight flag or duplicate a wallet.

On successful purchase the bot defers further offensive planning, then collects a fresh ordinary principal-filtered observation. A newly sighted hostile military asset with `source:"recon"` is remembered within the grant's original expiration and prompts a **60-tick tactical reserve posture from purchase**: the bot defers an otherwise legal `AttackExecution` against that enemy. This is not a 600-tick blockade; ordinary attack planning resumes while the legitimate reconnaissance grant may still be visible. It does not fabricate a WAR, block neutral expansion or access troop balances. Existing war/economic/coercion and naval hooks remain intact. Sight expires in the authoritative producer on the precise 600-tick boundary.

## Deterministic bounded policy and durability

- Minimum available treasury: 500 fee plus 2,000 reserved gold; minimum own troops 1,000
- Four lifetime attempted purchases maximum per bot; one attempt per target; rejected attempts count to bound repeated failures
- Accepted purchase cooldown 660 ticks; rejected purchase cooldown 180 ticks; tactical attack hold 60 ticks from purchase, independent of the 600-tick sight lease; deterministic player/target/tick request IDs
- Snapshot record `nationalReconMemory` is an optional v2 `NationExecution` field; legacy snapshots omit it, and current saves persist purchases, cooldowns, discovered military identity and expiry
- Existing Game-owned recon journal still blocks identical requests after replay or grant expiry; leases do not become renewable rights on restore
- No new wire command, protocol field, resource currency, GameImpl write or external transport privilege

## Reproducible source acceptance

Use pinned Node 24.15.0/npm 12.1.0 and `npm run inst`, then `npm run typecheck`; focused `npx --no-install vitest run --project node tests/national/C5Class3AIRecon.test.ts tests/national/C5Class2FundedRecon.test.ts tests/national/RoundTenNationExecutionBridge.test.ts`; pinned `oxfmt --check` and `oxlint` on the three touched TypeScript files; `npm run build-prod`; and `npm test` for the whole repository. The PR-owned GitHub workflow runs all gates from the same exact head.

The seeded four-nation GameRunner control denies the original Game purchase and shows an actual `AttackExecution`; the active Game executes the real 500-gold debit, observes the previously hidden transport from the original fog projector, and **does not** issue that attack. Separate live games compare **human-controlled** and **AI-controlled** target behavior and verify real underfunded refusal. Pure policy tests cover public WAR transition, alliance exclusion, imperial membership, no viable threat, hidden inputs, memory exhaustion and bounded cooldowns. Real 600-tick expiry and byte-equivalent snapshot replay are mandatory. The 800-tick extension logs actual lifetime purchase attempts, purchases per 1,000 simulation ticks and serialized memory size.

## Shared-source integration lease

Only `packages/engine/src/execution/NationExecution.ts` is shared. Preserve the E5 import, optional `nationalReconMemory` property, `tickNational` purchase block immediately before `advanceLastKnown`, recon-discovery veto before `reachable()`, and optional snapshot/restore/zod codec. During E6 naval reconciliation, retain independent naval behavior; do not replace the existing economic, political/coercion or WAR planners. All other E5 changes are in its owned new strategy, test, workflow and this document.

The Conductor integrates, reruns exact combined-source acceptance and obtains independent GPU/human witness for release. The Manager exclusively certifies new progress. This work does **not** claim existing M7 paid sight, E6 naval economic warfare, or passive fog as new credit.
