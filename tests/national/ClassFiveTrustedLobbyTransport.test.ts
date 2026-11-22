/**
 * Fifth Class E2: real GameServer -> SocketIngress -> GameRunner -> E3
 * projection for three distinct authenticated seats. Only websocket transport
 * and small test terrain are substituted. There is ONE live game instance.
 */
import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import type { WireGameStartInfo } from "@openfront/shared/WireSchemas";
import { createGameWireContext } from "@openfront/shared/ZbinWire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTrustedNationalProjection } from "../../src/client/TrustedNationalSession";
import type { Client } from "../../src/server/Client";
import type { GameServer } from "../../src/server/GameServer";
import {
  cid,
  makeClient,
  makeGame,
  makeMockWs,
  mockWsOf,
} from "../util/GameServerHarness";
import { setup } from "../util/Setup";
import { TestConfig } from "../util/TestConfig";

class TrustedTestConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}

const ids = [cid("host5"), cid("beta5"), cid("gamma5")];
const publics = ["verified-host", "verified-beta", "verified-gamma"];
const ctx = createGameWireContext(ids.map((clientID) => ({ clientID })));

function verified(index: number): Client {
  return makeClient({
    clientID: ids[index],
    persistentID: "verified-persistent-" + index,
    publicId: publics[index],
    username: ["Alpha", "Bravo", "Charlie"][index],
    // The real Worker obtains this from a validated signed account token.
    claims: {
      sub: "verified-persistent-" + index,
      provider: "google",
    } as NonNullable<Client["claims"]>,
  });
}

async function realRunner(info: WireGameStartInfo): Promise<GameRunner> {
  const humans = info.players.map(
    (p) => new PlayerInfo(p.username, PlayerType.Human, p.clientID, p.clientID),
  );
  const game = await setup(
    "plains",
    {
      ...info.config,
      nationalMode: true,
      gameType: GameType.Private,
      gameMode: GameMode.FFA,
      bots: 0,
      nations: "disabled",
    },
    humans,
    undefined,
    TrustedTestConfig,
  );
  for (let i = 0; i < humans.length; i++) {
    game.addExecution(
      new SpawnExecution(info.gameID, humans[i], game.ref(20 + 30 * i, 20)),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  return new GameRunner(
    game,
    new Executor(game, info.gameID, undefined),
    () => {},
  );
}

function fixture(
  seats = [verified(0), verified(1), verified(2)],
  extra?: Client,
) {
  const game = makeGame({
    id: cid("nat5"),
    creatorPersistentID: seats[0].persistentID,
    config: {
      nationalMode: true,
      gameType: GameType.Private,
      gameMode: GameMode.FFA,
      bots: 0,
      nations: "disabled",
    },
    deps: { createNationalRunner: realRunner, turnIntervalMs: () => 1000 },
  });
  for (const client of seats) {
    expect(game.joinClient(client)).toBe(
      client.claims === null ? "not_trusted" : "joined",
    );
  }
  if (extra) expect(game.joinClient(extra)).toBe("joined");
  return { game, seats };
}

async function boot(game: GameServer) {
  game.prestart();
  game.start();
  // Flush terrain and runner Promise jobs, never manufacture a game receipt.
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

function sent(client: Client) {
  return mockWsOf(client).sent(ctx);
}
function starts(client: Client) {
  return sent(client).filter((m) => m.type === "national_start");
}
function projections(client: Client) {
  return sent(client)
    .filter((m) => m.type === "national_projection")
    .map((m) => {
      if (m.type !== "national_projection") throw new Error("invalid frame");
      return parseTrustedNationalProjection(m.payload, m.tick);
    });
}
function receipt(client: Client, token: string) {
  return projections(client).some(
    (p) =>
      Array.isArray(p.nationalCommandResults) &&
      p.nationalCommandResults.some(
        (r: unknown) =>
          r !== null &&
          typeof r === "object" &&
          (r as { requestId?: string }).requestId === token,
      ),
  );
}
async function action(client: Client, intent: Record<string, unknown>) {
  await mockWsOf(client).emit({ type: "intent", intent } as any);
}

describe("Class Five authenticated NATIONAL GameServer session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("never flushes a canonical turn from a hostile host pause in NATIONAL prestart", async () => {
    const {
      game,
      seats: [host, beta],
    } = fixture();
    game.prestart();
    await action(host, { type: "toggle_pause", paused: true });
    await action(beta, {
      type: "national_found_empire",
      empireId: "must-not-queue",
      requestId: "untrusted-prestart",
    });
    expect(game.isPaused()).toBe(false);
    expect(sent(host).some((m) => m.type === "turn")).toBe(false);
    game.start();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(starts(host)).toHaveLength(1);
    expect(receipt(beta, "untrusted-prestart")).toBe(false);
    expect(sent(host).some((m) => m.type === "turn")).toBe(false);
  });

  it("uses one match for three humans, sends no canonical turns, isolates private E1 receipts", async () => {
    const {
      game,
      seats: [a, b, c],
    } = fixture();
    await boot(game);
    for (const client of [a, b, c]) {
      expect(starts(client)).toHaveLength(1);
      const start = starts(client)[0];
      if (start.type !== "national_start") throw new Error("wrong start");
      expect(start.gameStartInfo.gameID).toBe(cid("nat5"));
      expect(start.gameStartInfo.players).toHaveLength(3);
      expect(projections(client).length).toBeGreaterThan(0);
      expect(
        sent(client).some((m) => m.type === "turn" || m.type === "start"),
      ).toBe(false);
    }
    await action(a, {
      type: "national_found_empire",
      empireId: "fifth-alpha-empire",
      requestId: "class5-original-a",
    });
    vi.advanceTimersByTime(2000);
    expect(receipt(a, "class5-original-a")).toBe(true);
    expect(receipt(b, "class5-original-a")).toBe(false);
    expect(receipt(c, "class5-original-a")).toBe(false);
    for (const client of [a, b, c]) {
      for (const p of projections(client)) {
        expect(Object.keys(p)).not.toContain("turns");
        expect(Object.keys(p)).not.toContain("snapshot");
        expect(Object.keys(p)).not.toContain("packedAttackUpdates");
        expect(Object.keys(p)).not.toContain("packedMotionPlans");
      }
    }
  });

  it("stamps a forged socket principal as its real seat; denies unauthorized host actions", async () => {
    const {
      game,
      seats: [a, b, c],
    } = fixture();
    await boot(game);
    await action(b, {
      type: "national_found_empire",
      empireId: "bravo-empire",
      requestId: "class5-spoof-b",
      clientID: a.clientID,
    });
    await action(c, {
      type: "update_game_config",
      config: { nationalMode: false },
    });
    await action(c, { type: "toggle_pause", paused: true });
    expect(game.gameConfig.nationalMode).toBe(true);
    expect(game.isPaused()).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(receipt(b, "class5-spoof-b")).toBe(true);
    expect(receipt(a, "class5-spoof-b")).toBe(false);
    await action(a, { type: "toggle_pause", paused: true });
    expect(game.isPaused()).toBe(true);
    const before = projections(a).length;
    vi.advanceTimersByTime(1000);
    expect(projections(a)).toHaveLength(before);
    await action(a, { type: "toggle_pause", paused: false });
    vi.advanceTimersByTime(1000);
    expect(projections(a).length).toBeGreaterThan(before);
  });

  it("revokes old socket, permits original-seat reconnect and refuses late or kicked entrants", async () => {
    const {
      game,
      seats: [a, b, c],
    } = fixture();
    await boot(game);
    const oldWs = mockWsOf(a);
    await oldWs.trigger("close");
    const before = projections(a).length;
    vi.advanceTimersByTime(1000);
    expect(projections(a)).toHaveLength(before);
    expect(projections(b).length).toBeGreaterThan(before);
    const freshWs = makeMockWs();
    expect(
      game.rejoinClient(freshWs as any, a.persistentID, 0, undefined, {
        subject: a.persistentID,
        publicId: a.publicId!,
      }),
    ).toBe(true);
    expect(freshWs.sent(ctx).some((m) => m.type === "national_start")).toBe(
      true,
    );
    vi.advanceTimersByTime(1000);
    expect(
      freshWs.sent(ctx).some((m) => m.type === "national_projection"),
    ).toBe(true);
    const late = makeClient({
      clientID: cid("late5"),
      persistentID: "late-person",
      publicId: "verified-late",
      claims: { sub: "late-person", provider: "google" } as NonNullable<
        Client["claims"]
      >,
    });
    expect(game.joinClient(late)).toBe("started");
    expect(game.rejoinClient(makeMockWs() as any, "not-seated")).toBe(false);
    expect(
      game.rejoinClient(makeMockWs() as any, c.persistentID, 0, undefined, {
        subject: c.persistentID,
        publicId: "wrong-account",
      }),
    ).toBe(false);
    game.kickClient(b.clientID);
    expect(game.rejoinClient(makeMockWs() as any, b.persistentID)).toBe(false);
    await mockWsOf(c).emit({ type: "spectate", spectator: true });
    expect(c.spectator).toBe(false);
  });

  it("fails closed on anonymous or duplicated verified accounts", async () => {
    const [a, b, c] = [verified(0), verified(1), verified(2)];
    const guest = Object.assign(Object.create(Object.getPrototypeOf(b)), b, {
      claims: null,
    }) as Client;
    const one = fixture([a, guest, c]);
    expect(one.game.activeClients()).not.toContain(guest);
    expect(
      sent(guest).some((m) => m.type === "turn" || m.type === "national_start"),
    ).toBe(false);
    const duplicate = Object.assign(
      Object.create(Object.getPrototypeOf(c)),
      verified(2),
      {
        publicId: publics[1],
      },
    ) as Client;
    const two = fixture([verified(0), verified(1), duplicate]);
    await boot(two.game);
    expect(two.game.hasEnded()).toBe(true);
  });

  it("refuses to grant spectators any private NATIONAL projection", async () => {
    const spectator = makeClient({
      clientID: cid("watch5"),
      persistentID: "watch5-account",
      spectator: true,
      claims: { sub: "watch5-account", provider: "google" } as NonNullable<
        Client["claims"]
      >,
      publicId: "verified-watcher",
    });
    const { game, seats } = fixture(undefined, spectator);
    await boot(game);
    expect(mockWsOf(spectator).close).toHaveBeenCalled();
    expect(
      sent(spectator).some(
        (m) => m.type === "national_start" || m.type === "national_projection",
      ),
    ).toBe(false);
    expect(projections(seats[0]).length).toBeGreaterThan(0);
  });
});
