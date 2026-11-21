import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { Client } from "../../src/server/Client";
import { TrustedNationalMatch } from "../../src/server/national/TrustedNationalMatch";
import { setup } from "../util/Setup";
import { TestConfig } from "../util/TestConfig";

const GAME_ID = "TRUSTEDNATIONAL4";

/** Test uses the exact explicit Private authority exception, not Solo. */
class TrustedTestConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}

function seat(clientID: string, publicId: string): Client {
  // Only the Worker may actually construct an authenticated Client in prod.
  // Tests supply its independently verified account fields explicitly.
  return new Client(
    clientID, "persistent-" + clientID, {} as NonNullable<Client["claims"]>,
    null, undefined, "127.0.0.1", clientID, null,
    {} as Client["ws"], undefined, publicId, [],
  );
}

async function match() {
  const humans = [
    new PlayerInfo("Alpha", PlayerType.Human, "TRUSTEDA1", "ALPHA1"),
    new PlayerInfo("Bravo", PlayerType.Human, "TRUSTEDB1", "BRAVO1"),
  ];
  const game = await setup(
    "plains",
    { nationalMode: true, gameType: GameType.Private, gameMode: GameMode.FFA },
    humans,
    undefined,
    TrustedTestConfig,
  );
  for (let i = 0; i < humans.length; i++) {
    game.addExecution(
      new SpawnExecution(
        GAME_ID,
        humans[i],
        game.ref(i === 0 ? 20 : 80, 20),
      ),
    );
  }
  game.executeNextTick();
  game.executeNextTick();

  const runner = new GameRunner(
    game, new Executor(game, GAME_ID, undefined), () => {}, undefined,
  );
  const a = seat("TRUSTEDA1", "verified-account-a");
  const b = seat("TRUSTEDB1", "verified-account-b");
  const sentA: GameUpdateViewData[] = [];
  const sentB: GameUpdateViewData[] = [];
  const authority = new TrustedNationalMatch(
    GAME_ID, runner, [a, b], (client, packet) => {
      if (client === a) sentA.push(packet);
      if (client === b) sentB.push(packet);
    },
  );
  return { game, humans, runner, a, b, sentA, sentB, authority };
}

describe("Fourth Class / E2 trusted Private NATIONAL host", () => {
  it("keeps browser and replay EngineConfig calls blocked without explicit host authority", () => {
    const args = {
      nationalMode: true,
      gameType: GameType.Private,
      gameMode: GameMode.FFA,
    } as GameConfig;
    expect(() => new EngineConfig(args, false)).toThrow(
      "NATIONAL requires unranked Solo Free For All",
    );
    expect(() => new EngineConfig(args, false, false, false, true)).not.toThrow();
    expect(() =>
      new EngineConfig({ ...args, gameType: GameType.Public }, false, false, false, true),
    ).toThrow();
    expect(() =>
      new EngineConfig({ ...args, gameMode: GameMode.Team }, false, false, false, true),
    ).toThrow();
  });

  it("stamps real distinct authenticated humans, executes a real tick and privately fans out E3 packets", async () => {
    const { authority, a, b, humans, sentA, sentB } = await match();

    expect(authority.submit(a, {
      type: "national_found_empire",
      empireId: "empire-alpha",
      requestId: "request-from-a",
      clientID: b.clientID, // deliberately forged; the schema drops it
    })).toBe(true);
    expect(authority.submit(a, {
      type: "national_found_empire",
      empireId: "empire-alpha",
      requestId: "request-from-a",
    })).toBe(false);
    expect(authority.submit({ ...a } as Client, {
      type: "national_found_empire", empireId: "forged", requestId: "fake",
    })).toBe(false);
    expect(authority.submit(a, { type: "toggle_pause", paused: true })).toBe(false);
    expect(authority.submit(b, { type: "mark_disconnected" })).toBe(false);

    const receipt = authority.tick();
    expect(receipt.committedIntents).toBe(1);
    expect(receipt.tick).toBeGreaterThan(0);
    expect(receipt.replayDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(sentA).toHaveLength(1);
    expect(sentB).toHaveLength(1);
    expect(sentA[0]).not.toBe(sentB[0]);
    expect(sentA[0].tick).toBe(receipt.tick);
    expect(sentB[0].tick).toBe(receipt.tick);
    expect(sentA[0].nationalConflicts?.recipientId).toBe(humans[0].id);
    expect(sentB[0].nationalConflicts?.recipientId).toBe(humans[1].id);
    expect(sentA[0].nationalCommandResults?.every(
      (result) => result.actorId === humans[0].id,
    )).not.toBe(false);
    expect(sentB[0].nationalCommandResults?.some(
      (result) => result.actorId === humans[0].id,
    ) ?? false).toBe(false);

    authority.revokeRecipient(b);
    authority.tick();
    expect(sentA).toHaveLength(2);
    expect(sentB).toHaveLength(1);
  });

  it("rejects fake extra players, anonymous seats and duplicate accounts", async () => {
    const { runner, a, b } = await match();
    expect(() => new TrustedNationalMatch(GAME_ID, runner, [a], () => {})).toThrow(
      "two real authenticated humans",
    );
    const anonymous = seat("TRUSTEDB1", "other");
    // Runtime fields cannot be assigned (readonly), so model an untrusted
    // attempt without changing the authentic fixture.
    const guest = Object.assign(Object.create(Object.getPrototypeOf(anonymous)), anonymous, {
      claims: null,
    }) as Client;
    expect(() => new TrustedNationalMatch(GAME_ID, runner, [a, guest], () => {})).toThrow(
      "unauthenticated",
    );
    const repeatedAccount = Object.assign(Object.create(Object.getPrototypeOf(b)), b, {
      publicId: a.publicId,
    }) as Client;
    expect(() =>
      new TrustedNationalMatch(GAME_ID, runner, [a, repeatedAccount], () => {}),
    ).toThrow("duplicate");
    const invented = seat("NOTINREALGAME", "legitimate-different-account");
    expect(() =>
      new TrustedNationalMatch(GAME_ID, runner, [a, invented], () => {}),
    ).toThrow("real Game registry");
  });

  it("is deterministic for identical admitted principals and stamped intents", async () => {
    const first = await match();
    const second = await match();
    const candidate = {
      type: "national_found_empire",
      empireId: "alpha-country",
      requestId: "replay-a-1",
    };
    expect(first.authority.submit(first.a, candidate)).toBe(true);
    expect(second.authority.submit(second.a, candidate)).toBe(true);
    expect(first.authority.tick().replayDigest).toBe(
      second.authority.tick().replayDigest,
    );
    expect(first.game.nationalPublicPoliticalView()).toEqual(
      second.game.nationalPublicPoliticalView(),
    );
    expect(first.authority.tick().replayDigest).toBe(
      second.authority.tick().replayDigest,
    );
  });
});
