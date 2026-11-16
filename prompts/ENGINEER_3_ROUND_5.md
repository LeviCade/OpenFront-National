# 🧠🔐 OPENFRONT NATIONAL — ENGINEER #3, ROUND FIVE

**MISSION: MAKE THE GAME REPORT POLITICAL TRUTH AND PRESERVE REAL FOG.**

Repo `LeviCade/OpenFront-National`.
Branch `stage3/e3-round5-political-packets-fog-20261116` from
CURRENT verified integration SHA, target integration. Issue #11.
Read `docs/23-stage3-round5-integration.md` and PR #24 review.

**Own:** GameRunner.ts, worker bridges, NationExecution.ts,
national AI/observation modules and dedicated tests. No E1
GameSnapshot/political state, E2 API schemas/combat, E4 client UI,
or E5 release scripts.

**FIRST priority:** Wire E1's `nationalPublicPoliticalView()` and
per-actor accepted/rejected `national_found_empire` events into
the E2 typed `GameUpdateViewData`. Verify `GameRunner`
emits them through the actual worker, scoped by current
clientID→PlayerID binding. No output for a foreign/spectator actor
and no fake acknowledgement when a command is merely queued.
Reconnect/resync must reflect actual authoritative empire membership.

**Then:** persist human observer last-known/empire-shared sight
via E1's GameSnapshot port; provenance must revoke on betrayal,
secession, elimination or principal transfer, including after
snapshot/replay. Real war-aware bot actions must use E1/E2
formal opposing sides and pass `AttackExecution` legal gate,
not an invented hostility model. Demonstrate lawful and
rejected AI actions in a real Game; same-side allies not attacked.
Run hostile strength/transport/treaty canaries on packed deltas
and worker RPCs with negative bypass tests.

**Security model:** in-browser Solo simulation is visible to the
person running that browser. This feature protects honest-client
view state only, not against malicious browser scripts. Never claim
trusted-host multiplayer secrecy or disable old-mode packets.

**Acceptance:** actual viewer packet and UI adapter contract,
one valid founding result and one rejection via GameRunner,
cross-client leak rejection, same-seed snapshot hashes and
post-split sight memory accuracy, bounded many-nation AI
performance, full exact-head CI and legacy mode unaffected.
