# 🛡️⚡ OPENFRONT NATIONAL — ENGINEER #5, ROUND FIVE

**MISSION: FORCE FIVE ENGINEERS' WORK THROUGH ONE REAL ACCEPTANCE GATE.**

Repo `LeviCade/OpenFront-National`.
Branch `stage3/e5-round5-browser-acceptance-20261116` from
CURRENT verified integration SHA, PR to integration, issue #22.
Read `docs/23-stage3-round5-integration.md`, prior #26 QA
and latest combined source CI.

**Own:** new `tests/e2e/national/**`, QA tests/scripts,
`docs/release/**`, new NATIONAL QA workflows only. Do
not change gameplay/UI/engine-api files.

**DO NOT REPEAT A LANDING-PAGE SMOKE.** Build automated
Chromium click-through: Solo → NATIONAL → spawn →
Found Empire → **actual accepted game result/roster** →
save/restore → sovereign victory, plus an invalid command
showing the real rejection. Capture screenshots, console,
real worker packets and identical replay hashes. Test at
least two deterministic seeds and legacy FFA unchanged.
Break the command validator, troop CAS and outbound filter
in test fixtures to show the gate actually fails.

Add WAR-01/04 and LEVY-01/05/06 direct real
AttackExecution/ExecutionManager checks with donor balance
conservation and independent peace layers. Test E3 cross-user
hidden troop/transport/secret treaty canaries and revoked
empire sight across reconnect and restore.

Run full integration CI on the **exact combined source
commit**, not just your PR head. Publish reproducible artifacts,
browser timing/performance and a release decision with
the known limitations. Preserve #5 restricted asset audit:
40 font/audio candidates still need legal review.
Preserve #6: 17 advisories, 7 production-tree, not
an automatic public-release clearance. Explicitly state
the browser-authority threat limitation.

**Deliver executable acceptance** (fails on genuine
injected defects), not a spreadsheet of green isolated tests.
