# 22 — Round Four integration, threat model and five-engineer ownership

**Conductor:** reviews and merges; no new conductor-owned major feature streams.
**Entry:** E2 conflict PR #14 merged as `85d245b70c242f09a3dcc66a0c284eb40489d658`.
E1 live politics PR #18 merged as `90259d78670161dee4b58bbfd83ec63bbbb67c55`.
Combined source CI [#43878979429](https://github.com/LeviCade/OpenFront-National/actions/runs/43878979429) SUCCESS.
E3 PR #19 has real engine AI/filtered outbound work but exact-head verification
is in progress. Do not merge red or skip security review.
**Project:** [21% verified](21-progress-of-project.md), [score issue #20](https://github.com/LeviCade/OpenFront-National/issues/20).

## Five disjoint engine and UI leases

1. **E1 Politics and canonical state:** `packages/engine/src/game/GameImpl.ts`,
   `packages/engine/src/game/Game.ts`, `packages/engine/src/national/NationalRuntime.ts`,
   `packages/engine/src/national/politics/**`, `packages/engine/src/snapshot/GameSnapshot.ts`,
   `packages/engine/src/execution/NationalFoundEmpireExecution.ts`,
   `packages/engine/src/execution/WinCheckExecution.ts`, real politics tests.
   E1 owns one persisted authoritative war state read/write bridge in GameImpl;
   it consumes E2's WarLedger implementation without duplicating political truth.
2. **E2 Conflict and command execution:** `packages/engine/src/national/conflict/**`,
   `packages/engine/src/execution/AttackExecution.ts`,
   `packages/engine/src/game/PlayerImpl.ts`, `packages/engine/src/execution/ExecutionManager.ts`,
   `packages/engine-api/src/Schemas.ts`,
   `packages/engine/src/snapshot/ExecutionRegistry.ts`, new NATIONAL war
   executions and conflict tests. E2 needs a small authoritative E1 state port,
   but never independently edits GameImpl or snapshot.
3. **E3 Sight, AI and worker:** `packages/engine/src/national/ai/**`,
   `packages/engine/src/national/observation/**`,
   `packages/engine/src/execution/NationExecution.ts`,
   `packages/engine/src/execution/nation/**`,
   `packages/engine/src/GameRunner.ts`, `packages/engine/src/worker/**`,
   dedicated E3 tests. E3 may not edit political state, combat, schemas or
   E4 UI. Real visibility must consume E1's live political authority and
   E2's canonical war state.
4. **E4 In-game NATIONAL user interface:** `src/client/**` and `tests/ui/national/**`
   (new) with a real Solo NATIONAL button-to-execution founding flow.
   Never edit engine schema/worker/game state or E1–E3 owned tests.
5. **E5 Independent QA and release:** `tests/e2e/national/**`,
   `tests/qa/national/**`, `scripts/national-qa/**`,
   `docs/release/**`, new `.github/workflows/national-*qa*.yml`.
   E5 audits actual integrations, not duplicates their implementation.

## Critical contracts that cannot stall engineers

- E1's `Game.nationalPoliticalAuthority()` is now present. E2 and E3
  consume it immediately; no private clone of `PoliticsProjection`.
- To persist war/levy state, E1 publishes the minimal Game state interface
  and snapshot migration in the **first Round Four commit**.
  E2 meanwhile implements type-safe commands, attack acceptance,
  actual troop compare-and-swap and tests against the already-published E1
  political authority; E3 continues own actual observer and bot work.
  One pending interface never idles other workstreams.
- E4 uses the existing `national_found_empire` intent now.
  Additional actions require E2's canonical wire schema; no invented
  client-only success.
- E5 sets up deterministic and hostile-packet tests without waiting for
  all gameplay modules, and expands acceptance after each merge.
- Every PR must show real Game/runner scenarios, exact SHA/full CI, legacy
  nonregression, snapshot/replay and measured effect on the progress rubric.

## Security threat model

**Present deployment:** Solo local-browser engine in a Web Worker.
The browser owns the entire authoritative state. A modified browser
can inspect worker memory, replace scripts or forge local IDs. Packet
filtering and worker RPC guards are meaningful for **honest-client
Solo fog UX** and accidental exposure, but **cannot secure a malicious
client**. No claim that NATIONAL PvP or adversarial fog is secure.

**Future trusted-host deployment:** independent authenticated server
owns all world state, verifies every command, generates sight per real
principal and emits only authorized bytes across the network. Reconnect,
replay, snapshot, worker RPC and spectator paths must remain filtered.
A source-level client filter is never a substitute for server authority.

**Acceptance and release gates:** issue #15 P1–P5 remain open where
specified. No P3 unsafe asset distribution, no P5 automatic AFK forfeit,
no invented sight radius. Asset rights #5, advisories #6, full browser
playtest and security review remain open.

## Merge sequencing and progress

E2 #14 and E1 #18 are merged. E3 #19 is held until true exact-head
green plus specific threat-model review. Next priority is real WAR
commands and legal AttackExecution, real troop debit adapter, honest
client-filtered Solo packets and player-facing founding. Integrate
E1/E2/E3/E4/E5 in small independent PRs with full combined CI after
each acceptance. See issue #20 for the permanently audited score.
