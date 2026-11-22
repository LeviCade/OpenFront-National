/**
 * C2 / E3 NATIONAL authenticated observer map v1.
 *
 * Source is ONLY the current server-owned Game and E1's verified geographic
 * observation. This is not a client-selected tile/observer lookup and must
 * never be used to serialize the Game, its GameSnapshot or canonical turns.
 *
 * A browser reconstructs its own permitted map from bounded successive
 * pages. Revocation invalidates disclosed facts independently of cursor progress.
 * Mass revocation clears the affected cache, not the traversal.
 */
import {
  NATIONAL_OBSERVER_MAP_VERSION,
  NATIONAL_OBSERVER_MAX_TILES,
  NATIONAL_OBSERVER_MAX_TRACKED_UNITS,
  NATIONAL_OBSERVER_MAX_UNITS,
  type NationalObserverMapV1,
  type NationalVisibleTileV1,
  type NationalVisibleUnitV1,
} from "@openfront/engine-api/game/NationalRecipientView";
import type { Game } from "../../game/Game";
import type { LiveNationalObservation } from "./LiveObservation";
import type { PublicNation } from "./NationalObservation";

export {
  NATIONAL_OBSERVER_MAP_VERSION,
  NATIONAL_OBSERVER_MAX_TILES,
  NATIONAL_OBSERVER_MAX_TRACKED_UNITS,
  NATIONAL_OBSERVER_MAX_UNITS,
  type NationalObserverMapV1,
  type NationalVisibleTileV1,
  type NationalVisibleUnitV1,
} from "@openfront/engine-api/game/NationalRecipientView";

/**
 * One pager per original authenticated socket.
 *
 * Tile and unit membership for each sweep is frozen as a list of ID numbers,
 * NOT as past owner/terrain/unit state. Every emitted item is rechecked against
 * current sight, and its data is read from the current Game. Disclosed stale
 * facts are removed immediately; no never-disclosed ID is tombstoned.
 *
 * A sweep is a bounded, temporally annotated sequence, not an atomic Game
 * snapshot. Consumers must never promote an omitted page to known ownership.
 */
export class NationalObserverMapPager {
  /** Only disclosed facts may be invalidated. Signatures include borders. */
  private readonly emittedTiles = new Map<number, number>();
  private readonly emittedUnits = new Map<
    number,
    {
      marker: NationalVisibleUnitV1;
      sharedStrength: number | undefined;
    }
  >();
  private unitWindowAnchor = -1;
  private tileRefs: readonly number[] = [];
  private cursor = 0;
  private sweepId = 0;
  private sweepTick = 0;
  private unitIds: readonly number[] = [];
  private unitCursor = 0;
  private unitSweepId = 0;
  private resetPending = true;
  private closed = false;

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
    this.closed = true;
    this.emittedTiles.clear();
    this.emittedUnits.clear();
    this.unitWindowAnchor = -1;
    this.tileRefs = [];
    this.cursor = 0;
    this.unitIds = [];
    this.unitCursor = 0;
    this.resetPending = true;
  }

  page(verified: LiveNationalObservation): NationalObserverMapV1 {
    if (
      this.closed ||
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
    const first = this.resetPending;
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
    const signatureAt = (ref: number): number => {
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
      return map.tileState(ref) | (map.terrainByte(ref) << 16) | (mask << 24);
    };
    const signature = (tile: NationalVisibleTileV1): number =>
      tile[1] | (tile[2] << 16) | (tile[3] << 24);
    const tiles: NationalVisibleTileV1[] = refs
      .filter((ref) => visible.has(ref))
      .map((ref) => {
        const bits = signatureAt(ref);
        return [ref, bits & 0xffff, (bits >>> 16) & 0xff, bits >>> 24];
      });
    const pageRefs = new Set(tiles.map(([ref]) => ref));
    const tileRemovedRefs: number[] = [];
    for (const [ref, prior] of this.emittedTiles) {
      if (pageRefs.has(ref)) continue;
      // Never read owner/terrain of a now-hidden cell. A still-visible cell
      // whose tuple changed is also invalidated unless refreshed in this page.
      if (!visible.has(ref) || signatureAt(ref) !== prior) {
        tileRemovedRefs.push(ref);
        if (tileRemovedRefs.length > NATIONAL_OBSERVER_MAX_TILES) break;
      }
    }
    const reset = first || tileRemovedRefs.length > NATIONAL_OBSERVER_MAX_TILES;
    if (reset) {
      this.emittedTiles.clear();
      tileRemovedRefs.length = 0;
    } else {
      tileRemovedRefs.sort((a, b) => a - b);
      for (const ref of tileRemovedRefs) this.emittedTiles.delete(ref);
    }
    for (const tile of tiles) this.emittedTiles.set(tile[0], signature(tile));
    const next = cursor + refs.length;
    const nextCursor = next >= this.tileRefs.length ? null : next;
    this.cursor = nextCursor ?? 0;

    // Filter before slicing! The old implementation sliced the first 2048
    // candidates and could silently omit authorized later units forever.
    const currentUnits = new Map<
      number,
      LiveNationalObservation["observation"]["visibleAssets"][number]
    >();
    for (const asset of verified.observation.visibleAssets) {
      const id = Number(asset.id);
      if (
        Number.isSafeInteger(id) &&
        id >= 0 &&
        id <= 0xffffffff &&
        map.isValidCoord(asset.x, asset.y) &&
        visible.has(map.ref(asset.x, asset.y))
      )
        currentUnits.set(id, asset);
    }
    if (this.unitCursor === 0) {
      const sorted = [...currentUnits.keys()].sort((a, b) => a - b);
      if (sorted.length > NATIONAL_OBSERVER_MAX_TRACKED_UNITS) {
        // Rotate the bounded window instead of permanently excluding high IDs.
        let offset = sorted.findIndex((id) => id > this.unitWindowAnchor);
        if (offset < 0) offset = 0;
        let window = sorted.slice(
          offset,
          offset + NATIONAL_OBSERVER_MAX_TRACKED_UNITS,
        );
        if (window.length < NATIONAL_OBSERVER_MAX_TRACKED_UNITS)
          window = window.concat(
            sorted.slice(
              0,
              NATIONAL_OBSERVER_MAX_TRACKED_UNITS - window.length,
            ),
          );
        this.unitWindowAnchor = window[window.length - 1];
        this.unitIds = window.sort((a, b) => a - b);
      } else {
        this.unitWindowAnchor = -1;
        this.unitIds = sorted;
      }
      // Give currently unrepresented IDs the earliest slots of the next
      // sweep. Stable covered IDs still have one slot in every finite sweep.
      const missing: number[] = [];
      const represented: number[] = [];
      for (const id of this.unitIds) {
        (this.emittedUnits.has(id) ? represented : missing).push(id);
      }
      this.unitIds = missing.concat(represented);
      this.unitSweepId += 1;
    }
    const unitCursor = this.unitCursor;
    const unitPageIds = this.unitIds.slice(
      unitCursor,
      unitCursor + NATIONAL_OBSERVER_MAX_UNITS,
    );
    const marker = (
      asset: NonNullable<ReturnType<typeof currentUnits.get>>,
    ): NationalVisibleUnitV1 => ({
      id: Number(asset.id),
      ownerId: asset.ownerId,
      nativeOwnerSmallId: this.game.player(asset.ownerId).smallID(),
      nativeType: this.game.unit(Number(asset.id))!.type(),
      kind: asset.kind,
      tile: map.ref(asset.x, asset.y),
      ...(asset.ownerId === this.principalId &&
      asset.strength !== undefined &&
      Number.isFinite(asset.strength)
        ? { troops: asset.strength }
        : {}),
    });
    const sharedStrength = (
      asset: NonNullable<ReturnType<typeof currentUnits.get>>,
    ): number | undefined =>
      asset.source === "empire" && asset.sourceNationId === asset.ownerId
        ? asset.strength
        : undefined;
    const units = unitPageIds
      .map((id) => currentUnits.get(id))
      .filter((asset) => asset !== undefined)
      .map(marker);
    const pageUnitIds = new Set(units.map((unit) => unit.id));
    const removed: number[] = [];
    for (const [id, entry] of this.emittedUnits) {
      const prior = entry.marker;
      if (pageUnitIds.has(id)) continue;
      const asset = currentUnits.get(id);
      if (
        !asset ||
        asset.ownerId !== prior.ownerId ||
        asset.kind !== prior.kind ||
        map.ref(asset.x, asset.y) !== prior.tile ||
        (asset.ownerId === this.principalId &&
          asset.strength !== prior.troops) ||
        sharedStrength(asset) !== entry.sharedStrength
      ) {
        removed.push(id);
        if (removed.length > NATIONAL_OBSERVER_MAX_UNITS) break;
      }
    }
    let projected = this.emittedUnits.size - removed.length;
    for (const id of pageUnitIds) if (!this.emittedUnits.has(id)) projected++;
    const unitReset =
      first ||
      removed.length > NATIONAL_OBSERVER_MAX_UNITS ||
      projected > NATIONAL_OBSERVER_MAX_TRACKED_UNITS;
    if (unitReset) {
      this.emittedUnits.clear();
      removed.length = 0;
    } else {
      removed.sort((a, b) => a - b);
      for (const id of removed) this.emittedUnits.delete(id);
    }
    for (const unit of units) {
      this.emittedUnits.set(unit.id, {
        marker: unit,
        sharedStrength: sharedStrength(currentUnits.get(unit.id)!),
      });
    }
    const unitNext = unitCursor + unitPageIds.length;
    const unitNextCursor = unitNext >= this.unitIds.length ? null : unitNext;
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
      observerSmallId: this.game.player(this.principalId).smallID(),
      streamId: this.streamId,
      sweepId: this.sweepId,
      sweepTick: this.sweepTick,
      width: map.width(),
      height: map.height(),
      reset,
      cursor,
      nextCursor,
      tilePageSlots: refs.length,
      tileRemovedRefs,
      tilePartial: this.emittedTiles.size !== visible.size,
      tiles,
      units,
      unitCursor,
      unitNextCursor,
      unitSweepId: this.unitSweepId,
      unitPageSlots: unitPageIds.length,
      unitPartial: this.emittedUnits.size !== currentUnits.size,
      unitReset,
      unitRemovedIds: unitReset ? [] : removed,
      unitsTruncated: currentUnits.size > NATIONAL_OBSERVER_MAX_UNITS,
      unitOverflow: currentUnits.size > NATIONAL_OBSERVER_MAX_TRACKED_UNITS,
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
