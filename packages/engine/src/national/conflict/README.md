# OpenFront NATIONAL — Engineer #2 isolated Round 1 implementation

Based on `dacb0fe6b7e7c4dd5e681b9bf671498ee4827e6a`.

Contains source in `packages/engine/src/national/conflict/` and `tests/national/Conflict.test.ts`.

This is **not integrated** into Game/ExecutionManager/AttackExecution or the root snapshot. M0 conductor-owned contract was absent at inspection time. Existing modes remain untouched.

Local verification: global TypeScript 5.8.3, `tsc --strict` compile of modules and tests with a temporary `vitest` type shim, and 19 locally executed tests using a temporary Node assertion shim; all 19 passed. This is not an npm CI claim.

Conductor integration requirements: canonical M0 politics and war record DTO adapter; authoritative attack permission before `AttackExecution.init` removes troop balances, actual assault accepted before levy interception and first tile loss; persist conflict and campaign levy ledger atomically with Player balances; stable campaign identity; peace handling for in-flight land/naval/missile executions; snapshot version migration; full Vitest/typecheck/legacy CI.