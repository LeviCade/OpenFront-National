/**
 * C2 / E3 NATIONAL authenticated observer map v1.
 *
 * Source is ONLY the current server-owned Game and E1's verified geographic
 * observation. This is not a client-selected tile/observer lookup and must
 * never be used to serialize the Game, its GameSnapshot or canonical turns.
 *
 * A browser reconstructs its own permitted map from bounded successive
 * pages. Any loss of sight (including empire separation) sends reset=true
 * BEFORE the next page; stale ownership/units must be deleted by the client.
 */
import type { TileRef } from "@openfront/engine-api/game/GameMap";
import type { Game } from "../../game/Game";
import type { LiveNationalObservation } from "./LiveObservation";
import type {
  AssetKind,
  PublicNation,
  SovereignStatus,
} from "./NationalObservation";

export const NATIONAL_OBSERVER_MAP_VERSION = 1 as const;
/** 4 integers per tile, 4096 tiles: bounded per-recipient initial sync. */
export const NATIONAL_OBSERVER_MAX_TILES = 4096;
/** Full currently-visible unit markers; flag if too many to fit one frame. */
export const NATIONAL_OBSERVER_MAX_UNITS = 2048;
/** Explicit producer/receiver memory ceiling: overflow must be visible. */
export const NATIONAL_OBSERVER_MAX_TRACKED_UNITS = 131_072;

/** All owner+terrain fields refer to THIS principal's currently visible tile.
 * The final uint mask has N=1, S=2, W=4, E=8, only when both tiles are visible
 * and their authoritative current ownerID values differ.
 */
export type NationalVisibleTileV1 = readonly [
  tileRef: number,
  packedState: number,
  terrainByte: number,
  visibleBorderMask: number,
];

export interface NationalVisibleUnitV1 {
  readonly id: number;
  readonly ownerId: string;
  readonly kind: AssetKind;
  readonly tile: TileRef;
  /** Own troops only; never enemy troop, transport load or landing target. */
  readonly troops?: number;
}

export interface NationalObserverMapV1 {
  readonly version: typeof NATIONAL_OBSERVER_MAP_VERSION;
  readonly tick: number;
  readonly observerId: string;
  /** Server-issued original-socket nonce, NOT an authorization credential. */
  readonly streamId: string;
  /** Monotonically increasing tile sweep sequence local to this stream. */
  readonly sweepId: number;
  /** Authoritative tick when the membership of this sweep was frozen. */
  readonly sweepTick: number;
  readonly width: number;
  readonly height: number;
  /** All previous E4-owned map/visibility/unit caches must be discarded. */
  readonly reset: boolean;
  /** Offset in sorted CURRENT authorized visible tiles. Never client chosen. */
  readonly cursor: number;
  /** Null means a complete current-sight map sweep. */
  readonly nextCursor: number | null;
  readonly tiles: readonly NationalVisibleTileV1[];
  /** Current sightings, not E1 sight-memory or hidden enemy asset catalog. */
  readonly units: readonly NationalVisibleUnitV1[];
  /** Server-only unit page offset and end marker; never from a browser. */
  readonly unitCursor: number;
  readonly unitNextCursor: number | null;
  readonly unitSweepId: number;
  /** Discard all prior unit markers before adding this page. */
  readonly unitReset: boolean;
  /** Immediately delete these formerly sighted IDs, without their coordinates. */
  readonly unitRemovedIds: readonly number[];
  readonly unitsTruncated: boolean;
  /** More currently visible units than can be tracked in bounded memory. */
  readonly unitOverflow: boolean;
  readonly visibleBorders: readonly {
    readonly targetId: string;
    readonly access: "land" | "naval";
  }[];
  readonly ownResources: { readonly troops: number; readonly treasury: number };
  readonly countries: readonly {
    readonly id: string;
    readonly name: string;
    readonly alive: boolean;
    readonly landPercent: number;
    readonly status: SovereignStatus;
  }[];
}

/**
 * One pager per original authenticated socket.
 *
 * Tile and unit membership for each sweep is frozen as a list of ID numbers,
 * NOT as past owner/terrain/unit state. Every emitted item is rechecked against
 * current sight, and its data is read from the current Game. A removed tile
 * invalidates the entire private tile cache. A lost unit ID is deleted
 * immediately even while another unit page is in flight.
 *
 * A sweep is a bounded, temporally annotated sequence, not an atomic Game
 * snapshot. Consumers must never promote an omitted page to known ownership.
 */
export class NationalObserverMapPager {
  private previousVisible: ReadonlySet<number> | null = null;
  /** Only IDs actually disclosed on this socket may ever be tombstoned. */
  private readonly emittedUnitIds = new Set<number>();
  private tileRefs: readonly number[] = [];
  private cursor = 0;
  private sweepId = 0;
  private sweepTick = 0;
  private unitIds: readonly number[] = [];
  private unitCursor = 0;
  private unitSweepId = 0;
  private resetPending = true;

  constructor(
    private readonly game: Game,
    private readonly principalId: string,
    private readonly streamId: string,
  ) {
    if (
      typeof streamId !== "string" ||
      streamId.length < 1 ||
      streamId.length > 128
    ) {
      throw new Error("NATIONAL observer-map requires server socket nonce");
    }
  }

  close(): void {
    this.previousVisible = null;
    this.emittedUnitIds.clear();
    this.tileRefs = [];
    this.cursor = 0;
    this.unitIds = [];
    this.unitCursor = 0;
    this.resetPending = true;
  }

  page(verified: LiveNationalObservation): NationalObserverMapV1 {
    if (
      verified.observation.observerId !== this.principalId ||
      verified.observation.tick !== this.game.ticks()
    ) {
      throw new Error("NATIONAL observer-map principal/tick mismatch");
    }
    const visible = verified.visibleTiles;
    const map = this.game.map();
    if (map.width() * map.height() > 32_000_000 || visible.size > 32_000_000) {
      throw new Error("NATIONAL observer-map exceeds bounded world limit");
    }
    if (this.previousVisible !== null) {
      for (const former of this.previousVisible) {
        if (!visible.has(former)) {
          // Never retain even one formerly authorized owner/border tile.
          this.resetPending = true;
          break;
        }
      }
    }
    // The verified sight set was freshly derived for this tick by E1.
    // Tracking its membership is O(visible); do not sort all visible tiles
    // each tick merely to send a 4096-tile page.
    this.previousVisible = visible;
    const reset = this.resetPending;
    if (reset) {
      this.cursor = 0;
      this.tileRefs = [];
    }
    if (this.cursor === 0) {
      // The ID list is fixed until completion, but tile contents are live.
      // Newly visible tiles join the next sweep, never an arbitrary offset.
      this.tileRefs = [...visible]
        .filter((tile) => map.isValidRef(tile))
        .sort((a, b) => a - b);
      this.sweepId += 1;
      this.sweepTick = this.game.ticks();
    }
    const cursor = this.cursor;
    const refs = this.tileRefs.slice(
      cursor,
      cursor + NATIONAL_OBSERVER_MAX_TILES,
    );
    const neighbors = new Array<number>(4);
    const tiles: NationalVisibleTileV1[] = refs
      .filter((ref) => visible.has(ref))
      .map((ref) => {
        const count = map.neighbors4(ref, neighbors);
        const owner = map.ownerID(ref);
        const x = map.x(ref);
        const y = map.y(ref);
        let mask = 0;
        for (let i = 0; i < count; i++) {
          const other = neighbors[i];
          if (!visible.has(other) || owner === map.ownerID(other)) continue;
          const dx = map.x(other) - x;
          const dy = map.y(other) - y;
          mask |= dy === -1 ? 1 : dy === 1 ? 2 : dx === -1 ? 4 : 8;
        }
        return [ref, map.tileState(ref), map.terrainByte(ref), mask];
      });
    const next = cursor + refs.length;
    const nextCursor = next >= this.tileRefs.length ? null : next;
    this.cursor = nextCursor ?? 0;

    // Filter before slicing! The old implementation sliced the first 2048
    // candidates and could silently omit authorized later units forever.
    const currentUnits = new Map(
      verified.observation.visibleAssets
        .filter(
          (asset) =>
            Number.isSafeInteger(Number(asset.id)) &&
            Number(asset.id) >= 0 &&
            Number(asset.id) <= 0xffffffff &&
            map.isValidCoord(asset.x, asset.y) &&
            visible.has(map.ref(asset.x, asset.y)),
        )
        .map((asset) => [Number(asset.id), asset] as const),
    );
    const nowIds = new Set(currentUnits.keys());
    const removed: number[] = [];
    // Never reveal the ID of a previously authorized but NEVER transmitted
    // unit. This avoids a historical intelligence leak via tombstone pages.
    for (const id of this.emittedUnitIds) {
      if (!nowIds.has(id)) removed.push(id);
    }
    removed.sort((a, b) => a - b);
    // Mass revocation or an oversized long-lived unit cache is signaled by
    // an atomic unit-only reset rather than an unbounded deletion packet.
    const unitReset =
      reset ||
      removed.length > NATIONAL_OBSERVER_MAX_UNITS ||
      this.emittedUnitIds.size > NATIONAL_OBSERVER_MAX_TRACKED_UNITS;
    if (unitReset) {
      this.emittedUnitIds.clear();
      this.unitCursor = 0;
      this.unitIds = [];
    } else {
      for (const id of removed) this.emittedUnitIds.delete(id);
    }
    if (this.unitCursor === 0) {
      this.unitIds = [...nowIds]
        .sort((a, b) => a - b)
        .slice(0, NATIONAL_OBSERVER_MAX_TRACKED_UNITS);
      this.unitSweepId += 1;
    }
    const unitCursor = this.unitCursor;
    const unitPageIds = this.unitIds.slice(
      unitCursor,
      unitCursor + NATIONAL_OBSERVER_MAX_UNITS,
    );
    const units: NationalVisibleUnitV1[] = unitPageIds
      .map((id) => currentUnits.get(id))
      .filter((asset) => asset !== undefined)
      .map((asset) => ({
        id: Number(asset.id),
        ownerId: asset.ownerId,
        kind: asset.kind,
        tile: map.ref(asset.x, asset.y),
        ...(asset.ownerId === this.principalId &&
        asset.strength !== undefined &&
        Number.isFinite(asset.strength)
          ? { troops: asset.strength }
          : {}),
      }));
    for (const unit of units) this.emittedUnitIds.add(unit.id);
    const unitNext = unitCursor + unitPageIds.length;
    const unitNextCursor =
      unitNext >= this.unitIds.length ? null : unitNext;
    this.unitCursor = unitNextCursor ?? 0;
    this.resetPending = false;
    const countries = verified.observation.nations.map(
      (nation: PublicNation) => ({
        id: nation.id,
        name: nation.name,
        alive: nation.alive,
        landPercent: nation.landPercent,
        status: nation.status,
      }),
    );
    return {
      version: NATIONAL_OBSERVER_MAP_VERSION,
      tick: this.game.ticks(),
      observerId: this.principalId,
      streamId: this.streamId,
      sweepId: this.sweepId,
      sweepTick: this.sweepTick,
      width: map.width(),
      height: map.height(),
      reset,
      cursor,
      nextCursor,
      tiles,
      units,
      unitCursor,
      unitNextCursor,
      unitSweepId: this.unitSweepId,
      unitReset,
      unitRemovedIds: unitReset ? [] : removed,
      unitsTruncated: nowIds.size > NATIONAL_OBSERVER_MAX_UNITS,
      unitOverflow: nowIds.size > NATIONAL_OBSERVER_MAX_TRACKED_UNITS,
      visibleBorders: verified.observation.frontiers.map((frontier) => ({
        targetId: frontier.targetId,
        access: frontier.access,
      })),
      ownResources: {
        troops: verified.observation.ownResources.troops,
        treasury: verified.observation.ownResources.treasury,
      },
      countries,
    };
  }
}
