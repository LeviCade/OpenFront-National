# Third Conductor / First Class — E3 Private Map Continuity v1 additive wire

**Source owner:** E3, draft PR #120, Issue #113.  
**Founding integration:** `ea186fa2580c5e1112e36cf1ddaa9119566a2abe`.  
**Transport:** unchanged E2 authenticated `national_projection` Zbin variant.  
**Certification:** source candidate only. E4 graphical integration, E5 external A/B/C browsers, and E6 signed GPU remain independent gates. Manager baseline 44%; no E3 points claimed.

## Authority invariant

Every published owner/terrain tuple or unit marker comes from **current authoritative Game + collectLiveNationalObservation(game, authenticatedPlayer)**, after the original E2 socket binding. The client cannot ask for an observerId, tileRef, cursor, stream, page or GameSnapshot. Its parsed page is untrusted until continuity validation, and never grants political or military command rights.

The serializer remains an allowlist with a 2,000,000-character JSON cap. The server cannot emit foreign troop strength, hidden transport destination or private treaty details through this observer map. The inherited political DTO security boundary remains independently required.

## Wire fields

Original v1 fields `version`, `tick`, `observerId`, `width`, `height`, `reset`, `cursor`, `nextCursor`, `tiles`, `units`, `unitsTruncated`, `visibleBorders`, `ownResources`, `countries` are retained.

| Additive v1 field | Meaning |
| --- | --- |
| `streamId` | Opaque E2 original authenticated socket nonce, generated on host. Correlation only; **not an authentication credential**. Never copied from browser. |
| `sweepId` | Server-local monotonically increasing tile sweep number. |
| `sweepTick` | Tick when current tile ID membership was frozen. Tile owner/terrain values still read at each **current** emission tick. |
| `unitCursor` / `unitNextCursor` | Independent server-controlled unit ID pagination, <=2048 slots per frame. `null` completes this unit sweep. |
| `unitSweepId` | Server-local monotonically increasing unit sweep number. |
| `unitReset` | E4 must erase all old visible unit markers before adding current page. Can occur without terrain reset on massive unit revocation or marker cache overflow. |
| `unitRemovedIds` | Sorted IDs of previously **emitted** units no longer visible, up to 2048. No coordinates, troops, destination or former allegiance attached. Empty on `unitReset`. |
| `unitOverflow` | Current sight exceeds bounded 131072-ID unit sweep memory. E4 must surface a partial-intelligence indicator; **not complete battlefield state**. |

The previous `unitsTruncated` flag remains a per-frame statement: more than 2048 currently sighted units. It is NOT a declaration that the unit sweep is complete. Completion requires `unitNextCursor === null`, and only `!unitOverflow` permits a claim of full bounded sweep coverage.

## Deterministic server behavior

1. On first emission or original socket reconnect, `reset:true`, `unitReset:true`, `cursor:0`, `unitCursor:0`, new `streamId` and new first sweep IDs.
2. Freeze **only sorted authorized tile IDs** at tile-sweep start. Emit 4096 current authorized tuples per host tick, rechecking sight before any owner/terrain read. Newly seen IDs enter the next sweep. No historical owner state is stored in the pager.
3. On loss of **any** formerly authorized tile ID (empire withdrawal, territorial loss, sight revocation), discard the old tile sweep and begin `reset:true` at cursor 0. No formerly visible owner/border cache remains authorized across the reset.
4. Separately freeze only currently visible unit IDs at unit-sweep start and paginate at 2048 slots per host tick. Recheck each ID against **current** visible units before emission, never serialize old hidden position/strength.
5. Compute unit loss against IDs actually **sent** on this socket. Emit immediate tombstones for small revocations; a mass revocation or >131072 cached markers produces a bounded `unitReset`. Unit pagination is independent from map pagination.
6. On `unitOverflow:true`, track only the sorted first 131072 IDs as a deliberately incomplete bounded view. This is visible degradation, not proof of fully playable endgame at that unit scale.
7. On invalid current principal/tick or >32-million-tile map, fail closed.

**Time consistency:** No historical snapshot or full turn is sent. A tile page has an authoritative **emission tick** and a stable **sweep identity**. Terrain/owner values across different ticks are not an atomic world snapshot. The graphical UI must label unsent cells unknown, not backfill or invent owners. Current legal `packedTileUpdates` may update already seen cells between pages. E4 must not label a multi-tick sweep a single-tick transaction.

## E4 integration contract — REQUIRED, NOT YET IMPLEMENTED

A source-compatible receiver is provided at `src/client/NationalObserverMapContinuity.ts`:

```ts
// Create ONLY after E2's authenticated national_start; derive principal
// from the host's admitted myClientID -> public GameStartInfo mapping.
// Never derive the expected principal from nationalObserverMap.observerId.
const continuity = new NationalObserverMapContinuity(expectedPrincipal);

// For each national_projection, before any GameView mutations:
const delta = continuity.accept(projection.nationalObserverMap, projection.tick);
if (delta.clearAllTiles) {
  // E4 native map: erase all private ownership/border/last-sight overlays.
  // Retain licensed public base geography, NOT stale political state.
}
if (delta.clearAllUnits) {
  // E4 native marker cache: discard every old unit marker.
}
for (const id of delta.removedUnitIds) {
  // E4 native marker cache: delete id immediately, no position lookup.
}
for (const tuple of delta.tiles) {
  // Apply only currently authorized owner+terrain+visible-border tuple.
}
for (const unit of delta.units) {
  // Upsert this present, observed marker, no foreign strength inference.
}
if (delta.unitOverflow) {
  // Explain incomplete battlefield marker coverage to the player.
}
```

The old `materializeTrustedNationalUpdate` appends map tiles to packed updates without performing this reset or clearing private overlays. **That is a known open graphical-security blocker.** E4 owns the GameView/ClientGameRunner wiring; do not claim the guard prevents ghosts until integration is performed and verified in actual Chrome.

The receiver rejects wrong observer, malformed map metadata, duplicate/foreign troop markers, replay or backward tick, stream swap, skipped/reordered page, missing reset, forged cursor or unit reset semantics, and bounded-unit cache overflow **before** updating its private bitsets/marker cache. Each authenticated reconnect MUST instantiate a fresh receiver. A map packet is not itself an authentication token.

## Three-principal evidence and execution

`tests/national/C2PrivateObserverMapWire.test.ts` extends the existing real A/B/C host fixture, real GameRunner, `encodeNationalRecipientProjection`, `encodeServerMessage`, `decodeServerMessage`, and actual `collectLiveNationalObservation`. New checks cover:

- More than 4096 legally conquered real-map tiles swept across multiple frames with exact cursor continuity, unique refs and current sight authorization.
- Three distinct verified socket streams; attacker-derived wrong observer/stream/cursor/reset/replayed tick rejected.
- More than 2048 genuine game units, live bounded second unit page, and immediate unit sight-loss tombstones.
- A never-transmitted foreign unit ID moving out of sight: no tombstone leak.
- Authoritative empire-contributed sight followed by real contributor elimination: `reset` and removal of formerly visible ownership cache.
- Foreign strength canary, transport target fields and adversarial deletion packets remain absent/rejected.

Run on **the exact reviewed SHA**, using trusted private-repo CPU infrastructure, not a random external runner:

```bash
npm run inst
npm run typecheck
npx --no-install vitest run --project node tests/national/C2PrivateObserverMapWire.test.ts tests/national/NationalGeographicFogR8.test.ts tests/national/NationalServerOutboundClass4.test.ts
npx --no-install oxlint packages/engine/src/national/observation/NationalObserverMap.ts packages/engine/src/national/observation/NationalServerOutbound.ts src/server/national/NationalRecipientWire.ts src/client/NationalObserverMapContinuity.ts tests/national/C2PrivateObserverMapWire.test.ts
npx --no-install oxfmt --check packages/engine/src/national/observation/NationalObserverMap.ts packages/engine/src/national/observation/NationalServerOutbound.ts src/server/national/NationalRecipientWire.ts src/client/NationalObserverMapContinuity.ts tests/national/C2PrivateObserverMapWire.test.ts
```

**Resource model:** up to 4096 tile tuples and 2048 unit markers per tick, up to 2048 unit ID tombstones, up to 131072 unit IDs per bounded unit sweep, 32 million maximum map cells in the reader, and 2-million-character total JSON projection. Initial page counts are `ceil(visibleTileCount/4096)` and `ceil(min(visibleUnitCount,131072)/2048)`; sight revocation restarts tile pagination and mass unit revocation can restart unit pagination. Sorting is once per sweep; detecting current revocation is O(visible IDs) each tick. The receiver uses two 1-byte-per-tile bitsets (64 MB upper bound at 32M cells) and a bounded marker map.

**Unproven:** exact-HEAD CI/typecheck/format results until runner evidence exists; full-size 32M map performance; persistent high-churn battles without page starvation; E4 WebGL fog and unit overlays; E5 physical authenticated three-browser gameplay; E6 signed hardware attestation. Never mark these PASS based on a source PR alone.
