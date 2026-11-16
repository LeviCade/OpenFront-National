# ⚔️ OPENFRONT NATIONAL — ENGINEER #2, ROUND THREE: ACTUAL WAR AND ATOMIC TROOPS

**Repository:** `LeviCade/OpenFront-National`
**First gate:** Repair existing PR #14 head `7a32cc29a71db29dd38b3d6c8ef4ed6d70d68364` on `stage3/engineer-2-conflict-20261115` against the conductor's posted review. **Do not start a separate R3 branch before this repair is complete and merged.**
**Then create:** `stage3/e2-round3-live-conflict-20261115` from the exact newest `stage3/integration-20261115` SHA after repaired #14 merge.
**PR target:** `stage3/integration-20261115`.
**Issue:** #10; contract: `docs/20-stage3-round3-integration.md`.
**You exclusively own:** conflict modules, AttackExecution.ts, PlayerImpl.ts, ExecutionManager.ts, engine-api/Schemas.ts, ExecutionRegistry.ts, new NationalWar* execution files, and dedicated conflict real-game tests. **You may now touch these central execution files.** Do NOT edit GameImpl, Game.ts, NationalRuntime, GameSnapshot, NationExecution, GameRunner or E3 modules.

## GATE A — TWO REQUIRED PR #14 REPAIRS

1. `DefenseLevyLedger.stage()` returns previous `DefenseResult` for a duplicate accepted `attackId`, but there is no fresh/replay indicator. A live attack consumer could subtract interception from attacker strength AGAIN even though defenders were not newly debited. Extend the return/apply-once contract, include both sides in duplicate and snapshot replay tests, and ensure a reused ID with different parameters fails.
2. `WarLedger.authorizeOffensiveAction(attackerId, null)` currently allows unowned capture even when attacker is unknown/dead. Fail closed for invalid actor before honoring legitimate terra nullius capture. Tests must distinguish both cases.
Keep all 19 original conflict cases and existing atomicity tests passing; obtain exact-head green CI. Conductor will then merge #14.

## GATE B — LIVE GAME INTEGRATION, NO FAKE LEDGER

1. Route NATIONAL `declareNational`, `declareImperial`, `proposePeace`, `acceptPeace` through actual authenticated, server/clientID-stamped `ExecutionManager` / `Schemas` and stable engine `PlayerID` authority (E1 read-only facade). No user-supplied war authority or campaign state, no duplicate mutable political registry. Legal wars must be represented by **persisted** authoritative state (registered versioned execution or E1-approved NationalRuntime service); never transient unsnapshotted WeakMaps.
2. Make actual `AttackExecution.init` check `WarLedger.authorizeOffensiveAction` **before** embargo, troop debit, alliance mutation, attack creation or conquer. Ordinary FFA unaffected; terra nullius allowed for real living attacker. Human, AI and engine-generated attacks subject to same legality.
3. Implement a real **indivisible** `PlayerImpl` troop transaction. Validate ALL balances and integer/rounding invariants before applying any; commit with no arbitrary failure callbacks after mutation begins. Bind `TroopDebitTransactionAdapter` to those live players. The existing preparatory adapter contract alone is NOT acceptance.
4. For an authoritative accepted hostile attack, apply MDA levy exactly once and reduce **both** attacker strength and real contributor balances in one deterministic transaction. Enforce reserve/campaign caps; anti-microattack campaign identity MUST be server-derived. Failures, second/final contributor injection, invalid approvals, cancellation and replay leave BOTH sides unchanged. No troop creation or lost partial debit.
5. Version/snapshot/replay all war layers, peace motions, attack IDs and levy budgets together. Your leased files exclude `GameSnapshot`; coordinate the exact data-state hookup with E1's Game facade or use registered execution state, and prove actual restored `Game` effects.

**Mandatory real-engine tests:** WAR-01, WAR-03, WAR-04, WAR-07; LEVY-01, LEVY-04, LEVY-05, LEVY-06, LEVY-07; real spawned Game/AttackExecution, unauthorized nation/no declaration, two-sided imperial war, separate peace layers, second/final debit fault, repeated attack snapshot/replay, neutral conquest unchanged, deterministic balances and full legacy regressions. Distinguish approved policy vs provisional disabled behavior (#15 P1/P2).

**Delivery:** full source, full exact-head CI, real-game test proof and PR. No report consisting only of a transaction interface.

**NO PHANTOM TROOPS. NO FAKE WAR.**
