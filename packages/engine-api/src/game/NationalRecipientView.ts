/** Public recipient-only NATIONAL protocol. No simulation internals. */
import type { TileRef } from "./GameMap";
import type { UnitType } from "./GameTypes";

export type SovereignStatus =
  | "independent"
  | "imperial"
  | "member"
  | "eliminated";
export type AssetKind =
  | "army"
  | "structure"
  | "warship"
  | "transport"
  | "trade-ship";

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
  /** Native page lane identity, not a separate source of authorization. */
  readonly nativeOwnerSmallId: number;
  readonly nativeType: UnitType;
  readonly kind: AssetKind;
  readonly tile: TileRef;
  /** Own troops only; never enemy troop, transport load or landing target. */
  readonly troops?: number;
}

export interface NationalObserverMapV1 {
  readonly version: typeof NATIONAL_OBSERVER_MAP_VERSION;
  readonly tick: number;
  readonly observerId: string;
  readonly observerSmallId: number;
  /** Server-issued original-socket nonce, NOT an authorization credential. */
  readonly streamId: string;
  /** Monotonically increasing tile sweep sequence local to this stream. */
  readonly sweepId: number;
  /** Authoritative tick when the membership of this sweep was frozen. */
  readonly sweepTick: number;
  readonly width: number;
  readonly height: number;
  /** Clear previous tile caches before applying this page, without rewinding the sweep. */
  readonly reset: boolean;
  /** Offset in frozen authorized membership slots. Never client chosen. */
  readonly cursor: number;
  /** Null completes frozen membership traversal, not necessarily current sight. */
  readonly nextCursor: number | null;
  /** Consumed membership slots, including IDs revoked before emission. */
  readonly tilePageSlots: number;
  /** Aggregate authorized membership at sweep start; no undisclosed IDs. */
  readonly tileSweepSlots: number;
  /** Previously disclosed refs only; clear ownership and border overlays first. */
  readonly tileRemovedRefs: readonly number[];
  /** True if some presently authorized tuples are not represented in the cache. */
  readonly tilePartial: boolean;
  readonly tiles: readonly NationalVisibleTileV1[];
  /** Current sightings, not E1 sight-memory or hidden enemy asset catalog. */
  readonly units: readonly NationalVisibleUnitV1[];
  /** Server-only unit page offset and end marker; never from a browser. */
  readonly unitCursor: number;
  readonly unitNextCursor: number | null;
  readonly unitSweepId: number;
  readonly unitPageSlots: number;
  /** Aggregate bounded authorized membership at unit sweep start. */
  readonly unitSweepSlots: number;
  /** True if some presently authorized markers are not represented in the cache. */
  readonly unitPartial: boolean;
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

/** Safe, detached WAR projection for E4. Never forward raw WAR/LEVY snapshots.
 * E2 owns the engine-api typed wire schema. Pending diplomacy is only visible
 * to current participants, while WAR declarations/cessations are public. */
export interface NationalPublicConflictView {
  readonly version: 1;
  /** Empty for spectators, never interpreted as an authenticated principal. */
  readonly recipientId: string;
  readonly layers: readonly {
    readonly id: string;
    readonly scope: "national" | "imperial";
    readonly first: { readonly kind: "nation" | "empire"; readonly id: string };
    readonly second: {
      readonly kind: "nation" | "empire";
      readonly id: string;
    };
    readonly declaredBy: string;
    readonly startedTick: number;
    readonly endedTick: number | null;
  }[];
  readonly motions: readonly {
    readonly id: string;
    readonly layerId: string;
    readonly proposedBy: string;
    readonly proposingSide: 0 | 1;
    readonly proposedTick: number;
    readonly acceptedTick: number | null;
    readonly acceptedBy: string | null;
  }[];
}

/** Shared structural continuity checks; the receiver additionally checks history. */
export function validNationalObserverPageProgress(
  page: Pick<
    NationalObserverMapV1,
    | "cursor"
    | "nextCursor"
    | "tilePageSlots"
    | "tileSweepSlots"
    | "tiles"
    | "unitCursor"
    | "unitNextCursor"
    | "unitPageSlots"
    | "unitSweepSlots"
    | "units"
    | "width"
    | "height"
    | "tilePartial"
    | "unitPartial"
    | "unitOverflow"
  >,
): boolean {
  const valid = (
    cursor: number,
    next: number | null,
    slots: number,
    emitted: number,
    limit: number,
    total: number,
    ceiling: number,
  ): boolean =>
    Number.isSafeInteger(total) &&
    total >= 0 &&
    total <= ceiling &&
    Number.isSafeInteger(cursor) &&
    cursor >= 0 &&
    cursor <= total &&
    Number.isSafeInteger(slots) &&
    slots >= emitted &&
    slots <= limit &&
    cursor + slots <= total &&
    (cursor === 0 || slots > 0) &&
    (next === null
      ? cursor + slots === total
      : slots === limit && next === cursor + slots && next < total);
  return (
    typeof page.tilePartial === "boolean" &&
    typeof page.unitPartial === "boolean" &&
    (!page.unitOverflow || page.unitPartial) &&
    valid(
      page.cursor,
      page.nextCursor,
      page.tilePageSlots,
      page.tiles.length,
      NATIONAL_OBSERVER_MAX_TILES,
      page.tileSweepSlots,
      page.width * page.height,
    ) &&
    valid(
      page.unitCursor,
      page.unitNextCursor,
      page.unitPageSlots,
      page.units.length,
      NATIONAL_OBSERVER_MAX_UNITS,
      page.unitSweepSlots,
      NATIONAL_OBSERVER_MAX_TRACKED_UNITS,
    )
  );
}
