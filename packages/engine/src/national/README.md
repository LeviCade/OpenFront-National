# NATIONAL AI and observation: isolated first slice

**Issue:** #11. **Base integration SHA:** `dacb0fe6b7e7c4dd5e681b9bf671498ee4827e6a`.

This folder deliberately contains no authoritative game-loop, wire, routing, political-state or snapshot changes. It is an independent contract candidate for the conductor's M0 review, **not activated NATIONAL gameplay**.

## Legacy access audit (do not silently change legacy rules)

- `execution/NationExecution.ts` passes an unrestricted `Game` and `Player` to `NationAttackBehavior`, `NationWarshipBehavior`, etc. For NATIONAL, that unrestricted access would be omniscient.
- `execution/nation/NationAttackBehavior.ts` reads `enemy.troops()` (e.g. around lines 471, 508), enemy `units()` (around 587) and other full-state methods. `NationUtils.ts` computes candidate strength using unrestricted structure inventories, troop totals and global land comparisons, including a largest-FFA-player leader heuristic. The current behavior MUST NOT be reused as a NATIONAL planner.
- `execution/nation/NationWarshipBehavior.ts` queries global `game.units(UnitType.TransportShip)` around line 189; that inventory is not a valid NATIONAL ship sighting list.
- `game/PlayerImpl.ts` creates full `PlayerUpdate` values carrying gold, troops, attacks, etc. `engine-api/game/GameUpdates.ts` includes those fields, and `src/client/view/GameView.ts` consumes them (including packed per-tick player/attack updates). NATIONAL must filter on the authoritative worker/server outbound boundary **before serialization**, not in the UI. Existing legacy wire is NOT safe to use as a NATIONAL fog view.
- Current `GameImpl` simulation and bot behavior remain unchanged by this slice to avoid legacy-mode regressions.

## Proposed integration rule

The trusted game system constructs `NationalWorld`, including _only authenticated_ sight grants, public diplomatic events, membership and invitations. `projectNationalObservation(world, nationId)` is the single projection for AI planning and human client payloads. Consumers must never receive the raw world, a `Game` reference or a `Player` reference. The observer has no ability to assert `observerId`, `sightGrants`, alliance membership, or recipient rights across the trust boundary.

Outputs are deliberately whitelisted and copied. Public rosters and wars remain visible, private treaty terms appear only for members or pending invitees, and empire membership unions legitimate sightings. Unseen assets and all transport landing destinations are absent. Losing sight revokes current visibility; `advanceLastKnown` can retain the last legitimately seen coordinate with an explicit tick and caller-defined expiry, never hidden live coordinates.

The host's M0 adapter must supply validated geographical sight grants (the 100-tile border / 200-tile coast and warship radius requires an agreed distance/occlusion/index design), and must persist/snapshot sight memory and planner memory deterministically. The tuning numbers, intelligence purchase mechanics, and treaty-tier member-stat rights remain OPEN. Neither the 100/200 geometric implementation nor client/server filtering is claimed done here.

`planNationalInterest` uses `NationalObservation` only, never authoritative state. It provides a deterministic **suggestion**, not an already-legal combat or treaty command. Recheck the action under conductor-owned authoritative validators. Its scores and periodic cadence are provisional tuning hooks; no automatic empire surrender, anti-leader dogpile, hidden-state reads or controller-type branches.

## Acceptance proof and open gates

Covered by `tests/national/`: FOG-01, FOG-02, FOG-07, preliminary FOG-04/05/06 observation behavior; AI-01, AI-02, AI-04, event-driven deterministic memory/cadence and synthetic workload measurements.

**Still required before accepted implementation:** M0 interface approval, authoritative geometry and sight invalidation, worker/client broadcast split, snapshot and replay serialization, route legality, integrated headless game, full regression CI and benchmark on realistic map sizes.


## Round Two — scoped war sides and precise M0 filtering adapter

**Contract alignment:** `docs/19-stage3-m0-interface.md` (conductor draft)
defines `NationalWarView` with `id`, `scope: "national" | "imperial"`,
`first`/`second` (`kind`, `stableId`, `activeMemberIds`) and
`startedTick`. E2's authoritative ledger must supply **active** records with
both sides, not a flattened set of participants. The public projection copies
only those fields; AI derives opponents strictly from the opposite side.
Same-side comrades are excluded from attacks even when no independent treaty
exists. Independent national and imperial wars have separate record IDs;
closing one must not mutate any other record. Tests simulate peace by supplying
the resulting active-war list; they do not execute game war/peace commands.

### Mandatory conductor-owned authoritative adapter

1. **Mode, principal and political state.** Validate an opt-in NATIONAL flag
   for `GameType.Singleplayer` + `GameMode.FFA` *before* constructing the
   simulation. The absent flag preserves old behavior. Derive the observer's
   existing stable `PlayerID` from authenticated engine/session state, not a
   request parameter. `GameImpl` remains the sole mutable NATIONAL authority.
   Construct an internal `NationalWorld` from real E1 political membership
   and E2 scoped active war records. Preserve every side's kind, stable ID and
   active members; do not synthesize enemy status from a flat participation
   roster. Validate invitation recipients, member rights and active war IDs
   against the current state at each snapshot/tick boundary.
2. **Sight-grant producer.** Compute grants from actual owned borders and
   observer-owned coast/warships, under agreed tile geometry (initial proposed
   distances: 100 land tiles, 200 ship tiles). Define coast/occlusion rules and
   deterministic invalidation on tile ownership changes, fleet movements,
   recon purchase/expiry and empire joining/dissolution. A `NationalWorld` and
   its sight grants must **never** be accepted from any client or bot input.
   Empire unions only currently authorized member discoveries, with source
   provenance; stale inherited sightings disappear on departure/dissolution.
3. **`NationExecution` adapter.** The present
   `packages/engine/src/execution/NationExecution.ts` creates unrestricted
   `Game`/`Player`-backed `NationAttackBehavior`, `NationWarshipBehavior`
   and allied behaviors. The legacy attack selector reads enemy `troops()`,
   `units()` and global leader stats. Warship behavior scans global
   `game.units(UnitType.TransportShip)`. For **NATIONAL only**, replace all
   strategic reads with a conductor-owned
   `NationalObservationBoundary.projectForAI(playerId)` built using
   `projectNationalObservation`; feed that **whitelist DTO exclusively** into
   `planNationalInterest`. Disable bypassing legacy behaviors in NATIONAL,
   including ship tracking, follow-up attacks, nukes and embassy/structure
   target paths where they access unrestricted enemy state. Preserve their
   behavior in legacy modes. Persist planner cadence/reputation/sight memory
   through canonical versioned snapshot/restore; do not execute the planner's
   suggested objective directly. Route suggested actions through the same
   authenticated E1/E2 diplomacy/war/peace/attack validators as humans.
4. **`GameUpdates` outbound adapter.** Existing
   `PlayerImpl.toFullUpdate()` sends exact gold, troops, income and attacks;
   `PlayerImpl.toUpdate()` emits packed `[smallID, tilesOwned, gold, troops,
   goldEarned]` stats and `[ownerSmallID, direction, index, troops]` attack
   deltas. `GameImpl.executeNextTick()` also emits packed tile/unit/motion
   data to `GameView.update()`. The conductor must create a **per-recipient
   observation-to-wire projection before serialization/transmission**, not
   filter a universal `GameUpdateViewData` only in a React view. It must
   suppress/redact foreign exact gold, troops, earned income, secret clauses,
   structures, ships, unobserved transport destinations, concealed tile/unit
   changes, attack indexes/counts, name-position leaks and hidden event
   messages. Handle *all* `packedPlayerUpdates`, `packedAttackUpdates`,
   `packedUnitUpdates`, `packedMotionPlans`, unit/tile/name/structure updates
   and initial full `PlayerUpdate` payloads. Scope diff caches and resync
   state per authenticated observer so changing visibility emits removals and
   never resurrects a hidden asset from prior cached client data.
5. **Alternate exit paths.** Enforce the same whitelist for initial world
   state, join/rejoin, spectators, replay playback, export, snapshot downloads,
   reconnect/resync, admin/debug interfaces and worker messages. A game worker
   that retains full hidden state *in the user's browser* is not a genuine
   adversarial confidentiality boundary, even if worker-to-main messages are
   filtered; tamper-resistant fog requires authoritative simulation on a
   trusted host or an explicitly limited UI-fairness-only threat model.
6. **Verification before enforcement claims.** Test actual serialized bytes
   delivered to humans and AI; same-seed war-side behavior and real 2-vs-1
   combats; independent national+imperial war/peace transitions through E2;
   exact union/revocation on empire changes; snapshot/save/replay hash and
   legacy-disabled flag behavior. Record CPU and heap for realistic maps.

**Round Two implementation scope:** only the isolated observation projection,
planner and dedicated tests/docs. No modifications to `NationExecution`,
`GameImpl`, `GameUpdates`, `ExecutionManager`, schemas or snapshots. Real
FOG enforcement and legal combat routing remain **not implemented** in PR #12.
