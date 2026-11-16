# 👑 OPENFRONT NATIONAL — ENGINEER #1, ROUND FIVE

**MISSION: COMPLETE THE AUTHORITATIVE POLITICAL DATA AND MDA CONTRACTS.**

Repo `LeviCade/OpenFront-National`. Create
`stage3/e1-round5-political-command-outcomes-20261116` from the
verified CURRENT integration HEAD (record exact SHA). Target
`stage3/integration-20261115`. Issue #9. Read
`docs/23-stage3-round5-integration.md` and PR #23 review.

**Own:** Game.ts, GameImpl.ts, NationalRuntime.ts,
politics modules, GameSnapshot.ts, NationalFoundEmpireExecution.ts and
new E1 real-game tests. Do not edit E2 command schemas/combat/PlayerImpl,
E3 worker/GameRunner, E4 UI or E5 QA.

**YOUR FIRST OUTPUT, IN CODE:** Canonical
`Game.nationalMdaAllies(defenderId)`, derived from the authoritative
living MDA treaty membership, sorted, unique, and authenticated. Issue
#10 needs this immediately. Prove multiple overlapping MDAs, Betray,
elimination, expulsion, same-empire changes and snapshot/restoration.
Do not silently fund zero troops from an active eligible treaty.

**Then:** Persist a bounded deterministic trusted command-result journal
for accepted/rejected empire founding, with actor ID, empire ID, sanitized
reason, tick, and replay-safe request identity. Deliver immutable public
view and per-actor results for E3 packet output. Implement the canonical
versioned per-principal human last-known sight memory GameSnapshot hook
for E3; reject another actor's memory and expired empire-shared sight.
No dual mutable registries, no secret fields in public view.

E2 owns the synchronous `PlayerImpl.commitNationalTroopDebits`
primitive. Coordinate its use in your Game-owned WAR/LEVY adapter, with
all donor balances validated before any mutation. Do not invent a
policy for unresolved empire asset redistribution or AFK forfeit.

**Real acceptance:** MDA participants conserved through live Game
ticks, command success AND failure emitted in deterministic order,
no forged actor success, absent receiver never sees results, empire
roster reflects command at next tick, exact snapshot/replay,
legacy game unchanged. Existing E1 suites all pass.

**Delivery:** full exact-head CI, actual Game execution and snapshot
proof, PR and posted E2/E3 wire signatures. Do not stop while E3
implements packet delivery. GAME STATE, NOT ANOTHER DOCUMENT.
