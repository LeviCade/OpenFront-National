# C4 E3 continuous recipient map contract

Founding SHA 7ba909572739bd0778c9cf34074008f1bf244124. Private trusted host only; legacy/Solo path is unchanged.
Frozen membership slots advance monotonically even when a slot's ID loses sight.
The current page never serializes a revoked ID's owner, location or state.
`tilePageSlots` / `unitPageSlots` are the actual slots consumed, including skipped
IDs. Non-final pages consume the exact respective page limit, not the number of
disclosed tuples. The last page is not an atomic map snapshot.

`tileRemovedRefs` and `unitRemovedIds` contain only previously disclosed cache
entries that lost authorization OR have stale tuple/marker properties and
cannot be refreshed on the current page. They contain IDs only. For tile
changes, old border masks are invalidated even when the old tile is still visible.
A mass invalidation/overflow is a cache clear, not a traversal rewind. Unit
and tile cursors remain independent. A bounded rotating unit window prevents
permanent low-ID preference under stable overflow. `tilePartial` /`unitPartial`
are current coverage flags, independent of traversal completion. Arbitrary
churn can sustain a partial view, but each frozen finite sweep consumes slots
until completion. Newly authorized IDs enter the next sweep.

E4: construct a receiver only on authenticated start. Pass the expected stream
nonce if E2 exposes it on authenticated start. On each live frame validate via
acceptProjection() before mutation. Apply clearAllTiles/Units, then removedTileRefs and
removedUnitIds, then current tuples and markers. Remove stale ownership, border
edges, labels and selection; omitted cells are unknown. The packed tile lane is
empty for trusted active private hosts; the map is the sole ownership feed.
Packed native units are restricted to the current authorized marker page, with
fresh native unit DTOs even for late static IDs. The raw unit lane must not
reintroduce an ID outside delta.units. Use delta.usable for initial partial-map
interaction, only on presently observed targets; never use sweep completion as
an authorization grant. Surface partial flags and overflow. Missing live map
after initial active frame, rejected frame, disconnection or actor switch must
clear private renderer state and require authenticated reconnect. No local
simulation and no in-band new stream adoption.

Safety: 4096 tuples, 4096 tile tombstones, 2048 markers, 2048 unit tombstones,
131072 cached markers and 32M cells; the existing JSON cap remains. Current
tuple verification scans disclosed refs; no hidden cell state is consulted.
Exact-host churn test runs three authenticated seats through GameRunner and
encoded Zbin, logs aggregate time, bytes, heap delta, sweep progress. Metrics
are source-only unless CI actually executes them. E4/E5 visual witness remains
a separate gate.

## Iteration evidence
First candidate 0ddfce49329da8ee42f92ccf4f6f40b9d2160c54, CI run 44974970302:
typecheck first failed on test-only Array.at (TS2550); subsequent tests skipped.
Local exact-source algorithm probe (type-only syntax erased; synthetic authoritative
map adapter, not GameRunner) compared a 32-frame 17,999-visible-tile / up-to-6,200
marker alternating sight scenario. Founding: 32 resets per stream, neither
sweep completed, 4,152 IDs never appeared, peak map JSON 167,042 chars.
First candidate: first tile completion frame 5, first unit completion frame 4,
one initial reset per stream, peak map JSON 174,577 chars, one phase-locked
transient ID never appeared. Wall-time in that isolated JS probe: producer
353 vs 849 ms; map JSON 12 vs 7 ms; shadow cache reconciliation 44 vs 73 ms.
Not full host metrics. The second iteration prioritizes missing authorized unit IDs
at next sweep, tracks loss of shared troop authorization in the native lane,
rejects duplicated IDs across pages, and avoids allocating per-cached-tile
tuple arrays during freshness checks. Sustained adversarial phase-locked
visibility can still yield partial state; finite stable membership traversal
is independent of churn.

## Native companion lane
The active private host's sole tile ownership feed is the map tuple page.
Its packedUnitUpdates is the native representation of exactly that page's
markers, checked by shared NationalObserverNativeWire. Native owner small ID
and UnitType are supplied from the current authoritative Game, not inferred
from renderer state. The public codec's optional NaN fields become JSON null;
restore them only at the enumerated optional offsets, never coerce null to 0.
The shared validator checks both before server serialization and before client
reconciliation: native marker identity/position/owner/type, foreign private
lane absence, current public empire sharing, own missile timers/player stats,
and private receipt/conflict/accession scope.
E4 should use continuity.acceptProjection(parsedProjection), not the narrow
map-only accept, for the actual native path. Its nativeUnits result is a
validated Float64Array with NaN sentinels restored; the materializer must not
pass it through a finite-only JSON array reader. No renderer mutation is made
by this module. The security model does not claim to authenticate mutually
consistent invented facts from a compromised authoritative host.

Second candidate b80e716d2383e26224fc1162746fd4315f388ed4 actual CI run
44975152018: typecheck PASS, 22/22 targeted tests PASS (including layer
boundaries), targeted lint PASS, formatter RED. Three real GameRunner seats,
8 host ticks: first usable frame 0 (zero-indexed), both sweeps complete at
frame 1, one reset at startup, 20 skipped membership slots, peak encoded
packet 380187 B, total host time 254.81 ms, independent pager profiling
31.73 ms, JSON+Zbin encoding 74.82 ms, guard reconciliation 11.49 ms, peak
observed heap growth 42384712 B (includes fixture and captured packets),
zero permanently omitted fixture unit IDs. This is neither full-map nor
native GPU evidence.

## Rejoin and fourth iteration

Third candidate 4de1ea7d43c73cb0b8dd142775111a0d78fd0d6a run 44975342479: TS2559 at native guard weak-type interface, fixed at 2970d0d648f1ffa87baef70d161ecbd036b72eb3. Fourth candidate run 44975478499: typecheck, lint and 25/25 tests PASS; exact formatter reported four files. Additional deterministic seam proved mass clear mid-sweep, skipped undisclosed slots, next-sweep missing-unit priority and 131073-unit rotation. Real GameRunner: 3 seats, 8 ticks, readiness frame 0, sweeps frame 1, one reset, 20 skipped slots, maximum 468271 encoded bytes; host 181.96 ms, producer 22.07 ms, wire 48.09 ms, guard 19.59 ms, observed heap delta 27773112 B, no fixture unit permanently lost. The fixture reported zero previously disclosed territorial revocations in that alternating scenario, so a separate early disclosed outpost is added in the next candidate. Rejoin sends public full roster on first active page, full own PlayerUpdate each active tick without consuming engine diff state, and canonical spawn start tick on first active page. No foreign private full snapshot and no legacy Win/all-player stats exposure.

Fifth candidate 6421d8e3f68333ba0d00eb050d4b53a3115ead0d run 44975629093 failed typecheck (TS2339: public nation flag belongs to PlayerInfo rather than Player interface). Corrected getter in next candidate. UTF-8 payload byte ceiling is checked before transmission; oversized wire throws rather than silently truncating. E2 must isolate rejected delivery and initiate authenticated reconnect, not resume the same cursor cache or expose a full fallback.

Sixth candidate 71a079edbe4ca7378ab74a08e0ed9d7e9bc3d3f6, run 44975732500 job 137065095254: typecheck PASS, 25/25 targeted tests PASS, lint PASS; formatter-only failure. Rejoin full authorized roster/own player snapshot and spawn tick proven in real GameRunner/Zbin reconnect fixture. Host churn: 3 recipients × 8 frames, all usable on first frame, observed max first-readiness elapsed 165.24 ms including sequential guard/profiling work, both primary sweeps complete second frame, 1 initial map reset, 20 skipped frozen slots, 20 previously disclosed tile losses erased in the same delivered frame (0-frame delay), no stable test unit permanently missing, peak 469285 encoded bytes, aggregate host 298.46 ms, pager profile 30.20 ms, JSON/Zbin 88.14 ms, reconciliation 30.70 ms. Sampled net heap peak delta happened to be 0 (GC can hide allocations; not a memory bound). Every accepted page progressed; no rejected/discarded pages in this successful fixture. Browser/hardware and production deployment evidence are separate. Exact final formatting checks are in the next CI run.
