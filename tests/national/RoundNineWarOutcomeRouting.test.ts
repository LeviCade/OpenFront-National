import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";

const north = new PlayerInfo("North", PlayerType.Human, "R9NORTH1", "r9-north");
const south = new PlayerInfo("South", PlayerType.Human, "R9SOUTH1", "r9-south");

async function spawned(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, [north, south]);
  game.addExecution(
    new SpawnExecution("r9-war-outcomes", north, game.ref(25, 25)),
  );
  game.addExecution(
    new SpawnExecution("r9-war-outcomes", south, game.ref(75, 75)),
  );
  game.executeNextTick();
  game.executeNextTick();
  expect(game.player(north.id).hasSpawned()).toBe(true);
  expect(game.player(south.id).hasSpawned()).toBe(true);
  return game;
}

function queue(
  game: Game,
  command: Record<string, unknown>,
  clientID: string,
): void {
  const intent = StampedIntentSchema.parse({ ...command, clientID });
  game.addExecution(
    new Executor(game, "r9-war-outcomes", undefined).createExec(intent),
  );
}

describe("E2 Round Nine WAR execution to E1-owned outcome port", () => {
  it("forwards a forged sovereign claim to E1 with the stamped actor", async () => {
    const game = await spawned();
    const before = game.nationalWarState();
    const outcome = vi.fn(() => ({ accepted: false }));
    const legacy = vi.spyOn(game, "performNationalWarCommand");
    Object.defineProperty(game, "performNationalWarCommandWithOutcome", {
      value: outcome,
      configurable: true,
    });

    queue(
      game,
      {
        type: "national_declare_war",
        scope: "national",
        nationId: north.id,
        targetId: south.id,
        targetKind: "nation",
        requestId: "r9_forged_claim",
      },
      south.clientID,
    );
    game.executeNextTick();
    game.executeNextTick();

    expect(outcome).toHaveBeenCalledWith(
      game.player(south.id),
      expect.objectContaining({
        kind: "declare-national",
        aggressorId: north.id,
        targetId: south.id,
      }),
      "r9_forged_claim",
    );
    expect(legacy).not.toHaveBeenCalled();
    expect(game.nationalWarState()).toEqual(before);
  });

  it("forwards stale peace and repeated tokens without E2 deduplication", async () => {
    const game = await spawned();
    const outcome = vi.fn(() => ({ accepted: false }));
    Object.defineProperty(game, "performNationalWarCommandWithOutcome", {
      value: outcome,
      configurable: true,
    });

    queue(
      game,
      {
        type: "national_propose_peace",
        warId: "stale-war",
        requestId: "r9_replayed_click",
      },
      north.clientID,
    );
    queue(
      game,
      {
        type: "national_accept_peace",
        motionId: "stale-motion",
        requestId: "r9_replayed_click",
      },
      north.clientID,
    );
    game.executeNextTick();
    game.executeNextTick();

    expect(outcome).toHaveBeenCalledTimes(2);
    expect(outcome).toHaveBeenCalledWith(
      game.player(north.id),
      expect.objectContaining({
        kind: "propose-peace",
        warId: "stale-war",
      }),
      "r9_replayed_click",
    );
    expect(outcome).toHaveBeenCalledWith(
      game.player(north.id),
      expect.objectContaining({
        kind: "accept-peace",
        motionId: "stale-motion",
      }),
      "r9_replayed_click",
    );
    expect(game.nationalWarAuthority()?.atWar(north.id, south.id)).toBe(false);
  });

  it("does not lose a rejected imperial click or invent a legacy token", async () => {
    const game = await spawned();
    const outcome = vi.fn(() => ({ accepted: false }));
    Object.defineProperty(game, "performNationalWarCommandWithOutcome", {
      value: outcome,
      configurable: true,
    });

    queue(
      game,
      {
        type: "national_declare_war",
        scope: "imperial",
        nationId: north.id,
        targetId: south.id,
        targetKind: "nation",
      },
      north.clientID,
    );
    game.executeNextTick();
    game.executeNextTick();

    expect(outcome).toHaveBeenCalledWith(
      game.player(north.id),
      expect.objectContaining({
        kind: "declare-imperial",
        target: { kind: "nation", id: south.id },
      }),
      null,
    );
    expect(game.nationalWarAuthority()?.atWar(north.id, south.id)).toBe(false);
  });
});
