/**
 * E2 authenticated wire-to-execution request correlation. The original
 * clientID-to-Player binding remains the only actor authorization boundary.
 * E1 owns the eventual journal/sequence; no client result is fabricated.
 */
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { NationalFoundEmpireIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const ALICE_CLIENT_ID = "round6-alice-client";
const BOB_CLIENT_ID = "round6-bob-client";
const alice = new PlayerInfo(
  "Alice",
  PlayerType.Human,
  ALICE_CLIENT_ID,
  "round6-alice",
);
const bob = new PlayerInfo(
  "Bob",
  PlayerType.Human,
  BOB_CLIENT_ID,
  "round6-bob",
);

async function spawned(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, [alice, bob]);
  game.addExecution(
    new SpawnExecution("round6-request", alice, game.map().ref(20, 20)),
  );
  game.addExecution(
    new SpawnExecution("round6-request", bob, game.map().ref(70, 70)),
  );
  game.executeNextTick();
  game.executeNextTick();
  expect(game.player(alice.id).hasSpawned()).toBe(true);
  expect(game.player(bob.id).hasSpawned()).toBe(true);
  return game;
}

describe("Round Six authenticated Found Empire request IDs", () => {
  it("accepts legacy absent ID and bounded opaque IDs but rejects malformed tokens on the wire", () => {
    expect(
      NationalFoundEmpireIntentSchema.parse({
        type: "national_found_empire",
        empireId: "empire-a",
      }).requestId,
    ).toBeUndefined();
    for (const id of ["A", "abc_123-xyz", "x".repeat(128)]) {
      expect(
        NationalFoundEmpireIntentSchema.parse({
          type: "national_found_empire",
          empireId: "empire-a",
          requestId: id,
        }).requestId,
      ).toBe(id);
    }
    for (const id of [
      "",
      "x".repeat(129),
      "bad token",
      "line\\nbreak",
      "emoji-🔥",
      "angle<bad>",
      "a/b",
    ]) {
      expect(
        NationalFoundEmpireIntentSchema.safeParse({
          type: "national_found_empire",
          empireId: "empire-a",
          requestId: id,
        }).success,
      ).toBe(false);
    }
    for (const id of [null, 23, {}, []]) {
      expect(
        NationalFoundEmpireIntentSchema.safeParse({
          type: "national_found_empire",
          empireId: "empire-a",
          requestId: id,
        }).success,
      ).toBe(false);
    }
  });

  it("executes an old authenticated founding intent without a request ID", async () => {
    const game = await spawned();
    const executor = new Executor(game, "round6-request", undefined);
    game.addExecution(
      executor.createExec({
        type: "national_found_empire",
        empireId: "legacy-empire",
        clientID: ALICE_CLIENT_ID,
      }),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(game.nationalCommandResults(game.player(alice.id))).toMatchObject([
      {
        actorId: alice.id,
        empireId: "legacy-empire",
        requestId: expect.stringMatching(/^auto:\d+:0$/),
        accepted: true,
      },
    ]);
    expect(game.nationalCommandResults(game.player(bob.id))).toEqual([]);
  });

  it("routes same-tick unique IDs to E1 outcomes with increasing sequences and actor-only receipt privacy", async () => {
    const game = await spawned();
    const executor = new Executor(game, "round6-request", undefined);
    game.addExecution(
      executor.createExec({
        type: "national_found_empire",
        empireId: "first-empire",
        requestId: "click-A-1",
        clientID: ALICE_CLIENT_ID,
      }),
    );
    game.addExecution(
      executor.createExec({
        type: "national_found_empire",
        empireId: "second-empire",
        requestId: "click-A-2",
        clientID: ALICE_CLIENT_ID,
      }),
    );
    game.executeNextTick();
    game.executeNextTick();
    const aliceJournal = game.nationalCommandResults(game.player(alice.id));
    expect(aliceJournal).toHaveLength(2);
    expect(aliceJournal[0]).toMatchObject({
      requestId: "click-A-1",
      actorId: alice.id,
      empireId: "first-empire",
      accepted: true,
    });
    expect(aliceJournal[1]).toMatchObject({
      requestId: "click-A-2",
      actorId: alice.id,
      empireId: "second-empire",
      accepted: false,
    });
    expect(aliceJournal[1].sequence).toBeGreaterThan(aliceJournal[0].sequence);
    expect(game.nationalCommandResults(game.player(bob.id))).toEqual([]);
    expect(game.nationalPublicPoliticalView()?.empires).toEqual([
      { id: "first-empire", leaderId: alice.id, memberIds: [alice.id] },
    ]);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalCommandResults(restored.player(alice.id))).toEqual(
      aliceJournal,
    );
    expect(restored.nationalCommandResults(restored.player(bob.id))).toEqual(
      [],
    );
  });

  it("rejects forged client routing, de-duplicates matching requests and cannot borrow another actor's ID", async () => {
    const game = await spawned();
    const executor = new Executor(game, "round6-request", undefined);
    const intent = {
      type: "national_found_empire" as const,
      empireId: "one-empire",
      requestId: "click-A-duplicate",
      clientID: ALICE_CLIENT_ID,
    };
    game.addExecution(executor.createExec(intent));
    game.addExecution(executor.createExec(intent));
    game.addExecution(
      executor.createExec({
        ...intent,
        empireId: "forged-empire",
        clientID: "unregistered-client",
        requestId: "forged-client",
      }),
    );
    game.executeNextTick();
    game.executeNextTick();
    const original = game.nationalCommandResults(game.player(alice.id));
    expect(original).toHaveLength(1);
    expect(original[0]).toMatchObject({
      requestId: intent.requestId,
      actorId: alice.id,
      accepted: true,
    });
    expect(game.nationalCommandResults(game.player(bob.id))).toEqual([]);
    game.addExecution(
      executor.createExec({
        type: "national_found_empire",
        empireId: "bob-empire",
        requestId: "click-B-own",
        clientID: BOB_CLIENT_ID,
      }),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(game.nationalCommandResults(game.player(bob.id))).toMatchObject([
      { actorId: bob.id, empireId: "bob-empire", requestId: "click-B-own" },
    ]);
    expect(game.nationalCommandResults(game.player(alice.id))).toEqual(
      original,
    );
  });
});
