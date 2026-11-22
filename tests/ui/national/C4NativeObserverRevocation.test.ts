// @vitest-environment jsdom
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { packUnitUpdates } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { describe, expect, it, vi } from "vitest";
import {
  centerButtonElement,
  type MenuElementParams,
} from "../../../src/client/hud/layers/RadialMenuElements";
import { NationalObserverMapContinuity } from "../../../src/client/NationalObserverMapContinuity";
import {
  uploadFrameData,
  type FrameUploadTarget,
} from "../../../src/client/render/frame/Upload";
import {
  materializeTrustedNationalUpdate,
  parseTrustedNationalProjection,
} from "../../../src/client/TrustedNationalSession";
import {
  makeEmptyGu,
  makeGameView,
  makePlayerUpdate,
  makeUnitUpdate,
} from "../../util/viewStubs";

const self = "nation-a";
const enemy = "nation-b";
const ownTile = 22;
const enemyTile = 33;
const marker = { id: 19, ownerId: enemy, kind: "warship", tile: enemyTile };
const land = 128;

function page(tick: number, overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    tick,
    observerId: self,
    width: 10,
    height: 10,
    streamId: "authenticated-a",
    sweepId: tick,
    sweepTick: tick,
    reset: tick === 1,
    cursor: 0,
    nextCursor: null,
    unitCursor: 0,
    unitNextCursor: null,
    unitSweepId: tick,
    unitReset: tick === 1,
    unitOverflow: false,
    unitRemovedIds: [],
    tiles: [
      [ownTile, 1, land, 0],
      [enemyTile, 2, land, 0],
    ],
    units: [marker],
    unitsTruncated: false,
    ownResources: { troops: 100, treasury: 0 },
    countries: [],
    visibleBorders: [],
    ...overrides,
  };
}

function setup() {
  const view = makeGameView({
    trustedProjection: true,
    myClientID: "client-a",
  });
  view.setTrustedPrincipal(self);
  const update = makeEmptyGu(1);
  update.updates[GameUpdateType.Player] = [
    makePlayerUpdate({ id: self, tilesOwned: 1 }),
    {
      type: GameUpdateType.Player,
      id: enemy,
      name: "Enemy",
      displayName: "Enemy",
      playerType: PlayerType.Human,
      smallID: 2,
      tilesOwned: 1,
      isAlive: true,
    },
  ];
  update.updates[GameUpdateType.SpawnPhaseEnd] = [
    { type: GameUpdateType.SpawnPhaseEnd, startTick: 1 },
  ];
  return { view, update, receiver: new NationalObserverMapContinuity(self) };
}

describe("C4 E4: native recipient view revocation", () => {
  it("draws authorized ownership and packed native units, deletes a unit without fake death, and refuses stale attack dispatch", () => {
    const { view, update, receiver } = setup();
    const first = receiver.accept(page(1), 1);
    view.reconcileTrustedUnitVisibility(
      first.clearAllUnits,
      first.removedUnitIds,
    );
    update.packedTileUpdates = new Uint32Array([
      ownTile,
      1 | (land << 16),
      enemyTile,
      2 | (land << 16),
    ]);
    update.packedUnitUpdates = packUnitUpdates([
      makeUnitUpdate({
        id: marker.id,
        ownerID: 2,
        pos: enemyTile,
        lastPos: enemyTile,
        unitType: UnitType.Warship,
      }),
    ]).packedUnitUpdates;
    view.applyTrustedUnitPage(update, first, receiver);
    view.markTrustedProjectionReady();
    view.update(update);
    expect(view.owner(enemyTile).id()).toBe(enemy);
    expect(view.frameData().units.has(marker.id)).toBe(true);
    expect([...view.trustedObserverFallbackMarkers()]).toEqual([]);
    expect(view.trustedVisibleAttack(self, enemyTile)).toBe(true);

    const attack = vi.fn();
    const params = {
      game: view,
      tile: enemyTile,
      myPlayer: view.player(self),
      selected: view.player(enemy),
      playerActions: { canAttack: true },
      closeMenu: vi.fn(),
      playerActionHandler: { handleAttack: attack },
    } as unknown as MenuElementParams;
    centerButtonElement.action(params);
    expect(attack).toHaveBeenCalledTimes(1);

    const next = receiver.accept(
      page(2, { units: [], unitRemovedIds: [marker.id] }),
      2,
    );
    view.reconcileTrustedUnitVisibility(
      next.clearAllUnits,
      next.removedUnitIds,
    );
    view.update(makeEmptyGu(2));
    expect(view.frameData().units.has(marker.id)).toBe(false);
    expect(view.frameData().events.deadUnits).toEqual([]);

    const reset = receiver.accept(
      page(3, {
        reset: true,
        unitReset: true,
        tiles: [[ownTile, 1, land, 0]],
        units: [],
      }),
      3,
    );
    expect(reset.clearAllTiles).toBe(true);
    view.resetTrustedProjectionSight();
    const uploads = {
      uploadTileAndTrailState: vi.fn(),
      updateSpiralRibbons: vi.fn(),
      uploadRailroadState: vi.fn(),
      updateUnits: vi.fn(),
      updateStructures: vi.fn(),
      updateAttackRings: vi.fn(),
      updateNukeTelegraphs: vi.fn(),
      updateNames: vi.fn(),
      updateRelations: vi.fn(),
      setSAMAllianceClusters: vi.fn(),
    };
    uploadFrameData(uploads as unknown as FrameUploadTarget, view.frameData());
    expect(uploads.uploadTileAndTrailState).toHaveBeenCalledOnce();
    expect(uploads.updateUnits).toHaveBeenCalledOnce();
    expect(view.frameData().units.size).toBe(0);
    expect(view.hasOwner(enemyTile)).toBe(false);
    expect(view.trustedVisibleAttack(self, enemyTile)).toBe(false);
    centerButtonElement.action(params);
    expect(attack).toHaveBeenCalledTimes(1);
    expect(() => receiver.accept(page(4, { streamId: "forged" }), 4)).toThrow();
    expect(() => receiver.accept(page(2), 2)).toThrow();
  });

  it("retains only coarse authorized markers until exact native unit data arrives, and removes them on reset", () => {
    const { view, update, receiver } = setup();
    const first = receiver.accept(page(1), 1);
    view.applyTrustedUnitPage(update, first, receiver);
    expect([...view.trustedObserverFallbackMarkers()]).toEqual([marker]);
    const next = receiver.accept(
      page(2, { units: [], unitRemovedIds: [marker.id] }),
      2,
    );
    view.reconcileTrustedUnitVisibility(
      next.clearAllUnits,
      next.removedUnitIds,
    );
    expect([...view.trustedObserverFallbackMarkers()]).toEqual([]);
    const fresh = new NationalObserverMapContinuity(self);
    expect(() => fresh.accept(page(2), 2)).toThrow();
    const freshPage = fresh.accept(page(1, { streamId: "new-socket" }), 1);
    view.applyTrustedUnitPage(update, freshPage, fresh);
    expect([...view.trustedObserverFallbackMarkers()]).toEqual([marker]);
    view.resetTrustedProjectionSight();
    expect([...view.trustedObserverFallbackMarkers()]).toEqual([]);
  });

  it("round-trips the real packed unit JSON sentinel lanes without accepting null IDs", () => {
    const packed = packUnitUpdates([makeUnitUpdate()]).packedUnitUpdates;
    const raw = {
      tick: 1,
      updates: {},
      packedTileUpdates: [],
      packedUnitUpdates: Array.from(packed),
    };
    const decoded = parseTrustedNationalProjection(JSON.stringify(raw), 1);
    expect(
      materializeTrustedNationalUpdate(decoded, 0).packedUnitUpdates,
    ).toEqual(packed);
    const invalid = {
      ...raw,
      packedUnitUpdates: [null, ...Array.from(packed).slice(1)],
    };
    expect(() =>
      materializeTrustedNationalUpdate(
        parseTrustedNationalProjection(JSON.stringify(invalid), 1),
        0,
      ),
    ).toThrow();
  });
});
