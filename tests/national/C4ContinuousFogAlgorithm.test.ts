/** Deterministic algorithm seam: complements, never substitutes for, GameRunner/Zbin tests. */
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  NATIONAL_OBSERVER_MAX_TRACKED_UNITS,
  NATIONAL_OBSERVER_MAX_TILES,
  NATIONAL_OBSERVER_MAX_UNITS,
} from "@openfront/engine-api/game/NationalRecipientView";
import type { Game } from "@openfront/engine/game/Game";
import type { LiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { NationalObserverMapPager } from "@openfront/engine/national/observation/NationalObserverMap";
import { describe, expect, it } from "vitest";
import { NationalObserverMapContinuity } from "../../src/client/NationalObserverMapContinuity";

type Assets = LiveNationalObservation["observation"]["visibleAssets"];
const count = (n: number, start = 0) =>
  Array.from({ length: n }, (_, i) => i + start);
const assets = (n: number, tile: number): Assets =>
  count(n).map((id) => ({
    id: String(id),
    ownerId: "b",
    kind: "structure",
    x: tile % 256,
    y: Math.floor(tile / 256),
    source: "border",
  }));

function rig() {
  let tick = 0;
  let visible = new Set<number>();
  const state = new Uint16Array(256 * 256).fill(1);
  const safeRead = (ref: number) => {
    if (!visible.has(ref)) throw new Error("hidden authoritative state read");
    return state[ref];
  };
  const map = {
    width: () => 256,
    height: () => 256,
    x: (ref: number) => ref % 256,
    y: (ref: number) => Math.floor(ref / 256),
    ref: (x: number, y: number) => y * 256 + x,
    isValidRef: (ref: number) => ref >= 0 && ref < 65536,
    isValidCoord: (x: number, y: number) =>
      x >= 0 && x < 256 && y >= 0 && y < 256,
    ownerID: safeRead,
    tileState: safeRead,
    terrainByte: (ref: number) => {
      safeRead(ref);
      return 1;
    },
    neighbors4: (ref: number, out: number[]) => {
      let n = 0;
      if (ref % 256 > 0) out[n++] = ref - 1;
      if (ref % 256 < 255) out[n++] = ref + 1;
      if (ref >= 256) out[n++] = ref - 256;
      if (ref < 65280) out[n++] = ref + 256;
      return n;
    },
  };
  const game = {
    ticks: () => tick,
    map: () => map,
    player: (id: string) => ({ smallID: () => (id === "a" ? 1 : 2) }),
    unit: () => ({ type: () => UnitType.City }),
  } as unknown as Game;
  const pager = new NationalObserverMapPager(game, "a", "seam-a");
  const reader = new NationalObserverMapContinuity("a", "seam-a");
  function emit(sight: readonly number[], units: Assets) {
    visible = new Set(sight);
    tick++;
    const verified: LiveNationalObservation = {
      visibleTiles: visible,
      observation: {
        observerId: "a",
        tick,
        nations: [],
        coalitions: [],
        wars: [],
        ownResources: { troops: 1, treasury: 1 },
        visibleAssets: units,
        frontiers: [],
        diplomaticEvents: [],
      },
    };
    const page = pager.page(verified);
    const delta = reader.accept(page, tick);
    return { page, delta };
  }
  return { emit, reader, pager, state };
}

describe("C4 E3 bounded continuity algorithm", () => {
  it("mass revocation clears both caches without rewinding and skips hidden frozen slots", () => {
    const { emit, reader } = rig();
    const full = count(16000);
    const active = assets(7000, 15000);
    emit(full, active);
    const second = emit(full, active);
    expect(second.page.nextCursor).toBe(8192);
    expect(second.page.unitNextCursor).toBe(4096);
    const reduced = full.filter(
      (ref) => ref >= 6000 && (ref < 9000 || ref >= 10000),
    );
    const survivors = active.slice(3000);
    const third = emit(reduced, survivors);
    expect(third.delta.clearAllTiles).toBe(true);
    expect(third.delta.clearAllUnits).toBe(true);
    expect(third.delta.removedTileRefs).toEqual([]);
    expect(third.delta.removedUnitIds).toEqual([]);
    expect(third.page.cursor).toBe(8192);
    expect(third.page.unitCursor).toBe(4096);
    expect(third.page.nextCursor).toBe(12288);
    expect(third.page.unitNextCursor).toBe(6144);
    expect(third.page.tilePageSlots).toBe(NATIONAL_OBSERVER_MAX_TILES);
    expect(third.page.tiles).toHaveLength(3096);
    expect(reader.tileStatus(0)).toBe("revoked");
    expect(reader.tileStatus(9500)).toBe("unknown");
    expect(reader.units().every((unit) => unit.id >= 4096)).toBe(true);
    const fourth = emit(reduced, survivors);
    expect(fourth.delta.sweepComplete).toBe(true);
    expect(fourth.delta.unitSweepComplete).toBe(true);
    expect(fourth.delta.tilePartial).toBe(true);
    expect(fourth.delta.unitPartial).toBe(true);
    let done = fourth;
    for (let i = 0; i < 3; i++) done = emit(reduced, survivors);
    expect(done.delta.tilePartial).toBe(false);
    expect(done.delta.unitPartial).toBe(false);
  });

  it("newly reappearing unrepresented units get first opportunities next sweep", () => {
    const { emit, reader } = rig();
    const all = assets(6200, 1);
    for (let i = 0; i < 4; i++) emit([1], i % 2 === 0 ? all : all.slice(0, -1));
    expect(reader.units().some((unit) => unit.id === 6199)).toBe(false);
    const next = emit([1], all);
    expect(next.delta.units[0].id).toBe(6199);
  });

  it("invalidates previously shared strength even when a foreign marker stays in sight", () => {
    const { emit, reader } = rig();
    const all = assets(6200, 1);
    const allied: Assets = all.map((asset) =>
      asset.id === "0"
        ? {
            ...asset,
            source: "empire",
            sourceNationId: "b",
            strength: 7654321,
          }
        : asset,
    );
    const one = emit([1], allied);
    expect(one.delta.units[0].id).toBe(0);
    expect(one.delta.units[0]).not.toHaveProperty("troops");
    const two = emit([1], all);
    expect(two.page.unitCursor).toBe(2048);
    expect(two.delta.removedUnitIds).toContain(0);
    expect(reader.units().some((unit) => unit.id === 0)).toBe(false);
    emit([1], all);
    emit([1], all);
    const next = emit([1], all);
    expect(next.delta.units[0].id).toBe(0);
    expect(next.delta.units[0]).not.toHaveProperty("troops");
  });

  it("rotates the bounded overflow window, exposing high IDs without overflowing cache", () => {
    const { emit, reader } = rig();
    const all = assets(NATIONAL_OBSERVER_MAX_TRACKED_UNITS + 1, 1);
    const windows = Math.ceil(
      NATIONAL_OBSERVER_MAX_TRACKED_UNITS / NATIONAL_OBSERVER_MAX_UNITS,
    );
    for (let i = 0; i < windows; i++) {
      const { page } = emit([1], all);
      expect(page.unitOverflow).toBe(true);
      expect(page.unitPartial).toBe(true);
      expect(reader.observedUnitCount).toBeLessThanOrEqual(
        NATIONAL_OBSERVER_MAX_TRACKED_UNITS,
      );
    }
    expect(
      reader
        .units()
        .some((unit) => unit.id === NATIONAL_OBSERVER_MAX_TRACKED_UNITS),
    ).toBe(false);
    const rotated = emit([1], all);
    expect(rotated.delta.units[0].id).toBe(NATIONAL_OBSERVER_MAX_TRACKED_UNITS);
    expect(rotated.delta.clearAllUnits).toBe(true);
    expect(reader.observedUnitCount).toBeLessThanOrEqual(
      NATIONAL_OBSERVER_MAX_TRACKED_UNITS,
    );
  }, 60000);
});
