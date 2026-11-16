# 👑 OPENFRONT NATIONAL — ENGINEER #1, ROUND FOUR

**Mission:** Persist real conflict authority and finish political-state
interop in the live Game, without taking over E2's combat or E3's fog.

**Branch:** `stage3/e1-round4-political-state-bridge-20261116`.
Start from and record the CURRENT `stage3/integration-20261115` SHA.
**Target:** integration; **issue:** #9.
**Contract:** `docs/22-stage3-round4-integration.md`.
E1 owns GameImpl, Game.ts, NationalRuntime, canonical GameSnapshot and
politics code; E2 owns AttackExecution, schemas, dispatcher, war/levy
logic; E3 owns GameRunner/outbound.

Your first commit must publish a narrow canonical **live war/levy state
service** and durable snapshot bridge from the E1-owned Game state to
the already-merged E2 WarLedger. Publish signatures immediately to E2
and E3 on issues #10/#11. Do not mint a second political registry or
an unsnapshotted WeakMap. In this same branch, finish E1-controlled
authority for pact/empire mutations, preserve E2 legal war-layer identity
across crown transfer or empire dissolution, and expose a read-only
NATIONAL event/warning/victor view for real UI use.

**Acceptance:** Actual Game ticks with an E2 scoped war,
authorization facts before/after crown transfer, a persisted
imperial+individual war record, snapshot restore preserving same-seed
outcomes, sovereign victory and crisis warnings, and unchanged legacy
mode. No unsafe multi-member collapse or unapproved unspawned forfeit.
Maintain all prior politics tests. Exact-head full CI and separate
integrated replay proof. Do not stop awaiting a future E2 feature:
publish the service with safe disabled operations and test it now.

**Deliver:** real code PR, exact CI URL, consumed engine interfaces,
scenario IDs and updated progress evidence, not a design document.
