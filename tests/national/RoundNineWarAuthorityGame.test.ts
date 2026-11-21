import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { NationalGovernanceState } from "@openfront/engine/national/politics/NationalGovernanceState";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import {
  executeTrustedNationalWarCommand,
  readTrustedNationalWarOutcomes,
} from "../../src/server/national/TrustedNationalSaveStore";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const players = [
  new PlayerInfo("R9 North", PlayerType.Human, "r9-client-a", "r9-a"),
  new PlayerInfo("R9 South", PlayerType.Human, "r9-client-b", "r9-b"),
  new PlayerInfo("R9 East", PlayerType.Human, "r9-client-c", "r9-c"),
  new PlayerInfo("R9 West", PlayerType.Human, "r9-client-d", "r9-d"),
];
const [A, B, C, D] = players.map((p) => p.id);
const locations = [
  [25, 25],
  [70, 70],
  [25, 70],
  [70, 25],
] as const;

async function spawned(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, players);
  for (let i = 0; i < players.length; i++) {
    const [x, y] = locations[i];
    game.addExecution(
      new SpawnExecution("r9-actual-game", players[i], game.map().ref(x, y)),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  for (const info of players)
    expect(game.player(info.id).hasSpawned()).toBe(true);
  return game;
}

describe("Round Nine authenticated Game-owned WAR/peace command outcomes", () => {
  it("records accepted/rejected WAR, prevents duplicate/forged work, and restores exact legal peace", async () => {
    const game = await spawned();
    expect(game.nationalWarAuthority()?.authorizeOffensiveAction(A, B)).toBe(
      false,
    );
    const war = game.performNationalWarCommandWithOutcome(game.player(A), {
      kind: "declare-national",
      warId: "r9-war-1",
      aggressorId: A,
      targetId: B,
      requestId: "r9-war-request",
    });
    expect(war).toMatchObject({
      sequence: 0,
      requestId: "r9-war-request",
      actorId: A,
      recipientId: A,
      commandKind: "national_declare_war",
      commandTargetId: B,
      accepted: true,
      reason: "accepted",
      warId: "r9-war-1",
    });
    expect(game.nationalWarAuthority()?.authorizeOffensiveAction(A, B)).toBe(
      true,
    );
    const rejected = game.performNationalWarCommandWithOutcome(game.player(C), {
      kind: "declare-national",
      warId: "r9-illegal-war",
      aggressorId: A,
      targetId: D,
      requestId: "r9-rejected-war",
    });
    expect(rejected).toMatchObject({
      sequence: 1,
      actorId: C,
      recipientId: C,
      accepted: false,
      reason: "war-rule",
    });
    expect(game.nationalWarState()?.wars.layers).toHaveLength(1);
    expect(game.nationalWarCommandResults(game.player(A))).toEqual([war]);
    expect(game.nationalWarCommandResults(game.player(C))).toEqual([rejected]);
    expect(game.nationalWarCommandResults(game.player(B))).toEqual([]);
    expect(game.nationalPoliticalCommandResults(game.player(A))).toEqual([]);
    const forged = new Proxy(game.player(A), {});
    expect(() =>
      game.performNationalWarCommandWithOutcome(forged, {
        kind: "declare-national",
        warId: "r9-forged",
        aggressorId: A,
        targetId: D,
        requestId: "r9-forged-request",
      }),
    ).toThrow(/forged actor/);
    expect(game.nationalWarState()?.wars.layers).toHaveLength(1);

    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    for (const g of [game, restored]) {
      // E2 assigns a new engine-generated war ID on a later retry; the
      // original client request must return its existing authoritative ID.
      expect(
        g.performNationalWarCommandWithOutcome(g.player(A), {
          kind: "declare-national",
          warId: "r9-new-engine-generated-id",
          aggressorId: A,
          targetId: B,
          requestId: "r9-war-request",
        }),
      ).toEqual(war);
      expect(g.nationalWarState()?.wars.layers).toHaveLength(1);
      expect(() =>
        g.performNationalWarCommandWithOutcome(g.player(C), {
          kind: "declare-national",
          warId: "r9-collision",
          aggressorId: C,
          targetId: B,
          requestId: "r9-war-request",
        }),
      ).toThrow(/reused foreign request ID/);
      expect(() =>
        g.performNationalWarCommandWithOutcome(g.player(A), {
          kind: "declare-national",
          warId: "r9-collision",
          aggressorId: A,
          targetId: D,
          requestId: "r9-war-request",
        }),
      ).toThrow(/reused foreign request ID/);
      const proposal = g.performNationalWarCommandWithOutcome(g.player(A), {
        kind: "propose-peace",
        motionId: "r9-peace-1",
        warId: "r9-war-1",
        requestId: "r9-peace-request",
      });
      expect(proposal).toMatchObject({
        sequence: 2,
        commandKind: "national_propose_peace",
        actorId: A,
        recipientId: A,
        accepted: true,
        warId: "r9-war-1",
        motionId: "r9-peace-1",
      });
      expect(
        g.performNationalWarCommandWithOutcome(g.player(A), {
          kind: "propose-peace",
          motionId: "r9-new-engine-generated-motion",
          warId: "r9-war-1",
          requestId: "r9-peace-request",
        }),
      ).toEqual(proposal);
      expect(g.nationalWarState()?.wars.motions).toHaveLength(1);
      const denied = g.performNationalWarCommandWithOutcome(g.player(A), {
        kind: "accept-peace",
        motionId: "r9-peace-1",
        requestId: "r9-wrong-side",
      });
      expect(denied).toMatchObject({
        sequence: 3,
        accepted: false,
        reason: "war-rule",
      });
      const settlement = g.performNationalWarCommandWithOutcome(g.player(B), {
        kind: "accept-peace",
        motionId: "r9-peace-1",
        requestId: "r9-peace-accepted",
      });
      expect(settlement).toMatchObject({
        sequence: 4,
        commandKind: "national_accept_peace",
        actorId: B,
        recipientId: B,
        accepted: true,
        warId: "r9-war-1",
        motionId: "r9-peace-1",
      });
      expect(g.nationalWarAuthority()?.authorizeOffensiveAction(A, B)).toBe(
        false,
      );
      expect(g.nationalWarState()?.wars.layers[0].endedTick).not.toBeNull();
      expect(g.nationalWarCommandResults(g.player(B))).toEqual([settlement]);
      expect(g.nationalWarCommandResults(g.player(C))).toEqual([rejected]);
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });

  it("a real crown transfer changes who may declare imperial war, not just a political label", async () => {
    const game = await spawned();
    game.performNationalCommand(game.player(A), {
      kind: "found-empire",
      empireId: "r9-empire",
    });
    game.performNationalCommand(game.player(A), {
      kind: "offer-empire",
      empireId: "r9-empire",
      candidateId: B,
    });
    game.performNationalCommand(game.player(B), {
      kind: "accept-empire",
      empireId: "r9-empire",
      candidateId: B,
    });
    const attempted = game.performNationalWarCommandWithOutcome(
      game.player(B),
      {
        kind: "declare-imperial",
        warId: "r9-before-crown",
        aggressor: { kind: "empire", id: "r9-empire" },
        target: { kind: "nation", id: C },
        requestId: "r9-before-transfer",
      },
    );
    expect(attempted.accepted).toBe(false);
    expect(game.nationalWarAuthority()?.authorizeOffensiveAction(B, C)).toBe(
      false,
    );
    game.performNationalCommand(game.player(A), {
      kind: "transfer-crown",
      empireId: "r9-empire",
      successorId: B,
    });
    expect(game.nationalPoliticalAuthority()?.emperorOf("r9-empire")).toBe(B);
    const { restored } = await roundTrip(game, "plains");
    for (const g of [game, restored]) {
      const accepted = g.performNationalWarCommandWithOutcome(g.player(B), {
        kind: "declare-imperial",
        warId: "r9-crowned-war",
        aggressor: { kind: "empire", id: "r9-empire" },
        target: { kind: "nation", id: C },
        requestId: "r9-after-transfer",
      });
      expect(accepted).toMatchObject({
        accepted: true,
        actorId: B,
        commandKind: "national_declare_war",
        warId: "r9-crowned-war",
      });
      expect(g.nationalWarAuthority()?.authorizeOffensiveAction(B, C)).toBe(
        true,
      );
      expect(g.nationalWarAuthority()?.authorizeOffensiveAction(A, C)).toBe(
        true,
      );
      const formerCrown = g.performNationalWarCommandWithOutcome(g.player(A), {
        kind: "declare-imperial",
        warId: "r9-former-crown",
        aggressor: { kind: "empire", id: "r9-empire" },
        target: { kind: "nation", id: D },
        requestId: "r9-former-crown-denied",
      });
      expect(formerCrown.accepted).toBe(false);
      expect(g.nationalWarState()?.wars.layers).toHaveLength(1);
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });
  it("requires a real server session and roster for host execution and recipient reads", async () => {
    const game = await spawned();
    const resolver = (session: unknown, gameID: string) => {
      if (gameID !== "r9-host") return null;
      if (session === "alice")
        return { accountId: "account-a", playerId: A, clientID: "r9-client-a" };
      if (session === "bob")
        return { accountId: "account-b", playerId: B, clientID: "r9-client-b" };
      if (session === "forged")
        return { accountId: "account-a", playerId: B, clientID: "r9-client-a" };
      return null;
    };
    const command = {
      kind: "declare-national" as const,
      warId: "r9-host-war",
      aggressorId: A,
      targetId: B,
      requestId: "r9-host-request",
    };
    expect(() =>
      executeTrustedNationalWarCommand(
        game,
        "r9-host",
        "forged",
        resolver,
        command,
      ),
    ).toThrow(/roster mismatch/);
    expect(game.nationalWarState()?.wars.layers).toHaveLength(0);
    const accepted = executeTrustedNationalWarCommand(
      game,
      "r9-host",
      "alice",
      resolver,
      command,
    );
    expect(accepted.accepted).toBe(true);
    expect(
      readTrustedNationalWarOutcomes(game, "r9-host", "alice", resolver),
    ).toEqual([accepted]);
    expect(
      readTrustedNationalWarOutcomes(game, "r9-host", "bob", resolver),
    ).toEqual([]);
    expect(() =>
      readTrustedNationalWarOutcomes(game, "r9-host", "forged", resolver),
    ).toThrow(/roster mismatch/);
  });

  it("keeps old request collisions rejected after 1,024 newer journal records and snapshot restore", () => {
    const journal = new NationalGovernanceState();
    for (let i = 0; i < 1_100; i++) {
      const result = journal.recordWarCommand(
        A,
        "national_declare_war",
        B,
        5,
        `r9-aging-${i}`,
        `intent:${i}`,
        { warId: `r9-aging-war-${i}` },
        () => "war-rule",
      );
      expect(result.accepted).toBe(false);
    }
    const saved = journal.snapshot();
    expect(saved.receipts).toHaveLength(1_100);
    expect(saved.results).toHaveLength(128);

    const restored = new NationalGovernanceState();
    restored.restore(saved, 5);
    const before = restored.snapshot();
    const replay = restored.recordWarCommand(
      A,
      "national_declare_war",
      B,
      10,
      "r9-aging-0",
      "intent:0",
      { warId: "new-generated-war-id" },
      () => {
        throw new Error("Replay must never execute a second WAR");
      },
    );
    expect(replay).toMatchObject({
      requestId: "r9-aging-0",
      sequence: 0,
      tick: 5,
      accepted: false,
      reason: "war-rule",
    });
    expect(restored.snapshot()).toEqual(before);
    expect(() =>
      restored.recordWarCommand(
        A,
        "national_declare_war",
        B,
        10,
        "r9-aging-0",
        "changed-intent",
        { warId: "different" },
        () => "accepted",
      ),
    ).toThrow(/reused foreign request ID/);
    expect(restored.snapshot()).toEqual(before);
  });
});
