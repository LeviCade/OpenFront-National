# NATIONAL political rules — isolated Engineer #1 slice

Implementation: [sovereignty.ts](sovereignty.ts); scenario proofs:
[PoliticalState.test.ts](../../../../../tests/national/PoliticalState.test.ts).

## Scope and authority

This is a pure, immutable **political-state projection**, not the
conductor-owned `PoliticalIdentity`, `Coalition`, wire schema, snapshot,
`GameImpl`, command router or authoritative victory checker. All input state
is explicit and serializable. Callers must use the conductor's M0 adapter to
commit a returned transition atomically into the game and replay stream.
The engine MUST NOT invoke this code in legacy modes.

- **D-003/004, SOV-01..07:** last living independent _or_ empire, never a
  percentage/timeout check; no false win for NAP/MDA; no requirement to own
  unclaimed land; typed Imperial/Empire/Sovereign prizes.
- **D-006/007, COAL-01..05/07:** ordinary multi-membership,
  invitation/acceptance, named leader or unanimous admission, constitution
  unanimous amendment, constitutional discretionary expulsion, unconditional
  Betray, explicit treaty-attack betrayal, and whitelisted public/privileged
  treaty views.
- **D-009/012/013, SOV-04..06, COAL-06:** exclusive imperial membership,
  two-party accession consent, simultaneous exit from all ordinary pacts,
  exclusive crown transfer and voluntary dissolution, leader elimination
  collapse, all-eight-metric strict last-place crisis and ten-second
  **simulation-clock** timeout.

## Determinism and invariants

Projection arrays and treaty betrayal IDs are stable/sorted where ordering is
observable. Results do not depend on wall clock, random values, network access,
or unordered Map iteration. Inputs are copied before transitions. Validation
rejects duplicate empire membership, dead members, a leader outside its empire,
imperial members in NAP/MDA, invalid invitations and malformed counters.

Note: the crisis clock is **simulation milliseconds**. The conductor must
specify authoritative tick-to-millisecond conversion and ordering. Advancing
a time step triggers or resolves crisis; no background timer is installed.

## Deliberately blocked on conductor M0

1. Canonical state identity IDs, save/load/replay codec, command authorization,
   victory routing, existing war preservation, full-game/legacy regression tests.
2. Treaty penalties and automatic diplomacy consequences, attack execution and
   war legality: `preparePactAttack` only authorizes/schedules betrayal and
   MUST be committed in the same authoritative attack transaction.
3. Treasury transfers, troop redistribution, military policy, government
   decrees and in-flight expedition ownership on empire dissolution/transfer.
   **Do not integrate the empire-collapse hook until the M0 asset-conservation
   path is defined** (decision-register OPEN #6, #7, #15).
4. Broader coalition governance/selected-approver/threshold voting and
   administrative vacancy handling beyond a unanimous reappointment (OPEN
   #11). No invented default tie-breaker. Optional empire military/fiscal
   governance is reserved for later scoped commits.

Public client projections must only use `viewPact`, never serialize the
private `PoliticsProjection` wholesale. An invitation reveals terms only to
its named recipient or existing treaty signatories. A final M0 permission and
serialization audit is mandatory before wiring clients.

## Baseline and compatibility

Starting source SHA:
`dacb0fe6b7e7c4dd5e681b9bf671498ee4827e6a`.
Existing legacy paths are unmodified:
`packages/engine/src/game/GameImpl.ts`,
`packages/engine/src/execution/WinCheckExecution.ts`,
`packages/engine/src/game/AllianceImpl.ts`, and
`packages/engine/src/snapshot/GameSnapshot.ts`.

This PR intentionally makes **zero claims of live gameplay integration**.
The conductor controls merging and upgrading its canonical M0 contracts.
