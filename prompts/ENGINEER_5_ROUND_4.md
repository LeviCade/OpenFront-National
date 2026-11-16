# 🛡️⚡ OPENFRONT NATIONAL — ENGINEER #5, ROUND FOUR

**MISSION: BUILD THE INDEPENDENT QA AND RELEASE GATES.**

Repository `LeviCade/OpenFront-National`.
Create `stage3/e5-round4-national-qa-20261116` from CURRENT
integration HEAD, record SHA, target integration. Read
`docs/22-stage3-round4-integration.md` and issue #22.

**Exclusive ownership:** new `tests/e2e/national/**`,
`tests/qa/national/**`, `scripts/national-qa/**`,
`docs/release/**`, new `.github/workflows/national-*qa*.yml`.
No gameplay modules, client UI, or E1/E2/E3-owned tests.

**BUILD ACTUAL PROOF:** headless seeded full GameRunner end-to-end
scenario verifying NATIONAL opt-in, empire founding and saved
victor against legacy FFA; exact deterministic replay hashes and
serialized snapshots; negative authorization/replay/fraud
canaries that cause your tests to FAIL if enforcement is removed.
Add a separate packet-level hostile canary audit which distinguishes
honest-client filtered Solo results from **unprotected malicious
browser/worker memory**. Do not certify the latter.

**RELEASE AUDIT:** document AGPL/license/restricted assets #5 and
inherited security advisories #6 with evidence, not reckless
dependency mass-updates. Record repeatable browser smoke and
CI fixtures, performance budget and regression conditions.

**SUCCESS:** executable QA pipeline, real-game failing/passing
security tests, exact-head green CI, no overlapping code edits,
a usable public release checklist and specific unresolved defects.
No status-only dashboard or test plan without runnable tests.

**YOU ARE THE ENGINEER WHO PROVES THE GAME REALLY WORKS.**
