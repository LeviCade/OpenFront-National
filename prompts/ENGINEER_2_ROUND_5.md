# ⚔️ OPENFRONT NATIONAL — ENGINEER #2, ROUND FIVE

**MISSION: MAKE LIVE MDA LEVIES AND DIPLOMATIC COMMANDS CONSERVE TROOPS.**

Repo `LeviCade/OpenFront-National`.
Branch `stage3/e2-round5-war-levy-completion-20261116` from the
verified CURRENT integration SHA, target
`stage3/integration-20261115`. Issue #10. Read
`docs/23-stage3-round5-integration.md` and your PR #25 review.

**Own:** AttackExecution.ts, PlayerImpl.ts, ExecutionManager.ts,
NationalWarExecution.ts, Schemas.ts,
`packages/engine-api/src/game/GameUpdates.ts` (explicitly yours),
ExecutionRegistry.ts, conflict modules and real-game tests.
Do NOT edit GameImpl, Game.ts, NationalRuntime, GameSnapshot, worker or UI.

**First publish:** E2-owned exact engine-api `GameUpdateViewData`
optional DTO shape for E1 public `nationalPolitics` and
recipient-scoped `nationalCommandResults` (E3 emits; E4 reads).
No private treasury/troop/secret diplomatic data in the DTO.
Public schema compile tests included.

**Real combat:** Consume E1's actual `nationalMdaAllies` read port,
never optional `?? []` while active MDA requires donors. Prove
eligible donors discovered from actual joined/betrayed MDA and
contributed only as permitted. Use actual
`PlayerImpl.commitNationalTroopDebits` and E1 Game-owned ledger.
Reject undeclared aggression BEFORE side effects. Accepted attacks
must debit real donor troop balances exactly once, apply corresponding
attacker loss exactly once, preserve outstanding national layers after
imperial peace, and survive queue/snapshot/replay. No phantom troop
refund on retreat, cancellation or malformed request. Maintain a
safe disabled fallback only for genuinely unresolved P1/P2 policy,
with specific scenario coverage.

**Acceptance:** WAR-01/03/04/07, LEVY-01/04/05/06/07
via Game/AttackExecution/ExecutionManager, two and three donors,
failure on second/final donor leaves both sides and ledger
unchanged, duplicate/replay after restore, forged clientIDs
denied, valid neutral attack still succeeds, legacy FFA unchanged.
Full CI on exact HEAD + integrated replay proof.

**Do not block on E1:** implement schema/command checks and CAS tests
against the published interface, leave unresolved calls fail-closed,
post missing signature on #9/#10 immediately. A runnable game is the
deliverable.
