# C7C1 E2 — satellite intelligence

Issue #217. Founding commit 00673dce1ff61c61e44b026e6bd8c7a92f642ff8.

Provisional balance: personal gold 25,000, 300 simulation ticks, no overlapping personal lease. Geographic scope is worldwide current eligible structure/vessel points, not blanket map or foreign statistics. Ordinary border/coastal/warship/regional vision keeps precedence. The same live observation supplies AI and human projections. Only reciprocal current empire membership inherits paid sight; personal receipt stays with payer. Satellite-only points are not retained in stale intelligence. Private observer pagination uses existing limits and revocation tombstones/reset.

The intent carries match ID, issued tick and request ID; original authenticated client and execution admission epoch are established server-side. The ledger retains accepted and denied purchase identities, with 64 attempts per payer and 4096 total; saturation fails closed before debit. The assessment denial journal is not modified: safe eviction requires a separately designed replay/correlation protocol. No public deployment or infrastructure change.

Deterministic test file: tests/national/C7C1E2Satellite.test.ts. Tests use actual GameImpl, Executor, GameRunner, snapshot and pager; transport unit in the plains fixture is created directly for a deterministic confidentiality test, not a live naval launch. Existing focused regressions remain required. Performance claims are structural until measured CI results are available: indexed lease lookup and existing unit traversal, no additional world-tile sweep. Autonomous AI purchase policy is not introduced; AI consumes the same live visibility and can invoke the authoritative purchase port.
