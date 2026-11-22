import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { unpackUnitUpdates } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { NationalObserverMapPager } from "@openfront/engine/national/observation/NationalObserverMap";
import { NationalObserverMapContinuity } from "../../src/client/NationalObserverMapContinuity";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const VIEWER = new PlayerInfo(
  "C5 Viewer",
  PlayerType.Human,
  "c5-e6-viewer-client",
  "c5-e6-viewer",
);
const ALLY = new PlayerInfo("C5 Ally", PlayerType.Nation, null, "c5-e6-ally");
const OUTSIDER = new PlayerInfo(
  "C5 Outsider",
  PlayerType.Nation,
  null,
  "c5-e6-outsider",
);

describe("C5 E6: authoritative coastal and empire visibility boundaries", () => {
  it("FOG-06/07 denies a departed member's distant unit even with a stale roster", async () => {
    const game = await setup("big_plains", { nationalMode: true }, [
      VIEWER,
      ALLY,
      OUTSIDER,
    ]);
    const viewerTile = game.ref(20, 100);
    const allyTile = game.ref(160, 170);
    const outsiderTile = game.ref(195, 10);
    game.addExecution(
      new SpawnExecution("c5-e6", VIEWER, viewerTile),
      new SpawnExecution("c5-e6", ALLY, allyTile),
      new SpawnExecution("c5-e6", OUTSIDER, outsiderTile),
    );
    game.executeNextTick();
    game.executeNextTick();
    game.endSpawnPhase();
    const sharedShip = game
      .player(ALLY.id)
      .buildUnit(UnitType.TransportShip, allyTile, {
        troops: 991_337,
        targetTile: outsiderTile,
      });
    const hiddenCity = game
      .player(OUTSIDER.id)
      .buildUnit(UnitType.City, outsiderTile, {});
    const viewer = game.player(VIEWER.id);
    game.performNationalCommand(viewer, {
      kind: "found-empire",
      empireId: "c5_e6_sight",
    });
    game.performNationalCommand(viewer, {
      kind: "offer-empire",
      empireId: "c5_e6_sight",
      candidateId: ALLY.id,
    });
    game.performNationalCommand(game.player(ALLY.id), {
      kind: "accept-empire",
      empireId: "c5_e6_sight",
      candidateId: ALLY.id,
    });
    const before = collectLiveNationalObservation(game, VIEWER.id);
    expect(
      before.observation.visibleAssets.find(
        (asset) => asset.id === String(sharedShip.id()),
      )?.source,
    ).toBe("empire");
    expect(
      before.observation.visibleAssets.some(
        (asset) => asset.id === String(hiddenCity.id()),
      ),
    ).toBe(false);

    // Founding-source FOG-06/07 witness: the AUTHORITY reports a stale
    // membersOf list while its current reciprocal empireOf rejects the ally.
    // The sight-index already rejects this member, but the projection's
    // raw coalition roster used to grant its units anyway.
    const authority = game.nationalPoliticalAuthority()!;
    const spy = vi.spyOn(game, "nationalPoliticalAuthority");
    spy.mockImplementation(() => ({
      ...authority,
      membersOf: (id: string) => authority.membersOf(id),
      emperorOf: (id: string) => authority.emperorOf(id),
      empireOf: (id: string) =>
        id === ALLY.id ? null : authority.empireOf(id),
    }));
    try {
      const revoked = collectLiveNationalObservation(game, VIEWER.id);
      expect(revoked.visibleTiles.has(allyTile)).toBe(false);
      expect(
        revoked.observation.visibleAssets.some(
          (asset) => asset.id === String(sharedShip.id()),
        ),
      ).toBe(false);
      expect(
        revoked.observation.visibleAssets.some(
          (asset) => asset.id === String(hiddenCity.id()),
        ),
      ).toBe(false);
      expect(
        revoked.observation.coalitions.find(
          (coalition) => coalition.id === "c5_e6_sight",
        )?.members,
      ).toEqual([VIEWER.id]);
    } finally {
      spy.mockRestore();
    }
  });

  it("FOG-03 hides foreign border structures until adjacent legitimate territory advances", async () => {
    const game = await setup("big_plains", { nationalMode: true }, [
      VIEWER,
      OUTSIDER,
    ]);
    game.addExecution(
      new SpawnExecution("c5-border", VIEWER, game.ref(20, 100)),
      new SpawnExecution("c5-border", OUTSIDER, game.ref(180, 180)),
    );
    game.executeNextTick();
    game.executeNextTick();
    const sovereign = game.player(VIEWER.id);
    const rightmost = [...sovereign.borderTiles()].sort(
      (a, b) => game.x(b) - game.x(a),
    )[0];
    const adjacent = game.ref(game.x(rightmost) + 1, game.y(rightmost));
    const structureTile = game.ref(game.x(adjacent) + 100, game.y(adjacent));
    expect(game.owner(adjacent).isPlayer()).toBe(false);
    expect(game.isLand(adjacent)).toBe(true);
    const city = game
      .player(OUTSIDER.id)
      .buildUnit(UnitType.City, structureTile, {});
    const cityId = String(city.id());
    expect(
      collectLiveNationalObservation(
        game,
        VIEWER.id,
      ).observation.visibleAssets.some((asset) => asset.id === cityId),
    ).toBe(false);
    // Only one currently unowned cardinal neighbor is captured; sight must
    // follow the resulting authoritative map ownership, not a packet grant.
    sovereign.conquer(adjacent);
    expect(game.owner(adjacent).id()).toBe(VIEWER.id);
    const acquired = collectLiveNationalObservation(game, VIEWER.id);
    expect(
      acquired.observation.visibleAssets.find((asset) => asset.id === cityId)
        ?.source,
    ).toBe("border");
    sovereign.relinquish(adjacent);
    expect(
      collectLiveNationalObservation(
        game,
        VIEWER.id,
      ).observation.visibleAssets.some((asset) => asset.id === cityId),
    ).toBe(false);
    const { restored, bytes, again } = await roundTrip(game, "big_plains");
    expect(again).toEqual(bytes);
    expect(
      collectLiveNationalObservation(
        restored,
        VIEWER.id,
      ).observation.visibleAssets.some((asset) => asset.id === cityId),
    ).toBe(false);
    console.info(
      "[C5 FOG-03] structureId=" +
        cityId +
        " capturedTile=" +
        adjacent +
        " structureTile=" +
        structureTile,
    );
  });

  it("FOG-04/05/06 real-world coastal ship exit, revocation, fresh reacquisition, reconnect and hostile packet rejection", async () => {
    const started = performance.now();
    const initialHeap = process.memoryUsage().heapUsed;
    const game = await setup("world", { nationalMode: true }, [
      VIEWER,
      OUTSIDER,
    ]);
    // A natural shoreline near the British Isles, not a synthetic sight list.
    let coast: number | undefined;
    for (let y = 140; y < 235 && coast === undefined; y++) {
      for (let x = 850; x < 1000; x++) {
        const tile = game.ref(x, y);
        if (!game.isLand(tile) || game.isImpassable(tile)) continue;
        let nextToSea = false;
        game.forEachNeighbor(tile, (neighbor) => {
          if (!game.isLand(neighbor)) nextToSea = true;
        });
        if (nextToSea) {
          coast = tile;
          break;
        }
      }
    }
    expect(coast).toBeDefined();
    let nearSea: number | undefined;
    for (
      let y = Math.max(1, game.y(coast!) - 30);
      y <= game.y(coast!) + 30 && nearSea === undefined;
      y++
    ) {
      for (let x = game.x(coast!) - 30; x <= game.x(coast!) + 30; x++) {
        const dx = x - game.x(coast!);
        const dy = y - game.y(coast!);
        const d2 = dx * dx + dy * dy;
        if (d2 > 9 && d2 < 900 && !game.isLand(game.ref(x, y))) {
          nearSea = game.ref(x, y);
          break;
        }
      }
    }
    expect(nearSea).toBeDefined();
    let farSea: number | undefined;
    for (let y = 1; y < 30 && farSea === undefined; y++) {
      for (let x = 1; x < 30; x++) {
        if (!game.isLand(game.ref(x, y))) {
          farSea = game.ref(x, y);
          break;
        }
      }
    }
    expect(farSea).toBeDefined();
    expect(
      Math.hypot(
        game.x(farSea!) - game.x(coast!),
        game.y(farSea!) - game.y(coast!),
      ),
    ).toBeGreaterThan(200);
    game.addExecution(
      new SpawnExecution("c5-coast", VIEWER, coast!),
      new SpawnExecution("c5-coast", OUTSIDER, game.ref(375, 272)),
    );
    game.executeNextTick();
    game.executeNextTick();
    const ship = game
      .player(OUTSIDER.id)
      .buildUnit(UnitType.TransportShip, nearSea!, {
        troops: 7_654_321,
        targetTile: game.ref(375, 272),
      });
    const shipId = String(ship.id());
    const pager = new NationalObserverMapPager(game, VIEWER.id, "c5-e6-coast");
    const recipient = new NationalObserverMapContinuity(
      VIEWER.id,
      "c5-e6-coast",
    );
    const first = collectLiveNationalObservation(game, VIEWER.id);
    expect(
      first.observation.visibleAssets.find((asset) => asset.id === shipId)
        ?.source,
    ).toBe("coast");
    expect(
      first.observation.visibleAssets.find((asset) => asset.id === shipId),
    ).not.toHaveProperty("strength");
    const firstPage = pager.page(first);
    recipient.accept(firstPage, game.ticks());
    expect(recipient.units().map((unit) => unit.id)).toContain(ship.id());

    // Authentic movement inside the Game; no manually assembled grants.
    ship.move(farSea!);
    game.executeNextTick();
    const hidden = collectLiveNationalObservation(game, VIEWER.id);
    expect(
      hidden.observation.visibleAssets.map((asset) => asset.id),
    ).not.toContain(shipId);
    expect(hidden.visibleTiles.has(farSea!)).toBe(false);
    const hiddenPage = pager.page(hidden);
    expect(hiddenPage.unitRemovedIds).toContain(ship.id());
    recipient.accept(hiddenPage, game.ticks());
    expect(recipient.units().map((unit) => unit.id)).not.toContain(ship.id());
    const reconnectPager = new NationalObserverMapPager(
      game,
      VIEWER.id,
      "c5-e6-rejoin",
    );
    const reconnect = new NationalObserverMapContinuity(
      VIEWER.id,
      "c5-e6-rejoin",
    );
    const reconnectPage = reconnectPager.page(hidden);
    reconnect.accept(reconnectPage, game.ticks());
    expect(reconnect.units().map((unit) => unit.id)).not.toContain(ship.id());

    let returnSea: number | undefined;
    game.forEachNeighbor(nearSea!, (neighbor) => {
      if (returnSea === undefined && !game.isLand(neighbor))
        returnSea = neighbor;
    });
    expect(returnSea).toBeDefined();
    expect(returnSea).not.toBe(nearSea);
    ship.move(returnSea!);
    game.executeNextTick();
    const returned = collectLiveNationalObservation(game, VIEWER.id);
    expect(
      returned.observation.visibleAssets.find((asset) => asset.id === shipId)
        ?.source,
    ).toBe("coast");
    const returnPage = pager.page(returned);
    // Spoofed foreign private troops are rejected BEFORE recipient mutation.
    const corrupted = {
      ...returnPage,
      units: returnPage.units.map((unit) => ({
        ...unit,
        ...(unit.id === ship.id() ? { troops: 7_654_321 } : {}),
      })),
    };
    expect(() => recipient.accept(corrupted, game.ticks())).toThrow();
    expect(recipient.units().map((unit) => unit.id)).not.toContain(ship.id());
    recipient.accept(returnPage, game.ticks());
    expect(recipient.units().find((unit) => unit.id === ship.id())?.tile).toBe(
      returnSea,
    );
    // Test a second legitimate sensor: a real owned warship, far beyond
    // the nation's coastline. Moving that sensor must independently revoke.
    const sensor = game
      .player(VIEWER.id)
      .buildUnit(UnitType.Warship, farSea!, { patrolTile: farSea! });
    ship.move(farSea!);
    game.executeNextTick();
    const shipborne = collectLiveNationalObservation(game, VIEWER.id);
    expect(
      shipborne.observation.visibleAssets.find((asset) => asset.id === shipId)
        ?.source,
    ).toBe("warship");
    const warshipPage = pager.page(shipborne);
    recipient.accept(warshipPage, game.ticks());
    expect(recipient.units().find((unit) => unit.id === ship.id())?.tile).toBe(
      farSea,
    );
    sensor.move(nearSea!);
    game.executeNextTick();
    const sensorLost = collectLiveNationalObservation(game, VIEWER.id);
    expect(
      sensorLost.observation.visibleAssets.map((asset) => asset.id),
    ).not.toContain(shipId);
    const sensorLostPage = pager.page(sensorLost);
    expect(sensorLostPage.unitRemovedIds).toContain(ship.id());
    recipient.accept(sensorLostPage, game.ticks());
    expect(recipient.units().map((unit) => unit.id)).not.toContain(ship.id());

    // The *normal native GameRunner* must also disclose and revoke this
    // moving coastal transport, not just the paged observer-map path.
    const nativePackets: GameUpdateViewData[] = [];
    const nativeRunner = new GameRunner(
      game,
      new Executor(game, "c5-e6-native", VIEWER.clientID!),
      (packet) => {
        if ("updates" in packet) nativePackets.push(packet);
      },
      VIEWER.clientID!,
    );
    ship.move(returnSea!);
    game.queueViewResync();
    nativeRunner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(nativeRunner.executeNextTick()).toBe(true);
    const nativeSeen = unpackUnitUpdates(
      nativePackets[0].packedUnitUpdates,
      nativePackets[0].packedMissileTimers,
    ).find((unit) => unit.id === ship.id());
    expect(nativeSeen?.pos).toBe(returnSea);
    expect(nativeSeen?.troops).toBe(0);
    ship.move(farSea!);
    nativeRunner.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(nativeRunner.executeNextTick()).toBe(true);
    const nativeRevoked = unpackUnitUpdates(
      nativePackets[1].packedUnitUpdates,
      nativePackets[1].packedMissileTimers,
    ).find((unit) => unit.id === ship.id());
    expect(nativeRevoked?.pos).toBe(returnSea);
    expect(nativeRevoked?.pos).not.toBe(farSea);
    expect(nativeRevoked?.troops).toBe(0);
    expect(nativeRevoked?.markedForDeletion).not.toBe(false);
    const observedHeapDeltaBytes = process.memoryUsage().heapUsed - initialHeap;
    const maxPageBytes = Math.max(
      ...[
        firstPage,
        hiddenPage,
        reconnectPage,
        returnPage,
        warshipPage,
        sensorLostPage,
      ].map((page) => Buffer.byteLength(JSON.stringify(page), "utf8")),
    );
    console.info(
      "[C5 FOG-04/05/06] shipId=" +
        shipId +
        " coastTile=" +
        coast +
        " nearSeaTile=" +
        nearSea +
        " farSeaTile=" +
        farSea +
        " pageBytesMax=" +
        maxPageBytes +
        " elapsedMs=" +
        (performance.now() - started).toFixed(2) +
        " recipientUnits=" +
        recipient.units().length +
        " reconnaissanceWarshipId=" +
        sensor.id() +
        " reacquiredTile=" +
        returnSea +
        " observedHeapDeltaBytes=" +
        observedHeapDeltaBytes +
        " nativePackets=" +
        nativePackets.length,
    );
    expect(maxPageBytes).toBeLessThan(2_000_000);
  });

  it("FOG-05/07 never reads the troop count of a hidden foreign transport", async () => {
    const game = await setup("big_plains", { nationalMode: true }, [
      VIEWER,
      OUTSIDER,
    ]);
    game.addExecution(
      new SpawnExecution("c5-hidden", VIEWER, game.ref(20, 100)),
      new SpawnExecution("c5-hidden", OUTSIDER, game.ref(195, 10)),
    );
    game.executeNextTick();
    game.executeNextTick();
    const hiddenShip = game
      .player(OUTSIDER.id)
      .buildUnit(UnitType.TransportShip, game.ref(195, 10), {
        troops: 4_444_444,
      });
    const privateRead = vi
      .spyOn(hiddenShip, "troops")
      .mockImplementation(() => {
        throw new Error("foreign private troop getter was accessed");
      });
    try {
      const observation = collectLiveNationalObservation(game, VIEWER.id);
      expect(
        observation.observation.visibleAssets.some(
          (asset) => asset.id === String(hiddenShip.id()),
        ),
      ).toBe(false);
      expect(privateRead).not.toHaveBeenCalled();
    } finally {
      privateRead.mockRestore();
    }
  });

  it("FOG-04/07 discloses an isolated owned offshore warship in the actual native map", async () => {
    const game = await setup("world", { nationalMode: true }, [
      VIEWER,
      OUTSIDER,
    ]);
    game.addExecution(
      new SpawnExecution("c5-isolated-ship", VIEWER, game.ref(375, 272)),
      new SpawnExecution("c5-isolated-ship", OUTSIDER, game.ref(1004, 250)),
    );
    game.executeNextTick();
    game.executeNextTick();
    const offshore = game.ref(1, 1);
    expect(game.isLand(offshore)).toBe(false);
    const owned = game.player(VIEWER.id).buildUnit(
      UnitType.Warship,
      offshore,
      { patrolTile: offshore },
    );
    const verified = collectLiveNationalObservation(game, VIEWER.id);
    const ownId = String(owned.id());
    expect(verified.observation.visibleAssets.find(
      (asset) => asset.id === ownId,
    )?.source).toBe("own");
    // Founding-source witness: the producer had a legitimate observing
    // warship anchor but failed to authorize its very own tile; the native
    // map pager consequently dropped its otherwise approved marker.
    expect(verified.visibleTiles.has(offshore)).toBe(true);
    const pager = new NationalObserverMapPager(
      game,
      VIEWER.id,
      "c5-e6-isolated-offshore",
    );
    const page = pager.page(verified);
    expect(page.units.some(
      (unit) => unit.id === owned.id() && unit.tile === offshore,
    )).toBe(true);

    // Exact default map-tile Euclidean threshold: x=1 warship sees x=201
    // (200 tiles), but never x=202 (201 tiles) on genuine ocean terrain.
    const justInside = game.ref(201, 1);
    const justOutside = game.ref(202, 1);
    expect(game.isLand(justInside)).toBe(false);
    expect(game.isLand(justOutside)).toBe(false);
    const foreignShip = game.player(OUTSIDER.id).buildUnit(
      UnitType.TransportShip,
      justOutside,
      { troops: 1_234_567 },
    );
    expect(collectLiveNationalObservation(game, VIEWER.id).observation.visibleAssets.some(
      (asset) => asset.id === String(foreignShip.id()),
    )).toBe(false);
    foreignShip.move(justInside);
    game.executeNextTick();
    const inside = collectLiveNationalObservation(game, VIEWER.id);
    expect(inside.observation.visibleAssets.find(
      (asset) => asset.id === String(foreignShip.id()),
    )?.source).toBe("warship");
    const acquired = pager.page(inside);
    expect(acquired.units.some((unit) => unit.id === foreignShip.id())).toBe(true);
    foreignShip.move(justOutside);
    game.executeNextTick();
    const outside = collectLiveNationalObservation(game, VIEWER.id);
    expect(outside.observation.visibleAssets.some(
      (asset) => asset.id === String(foreignShip.id()),
    )).toBe(false);
    const revoked = pager.page(outside);
    expect(revoked.unitRemovedIds).toContain(foreignShip.id());
    console.info(
      "[C5 FOG-04 own-sea] warshipId=" + ownId
      + " tile=" + offshore
      + " exactInside=" + justInside
      + " exactOutside=" + justOutside
      + " foreignShipId=" + foreignShip.id(),
    );
  });
});
