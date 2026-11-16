# Engineer #1 Round Five — authoritative political data and snapshots

**Starting integrated SHA:** `96e91430d9b12e99b55490b7ca62426d7d5992fc`  
**Branch:** `stage3/e1-round5-political-command-outcomes-20261116`  
**PR:** #31; **issues:** #9, #10 (MDA interface), #11 (E3 observer contract).  
**Contract:** `docs/23-stage3-round5-integration.md`.

## Actual Game MDA membership — E2

```ts
game.nationalMdaAllies(defenderId: PlayerID): readonly PlayerID[]
```

Source commit `646f87e9950ef65e203f39ee48505113a39b82d4` and exact signature published on Issue #10 immediately. The authoritative treaty roster comes from `NationalRuntime`'s original `PoliticsProjection`, never new donor maps or a client-selected array. `GameImpl` checks the real defender and every candidate: recognized, spawned, living PlayerImpl; lexicographically ordered, deduplicated across multiple overlapping MDA treaties, no defender self-donation. Unknown/dead/unspawned/legacy defender yields `[]`. Any successful Betray, constitutional expulsion, death, or consented empire accession affects the next real query and survives a snapshot. **Game-only eligibility is not a troop funding instruction**: E2 resolves actual contributors with `nationalLevySource`, checks capacity and available troops, and applies debit through the established attack-acceptance execution.

## Actual E2 atomic troop primitive

The GameImpl authoritative levy bridge no longer loops over `Player.setTroops()`. It stages and validates the canonical sources, then invokes **E2's already-merged `PlayerImpl.commitNationalTroopDebits()`** on the complete staged batch. E2's primitive does every BigInt balance check and conversion before any owner mutation. The E1 bridge remains within the GameImpl file lease; no E2 combat or PlayerImpl changes. The attacker remaining strength is still E2's responsibility and must apply only when `DefenseResult.application === "applied"`.

## Accepted/rejected Found Empire outcome journal — E3/E4

```ts
game.performNationalFoundEmpireWithOutcome(
  actor: Player, empireId: string, requestId?: string | null,
): NationalFoundEmpireResult
game.nationalCommandResults(
  observer: Player,
): readonly NationalFoundEmpireResult[]
```

The registered `NationalFoundEmpireExecution`, not a UI click or speculative client confirmation, calls the first method after resolving its real authenticated `Player`. It records sanitized `accepted`/reason, exact actor ID, empire ID, tick, monotonically increasing sequence, and replay-aware request ID. Valid real pre-spawn/inactive actors receive a rejection; a foreign/borrowed `Player` is rejected without a forged success. Existing engine exceptions and private coalition terms never enter the public result. Per-observer reads require the exact registered Human `Player` object and only return that actor's outcomes. No accidental disclosure to another player.

The Game's **one** `NationalGovernanceState` retains the last 128 result messages plus up to 1024 idempotence receipts and a deterministic sequence cursor, all in the GameSnapshot v4. Automatic request IDs derive from engine simulation tick and cursor when the trusted execution supplies none; explicitly supplied IDs survive execution snapshot v3 and old execution v1/v2 migrations. Exact duplicate receipts replay without a second founding, while one request ID tied to another actor/empire is rejected. Entries older than bounded receipts cannot guarantee indefinite replay suppression; E3/E4 must treat the journal as an ordered finite delivery window, not permanent global transaction history.

## Principal-bound human last-known intelligence — E3

```ts
game.readNationalObserverMemory(observerId: PlayerID): NationalSightMemory | null
game.writeNationalObserverMemory(
  observerId: PlayerID, data: NationalSightMemory,
): void
```

This persists the existing E3 `NationalSightMemory`/ `LastKnownAsset` structure without cloning or owning E3 observation algorithms. Reads and writes require an actual recognized, living, spawned Human Player ID in the Game. All records are type-validated, bounded to 4096 assets per principal, future sightings or duplicates are rejected, and results are detached copies. GameImpl uses the **current reciprocal** empire-membership query: inherited `sourceNationId` must represent a currently entitled empire partner, not a client or saved grant. Synchronous political mutations, elimination, clock advancement and snapshot restoration prune expired or formerly inherited memory. Direct own sightings may remain valid during the 60-tick retention period. Memory data is private: it does not appear in `nationalPublicPoliticalView()`.

**E3 owns actual trusted collection, filtered packet serialization, and read/write invocation** from its GameRunner, not E1. E1's Game APIs are the authoritative persistence port, not a new observer store or public RPC. E3 must resolve the human principal from authenticated GameRunner state; no caller-provided observer ID should be trusted at a client boundary.

## Save/restore and nondisclosure

GameSnapshot advances v3→v4 by adding nullable `nationalGovernance`. v1/v2/v3 migrations remain, with v3 initializing null (empty authoritative governance state on pre-R5 saves). NATIONAL games restore and validate outcome receipts, actor identities, human memory principal IDs and future ticks, then revoke any intelligence incompatible with *current* empire membership. Legacy modes keep `nationalGovernance: null` and reject its presence during restore. Deterministic Game hash includes this state, all read snapshots are detached, and replayed execution outcomes preserve sequence and request identity. No private memory or journal is added to `nationalPublicPoliticalView`; E3 wires **only the real recipient's** command results through E2's shared typed packets.

## Proved by real Game tests

`tests/national/PoliticalMdaOutcomesMemory.test.ts`: 12 scenarios on actual spawned GameImpl players, overlapping MDA rosters, constitutional expulsion, Betray, player elimination, empire accession, snapshot byte equality, queued execution acceptance/rejection, forged actor rejection, journal bounds, idempotent request replay and per-human inherited-sight revocation. All preexisting E1 and E2 acceptance tests remain in the complete CI gate.

**Still blocked:** unresolved P3 empire resource redistribution, P5 automatic unspawned forfeiture, E2 external wire-to-combat scope, E3 actual filtered outbound delivery and adversarial trusted-host security claims. A passing E1 PR is not a claim of full browser release readiness or an increase in project completion score.
