# E1 Round Two — M0 political authority adapter

**Base integration HEAD:** `767c539bb9d518342006363cf2f983d6931f6c33`  
**Branch:** `stage3/e1-round2-politics-adapter-20261115`  
**Issue:** #9 (conductor contract #8); D-003, D-004, D-006, D-007, D-009, D-010, D-012, D-013.

## Implemented within E1 ownership

`PoliticalAuthorityAdapter` implements the published
`NationalPoliticalAuthority` query contract and is structurally compatible
with E2's pending `PoliticsPort`: `empireOf`, `emperorOf`, `membersOf`,
`nationAlive`, `empireExists`, `mayDeclareNational`,
`maySettleNational`, `treatyProtects`. The extra
`authorizedNationalWarActor` is a pure actor-specific authorization query.

The constructor requires a **live getter** (never a cached projection).
Use the authoritative M0 runtime instance as the source:
`new PoliticalAuthorityAdapter(() => runtime.snapshot().politics)`.
This demonstration is deliberately read-only and allocates parsed snapshot
objects; the conductor can later expose a safe read-only state view to avoid
that cost, without introducing a parallel mutable political registry.

Unknown/dead PlayerIDs are denied; treaty protection is symmetric for living
NAP/MDA co-members; same-empire prohibition remains independently enforced
by E2. Empire member war and peace permissions **fail closed** when imperial
policy is absent, false, or undefined. An independent nation controls its
own national actions; reigning emperors control their members' national
actions. Only the reigning emperor may authorize imperial war, derived
from `emperorOf` by E2, never from a member delegation flag.

The 23 Round One tests remain unchanged. Round Two adapter tests run
under the regular node test project and include runtime-snapshot-backed
PlayerID lookups, admission, succession, leader elimination, strict
Ungovernable collapse, invalid identity denial, treaty protection/betrayal,
separate declare/peace delegation, WAR-04/07 authority queries and
serialization/replay equivalence.

## Conductor-owned M0 wiring requests (NO prohibited edits in this PR)

1. **Live adapter:** `packages/engine/src/national/NationalRuntime.ts`
   currently has a private `politics` state and exposes
   `snapshot().politics`. Bind this adapter to that single runtime instance,
   ideally via an immutable read-only getter, and pass it to E2's
   `WarLedger` as its `PoliticsPort`. The delegation callback MUST read
   a future persisted, emperor-owned policy; absent M0 policy means false.
   An adapter must never deserialize/maintain its own authoritative copy.

2. **Elimination ordering and membership:** `NationalRuntime.synchronize`
   already invokes `eliminatePoliticalNation` for spawned players whose
   engine `alive` fact becomes false. That pure transition correctly
   dissolves an eliminated emperor's empire and frees all surviving members.
   Keep this transaction before the single victory evaluation, preserving
   the final multi-elimination tick state. Do not replace empire membership
   with one inferred from land ownership or current emperor PlayerID.

3. **Incomplete metrics/crisis:** `NationalRuntime.synchronize` currently
   writes only `n.metrics.land`; the seven other metrics remain zero.
   It sets `politics.simulationMs = tick * 100`, but never calls
   `evaluateUngovernable`. Thus even strictly inferior emperors cannot
   trigger the required eight-metric 10-second crisis from real game data.
   Populate all eight **authoritative** per-player metrics, use the existing
   engine 100ms/tick simulation clock, and evaluate exactly once at a
   documented post-synchronization tick boundary. Crucially, don't permit
   automatic dissolution until the conductor provides atomic conserved
   treasury/pooled-troop redistribution and war-disposition contracts
   (OPEN decision-register #6/#7/#15). Current pure crisis tests prove only
   the rule, not its live scheduling.

4. **Unspawned identities may permanently block last-sovereign victory:**
   constructor initializes every PlayerID as `alive: true`; synchronize
   does not eliminate `!spawned` identities, even after spawn ends.
   `lastSovereignVictory` properly counts every living independent
   political actor, so an unspawned/AFK registered actor remains a
   contender and can prevent a legitimate last-sovereign win. This is the
   explicit AFK/unspawned policy OPEN in docs/01 and docs/11: choose a
   conductor-approved resolution and enforce it **once** at the engine
   boundary, not by guessing eligibility in this adapter.

5. **Winner labels:** `NationalRuntime.winner()` currently returns only the
   top `PlayerID`. The E1 result also has one `ImperialVictor` and all
   surviving subordinate `EmpireVictor` records. The conductor's
   victory/UI/snapshot contract must preserve that roster without changing
   old-mode winner formats.

6. **Not yet live WAR-04/07:** E2 war records are not in the M0 runtime or
   authoritative snapshot. The adapter answers legal actor/member questions,
   but cannot close a war or ensure a surviving national layer on imperial
   peace until E2 and the conductor wire the war ledger and command routing.

## Explicit nonclaims

This PR **does not** enable live accessions or transfers, add UI controls,
commit diplomacy commands, mutate `GameImpl`, edit `NationalRuntime`,
change snapshots, persist delegation policy, synchronize seven missing
metrics, resolve unspawned/AFK rules, or distribute imperial troop/gold
assets. Those require conductor authority and additional acceptance gates.
