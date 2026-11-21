import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game, Player } from "@openfront/engine/game/Game";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";

const human = PlayerType.Human;
const north = new PlayerInfo("N", human, "R9NORTH1", "r9-north");
const south = new PlayerInfo("S", human, "R9SOUTH1", "r9-south");

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
  clientID: string | null,
): void {
  if (clientID === null) throw new Error("Missing fixture client identity");
  const intent = StampedIntentSchema.parse({ ...command, clientID });
  game.addExecution(
    new Executor(game, "r9-war-outcomes", undefined).createExec(intent),
  );
}

function withCanonicalOutcome(game: Game) {
  const outcome = vi.fn(
    (actor: Player, _command: unknown, requestId: string | null) => ({
      accepted: false,
      actorId: actor.id(),
      recipientId: actor.id(),
      requestId: requestId ?? "legacy-war-request",
    }),
  );
  Object.defineProperty(game, "nationalWarCommandResults", {
    value: () => [],
    configurable: true,
  });
  Object.defineProperty(game, "performNationalWarCommandWithOutcome", {
    value: outcome,
    configurable: true,
  });
  return outcome;
}

describe("E2 Round Nine WAR execution to E1-owned outcome port", () => {
  it("forwards forged claims with the stamped actor", async () => {
    const game = await spawned();
    const before = game.nationalWarState();
    const outcome = withCanonicalOutcome(game);

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
    expect(game.nationalWarState()).toEqual(before);
  });

  it("forwards stale peace and repeated tokens", async () => {
    const game = await spawned();
    const outcome = withCanonicalOutcome(game);

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

  it("forwards invalid imperial clicks and legacy null tokens", async () => {
    const game = await spawned();
    const outcome = withCanonicalOutcome(game);

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
