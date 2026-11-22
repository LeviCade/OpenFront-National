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
  type TrustedNationalObserverMap,
} from "./TrustedNationalSession";

const MAX_MAP_TILES = 32_000_000;
const MAX_VISIBLE_UNIT_MARKERS = 131_072;
const MAX_UNIT_PAGE = 2048;

export type NationalObserverTileStatus = "unknown" | "observed" | "revoked";

interface ContinuityPage extends TrustedNationalObserverMap {
  readonly streamId: string;
  readonly sweepId: number;
  readonly sweepTick: number;
  readonly unitCursor: number;
  readonly unitNextCursor: number | null;
  readonly unitSweepId: number;
  readonly unitReset: boolean;
  readonly unitRemovedIds: readonly number[];
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
  readonly tiles: TrustedNationalObserverMap["tiles"];
  readonly units: TrustedNationalObserverMap["units"];
  /** True means the current page is part of a larger unit sweep. */
  readonly unitsTruncated: boolean;
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
  const int = (v: unknown, min: number, max: number): v is number =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  if (
    base.observerId !== expectedPrincipal ||
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
    !Array.isArray(raw.unitRemovedIds) ||
    raw.unitRemovedIds.length > MAX_UNIT_PAGE ||
    raw.unitRemovedIds.some(
      (id: unknown) => !int(id, 0, 0xffffffff),
    ) ||
    (base.reset && (base.cursor !== 0 || raw.unitReset !== true)) ||
    (raw.unitReset && (raw.unitCursor !== 0 || raw.unitRemovedIds.length > 0)) ||
    (base.nextCursor !== null &&
      base.nextCursor !== base.cursor + base.tiles.length)
  )
    throw new Error("NATIONAL invalid observer-map continuity metadata");
  // No duplicate unit markers, no foreign troop statistics, no ambiguous
  // revocation IDs. A forged page cannot enrich what the server authorized.
  const unitIds = new Set<number>();
  for (const unit of base.units) {
    if (
      unitIds.has(unit.id) ||
      (unit.ownerId !== expectedPrincipal && unit.troops !== undefined)
    )
      throw new Error("NATIONAL invalid or private unit marker");
    unitIds.add(unit.id);
  }
  const removed = raw.unitRemovedIds as number[];
  const unique = new Set(removed);
  if (unique.size !== removed.length || removed.some((id) => unitIds.has(id)))
    throw new Error("NATIONAL ambiguous unit revocation");
  return base as ContinuityPage;
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
  private width = 0;
  private height = 0;
  /** Compact bitsets: at most 64 MB for a 32-million-tile map. */
  private known = new Uint8Array(0);
  private revoked = new Uint8Array(0);
  private readonly unitCache = new Map<
    number,
    TrustedNationalObserverMap["units"][number]
  >();

  constructor(private readonly expectedPrincipal: string) {
    if (
      expectedPrincipal.length === 0 ||
      expectedPrincipal.length > 128
    )
      throw new Error("NATIONAL expected authenticated principal required");
  }

  tileStatus(ref: number): NationalObserverTileStatus {
    if (!Number.isSafeInteger(ref) || ref < 0 || ref >= this.known.length)
      return "unknown";
    return this.known[ref] ? "observed" : this.revoked[ref] ? "revoked" : "unknown";
  }

  get lastAcceptedTick(): number {
    return this.lastTick;
  }

  get observedUnitCount(): number {
    return this.unitCache.size;
  }

  units(): readonly TrustedNationalObserverMap["units"][number][] {
    return [...this.unitCache.values()];
  }

  accept(untrusted: unknown, packetTick: number): NationalObserverMapDelta {
    const page = pageFromWire(
      untrusted,
      packetTick,
      this.expectedPrincipal,
    );
    if (page.tick <= this.lastTick)
      throw new Error("NATIONAL replayed/backward observer page");
    if (this.streamId !== null && page.streamId !== this.streamId)
      throw new Error("NATIONAL mixed authenticated observer streams");
    if (
      this.lastTick >= 0 &&
      (page.width !== this.width || page.height !== this.height)
    )
      throw new Error("NATIONAL map dimensions changed without new start");
    if (this.lastTick < 0 && !page.reset)
      throw new Error("NATIONAL first observer page must reset");
    if (!page.reset && this.lastTick >= 0) {
      if (page.sweepId === this.sweepId) {
        if (
          this.nextCursor === null ||
          page.cursor !== this.nextCursor ||
          page.sweepTick !== this.sweepTick
        )
          throw new Error("NATIONAL missing/out-of-order tile page");
      } else if (
        page.sweepId <= this.sweepId ||
        this.nextCursor !== null ||
        page.cursor !== 0 ||
        page.sweepTick !== page.tick
      ) {
        throw new Error("NATIONAL incomplete/inconsistent map sweep");
      }
    } else if (
      page.cursor !== 0 ||
      page.sweepTick !== page.tick ||
      (this.lastTick >= 0 && page.sweepId <= this.sweepId)
    ) {
      throw new Error("NATIONAL invalid tile sweep reset");
    }

    if (!page.unitReset && this.lastTick >= 0) {
      if (page.unitSweepId === this.unitSweepId) {
        if (
          this.nextUnitCursor === null ||
          page.unitCursor !== this.nextUnitCursor
        )
          throw new Error("NATIONAL missing/out-of-order unit page");
      } else if (
        page.unitSweepId <= this.unitSweepId ||
        this.nextUnitCursor !== null ||
        page.unitCursor !== 0
      ) {
        throw new Error("NATIONAL incomplete/inconsistent unit sweep");
      }
    } else if (
      page.unitCursor !== 0 ||
      (this.lastTick >= 0 && page.unitSweepId <= this.unitSweepId)
    ) {
      throw new Error("NATIONAL invalid unit sweep reset");
    }

    // Calculate the projected size BEFORE mutating the cache, so oversized
    // hostile packets never partially apply.
    let projectedUnitCount =
      page.unitReset ? 0 : this.unitCache.size;
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
      this.revoked.set(this.known);
      this.known.fill(0);
    }
    if (page.unitReset) this.unitCache.clear();
    else for (const id of page.unitRemovedIds) this.unitCache.delete(id);
    for (const unit of page.units) this.unitCache.set(unit.id, unit);
    for (const tile of page.tiles) {
      this.known[tile[0]] = 1;
      this.revoked[tile[0]] = 0;
    }
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
      tiles: page.tiles,
      units: page.units,
      unitsTruncated: page.unitsTruncated,
    };
  }
}
