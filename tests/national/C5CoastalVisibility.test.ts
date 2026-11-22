import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { setup } from "../util/Setup";

const VIEWER = new PlayerInfo(
  "C5 Viewer",
  PlayerType.Human,
  "c5-e6-viewer-client",
  "c5-e6-viewer",
);
const ALLY = new PlayerInfo(
  "C5 Ally",
  PlayerType.Nation,
  null,
  "c5-e6-ally",
);
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
    const sharedShip = game.player(ALLY.id).buildUnit(UnitType.TransportShip, allyTile, {
      troops: 991_337,
      targetTile: outsiderTile,
    });
    const hiddenCity = game.player(OUTSIDER.id).buildUnit(
      UnitType.City,
      outsiderTile,
      {},
    );
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
    expect(before.observation.visibleAssets.find(
      (asset) => asset.id === String(sharedShip.id()),
    )?.source).toBe("empire");
    expect(before.observation.visibleAssets.some(
      (asset) => asset.id === String(hiddenCity.id()),
    )).toBe(false);

    // Founding-source FOG-06/07 witness: the AUTHORITY reports a stale
    // membersOf list while its current reciprocal empireOf rejects the ally.
    // The sight-index already rejects this member, but the projection's
    // raw coalition roster used to grant its units anyway.
    const authority = game.nationalPoliticalAuthority()!;
    const spy = vi.spyOn(game, "nationalPoliticalAuthority");
    spy.mockImplementation(() => ({
      ...authority,
      empireOf: (id: string) =>
        id === ALLY.id ? null : authority.empireOf(id),
    }));
    try {
      const revoked = collectLiveNationalObservation(game, VIEWER.id);
      expect(revoked.visibleTiles.has(allyTile)).toBe(false);
      expect(revoked.observation.visibleAssets.some(
        (asset) => asset.id === String(sharedShip.id()),
      )).toBe(false);
      expect(revoked.observation.visibleAssets.some(
        (asset) => asset.id === String(hiddenCity.id()),
      )).toBe(false);
      expect(revoked.observation.coalitions.find(
        (coalition) => coalition.id === "c5_e6_sight",
      )?.members).toEqual([VIEWER.id]);
    } finally {
      spy.mockRestore();
    }
  });
});
