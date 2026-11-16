# Stage 3 Round Five — ONE working NATIONAL game, five engineers

**Baseline:** exact SHA of `stage3/integration-20261115` at branch creation;
record it in each PR. **Conductor:** reviews, coordinates, merges and scores
evidence, not the default feature implementer.
**Original scoring methodology restored:** [docs/21](21-progress-of-project.md)
and [issue #20](https://github.com/LeviCade/OpenFront-National/issues/20).
Previous verified score **21%**; target **26–31%** only for newly proven
combined gameplay. A green standalone PR earns zero on its own.

## Integration and status

- E5 PR #26 independent QA is merged as infrastructure, not a full-browser
  gameplay acceptance.
- E4 PR #27 guarded founding UI is merged. Founding _request_ is clickable;
  a game-authoritative accepted/rejected result and political roster must
  still cross the worker boundary to prove full playability.
- E1 PR #23 **MERGED** (`f882b389`): canonical Game-owned WAR/LEVY state,
  deterministic snapshots and a detached public political view.
- E2 PR #25 **MERGED** (`d3279d84`): authenticated war execution,
  offensive legality and real troop CAS. Missing MDA discovery now
  **fails closed**; complete donor enumeration in Round Five.
- E3 PR #24 **MERGED** (`2172f926`): scoped-war AI and corrected
  inherited empire sight. Human last-known memory remains detached,
  and political view/outcomes are not yet sent to the client.
- **Do not block engineers waiting for merges.** All have independent
  tasks and explicit file ownership. The conductor merges after CI.

## Signed interface ownership — no cross-engine duplicate truth

**E1: Game-side state, snapshots and authenticated outcomes only**

Files: `packages/engine/src/game/Game.ts`,
`packages/engine/src/game/GameImpl.ts`,
`packages/engine/src/national/NationalRuntime.ts`,
`packages/engine/src/national/politics/**`,
`packages/engine/src/snapshot/GameSnapshot.ts`,
`packages/engine/src/execution/NationalFoundEmpireExecution.ts`,
E1 politics tests.

- `nationalMdaAllies(defenderId: PlayerID): readonly PlayerID[]` is
  canonical, sorted, unique, alive/spawned and based on actual
  `NationalRuntime` MDA pact membership. Never trust client donor IDs.
  Invalid/unknown defender fails closed.
- `nationalPublicPoliticalView(): NationalPublicPoliticalView | null`
  already exists; return detached public only (empire leader/members,
  warnings and victor). No private treaty terms or individual troop totals.
- Add a bounded deterministic per-player `nationalCommandResults` journal:
  at least `national_found_empire` accepted/rejected, actor ID, empire ID,
  tick and sanitized reason. Retain long enough for worker delivery,
  replay/snapshot safe, no cross-principal disclosure. E1 alone records
  actual acceptance/rejection in the trusted execution.
- Provide `readNationalObserverMemory(playerId)` /
  `writeNationalObserverMemory(playerId, data)` or exact equivalent
  versioned GameSnapshot port for E3 per-human last-known sight.
  Validate principal identity and schema; no stale empire-derived grants
  surviving dissolution.

**E2: authenticated intents, combat and shared engine-api wire type**

Files: `packages/engine/src/execution/AttackExecution.ts`,
`packages/engine/src/execution/ExecutionManager.ts`,
`packages/engine/src/execution/NationalWarExecution.ts`,
`packages/engine/src/game/PlayerImpl.ts`,
`packages/engine-api/src/Schemas.ts`,
`packages/engine-api/src/game/GameUpdates.ts` (E2-exclusive addition),
`packages/engine/src/snapshot/ExecutionRegistry.ts`,
`packages/engine/src/national/conflict/**` and conflict tests.

- Use E1 canonical `Game.nationalWarAuthority` and
  `nationalMdaAllies`, not a second mutable ledger.
- Shared typed `GameUpdateViewData` must support optional
  `nationalPolitics` and recipient-scoped `nationalCommandResults`
  with strictly public DTOs. The E2 schema owns types; E3 populates packets;
  E4 only reads them.
- For any attack, authorize prior to side effects. Accepted MDA levy must
  have stable server campaign identity, all contributor CAS, one attacker
  interception application, rollback/cancel safety and exact snapshot.
  No silent success with empty contributor list when MDA is active.
- Existing `PlayerImpl.commitNationalTroopDebits` should be the single
  atomic balance primitive. E1's Game adapter calls it; E2 owns primitive.
  Confirm post-acceptance cancellation does not duplicate/destroy troops.

**E3: verified observer, AI and outbound serialization only**

Files: `packages/engine/src/GameRunner.ts`,
`packages/engine/src/worker/**`,
`packages/engine/src/execution/NationExecution.ts`,
`packages/engine/src/national/observation/**`,
`packages/engine/src/national/ai/**`, E3 tests.

- Serialize E1 public `nationalPolitics` and **only current actor's**
  command outcomes via E2 typed `GameUpdateViewData` at the actual
  worker callback. Never trust a client-provided observer ID.
- Persist/recover human last-known sight via E1 GameSnapshot hook.
  Unknown/changed principal must not regain old empire intelligence.
- Use E1/E2 actual national vs imperial war layers for AI; no invented
  hostile flags. Verify real legal AI attacks/peace, disabled unsupported
  economics and authentic bot decision source; packet canaries for
  packed deltas, RPC probes, reconnect and replay.
- **Threat model:** local browser worker is the authoritative simulator.
  UI visibility filtering protects honest-client Solo UX, not a hostile
  browser with access to worker memory. A trusted host is required for
  adversarial multiplayer confidentiality.

**E4: player UI only**

Files: `src/client/**` and `tests/ui/national/**`.
Consume E2 typed and E3 emitted public political/result packets. Confirm
actual Found Empire success only from E1 accepted result plus visible roster.
Rejected/cancelled/pre-spawn requests show real error. Reconnect/replay
must never use stale local success; no imaginary diplomacy or fake promises.
Add responsive keyboard/mobile flows and real, authorized commands only.

**E5: independent QA and release only**

Files: `tests/e2e/national/**`, `tests/qa/national/**`,
`scripts/national-qa/**`, `docs/release/**`,
new `.github/workflows/national-*qa*.yml`.
Run Chromium all the way through Solo→NATIONAL→spawn→Found Empire→accepted
roster→save/restore (not a landing-page smoke). Add WAR+LEVY live-game
fault-injection, deterministic replay and hidden-packet regression gate.
Prove tests fail if an auth check, troop CAS, or recipient filter is removed.
Audit #5 asset rights and #6 production dependency vulnerabilities without
mass upgrading dependencies.

## Merge and progress gates

1. E5 QA and E4 UI foundations are in integration already. Keep them
   feature-limited until E3 public packet bridge is accepted.
2. E1 #23 merged after independent exact-source full CI.
3. E2 #25 merged after fail-closed MDA safety repair and exact-head CI.
4. E3 #24 merged after actual combat legality enforcement. Combined
   source and independent QA must pass on the same integrated SHA.
5. Merge incremental E1/E2/E3/E4/E5 Round Five PRs in independent tested
   slices, updating E5 QA every time; do not wait for every engineer to finish.
6. For each accepted slice, record exact integration SHA, full CI, real
   observable behavior, scenario IDs, defect owner and newly earned original
   rubric points in issue #20 and docs/21. Do not award points for isolated
   green tests, docs, or a homepage screenshot. Public release still blocked
   by #5, #6 and the hostile-client trusted-host requirement.
