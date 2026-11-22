/**
 * E3 protocol guard and observer-only reconciliation cache.
 *
 * The authenticated NATIONAL start creates ONE instance bound to its expected
 * principal. Do not reuse it on a reconnect, and never use its results to
 * authorize Game commands. This is not a browser-side Game, sight registry or
 * GameSnapshot; it only tracks IDs the E2-authorized server actually sent.
 *
 * E4 MUST call accept() before applying map tiles to GameView. A clearAllTiles
 * result means the renderer must erase all prior owners/borders/fog-derived
 * private overlays before applying tiles. The map reader alone does not
 * mutate the native renderer.
 */
import {
  readTrustedNationalObserverMap,
  type TrustedNationalProjection,
} from "./TrustedNationalSession";

import {
  NATIONAL_OBSERVER_MAX_TILES,
  NATIONAL_OBSERVER_MAX_UNITS,
  NATIONAL_OBSERVER_MAX_TRACKED_UNITS,
  validNationalObserverPageProgress,
  type NationalObserverMapV1,
} from "@openfront/engine-api/game/NationalRecipientView";
import { PACKED_UNIT_TYPES } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { validateNationalObserverNativeLanes } from "@openfront/shared/NationalObserverNativeWire";

const MAX_MAP_TILES = 32_000_000;
const MAX_VISIBLE_UNIT_MARKERS = NATIONAL_OBSERVER_MAX_TRACKED_UNITS;
const MAX_UNIT_PAGE = NATIONAL_OBSERVER_MAX_UNITS;

export type NationalObserverTileStatus = "unknown" | "observed" | "revoked";

type ContinuityPage = NationalObserverMapV1;

export interface NationalObserverProjectionDelta extends NationalObserverMapDelta {
  /** Validated native packed page, with optional null sentinels restored to NaN. */
  readonly nativeUnits: Float64Array | undefined;
}

export interface NationalObserverMapDelta {
  readonly tick: number;
  readonly observerId: string;
  readonly streamId: string;
  readonly sweepId: number;
  readonly sweepComplete: boolean;
  readonly unitSweepComplete: boolean;
  readonly clearAllTiles: boolean;
  readonly clearAllUnits: boolean;
  readonly removedUnitIds: readonly number[];
  readonly removedTileRefs: readonly number[];
  readonly tilePartial: boolean;
  readonly unitPartial: boolean;
  /** At least one presently authorized tile is represented; not command authority. */
  readonly usable: boolean;
  readonly tiles: NationalObserverMapV1["tiles"];
  readonly units: NationalObserverMapV1["units"];
  /** True means the current page is part of a larger unit sweep. */
  readonly unitsTruncated: boolean;
  /** Explicit partial-fidelity state: never silently claim all units. */
  readonly unitOverflow: boolean;
}

/** Fail before any graphical state is updated. */
function pageFromWire(
  untrusted: unknown,
  tick: number,
  expectedPrincipal: string,
): ContinuityPage {
  const base = readTrustedNationalObserverMap(untrusted, tick);
  if (base === null) throw new Error("NATIONAL missing observer map");
  const raw = base as unknown as Record<string, unknown>;
  const allowedMapKeys: Record<keyof NationalObserverMapV1, true> = {
    version: true,
    tick: true,
    observerId: true,
    observerSmallId: true,
    streamId: true,
    sweepId: true,
    sweepTick: true,
    width: true,
    height: true,
    reset: true,
    cursor: true,
    nextCursor: true,
    tilePageSlots: true,
    tileRemovedRefs: true,
    tilePartial: true,
    tiles: true,
    units: true,
    unitCursor: true,
    unitNextCursor: true,
    unitSweepId: true,
    unitPageSlots: true,
    unitPartial: true,
    unitReset: true,
    unitRemovedIds: true,
    unitsTruncated: true,
    unitOverflow: true,
    visibleBorders: true,
    ownResources: true,
    countries: true,
  };
  if (
    Object.keys(raw).some(
      (key) => !Object.prototype.hasOwnProperty.call(allowedMapKeys, key),
    )
  )
    throw new Error("NATIONAL unexpected observer map field");
  const int = (v: unknown, min: number, max: number): v is number =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  if (
    base.observerId !== expectedPrincipal ||
    !int(raw.observerSmallId, 0, 0xfff) ||
    typeof raw.streamId !== "string" ||
    raw.streamId.length === 0 ||
    raw.streamId.length > 128 ||
    !int(raw.sweepId, 1, Number.MAX_SAFE_INTEGER) ||
    !int(raw.sweepTick, 0, tick) ||
    !int(raw.unitCursor, 0, MAX_MAP_TILES) ||
    !int(raw.unitSweepId, 1, Number.MAX_SAFE_INTEGER) ||
    (raw.unitNextCursor !== null &&
      (!int(raw.unitNextCursor, 0, MAX_MAP_TILES) ||
        raw.unitNextCursor <= raw.unitCursor ||
        raw.unitNextCursor - raw.unitCursor > MAX_UNIT_PAGE)) ||
    typeof raw.unitReset !== "boolean" ||
    typeof raw.unitOverflow !== "boolean" ||
    !Array.isArray(raw.unitRemovedIds) ||
    raw.unitRemovedIds.length > MAX_UNIT_PAGE ||
    raw.unitRemovedIds.some((id: unknown) => !int(id, 0, 0xffffffff)) ||
    !Array.isArray(raw.tileRemovedRefs) ||
    raw.tileRemovedRefs.length > NATIONAL_OBSERVER_MAX_TILES ||
    raw.tileRemovedRefs.some(
      (ref: unknown) => !int(ref, 0, base.width * base.height - 1),
    ) ||
    (base.reset && raw.tileRemovedRefs.length !== 0) ||
    (raw.unitReset && raw.unitRemovedIds.length > 0) ||
    !validNationalObserverPageProgress(base as unknown as ContinuityPage)
  )
    throw new Error("NATIONAL invalid observer-map continuity metadata");
  // No duplicate unit markers, no foreign troop statistics, no ambiguous
  // revocation IDs. A forged page cannot enrich what the server authorized.
  const unitIds = new Set<number>();
  for (const unit of base.units as NationalObserverMapV1["units"]) {
    if (
      unitIds.has(unit.id) ||
      unit.ownerId.length === 0 ||
      !int(unit.nativeOwnerSmallId, 0, 0xfff) ||
      !PACKED_UNIT_TYPES.includes(unit.nativeType) ||
      (unit.ownerId === expectedPrincipal &&
        unit.nativeOwnerSmallId !== raw.observerSmallId) ||
      !["army", "structure", "warship", "transport", "trade-ship"].includes(
        unit.kind,
      ) ||
      Object.keys(unit).some(
        (key) => !["id", "ownerId", "nativeOwnerSmallId", "nativeType", "kind", "tile", "troops"].includes(key),
      ) ||
      (unit.ownerId !== expectedPrincipal && unit.troops !== undefined)
    )
      throw new Error("NATIONAL invalid or private unit marker");
    unitIds.add(unit.id);
  }
  const removed = raw.unitRemovedIds as number[];
  const unique = new Set(removed);
  if (unique.size !== removed.length || removed.some((id) => unitIds.has(id)))
    throw new Error("NATIONAL ambiguous unit revocation");
  const tileRefs = new Set(base.tiles.map(([ref]) => ref));
  const removedTiles = raw.tileRemovedRefs as number[];
  if (
    removedTiles.some(
      (ref, i) => tileRefs.has(ref) || (i > 0 && ref <= removedTiles[i - 1]),
    )
  )
    throw new Error("NATIONAL ambiguous tile revocation");
  return base as unknown as ContinuityPage;
}

/**
 * One *independent* receiver per authenticated E2 socket. A stream switch is
 * rejected even with reset=true. E2/E4 must create a new receiver only after
 * a new authenticated national_start, not on an in-band attacker packet.
 */
export class NationalObserverMapContinuity {
  private streamId: string | null = null;
  private lastTick = -1;
  private sweepId = 0;
  private sweepTick = -1;
  private nextCursor: number | null = null;
  private unitSweepId = 0;
  private nextUnitCursor: number | null = null;
  private knownCount = 0;
  private lastTileRef = -1;
  private readonly seenUnitsInSweep = new Set<number>();
  private width = 0;
  private height = 0;
  /** Compact bitsets: at most 64 MB for a 32-million-tile map. */
  private known = new Uint8Array(0);
  private revoked = new Uint8Array(0);
  private readonly unitCache = new Map<
    number,
    NationalObserverMapV1["units"][number]
  >();

  constructor(
    private readonly expectedPrincipal: string,
    private readonly expectedStreamId?: string,
  ) {
    if (expectedPrincipal.length === 0 || expectedPrincipal.length > 128)
      throw new Error("NATIONAL expected authenticated principal required");
  }

  tileStatus(ref: number): NationalObserverTileStatus {
    if (!Number.isSafeInteger(ref) || ref < 0 || ref >= this.known.length)
      return "unknown";
    return this.known[ref]
      ? "observed"
      : this.revoked[ref]
        ? "revoked"
        : "unknown";
  }

  get lastAcceptedTick(): number {
    return this.lastTick;
  }

  get observedUnitCount(): number {
    return this.unitCache.size;
  }

  units(): readonly NationalObserverMapV1["units"][number][] {
    return [...this.unitCache.values()];
  }

  /** Full native path: validate every sibling lane before touching the cache. */
  acceptProjection(packet: TrustedNationalProjection): NationalObserverProjectionDelta {
    const page = pageFromWire(packet.nationalObserverMap, packet.tick, this.expectedPrincipal);
    const nativeUnits = validateNationalObserverNativeLanes(packet, page);
    return { ...this.applyPage(page), nativeUnits };
  }

  accept(untrusted: unknown, packetTick: number): NationalObserverMapDelta {
    return this.applyPage(pageFromWire(untrusted, packetTick, this.expectedPrincipal));
  }

  private applyPage(page: ContinuityPage): NationalObserverMapDelta {
    if (page.tick <= this.lastTick)
      throw new Error("NATIONAL replayed/backward observer page");
    if (
      (this.expectedStreamId !== undefined &&
        page.streamId !== this.expectedStreamId) ||
      (this.streamId !== null && page.streamId !== this.streamId)
    )
      throw new Error("NATIONAL mixed authenticated observer streams");
    if (
      this.lastTick >= 0 &&
      (page.width !== this.width || page.height !== this.height)
    )
      throw new Error("NATIONAL map dimensions changed without new start");
    if (this.lastTick < 0) {
      if (
        !page.reset ||
        !page.unitReset ||
        page.cursor !== 0 ||
        page.unitCursor !== 0 ||
        page.sweepId !== 1 ||
        page.unitSweepId !== 1 ||
        page.sweepTick !== page.tick
      )
        throw new Error("NATIONAL first observer page must reset");
    } else {
      if (page.sweepId === this.sweepId) {
        if (
          this.nextCursor === null ||
          page.cursor !== this.nextCursor ||
          page.sweepTick !== this.sweepTick
        )
          throw new Error("NATIONAL missing/out-of-order tile page");
      } else if (
        page.sweepId !== this.sweepId + 1 ||
        this.nextCursor !== null ||
        page.cursor !== 0 ||
        page.sweepTick !== page.tick
      )
        throw new Error("NATIONAL incomplete/inconsistent map sweep");
      if (page.unitSweepId === this.unitSweepId) {
        if (
          this.nextUnitCursor === null ||
          page.unitCursor !== this.nextUnitCursor
        )
          throw new Error("NATIONAL missing/out-of-order unit page");
      } else if (
        page.unitSweepId !== this.unitSweepId + 1 ||
        this.nextUnitCursor !== null ||
        page.unitCursor !== 0
      )
        throw new Error("NATIONAL incomplete/inconsistent unit sweep");
    }
    if (
      page.sweepId === this.sweepId &&
      page.tiles.length > 0 &&
      page.tiles[0][0] <= this.lastTileRef
    )
      throw new Error("NATIONAL duplicate/backward tile in frozen sweep");
    if (
      page.unitSweepId === this.unitSweepId &&
      page.units.some((unit) => this.seenUnitsInSweep.has(unit.id))
    )
      throw new Error("NATIONAL duplicate unit in frozen sweep");
    // Tombstones are valid only for currently disclosed cache entries.
    if (
      page.tileRemovedRefs.some((ref) => this.known[ref] !== 1) ||
      page.unitRemovedIds.some((id) => !this.unitCache.has(id))
    )
      throw new Error("NATIONAL undisclosed revocation");
    // Calculate the projected size BEFORE mutating the cache, so oversized
    // hostile packets never partially apply.
    let projectedUnitCount = page.unitReset ? 0 : this.unitCache.size;
    if (!page.unitReset) {
      for (const id of page.unitRemovedIds) {
        if (this.unitCache.has(id)) projectedUnitCount--;
      }
    }
    for (const unit of page.units) {
      if (
        page.unitReset ||
        !this.unitCache.has(unit.id) ||
        page.unitRemovedIds.includes(unit.id)
      )
        projectedUnitCount++;
    }
    if (projectedUnitCount > MAX_VISIBLE_UNIT_MARKERS)
      throw new Error("NATIONAL observer unit cache exceeded bounded limit");

    if (this.lastTick < 0) {
      const count = page.width * page.height;
      this.known = new Uint8Array(count);
      this.revoked = new Uint8Array(count);
      this.width = page.width;
      this.height = page.height;
    }
    if (page.reset) {
      for (let ref = 0; ref < this.known.length; ref++) {
        if (this.known[ref]) this.revoked[ref] = 1;
      }
      this.known.fill(0);
      this.knownCount = 0;
    } else {
      for (const ref of page.tileRemovedRefs) {
        this.known[ref] = 0;
        this.revoked[ref] = 1;
        this.knownCount--;
      }
    }
    if (page.unitReset) this.unitCache.clear();
    else for (const id of page.unitRemovedIds) this.unitCache.delete(id);
    for (const unit of page.units) this.unitCache.set(unit.id, unit);
    for (const tile of page.tiles) {
      if (!this.known[tile[0]]) this.knownCount++;
      this.known[tile[0]] = 1;
      this.revoked[tile[0]] = 0;
    }
    if (page.sweepId !== this.sweepId) this.lastTileRef = -1;
    if (page.tiles.length > 0)
      this.lastTileRef = page.tiles[page.tiles.length - 1][0];
    if (page.unitSweepId !== this.unitSweepId) this.seenUnitsInSweep.clear();
    for (const unit of page.units) this.seenUnitsInSweep.add(unit.id);
    this.streamId = page.streamId;
    this.lastTick = page.tick;
    this.sweepId = page.sweepId;
    this.sweepTick = page.sweepTick;
    this.nextCursor = page.nextCursor;
    this.unitSweepId = page.unitSweepId;
    this.nextUnitCursor = page.unitNextCursor;
    return {
      tick: page.tick,
      observerId: page.observerId,
      streamId: page.streamId,
      sweepId: page.sweepId,
      sweepComplete: page.nextCursor === null,
      unitSweepComplete: page.unitNextCursor === null,
      clearAllTiles: page.reset,
      clearAllUnits: page.unitReset,
      removedUnitIds: [...page.unitRemovedIds],
      removedTileRefs: [...page.tileRemovedRefs],
      tilePartial: page.tilePartial,
      unitPartial: page.unitPartial,
      usable: this.knownCount > 0,
      tiles: page.tiles,
      units: page.units,
      unitsTruncated: page.unitsTruncated,
      unitOverflow: page.unitOverflow,
    };
  }
}
