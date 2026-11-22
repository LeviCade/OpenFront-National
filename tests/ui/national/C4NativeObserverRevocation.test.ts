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
  assertTrustedPublicProjection,
  readTrustedVictory,
  materializeTrustedNationalUpdate,
  parseTrustedNationalProjection,
} from "../../../src/client/TrustedNationalSession";
import {
  makeEmptyGu,
  makeGameView,
  makePlayerUpdate,
  makeUnitUpdate,
  stubConfig,
} from "../../util/viewStubs";

const self = "nation-a";
const enemy = "nation-b";
const ownTile = 22;
const enemyTile = 33;
const marker = {
  id: 19,
  ownerId: enemy,
  nativeOwnerSmallId: 2,
  nativeType: UnitType.Warship,
  kind: "warship",
  tile: enemyTile,
};
const land = 128;

function page(tick: number, overrides: Record<string, unknown> = {}) {
  const result = {
    observerSmallId: 1,
    tileRemovedRefs: [],
    tilePartial: false,
    unitPartial: false,
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
  return {
    ...result,
    tilePageSlots: result.tiles.length,
    unitPageSlots: result.units.length,
    tileSweepSlots: result.tiles.length,
    unitSweepSlots: result.units.length,
  };
}

function setup() {
  const config = stubConfig({
    gameConfig: () =>
      ({ nationalMode: true }) as ReturnType<
        ReturnType<typeof stubConfig>["gameConfig"]
      >,
  });
  const view = makeGameView({
    trustedProjection: true,
    myClientID: "client-a",
    config,
  });
  view.setTrustedPrincipal(self);
  const update = makeEmptyGu(1);
  Object.assign(update, {
    nationalPolitics: { empires: [], warnings: [] },
    nationalConflicts: {
      version: 1,
      recipientId: self,
      layers: [
        {
          id: "war-a-b",
          scope: "national",
          first: { kind: "nation", id: self },
          second: { kind: "nation", id: enemy },
          declaredBy: self,
          startedTick: 1,
          endedTick: null,
        },
      ],
      motions: [],
    },
  });
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
  it("accepts public-only pre-spawn data, rejects private lanes, and requires explicit victory", () => {
    const packet = {
      tick: 1,
      packedTileUpdates: [],
      updates: { [GameUpdateType.Player]: [] },
      nationalPolitics: { empires: [], victory: null },
      nationalConflicts: { recipientId: "", motions: [], layers: [] },
    };
    expect(() => assertTrustedPublicProjection(packet)).not.toThrow();
    const own = {
      type: GameUpdateType.Player,
      id: self,
      clientID: "client-a",
      smallID: 1,
      name: "Self",
      playerType: PlayerType.Human,
      hasSpawned: false,
    };
    const bound = { ...packet, updates: { [GameUpdateType.Player]: [own] } };
    expect(() =>
      assertTrustedPublicProjection(bound, self, "client-a"),
    ).not.toThrow();
    expect(() =>
      assertTrustedPublicProjection(bound, enemy, "client-b"),
    ).toThrow();
    expect(() =>
      assertTrustedPublicProjection(
        {
          ...bound,
          updates: { [GameUpdateType.Player]: [{ ...own, troops: 100 }] },
        },
        self,
        "client-a",
      ),
    ).toThrow();
    expect(() =>
      assertTrustedPublicProjection({
        ...packet,
        packedPlayerUpdates: [1, 2, 3, 4, 5],
      }),
    ).toThrow();
    expect(() =>
      assertTrustedPublicProjection({
        ...packet,
        nationalConflicts: { recipientId: self, motions: [], layers: [] },
      }),
    ).toThrow();
    expect(readTrustedVictory(packet, self)).toBe("unresolved");
    const resolved = {
      ...packet,
      nationalPolitics: {
        empires: [],
        victory: {
          resolved: true,
          sovereignPowerCount: 1,
          prizes: [{ kind: "SovereignVictor", nationId: self }],
        },
      },
    };
    expect(readTrustedVictory(resolved, self)).toBe("victory");
    expect(readTrustedVictory(resolved, enemy)).toBe("defeat");
    const { view, update } = setup();
    view.update(materializeTrustedNationalUpdate(bound, 0));
    expect(view.playerByClientID("client-a")?.id()).toBe(self);
    expect(view.playerByClientID("client-a")?.troops()).toBe(0);
    expect(view.trustedSpawnReady()).toBe(false);
    view.setTrustedSpawnReady(true);
    expect(view.trustedSpawnReady()).toBe(true);
    expect(view.trustedProjectionReady()).toBe(false);
    view.resetTrustedProjectionSight();
    expect(view.trustedSpawnReady()).toBe(false);
    view.update({ ...update, tick: 2 });
    expect(view.playerByClientID("client-a")?.id()).toBe(self);
    expect(view.playerByClientID("client-a")?.hasSpawned()).toBe(true);
  });

  it("draws authorized ownership and packed native units, deletes a unit without fake death, and refuses stale attack dispatch", () => {
    const { view, update, receiver } = setup();
    const packed = packUnitUpdates([
      makeUnitUpdate({
        id: marker.id,
        ownerID: 2,
        pos: enemyTile,
        lastPos: enemyTile,
        unitType: UnitType.Warship,
        targetable: false,
        level: 0,
      }),
    ]).packedUnitUpdates;
    const packet = parseTrustedNationalProjection(
      JSON.stringify({
        tick: 1,
        updates: { [GameUpdateType.Player]: [] },
        packedTileUpdates: [],
        packedUnitUpdates: Array.from(packed),
        nationalObserverMap: page(1),
      }),
      1,
    );
    const first = receiver.acceptProjection(packet);
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
    update.packedUnitUpdates = first.nativeUnits;
    view.applyTrustedUnitPage(update, first, receiver);
    view.markTrustedProjectionReady();
    view.update(update);
    expect(view.owner(enemyTile).id()).toBe(enemy);
    expect(view.frameData().units.has(marker.id)).toBe(true);
    expect([...view.trustedObserverFallbackMarkers()]).toEqual([]);
    expect(view.trustedVisibleAttack(self, enemyTile)).toBe(true);
    expect(view.trustedAttackTarget(self, enemyTile)).toBe(enemy);

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
    expect(view.trustedAttackTarget(self, enemyTile)).toBeUndefined();
    centerButtonElement.action(params);
    expect(attack).toHaveBeenCalledTimes(1);
    expect(() => receiver.accept(page(4, { streamId: "forged" }), 4)).toThrow();
    expect(() => receiver.accept(page(2), 2)).toThrow();
  });

  it("publishes sparse tile revocation without erasing independently sighted units or unchanged tiles", () => {
    const { view, update, receiver } = setup();
    const first = receiver.accept(page(1), 1);
    update.packedTileUpdates = new Uint32Array([
      ownTile,
      1 | (land << 16),
      enemyTile,
      2 | (land << 16),
    ]);
    view.applyTrustedUnitPage(update, first, receiver);
    view.markTrustedProjectionReady();
    view.update(update);
    const next = receiver.accept(
      page(2, {
        tiles: [[ownTile, 1, land, 0]],
        units: [marker],
        tileRemovedRefs: [enemyTile],
        tilePartial: true,
      }),
      2,
    );
    expect(next.usable).toBe(true);
    expect(next.tilePartial).toBe(true);
    view.reconcileTrustedTileVisibility(next.removedTileRefs);
    const nextUpdate = makeEmptyGu(2);
    nextUpdate.packedTileUpdates = new Uint32Array([ownTile, 1 | (land << 16)]);
    view.applyTrustedUnitPage(nextUpdate, next, receiver);
    view.setTrustedProjectionReady(next.usable);
    view.update(nextUpdate);
    expect(view.hasOwner(enemyTile)).toBe(false);
    expect(view.owner(ownTile).id()).toBe(self);
    expect(view.frameData().changedTiles).toContain(enemyTile);
    expect(view.frameData().changedTiles).not.toContain(ownTile);
    expect(view.trustedAttackTarget(self, enemyTile)).toBeUndefined();
    expect([...view.trustedObserverFallbackMarkers()]).toEqual([marker]);
    view.resetTrustedTileSight();
    expect([...view.trustedObserverFallbackMarkers()]).toEqual([marker]);
  });

  it("offers neutral expansion only on observed land and prevents attacking before WAR or after peace", async () => {
    const { view, update, receiver } = setup();
    const first = receiver.accept(
      page(1, {
        tiles: [
          [ownTile, 1, land, 0],
          [enemyTile, 2, land, 0],
          [34, 0, land, 0],
        ],
      }),
      1,
    );
    update.packedTileUpdates = new Uint32Array([
      ownTile,
      1 | (land << 16),
      enemyTile,
      2 | (land << 16),
      34,
      land << 16,
      35,
      land << 16,
    ]);
    // The underlying static terrain may include an unseen land tile (35).
    view.applyTrustedUnitPage(update, first, receiver);
    view.markTrustedProjectionReady();
    view.update(update);
    expect(view.trustedAttackTarget(self, 34)).toBeNull();
    expect(view.trustedAttackTarget(self, 35)).toBeUndefined();
    expect(view.trustedAttackTarget(self, enemyTile)).toBe(enemy);
    expect((await view.player(self).actions(34, null)).canAttack).toBe(true);
    const peace = makeEmptyGu(2);
    Object.assign(peace, {
      nationalPolitics: { empires: [], warnings: [] },
      nationalConflicts: {
        version: 1,
        recipientId: self,
        layers: [],
        motions: [],
      },
    });
    view.update(peace);
    expect(view.trustedAttackTarget(self, enemyTile)).toBeUndefined();
    expect((await view.player(self).actions(enemyTile, null)).canAttack).toBe(
      false,
    );
    expect(view.trustedAttackTarget(self, 34)).toBeNull();
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
