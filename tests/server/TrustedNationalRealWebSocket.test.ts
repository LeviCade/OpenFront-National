/**
 * C2 / E2: three actual localhost TCP/WebSocket connections to one GameServer.
 * Unlike the previous mocked-ws tests, ALL bytes cross real ws sockets.
 * Admission cryptographically verifies three distinct EdDSA JWTs using the
 * same verifyClientToken() used by Worker. A local trusted-account directory
 * stands in for the external /users/@me API (NOT a production API test).
 * The real Worker also uses verifyClientToken + getUserMe before admission.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { GameMode, GameType, PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { uuidToBase64url } from "@openfront/shared/Base64";
import type { WireGameStartInfo, ClientMessage, ServerMessage } from "@openfront/shared/WireSchemas";
import { createGameWireContext, decodeClientMessage, decodeServerMessage, encodeClientMessage } from "@openfront/shared/ZbinWire";
import type { ZbContext } from "@openfront/zbin";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { parseTrustedNationalProjection } from "../../src/client/TrustedNationalSession";
import { Client } from "../../src/server/Client";
import type { GameServer } from "../../src/server/GameServer";
import { ServerEnv } from "../../src/server/ServerEnv";
import { verifyClientToken } from "../../src/server/jwt";
import { cid, makeGame } from "../util/GameServerHarness";
import { setup } from "../util/Setup";
import { TestConfig } from "../util/TestConfig";

const ISSUER = "https://three-principal-test.invalid";
const AUDIENCE = "national-websocket-test";
const ACCOUNT_UUIDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];
const ACCOUNT_PUBLIC_IDS = ["public-A", "public-B", "public-C", "public-spectator"];
const SEAT_IDS = [cid("realA"), cid("realB"), cid("realC"), cid("realD")];
const MATCH_ID = cid("c2nat");
const EMPIRE = "c2-first-empire";
const foundToken = "c2_real_auth_found";
const warToken = "c2_real_auth_war";

class NationalServerConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}

async function productionRunner(info: WireGameStartInfo): Promise<GameRunner> {
  const humans = info.players.map((p) =>
    new PlayerInfo(p.username, PlayerType.Human, p.clientID, p.clientID),
  );
  const game = await setup(
    "plains",
    {
      ...info.config,
      gameType: GameType.Private,
      gameMode: GameMode.FFA,
      nationalMode: true,
      nations: "disabled",
      bots: 0,
    },
    humans,
    undefined,
    NationalServerConfig,
  );
  for (let i = 0; i < humans.length; i++) {
    game.addExecution(
      new SpawnExecution(info.gameID, humans[i], game.ref(20 + 30 * i, 20)),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  return new GameRunner(
    game,
    new Executor(game, info.gameID, undefined),
    () => {},
  );
}

interface RemoteSeat {
  ws: WebSocket;
  messages: ServerMessage[];
  context?: ZbContext;
  frames: Uint8Array[];
}

function waitFor(check: () => boolean, label: string, limitMs = 8000): Promise<void> {
  const deadline = Date.now() + limitMs;
  return new Promise((resolve, reject) => {
    const step = () => {
      if (check()) return resolve();
      if (Date.now() > deadline) return reject(new Error("timeout waiting for " + label));
      setTimeout(step, 15);
    };
    step();
  });
}

async function socket(url: string): Promise<RemoteSeat> {
  const ws = new WebSocket(url);
  const peer: RemoteSeat = { ws, messages: [], frames: [] };
  ws.on("message", (bytes: Buffer) => {
    const frame = Uint8Array.from(bytes);
    peer.frames.push(frame);
    const msg = decodeServerMessage(frame, peer.context);
    peer.messages.push(msg);
    if (msg.type === "national_start") {
      peer.context = createGameWireContext(msg.gameStartInfo.players);
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return peer;
}

function send(peer: RemoteSeat, msg: ClientMessage) {
  peer.ws.send(encodeClientMessage(msg, peer.context));
}
function starts(p: RemoteSeat) {
  return p.messages.filter((m) => m.type === "national_start");
}
function recipientPackets(p: RemoteSeat) {
  return p.messages
    .filter((m) => m.type === "national_projection")
    .map((m) => {
      if (m.type !== "national_projection") throw new Error("unreachable");
      return parseTrustedNationalProjection(m.payload, m.tick);
    });
}
function receipt(p: RemoteSeat, token: string) {
  return recipientPackets(p).flatMap((p) =>
    Array.isArray(p.nationalCommandResults) ? p.nationalCommandResults : [],
  ).find((r) => (r as { requestId?: string }).requestId === token);
}
async function joined(p: RemoteSeat, gameID: string, token: string, index: number, spectator = false) {
  send(p, {
    type: "join", gameID, username: ["Alpha", "Bravo", "Charlie", "Caster"][index],
    token, turnstileToken: null, clanTag: null, spectator,
    gitCommit: "real-ws-fixture", platform: "web", device: "desktop",
  });
}

describe("C2 E2 REAL WebSocket three-account NATIONAL server", () => {
  const disposers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (disposers.length > 0) await disposers.pop()!();
    vi.restoreAllMocks();
  });

  it("verifies real EdDSA signatures; starts, spawns, founds and WARs on one host; denies forged/replayed and cross-account traffic", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true });
    const pubJwk = await exportJWK(publicKey);
    vi.spyOn(ServerEnv, "jwtAudience").mockReturnValue(AUDIENCE);
    vi.spyOn(ServerEnv, "jwtIssuer").mockReturnValue(ISSUER);
    vi.spyOn(ServerEnv, "jwkPublicKey").mockResolvedValue(pubJwk);
    const tokens = await Promise.all(ACCOUNT_UUIDS.map((sub, index) =>
      new SignJWT({ sub: uuidToBase64url(sub) })
        .setProtectedHeader({ alg: "EdDSA" })
        .setJti("c2-signed-session-" + index)
        .setIssuedAt()
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setExpirationTime("1h")
        .sign(privateKey),
    ));
    const badKey = await generateKeyPair("EdDSA");
    const forgedToken = await new SignJWT({ sub: uuidToBase64url(ACCOUNT_UUIDS[0]) })
      .setProtectedHeader({ alg: "EdDSA" }).setJti("forged-key").setIssuedAt()
      .setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime("1h")
      .sign(badKey.privateKey);
    for (let i = 0; i < 3; i++) {
      const verified = await verifyClientToken(tokens[i]);
      expect(verified.type).toBe("success");
      if (verified.type === "success") {
        expect(verified.persistentId).toBe(ACCOUNT_UUIDS[i]);
        expect(verified.claims?.sub).toBe(ACCOUNT_UUIDS[i]);
      }
    }
    expect((await verifyClientToken(forgedToken)).type).toBe("error");
    let canonical: GameRunner | null = null;
    const requireCanonical = (): GameRunner => {
      const runner: GameRunner | null = canonical;
      if (runner === null) throw new Error("trusted host never created runner");
      return runner;
    };
    const game = makeGame({
      id: MATCH_ID,
      creatorPersistentID: ACCOUNT_UUIDS[0],
      config: {
        gameType: GameType.Private, gameMode: GameMode.FFA,
        nationalMode: true, nations: "disabled", bots: 0,
      },
      deps: {
        turnIntervalMs: () => 35,
        createNationalRunner: async (info) => {
          canonical = await productionRunner(info);
          return canonical;
        },
      },
    });
    const server: Server = createServer();
    const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 });
    const peers: RemoteSeat[] = [];
    const profiles = new Map(ACCOUNT_UUIDS.map((id, i) => [
      id, { index: i, publicId: ACCOUNT_PUBLIC_IDS[i] },
    ]));
    let acceptedSockets = 0;
    let deniedSockets = 0;
    wss.on("connection", (ws) => {
      const initial = async (raw: Buffer) => {
        try {
          const msg = decodeClientMessage(raw, undefined);
          if (msg.type !== "join" && msg.type !== "rejoin") {
            deniedSockets++;
            ws.close(1008, "authentication required");
            return;
          }
          const verified = await verifyClientToken(msg.token);
          if (verified.type !== "success" || !verified.claims) {
            deniedSockets++;
            ws.close(1008, "invalid signed token");
            return;
          }
          const profile = profiles.get(verified.persistentId);
          if (!profile) {
            deniedSockets++;
            ws.close(1008, "unknown account");
            return;
          }
          if (ws.readyState !== WebSocket.OPEN) return;
          const principal = { subject: verified.claims.sub, publicId: profile.publicId };
          if (msg.type === "rejoin") {
            if (!game.rejoinClient(ws, verified.persistentId, msg.lastTurn, undefined, principal)) {
              deniedSockets++;
              ws.close(1008, "not this account's seat");
              return;
            }
            acceptedSockets++;
            return;
          }
          const c = new Client(
            SEAT_IDS[profile.index],
            verified.persistentId,
            verified.claims,
            null,
            undefined,
            "127.0.0.1",
            msg.username,
            msg.clanTag,
            ws,
            undefined,
            profile.publicId,
            [],
            msg.spectator ?? false,
          );
          const joined = game.joinClient(c);
          if (joined !== "joined") {
            deniedSockets++;
            ws.close(1008, "not admitted");
          } else {
            acceptedSockets++;
          }
        } catch {
          deniedSockets++;
          ws.close(1008, "invalid ingress");
        }
      };
      ws.on("message", initial);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const url = "ws://127.0.0.1:" + port;
    disposers.push(async () => {
      await game.end();
      for (const peer of peers) peer.ws.terminate();
      for (const ws of wss.clients) ws.terminate();
      // ws.Server({server}) may defer its own 'close' event until the
      // attached HTTP server closes. Start BOTH closures together; awaiting
      // wss.close() first deadlocks this live TCP integration teardown.
      await Promise.all([
        new Promise<void>((resolve) => wss.close(() => resolve())),
        new Promise<void>((resolve) => server.close(() => resolve())),
      ]);
    });

    const [a, b, c] = await Promise.all([socket(url), socket(url), socket(url)]);
    peers.push(a, b, c);
    for (let i = 0; i < 3; i++) await joined([a,b,c][i], MATCH_ID, tokens[i], i);
    await waitFor(() => acceptedSockets === 3, "three signed WebSocket admissions");
    game.prestart();
    game.start();
    await waitFor(() => [a,b,c].every(p => starts(p).length === 1), "three NATIONAL start frames");
    expect(canonical).not.toBeNull();
    const started = [a,b,c].map((peer, i) => {
      const msg = starts(peer)[0];
      if (msg.type !== "national_start") throw new Error("missing NATIONAL start");
      expect(msg.myClientID).toBe(SEAT_IDS[i]);
      expect(msg.gameStartInfo.gameID).toBe(MATCH_ID);
      expect(msg.gameStartInfo.players.map(p => p.clientID)).toEqual(SEAT_IDS.slice(0,3));
      return msg;
    });
    expect(new Set(started.map(x => x.gameStartInfo.gameID))).toEqual(new Set([MATCH_ID]));
    await waitFor(() => [a,b,c].every(p => recipientPackets(p).length > 0), "three private projections");

    send(a, { type: "intent", intent: {
      type: "national_found_empire", empireId: EMPIRE, requestId: foundToken,
      clientID: SEAT_IDS[1], // the wire serializer must never grant this forged actor
    } as any });
    await waitFor(() => receipt(a, foundToken) !== undefined, "founding canonical receipt");
    const founding = receipt(a, foundToken) as { actorId: string; accepted: boolean };
    expect(founding.actorId).toBe(SEAT_IDS[0]);
    expect(founding.accepted).toBe(true);
    expect(receipt(b, foundToken)).toBeUndefined();
    expect(receipt(c, foundToken)).toBeUndefined();
    // A consumed token cannot be stolen by another independently signed account.
    send(b, { type: "intent", intent: {
      type: "national_found_empire", empireId: "stolen-foundation", requestId: foundToken,
    } });
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(receipt(b, foundToken)).toBeUndefined();
    const war = {
      type: "national_declare_war" as const,
      scope: "national" as const,
      nationId: SEAT_IDS[0], targetId: SEAT_IDS[1],
      targetKind: "nation" as const, requestId: warToken,
    };
    send(a, { type: "intent", intent: war });
    await waitFor(() => receipt(a, warToken) !== undefined, "WAR canonical command receipt");
    expect(receipt(b, warToken)).toBeUndefined();
    expect(receipt(c, warToken)).toBeUndefined();

    // All observed wire frames must be well-formed typed messages. No turn,
    // snapshot, hidden canonical state, private buffers or spectator projector.
    for (const p of [a,b,c]) {
      expect(p.frames.length).toBeGreaterThan(1);
      expect(p.messages.some(m => m.type === "turn" || m.type === "start")).toBe(false);
      for (const packet of recipientPackets(p)) {
        expect(Object.keys(packet)).not.toContain("turns");
        expect(Object.keys(packet)).not.toContain("snapshot");
        expect(Object.keys(packet)).not.toContain("packedAttackUpdates");
        expect(Object.keys(packet)).not.toContain("packedMotionPlans");
        expect(Object.keys(packet)).not.toContain("game");
      }
    }

    // A new cryptographically signed token for the SAME public account can
    // replace its socket; a changed account cannot, even with a valid JWT.
    const replacement = await socket(url);
    peers.push(replacement);
    send(replacement, { type: "rejoin", gameID: MATCH_ID, lastTurn: 0, token: tokens[0] });
    await waitFor(() => starts(replacement).length === 1, "original A account reconnect");
    const oldFrameCount = a.frames.length;
    await waitFor(() => recipientPackets(replacement).length > 0, "reconnected A private cursor");
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(a.frames).toHaveLength(oldFrameCount);
    expect(replacement.ws.readyState).toBe(WebSocket.OPEN);

    // Change the trusted account lookup for B: signed sub is B, but the
    // independent API publicId changed. Do not displace its original socket.
    profiles.set(ACCOUNT_UUIDS[1], { index: 1, publicId: "wrong-account-identity" });
    const wrong = await socket(url);
    peers.push(wrong);
    send(wrong, { type: "rejoin", gameID: MATCH_ID, lastTurn: 0, token: tokens[1] });
    await waitFor(() => deniedSockets >= 1, "mismatched account rejected");
    expect(starts(wrong)).toHaveLength(0);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);

    const attacker = await socket(url);
    peers.push(attacker);
    await joined(attacker, MATCH_ID, forgedToken, 0);
    await waitFor(() => deniedSockets >= 2, "forged EdDSA signature rejected");
    expect(starts(attacker)).toHaveLength(0);

    const spectator = await socket(url);
    peers.push(spectator);
    await joined(spectator, MATCH_ID, tokens[3], 3, true);
    await waitFor(() => deniedSockets >= 3, "late spectator rejected");
    expect(starts(spectator)).toHaveLength(0);
    expect(recipientPackets(spectator)).toHaveLength(0);
    expect(acceptedSockets).toBe(4); // 3 entrants + A original-seat replacement

    // Freeze the authoritative tick, queue B's genuine socket command, then
    // physically disconnect B before execution. Replacing or killing a
    // socket must cancel its still-uncommitted capabilities.
    send(replacement, {
      type: "intent", intent: { type: "toggle_pause", paused: true },
    });
    await waitFor(() => game.isPaused(), "authenticated host pauses game");
    const abandonedToken = "c2_disconnected_pending_command";
    send(b, { type: "intent", intent: {
      type: "national_found_empire",
      empireId: "must-not-commit",
      requestId: abandonedToken,
    } });
    await new Promise(resolve => setTimeout(resolve, 45));
    b.ws.close();
    await waitFor(() => game.numClients() === 2, "B physical socket disconnect");
    send(replacement, {
      type: "intent", intent: { type: "toggle_pause", paused: false },
    });
    await waitFor(() => !game.isPaused(), "A resumes canonical server");
    await new Promise(resolve => setTimeout(resolve, 140));
    expect(receipt(c, abandonedToken)).toBeUndefined();
    expect(receipt(replacement, abandonedToken)).toBeUndefined();
    const authoritativeGame = requireCanonical().game;
    expect(
      authoritativeGame
        .nationalPoliticalCommandResults(authoritativeGame.player(SEAT_IDS[1]))
        .find((r) => r.requestId === abandonedToken),
    ).toBeUndefined();
    expect(b.ws.readyState).not.toBe(WebSocket.OPEN);
  });
});
