# 🧠🔐 OPENFRONT NATIONAL — ENGINEER #3, ROUND THREE: REAL AI AND OUTBOUND FOG

**Repository:** `LeviCade/OpenFront-National`
**Audited source baseline:** `9de2e923532c307c144375ff0172b7e6261750ed`
**Branch starting SHA:** retrieve and record the CURRENT HEAD of `stage3/integration-20261115` AFTER `docs/20-stage3-round3-integration.md` is present; do not branch from the older source baseline.
**Branch:** `stage3/e3-round3-live-observation-20261115`
**PR target:** `stage3/integration-20261115`
**Issue:** #11; contract: `docs/20-stage3-round3-integration.md`.
**Ownership:** national/ai/**, national/observation/**, NationExecution.ts and nation behavior modules, GameRunner.ts and relevant worker/outbound adapter files, plus dedicated AI/FOG tests. **You may now edit these real engine dispatch/outbound files.** Do NOT edit GameImpl, Game.ts, Schemas.ts, ExecutionManager.ts, AttackExecution.ts, PlayerImpl.ts or ExecutionRegistry.ts.

## MISSION: prove a NATIONAL bot and a human consumer get ONLY legal observations from a REAL running game.

1. Build a trusted `Game` -> `NationalWorld` collector at the authoritative tick boundary. It must derive public player facts, empire memberships, verified geographic line-of-sight and military sight grants from actual engine state. No client-granted visibility, no raw user-supplied world, no uncontrolled controllerKind. Use E1's single authoritative read-only political facade, and use E2's persisted two-sided war state when present. If war is not integrated yet, report disabled war sight instead of inventing independent war truth.
2. In `NationExecution`, route NATIONAL-only decision-making through `projectNationalObservation` and `planNationalInterest`, NOT through legacy omniscient nation behaviors. Supply at least one **actual legal executable** national AI behavior using an observed reachable opportunity. Preserve non-NATIONAL bot execution byte-for-byte.
3. Filter real `GameRunner`/worker outbound updates per authenticated recipient BEFORE sending. Audit all channels: ordinary units, packed updates, attacks, tiles, player stats, resynchronization, reconnect and snapshot replay. No enemy troop counts, locations, secret treaties or landing destinations without actual sight. This is a security property, not a UI hide flag.
4. Persist every per-observer sight memory / diplomatic planner memory and deterministic visibility expiry across snapshot and replay using an E1-approved persisted hook or a dedicated registered execution with coordinated registry owner E2. Never store authoritative observer state in an ephemeral WeakMap; never reuse memory after empire dissolution.
5. Prove human-versus-AI parity, own/empire vision sharing, instant revocation, no cross-principal contamination, no information leakage through packed payloads or delta/resync. Maintain deterministic tick-level performance and run a practical hundreds-of-nations scenario.

**REAL acceptance tests:** FOG-01, FOG-02, FOG-03/04, FOG-06, FOG-07 and AI-01, AI-02, AI-04 with `GameRunner` + `NationExecution` + intercepted emitted packets. Include hidden enemy canaries for strength, position, unit identity, packed stats, replay, and reconnect. The already-green isolated 11,284-test baseline is not a substitute for one visible real-game example. Negative test: ordinary FFA outbound and legacy bots unchanged.

**Delivery:** committed code, exact-head green full CI, source files proving real dispatch/packet integration, snapshot/replay, bounded performance numbers and a list of disabled policies (#15 P4). If a signed command path is not yet available, run your AI through existing validated execution primitives and coordinate with E2; do not submit a strategy suggestion that never executes.

**AI DOES NOT GET A SECRET CAMERA INTO THE WORLD.**
