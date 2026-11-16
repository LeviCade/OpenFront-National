# 19 — M0 authoritative integration contract (CONDUCTOR DRAFT)

> **HISTORICAL M0 DESIGN — SUPERSEDED FOR ROUND THREE:** The draft status, branch SHA and assertion that no PR was merged below describe the **pre-implementation checkpoint** only. The executable M0 state is integrated, E1 PR #13/#17 and E3 PR #12 are merged; E2 PR #14 is held for repair. Use [current Stage 3 Round Three integration contract](20-stage3-round3-integration.md) and [GitHub issue #8](https://github.com/LeviCade/OpenFront-National/issues/8) for current ownership, testing and implementation status. Unresolved policy remains in issue #15.


**Status:** Published conductor interface draft, November 15, 2026. **M0 runtime implementation is NOT complete.** This document establishes the common target for integrating the three already-CI-green engineering PRs. No PR #12/#13/#14 is merged at this checkpoint.

**Starting integration SHA:** `dacb0fe6b7e7c4dd5e681b9bf671498ee4827e6a`.
**Engine evidence:** [Politics #13](https://github.com/LeviCade/OpenFront-National/pull/13), [Conflict #14](https://github.com/LeviCade/OpenFront-National/pull/14), [Observation/AI #12](https://github.com/LeviCade/OpenFront-National/pull/12).
**Owner:** Conductor. Revise this contract before modifying any canonical protocol or snapshot implementation.

## M0: one authority, one opt-in, no legacy changes

- NATIONAL is **opt-in only for Solo FFA** (real code uses `GameType.Singleplayer`, `GameMode.FFA`), never ranked, team, tutorial or default legacy FFA. The UI shows NATIONAL above Impossible as a separate selectable ruleset. Do not silently reinterpret `Difficulty.Impossible` for existing games.
- Introduce one explicit persisted NATIONAL config selector, e.g. an optional `nationalMode: boolean` with absent/false meaning existing behavior. Do not change the interpretation of old game records. Server-side parse/validate a requested NATIONAL mode before constructing a game; reject forbidden mode combinations. Determine whether the launcher treats difficulty as the underlying bot baseline in the same API PR.
- `GameImpl` owns the **sole** authoritative NATIONAL state and tick sequence. Nothing in a React component, observer, AI behavior or worker request can directly mutate this state. All nation IDs map to existing stable `PlayerID`/restored player identities.
- Do not duplicate mutable identity/war information across independent E1/E2/E3 stores: the game state owns political truth; E2 reads it through a restricted port; E3 receives a whitelisted projection. Snapshots are versioned, replay-safe and regenerated from canonical state.

## Proposed typed adapter boundary

These are **interface descriptions**, not public wire schemas or production code. Their exact names/versions will be frozen in the conductor's first executable M0 PR.

```ts
type NationalPlayerID = PlayerID; // existing stable engine ID

interface NationalPoliticalAuthority {
  empireOf(id: NationalPlayerID): string | null;
  emperorOf(empireId: string): NationalPlayerID | null;
  membersOf(empireId: string): readonly NationalPlayerID[];
  alive(id: NationalPlayerID): boolean;
  protectedByTreaty(a: NationalPlayerID, b: NationalPlayerID): boolean;
  delegatedNationalWar(
    id: NationalPlayerID,
    action: "declare" | "peace",
  ): boolean;
  checkLastSovereignVictory(): SovereignVictory | null;
}

interface NationalCommandEnvelope {
  version: 1;
  actionId: string; // stable replay/dedup identity, generated or verified by server
  // actor is resolved from existing authenticated Player/intent dispatch.
  action: NationalAction;
}

interface NationalWarSideView {
  kind: "nation" | "empire";
  stableId: string;
  activeMemberIds: readonly NationalPlayerID[];
}

interface NationalWarView {
  id: string;
  scope: "national" | "imperial";
  first: NationalWarSideView;
  second: NationalWarSideView;
  startedTick: number;
}

interface NationalObservationBoundary {
  projectForPlayer(id: NationalPlayerID): NationalObservation;
  projectForAI(id: NationalPlayerID): NationalObservation;
}
```

- **E1 projection adapter:** `PoliticsProjection` is not a second canonical source. It is a pure transition engine. `PoliticsPort` from E2 must be implemented from the same canonical authority, including emperor overrides and delegated national war/peace permissions. Current politics model has not yet implemented the emperor policy backing all E2 permissions; default **deny** until real policy/authority exists.
- **E2 conflict adapter:** `WarLedger` owns legal scoped records but not the game mode, IDs, auth or snapshot. E2's `authorizeOffensiveAction` is consulted **before** an accepted attack reaches the tile capture/combat loop. Peacetime independent territory capture is not a national attack.
- **E3 observer adapter:** the existing E3 `NationalWar.participants` flat list is **insufficient**, because the planner interprets own-side belligerents as enemies. E3 should project two opposed sides from the canonical war record, then determine enemies only from the opposite side. The current provisional E3 type must be updated in a follow-on scoped PR after this interface is finalized.
- National observations are server-created whitelists, never direct serialization of unrestricted `Game`, `PlayerImpl` or `GameUpdates`. AI and authenticated humans see the same permitted facts. No outbound or planner path may bypass authorization.

## Tick, transaction and persistence rules

1. Start with a validated NATIONAL-only authenticated command. Resolve the actor from actual server player identity, not a client-asserted player ID. Deterministically deduplicate action IDs.
2. Apply authorized political/war state transitions at a documented simulation tick boundary. Never execute a military action while a treaty still forbids it; if betrayal is required, commit the betrayal **and** the legal action atomically or reject the full command.
3. For real incoming hostile attacks, obtain a stable **server-derived** invasion/campaign key. After an attack has been admitted but **before first tile capture**, derive MDA eligibility and current contributor balances from actual engine players. Reserve budgets must be evaluated at the same tick.
4. Levy deductions, resulting attack interception, combat effects and both ledgers commit **atomically** or roll back together. A thrown or malformed contributor callback must not leave previous contributors debited. A canceled/rejected action causes no levy cost. Same campaign cannot replenish its allowance due to microattacks.
5. Recompute authoritative observation rights after relevant position/treaty/empire changes. Use a deterministic ordering for equal-tick sightings and events, and expire shared empire intelligence on loss of membership.
6. At a documented tick boundary, evaluate exactly one remaining independent sovereign/empire for NATIONAL victory. Existing ordinary FFA/team/timer/tile-threshold logic remains unchanged whenever NATIONAL is false.
7. Persist the entire NATIONAL political state, war/peace motions, levy charges, the player's live troop balances, last-seen intelligence and planner memory together in `GameImpl.snapshotState` / `restoreState`. Preserve the current versioned snapshot machinery; author explicit version migration from older snapshots with no NATIONAL state. Do not add new fields to an existing version without migration.
8. Derive replay outputs from the same accepted command and deterministic tick order; compare exact final hashes and conservative troop/gold totals.

## Confirmed existing engine points

- `packages/engine-api/src/game/GameTypes.ts`: `Difficulty`, `GameType`, `GameMode`, `PlayerID`.
- `packages/engine-api/src/Schemas.ts`: `GameConfigSchema`, intent union/command schemas.
- `packages/engine/src/execution/ExecutionManager.ts`: canonical intent routing.
- `packages/engine/src/execution/AttackExecution.ts`: attack legality checks and real accepted attack setup.
- `packages/engine/src/game/GameImpl.ts`: `snapshotState`, `restoreState`, `GameSnapshot`, victory plumbing.
- `NationExecution` and outgoing player-update paths: audit for unrestricted global facts before enabling NATIONAL AI/fog.

## Explicitly unresolved; DO NOT invent policy

These decisions remain open in [the decision register](11-decisions.md), and require focused scenario acceptance:

- Server-generated campaign identity/window for repeated attacks and when two offensives count as the same campaign.
- Whether already-intercepted defensive levy troops can or should return on attack retreat; any decision must preserve troop conservation.
- Existing scoped national wars on imperial accession, imperial war disposition on empire collapse, and treasury/troop redistribution.
- Geographic sight grants (100-tile border/200-tile naval defaults), treaty statistics exposure and acceptable planner tick budget.

## Round Two merge / release gates

A complete M0 executable adapter must pass:

- Legacy mode invariant: absence of the flag yields byte-equivalent old outcomes for identical seeds.
- Invalid NATIONAL selector or command is rejected before any side effect.
- SOV-01/04/06/07 across real game players, winner routing and snapshot restore.
- WAR-01/03/04/07 and COAL-05/06 with real command routing and no erasure of surviving war layers.
- LEVY-01/04/05/06 in real attack execution, including a fault-injected atomic rollback test.
- FOG-01/02/06/07 in actual outbound server and AI observations, including two allies versus an enemy in one war.
- Same-seed save/restore/replay hash and integer troop/gold conservation.
- Full existing upstream typecheck, 11K+ unit tests, lint, formatting, production build, and no new legacy regressions.

**Separate public-launch gates:** restricted-asset/browser audit [#5](https://github.com/LeviCade/OpenFront-National/issues/5) and inherited dependency security [#6](https://github.com/LeviCade/OpenFront-National/issues/6). These may not be suppressed by a green source PR.

**Merge policy:** Engineers may keep building/testing isolated modules on their own branches; only the conductor commits central schemas/game-loop/snapshot changes. After the executable M0 contract passes, reconcile the three PRs one at a time into `stage3/integration-20261115`, rerunning integrated tests after each. Nothing merges to main merely because an isolated PR is green.
