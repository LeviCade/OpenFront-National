// @vitest-environment jsdom
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { describe, expect, it } from "vitest";
import {
  materializeTrustedNationalUpdate,
  parseTrustedNationalProjection,
  readTrustedNationalObserverMap,
} from "../../../src/client/TrustedNationalSession";
import { GameView } from "../../../src/client/view/GameView";
import type { PlayerView } from "../../../src/client/view/PlayerView";

function packet(tick: number) {
  return {
    tick,
    updates: {
      [GameUpdateType.Player]: [
        {
          type: GameUpdateType.Player,
          id: "nation-a",
          name: "A",
          smallID: 1,
        },
      ],
      [GameUpdateType.SpawnPhaseEnd]: [],
      [GameUpdateType.GamePaused]: [],
    },
    packedTileUpdates: [21, 33, 22, 34],
    packedUnitUpdates: [],
    packedPlayerUpdates: [1, 4, 200, 700, 15],
    nationalPolitics: { empires: [], warnings: [] },
  };
}

describe("Second Conductor Class One E4: E3-authoritative graphical map feed", () => {
  it("restores the actual E3 visible tile and player lanes for the existing GameView", () => {
    const decoded = parseTrustedNationalProjection(
      JSON.stringify(packet(4)),
      4,
    );
    const update = materializeTrustedNationalUpdate(decoded, 3);
    expect(update.tick).toBe(4);
    expect([...update.packedTileUpdates]).toEqual([21, 33, 22, 34]);
    expect([...update.packedPlayerUpdates!]).toEqual([1, 4, 200, 700, 15]);
    expect(update.updates[GameUpdateType.Player]).toHaveLength(1);
    expect(update.updates[GameUpdateType.Win]).toEqual([]);
    expect(update.updates[GameUpdateType.EmbargoEvent]).toEqual([]);
    expect(update.packedTileUpdates).toBeInstanceOf(Uint32Array);
    expect(update.packedPlayerUpdates).toBeInstanceOf(Float64Array);
    // No made-up authoritative packet or second GameRunner is constructed.
  });

  it("refuses stale, malformed, hidden and unauthorized update buckets", () => {
    const decoded = parseTrustedNationalProjection(
      JSON.stringify(packet(6)),
      6,
    );
    expect(() => materializeTrustedNationalUpdate(decoded, 6)).toThrow();
    expect(() => materializeTrustedNationalUpdate(decoded, 7)).toThrow();
    expect(() =>
      parseTrustedNationalProjection(JSON.stringify(packet(6)), 5),
    ).toThrow();
    expect(() =>
      materializeTrustedNationalUpdate(
        {
          ...decoded,
          updates: { [GameUpdateType.AllianceRequest]: [{ secret: true }] },
        },
        5,
      ),
    ).toThrow();
    expect(() =>
      materializeTrustedNationalUpdate(
        {
          ...decoded,
          packedTileUpdates: [1, 0, 8],
        },
        5,
      ),
    ).toThrow();
    expect(() =>
      materializeTrustedNationalUpdate(
        {
          ...decoded,
          packedUnitUpdates: [1],
        },
        5,
      ),
    ).toThrow();
    expect(() =>
      materializeTrustedNationalUpdate(
        {
          ...decoded,
          packedPlayerUpdates: [1, 2, 3],
        },
        5,
      ),
    ).toThrow();
    expect(() =>
      parseTrustedNationalProjection(
        JSON.stringify({
          ...packet(6),
          privateGameSnapshot: { warPlans: true },
        }),
        6,
      ),
    ).toThrow();
  });

  it("native radial affordance observes ONLY actually seen opposing ownership", () => {
    const self = {
      id: () => "nation-a",
      isAlive: () => true,
      hasSpawned: () => true,
      troops: () => 800,
    } as PlayerView;
    const enemy = { id: () => "nation-b", isPlayer: () => true };
    const view = Object.create(GameView.prototype) as GameView;
    Object.assign(view, {
      _trustedNationalProjection: true,
      _trustedProjectionReady: true,
      myPlayer: () => self,
      inSpawnPhase: () => false,
      isValidRef: (tile: number) => tile >= 0 && tile < 100,
      hasOwner: (tile: number) => tile === 42,
      owner: (_tile: number) => enemy,
    });
    expect(view.trustedVisibleAttack("nation-a", 42)).toBe(true);
    expect(view.trustedVisibleAttack("nation-a", 41)).toBe(false);
    expect(view.trustedVisibleAttack("nation-b", 42)).toBe(false);
    Object.assign(view, { inSpawnPhase: () => true });
    expect(view.trustedVisibleAttack("nation-a", 42)).toBe(false);
    Object.assign(view, {
      inSpawnPhase: () => false,
      myPlayer: () => ({
        ...self,
        id: () => "nation-a",
        isAlive: () => false,
        hasSpawned: () => true,
        troops: () => 800,
      }),
    });
    expect(view.trustedVisibleAttack("nation-a", 42)).toBe(false);
  });

  it("merges only E3 current visible terrain pages into actual WebGL tile lanes", () => {
    const visiblePage = {
      version: 1,
      tick: 18,
      observerId: "nation-a",
      width: 10,
      height: 10,
      reset: true,
      cursor: 0,
      nextCursor: null,
      tiles: [
        [3, 5, 17, 1],
        [44, 8, 66, 3],
      ],
      units: [
        { id: 1, ownerId: "nation-a", kind: "infantry", tile: 3, troops: 10 },
      ],
      unitsTruncated: false,
      visibleBorders: [{ targetId: "nation-b", access: "land" }],
      ownResources: { troops: 100, treasury: 50 },
      countries: [
        {
          id: "nation-a",
          name: "A",
          alive: true,
          landPercent: 5,
          status: "independent",
        },
      ],
    };
    const decoded = parseTrustedNationalProjection(
      JSON.stringify({ ...packet(18), nationalObserverMap: visiblePage }),
      18,
    );
    const validated = readTrustedNationalObserverMap(
      decoded.nationalObserverMap,
      18,
    );
    expect(validated?.reset).toBe(true);
    expect(validated?.nextCursor).toBeNull();
    const actual = materializeTrustedNationalUpdate(decoded, 17);
    expect([...actual.packedTileUpdates]).toEqual([
      21,
      33,
      22,
      34,
      3,
      5 | (17 << 16),
      44,
      8 | (66 << 16),
    ]);
    expect([...actual.packedTileUpdates]).not.toContain(90);
    expect(() =>
      readTrustedNationalObserverMap({ ...visiblePage, tick: 17 }, 18),
    ).toThrow();
    expect(() =>
      readTrustedNationalObserverMap(
        { ...visiblePage, tiles: [[500, 5, 17, 1]] },
        18,
      ),
    ).toThrow();
    expect(() =>
      readTrustedNationalObserverMap(
        { ...visiblePage, tiles: [[3, 5, 17, 16]] },
        18,
      ),
    ).toThrow();
    expect(() =>
      readTrustedNationalObserverMap(
        {
          ...visiblePage,
          units: [
            {
              id: 1,
              ownerId: "nation-b",
              kind: "infantry",
              tile: 3,
              troops: Infinity,
            },
          ],
        },
        18,
      ),
    ).toThrow();
    expect(() =>
      readTrustedNationalObserverMap(
        {
          ...visiblePage,
          tiles: Array.from({ length: 4097 }, (_, i) => [i, 5, 17, 1]),
        },
        18,
      ),
    ).toThrow();
  });
});
