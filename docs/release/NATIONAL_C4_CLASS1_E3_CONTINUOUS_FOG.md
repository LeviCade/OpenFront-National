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
accept() before mutation. Apply clearAllTiles/Units, then removedTileRefs and
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
