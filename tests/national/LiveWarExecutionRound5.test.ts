import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { StampedIntent } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { authorizeNationalAttack } from "@openfront/engine/execution/NationalWarExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const names = [
  new PlayerInfo("North", PlayerType.Human, "north-client", "north-id"),
  new PlayerInfo("South", PlayerType.Human, "south-client", "south-id"),
  new PlayerInfo("East", PlayerType.Human, "east-client", "east-id"),
];

async function spawned(nationalMode = true): Promise<Game> {
  const game = await setup("plains", { nationalMode }, names);
  const coords = [
    [25, 25],
    [75, 25],
    [25, 75],
  ];
  for (let i = 0; i < names.length; i++)
    game.addExecution(
      new SpawnExecution(
        "round5-war",
        names[i],
        game.map().ref(coords[i][0], coords[i][1]),
      ),
    );
  game.executeNextTick();
  game.executeNextTick();
  for (const info of names)
    expect(game.player(info.id).hasSpawned()).toBe(true);
  return game;
}

function enqueue(game: Game, ...commands: StampedIntent[]) {
  const exec = new Executor(game, "round5-war", undefined);
  for (const command of commands) game.addExecution(exec.createExec(command));
  game.executeNextTick(); // initialize authenticated commands
  game.executeNextTick(); // execute once in deterministic tick order
}

function makeEmpire(game: Game) {
  game.performNationalCommand(game.player("north-id"), {
    kind: "found-empire",
    empireId: "north-empire",
  });
  game.performNationalCommand(game.player("north-id"), {
    kind: "offer-empire",
    empireId: "north-empire",
    candidateId: "east-id",
  });
  game.performNationalCommand(game.player("east-id"), {
    kind: "accept-empire",
    empireId: "north-empire",
    candidateId: "east-id",
  });
}

describe("E2 Round Five authenticated WAR execution against actual spawned Game", () => {
  it("WAR-01 rejects forged actor and third-party national declarations before mutating the ledger", async () => {
    const game = await spawned();
    const before = game.nationalWarState();
    enqueue(game, {
      type: "national_declare_war",
      scope: "national",
      nationId: "north-id",
      targetId: "south-id",
      targetKind: "nation",
      clientID: "forged-client",
    });
    expect(game.nationalWarState()).toEqual(before);
    enqueue(game, {
      type: "national_declare_war",
      scope: "national",
      nationId: "north-id",
      targetId: "south-id",
      targetKind: "nation",
      clientID: "east-client",
    });
    expect(game.nationalWarState()).toEqual(before);
    expect(authorizeNationalAttack(game, "north-id", "south-id")).toBe(false);
  });

  it("WAR-01 launches an authenticated national war through real Executor", async () => {
    const game = await spawned();
    enqueue(game, {
      type: "national_declare_war",
      scope: "national",
      nationId: "north-id",
      targetId: "south-id",
      targetKind: "nation",
      clientID: "north-client",
    });
    expect(game.nationalWarState()?.wars.layers).toHaveLength(1);
    expect(game.nationalWarState()?.wars.layers[0].scope).toBe("national");
    expect(authorizeNationalAttack(game, "north-id", "south-id")).toBe(true);
    expect(authorizeNationalAttack(game, "south-id", "north-id")).toBe(true);
    expect(authorizeNationalAttack(game, "east-id", "south-id")).toBe(false);
    expect(authorizeNationalAttack(game, "north-id", null)).toBe(true);
  });

  it("WAR-03/04/07 independent imperial and national war layers survive separately accepted peace", async () => {
    const game = await spawned();
    makeEmpire(game);
    enqueue(
      game,
      {
        type: "national_declare_war",
        scope: "national",
        nationId: "east-id",
        targetId: "south-id",
        targetKind: "nation",
        clientID: "north-client",
      },
      {
        type: "national_declare_war",
        scope: "imperial",
        nationId: "north-id",
        targetId: "south-id",
        targetKind: "nation",
        clientID: "north-client",
      },
    );
    const wars = game.nationalWarState()?.wars.layers ?? [];
    expect(wars).toHaveLength(2);
    expect(new Set(wars.map((x) => x.id)).size).toBe(2);
    const imperial = wars.find((x) => x.scope === "imperial")!;
    const national = wars.find((x) => x.scope === "national")!;
    expect(game.nationalWarAuthority()?.atWar("north-id", "south-id")).toBe(
      true,
    );
    expect(game.nationalWarAuthority()?.atWar("east-id", "south-id")).toBe(
      true,
    );

    enqueue(game, {
      type: "national_propose_peace",
      warId: imperial.id,
      clientID: "north-client",
    });
    const motion = game
      .nationalWarState()
      ?.wars.motions.find((x) => x.layerId === imperial.id);
    expect(motion).toBeDefined();
    if (motion === undefined) throw new Error("expected imperial peace motion");
    enqueue(game, {
      type: "national_accept_peace",
      motionId: motion.id,
      clientID: "south-client",
    });
    const after = game.nationalWarState()!.wars;
    expect(
      after.layers.find((x) => x.id === imperial.id)?.endedTick,
    ).not.toBeNull();
    expect(
      after.layers.find((x) => x.id === national.id)?.endedTick,
    ).toBeNull();
    expect(game.nationalWarAuthority()?.atWar("north-id", "south-id")).toBe(
      false,
    );
    expect(game.nationalWarAuthority()?.atWar("east-id", "south-id")).toBe(
      true,
    );

    // The remaining national layer also requires bilateral consent.
    enqueue(game, {
      type: "national_propose_peace",
      warId: national.id,
      clientID: "north-client",
    });
    const nextMotion = game
      .nationalWarState()
      ?.wars.motions.find((x) => x.layerId === national.id);
    expect(nextMotion).toBeDefined();
    if (nextMotion === undefined)
      throw new Error("expected national peace motion");
    enqueue(game, {
      type: "national_accept_peace",
      motionId: nextMotion.id,
      clientID: "south-client",
    });
    expect(game.nationalWarAuthority()?.atWar("east-id", "south-id")).toBe(
      false,
    );
  });

  it("WAR-04 wrong-side peace acceptance cannot close a layer", async () => {
    const game = await spawned();
    enqueue(game, {
      type: "national_declare_war",
      scope: "national",
      nationId: "north-id",
      targetId: "south-id",
      targetKind: "nation",
      clientID: "north-client",
    });
    const warId = game.nationalWarState()!.wars.layers[0].id;
    enqueue(game, {
      type: "national_propose_peace",
      warId,
      clientID: "north-client",
    });
    const motionId = game.nationalWarState()!.wars.motions[0].id;
    enqueue(game, {
      type: "national_accept_peace",
      motionId,
      clientID: "north-client",
    });
    expect(game.nationalWarState()!.wars.layers[0].endedTick).toBeNull();
    enqueue(game, {
      type: "national_accept_peace",
      motionId,
      clientID: "south-client",
    });
    expect(game.nationalWarState()!.wars.layers[0].endedTick).not.toBeNull();
  });

  it("WAR-07 queued war and peace command source round-trips with canonical state, no duplicate records", async () => {
    const game = await spawned();
    const command: StampedIntent = {
      type: "national_declare_war",
      scope: "national",
      nationId: "north-id",
      targetId: "south-id",
      targetKind: "nation",
      clientID: "north-client",
    };
    game.addExecution(
      new Executor(game, "round5-war", undefined).createExec(command),
    );
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    for (let i = 0; i < 2; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    expect(restored.nationalWarAuthority()?.atWar("north-id", "south-id")).toBe(
      true,
    );
    expect(restored.nationalWarState()?.wars.layers).toHaveLength(1);
  });

  it("legacy FFA never synthesizes formal-war authority", async () => {
    const game = await spawned(false);
    enqueue(game, {
      type: "national_declare_war",
      scope: "national",
      nationId: "north-id",
      targetId: "south-id",
      targetKind: "nation",
      clientID: "north-client",
    });
    expect(game.nationalWarState()).toBeNull();
    expect(authorizeNationalAttack(game, "north-id", "south-id")).toBe(true);
  });
});
