# 👑 OPENFRONT NATIONAL — ENGINEER #1, ROUND THREE: REAL POLITICS IN THE ENGINE

**Repository:** `LeviCade/OpenFront-National`
**Starting integration SHA:** `9de2e923532c307c144375ff0172b7e6261750ed`
**Branch to create:** `stage3/e1-round3-live-sovereignty-20261115`
**PR target:** `stage3/integration-20261115`
**Issue:** #9; handoff: `docs/20-stage3-round3-integration.md`
**Ownership:** all E1 exclusively leased files listed there, including GameImpl, Game.ts, NationalRuntime, GameSnapshot, WinCheckExecution, and politics modules. Do NOT edit schemas, ExecutionManager, AttackExecution, GameRunner, NationExecution or E2/E3 modules.

## YOUR MISSION: make authoritative real-player politics execute correctly, not just answer adapter queries.

**First commit / coordination contract:** Add a narrow read-only `Game` NATIONAL political authority/state access method backed by the SINGLE existing `NationalRuntime`, with no client-controllable `PoliticsProjection` mutation. Publish the exact signature immediately for E2 and E3. Do not wait for the full feature to complete.

**Gameplay requirements:**
1. Correct all eight real Ungovernable metrics: land, maxPopulation, activePopulation, cities, factories, ports, silos, warships. Collect them from actual engine state and existing unit/stat APIs with strict validation. No synthetic zero placeholders presented as final metrics, no overflow, no hidden identity remapping. Cover spawn/elimination/territory/unit changes.
2. Fix the unspawned nation victory-blocking defect with an **explicit, deterministic, authoritative spawn/failure/forfeit rule**. Prefer actual engine spawn lifecycle and pending legitimate spawn executions over arbitrary wall clocks. Because policy #15 P5 is not ratified, document the exact proposed rule and keep any unresolved forfeit behavior disabled; still demonstrate the deadlock and deterministic fix under an explicitly test-selected policy. Never eliminate a still-valid pending nation to rush victory.
3. Run imperial leadership, accession, treaty and last-sovereign logic against real `GameImpl` players and `NationalRuntime`, not a second simulated state. Expand the existing authenticated `performNationalCommand` (or an equivalent real execution in E1-owned files) to exercise a real transition at tick boundary, with unauthorized actor rejection and deterministic replay; coordinate E2's command routing surface instead of changing it yourself.
4. Schedule and persist the 10-second strict-eight-metric Ungovernable countdown using the actual 100 ms/tick simulation clock. Emit/record a warning and clear it on recovery/transfer. **DO NOT automatically redistribute resources or dissolve a multi-member empire until policy #15 P3 is approved and a conserved, replay-safe asset disposition exists.** A disabled collapse is preferable to corrupted armies.
5. Preserve full sovereign victory roster (imperial leader and members) in NATIONAL-only state/observations without regressing legacy `setWinner` semantics. Ensure snapshot version migration and exact restore where any schema changes.

**Real-game tests required:** SOV-01, SOV-03/04, SOV-05 warning, SOV-06 leader elimination, SOV-07 victory without land percentage, COAL-05/06; actual spawned `Game` + execution/ticks, pending-spawn expiry edge, empire crown transfer, snapshot/restore/rerun hash equality, and unchanged legacy winner. Existing E1 23 + 12 adapter tests stay passing.

**Delivery:** committed source + full CI green on exact HEAD; PR lists actual gameplay paths invoked, scenarios passing and blocked, snapshot impact and all measured gaps. Do not hand back only a design or ask the conductor to write the central integration for you.

**THE GAME IS YOUR TEST HARNESS, NOT JUST `PoliticsProjection`.**
