# ⚔️ OPENFRONT NATIONAL — ENGINEER #2, ROUND FOUR

**Mission:** WAR AND REAL TROOPS MUST EXECUTE IN THE GAME.

**PR #14 MERGED** at `85d245b70c242f09a3dcc66a0c284eb40489d658`.
The old conductor merge gate is lifted; **START NOW**.
Create `stage3/e2-round4-live-combat-20261116` from the CURRENT
`stage3/integration-20261115` HEAD; record actual SHA, target integration.
**Issue:** #10. **Contract:** `docs/22-stage3-round4-integration.md`.

You exclusively own `AttackExecution.ts`, `PlayerImpl.ts`,
`ExecutionManager.ts`, `packages/engine-api/src/Schemas.ts`,
`ExecutionRegistry.ts`, `national/conflict/**`, new national war
executions and conflict tests. You may NOT edit GameImpl, Game.ts,
NationalRuntime, GameRunner, E3 observers, or E4 UI.

**Deliver LIVE gameplay:** route authenticated declaration, legal
imperial/national war and bilateral peace through stamped commands;
reject undeclared human and AI attacks BEFORE embargo, troop movement
or damage; bind your transaction adapter to actual PlayerImpl troop
balances with atomic preflight/commit and zero partial debit; apply
interception to both sides exactly once; persist war, levy, campaigns
and peace in E1's canonical Game snapshot interface. Neutral land
remains capturable by living legitimate actors. Keep individual war
when imperial peace closes. Do not invent P1/P2 retreat rules.

**Real-engine tests:** WAR-01/03/04/07, LEVY-01/04/05/06/07 with real
Game/AttackExecution, second-contributor failure injection,
attack cancellation, replay dedup, snapshot round-trip, exact
conserved troops, unchanged FFA. Full exact-head CI required.

**No administrative hold:** E1's political facade is integrated NOW.
If war snapshot bridge is not finished, implement executable
combat legality and troop transactions in your files while E1
builds the bridge. Communicate signature in #9/#10 rather than pause.

**DELIVER ACTUAL WAR IN THE REAL GAME.**
