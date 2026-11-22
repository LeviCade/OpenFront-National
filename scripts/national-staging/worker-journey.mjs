// Real application Master/Worker + actual local account HTTP + native zbin.
// Automated protocol participants are NOT independently witnessed humans.
import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { decodeSnapshotValue, encodeSnapshotValue } from "@openfront/engine/snapshot/SnapshotCodec";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import {
  createGameWireContext,
  decodeServerMessage,
  encodeClientMessage,
} from "@openfront/shared/ZbinWire";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join as joinPath } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { NationalObserverMapContinuity } from "../../src/client/NationalObserverMapContinuity.ts";
import {
  assertTrustedPublicProjection,
  parseTrustedNationalProjection,
  readTrustedNationalObserverMap,
  trustedNationalPrincipal,
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
const durable = process.env.NATIONAL_TEST_DURABLE_RECOVERY === "1";
const worldRoot = joinPath(fixture.dir, "world");
if (durable) {
  execFileSync(process.execPath, ["--experimental-strip-types", "scripts/national-staging/init-durable-world.mjs", worldRoot, "1"], { env: fixture.env, stdio: ["ignore", "pipe", "pipe"] });
  fixture.env.NATIONAL_RECOVERY_ROOT = worldRoot;
}

function durableRow(id) {
  const db = new DatabaseSync(joinPath(worldRoot, "worker-0.sqlite"), { readOnly: true });
  try {
    const row = db.prepare("SELECT * FROM checkpoints WHERE gameID = ?").get(id);
    assert(row, "durable world not found");
    const digest = createHash("sha256").update(JSON.stringify([1, id, row.generation, row.tick, row.payload])).digest("hex");
    assert(digest === row.digest, "independent durable checksum");
    const data = JSON.parse(row.payload);
    assert(data.format === 1 && data.source === fixture.env.GIT_COMMIT);
    assert(data.info.gameID === id && data.seats.length === 3);
    assert(data.seats.every(s => Object.keys(s).sort().join(",") === "accountId,clientID,playerID,subject"));
    return { tick: row.tick, commitment: digest, replayDigest: data.state.replayDigest, generation: row.generation };
  } finally { db.close(); }
}
async function assertWorkerRefusal(root, reason) {
  const child = launch(
    ["--import", "tsx", "--input-type=module", "-e", "import { startWorker } from './src/server/Worker.ts'; await startWorker();"],
    { ...fixture.env, NATIONAL_RECOVERY_ROOT: root, WORKER_ID: "0" },
  );
  try {
    await until(() => child.messages.some(m => m.message === "NATIONAL durable recovery refused"), "explicit competing or incompatible Worker refusal", 20_000);
    const refusal = child.messages.find(m => m.message === "NATIONAL durable recovery refused");
    assert.equal(refusal.reason, reason);
    assert(!child.messages.some(m => m.message === "NATIONAL durable match restored" || m.message.startsWith("running on http://localhost:")));
  } finally {
    await child.stop();
  }
}

async function assertCorruptWorkerRefusal(id, name, alter, reason, recalculate = true) {
  const root = joinPath(fixture.dir, "fault-" + name);
  execFileSync(process.execPath, ["--experimental-strip-types", "scripts/national-staging/init-durable-world.mjs", root, "1"], { env: fixture.env, stdio: ["ignore", "pipe", "pipe"] });
  const original = new DatabaseSync(joinPath(worldRoot, "worker-0.sqlite"), { readOnly: true });
  let row;
  try {
    row = original.prepare("SELECT * FROM checkpoints WHERE gameID = ?").get(id);
  } finally { original.close(); }
  assert(row);
  const data = JSON.parse(row.payload);
  alter(data);
  const payload = JSON.stringify(data);
  const digest = recalculate ? createHash("sha256").update(JSON.stringify([1, id, row.generation, row.tick, payload])).digest("hex") : row.digest;
  const clone = new DatabaseSync(joinPath(root, "worker-0.sqlite"));
  try {
    clone.prepare("INSERT INTO checkpoints(gameID, generation, tick, payload, digest) VALUES (?, ?, ?, ?, ?)").run(id, row.generation, row.tick, payload, digest);
  } finally { clone.close(); }
  await assertWorkerRefusal(root, reason);
}

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
        const refusal = process.messages.find(m => m.message === "NATIONAL durable recovery refused");
        if (refusal) {
          console.error("SAFE_RECOVERY_REFUSAL " + JSON.stringify({stage: refusal.stage, reason: refusal.reason, diagnostic: refusal.diagnostic, errorType: refusal.errorType}));
          throw new Error("explicit Worker recovery refusal");
        }
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
        state.startTick = msg.tick;
        state.actor = trustedNationalPrincipal(msg);
        state.continuity = new NationalObserverMapContinuity(state.actor);
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
        // ClientID is the lobby/transport seat; Player.id is the distinct
        // engine principal. The actual browser resolves the same mapping
        // through GameView.playerByClientID, not by equating the two IDs.
        const updates = packet.updates[String(GameUpdateType.Player)] ?? [];
        if (
          updates.some(
            (player) => player.clientID && player.clientID !== state.seat,
          )
        )
          throw new Error("foreign seat metadata");
        const own = updates.find((player) => player.clientID === state.seat);
        if (own) {
          if (state.actor && own.id !== state.actor)
            throw new Error("own engine identity changed");
          state.actor = own.id;
        }
        if (map && (!state.actor || map.observerId !== state.actor))
          throw new Error("wrong recipient");
        if (map) {
          phase = "native-continuity";
          assert(state.continuity, "missing authenticated continuity guard");
          state.continuity.acceptProjection(packet);
          if (state.streamId && state.streamId !== map.streamId)
            throw new Error("stream changed");
          if (!state.streamId && !map.reset)
            throw new Error("initial stream did not reset");
          state.streamId = map.streamId;
        } else {
          phase = "public-projection";
          assertTrustedPublicProjection(packet, state.actor, state.seat);
        }
        if (msg.tick <= state.lastProjectionTick)
          throw new Error("non-advancing projection");
        state.lastProjectionTick = msg.tick;
        if (packet.nationalPolitics) state.empireIds = packet.nationalPolitics.empires.map(e => e.id).sort();
        phase = "private-dto";
        // Keep summaries, not raw private projection bodies.
        if (
          (packet.updates[String(GameUpdateType.SpawnPhaseEnd)] ?? []).length >
          0
        )
          state.spawnEnded = true;
        if (
          updates.some(
            (p) =>
              (p.clientID === state.seat || p.id === state.actor) &&
              p.hasSpawned === true,
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
          if (
            result.actorId !== state.actor ||
            result.recipientId !== state.actor
          )
            throw new Error("wrong receipt recipient");
          state.receipts ??= new Map();
          state.receipts.set(result.requestId, {
            accepted: result.accepted,
            actorId: result.actorId,
            type: result.type,
            warId: result.warId,
            motionId: result.motionId,
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
        "foreign seat metadata",
        "wrong receipt recipient",
        "own engine identity changed",
        "stream changed",
        "initial stream did not reset",
        "non-advancing projection",
        "legacy authority frame",
      ]);
      state.decodeReason ??=
        phase + ":" + (allowed.has(message) ? message : "unclassified");
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
  // Another seated account cannot turn off NATIONAL or become a spectator.
  send(players[1], {
    type: "intent",
    intent: { type: "update_game_config", config: { nationalMode: false } },
  });
  send(players[1], { type: "spectate", spectator: true });
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
          p.lobby?.lobby.gameConfig?.nationalMode === true &&
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
  assert(players.every((p) => typeof p.actor === "string"));
  assert.equal(new Set(players.map((p) => p.actor)).size, 3);
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
  assert(allHealthy(players));
  assert.equal(new Set(players.map((p) => p.actor)).size, 3);
  assert(players.every((p) => p.actor && p.streamId));
  assert.equal(new Set(players.map((p) => p.streamId)).size, 3);
  pass("three-engine-principals-three-bound-private-streams");
  pass("actual-worker-frames-pass-native-recipient-continuity");
  await until(
    () => players.every((p) => p.spawnEnded),
    "server-authored spawn phase end",
    120_000,
  );
  // All requests cross the real binary socket and canonical stamped executor.
  // Outsider C must not accept A's invitation to B.
  async function pactReceipt(index, intent, accepted) {
    send(players[index], { type: "intent", intent });
    await until(
      () => players[index].receipts?.has(intent.requestId),
      "canonical pact receipt",
      30_000,
    );
    const receipt = players[index].receipts.get(intent.requestId);
    assert.equal(receipt.accepted, accepted);
    assert.equal(receipt.actorId, players[index].actor);
    assert.equal(receipt.type, intent.type);
    for (let j = 0; j < players.length; j++)
      if (j !== index) assert(!players[j].receipts?.has(intent.requestId));
  }
  const pactId = "c4-local-mda";
  await pactReceipt(
    0,
    {
      type: "national_found_pact",
      pactId,
      name: "Local defense",
      pactKind: "MDA",
      terms: { admission: "leader", expulsion: "forbidden" },
      requestId: "c4-pact-found",
    },
    true,
  );
  await pactReceipt(
    0,
    {
      type: "national_invite_pact",
      pactId,
      candidateId: players[1].actor,
      requestId: "c4-pact-invite",
    },
    true,
  );
  await pactReceipt(
    2,
    {
      type: "national_accept_pact",
      pactId,
      requestId: "c4-pact-outsider",
    },
    false,
  );
  await pactReceipt(
    1,
    {
      type: "national_accept_pact",
      pactId,
      requestId: "c4-pact-accept",
    },
    true,
  );
  pass("real-worker-pact-founding-invitation-consent-and-outsider-denial");
  await pactReceipt(
    2,
    {
      type: "national_betray_pact",
      pactId,
      requestId: "c4c2-pact-outsider-exit",
    },
    false,
  );
  await pactReceipt(
    1,
    {
      type: "national_betray_pact",
      pactId,
      requestId: "c4c2-pact-sovereign-exit",
    },
    true,
  );
  await pactReceipt(
    1,
    {
      type: "national_betray_pact",
      pactId,
      requestId: "c4c2-pact-double-exit",
    },
    false,
  );
  pass("real-worker-nonwaivable-pact-exit-and-repeated-exit-denial");

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
    assert.equal(
      players[i].receipts.get(requests[i]).actorId,
      players[i].actor,
    );
    for (let j = 0; j < 3; j++)
      if (i !== j) assert(!players[j].receipts?.has(requests[i]));
  }
  pass("three-authoritative-spawns-three-private-lawful-receipts");

  let pendingPeaceMotion;
  if (durable) {
    await pactReceipt(0, { type: "national_declare_war", scope: "imperial", nationId: players[0].actor, targetId: "e2-empire-1", targetKind: "empire", requestId: "e2-durable-war" }, true);
    const warId = players[0].receipts.get("e2-durable-war").warId;
    assert(typeof warId === "string" && warId.length > 0);
    await pactReceipt(0, { type: "national_propose_peace", warId, requestId: "e2-durable-pending-peace" }, true);
    pendingPeaceMotion = players[0].receipts.get("e2-durable-pending-peace").motionId;
    assert(typeof pendingPeaceMotion === "string" && pendingPeaceMotion.length > 0);
    pass("durable-imperial-war-and-pending-peace");
  }

  const beforeModeAttempt = players[0].lastProjectionTick;
  send(players[0], {
    type: "intent",
    intent: { type: "update_game_config", config: { nationalMode: false } },
  });
  await until(
    () => players[0].lastProjectionTick > beforeModeAttempt + 2,
    "started NATIONAL cannot switch to legacy authority",
  );
  assert(allHealthy(players));
  pass("nonhost-mode-and-spectator-attempts-and-started-mode-switch-denied");

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
  assert.equal(replacement.actor, players[1].actor);
  await until(() => Boolean(replacement.streamId), "fresh private stream");
  assert.notEqual(replacement.streamId, players[1].streamId);
  assert(!replacement.decodeFailed);
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
  assert.equal(recovered.actor, players[1].actor);
  accountCommand(fixture.env, "ban", emails[2]);
  await until(() => players[2].closeCode !== null, "live account ban", 22_000);
  assert(!players[0].decodeFailed && !recovered.decodeFailed);
  pass("revocation-and-ban-stop-authority-legitimate-relogin-recovers-seat");

  setStage("actual identity service outage and account recovery");
  const beforeOutage = players[0].lastProjectionTick;
  await identity.stop();
  identity = undefined;
  await until(
    () => players[0].closeCode !== null && recovered.closeCode !== null,
    "bounded outage disconnect",
    22_000,
  );
  assert.equal(players[0].closeCode, 1013);
  assert.equal(recovered.closeCode, 1013);
  // Same DB, real secure refresh sessions, new legitimate physical sockets.
  identity = await startIdentity(fixture.env);
  const renewedA = await refresh(auth[0].cookie);
  const renewedB = await refresh(recoveredAuth.cookie);
  const liveA = await peer();
  const liveB = await peer();
  rejoin(liveA, id, renewedA.jwt);
  rejoin(liveB, id, renewedB.jwt);
  await until(
    () =>
      liveA.lastProjectionTick > beforeOutage &&
      liveB.lastProjectionTick > beforeOutage &&
      liveA.streamId &&
      liveB.streamId,
    "recovered accounts continue original authority",
    30_000,
  );
  assert(allHealthy([liveA, liveB]));
  assert.equal(liveA.seat, seatIds[0]);
  assert.equal(liveB.seat, seatIds[1]);
  assert.equal(liveA.actor, players[0].actor);
  assert.equal(liveB.actor, players[1].actor);
  assert.notEqual(liveA.streamId, players[0].streamId);
  assert.notEqual(liveB.streamId, recovered.streamId);
  assert.equal(
    server.messages.filter(
      (m) =>
        m.message === "NATIONAL authoritative host ready" && m.gameID === id,
    ).length,
    1,
  );
  pass(
    "live-identity-outage-fails-closed-same-session-seats-resume-one-runner",
  );

  if (!durable) {
    setStage("host loss and terminal old match");
    await server.stop();
    await until(
      () => liveA.closeCode !== null && liveB.closeCode !== null,
      "old Worker sockets died",
    );
    server = await startHost();
    assert.equal(await exists(id), false, "dead match reappeared after restart");
    const stale = await peer();
    rejoin(stale, id, renewedA.jwt);
    await until(() => stale.closeCode !== null, "stale match reconnect denial");
    assert.equal(stale.closeCode, 4004);
    assert(!stale.starts);
    const next = await create(renewedA.jwt);
    assert.notEqual(next.gameID ?? next.id, id);
    pass("host-restart-ends-old-match-new-game-has-new-id");
    console.log(
      "LOCAL_STAGING_WORKER_PASS automated_protocol_accounts=3 humans=0 upstream_oauth=0 gpu=0 restart_recovery=0",
    );
  } else {
    setStage("SIGKILL actual Master and all authoritative Workers");
    const oldStreams = new Set([liveA.streamId, liveB.streamId, players[2].streamId]);
    const old = server;
    const startedRecovery = performance.now();
    await server.hardKill();
    await until(() => liveA.closeCode !== null && liveB.closeCode !== null, "old physical sockets closed");
    assert.equal(liveA.closeCode, 1006);
    assert.equal(liveB.closeCode, 1006);
    const lastAcknowledged = Math.max(liveA.lastProjectionTick, liveB.lastProjectionTick);
    const oldTicks = old.messages.filter(m => m.gameID === id && m.message === "NATIONAL authoritative tick");
    const lastCommitted = oldTicks.at(-1)?.tick;
    assert(Number.isInteger(lastCommitted));
    server = await startHost();
    const restored = server.messages.filter(m => m.gameID === id && m.message === "NATIONAL durable match restored");
    assert.equal(restored.length, 1);
    assert.equal(restored[0].authenticatedSeats, 0);
    assert.equal(restored[0].authoritativeRunners, 1);
    assert.equal(await exists(id), true);
    const disk = durableRow(id);
    assert(disk.tick >= lastAcknowledged && disk.tick >= lastCommitted);
    assert.equal(restored[0].tick, disk.tick);
    assert.equal(restored[0].durableTick, disk.tick);
    assert.equal(restored[0].stateCommitment, disk.commitment);
    assert.equal(restored[0].replayDigest, disk.replayDigest);
    const restoreElapsedMs = Math.round(performance.now() - startedRecovery);
    pass("same-game-restored-exact-independent-disk-commitment");

    setStage("actual competing Worker and semantic fault clones");
    await assertWorkerRefusal(worldRoot, "shard-already-owned");
    await assertCorruptWorkerRefusal(id, "checksum", d => { d.state.replayDigest = "0".repeat(64); }, "NATIONAL invalid checkpoint integrity", false);
    await assertCorruptWorkerRefusal(id, "source", d => { d.source = "0".repeat(40); }, "NATIONAL incompatible durable checkpoint");
    await assertCorruptWorkerRefusal(id, "map", d => { d.mapDigest = "0".repeat(64); }, "NATIONAL durable map mismatch");
    await assertCorruptWorkerRefusal(id, "version", d => { const snap = decodeSnapshotValue(Buffer.from(d.snapshot, "base64")); snap.format = 999; d.snapshot = Buffer.from(encodeSnapshotValue(snap)).toString("base64"); }, "NATIONAL trusted snapshot header incompatible");
    assert.equal(durableRow(id).commitment, disk.commitment);
    pass("actual-competing-worker-checksum-source-map-snapshot-rejections");

    setStage("foreign, banned, spectator and unavailable identity recovery denial");
    const foreign = await peer();
    rejoin(foreign, id, auth[3].jwt);
    const revoked = await peer();
    rejoin(revoked, id, auth[2].jwt);
    const spectator = await peer();
    join(spectator, id, renewedA.jwt, 0, true);
    await until(() => [foreign, revoked, spectator].every(p => p.closeCode !== null), "recovery denials");
    assert([foreign, revoked, spectator].every(p => !p.starts && p.lastProjectionTick === -1 && !p.decodeFailed));
    assert([foreign, revoked, spectator].every(p => p.closeCode !== 1006));
    await identity.stop();
    identity = undefined;
    const unavailable = await peer();
    rejoin(unavailable, id, renewedA.jwt);
    await until(() => unavailable.closeCode !== null, "identity unavailable recovery denial", 30_000);
    assert(!unavailable.starts && unavailable.lastProjectionTick === -1 && unavailable.closeCode !== 1006);
    assert.equal(durableRow(id).commitment, disk.commitment, "world advanced before any verified seat");
    pass("recovered-seats-remain-inert-until-live-account-validation");

    setStage("three fresh independent account sessions recover original engine seats");
    identity = await startIdentity(fixture.env);
    accountCommand(fixture.env, "unban", emails[2]);
    const fresh = await Promise.all(emails.slice(0, 3).map(email => login(fixture.dir, email)));
    const seated = await Promise.all([peer(), peer(), peer()]);
    for (let i = 0; i < 3; i++) rejoin(seated[i], id, fresh[i].jwt);
    await until(
      () => seated.every(p => p.starts === 1 && p.lastProjectionTick > disk.tick && p.streamId),
      "three restored native recipient streams", 60_000,
    );
    assert(allHealthy(seated));
    assert(seated.every((p, i) => p.match === id && p.seat === seatIds[i] && p.actor === players[i].actor));
    assert(seated.every(p => p.startTick >= disk.tick && !oldStreams.has(p.streamId)));
    assert.equal(new Set(seated.map(p => p.streamId)).size, 3);
    assert(seated.every(p => !p.receipts?.size));
    assert(seated.every(p => JSON.stringify(p.empireIds) === JSON.stringify(["e2-empire-0", "e2-empire-1", "e2-empire-2"])));
    pass("three-fresh-engine-seats-no-historical-private-receipts");

    setStage("prior request replay denied and pending political motion survives");
    for (let i = 0; i < 2; i++) send(seated[i], { type: "intent", intent: { type: "national_found_empire", empireId: "replay-after-crash", requestId: requests[0] } });
    const beforeReplay = Math.max(...seated.map(p => p.lastProjectionTick));
    await until(() => seated.every(p => p.lastProjectionTick > beforeReplay + 2), "continued canonical turns");
    assert(seated.every(p => !p.receipts?.has(requests[0])));
    send(seated[1], { type: "intent", intent: { type: "national_accept_peace", motionId: pendingPeaceMotion, requestId: "e2-durable-accept-peace-after-crash" } });
    await until(() => seated[1].receipts?.get("e2-durable-accept-peace-after-crash")?.accepted === true, "restored peace motion accepted", 30_000);
    assert(seated.filter((_, i) => i !== 1).every(p => !p.receipts?.has("e2-durable-accept-peace-after-crash")));
    assert(allHealthy(seated));
    assert.equal(server.messages.filter(m => m.gameID === id && m.message === "NATIONAL authoritative host ready").length, 0);
    assert.equal(server.messages.filter(m => m.gameID === id && m.message === "NATIONAL durable match restored").length, 1);
    pass("stale-request-denied-pending-peace-executed-on-restored-authority");
    console.log("DURABLE_RECOVERY_EVIDENCE " + JSON.stringify({
      originalGameID: id, recoveredGameID: seated[0].match,
      lastCommittedTick: lastCommitted, lastAcknowledgedTick: lastAcknowledged,
      lastDurableTick: disk.tick, restoredTick: restored[0].tick,
      subsequentTick: Math.min(...seated.map(p => p.lastProjectionTick)),
      stateCommitment: disk.commitment, replayDigest: disk.replayDigest,
      generation: disk.generation, restoreElapsedMs,
      recoveryElapsedMs: Math.round(performance.now() - startedRecovery),
      observedAcknowledgedLossTicks: Math.max(0, lastAcknowledged - disk.tick),
      authenticatedRecoveredSeats: seated.length, duplicateTimelineObserved: false,
    }));
    console.log("LOCAL_STAGING_WORKER_PASS automated_protocol_accounts=3 humans=0 upstream_oauth=0 gpu=0 restart_recovery=1");
  }
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
