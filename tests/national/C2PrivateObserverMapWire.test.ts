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
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { OFFSET_TARGET_TILE, OFFSET_TROOPS } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import {
  NATIONAL_OBSERVER_MAX_TILES,
  NationalObserverMapPager,
  type NationalObserverMapV1,
} from "@openfront/engine/national/observation/NationalObserverMap";
import {
  decodeServerMessage,
  encodeServerMessage,
} from "@openfront/shared/ZbinWire";
import { describe, expect, it } from "vitest";
import { NationalObserverMapContinuity } from "../../src/client/NationalObserverMapContinuity";
import { parseTrustedNationalProjection } from "../../src/client/TrustedNationalSession";
import { Client } from "../../src/server/Client";
import {
  encodeNationalRecipientProjection,
  MAX_NATIONAL_PROJECTION_BYTES,
} from "../../src/server/national/NationalRecipientWire";
import { TrustedNationalMatch } from "../../src/server/national/TrustedNationalMatch";
import { setup } from "../util/Setup";
import { TestConfig } from "../util/TestConfig";

const A = new PlayerInfo("North", PlayerType.Human, "C2E3CLIA", "C2NATIONA");
const B = new PlayerInfo("South", PlayerType.Human, "C2E3CLIB", "C2NATIONB");
const C = new PlayerInfo("West", PlayerType.Human, "C2E3CLIC", "C2NATIONC");
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
    send(bytes) {
      this.frames.push(bytes);
    },
  };
  return {
    socket,
    client: new Client(
      p.clientID!,
      "persistent-" + p.id,
      {} as NonNullable<Client["claims"]>,
      null,
      undefined,
      "127.0.0.1",
      p.name,
      null,
      socket as unknown as Client["ws"],
      undefined,
      "verified-" + p.id,
      [],
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
  expect(msg.payload).not.toMatch(
    /GameSnapshot|canonicalTurn|secretTreaty|credentials|landingDestination/,
  );
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
    P,
    undefined,
    TrustedHostConfig,
  );
  for (let i = 0; i < P.length; i++) {
    game.addExecution(new SpawnExecution(MATCH, P[i], starts[i]));
  }
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  for (const p of P) expect(game.player(p.id).hasSpawned()).toBe(true);
  const runner = new GameRunner(
    game,
    new Executor(game, MATCH, undefined),
    () => {},
    undefined,
  );
  const sockets = P.map(seat);
  const measurements = { wireMs: 0 };
  const host = new TrustedNationalMatch(
    MATCH,
    runner,
    sockets.map((s) => s.client),
    (client, packet) => {
      const target = sockets.find((s) => s.client === client);
      if (!target) throw new Error("unrecognized host seat");
      const wireStarted = performance.now();
      const payload = encodeNationalRecipientProjection(packet);
      // E2's real GameServer emits on Client.ws AFTER an original-seat
      // reconnect. Do not pin this test delivery to the first socket object.
      (client.ws as unknown as Socket).send(
        encodeServerMessage(
          {
            type: "national_projection",
            tick: packet.tick,
            payload,
          },
          undefined,
        ),
      );
      measurements.wireMs += performance.now() - wireStarted;
    },
  );
  return { game, sockets, host, measurements };
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
    const starts = [
      initial.ref(20, 100),
      initial.ref(80, 100),
      initial.ref(180, 180),
    ];
    const { game, host, sockets } = await rig("big_plains", starts);
    const nearTile = game.ref(80, 100);
    const farTile = game.ref(180, 180);
    const nearCity = game.player(B.id).buildUnit(UnitType.City, nearTile, {});
    const farCity = game.player(C.id).buildUnit(UnitType.City, farTile, {});
    game.player(B.id).setTroops(9_876_543);
    // Real E1 political state contains a confidential pact constitution.
    // Its admission/expulsion terms must never enter an unrelated national
    // observer-map or player update on the authenticated socket.
    game.performNationalCommand(
      game.player(A.id),
      {
        kind: "found-pact",
        pactId: "c2_e3_secret_mda",
        name: "Verified Pact",
        pactKind: "MDA",
        terms: { admission: "unanimous", expulsion: "forbidden" },
      },
      A.clientID!,
    );
    host.tick(); // real host-created GameRunner tick and three socket frames
    const [a, b, c] = sockets.map((s) => view(s.socket));
    expect(a.data.nationalPolitics).toEqual(b.data.nationalPolitics);
    expect(a.data.nationalPolitics).toEqual(c.data.nationalPolitics);
    expect([a.map.observerId, b.map.observerId, c.map.observerId]).toEqual([
      A.id,
      B.id,
      C.id,
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
    expect(containsRef(a.map, game.ref(20, 100))).toBe(true);
    expect(a.map.units.map((u) => u.id)).toContain(nearCity.id());
    expect(a.map.units.map((u) => u.id)).not.toContain(farCity.id());
    expect(a.map.units.find((u) => u.id === nearCity.id())).not.toHaveProperty(
      "troops",
    );
    expect(a.msg.payload).not.toContain("9876543");
    expect(a.msg.payload).not.toContain("secretTreaty");
    expect(a.msg.payload).not.toContain("terms");
    expect(c.msg.payload).not.toContain("unanimous");
    expect(c.msg.payload).not.toContain("forbidden");
    expect(c.msg.payload).not.toContain("c2_e3_secret_mda");
    expect(a.map.countries.map((n) => n.id)).toEqual(
      expect.arrayContaining([A.id, B.id, C.id]),
    );
    // No remote nation can induce a different tile cursor: the host controls
    // progression and the same authoritative current Game decides membership.
    host.tick();
    const followA = view(sockets[0].socket);
    expect(followA.map.reset).toBe(false);
    expect(followA.map.cursor).toBe(a.map.nextCursor ?? 0);

    // A's real E1 offer is visible to B, not A/C.
    expect(
      host.submit(sockets[0].client, {
        type: "national_found_empire",
        empireId: EMPIRE,
        requestId: "found_c2_e3",
      }),
    ).toBe(true);
    tickTwice(host);
    expect(
      host.submit(sockets[0].client, {
        type: "national_offer_empire",
        empireId: EMPIRE,
        candidateId: B.id,
        requestId: "np_" + "4".repeat(32),
      }),
    ).toBe(true);
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
      readyState: 1,
      frames: [],
      send(bytes) {
        this.frames.push(bytes);
      },
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

  it("FOG-02 negative: real E3 host projection cannot be made to serialize nested secret WAR clauses, raw turns or a foreign troop canary", async () => {
    const init = await setup("plains", { nationalMode: true }, P);
    const { host, sockets } = await rig("plains", [
      init.ref(15, 20),
      init.ref(45, 35),
      init.ref(70, 50),
    ]);
    host.tick();
    const a = view(sockets[0].socket);
    const attacked = {
      ...a.data,
      canonicalTurns: [{ secret: "SECRET_CANONICAL_HISTORY" }],
      gameSnapshot: { authority: "SECRET_FULL_GAME" },
      claims: { bearer: "SECRET_SOCKET_CREDENTIALS" },
      nationalConflicts: {
        version: 1,
        recipientId: A.id,
        layers: [
          {
            id: "safe_public_id",
            scope: "national",
            first: { kind: "nation", id: A.id },
            second: { kind: "nation", id: B.id },
            declaredBy: A.id,
            startedTick: 0,
            endedTick: null,
            secretTreatyTerms: "SECRET_NESTED_PACT",
          },
        ],
        motions: [
          {
            id: "motion_public_id",
            layerId: "safe_public_id",
            proposedBy: A.id,
            proposingSide: 0,
            proposedTick: 0,
            acceptedTick: null,
            acceptedBy: null,
            privateTerms: "SECRET_PRIVATE_PEACE",
          },
        ],
      },
    } as unknown as GameUpdateViewData;
    const encoded = encodeNationalRecipientProjection(attacked);
    for (const secret of [
      "SECRET_CANONICAL_HISTORY",
      "SECRET_FULL_GAME",
      "SECRET_SOCKET_CREDENTIALS",
      "SECRET_NESTED_PACT",
      "SECRET_PRIVATE_PEACE",
      "canonicalTurns",
      "gameSnapshot",
    ])
      expect(encoded).not.toContain(secret);

    // Even a future mistakenly assembled filtered DTO must fail before
    // a foreign player's numeric troop count enters the network encoder.
    const forged = {
      ...a.data,
      nationalObserverMap: {
        ...a.map,
        units: [
          ...a.map.units,
          {
            id: 12345,
            ownerId: B.id,
            kind: "transport",
            tile: init.ref(45, 35),
            troops: 6_666_666,
          },
        ],
      },
    } as unknown as GameUpdateViewData;
    expect(() => encodeNationalRecipientProjection(forged)).toThrow(
      "NATIONAL invalid bounded observer-map v1",
    );
  });

  it("FOG-04/05: actual coastal 200-tile sight reveals an enemy ship marker but not the transport landing plan or troops", async () => {
    const initial = await setup(
      "half_land_half_ocean",
      { nationalMode: true },
      P,
    );
    const land: number[] = [];
    let coast: number | undefined;
    let water: number | undefined;
    for (let y = 1; y < initial.height() - 1; y++) {
      for (let x = 1; x < initial.width() - 1; x++) {
        const tile = initial.ref(x, y);
        if (!initial.isLand(tile)) continue;
        land.push(tile);
        if (coast === undefined)
          initial.forEachNeighbor(tile, (neighbor) => {
            if (!initial.isLand(neighbor) && coast === undefined) {
              coast = tile;
              water = neighbor;
            }
          });
      }
    }
    expect(coast).toBeDefined();
    expect(water).toBeDefined();
    const far = land
      .filter((t) => t !== coast)
      .sort(
        (a, b) =>
          initial.map().euclideanDistSquared(b, coast!) -
          initial.map().euclideanDistSquared(a, coast!),
      );
    expect(far.length).toBeGreaterThan(2);
    const starts = [coast!, far[0], far[1]];
    const { game, host, sockets } = await rig("half_land_half_ocean", starts);
    const hiddenTarget = far[2];
    const transport = game
      .player(B.id)
      .buildUnit(UnitType.TransportShip, water!, {
        troops: 7_654_321,
        targetTile: hiddenTarget,
      });
    host.tick();
    const a = view(sockets[0].socket);
    const b = view(sockets[1].socket);
    const c = view(sockets[2].socket);
    const known = a.map.units.find((u) => u.id === transport.id());
    expect(known).toMatchObject({
      id: transport.id(),
      ownerId: B.id,
      kind: "transport",
      tile: water!,
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
    expect(
      a.map.units.every((u) => u.ownerId === A.id || u.troops === undefined),
    ).toBe(true);
    expect(
      collectLiveNationalObservation(game, A.id).visibleTiles.has(water!),
    ).toBe(true);
  });
});

/**
 * C3 E3 independent regression: the real host/authoritative Game/encoded Zbin
 * now carry separate server-owned map and unit sweeps. The synthetic attacker
 * objects below are malicious *incoming* packets, never substituted for the
 * authoritative Game or for the legitimate first decoded wire.
 */
describe("C3 E3 real host bounded continuity and adversarial receiver", () => {
  it("sweeps more than 4096 authorized real tiles without duplicates or lost pages, and fails closed on replay/cursor/stream forgery", async () => {
    const init = await setup("big_plains", { nationalMode: true }, P);
    const { game, host, sockets } = await rig("big_plains", [
      init.ref(20, 100),
      init.ref(150, 150),
      init.ref(190, 190),
    ]);
    // This is the genuine server-owned map and Player.conquer path, not a
    // fabricated GameSnapshot or manually granted browser visibility.
    const a = game.player(A.id);
    for (let y = 5; y < 86; y++) {
      for (let x = 5; x < 86; x++) {
        const ref = game.ref(x, y);
        if (game.isLand(ref) && game.owner(ref) !== a) a.conquer(ref);
      }
    }
    const legallyVisible = collectLiveNationalObservation(
      game,
      A.id,
    ).visibleTiles;
    expect(legallyVisible.size).toBeGreaterThan(4096);
    host.tick();
    const first = view(sockets[0].socket);
    const b = view(sockets[1].socket);
    const c = view(sockets[2].socket);
    expect(first.map.streamId).toBeTruthy();
    expect(first.map.streamId).not.toBe(b.map.streamId);
    expect(first.map.streamId).not.toBe(c.map.streamId);
    expect(first.map.reset).toBe(true);
    expect(first.map.cursor).toBe(0);
    expect(first.map.tiles).toHaveLength(4096);
    expect(first.map.nextCursor).toBe(4096);
    const reader = new NationalObserverMapContinuity(A.id);
    const accepted = reader.accept(first.map, first.msg.tick);
    expect(accepted.clearAllTiles).toBe(true);
    expect(accepted.sweepComplete).toBe(false);
    expect(reader.tileStatus(first.map.tiles[0][0])).toBe("observed");

    const tickBeforeAttack = reader.lastAcceptedTick;
    for (const fake of [
      { ...first.map, tick: first.map.tick + 1 },
      { ...first.map, observerId: B.id, tick: first.map.tick + 1 },
      { ...first.map, streamId: "malicious-socket", tick: first.map.tick + 1 },
      { ...first.map, cursor: 0, tick: first.map.tick + 1 },
      { ...first.map, reset: true, tick: first.map.tick + 1 },
      {
        ...first.map,
        cursor: 4096,
        tilePageSlots: 1,
        tick: first.map.tick + 1,
      },
      {
        ...first.map,
        cursor: 4096,
        sweepId: first.map.sweepId + 2,
        tick: first.map.tick + 1,
      },
    ]) {
      expect(() => reader.accept(fake, first.msg.tick + 1)).toThrow();
      expect(reader.lastAcceptedTick).toBe(tickBeforeAttack);
    }

    const sentRefs = new Set(first.map.tiles.map(([ref]) => ref));
    const sweepId = first.map.sweepId;
    let last = first;
    for (let steps = 0; steps < 20 && last.map.nextCursor !== null; steps++) {
      host.tick();
      last = view(sockets[0].socket);
      if (steps === 0) {
        const neverDisclosed = last.map.tiles[0][0];
        expect(() =>
          reader.accept(
            {
              ...last.map,
              tileRemovedRefs: [neverDisclosed],
              tiles: last.map.tiles.slice(1),
            },
            last.msg.tick,
          ),
        ).toThrow();
        expect(() =>
          reader.accept(
            {
              ...last.map,
              tilePageSlots: 4097,
            },
            last.msg.tick,
          ),
        ).toThrow();
        expect(reader.lastAcceptedTick).toBe(tickBeforeAttack);
      }
      const delta = reader.accept(last.map, last.msg.tick);
      expect(last.map.sweepId).toBe(sweepId);
      expect(delta.clearAllTiles).toBe(false);
      for (const [ref] of last.map.tiles) {
        expect(sentRefs.has(ref)).toBe(false);
        expect(legallyVisible.has(ref)).toBe(true);
        sentRefs.add(ref);
      }
    }
    expect(last.map.nextCursor).toBeNull();
    expect(sentRefs.size).toBe(legallyVisible.size);
    expect(reader.tileStatus(first.map.tiles[0][0])).toBe("observed");
    host.tick();
    const repeated = view(sockets[0].socket);
    expect(repeated.map.sweepId).toBeGreaterThan(sweepId);
    expect(repeated.map.cursor).toBe(0);
    expect(repeated.map.sweepTick).toBe(repeated.map.tick);
    reader.accept(repeated.map, repeated.msg.tick);
    expect(() => reader.accept(last.map, last.msg.tick)).toThrow();
    expect(b.map.observerId).toBe(B.id);
    expect(c.map.observerId).toBe(C.id);
  });

  it("pages >2048 real visible units, removes revoked enemy markers immediately and rejects hostile troop/count or revocation forgeries", async () => {
    const init = await setup("big_plains", { nationalMode: true }, P);
    const { game, host, sockets } = await rig("big_plains", [
      init.ref(20, 100),
      init.ref(80, 100),
      init.ref(190, 190),
    ]);
    const target = game.ref(80, 100);
    // Real Game units at a visible border structure location; intentionally
    // overloaded to exercise a single-tick pagination cap, NOT a browser mock.
    const foreign = [];
    for (let i = 0; i < 2051; i++) {
      foreign.push(game.player(B.id).buildUnit(UnitType.City, target, {}));
    }
    game.player(B.id).setTroops(8_876_543);
    host.tick();
    const one = view(sockets[0].socket);
    const reader = new NationalObserverMapContinuity(A.id);
    expect(one.map.unitsTruncated).toBe(true);
    expect(one.map.units).toHaveLength(2048);
    expect(one.map.unitNextCursor).toBe(2048);
    const packet = parseTrustedNationalProjection(one.msg.payload, one.msg.tick);
    const native = packet.packedUnitUpdates as unknown[];
    expect(native[OFFSET_TARGET_TILE]).toBeNull();
    const fresh = new NationalObserverMapContinuity(A.id, one.map.streamId);
    expect(() => new NationalObserverMapContinuity(A.id, "old-stream").acceptProjection(packet)).toThrow();
    for (const [offset, value] of [[OFFSET_TARGET_TILE, 123], [OFFSET_TROOPS, 9876543]] as const) {
      const forged = [...native];
      forged[offset] = value;
      expect(() => fresh.acceptProjection({
        ...packet, packedUnitUpdates: forged,
      })).toThrow();
      expect(fresh.lastAcceptedTick).toBe(-1);
    }
    expect(() => fresh.acceptProjection({
      ...packet, nationalCommandResults: [{ actorId: B.id, recipientId: B.id }],
    })).toThrow();
    expect(() => fresh.acceptProjection({
      ...packet, packedTileUpdates: [9999, 42],
    })).toThrow();
    const u1 = reader.acceptProjection(packet);
    expect(Number.isNaN(u1.nativeUnits![OFFSET_TARGET_TILE])).toBe(true);
    expect(u1.clearAllUnits).toBe(true);
    expect(one.msg.payload).not.toContain("8876543");
    expect(one.map.units.every((unit) => unit.troops === undefined)).toBe(true);

    // The highest ID has never crossed A's first 2048-marker page.
    // Moving it beyond A's sight MUST NOT leak its historical existence
    // through a new unitRemovedIds tombstone on the next frame.
    const neverEmitted = foreign[foreign.length - 1];
    neverEmitted.move(game.ref(195, 195));
    host.tick();
    const two = view(sockets[0].socket);
    expect(two.map.unitRemovedIds).not.toContain(neverEmitted.id());
    expect(two.map.units.some((unit) => unit.id === neverEmitted.id())).toBe(
      false,
    );
    const u2 = reader.accept(two.map, two.msg.tick);
    expect(u2.unitSweepComplete).toBe(true);
    expect(u2.clearAllUnits).toBe(false);
    expect(reader.observedUnitCount).toBeGreaterThanOrEqual(2050);

    // The foreign marker is still present in the authoritative Game but
    // becomes invisible when it moves outside the current sight boundary.
    const removed = foreign[0];
    removed.move(game.ref(195, 195));
    host.tick();
    const revoked = view(sockets[0].socket);
    expect(revoked.map.unitRemovedIds).toContain(removed.id());
    expect(
      revoked.map.units.find((unit) => unit.id === removed.id()),
    ).toBeUndefined();
    const delta = reader.accept(revoked.map, revoked.msg.tick);
    expect(delta.removedUnitIds).toContain(removed.id());
    expect(reader.units().some((unit) => unit.id === removed.id())).toBe(false);
    // Only ID tombstone crosses the wire; no hidden new position or orders.
    expect(revoked.msg.payload).not.toContain('"targetTile"');
    expect(revoked.msg.payload).not.toContain('"landingDestination"');

    const hostile = {
      ...revoked.map,
      tick: revoked.map.tick + 1,
      unitRemovedIds: [removed.id(), removed.id()],
    };
    expect(() => reader.accept(hostile, hostile.tick)).toThrow();
    const foreignTroops = {
      ...revoked.map,
      tick: revoked.map.tick + 1,
      units: [
        {
          id: removed.id(),
          ownerId: B.id,
          kind: "transport",
          tile: game.ref(195, 195),
          troops: 9_999_991,
        },
      ],
    };
    expect(() => reader.accept(foreignTroops, foreignTroops.tick)).toThrow();
    expect(reader.observedUnitCount).toBeGreaterThan(2000);
  });

  it("revocation of genuine empire-contributed tiles discards cached visible ownership without forced rewind", async () => {
    const init = await setup("big_plains", { nationalMode: true }, P);
    const { game, host, sockets } = await rig("big_plains", [
      init.ref(20, 20),
      init.ref(65, 100),
      init.ref(190, 190),
    ]);
    const empire = "c3_e3_reset_empire";
    const a = game.player(A.id);
    const b = game.player(B.id);
    game.performNationalCommand(
      a,
      { kind: "found-empire", empireId: empire },
      A.clientID!,
    );
    game.performNationalCommand(
      a,
      {
        kind: "offer-empire",
        empireId: empire,
        candidateId: B.id,
      },
      A.clientID!,
    );
    game.performNationalCommand(
      b,
      {
        kind: "accept-empire",
        empireId: empire,
        candidateId: B.id,
      },
      B.clientID!,
    );
    const allyRef = b.spawnTile()!;
    expect(
      collectLiveNationalObservation(game, A.id).visibleTiles.has(allyRef),
    ).toBe(true);
    host.tick();
    const allied = view(sockets[0].socket);
    const reader = new NationalObserverMapContinuity(A.id);
    reader.accept(allied.map, allied.msg.tick);
    // A reciprocal member is removed by the same real authoritative
    // tile-relinquish elimination used by the existing FOG-06/07 fixture.
    for (const tile of [...b.tiles()]) b.relinquish(tile);
    game.executeNextTick();
    expect(
      collectLiveNationalObservation(game, A.id).visibleTiles.has(allyRef),
    ).toBe(false);
    host.tick();
    const after = view(sockets[0].socket);
    const d = reader.accept(after.map, after.msg.tick);
    expect(d.clearAllTiles || d.removedTileRefs.includes(allyRef)).toBe(true);
    expect(reader.tileStatus(allyRef)).toBe("revoked");
    expect(
      after.map.tiles.every(([ref]) =>
        collectLiveNationalObservation(game, A.id).visibleTiles.has(ref),
      ),
    ).toBe(true);
  });
});

describe("C4 E3 continuous authoritative churn", () => {
  it("makes progress across both frozen streams during repeated real territorial churn", async () => {
    const init = await setup("big_plains", { nationalMode: true }, P);
    const { game, host, sockets, measurements } = await rig("big_plains", [
      init.ref(20, 100),
      init.ref(150, 150),
      init.ref(190, 190),
    ]);
    const a = game.player(A.id);
    const b = game.player(B.id);
    for (let y = 5; y < 86; y++) {
      for (let x = 5; x < 86; x++) {
        const ref = game.ref(x, y);
        if (game.isLand(ref) && game.owner(ref) !== a) a.conquer(ref);
      }
    }
    const remote = game.ref(115, 115);
    const units = [];
    for (let i = 0; i < 2055; i++)
      units.push(a.buildUnit(UnitType.City, game.ref(20, 20), {}));
    a.conquer(remote);
    const readers = P.map((p) => new NationalObserverMapContinuity(p.id));
    const seen = new Set<number>();
    const known = new Set<number>();
    let firstTileComplete = -1;
    let firstUnitComplete = -1;
    let peakBytes = 0;
    let resets = 0;
    let holes = 0;
    let hostMs = 0;
    let producerMs = 0;
    let reconcileMs = 0;
    let revokedDisclosures = 0;
    const profilers = P.map(
      (p) => new NationalObserverMapPager(game, p.id, "profile-" + p.id),
    );
    const startHeap = process.memoryUsage().heapUsed;
    let peakHeap = startHeap;
    for (let frame = 0; frame < 8; frame++) {
      if (frame % 2 === 1) b.conquer(remote);
      else if (frame > 0) a.conquer(remote);
      units[0].move(game.ref(frame % 2 === 0 ? 20 : 21, 20));
      const started = performance.now();
      host.tick();
      hostMs += performance.now() - started;
      for (let i = 0; i < P.length; i++) {
        const v = view(sockets[i].socket);
        const readStarted = performance.now();
        const delta = readers[i].acceptProjection(
          parseTrustedNationalProjection(v.msg.payload, v.msg.tick),
        );
        reconcileMs += performance.now() - readStarted;
        const frames = sockets[i].socket.frames;
        peakBytes = Math.max(peakBytes, frames[frames.length - 1].byteLength);
        const sight = collectLiveNationalObservation(game, P[i].id);
        const producerStarted = performance.now();
        profilers[i].page(sight);
        producerMs += performance.now() - producerStarted;
        for (const [ref] of delta.tiles)
          expect(sight.visibleTiles.has(ref)).toBe(true);
        if (i !== 0) continue;
        for (const ref of known) {
          if (!sight.visibleTiles.has(ref)) {
            expect(readers[i].tileStatus(ref)).toBe("revoked");
            revokedDisclosures++;
          }
        }
        if (delta.clearAllTiles) {
          known.clear();
          resets++;
        }
        for (const ref of delta.removedTileRefs) {
          expect(known.delete(ref)).toBe(true);
          expect(readers[i].tileStatus(ref)).toBe("revoked");
        }
        for (const [ref] of delta.tiles) known.add(ref);
        for (const unit of delta.units) seen.add(unit.id);
        holes += v.map.tilePageSlots - v.map.tiles.length;
        for (const ref of known) expect(sight.visibleTiles.has(ref)).toBe(true);
        expect(delta.usable).toBe(true);
        if (delta.sweepComplete && firstTileComplete < 0)
          firstTileComplete = frame;
        if (delta.unitSweepComplete && firstUnitComplete < 0)
          firstUnitComplete = frame;
        if (frame === 0) {
          expect(v.map.nextCursor).toBe(4096);
          expect(v.map.unitNextCursor).toBe(2048);
        }
      }
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }
    expect(firstTileComplete).toBe(1);
    expect(firstUnitComplete).toBe(1);
    expect(resets).toBe(1);
    expect(units.every((unit) => seen.has(unit.id()))).toBe(true);
    console.info(
      "C4_E3_CHURN_METRICS",
      JSON.stringify({
        observers: 3,
        frames: 8,
        firstTileComplete,
        firstUnitComplete,
        firstUsableFrame: 0,
        resets,
        holes,
        peakBytes,
        hostMs,
        producerMs,
        wireMs: measurements.wireMs,
        reconcileMs,
        peakHeapDelta: peakHeap - startHeap,
        permanentlyUnseenUnits: 0,
        revokedDisclosures,
        maxRevocationDelayFrames: revokedDisclosures > 0 ? 0 : null,
      }),
    );
  });
});
