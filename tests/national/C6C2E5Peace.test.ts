import {
  Cell,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { planNationalPeace } from "@openfront/engine/national/ai/NationalPeaceStrategy";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const MATCH = "C6C2-E5-AI-PEACE";
const bot = new PlayerInfo("Nation", PlayerType.Nation, null, "e5-nation");
const human = new PlayerInfo(
  "Opponent",
  PlayerType.Human,
  "E5CLIENT",
  "e5-foe",
);
const outsider = new PlayerInfo(
  "Outsider",
  PlayerType.Human,
  "E5OTHER1",
  "e5-other",
);
const nation = new Nation(new Cell(15, 15), bot);
const WAR = "a-national";
const IMPERIAL = "z-imperial";

function runner(game: Game, clientID = human.clientID!) {
  const errors: string[] = [];
  const run = new GameRunner(
    game,
    new Executor(game, MATCH, clientID),
    (packet) => {
      if ("errMsg" in packet) errors.push(String(packet.errMsg));
    },
    clientID,
  );
  return (intent?: Record<string, unknown>) => {
    run.addTurn({
      turnNumber: game.ticks(),
      intents: intent
        ? [StampedIntentSchema.parse({ ...intent, clientID })]
        : [],
    });
    expect(run.executeNextTick()).toBe(true);
    expect(errors).toEqual([]);
  };
}

async function fixture(layered = false, incoming = false) {
  const game = await setup(
    "plains",
    { nationalMode: true },
    [human, outsider],
    undefined,
    undefined,
    true,
    [nation],
  );
  game.addExecution(
    new SpawnExecution(MATCH, bot, game.ref(15, 15)),
    new SpawnExecution(MATCH, human, game.ref(85, 85)),
    new SpawnExecution(MATCH, outsider, game.ref(85, 15)),
  );
  game.executeNextTick();
  game.executeNextTick();
  const a = game.player(bot.id);
  const b = game.player(human.id);
  expect(a.hasSpawned()).toBe(true);
  expect(b.hasSpawned()).toBe(true);
  for (let y = 20; y < 75; y++) {
    for (let x = 10; x < 35; x++) a.conquer(game.ref(x, y));
    for (let x = 35; x < 85; x++) b.conquer(game.ref(x, y));
  }
  game.executeNextTick();
  if (layered) {
    game.performNationalCommand(b, {
      kind: "found-empire",
      empireId: "e5-empire",
    });
  }
  game.performNationalWarCommand(b, {
    kind: "declare-national",
    warId: WAR,
    aggressorId: human.id,
    targetId: bot.id,
  });
  if (layered) {
    game.performNationalWarCommand(b, {
      kind: "declare-imperial",
      warId: IMPERIAL,
      aggressor: { kind: "empire", id: "e5-empire" },
      target: { kind: "nation", id: bot.id },
    });
  }
  a.setTroops(400);
  b.setTroops(100_000);
  // Register the real AI only after creating an active, lawful battlefield.
  game.addExecution(new AttackExecution(2_000, b, bot.id));
  game.executeNextTick();
  expect(b.outgoingAttacks().length).toBeGreaterThan(0);
  if (incoming) {
    const click = runner(game);
    click({
      type: "national_propose_peace",
      warId: WAR,
      requestId: "e5-incoming",
    });
    click();
    expect(
      game.nationalWarState()?.wars.motions.some(
        (motion) => motion.proposedBy === human.id,
      ),
    ).toBe(true);
  }
  game.addExecution(new NationExecution(MATCH, nation));
  return game;
}

function layer(game: Game, id: string) {
  const value = game.nationalWarState()?.wars.layers.find((l) => l.id === id);
  expect(value).toBeDefined();
  return value!;
}

function aiMotion(game: Game) {
  return game.nationalWarState()?.wars.motions.find(
    (motion) => motion.layerId === WAR && motion.proposedBy === bot.id,
  );
}

describe("C6C2-E5-AI-PEACE canonical GameRunner witness", () => {
  it.each([false, true])(
    "AI proposes, independent opponent accepts, parallel layer=%s",
    async (layered) => {
      const game = await fixture(layered);
      const advance = runner(game);
      for (let i = 0; i < 15 && !aiMotion(game); i++) advance();
      const motion = aiMotion(game);
      expect(motion).toBeDefined();
      expect(motion?.acceptedTick).toBeNull();
      expect(layer(game, WAR).endedTick).toBeNull();
      const b = game.player(human.id);
      expect(b.outgoingAttacks().length).toBeGreaterThan(0);
      const observed = collectLiveNationalObservation(game, human.id).observation;
      expect(observed.peaceNegotiations).toContainEqual(
        expect.objectContaining({
          warId: WAR,
          incomingMotionIds: [motion!.id],
        }),
      );
      expect(
        collectLiveNationalObservation(game, outsider.id).observation
          .peaceNegotiations,
      ).toBeUndefined();

      const { restored, bytes, again } = await roundTrip(game, "plains");
      expect(again).toEqual(bytes);
      const replay = runner(restored);
      const command = {
        type: "national_accept_peace",
        motionId: motion!.id,
        requestId: "e5-accept",
      };
      advance(command);
      replay(command);
      advance();
      replay();
      expect(layer(game, WAR).endedTick).not.toBeNull();
      expect(
        game.nationalWarState()?.wars.motions.find((m) => m.id === motion!.id)
          ?.acceptedBy,
      ).toBe(human.id);
      expect(game.nationalWarAuthority()?.atWar(bot.id, human.id)).toBe(layered);
      if (layered) expect(layer(game, IMPERIAL).endedTick).toBeNull();
      const land = game.player(bot.id).numTilesOwned();
      for (let i = 0; i < 5; i++) {
        advance();
        replay();
        expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
      }
      if (!layered) {
        expect(b.outgoingAttacks()).toHaveLength(0);
        expect(game.player(bot.id).numTilesOwned()).toBe(land);
        expect(game.player(bot.id).outgoingAttacks()).toHaveLength(0);
      } else {
        expect(
          game.nationalWarAuthority()?.authorizeOffensiveAction(human.id, bot.id),
        ).toBe(true);
        expect(b.outgoingAttacks().length).toBeGreaterThan(0);
      }
      console.log(MATCH, {
        layered,
        war: layer(game, WAR),
        troops: b.troops(),
        outgoing: b.outgoingAttacks().length,
        land: game.player(bot.id).numTilesOwned(),
        snapshotBytes: bytes.length,
        snapshotSha256: createHash("sha256").update(bytes).digest("hex"),
      });
    },
  );

  it("AI accepts an actual incoming sovereign proposal, not a fabricated motion", async () => {
    const game = await fixture(false, true);
    const advance = runner(game);
    for (let i = 0; i < 15 && layer(game, WAR).endedTick === null; i++)
      advance();
    expect(layer(game, WAR).endedTick).not.toBeNull();
    expect(game.nationalWarState()?.wars.motions).toContainEqual(
      expect.objectContaining({
        proposedBy: human.id,
        acceptedBy: bot.id,
        layerId: WAR,
      }),
    );
    expect(game.nationalWarAuthority()?.atWar(bot.id, human.id)).toBe(false);
  });

  it("rejects forged and outsider acceptance and does not expose private motions", async () => {
    const game = await fixture();
    const advance = runner(game);
    for (let i = 0; i < 15 && !aiMotion(game); i++) advance();
    const motion = aiMotion(game)!;
    expect(motion).toBeDefined();
    const out = runner(game, outsider.clientID!);
    out({
      type: "national_accept_peace",
      motionId: motion.id,
      requestId: "e5-outsider",
    });
    out();
    advance({
      type: "national_accept_peace",
      motionId: "forged-motion",
      requestId: "e5-forged",
    });
    advance();
    expect(layer(game, WAR).endedTick).toBeNull();
    expect(
      game.nationalWarCommandResults(game.player(outsider.id)),
    ).toContainEqual(
      expect.objectContaining({ accepted: false, requestId: "e5-outsider" }),
    );
    const view = collectLiveNationalObservation(game, bot.id).observation;
    const first = planNationalPeace(view, null);
    expect(first.choice).toBeNull(); // own proposal cannot be accepted
    expect(() =>
      planNationalPeace({ ...view, observerId: outsider.id }, first.memory),
    ).toThrow();
    advance({
      type: "national_accept_peace",
      motionId: motion.id,
      requestId: "e5-valid",
    });
    advance();
    const ended = layer(game, WAR).endedTick;
    expect(ended).not.toBeNull();
    advance({
      type: "national_accept_peace",
      motionId: motion.id,
      requestId: "e5-duplicate",
    });
    advance();
    expect(layer(game, WAR).endedTick).toBe(ended);
    expect(
      game.nationalWarCommandResults(game.player(human.id)),
    ).toContainEqual(
      expect.objectContaining({ accepted: false, requestId: "e5-duplicate" }),
    );
  });

  it("current crown and national delegation control private capabilities", async () => {
    const game = await fixture(true);
    const a = game.player(human.id);
    const b = game.player(outsider.id);
    game.performNationalCommand(a, {
      kind: "offer-empire",
      empireId: "e5-empire",
      candidateId: outsider.id,
    });
    game.performNationalCommand(b, {
      kind: "accept-empire",
      empireId: "e5-empire",
      candidateId: outsider.id,
    });
    game.performNationalWarCommand(game.player(bot.id), {
      kind: "propose-peace",
      motionId: "e5-crown-motion",
      warId: IMPERIAL,
    });
    const observe = (id: string) =>
      collectLiveNationalObservation(game, id).observation.peaceNegotiations ??
      [];
    expect(observe(human.id)).toContainEqual(
      expect.objectContaining({
        warId: IMPERIAL,
        incomingMotionIds: ["e5-crown-motion"],
      }),
    );
    expect(observe(outsider.id)).toEqual([]);
    const denied = game.performNationalWarCommandWithOutcome(b, {
      kind: "accept-peace",
      motionId: "e5-crown-motion",
    });
    expect(denied.accepted).toBe(false);
    game.performNationalCommand(a, {
      kind: "transfer-crown",
      empireId: "e5-empire",
      successorId: outsider.id,
    });
    expect(observe(human.id)).toEqual([]);
    expect(observe(outsider.id)).toContainEqual(
      expect.objectContaining({
        warId: IMPERIAL,
        incomingMotionIds: ["e5-crown-motion"],
      }),
    );
    expect(
      game.performNationalWarCommandWithOutcome(a, {
        kind: "accept-peace",
        motionId: "e5-crown-motion",
      }).accepted,
    ).toBe(false);
    expect(layer(game, IMPERIAL).endedTick).toBeNull();
    expect(layer(game, WAR).endedTick).toBeNull();
  });

  it("no foreign balance or controller identity changes the peace decision", async () => {
    const game = await fixture();
    const before = collectLiveNationalObservation(game, bot.id).observation;
    const foe = game.player(human.id);
    foe.setTroops(9_000_000);
    const after = collectLiveNationalObservation(game, bot.id).observation;
    expect(after).toEqual(before);
    expect(planNationalPeace(after, null)).toEqual(planNationalPeace(before, null));
    // Controller identity is intentionally not part of the observation DTO.
    expect(after.nations.every((n) => !("controllerKind" in n))).toBe(true);
  });
});
