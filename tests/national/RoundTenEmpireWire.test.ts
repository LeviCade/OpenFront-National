/**
 * E2 / E1 contract: real human clicks use stamped client identity, the
 * existing snapshot-safe execution and E1's authoritative political journal.
 * No UI claim or second empire registry may authorize a crown transition.
 */
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const players = [
  new PlayerInfo("King", PlayerType.Human, "R10CLNA1", "R10KING1"),
  new PlayerInfo("Ally", PlayerType.Human, "R10CLNB1", "R10ALLY1"),
  new PlayerInfo("Other", PlayerType.Human, "R10CLNC1", "R10OTHER"),
];
const [A, B, C] = players.map((p) => p.id);
const [clientA, clientB, clientC] = players.map((p) => p.clientID!);
const empireId = "r10_union";

async function gameWithHumans(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, players);
  for (let i = 0; i < players.length; i++) {
    game.addExecution(
      new SpawnExecution(
        "r10-empire-wire",
        players[i],
        game.ref(20 + 30 * i, 20 + 30 * i),
      ),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  for (const p of players)
    expect(game.player(p.id).hasSpawned()).toBe(true);
  return game;
}

function source(game: Game, clientID: string) {
  const errors: string[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, "r10-empire-wire", undefined),
    (packet) => {
      if ("errMsg" in packet) errors.push(String(packet.errMsg));
    },
    clientID,
  );
  return { runner, errors };
}

function play(
  game: Game,
  runner: GameRunner,
  command?: Record<string, unknown>,
): void {
  runner.addTurn({
    turnNumber: game.ticks(),
    intents: command === undefined ? [] : [StampedIntentSchema.parse(command)],
  });
  expect(runner.executeNextTick()).toBe(true);
}
function command(
  type: string,
  requestId: string,
  clientID: string,
  targetId?: string,
) {
  return {
    type,
    empireId,
    ...(type === "national_offer_empire" ||
    type === "national_accept_empire"
      ? { candidateId: targetId ?? B }
      : type === "national_transfer_crown"
        ? { successorId: targetId ?? B }
        : {}),
    requestId,
    clientID,
  };
}

describe("R10 E2 authenticated empire/crown wire bridge", () => {
  it("rejects malformed identifiers and never accepts client-declared authority", () => {
    for (const [type, key] of [
      ["national_offer_empire", "candidateId"],
      ["national_accept_empire", "candidateId"],
      ["national_transfer_crown", "successorId"],
    ]) {
      const correct = command(type, "r10-opaque-1", clientA);
      expect(StampedIntentSchema.parse(correct)).toMatchObject(correct);
      expect(
        StampedIntentSchema.safeParse({
          ...correct,
          [key]: "forged-invalid-player",
        }).success,
      ).toBe(false);
      expect(
        StampedIntentSchema.safeParse({
          ...correct,
          requestId: "x".repeat(129),
        }).success,
      ).toBe(false);
      expect(
        StampedIntentSchema.safeParse({
          ...correct,
          empireId: "invalid empire",
        }).success,
      ).toBe(false);
      expect(
        StampedIntentSchema.safeParse({
          ...correct,
          clientID: "NOT_VALID_CLIENT",
        }).success,
      ).toBe(false);
      expect(
        StampedIntentSchema.parse({ ...correct, actorId: C }),
      ).not.toHaveProperty("actorId");
    }
  });

  it("GameRunner really founds, offers, accepts and transfers the crown with actor-only receipts and replay", async () => {
    const game = await gameWithHumans();
    const alpha = source(game, clientA);
    const bravo = source(game, clientB);
    const charlie = source(game, clientC);
    const send = (
      actor: ReturnType<typeof source>,
      payload: Record<string, unknown>,
    ) => {
      play(game, actor.runner, payload);
      play(game, actor.runner);
    };

    // Actual founder click, then a failed foreign transfer.
    send(alpha, {
      type: "national_found_empire",
      empireId,
      requestId: "r10-found",
      clientID: clientA,
    });
    expect(game.nationalPoliticalAuthority()?.emperorOf(empireId)).toBe(A);
    send(charlie, command("national_transfer_crown", "r10-forged", clientC));
    expect(
      game.nationalPoliticalCommandResults(game.player(C))
        .find((r) => r.requestId === "r10-forged")?.accepted,
    ).toBe(false);
    expect(game.nationalPoliticalAuthority()?.emperorOf(empireId)).toBe(A);

    send(alpha, command("national_offer_empire", "r10-offer", clientA));
    expect(
      game.nationalPoliticalCommandResults(game.player(A))
        .find((r) => r.requestId === "r10-offer")?.accepted,
    ).toBe(true);
    send(bravo, command("national_accept_empire", "r10-join", clientB));
    expect(
      game.nationalPoliticalCommandResults(game.player(B))
        .find((r) => r.requestId === "r10-join")?.accepted,
    ).toBe(true);
    expect(game.nationalPoliticalAuthority()?.empireOf(B)).toBe(empireId);

    send(alpha, command("national_transfer_crown", "r10-crown", clientA));
    expect(
      game.nationalPoliticalCommandResults(game.player(A))
        .find((r) => r.requestId === "r10-crown")?.accepted,
    ).toBe(true);
    expect(game.nationalPoliticalAuthority()?.emperorOf(empireId)).toBe(B);
    expect(
      game.nationalPoliticalCommandResults(game.player(C))
        .some((r) => r.accepted),
    ).toBe(false);

    const before = game.nationalPoliticalCommandResults(game.player(A));
    send(alpha, command("national_transfer_crown", "r10-crown", clientA));
    expect(game.nationalPoliticalCommandResults(game.player(A))).toEqual(
      before,
    );
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalPoliticalAuthority()?.emperorOf(empireId)).toBe(B);
    expect(
      restored.nationalPoliticalCommandResults(restored.player(A)),
    ).toEqual(before);
    expect(alpha.errors).toEqual([]);
    expect(bravo.errors).toEqual([]);
    expect(charlie.errors).toEqual([]);
  });
});
