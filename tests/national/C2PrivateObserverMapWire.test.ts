/**
 * C2 E3 NEW M7 candidate: real server-owned Game + authenticated A/B/C
 * → E3 current sight → E2 actual bounded national_projection JSON + Zbin
 * → decoder. NOT a mock Game view or a client-selected observer.
 *
 * FOG-02: outsider terms/private invitation absence;
 * FOG-03: 100-tile border structure sight and far absence;
 * FOG-04: 200-tile real coastline/ship sight;
 * FOG-05: visible enemy transport never leaks its troops/landing destination.
 */
import {
  GameMode, GameType, PlayerInfo, PlayerType, UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import {
  NATIONAL_OBSERVER_MAX_TILES,
  type NationalObserverMapV1,
} from "@openfront/engine/national/observation/NationalObserverMap";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { decodeServerMessage, encodeServerMessage } from "@openfront/shared/ZbinWire";
import { describe, expect, it } from "vitest";
import { Client } from "../../src/server/Client";
import {
  encodeNationalRecipientProjection,
  MAX_NATIONAL_PROJECTION_BYTES,
} from "../../src/server/national/NationalRecipientWire";
import { TrustedNationalMatch } from "../../src/server/national/TrustedNationalMatch";
import { setup } from "../util/Setup";
import { TestConfig } from "../util/TestConfig";
import type { Game } from "@openfront/engine/game/Game";

const A = new PlayerInfo("North", PlayerType.Human, "C2E3CLIA", "C2E3NATIONA");
const B = new PlayerInfo("South", PlayerType.Human, "C2E3CLIB", "C2E3NATIONB");
const C = new PlayerInfo("West", PlayerType.Human, "C2E3CLIC", "C2E3NATIONC");
const P = [A, B, C];
const MATCH = "c2-e3-real-visibility";
const EMPIRE = "c2_e3_verified_empire";

class TrustedHostConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}
interface Socket {
  readyState: number;
  frames: Uint8Array[];
  send(bytes: Uint8Array): void;
}
function seat(p: PlayerInfo): { client: Client; socket: Socket } {
  const socket: Socket = {
    readyState: 1,
    frames: [],
    send(bytes) { this.frames.push(bytes); },
  };
  return {
    socket,
    client: new Client(
      p.clientID!,
      "persistent-" + p.id,
      {} as NonNullable<Client["claims"]>,
      null, undefined, "127.0.0.1", p.name, null,
      socket as unknown as Client["ws"],
      undefined, "verified-" + p.id, [],
    ),
  };
}
function view(socket: Socket) {
  const bytes = socket.frames[socket.frames.length - 1];
  expect(bytes).toBeDefined();
  const msg = decodeServerMessage(bytes, undefined);
  expect(msg.type).toBe("national_projection");
  if (msg.type !== "national_projection") throw new Error("wrong frame");
  expect(msg.payload.length).toBeLessThanOrEqual(MAX_NATIONAL_PROJECTION_BYTES);
  expect(msg.payload).not.toMatch(/GameSnapshot|canonicalTurn|secretTreaty|credentials|landingDestination/);
  const data = JSON.parse(msg.payload) as GameUpdateViewData & {
    nationalObserverMap?: NationalObserverMapV1;
  };
  expect(data.tick).toBe(msg.tick);
  return { msg, data, map: data.nationalObserverMap! };
}
async function rig(mapName: string, starts: number[]) {
  const game = await setup(
    mapName,
    { nationalMode: true, gameType: GameType.Private, gameMode: GameMode.FFA },
    P, undefined, TrustedHostConfig,
  );
  for (let i = 0; i < P.length; i++) {
    game.addExecution(new SpawnExecution(MATCH, P[i], starts[i]));
  }
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const p of P) expect(game.player(p.id).hasSpawned()).toBe(true);
  const runner = new GameRunner(
    game, new Executor(game, MATCH, undefined), () => {}, undefined,
  );
  const sockets = P.map(seat);
  const host = new TrustedNationalMatch(
    MATCH, runner, sockets.map((s) => s.client),
    (client, packet) => {
      const target = sockets.find((s) => s.client === client);
      if (!target) throw new Error("unrecognized host seat");
      const payload = encodeNationalRecipientProjection(packet);
      target.socket.send(encodeServerMessage({
        type: "national_projection", tick: packet.tick, payload,
      }, undefined));
    },
  );
  return { game, sockets, host };
}
function tickTwice(host: TrustedNationalMatch) {
  host.tick();
  host.tick();
}
function containsRef(map: NationalObserverMapV1, ref: number) {
  return map.tiles.some((tile) => tile[0] === ref);
}
function allOwn(map: NationalObserverMapV1, game: Game) {
  for (const tile of map.tiles) {
    expect(tile).toHaveLength(4);
    const [ref, packedState, terrainByte, borderMask] = tile;
    expect(game.map().tileState(ref)).toBe(packedState);
    expect(game.map().terrainByte(ref)).toBe(terrainByte);
    expect(borderMask).toBeGreaterThanOrEqual(0);
    expect(borderMask).toBeLessThanOrEqual(15);
  }
  expect(map.tiles.length).toBeLessThanOrEqual(NATIONAL_OBSERVER_MAX_TILES);
  expect(map.version).toBe(1);
  expect(map.width).toBe(game.width());
  expect(map.height).toBe(game.height());
  expect(map.tick).toBe(game.ticks());
}

describe("C2 First Class E3: new M7 actual observer map + recipient wire", () => {
  it("FOG-02/03: three distinct signed seats get identical public roster, individual map/offer privacy and 100-tile real border sightings", async () => {
    const initial = await setup("big_plains", { nationalMode: true }, P);
    const starts = [initial.ref(20, 100), initial.ref(80, 100), initial.ref(180, 180)];
    const { game, host, sockets } = await rig("big_plains", starts);
    const nearTile = game.ref(80, 100);
    const farTile = game.ref(180, 180);
    const nearCity = game.player(B.id).buildUnit(UnitType.City, nearTile, {});
    const farCity = game.player(C.id).buildUnit(UnitType.City, farTile, {});
    game.player(B.id).setTroops(9_876_543);
    // Real E1 political state contains a confidential pact constitution.
    // Its admission/expulsion terms must never enter an unrelated national
    // observer-map or player update on the authenticated socket.
    game.performNationalCommand(game.player(A.id), {
      kind: "found-pact",
      pactId: "c2_e3_secret_mda",
      name: "Verified Pact",
      pactKind: "MDA",
      terms: { admission: "unanimous", expulsion: "forbidden" },
    }, A.clientID!);
    host.tick(); // real host-created GameRunner tick and three socket frames
    const [a, b, c] = sockets.map((s) => view(s.socket));
    expect(a.data.nationalPolitics).toEqual(b.data.nationalPolitics);
    expect(a.data.nationalPolitics).toEqual(c.data.nationalPolitics);
    expect([a.map.observerId, b.map.observerId, c.map.observerId]).toEqual([
      A.id, B.id, C.id,
    ]);
    for (const v of [a, b, c]) {
      expect(v.map).toBeDefined();
      expect(v.map.reset).toBe(true);
      expect(v.map.cursor).toBe(0);
      allOwn(v.map, game);
      expect(v.data).not.toHaveProperty("game");
      expect(v.data).not.toHaveProperty("canonicalTurns");
      expect(v.data).not.toHaveProperty("GameSnapshot");
    }
    const liveA = collectLiveNationalObservation(game, A.id);
    expect(liveA.observation.visibleAssets.map((u) => u.id)).toContain(
      String(nearCity.id()),
    );
    expect(liveA.observation.visibleAssets.map((u) => u.id)).not.toContain(
      String(farCity.id()),
    );
    expect(a.map.units.map((u) => u.id)).toContain(nearCity.id());
    expect(a.map.units.map((u) => u.id)).not.toContain(farCity.id());
    expect(a.map.units.find((u) => u.id === nearCity.id())).not.toHaveProperty("troops");
    expect(a.msg.payload).not.toContain("9876543");
    expect(a.msg.payload).not.toContain("secretTreaty");
    expect(a.msg.payload).not.toContain("terms");
    expect(c.msg.payload).not.toContain("unanimous");
    expect(c.msg.payload).not.toContain("forbidden");
    expect(c.msg.payload).not.toContain("c2_e3_secret_mda");
    expect(a.map.countries.map((n) => n.id)).toEqual(expect.arrayContaining([
      A.id, B.id, C.id,
    ]));
    // No remote nation can induce a different tile cursor: the host controls
    // progression and the same authoritative current Game decides membership.
    host.tick();
    const followA = view(sockets[0].socket);
    expect(followA.map.reset).toBe(false);
    expect(followA.map.cursor).toBe(
      a.map.nextCursor === null ? 0 : a.map.nextCursor,
    );

    // A's real E1 offer is visible to B, not A/C.
    expect(host.submit(sockets[0].client, {
      type: "national_found_empire",
      empireId: EMPIRE, requestId: "found_c2_e3",
    })).toBe(true);
    tickTwice(host);
    expect(host.submit(sockets[0].client, {
      type: "national_offer_empire",
      empireId: EMPIRE, candidateId: B.id,
      requestId: "np_" + "4".repeat(32),
    })).toBe(true);
    tickTwice(host);
    const a2 = view(sockets[0].socket);
    const b2 = view(sockets[1].socket);
    const c2 = view(sockets[2].socket);
    expect(b2.data.nationalAccessionOffers?.recipientId).toBe(B.id);
    expect(b2.data.nationalAccessionOffers?.offers).toEqual([
      expect.objectContaining({ candidateId: B.id, proposerId: A.id }),
    ]);
    expect(a2.data.nationalAccessionOffers?.offers).toEqual([]);
    expect(c2.data.nationalAccessionOffers?.offers).toEqual([]);
    expect(a2.data.nationalCommandResults).toEqual([
      expect.objectContaining({ actorId: A.id, recipientId: A.id }),
    ]);
    expect(b2.data.nationalCommandResults).toBeUndefined();
    expect(c2.data.nationalCommandResults).toBeUndefined();

    const prior = sockets[1].socket.frames.length;
    sockets[1].socket.readyState = 3;
    host.tick();
    expect(sockets[1].socket.frames).toHaveLength(prior);
    // The old socket never regains permission on a new physical ws.
    sockets[1].socket.readyState = 1;
    host.tick();
    expect(sockets[1].socket.frames).toHaveLength(prior);

    // A fully new, host-accepted connection for the SAME verified principal
    // gets its own map reset and current invitation, not an old socket's
    // previously delivered private command journal or fog cache.
    const replacement: Socket = {
      readyState: 1, frames: [],
      send(bytes) { this.frames.push(bytes); },
    };
    sockets[1].client.ws = replacement as unknown as Client["ws"];
    expect(host.resumeRecipient(sockets[1].client)).toBe(true);
    host.tick();
    const resumed = view(replacement);
    expect(resumed.map.observerId).toBe(B.id);
    expect(resumed.map.reset).toBe(true);
    expect(resumed.map.cursor).toBe(0);
    expect(resumed.data.nationalCommandResults).toBeUndefined();
    expect(resumed.data.nationalAccessionOffers?.recipientId).toBe(B.id);
    expect(resumed.data.nationalAccessionOffers?.offers).toEqual([
      expect.objectContaining({ candidateId: B.id, proposerId: A.id }),
    ]);
    expect(sockets[1].socket.frames).toHaveLength(prior);
  });

  it("FOG-04/05: actual coastal 200-tile sight reveals an enemy ship marker but not the transport landing plan or troops", async () => {
    const initial = await setup("half_land_half_ocean", { nationalMode: true }, P);
    const land: number[] = [];
    let coast: number | undefined;
    let water: number | undefined;
    for (let y = 1; y < initial.height() - 1; y++) {
      for (let x = 1; x < initial.width() - 1; x++) {
        const tile = initial.ref(x, y);
        if (!initial.isLand(tile)) continue;
        land.push(tile);
        if (coast === undefined) initial.forEachNeighbor(tile, (neighbor) => {
          if (!initial.isLand(neighbor) && coast === undefined) {
            coast = tile;
            water = neighbor;
          }
        });
      }
    }
    expect(coast).toBeDefined();
    expect(water).toBeDefined();
    const far = land.filter((t) => t !== coast).sort((a, b) =>
      initial.map().euclideanDistSquared(b, coast!) -
      initial.map().euclideanDistSquared(a, coast!),
    );
    expect(far.length).toBeGreaterThan(2);
    const starts = [coast!, far[0], far[1]];
    const { game, host, sockets } = await rig("half_land_half_ocean", starts);
    const hiddenTarget = far[2];
    const transport = game.player(B.id).buildUnit(UnitType.TransportShip, water!, {
      troops: 7_654_321, targetTile: hiddenTarget,
    });
    host.tick();
    const a = view(sockets[0].socket);
    const b = view(sockets[1].socket);
    const c = view(sockets[2].socket);
    const known = a.map.units.find((u) => u.id === transport.id());
    expect(known).toMatchObject({
      id: transport.id(), ownerId: B.id,
      kind: "transport", tile: water!,
    });
    expect(known).not.toHaveProperty("troops");
    expect(known).not.toHaveProperty("landingDestination");
    expect(known).not.toHaveProperty("targetTile");
    expect(a.msg.payload).not.toContain("7654321");
    expect(a.msg.payload).not.toContain("landingDestination");
    expect(a.msg.payload).not.toContain("targetTile");
    expect(a.map.units).not.toHaveProperty("hiddenTroops");
    expect(b.map.observerId).toBe(B.id);
    expect(c.map.observerId).toBe(C.id);
    expect(a.map.units.every((u) => u.ownerId === A.id || u.troops === undefined)).toBe(true);
    expect(collectLiveNationalObservation(game, A.id).visibleTiles.has(water!)).toBe(true);
  });
});
