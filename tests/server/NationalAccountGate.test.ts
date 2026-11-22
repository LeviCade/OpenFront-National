import { GameMode, GameType } from "@openfront/engine-api/game/GameTypes";
import type { TokenPayload } from "@openfront/shared/ApiSchemas";
import {
  CreateGameInputSchema,
  isPrivateGameInput,
} from "@openfront/shared/WorkerSchemas";
import { describe, expect, it } from "vitest";
import { isNationalSignedInAccount } from "../../src/server/national/NationalAccountGate";
import { registerNationalSocketOrigin } from "../../src/server/national/NationalSocketOrigin";
import {
  cid,
  makeClient,
  makeGame,
  makeMockWs,
} from "../util/GameServerHarness";

const claims = (sub: string, provider?: string, role?: string) =>
  ({ sub, provider, role }) as TokenPayload;

describe("NATIONAL signed-account browser boundary", () => {
  it("denies anonymous/dev, signed guests, blank providers and bans", () => {
    expect(isNationalSignedInAccount(null)).toBe(false);
    expect(isNationalSignedInAccount(claims("a"))).toBe(false);
    expect(isNationalSignedInAccount(claims("a", "guest"))).toBe(false);
    expect(isNationalSignedInAccount(claims("a", " "))).toBe(false);
    expect(isNationalSignedInAccount(claims("a", "google", "banned"))).toBe(
      false,
    );
    expect(isNationalSignedInAccount(claims("", "google"))).toBe(false);
  });

  it("recognizes provider-bearing signed account claims", () => {
    for (const provider of ["google", "discord", "steam", "email"]) {
      expect(isNationalSignedInAccount(claims("verified-sub", provider))).toBe(
        true,
      );
    }
  });

  it("creates only an unlisted private FFA from the abbreviated request", () => {
    const parsed = CreateGameInputSchema.parse({ nationalMode: true });
    expect(parsed).toMatchObject({
      nationalMode: true,
      gameType: GameType.Private,
      gameMode: GameMode.FFA,
      bots: 0,
      nations: "disabled",
    });
    expect(isPrivateGameInput(parsed)).toBe(true);
    expect(
      CreateGameInputSchema.safeParse({
        nationalMode: true,
        gameType: GameType.Public,
      }).success,
    ).toBe(false);
    expect(
      CreateGameInputSchema.safeParse({
        nationalMode: true,
        admin: true,
      }).success,
    ).toBe(false);
  });

  it("rejects guests and account identity mismatches at actual GameServer admission", () => {
    const game = makeGame({
      config: {
        nationalMode: true,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
      },
    });
    expect(
      game.joinClient(
        makeClient({
          clientID: cid("guest1"),
          persistentID: "guest-a",
          publicId: "asserted-guest",
          claims: claims("guest-a", "guest"),
        }),
      ),
    ).toBe("not_trusted");
    expect(
      game.joinClient(
        makeClient({
          clientID: cid("mismatch"),
          persistentID: "subject-A",
          publicId: "asserted-other",
          claims: claims("subject-B", "google"),
        }),
      ),
    ).toBe("not_trusted");
    expect(
      game.joinClient(
        makeClient({
          clientID: cid("valid1"),
          persistentID: "subject-A",
          publicId: "api-verified-public",
          claims: claims("subject-A", "google"),
        }),
      ),
    ).toBe("joined");
    expect(
      game.joinClient(
        makeClient({
          clientID: cid("aliased"),
          persistentID: "subject-C",
          publicId: "api-verified-public",
          claims: claims("subject-C", "google"),
        }),
      ),
    ).toBe("not_trusted");
  });

  it("allows mode opt-in with valid creator but rejects invalid subsequent mode", () => {
    const id = cid("natHost");
    const game = makeGame({
      creatorPersistentID: "verified-host",
      config: { gameType: GameType.Private, gameMode: GameMode.FFA },
    });
    const original = makeClient({
      clientID: id,
      persistentID: "verified-host",
      publicId: "api-host",
      claims: claims("verified-host", "google"),
    });
    registerNationalSocketOrigin(original.ws, "http://localhost:9000");
    expect(game.joinClient(original)).toBe("joined");
    const actor = {
      clientID: id,
      isLobbyCreator: true,
      isAdmin: false,
      isAdminBot: false,
    };
    expect(
      game.handleIntent(
        { type: "update_game_config", config: { nationalMode: true } },
        actor,
      ).status,
    ).toBe(200);
    expect(game.gameConfig.nationalMode).toBe(true);
    expect(
      game.handleIntent(
        { type: "update_game_config", config: { gameMode: GameMode.Team } },
        actor,
      ).status,
    ).toBe(403);
  });
  it("rejects NATIONAL upgrade on an untrusted replacement physical socket", () => {
    const id = cid("oldSocket");
    const game = makeGame({
      creatorPersistentID: "verified-old",
      config: { gameType: GameType.Private, gameMode: GameMode.FFA },
    });
    const player = makeClient({
      clientID: id,
      persistentID: "verified-old",
      publicId: "real-old",
      claims: claims("verified-old", "google"),
    });
    registerNationalSocketOrigin(player.ws, "http://localhost:9000");
    expect(game.joinClient(player)).toBe("joined");
    const actor = {
      clientID: id,
      isLobbyCreator: true,
      isAdmin: false,
      isAdminBot: false,
    };
    const untrusted = makeClient({ clientID: cid("replacementSocket") }).ws;
    expect(game.rejoinClient(untrusted, "verified-old")).toBe(true);
    expect(game.handleIntent(
      { type: "update_game_config", config: { nationalMode: true } },
      actor,
    ).status).toBe(403);
    expect(game.gameConfig.nationalMode).not.toBe(true);
    registerNationalSocketOrigin(untrusted, "http://localhost:9000");
    expect(game.handleIntent(
      { type: "update_game_config", config: { nationalMode: true } },
      actor,
    ).status).toBe(200);
  });

  it("does not restore superseded account roles on valid reconnect", () => {
    const client = makeClient({
      clientID: cid("roleOne"),
      persistentID: "role-sub",
      publicId: "real-role-public",
      role: "admin",
      claims: claims("role-sub", "google", "admin"),
    });
    const game = makeGame({
      config: {
        nationalMode: true,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
      },
    });
    expect(game.joinClient(client)).toBe("joined");
    const changed = game.rejoinClient(
      makeMockWs() as any,
      "role-sub",
      0,
      undefined,
      {
        subject: "role-sub",
        publicId: "real-role-public",
        claims: claims("role-sub", "google", "mod"),
      },
    );
    expect(changed).toBe(true);
    expect(client.role).toBe("mod");
    expect(client.claims?.role).toBe("mod");
  });
});
