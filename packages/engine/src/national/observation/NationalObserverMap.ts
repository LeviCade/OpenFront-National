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
  readonly unitsTruncated: boolean;
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

/** Only one instance per original authenticated E2 socket; no global cursor. */
export class NationalObserverMapPager {
  private readonly game: Game;
  private readonly principalId: string;
  private previousVisible: ReadonlySet<number> | null = null;
  private cursor = 0;
  private resetPending = true;

  constructor(game: Game, principalId: string) {
    this.game = game;
    this.principalId = principalId;
  }

  close(): void {
    this.previousVisible = null;
    this.cursor = 0;
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
    if (this.previousVisible !== null) {
      for (const former of this.previousVisible) {
        if (!visible.has(former)) {
          // On any revocation, replace the entire recipient map cache.
          // Do not disclose the former tile position as a private deletion.
          this.cursor = 0;
          this.resetPending = true;
          break;
        }
      }
    }
    const ordered = [...visible]
      .filter((tile) => this.game.map().isValidRef(tile))
      .sort((a, b) => a - b);
    this.previousVisible = new Set(ordered);
    if (this.cursor >= ordered.length) this.cursor = 0;
    const cursor = this.cursor;
    const refs = ordered.slice(cursor, cursor + NATIONAL_OBSERVER_MAX_TILES);
    const map = this.game.map();
    const neighbors = new Array<number>(4);
    const tiles: NationalVisibleTileV1[] = refs.map((ref) => {
      const count = map.neighbors4(ref, neighbors);
      const owner = map.ownerID(ref);
      const x = map.x(ref);
      const y = map.y(ref);
      let mask = 0;
      for (let i = 0; i < count; i++) {
        const other = neighbors[i];
        if (!visible.has(other) || owner === map.ownerID(other)) continue;
        // neighbors4 compresses missing edge neighbors; use actual geometry
        // instead of assuming each returned index still means N/S/W/E.
        const dx = map.x(other) - x;
        const dy = map.y(other) - y;
        mask |= dy === -1 ? 1 : dy === 1 ? 2 : dx === -1 ? 4 : 8;
      }
      return [ref, map.tileState(ref), map.terrainByte(ref), mask];
    });
    const next = cursor + refs.length;
    this.cursor = next >= ordered.length ? 0 : next;
    const assets = [...verified.observation.visibleAssets].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const units: NationalVisibleUnitV1[] = assets
      .slice(0, NATIONAL_OBSERVER_MAX_UNITS)
      .filter(
        (asset) =>
          map.isValidCoord(asset.x, asset.y) &&
          visible.has(map.ref(asset.x, asset.y)),
      )
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
    const nations = verified.observation.nations;
    const countries = nations.map((nation: PublicNation) => ({
      id: nation.id,
      name: nation.name,
      alive: nation.alive,
      landPercent: nation.landPercent,
      status: nation.status,
    }));
    const reset = this.resetPending;
    this.resetPending = false;
    return {
      version: NATIONAL_OBSERVER_MAP_VERSION,
      tick: this.game.ticks(),
      observerId: this.principalId,
      width: map.width(),
      height: map.height(),
      reset,
      cursor,
      nextCursor: next >= ordered.length ? null : next,
      tiles,
      units,
      unitsTruncated: assets.length > NATIONAL_OBSERVER_MAX_UNITS,
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
