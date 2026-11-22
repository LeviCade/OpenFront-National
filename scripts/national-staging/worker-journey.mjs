// Real application Master/Worker + actual local account HTTP + native zbin.
// Automated protocol participants are NOT independently witnessed humans.
import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import {
  createGameWireContext,
  decodeServerMessage,
  encodeClientMessage,
} from "@openfront/shared/ZbinWire";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import {
  parseTrustedNationalProjection,
  readTrustedNationalObserverMap,
} from "../../src/client/TrustedNationalSession.ts";
import { loadTrustedNationalMapFiles } from "../../src/server/national/TrustedNationalMapFiles.ts";
import {
  accountCommand,
  launch,
  login,
  makeEnvironment,
  profile,
  refresh,
  startIdentity,
  until,
} from "./operator-harness.mjs";

const fixture = makeEnvironment();
const hostUrl = "http://localhost:3001";
const peers = [];
let identity;
let server;
let stage = "initialization";
const pass = (name) => console.log("WORKER_STAGE_PASS " + name);
const setStage = (name) => {
  stage = name;
};
const emails = ["alpha", "bravo", "charlie", "observer"].map(
  (name) => name + "@staging.invalid",
);

async function startHost() {
  const process = launch(
    ["--import", "tsx", "src/server/Server.ts"],
    fixture.env,
  );
  try {
    await until(
      () => {
        assert(process.alive(), "Master exited before Worker ready");
        return (
          process.messages.some((m) =>
            m.message.startsWith("Master HTTP server listening"),
          ) &&
          process.messages.some(
            (m) => m.message === "running on http://localhost:3001",
          )
        );
      },
      "actual Master/Worker listen",
      45_000,
    );
    return process;
  } catch (error) {
    await process.stop();
    throw error;
  }
}

async function peer() {
  const ws = new WebSocket("ws://localhost:3001/");
  const state = {
    ws,
    messages: [],
    context: undefined,
    closeCode: null,
    decodeFailed: false,
    lastProjectionTick: -1,
  };
  peers.push(state);
  ws.on("error", () => {});
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN)
      send(state, { type: "ping", sentAt: Math.floor(performance.now()) });
  }, 5000);
  heartbeat.unref();
  ws.on("close", (code) => {
    state.closeCode = code;
    clearInterval(heartbeat);
  });
  ws.on("message", (frame) => {
    let phase = "binary-wire";
    try {
      const msg = decodeServerMessage(frame, state.context);
      if (msg.type === "turn" || msg.type === "start")
        throw new Error("legacy authority frame");
      if (msg.type === "national_start") {
        state.context = createGameWireContext(msg.gameStartInfo.players);
        state.seat = msg.myClientID;
        state.match = msg.gameStartInfo.gameID;
      }
      if (msg.type === "national_projection") {
        phase = "projection-envelope";
        const packet = parseTrustedNationalProjection(msg.payload, msg.tick);
        phase = "observer-map";
        const map = readTrustedNationalObserverMap(
          packet.nationalObserverMap,
          msg.tick,
        );
        phase = "recipient-binding";
        if (map && map.observerId !== state.seat)
          throw new Error("wrong recipient");
        if (msg.tick <= state.lastProjectionTick)
          throw new Error("non-advancing projection");
        state.lastProjectionTick = msg.tick;
        phase = "private-dto";
        // Keep summaries, not raw private projection bodies.
        const updates = packet.updates[String(GameUpdateType.Player)] ?? [];
        if (
          (packet.updates[String(GameUpdateType.SpawnPhaseEnd)] ?? []).length >
          0
        )
          state.spawnEnded = true;
        if (
          updates.some(
            (p) => p.clientID === state.seat && p.hasSpawned === true,
          )
        )
          state.spawned = true;
        if (
          map &&
          map.tiles.some((tile) => (tile[1] & 4095) !== 0) &&
          map.ownResources.troops > 0
        )
          state.visibleOwnLand = true;
        for (const result of packet.nationalCommandResults ?? []) {
          state.receipts ??= new Map();
          state.receipts.set(result.requestId, {
            accepted: result.accepted,
            actorId: result.actorId,
          });
        }
        return;
      }
      if (msg.type === "lobby_info") state.lobby = msg;
      if (msg.type === "national_start") state.starts = (state.starts ?? 0) + 1;
      state.messages.push(msg.type);
    } catch (error) {
      state.decodeFailed = true;
      const message = error instanceof Error ? error.message : "";
      const allowed = new Set([
        "NATIONAL oversized projection",
        "NATIONAL invalid recipient projection",
        "NATIONAL observer-map is not a record",
        "NATIONAL invalid observer-map v1 metadata",
        "NATIONAL invalid visible tile page",
        "NATIONAL invalid visible unit marker",
        "NATIONAL invalid visible border",
        "NATIONAL invalid public country",
        "wrong recipient",
        "non-advancing projection",
        "legacy authority frame",
      ]);
      state.decodeReason ??= phase + ":" + (allowed.has(message) ? message : "unclassified");
    }
  });
  await until(() => ws.readyState === WebSocket.OPEN, "real socket open");
  return state;
}
function send(p, message) {
  p.ws.send(encodeClientMessage(message, p.context));
}
function join(p, gameID, token, index, spectator = false) {
  send(p, {
    type: "join",
    gameID,
    token,
    username: ["Alpha", "Bravo", "Charlie", "Observer"][index],
    clanTag: null,
    spectator,
    turnstileToken: null,
    gitCommit: fixture.env.GIT_COMMIT,
    platform: "web",
    device: "desktop",
  });
}
function rejoin(p, gameID, token) {
  send(p, {
    type: "rejoin",
    gameID,
    token,
    lastTurn: 0,
    gitCommit: fixture.env.GIT_COMMIT,
  });
}
async function create(token) {
  const res = await fetch(hostUrl + "/api/create_game", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify({ nationalMode: true }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(res.status, 200, "Private NATIONAL creation");
  return res.json();
}
async function exists(id) {
  const res = await fetch(hostUrl + "/api/game/" + id + "/exists", {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(res.status, 200);
  return (await res.json()).exists;
}
const allHealthy = (ps) =>
  ps.every((p) => !p.decodeFailed && p.closeCode === null);
function chooseLand(map, count) {
  const found = [];
  for (let y = 12; y < map.height() - 12 && found.length < count; y += 8) {
    for (let x = 12; x < map.width() - 12 && found.length < count; x += 8) {
      const center = map.ref(x, y);
      if (found.some((ref) => map.manhattanDist(ref, center) < 45)) continue;
      let suitable = true;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const ref = map.ref(x + dx, y + dy);
          if (!map.isLand(ref) || map.isImpassable(ref)) suitable = false;
        }
      if (suitable) found.push(center);
    }
  }
  assert.equal(found.length, count, "legitimate spawn terrain");
  return found;
}

try {
  setStage("actual local account registration and magic-link login");
  for (const email of emails) accountCommand(fixture.env, "register", email);
  identity = await startIdentity(fixture.env);
  const auth = await Promise.all(
    emails.map((email) => login(fixture.dir, email)),
  );
  const profiles = await Promise.all(
    auth.map((session) => profile(session.jwt)),
  );
  assert.equal(new Set(profiles.map((p) => p.player.publicId)).size, 4);
  pass("actual-local-auth-four-distinct-registered-principals");

  setStage("ordinary application Master and Worker listeners");
  server = await startHost();
  pass("master-and-worker-listen");
  const created = await create(auth[0].jwt);
  const id = created.gameID ?? created.id;
  assert(typeof id === "string" && id.length > 0, "missing minted match id");
  assert.equal(created.gameConfig.nationalMode, true);
  assert.equal(await exists(id), true);
  pass("authenticated-private-national-lobby");

  setStage("three physical Worker admissions");
  const players = await Promise.all([peer(), peer(), peer()]);
  for (let i = 0; i < 3; i++) join(players[i], id, auth[i].jwt, i);
  await until(
    () => players.every((p) => p.lobby?.lobby.clients?.length === 3),
    "all three Worker lobby seats",
  );
  assert(allHealthy(players));
  pass("three-distinct-worker-lobby-connections");
  const seatIds = players.map((p) => p.lobby.myClientID);
  assert.equal(new Set(seatIds).size, 3);
  setStage("private NATIONAL public listing denial");
  const rejectedListing = await fetch(
    hostUrl + "/api/game/" + id + "/listing",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + auth[0].jwt,
        "content-type": "application/json",
      },
      body: JSON.stringify({ listed: true }),
    },
  );
  assert.equal(
    rejectedListing.status,
    409,
    "private NATIONAL was publicly listed",
  );
  pass("three-worker-seats-unlisted");

  setStage("ordinary host config and start commands");
  send(players[0], {
    type: "intent",
    intent: {
      type: "update_game_config",
      config: {
        gameMap: GameMapType.Onion,
        gameMapSize: GameMapSize.Compact,
        startDelay: 0,
      },
    },
  });
  await until(
    () =>
      players.every(
        (p) =>
          p.lobby?.lobby.gameConfig?.gameMap === GameMapType.Onion &&
          p.lobby?.lobby.gameConfig?.gameMapSize === GameMapSize.Compact,
      ),
    "actual config patch",
  );
  // Terrain is loaded from real deployment assets, never injected into Worker.
  const { gameMap } = await loadTerrainMap(
    await loadTrustedNationalMapFiles(GameMapType.Onion, GameMapSize.Compact),
  );
  const tiles = chooseLand(gameMap, 3);
  send(players[0], {
    type: "intent",
    intent: { type: "toggle_game_start_timer" },
  });
  await until(
    () => players.every((p) => p.starts === 1 && p.lastProjectionTick >= 1),
    "three native NATIONAL starts and projections",
    60_000,
  );
  assert(allHealthy(players));
  assert.deepEqual(
    players.map((p) => p.seat),
    seatIds,
  );
  assert(players.every((p) => p.match === id));
  const ready = server.messages.filter(
    (m) => m.message === "NATIONAL authoritative host ready" && m.gameID === id,
  );
  assert.equal(ready.length, 1);
  assert.equal(ready[0].authenticatedSeats, 3);
  assert.equal(ready[0].distinctAccounts, 3);
  assert.equal(ready[0].authoritativeRunners, 1);
  pass("one-game-server-one-runner-three-recipient-streams");

  setStage("native spawn and lawful engine political receipts");
  for (let i = 0; i < 3; i++)
    send(players[i], {
      type: "intent",
      intent: { type: "spawn", tile: tiles[i] },
    });
  await until(
    () => players.every((p) => p.spawned === true || p.visibleOwnLand === true),
    "three authoritative spawns",
    30_000,
  );
  await until(
    () => players.every((p) => p.spawnEnded),
    "server-authored spawn phase end",
    120_000,
  );
  const requests = ["e2-local-alpha", "e2-local-bravo", "e2-local-charlie"];
  send(players[0], {
    type: "intent",
    intent: {
      type: "national_found_empire",
      empireId: "e2-empire-0",
      requestId: requests[0],
    },
  });
  await until(
    () => players[0].receipts?.get(requests[0])?.accepted === true,
    "first canonical founding",
    30_000,
  );
  send(players[1], {
    type: "intent",
    intent: {
      type: "national_found_empire",
      empireId: "e2-replay",
      requestId: requests[0],
    },
  });
  const replayTick = players[1].lastProjectionTick;
  await until(
    () => players[1].lastProjectionTick > replayTick + 2,
    "cross-principal replay observation",
  );
  assert(!players[1].receipts?.has(requests[0]), "foreign request ID accepted");
  for (let i = 1; i < 3; i++) {
    send(players[i], {
      type: "intent",
      intent: {
        type: "national_found_empire",
        empireId: "e2-empire-" + i,
        requestId: requests[i],
      },
    });
  }
  await until(
    () =>
      players.every((p, i) => p.receipts?.get(requests[i])?.accepted === true),
    "three canonical founding receipts",
    120_000,
  );
  for (let i = 0; i < 3; i++) {
    assert.equal(players[i].receipts.get(requests[i]).actorId, seatIds[i]);
    for (let j = 0; j < 3; j++)
      if (i !== j) assert(!players[j].receipts?.has(requests[i]));
  }
  pass("three-authoritative-spawns-three-private-lawful-receipts");

  setStage("refresh rotation and same-seat socket replacement");
  const renewed = await refresh(auth[1].cookie);
  const replacement = await peer();
  const previousTick = players[0].lastProjectionTick;
  rejoin(replacement, id, renewed.jwt);
  await until(
    () =>
      replacement.starts === 1 &&
      replacement.lastProjectionTick > previousTick &&
      players[1].closeCode !== null &&
      players[0].lastProjectionTick > previousTick &&
      players[2].lastProjectionTick > previousTick,
    "lawful fresh-token reconnect",
  );
  assert.equal(replacement.seat, seatIds[1]);
  assert.equal(replacement.match, id);
  assert(
    players[0].lastProjectionTick > previousTick &&
      players[2].lastProjectionTick > previousTick,
  );
  const late = await peer();
  join(late, id, auth[3].jwt, 3, true);
  await until(() => late.closeCode !== null, "late spectator denial");
  assert(!late.starts);
  pass("same-seat-fresh-token-reconnect-and-spectator-denial");

  setStage("revoked connected account loses real Worker authority");
  accountCommand(fixture.env, "revoke", emails[1]);
  const priorTick = players[0].lastProjectionTick;
  await until(
    () => replacement.closeCode !== null,
    "bounded live revocation",
    22_000,
  );
  assert.equal(replacement.closeCode, 4001);
  await until(
    () => players[0].lastProjectionTick > priorTick,
    "unrevoked peer keeps advancing",
  );
  const banned = await peer();
  rejoin(banned, id, renewed.jwt);
  await until(
    () => banned.closeCode !== null,
    "revoked JWT cannot regain seat",
  );
  assert(!banned.starts);
  const recoveredAuth = await login(fixture.dir, emails[1]);
  const recovered = await peer();
  rejoin(recovered, id, recoveredAuth.jwt);
  await until(
    () => recovered.starts === 1 && recovered.lastProjectionTick >= 1,
    "new legitimate session recovers original seat",
  );
  assert.equal(recovered.seat, seatIds[1]);
  accountCommand(fixture.env, "ban", emails[2]);
  await until(() => players[2].closeCode !== null, "live account ban", 22_000);
  assert(!players[0].decodeFailed && !recovered.decodeFailed);
  pass("revocation-and-ban-stop-authority-legitimate-relogin-recovers-seat");

  setStage("host loss and terminal old match");
  await server.stop();
  await until(
    () => players[0].closeCode !== null && recovered.closeCode !== null,
    "old Worker sockets died",
  );
  server = await startHost();
  assert.equal(await exists(id), false, "dead match reappeared after restart");
  const stale = await peer();
  rejoin(stale, id, auth[0].jwt);
  await until(() => stale.closeCode !== null, "stale match reconnect denial");
  assert.equal(stale.closeCode, 4004);
  assert(!stale.starts);
  const next = await create(auth[0].jwt);
  assert.notEqual(next.gameID ?? next.id, id);
  pass("host-restart-ends-old-match-new-game-has-new-id");
  console.log(
    "LOCAL_STAGING_WORKER_PASS automated_protocol_accounts=3 humans=0 upstream_oauth=0 gpu=0 restart_recovery=0",
  );
} catch (error) {
  // Only own source line numbers and enumerated peer state; no JWT or payload.
  const line =
    String(error?.stack ?? "").match(/worker-journey\.mjs:(\d+):\d+/)?.[1] ??
    "unknown";
  console.error(
    "LOCAL_STAGING_WORKER_FAIL first_transition=" + stage + " line=" + line,
  );
  console.error(
    "SAFE_PEER_SUMMARY " +
      JSON.stringify(
        peers.map((p) => ({
          close: p.closeCode,
          decodeFailed: p.decodeFailed,
          decodeReason: p.decodeReason ?? null,
          lobbySize: p.lobby?.lobby.clients?.length ?? 0,
          starts: p.starts ?? 0,
          tick: p.lastProjectionTick,
          spawned: p.spawned === true,
          spawnEnded: p.spawnEnded === true,
          receipts: p.receipts?.size ?? 0,
        })),
      ),
  );
  process.exitCode = 1;
} finally {
  for (const p of peers) p.ws.terminate();
  if (server) await server.stop();
  if (identity) await identity.stop();
  fixture.cleanup();
  await delay(100);
}
