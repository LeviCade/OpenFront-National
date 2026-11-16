# Engineer #1 — Round Three live sovereignty, engine facts and contracts

**Integration start SHA:** `ce123090c12344737922ed41249ba5a1dc1638b1`  
**PR:** #18, into `stage3/integration-20261115`.  
**Owner:** issue #9. **Authority contract:** `docs/20-stage3-round3-integration.md`.

## Published cross-engine Game contract

```ts
Game.nationalPoliticalAuthority():
  Readonly<NationalPoliticalAuthority & NationalConflictPoliticsPort> | null
Game.nationalVictoryRoster(): LastSovereignResult | null
Game.nationalUngovernableWarnings(): readonly NationalUngovernableWarning[]
```

The adapter reads **the one** `NationalRuntime` already held by `GameImpl`.
A captured authority object reads the runtime on every call (no shadow mutable
state). `null` denotes a legacy match. War declaration/peace delegation
remains deny-by-default for nonemperor members. **E2/E3 must consume this
live authority**, not new local political registries. No private pact
constitution or raw mutable `PoliticsProjection` is given to clients.

## Authoritative state and commands

- `GameImpl.synchronizeNationalState` executes after ordinary executions
  every tick, reads real `PlayerID`, liveness, spawned state, territory,
  troop cap and troops, and counts *active finished* Cities, Factories, Ports,
  Missile Silos and Warships from actual owned Unit objects.
- **maxPopulation** is `Math.floor(game.config().maxTroops(player))`, the
  existing engine's true effective troop capacity including cities,
  player type and difficulty. **activePopulation** is the live troops in
  the player's national reserve `player.troops()`, **not** embarked troops
  in an attack/ship. Both are documented proxies for NATIONAL's population
  concepts until a distinct demographic model is approved.
- The original registered `NationalFoundEmpireExecution` now optionally
  executes an E1 political command, preserving v1 founding execution
  snapshots by explicit v1-to-v2 migration. A command's actor is an
  authenticated real `Player` looked up by `GameImpl`, never a supplied ID.
  The E2-owned dispatcher still only creates founding intents until E2 and
  the conductor approve and route additional authenticated command payloads.
- `NationalRuntime.perform` exercises explicit consented imperial
  invitation/application, acceptance, crown transfer, NAP/MDA creation,
  invitation, acceptance and Betray using E1 immutable transitions.
  Authorized political execution is subject to the same real engine
  player registry and spawn-phase check as the original founding command.
- `nationalVictoryRoster` derives supreme and subordinate prizes
  deterministically from the already-snapshotted political state. Existing
  Win `Winner` payload and legacy `GameImpl.setWinner` remain unchanged.
  **Full imperial roster is exposed in the Game-only NATIONAL interface,**
  not yet in outbound victory UI or the legacy event schema. E3 must make
  an explicitly whitelisted view before sending any client data.

## Policy P3 — Ungovernable / assets

The strict eight-metric comparison runs at 100ms simulation tick cadence.
`crisisDeadlineMs` is already persisted as part of the version-1 NATIONAL
political snapshot. Warnings are materialized by `Game` as
`{empireId,deadlineMs,remainingMs,blockedByAssetDisposition}`.
The warning starts at ten seconds, reaches zero after 100 engine ticks,
clears on recovery or a valid timely transfer, and is byte-equivalent
after save/restore. **Empire collapse at expiry is disabled**: the deadline
remains visible and blocked, because the emperor's pooled army/treasury
allocation, surviving war layers and in-flight resources have no approved,
conserving disposition (#15 P3). The pure standalone
`evaluateUngovernable` default remains available for unit-level historical
SOV-05/06 tests but its **GameImpl** call explicitly passes
`allowCollapse=false`.

Emperor *elimination* still dissolves political membership on real
engine liveness, a distinct authorized SOV-06 transition. Its pooled
resource and war consequences also require approval before production
enablement of pooled military systems. No new resource pools are created
by this PR.

## Policy P5 — unspawned sovereigns

The M0 default preserves unspawned identities as pending even after the
spawn phase, and **does not pretend the deadlock is solved in production**.
A live engine may still have a queued, legitimate `SpawnExecution` issued
during the spawn window. Eliminating that player simply because `isAlive()`
is false would corrupt the result.

There is an opt-in deterministic test-selected `forfeit-no-pending` policy
on `NationalRuntime.synchronize`. It forfeits an unspawned nation only
**after** `spawnPhaseEnded` AND when supplied `pendingSpawn=false`.
A still-pending spawn is protected. The live `GameImpl` path uses the
unapproved-policy default `preserve-pending` and does not guess
`pendingSpawn` from a disconnected status or wall time. For enablement,
the conductor must ratify P5 and E1/E2 must provide an authoritative
per-PlayerID pending-intent query from the spawn execution lifecycle,
persist policy selection and test restore on the final spawn tick.
The test fixture uses metrics read from actual spawned players but
explicitly selects the policy in the runtime test, not live matchmaking.

## Gameplay / replay acceptance and limits

Real-engine tests in `tests/national/LiveSovereignty.test.ts` create
actual spawned `GameImpl` players, call the authoritative command route,
verify political transitions and game victory, exercise a registered
command execution across snapshot/restore, and measure a 100-tick crisis
without dissolving or fabricating resources. Existing 23 politics
and 12 adapter tests stay unchanged.

**Not claimed as implemented:** broad E2 war/military legality and COAL-05
offensive-action transaction integration, WAR-04 layered peace, AI/outbound
warning/victory view, full imperial resource allocation, ratified P5
forfeit, or public NATIONAL release. Existing military combat/dispatcher,
wire schemas, GameRunner and AI/outbound files were not touched.

## Performance

Five real unit-list scans per player per NATIONAL tick plus a single
political-state validation/projection are additive only when NATIONAL is
enabled. Legacy game paths do not construct the runtime and remain
unchanged. Future optimization may introduce invalidation-safe unit count
caches (not reused from level-weighted `unitCount`).
