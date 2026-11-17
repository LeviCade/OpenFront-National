import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  NationalAcceptPeaceIntentSchema,
  NationalDeclareWarIntentSchema,
  NationalProposePeaceIntentSchema,
  StampedIntentSchema,
} from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const north = new PlayerInfo("North", PlayerType.Human, "R8NORTH1", "r8-north");
const south = new PlayerInfo("South", PlayerType.Human, "R8SOUTH1", "r8-south");

async function spawned(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, [north, south]);
  game.addExecution(
    new SpawnExecution("r8-war-request", north, game.ref(25, 25)),
  );
  game.addExecution(
    new SpawnExecution("r8-war-request", south, game.ref(75, 75)),
  );
  game.executeNextTick();
  game.executeNextTick();
  expect(game.player(north.id).hasSpawned()).toBe(true);
  expect(game.player(south.id).hasSpawned()).toBe(true);
  return game;
}

function declare(requestId?: string) {
  return {
    type: "national_declare_war" as const,
    scope: "national" as const,
    nationId: north.id,
    targetId: south.id,
    targetKind: "nation" as const,
    ...(requestId === undefined ? {} : { requestId }),
  };
}

describe("E2 Round Eight WAR/peace authenticated correlation transport", () => {
  it("rejects empty, oversized and nonopaque click IDs on all three wire intents, allowing historical no-ID clicks", () => {
    const schemas = [
      [NationalDeclareWarIntentSchema, declare()],
      [
        NationalProposePeaceIntentSchema,
        { type: "national_propose_peace", warId: "r8-war" },
      ],
      [
        NationalAcceptPeaceIntentSchema,
        { type: "national_accept_peace", motionId: "r8-motion" },
      ],
    ] as const;
    for (const [schema, intent] of schemas) {
      expect(schema.safeParse(intent).success).toBe(true);
      expect(
        schema.safeParse({ ...intent, requestId: "r8_click_ABC-01" }).success,
      ).toBe(true);
      for (const invalid of [
        "",
        "spaces cannot be IDs",
        "bad.dot",
        "x".repeat(129),
      ]) {
        expect(
          schema.safeParse({ ...intent, requestId: invalid }).success,
        ).toBe(false);
      }
    }
  });

  it("authenticated Executor preserves exact click ID through a real command and produces no synthetic receipt", async () => {
    const game = await spawned();
    const spy = vi.spyOn(game, "performNationalWarCommand");
    const authenticated = StampedIntentSchema.parse({
      ...declare("r8_declare_1"),
      clientID: north.clientID,
    });
    const exec = new Executor(game, "r8-war-request", undefined).createExec(
      authenticated,
    );
    game.addExecution(exec);
    game.executeNextTick();
    game.executeNextTick();
    expect(spy).toHaveBeenCalledWith(
      game.player(north.id),
      expect.objectContaining({
        kind: "declare-national",
        aggressorId: north.id,
        targetId: south.id,
        requestId: "r8_declare_1",
      }),
    );
    expect(game.nationalWarAuthority()?.atWar(north.id, south.id)).toBe(true);
    // E1 controls receipts: E2 must not fabricate acceptance based on the click.
    spy.mockRestore();
  });

  it("snapshot/restore preserves queued WAR request ID and authenticated actor, never permitting a forged principal", async () => {
    const game = await spawned();
    const command = StampedIntentSchema.parse({
      ...declare("r8_resumable_click"),
      clientID: north.clientID,
    });
    game.addExecution(
      new Executor(game, "r8-war-request", undefined).createExec(command),
    );
    game.executeNextTick(); // initialized pending execution
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    const forwarded = vi.spyOn(restored, "performNationalWarCommand");
    restored.executeNextTick();
    expect(forwarded).toHaveBeenCalledWith(
      restored.player(north.id),
      expect.objectContaining({
        kind: "declare-national",
        requestId: "r8_resumable_click",
      }),
    );
    expect(restored.nationalWarAuthority()?.atWar(north.id, south.id)).toBe(
      true,
    );
    forwarded.mockRestore();
  });

  it("server-stamped identity still rejects a third-party WAR click even when its request ID is well formed", async () => {
    const game = await spawned();
    const before = game.nationalWarState();
    const rejected = StampedIntentSchema.parse({
      ...declare("r8_forged_claim"),
      clientID: south.clientID,
    });
    game.addExecution(
      new Executor(game, "r8-war-request", undefined).createExec(rejected),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(game.nationalWarState()).toEqual(before);
    expect(game.nationalWarAuthority()?.atWar(north.id, south.id)).toBe(false);
  });
});
