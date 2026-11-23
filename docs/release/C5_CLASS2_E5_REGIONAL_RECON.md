# C5 Class Two / E5 — funded regional reconnaissance (M7 candidate)

**Source:** Issue #163, `docs/07-intelligence.md`. **Authority:** draft implementation only; the Conductor integrates, and the Manager alone certifies percentage. Does not modify inherited 100-tile border or 200-tile maritime sight credit.

## Regional tier (first implemented tier)

| Field | Deterministic rule |
| --- | --- |
| Cost | Exactly **500** units of the payer's existing Game Player gold, once |
| Admission | `national_buy_regional_recon` stamped original player `clientID`; Game validates identity, actual player seat, living/spawned status, active NATIONAL play, live target and valid map coordinates |
| Request identity | Required ASCII `[A-Za-z0-9_-]{1,128}` token, deduplicated per real payer in a persisted ledger for the entire match |
| Scope | A nominated living foreign **target nation** within a single circle centered on actual map coordinates |
| Circle | Euclidean squared distance `(x-cx)^2 + (y-cy)^2 <= 90^2`; no invented geographical radius from client |
| Effective tick | Authoritative `game.ticks()` on accepted purchase |
| Last permitted tick | `effectiveTick + 599`; expires at `effectiveTick + 600` |
| Visible content | Current positions, unit IDs and kinds of target-owned foreign military assets and structures inside the circle; no structure beyond the circle, no other foreign nation from the purchase |
| Excluded | Foreign gold, troop strengths, economic records, private treaty terms, transport target destination, hidden diplomacy, global spectator access |
| Empire | Live **reciprocal** membership grants current allies the same lawfully purchased sightings; dissolution, elimination or stale roster without reciprocal `empireOf` revokes instantly |
| Disappearance | Every observation reevaluates live unit coordinates and the current tick. Region exit or lease expiration stops grants; recon last-known memory carries original expiration to block old markers from lingering |

The 500/90/600 pricing is an **E5 proposal** pending normal product review, because the original spec leaves tier prices open. One charge calls `Player.removeGold(500n)` after checking sufficient funds; no mirrored wallet, debt, additional currency or transfer to a fake treasury is created.

## Engine and privacy boundary

The Game owns `NationalReconnaissance` and serializes the full purchase journal in `GameSnapshot` v5. Old Game v4 snapshots migrate to a **zero-purchase** ledger. Queued stamped executions have their own versioned record in the existing `ExecutionRegistry`. Restoration cannot enlarge a valid lease: original effective and expiration ticks survive unchanged. Expired purchases remain in the bounded journal for replay protection; no active rights survive expiration.

`collectLiveNationalObservation` reads active grants from current members; it groups them by *target nation* and checks actual units only against that target's small active list. This adds no per-grant global territory sweep. The preexisting observation producer still visits live game units for standard sensors; broad O(nations × all units) work in that inherited layer remains an optimization candidate.

The exact same `NationalSightGrant` whitelist is consumed by `NationalObservation` for AI and `NationalOutboundFilter`/native map for the human. The human packet exports approved observed-unit identity/position **without** direct access to underlying concealed unit data. Region sight does not legalize hidden transport destinations.

## Test acceptance and caveats

`tests/national/C5Class2FundedRecon.test.ts` covers real Game + GameRunner with a foreign ship/factory, a moving transport, non-target structure, duplicate click, malformed intent, forged/stale clientID, insufficient funds, exact direct-balance debit, queued turn snapshot replay, empire sharing/dissolution, expiry-tick sight memory, and bounded synthetic 120-country lease lookup.

`/.github/workflows/c5-class2-e5-funded-recon.yml` runs the new tests, inherited coastal and fog tests, TypeScript, pinned formatting, lint and build on the exact GitHub head. Workflow evidence must be examined before any acceptance claim. The synthetic ledger throughput is not a physically measured 120-country game or hardware GPU result.

**Integration-sensitive shared hunks:**
- `packages/engine-api/src/Schemas.ts`: appended intent, preserve binary discriminant ordering.
- `packages/engine/src/game/Game.ts` and `GameImpl.ts`: Game-owned purchase port/ledger and v5 snapshot.
- `packages/engine/src/execution/ExecutionManager.ts`, `ExecutionRegistry.ts`: stamped execution and queued snapshot.
- `packages/engine/src/execution/NationExecution.ts` and `national/politics/NationalGovernanceState.ts`: recon expiry on AI/human stale memory.
- `packages/engine/src/national/observation/LiveObservation.ts` and `NationalObservation.ts`: authoritative sight integration.

**Unclaimed:** national economic assessment tier, global satellites, human purchase button/control (E1 panel ownership), external WSS/account-host end-to-end (E2 ownership), physical GPU certification, release approval, and any credit for old geographic fog.
