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

The trusted game system constructs `NationalWorld`, including *only authenticated* sight grants, public diplomatic events, membership and invitations. `projectNationalObservation(world, nationId)` is the single projection for AI planning and human client payloads. Consumers must never receive the raw world, a `Game` reference or a `Player` reference. The observer has no ability to assert `observerId`, `sightGrants`, alliance membership, or recipient rights across the trust boundary.

Outputs are deliberately whitelisted and copied. Public rosters and wars remain visible, private treaty terms appear only for members or pending invitees, and empire membership unions legitimate sightings. Unseen assets and all transport landing destinations are absent. Losing sight revokes current visibility; `advanceLastKnown` can retain the last legitimately seen coordinate with an explicit tick and caller-defined expiry, never hidden live coordinates.

The host's M0 adapter must supply validated geographical sight grants (the 100-tile border / 200-tile coast and warship radius requires an agreed distance/occlusion/index design), and must persist/snapshot sight memory and planner memory deterministically. The tuning numbers, intelligence purchase mechanics, and treaty-tier member-stat rights remain OPEN. Neither the 100/200 geometric implementation nor client/server filtering is claimed done here.

`planNationalInterest` uses `NationalObservation` only, never authoritative state. It provides a deterministic **suggestion**, not an already-legal combat or treaty command. Recheck the action under conductor-owned authoritative validators. Its scores and periodic cadence are provisional tuning hooks; no automatic empire surrender, anti-leader dogpile, hidden-state reads or controller-type branches.

## Acceptance proof and open gates

Covered by `tests/national/`: FOG-01, FOG-02, FOG-07, preliminary FOG-04/05/06 observation behavior; AI-01, AI-02, AI-04, event-driven deterministic memory/cadence and synthetic workload measurements.

**Still required before accepted implementation:** M0 interface approval, authoritative geometry and sight invalidation, worker/client broadcast split, snapshot and replay serialization, route legality, integrated headless game, full regression CI and benchmark on realistic map sizes.
