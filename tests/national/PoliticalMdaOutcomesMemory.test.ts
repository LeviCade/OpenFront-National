import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { NationalFoundEmpireExecution } from "@openfront/engine/execution/NationalFoundEmpireExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameSnapshot } from "@openfront/engine/game/GameImpl";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const humans = [
  new PlayerInfo("Alpha", PlayerType.Human, "r5-alpha-client", "r5-alpha"),
  new PlayerInfo("Beta", PlayerType.Human, "r5-beta-client", "r5-beta"),
  new PlayerInfo("Gamma", PlayerType.Human, "r5-gamma-client", "r5-gamma"),
  new PlayerInfo("Delta", PlayerType.Human, "r5-delta-client", "r5-delta"),
];
const A = "r5-alpha",
  B = "r5-beta",
  C = "r5-gamma",
  D = "r5-delta";

async function gameWithPlayers(count = 4, nationalMode = true): Promise<Game> {
  const game = await setup("plains", { nationalMode }, humans.slice(0, count));
  const tiles = [
    game.map().ref(30, 30),
    game.map().ref(70, 70),
    game.map().ref(30, 70),
    game.map().ref(70, 30),
  ];
  for (let i = 0; i < count; i++)
    game.addExecution(new SpawnExecution("r5-political", humans[i], tiles[i]));
  game.executeNextTick();
  game.executeNextTick();
  for (let i = 0; i < count; i++)
    expect(game.player(humans[i].id).hasSpawned()).toBe(true);
  return game;
}

function treaty(
  game: Game,
  pactId: string,
  founder: string,
  ids: string[],
  expulsion: "leader" | "forbidden" = "leader",
): void {
  game.performNationalCommand(game.player(founder), {
    kind: "found-pact",
    pactId,
    name: pactId,
    pactKind: "MDA",
    terms: { admission: "leader", expulsion },
  });
  for (const id of ids) {
    game.performNationalCommand(game.player(founder), {
      kind: "invite-pact",
      pactId,
      candidateId: id,
    });
    game.performNationalCommand(game.player(id), {
      kind: "accept-pact",
      pactId,
    });
  }
}

function eliminate(game: Game, id: string): void {
  for (const tile of [...game.player(id).tiles()])
    game.player(id).relinquish(tile);
  game.executeNextTick();
}

function joinEmpire(
  game: Game,
  founder: string,
  candidate: string,
  empireId: string,
): void {
  game.performNationalCommand(game.player(founder), {
    kind: "found-empire",
    empireId,
  });
  game.performNationalCommand(game.player(founder), {
    kind: "offer-empire",
    empireId,
    candidateId: candidate,
  });
  game.performNationalCommand(game.player(candidate), {
    kind: "accept-empire",
    empireId,
    candidateId: candidate,
  });
}

function memory(observerId: string, tick: number, sourceNationId?: string) {
  return {
    observerId,
    assets: [
      {
        id: "observed-hostile-unit",
        ownerId: C,
        kind: "army" as const,
        x: 27,
        y: 31,
        lastSeenTick: tick,
        ...(sourceNationId === undefined ? {} : { sourceNationId }),
      },
    ],
  };
}

describe("R5 canonical live MDA contributor enumeration (COAL-05/06, LEVY-01/07)", () => {
  it("overlapping MDA treaties yield each real donor exactly once, sorted and snapshotted", async () => {
    const game = await gameWithPlayers();
    treaty(game, "pact-1", A, [C, B]);
    treaty(game, "pact-2", A, [D, C]);
    expect(game.nationalMdaAllies(A)).toEqual([B, D, C]);
    expect(game.nationalMdaAllies("forged")).toEqual([]);
    expect(game.nationalMdaAllies(B)).toEqual([A, C]);
    expect(game.nationalMdaAllies(C)).toEqual([A, B, D]);
    expect(game.nationalMdaAllies(D)).toEqual([A, C]);
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalMdaAllies(A)).toEqual([B, D, C]);
    expect(restored.nationalMdaAllies(C)).toEqual([A, B, D]);
    expect(snapshotGameData(restored).game).toEqual(
      snapshotGameData(game).game,
    );
  });

  it("Betray and leader constitutional expulsion alter only current treaty eligibility", async () => {
    const game = await gameWithPlayers();
    treaty(game, "pact-1", A, [B, C]);
    treaty(game, "pact-2", A, [C, D]);
    expect(() =>
      game.performNationalCommand(game.player(D), {
        kind: "expel-pact",
        pactId: "pact-1",
        memberId: B,
      }),
    ).toThrow();
    expect(game.nationalMdaAllies(A)).toEqual([B, D, C]);
    game.performNationalCommand(game.player(C), {
      kind: "betray-pact",
      pactId: "pact-1",
    });
    expect(game.nationalMdaAllies(A)).toEqual([B, D, C]);
    game.performNationalCommand(game.player(C), {
      kind: "betray-pact",
      pactId: "pact-2",
    });
    expect(game.nationalMdaAllies(A)).toEqual([B, D]);
    game.performNationalCommand(game.player(A), {
      kind: "expel-pact",
      pactId: "pact-1",
      memberId: B,
    });
    expect(game.nationalMdaAllies(A)).toEqual([D]);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalMdaAllies(A)).toEqual([D]);
    eliminate(game, D);
    eliminate(restored, D);
    expect(game.nationalMdaAllies(A)).toEqual([]);
    expect(restored.nationalMdaAllies(A)).toEqual([]);
    expect(game.nationalMdaAllies(D)).toEqual([]);
  });

  it("consented accession removes invalid outside MDA membership, never grants empire-only donor rights", async () => {
    const game = await gameWithPlayers();
    treaty(game, "pact-1", A, [B, C]);
    expect(game.nationalMdaAllies(A)).toEqual([B, C]);
    joinEmpire(game, D, C, "r5-empire");
    expect(game.nationalPoliticalAuthority()?.empireOf(C)).toBe("r5-empire");
    expect(game.nationalMdaAllies(A)).toEqual([B]);
    expect(game.nationalMdaAllies(D)).toEqual([]);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalMdaAllies(A)).toEqual([B]);
  });

  it("LEVY-07: accepted attack cannot silently omit an active MDA contributor", async () => {
    const game = await gameWithPlayers();
    treaty(game, "levy-defenders", A, [B, C]);
    game.player(B).setTroops(500_000);
    game.player(C).setTroops(500_000);
    game.performNationalWarCommand(game.player(D), {
      kind: "declare-national",
      warId: "r5-defense-war",
      aggressorId: D,
      targetId: A,
    });
    const request = (
      eligible: {
        source: NonNullable<ReturnType<Game["nationalLevySource"]>>;
        troopCapacity: number;
        maximumFraction: number;
        protectedCapacityFraction: number;
      }[],
    ) => ({
      attackId: "r5-accepted-attack",
      confirmedAccepted: true as const,
      campaignId: "r5-campaign",
      attackerId: D,
      defenderId: A,
      attackingTroops: 1_000,
      eligible,
    });
    const beforeB = game.player(B).troops();
    const beforeC = game.player(C).troops();
    const beforeD = game.player(D).troops();
    expect(() => game.applyNationalDefenseLevy([request([])])).toThrow(
      /missing or forged MDA contributor roster/,
    );
    expect(game.player(B).troops()).toBe(beforeB);
    expect(game.player(C).troops()).toBe(beforeC);
    expect(game.nationalWarState()?.levy.processed).toEqual([]);
    // An attacker cannot duplicate a legitimate donor or substitute a real
    // nonmember source; neither malformed roster may partially charge B.
    const sourceB = game.nationalLevySource(B)!;
    const sourceD = game.nationalLevySource(D)!;
    const entry = (source: typeof sourceB) => ({
      source,
      troopCapacity: 500_000,
      maximumFraction: 0.1,
      protectedCapacityFraction: 0.3,
    });
    expect(() =>
      game.applyNationalDefenseLevy([request([entry(sourceB), entry(sourceB)])]),
    ).toThrow(/missing or forged MDA contributor roster/);
    expect(() =>
      game.applyNationalDefenseLevy([request([entry(sourceB), entry(sourceD)])]),
    ).toThrow(/missing or forged MDA contributor roster/);
    expect(game.player(B).troops()).toBe(beforeB);
    expect(game.player(C).troops()).toBe(beforeC);
    expect(game.player(D).troops()).toBe(beforeD);
    expect(game.nationalWarState()?.levy.processed).toEqual([]);
    const eligible = game.nationalMdaAllies(A).map((id) => ({
      source: game.nationalLevySource(id)!,
      troopCapacity: Math.floor(game.config().maxTroops(game.player(id))),
      maximumFraction: 0.1,
      protectedCapacityFraction: 0.3,
    }));
    expect(eligible.map((e) => e.source.nationId)).toEqual([B, C]);
    const [funded] = game.applyNationalDefenseLevy([request(eligible)]);
    expect(funded.application).toBe("applied");
    expect(funded.intercepted).toBe(1_000);
    expect(
      beforeB + beforeC - game.player(B).troops() - game.player(C).troops(),
    ).toBe(1_000);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    expect(restored.player(B).troops()).toBe(game.player(B).troops());
    expect(restored.player(C).troops()).toBe(game.player(C).troops());
  });

  it("unspawned and legacy defenders fail closed; no client-chosen eligibility", async () => {
    const waiting = await setup(
      "plains",
      { nationalMode: true },
      humans.slice(0, 2),
    );
    expect(waiting.nationalMdaAllies(A)).toEqual([]);
    const legacy = await gameWithPlayers(2, false);
    expect(legacy.nationalMdaAllies(A)).toEqual([]);
    expect(legacy.nationalMdaAllies("forged")).toEqual([]);
  });
});

describe("R5 real Found Empire outcome journal, principal scope and replay", () => {
  it("registered queued execution emits accepted then sanitized rejection, visible only to actor", async () => {
    const game = await gameWithPlayers(3);
    game.addExecution(
      new NationalFoundEmpireExecution(
        game.player(A),
        "first-empire",
        null,
        "request-A-1",
      ),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(game.nationalPoliticalAuthority()?.emperorOf("first-empire")).toBe(
      A,
    );
    const one = game.nationalCommandResults(game.player(A));
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({
      actorId: A,
      empireId: "first-empire",
      requestId: "request-A-1",
      accepted: true,
      reason: "accepted",
    });
    expect(game.nationalCommandResults(game.player(B))).toEqual([]);
    game.addExecution(
      new NationalFoundEmpireExecution(
        game.player(A),
        "second-empire",
        null,
        "request-A-2",
      ),
    );
    game.executeNextTick();
    game.executeNextTick();
    const second = game.nationalCommandResults(game.player(A));
    expect(second).toHaveLength(2);
    expect(second[0].sequence).toBeLessThan(second[1].sequence);
    expect(second[1]).toMatchObject({
      accepted: false,
      reason: "political-rule",
      requestId: "request-A-2",
    });
    expect(JSON.stringify(second)).not.toContain("Error:");
    expect(game.nationalPublicPoliticalView()?.empires).toEqual([
      { id: "first-empire", leaderId: A, memberIds: [A] },
    ]);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalCommandResults(restored.player(A))).toEqual(second);
    expect(restored.nationalCommandResults(restored.player(B))).toEqual([]);
  });

  it("duplicate request ID is idempotent even after snapshot; collision with another principal rejects", async () => {
    const game = await gameWithPlayers(2);
    const first = game.performNationalFoundEmpireWithOutcome(
      game.player(A),
      "a-empire",
      "same-request",
    );
    expect(first.accepted).toBe(true);
    const again = game.performNationalFoundEmpireWithOutcome(
      game.player(A),
      "a-empire",
      "same-request",
    );
    expect(again).toEqual(first);
    expect(game.nationalCommandResults(game.player(A))).toHaveLength(1);
    expect(() =>
      game.performNationalFoundEmpireWithOutcome(
        game.player(B),
        "b-empire",
        "same-request",
      ),
    ).toThrow(/foreign request ID/);
    expect(game.nationalCommandResults(game.player(B))).toEqual([]);
    const { restored } = await roundTrip(game, "plains");
    expect(
      restored.performNationalFoundEmpireWithOutcome(
        restored.player(A),
        "a-empire",
        "same-request",
      ),
    ).toEqual(first);
    expect(restored.nationalCommandResults(restored.player(A))).toHaveLength(1);
    expect(restored.nationalPublicPoliticalView()?.empires).toHaveLength(1);
  });

  it("genuine pre-spawn and invalid empire IDs produce sanitized rejection; forged Player cannot get a journal entry", async () => {
    const game = await setup(
      "plains",
      { nationalMode: true },
      humans.slice(0, 2),
    );
    const inactive = game.performNationalFoundEmpireWithOutcome(
      game.player(A),
      "waiting",
      "pre-spawn",
    );
    expect(inactive).toMatchObject({
      accepted: false,
      reason: "actor-inactive",
      actorId: A,
    });
    expect(game.nationalPublicPoliticalView()?.empires).toEqual([]);
    const live = await gameWithPlayers(2);
    const bad = live.performNationalFoundEmpireWithOutcome(
      live.player(A),
      "forbidden name",
      "bad-id",
    );
    expect(bad).toMatchObject({ accepted: false, reason: "invalid-empire-id" });
    expect(() =>
      live.performNationalFoundEmpireWithOutcome(
        game.player(A),
        "forged",
        "forged-actor",
      ),
    ).toThrow(/forged actor/);
    const oversized = live.performNationalFoundEmpireWithOutcome(
      live.player(A),
      "X".repeat(1000),
      "invalid-long-id",
    );
    expect(oversized).toMatchObject({
      accepted: false,
      empireId: "<invalid-empire-id>",
      reason: "invalid-empire-id",
    });
    expect(live.nationalCommandResults(live.player(A))).toHaveLength(2);
    expect(live.nationalCommandResults(live.player(B))).toEqual([]);
    const legacy = await gameWithPlayers(2, false);
    expect(legacy.nationalCommandResults(legacy.player(A))).toEqual([]);
    expect(() =>
      legacy.performNationalFoundEmpireWithOutcome(legacy.player(A), "legacy"),
    ).toThrow(/mode not enabled/);
  });

  it("pending registered Found Empire execution restores before acceptance with the same request ID and journal sequence", async () => {
    const game = await gameWithPlayers(2);
    game.addExecution(
      new NationalFoundEmpireExecution(
        game.player(A),
        "queued-r5",
        null,
        "durable-queued-request",
      ),
    );
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalCommandResults(restored.player(A))).toEqual([]);
    for (let i = 0; i < 2; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    const expected = game.nationalCommandResults(game.player(A));
    expect(expected).toHaveLength(1);
    expect(expected[0]).toMatchObject({
      accepted: true,
      actorId: A,
      requestId: "durable-queued-request",
      empireId: "queued-r5",
    });
    expect(restored.nationalCommandResults(restored.player(A))).toEqual(
      expected,
    );
    expect(snapshotGameData(restored).game).toEqual(
      snapshotGameData(game).game,
    );
    const replay = restored.performNationalFoundEmpireWithOutcome(
      restored.player(A),
      "queued-r5",
      "durable-queued-request",
    );
    expect(replay).toEqual(expected[0]);
    expect(restored.nationalCommandResults(restored.player(A))).toHaveLength(1);
  });

  it("same-tick duplicate queued intents produce one authoritative receipt across restore", async () => {
    const game = await gameWithPlayers(3);
    for (let i = 0; i < 2; i++)
      game.addExecution(
        new NationalFoundEmpireExecution(
          game.player(A),
          "one-empire",
          null,
          "same-tick-request",
        ),
      );
    // A mismatched empire must not reuse an otherwise valid receipt.
    game.addExecution(
      new NationalFoundEmpireExecution(
        game.player(A),
        "forged-second-empire",
        null,
        "same-tick-request",
      ),
    );
    const { restored } = await roundTrip(game, "plains");
    for (let i = 0; i < 2; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    for (const run of [game, restored]) {
      expect(run.nationalPublicPoliticalView()?.empires).toEqual([
        { id: "one-empire", leaderId: A, memberIds: [A] },
      ]);
      expect(run.nationalCommandResults(run.player(A))).toHaveLength(1);
      const receipt = run.nationalCommandResults(run.player(A))[0];
      expect(receipt).toMatchObject({
        actorId: A,
        empireId: "one-empire",
        requestId: "same-tick-request",
        sequence: 0,
        accepted: true,
      });
      expect(() =>
        run.performNationalFoundEmpireWithOutcome(
          run.player(A),
          "different-empire",
          "same-tick-request",
        ),
      ).toThrow(/foreign request ID/);
      expect(() =>
        run.performNationalFoundEmpireWithOutcome(
          run.player(B),
          "other-empire",
          "same-tick-request",
        ),
      ).toThrow(/foreign request ID/);
      expect(run.nationalCommandResults(run.player(B))).toEqual([]);
      expect(run.nationalCommandResults(run.player(A))).toEqual([receipt]);
    }
    expect(snapshotGameData(restored).game).toEqual(
      snapshotGameData(game).game,
    );
  });

  it("rejected same-tick request replay survives restore without new sequence or empire", async () => {
    const game = await gameWithPlayers(2);
    const rejected = game.performNationalFoundEmpireWithOutcome(
      game.player(A),
      "not a valid empire",
      "rejected-request",
    );
    expect(rejected).toMatchObject({
      accepted: false,
      reason: "invalid-empire-id",
      sequence: 0,
    });
    const { restored } = await roundTrip(game, "plains");
    for (const run of [game, restored]) {
      const replay = run.performNationalFoundEmpireWithOutcome(
        run.player(A),
        "not a valid empire",
        "rejected-request",
      );
      expect(replay).toEqual(rejected);
      expect(run.nationalCommandResults(run.player(A))).toEqual([rejected]);
      expect(run.nationalPublicPoliticalView()?.empires).toEqual([]);
      const fresh = run.performNationalFoundEmpireWithOutcome(
        run.player(B),
        "other-empire",
        "new-request",
      );
      expect(fresh.sequence).toBe(1);
      expect(fresh.accepted).toBe(true);
    }
    expect(snapshotGameData(restored).game).toEqual(
      snapshotGameData(game).game,
    );
  });

  it("a caller cannot preclaim a deterministic legacy auto receipt for another founder", async () => {
    const game = await gameWithPlayers(2);
    const gameTick = game.ticks();
    // A rejected explicit request deliberately preclaims the token that
    // would otherwise be generated for the next null-ID legacy execution.
    const preclaim = game.performNationalFoundEmpireWithOutcome(
      game.player(B),
      "not a valid empire",
      `auto:${gameTick}:1`,
    );
    expect(preclaim).toMatchObject({ accepted: false, sequence: 0 });
    const accepted = game.performNationalFoundEmpireWithOutcome(
      game.player(A),
      "legacy-empire",
    );
    expect(accepted).toMatchObject({
      actorId: A,
      empireId: "legacy-empire",
      requestId: `auto:${gameTick}:2`,
      sequence: 2,
      accepted: true,
    });
    expect(game.nationalCommandResults(game.player(B))).toEqual([preclaim]);
    expect(game.nationalCommandResults(game.player(A))).toEqual([accepted]);
    expect(game.nationalPublicPoliticalView()?.empires).toEqual([
      { id: "legacy-empire", leaderId: A, memberIds: [A] },
    ]);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalCommandResults(restored.player(A))).toEqual([
      accepted,
    ]);
    expect(restored.nationalCommandResults(restored.player(B))).toEqual([
      preclaim,
    ]);
  });

  it("bounded journal retains 128 actor-scoped outcomes with deterministic monotonic sequence", async () => {
    const game = await gameWithPlayers(2);
    for (let i = 0; i < 132; i++) {
      const result = game.performNationalFoundEmpireWithOutcome(
        game.player(A),
        "bad name",
        "invalid-" + i,
      );
      expect(result.accepted).toBe(false);
    }
    const results = game.nationalCommandResults(game.player(A));
    expect(results).toHaveLength(128);
    expect(results[0].sequence).toBe(4);
    expect(results[127].sequence).toBe(131);
    expect(game.nationalCommandResults(game.player(B))).toEqual([]);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.nationalCommandResults(restored.player(A))).toEqual(
      results,
    );
  });
});

describe("R5 per-human last-known sight snapshot and empire revocation", () => {
  it("human memory survives deterministic restore; another principal cannot overwrite, borrow or mutate it", async () => {
    const game = await gameWithPlayers(3);
    const item = memory(A, game.ticks());
    game.writeNationalObserverMemory(A, item);
    const read = game.readNationalObserverMemory(A)!;
    expect(read).toEqual(item);
    expect(game.readNationalObserverMemory(B)).toBeNull();
    expect(() => game.writeNationalObserverMemory(B, item)).toThrow(
      /wrong observer principal/,
    );
    expect(() =>
      game.writeNationalObserverMemory(
        "invented",
        memory("invented", game.ticks()),
      ),
    ).toThrow(/unknown or unauthorized/);
    (read.assets[0] as { x: number }).x = 99999;
    expect(game.readNationalObserverMemory(A)?.assets[0].x).toBe(27);
    expect(game.readNationalObserverMemory(B)).toBeNull();
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.readNationalObserverMemory(A)).toEqual(item);
    expect(restored.readNationalObserverMemory(B)).toBeNull();
    // Historical v3 snapshots had no human sight/journal state. Preserve
    // their exact upgrade behavior while new v4 snapshots retain memory.
    const latest = readVersioned(GameSnapshot, snapshotGameData(game).game);
    const preGovernance = Object.fromEntries(
      Object.entries(latest).filter(([key]) => key !== "nationalGovernance"),
    );
    const migrated = readVersioned(GameSnapshot, { v: 3, d: preGovernance });
    expect(migrated.nationalGovernance).toBeNull();
  });

  it("foreign inherited sight is rejected until empire membership; dissolution revokes only inherited memory", async () => {
    const game = await gameWithPlayers(3);
    const prior = memory(A, game.ticks());
    game.writeNationalObserverMemory(A, prior);
    expect(() =>
      game.writeNationalObserverMemory(A, memory(A, game.ticks(), B)),
    ).toThrow(/no current empire intelligence grant/);
    joinEmpire(game, A, B, "sight-empire");
    const shared = memory(A, game.ticks(), B);
    game.writeNationalObserverMemory(A, shared);
    expect(game.readNationalObserverMemory(A)).toEqual(shared);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.readNationalObserverMemory(A)).toEqual(shared);
    for (const g of [game, restored]) {
      eliminate(g, B);
      // The eliminated subordinate leaves, but living emperor A remains.
      expect(g.nationalPoliticalAuthority()?.empireOf(A)).toBe("sight-empire");
      expect(g.nationalPoliticalAuthority()?.empireOf(B)).toBeNull();
      expect(g.readNationalObserverMemory(A)?.assets).toEqual([]);
      expect(g.readNationalObserverMemory(B)).toBeNull();
      g.writeNationalObserverMemory(A, prior);
      expect(g.readNationalObserverMemory(A)).toEqual(prior);
    }
    expect(snapshotGameData(restored).game).toEqual(
      snapshotGameData(game).game,
    );
  });

  it("membership revokes inherited sight immediately on political transition, not just a future worker packet", async () => {
    const game = await gameWithPlayers(3);
    joinEmpire(game, A, B, "current-sight-empire");
    game.writeNationalObserverMemory(A, memory(A, game.ticks(), B));
    expect(game.readNationalObserverMemory(A)?.assets).toHaveLength(1);
    // A transfer of crown does not remove membership or shared intelligence.
    game.performNationalCommand(game.player(A), {
      kind: "transfer-crown",
      empireId: "current-sight-empire",
      successorId: B,
    });
    expect(game.readNationalObserverMemory(A)?.assets).toHaveLength(1);
    // The real Game revokes membership when the new emperor is eliminated.
    eliminate(game, B);
    expect(game.readNationalObserverMemory(A)?.assets).toEqual([]);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.readNationalObserverMemory(A)?.assets).toEqual([]);
  });

  it("eliminating the observer purges private sight from snapshots and public politics", async () => {
    const game = await gameWithPlayers(3);
    game.writeNationalObserverMemory(A, memory(A, game.ticks()));
    expect(game.readNationalObserverMemory(A)?.assets).toHaveLength(1);
    expect(JSON.stringify(game.nationalPublicPoliticalView())).not.toContain(
      "observed-hostile-unit",
    );
    eliminate(game, A);
    expect(game.readNationalObserverMemory(A)).toBeNull();
    const { restored } = await roundTrip(game, "plains");
    expect(restored.readNationalObserverMemory(A)).toBeNull();
    expect(JSON.stringify(restored.nationalPublicPoliticalView())).not.toContain(
      "observed-hostile-unit",
    );
  });

  it("human sight expires after exactly sixty deterministic simulation ticks and stays expired after restore", async () => {
    const game = await gameWithPlayers(2);
    game.writeNationalObserverMemory(A, memory(A, game.ticks()));
    for (let i = 0; i < 60; i++) game.executeNextTick();
    expect(game.readNationalObserverMemory(A)?.assets).toHaveLength(1);
    game.executeNextTick();
    expect(game.readNationalObserverMemory(A)?.assets).toEqual([]);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.readNationalObserverMemory(A)?.assets).toEqual([]);
  });

  it("future or duplicated sight memory is rejected without altering prior snapshot", async () => {
    const game = await gameWithPlayers(3);
    const original = memory(A, game.ticks());
    game.writeNationalObserverMemory(A, original);
    expect(() =>
      game.writeNationalObserverMemory(A, memory(A, game.ticks() + 1)),
    ).toThrow(/duplicate or future observation/);
    expect(() =>
      game.writeNationalObserverMemory(A, {
        observerId: A,
        assets: [original.assets[0], original.assets[0]],
      }),
    ).toThrow(/duplicate or future observation/);
    expect(game.readNationalObserverMemory(A)).toEqual(original);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.readNationalObserverMemory(A)).toEqual(original);
  });
});

// Temporary CI-only formatter diagnostic: removed after recording pinned output.
import { execFileSync as round6ExecFileSync } from "node:child_process";
it("round-six formatter diagnostic", () => {
  const files = [
    "packages/engine/src/national/politics/NationalGovernanceState.ts",
    "tests/national/PoliticalMdaOutcomesMemory.test.ts",
  ];
  round6ExecFileSync("./node_modules/.bin/oxfmt", ["--write", ...files]);
  const diff = round6ExecFileSync("git", ["diff", "--", ...files], {
    encoding: "utf8",
  });
  console.log("ROUND6_FORMAT_DIFF_BEGIN\\n" + diff + "\\nROUND6_FORMAT_DIFF_END");
});
