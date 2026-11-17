import { execFileSync } from "node:child_process";
import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { NationalFoundEmpireExecution } from "@openfront/engine/execution/NationalFoundEmpireExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameSnapshot } from "@openfront/engine/game/GameImpl";
import { snapshotGame, snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { METRIC_KEYS } from "@openfront/engine/national/politics/sovereignty";
import { describe, expect, it } from "vitest";
import { TrustedNationalSaveStore } from "../../src/server/national/TrustedNationalSaveStore";
import { setup } from "../util/Setup";
import { restoreTestGame, roundTrip } from "../util/Snapshot";

const players = [
  new PlayerInfo("R8 North", PlayerType.Human, "r8-client-a", "r8-a"),
  new PlayerInfo("R8 South", PlayerType.Human, "r8-client-b", "r8-b"),
  new PlayerInfo("R8 East", PlayerType.Human, "r8-client-c", "r8-c"),
  new PlayerInfo("R8 West", PlayerType.Human, "r8-client-d", "r8-d"),
];
const [A, B, C, D] = players.map((p) => p.id);
const spots = [
  [25, 25],
  [70, 70],
  [25, 70],
  [70, 25],
] as const;
const leaderTerms = { admission: "leader" as const, expulsion: "forbidden" as const };
const unanimousTerms = {
  admission: "unanimous" as const,
  expulsion: "forbidden" as const,
};

async function spawned(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, players);
  for (let i = 0; i < players.length; i++) {
    const [x, y] = spots[i];
    game.addExecution(new SpawnExecution("r8-actual-game", players[i], game.map().ref(x, y)));
  }
  game.executeNextTick();
  game.executeNextTick();
  for (const player of players) expect(game.player(player.id).hasSpawned()).toBe(true);
  return game;
}

function state(game: Game) {
  return readVersioned(GameSnapshot, snapshotGameData(game).game).national?.politics;
}

function pact(game: Game, id: string) {
  return state(game)?.pacts.find((p) => p.id === id);
}

function foundEmpire(game: Game): void {
  game.performNationalCommand(game.player(A), {
    kind: "found-empire",
    empireId: "r8-empire",
  });
}

function addEmpireMember(game: Game, id: string): void {
  game.performNationalCommand(game.player(A), {
    kind: "offer-empire",
    empireId: "r8-empire",
    candidateId: id,
  });
  game.performNationalCommand(game.player(id), {
    kind: "accept-empire",
    empireId: "r8-empire",
    candidateId: id,
  });
}

function makePact(game: Game, id: string, founderId: string, targets: string[]): void {
  game.performNationalCommand(game.player(founderId), {
    kind: "found-pact",
    pactId: id,
    name: "Constitutional pact",
    pactKind: "NAP",
    terms: leaderTerms,
  });
  for (const targetId of targets) {
    game.performNationalCommand(game.player(founderId), {
      kind: "invite-pact",
      pactId: id,
      candidateId: targetId,
    });
    game.performNationalCommand(game.player(targetId), {
      kind: "accept-pact",
      pactId: id,
    });
  }
}

function eliminate(game: Game, id: string): void {
  for (const tile of [...game.player(id).tiles()]) game.player(id).relinquish(tile);
  game.executeNextTick();
}

describe("Round Eight real Game sovereignty and constitutional voting", () => {
  it("SOV-03/04: a three-member empire wins only after the fourth sovereign falls, with transferred crown and exact restore", async () => {
    const game = await spawned();
    foundEmpire(game);
    addEmpireMember(game, B);
    addEmpireMember(game, C);
    expect(game.nationalPoliticalAuthority()?.membersOf("r8-empire")).toEqual([A, B, C]);
    expect(game.nationalVictoryRoster()).toBeNull();
    game.performNationalCommand(game.player(A), {
      kind: "transfer-crown",
      empireId: "r8-empire",
      successorId: C,
    });
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalPoliticalAuthority()?.emperorOf("r8-empire")).toBe(C);
    for (const g of [game, restored]) {
      eliminate(g, D);
      expect(g.nationalVictoryRoster()?.prizes).toEqual([
        { kind: "ImperialVictor", nationId: C, empireId: "r8-empire" },
        { kind: "EmpireVictor", nationId: A, empireId: "r8-empire" },
        { kind: "EmpireVictor", nationId: B, empireId: "r8-empire" },
      ]);
      const win = new WinCheckExecution();
      win.init(g, g.ticks());
      win.checkWinnerFFA();
      const winner = g.getWinner();
      expect(typeof winner === "string" ? winner : winner?.id()).toBe(C);
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });

  it("SOV-06: removing the actual emperor dissolves empire, restores member sovereignty, and makes surviving member win after replay", async () => {
    const game = await spawned();
    foundEmpire(game);
    addEmpireMember(game, B);
    addEmpireMember(game, C);
    const { restored } = await roundTrip(game, "plains");
    for (const g of [game, restored]) {
      eliminate(g, A);
      expect(g.nationalPoliticalAuthority()?.empireExists("r8-empire")).toBe(false);
      expect(g.nationalPoliticalAuthority()?.empireOf(B)).toBeNull();
      expect(g.nationalPoliticalAuthority()?.empireOf(C)).toBeNull();
      expect(g.nationalVictoryRoster()).toBeNull();
      eliminate(g, C);
      eliminate(g, D);
      expect(g.nationalVictoryRoster()?.prizes).toEqual([
        { kind: "SovereignVictor", nationId: B },
      ]);
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });

  it("COAL-03/07: only distinct authenticated members can amend; incomplete votes restore without changing constitution", async () => {
    const game = await spawned();
    makePact(game, "r8-constitution", A, [B, C]);
    game.performNationalCommand(game.player(A), {
      kind: "propose-pact-amendment",
      pactId: "r8-constitution",
      terms: unanimousTerms,
      administratorId: B,
    });
    expect(pact(game, "r8-constitution")?.terms).toEqual(leaderTerms);
    expect(pact(game, "r8-constitution")?.pendingAmendment?.approvedBy).toEqual([A]);
    expect(() =>
      game.performNationalCommand(game.player(D), {
        kind: "approve-pact-amendment",
        pactId: "r8-constitution",
      }),
    ).toThrow(/requires member/);
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    for (const g of [game, restored]) {
      g.performNationalCommand(g.player(B), {
        kind: "approve-pact-amendment",
        pactId: "r8-constitution",
      });
      g.performNationalCommand(g.player(A), {
        kind: "approve-pact-amendment",
        pactId: "r8-constitution",
      });
      expect(pact(g, "r8-constitution")?.terms).toEqual(leaderTerms);
      expect(pact(g, "r8-constitution")?.pendingAmendment?.approvedBy).toEqual([A, B]);
      g.performNationalCommand(g.player(C), {
        kind: "approve-pact-amendment",
        pactId: "r8-constitution",
      });
      expect(pact(g, "r8-constitution")).toMatchObject({
        terms: unanimousTerms,
        administratorId: B,
      });
      expect(pact(g, "r8-constitution")?.pendingAmendment).toBeUndefined();
      expect(() =>
        g.performNationalCommand(g.player(A), {
          kind: "expel-pact",
          pactId: "r8-constitution",
          memberId: C,
          approvingIds: [A],
        }),
      ).toThrow(/forbidden/);
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });

  it("COAL-04/06: Betray breaks forbidden-expulsion pact and accession atomically cancels all outside coalitions and stale amendment ballots", async () => {
    const game = await spawned();
    makePact(game, "r8-first", A, [B, C]);
    makePact(game, "r8-second", B, [C]);
    game.performNationalCommand(game.player(A), {
      kind: "propose-pact-amendment",
      pactId: "r8-first",
      terms: unanimousTerms,
      administratorId: A,
    });
    const { restored } = await roundTrip(game, "plains");
    for (const g of [game, restored]) {
      g.performNationalCommand(g.player(C), {
        kind: "betray-pact",
        pactId: "r8-first",
      });
      expect(pact(g, "r8-first")?.memberIds).toEqual([A, B]);
      expect(pact(g, "r8-first")?.pendingAmendment).toBeUndefined();
      expect(() =>
        g.performNationalCommand(g.player(A), {
          kind: "approve-pact-amendment",
          pactId: "r8-first",
        }),
      ).toThrow(/not pending/);
      g.performNationalCommand(g.player(D), {
        kind: "found-empire",
        empireId: "r8-external",
      });
      g.performNationalCommand(g.player(D), {
        kind: "offer-empire",
        empireId: "r8-external",
        candidateId: B,
      });
      g.performNationalCommand(g.player(B), {
        kind: "accept-empire",
        empireId: "r8-external",
        candidateId: B,
      });
      expect(g.nationalPoliticalAuthority()?.empireOf(B)).toBe("r8-external");
      expect(state(g)?.pacts).toEqual([]);
      expect(g.nationalPoliticalAuthority()?.treatyProtects(B, C)).toBe(false);
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });

  it("COAL-03: forged unanimous expulsion signatures are rejected instead of trusting caller-supplied names", async () => {
    const game = await spawned();
    makePact(game, "r8-anti-forgery", A, [B, C]);
    game.performNationalCommand(game.player(A), {
      kind: "propose-pact-amendment",
      pactId: "r8-anti-forgery",
      terms: { admission: "leader", expulsion: "unanimous" },
      administratorId: A,
    });
    for (const member of [B, C]) {
      game.performNationalCommand(game.player(member), {
        kind: "approve-pact-amendment",
        pactId: "r8-anti-forgery",
      });
    }
    const before = snapshotGameData(game);
    expect(() =>
      game.performNationalCommand(game.player(A), {
        kind: "expel-pact",
        pactId: "r8-anti-forgery",
        memberId: C,
        approvingIds: [A, B],
      }),
    ).toThrow(/cannot be impersonated/);
    expect(() =>
      game.performNationalCommand(game.player(A), {
        kind: "expel-pact",
        pactId: "r8-anti-forgery",
        memberId: C,
        approvingIds: [A],
      }),
    ).toThrow(/remaining members/);
    expect(snapshotGameData(game)).toEqual(before);
  });
});

describe("Round Eight full-scale real sovereign winners and strict crisis", () => {
  it("SOV-03: eight actual spawned players join one empire and award precisely one Imperial plus seven Empire winners", async () => {
    const eight = Array.from(
      { length: 8 },
      (_, i) =>
        new PlayerInfo(
          "R8 Empire " + i,
          PlayerType.Human,
          "r8-eight-client-" + i,
          "r8-eight-id-" + i,
        ),
    );
    const locations = [
      [20, 20],
      [50, 20],
      [80, 20],
      [20, 50],
      [50, 50],
      [80, 50],
      [20, 80],
      [50, 80],
    ] as const;
    const game = await setup("plains", { nationalMode: true }, eight);
    for (let i = 0; i < eight.length; i++) {
      const [x, y] = locations[i];
      game.addExecution(
        new SpawnExecution("r8-eight-actual", eight[i], game.map().ref(x, y)),
      );
    }
    game.executeNextTick();
    game.executeNextTick();
    for (const member of eight) {
      expect(game.player(member.id).hasSpawned()).toBe(true);
    }
    const sovereign = eight[0].id;
    game.performNationalCommand(game.player(sovereign), {
      kind: "found-empire",
      empireId: "r8-eight-empire",
    });
    for (const entrant of eight.slice(1)) {
      game.performNationalCommand(game.player(sovereign), {
        kind: "offer-empire",
        empireId: "r8-eight-empire",
        candidateId: entrant.id,
      });
      game.performNationalCommand(game.player(entrant.id), {
        kind: "accept-empire",
        empireId: "r8-eight-empire",
        candidateId: entrant.id,
      });
    }
    const prizes = game.nationalVictoryRoster()?.prizes ?? [];
    expect(prizes).toHaveLength(8);
    expect(prizes[0]).toEqual({
      kind: "ImperialVictor",
      nationId: sovereign,
      empireId: "r8-eight-empire",
    });
    expect(prizes.slice(1)).toEqual(
      eight
        .slice(1)
        .map((p) => ({
          kind: "EmpireVictor",
          nationId: p.id,
          empireId: "r8-eight-empire",
        })),
    );
    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalVictoryRoster()?.prizes).toEqual(prizes);
  });

  it("SOV-05: real eight-metric absolute deficit warns for exactly ten simulated seconds; a crown transfer before deadline survives replay", async () => {
    const game = await spawned();
    const north = game.player(A);
    const south = game.player(B);
    for (const tile of [...north.tiles()].slice(1)) north.relinquish(tile);
    north.setTroops(1);
    south.setTroops(1_000_000);
    south.addGold(50_000_000n);
    const tile = [...south.tiles()][0];
    for (const [type, params] of [
      [UnitType.City, {}],
      [UnitType.Factory, {}],
      [UnitType.Port, {}],
      [UnitType.MissileSilo, {}],
      [UnitType.Warship, { patrolTile: tile }],
    ] as const) {
      south.buildUnit(type, tile, params).setUnderConstruction(false);
    }
    foundEmpire(game);
    addEmpireMember(game, B);
    game.executeNextTick();
    const nations = state(game)!.nations;
    const ruler = nations.find((n) => n.id === A)!;
    const rival = nations.find((n) => n.id === B)!;
    for (const metric of METRIC_KEYS) {
      expect(ruler.metrics[metric], "strict Ungovernable: " + metric).toBeLessThan(
        rival.metrics[metric],
      );
    }
    const start = game.nationalUngovernableWarnings();
    expect(start).toHaveLength(1);
    expect(start[0].remainingMs).toBe(9_900);
    const baseline = snapshotGame(game);
    for (const type of [
      UnitType.City,
      UnitType.Factory,
      UnitType.Port,
      UnitType.MissileSilo,
      UnitType.Warship,
    ]) {
      const tied = await restoreTestGame(baseline, "plains");
      tied.player(B).units(type)[0].delete();
      tied.executeNextTick();
      expect(tied.nationalUngovernableWarnings(), "one strict tie: " + type).toEqual([]);
    }
    const { restored } = await roundTrip(game, "plains");
    for (let tick = 0; tick < 98; tick++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(game.nationalUngovernableWarnings()[0].remainingMs).toBe(100);
    for (const g of [game, restored]) {
      g.performNationalCommand(g.player(A), {
        kind: "transfer-crown",
        empireId: "r8-empire",
        successorId: B,
      });
      expect(g.nationalUngovernableWarnings()).toEqual([]);
      expect(g.nationalPoliticalAuthority()?.emperorOf("r8-empire")).toBe(B);
      g.executeNextTick();
      expect(g.nationalUngovernableWarnings()).toEqual([]);
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });
});

describe("Round Eight one-journal authenticated political outcomes", () => {
  it("exposes actor-only real queued amendment receipts with exact request IDs and cross-kind collision defense across restore", async () => {
    const game = await spawned();
    makePact(game, "r8-receipts", A, [B, C]);
    const proposal = {
      kind: "propose-pact-amendment" as const,
      pactId: "r8-receipts",
      terms: unanimousTerms,
      administratorId: B,
    };
    game.addExecution(
      new NationalFoundEmpireExecution(
        game.player(A),
        "",
        proposal,
        "r8-command-proposal",
      ),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(game.nationalPoliticalCommandResults(game.player(A))).toMatchObject([
      {
        commandKind: "propose-pact-amendment",
        commandTargetId: "r8-receipts",
        requestId: "r8-command-proposal",
        accepted: true,
        sequence: 0,
      },
    ]);
    expect(game.nationalCommandResults(game.player(A))).toEqual([]);
    expect(game.nationalPoliticalCommandResults(game.player(D))).toEqual([]);
    const { restored } = await roundTrip(game, "plains");
    for (const g of [game, restored]) {
      const first = g.nationalPoliticalCommandResults(g.player(A))[0];
      const replay = g.performNationalPoliticalCommandWithOutcome(
        g.player(A),
        proposal,
        "r8-command-proposal",
      );
      expect(replay).toEqual(first);
      expect(g.nationalPoliticalCommandResults(g.player(A))).toHaveLength(1);
      expect(() =>
        g.performNationalPoliticalCommandWithOutcome(
          g.player(B),
          { kind: "approve-pact-amendment", pactId: "r8-receipts" },
          "r8-command-proposal",
        ),
      ).toThrow(/reused foreign request ID/);
      expect(() =>
        g.performNationalPoliticalCommandWithOutcome(
          g.player(A),
          { kind: "approve-pact-amendment", pactId: "r8-receipts" },
          "r8-command-proposal",
        ),
      ).toThrow(/reused foreign request ID/);
      g.addExecution(
        new NationalFoundEmpireExecution(
          g.player(B),
          "",
          { kind: "approve-pact-amendment", pactId: "r8-receipts" },
          "r8-command-b",
        ),
      );
      g.executeNextTick();
      g.executeNextTick();
      expect(g.nationalPoliticalCommandResults(g.player(B))).toMatchObject([
        {
          commandKind: "approve-pact-amendment",
          requestId: "r8-command-b",
          accepted: true,
          sequence: 1,
        },
      ]);
      expect(pact(g, "r8-receipts")?.terms).toEqual(leaderTerms);
      g.addExecution(
        new NationalFoundEmpireExecution(
          g.player(C),
          "",
          { kind: "approve-pact-amendment", pactId: "r8-receipts" },
          "r8-command-c",
        ),
      );
      g.executeNextTick();
      g.executeNextTick();
      expect(g.nationalPoliticalCommandResults(g.player(C))).toMatchObject([
        {
          commandKind: "approve-pact-amendment",
          requestId: "r8-command-c",
          accepted: true,
          sequence: 2,
        },
      ]);
      expect(pact(g, "r8-receipts")?.terms).toEqual(unanimousTerms);
      expect(g.nationalCommandResults(g.player(A))).toEqual([]);
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });
});

describe("Round Eight trusted-host private NATIONAL save primitive", () => {
  const resolveServerSession = (session: unknown, gameID: string) => {
    if (gameID !== "r8-host-game") return null;
    if (session === "verified-alice") {
      return { accountId: "account-a", playerId: A, clientID: "r8-client-a" };
    }
    if (session === "verified-bob") {
      return { accountId: "account-b", playerId: B, clientID: "r8-client-b" };
    }
    if (session === "forged-player") {
      return { accountId: "account-a", playerId: B, clientID: "r8-client-a" };
    }
    return null;
  };

  it("persists the full real political snapshot only inside host memory and restores for its verified account/player", async () => {
    const game = await spawned();
    foundEmpire(game);
    addEmpireMember(game, B);
    const store = new TrustedNationalSaveStore(resolveServerSession, 1);
    const handle = store.save("r8-host-game", "verified-alice", game);
    expect(Object.keys(handle).sort()).toEqual(["gameID", "id", "tick"]);
    expect(JSON.stringify(handle)).not.toContain("r8-empire");
    expect(() => store.save("r8-host-game", "verified-alice", game)).toThrow(/quota/);
    expect(() => store.save("r8-host-game", "forged-player", game)).toThrow(/unauthorized/);
    let restores = 0;
    const restore = async (bytes: Uint8Array) => {
      restores++;
      return restoreTestGame(bytes, "plains");
    };
    await expect(store.restore(handle.id, "verified-bob", restore)).rejects.toThrow(/unauthorized/);
    await expect(store.restore(handle.id, "no-session", restore)).rejects.toThrow(/unauthorized/);
    expect(restores).toBe(0);
    const recovered = await store.restore(handle.id, "verified-alice", restore);
    expect(restores).toBe(1);
    expect(recovered.nationalPoliticalAuthority()?.membersOf("r8-empire")).toEqual([A, B]);
    expect(snapshotGameData(recovered)).toEqual(snapshotGameData(game));
    expect(() => store.delete(handle.id, "verified-bob")).toThrow(/unauthorized/);
    store.delete(handle.id, "verified-alice");
    await expect(store.restore(handle.id, "verified-alice", restore)).rejects.toThrow(/not found/);
  });

  it("refuses legacy FFA and any session without a Game-registered player binding", async () => {
    const game = await spawned();
    const legacy = await setup("plains", { nationalMode: false }, players);
    const store = new TrustedNationalSaveStore(resolveServerSession);
    expect(() => store.save("r8-host-game", "no-session", game)).toThrow(/unauthorized/);
    expect(() => store.save("r8-host-game", "verified-alice", legacy)).toThrow(/legacy/);
    expect(() => store.save("different-game", "verified-alice", game)).toThrow(/unauthorized/);
  });
});

/**
 * TEMPORARY E1 DIAGNOSTIC ONLY — delete before final PR handoff.
 * Captures the exact pinned oxfmt source diff in CI, not a gameplay check.
 */
describe("E1 R8 TEMP PINNED FORMAT DIAGNOSTIC — REMOVE", () => {
  it("prints the exact oxfmt diff of E1-owned files", () => {
    const paths = [
      "packages/engine/src/game/GameImpl.ts",
      "packages/engine/src/national/politics/NationalGovernanceState.ts",
      "src/server/national/TrustedNationalSaveStore.ts",
      "tests/national/RoundEightSovereigntyGame.test.ts",
    ];
    execFileSync("node_modules/.bin/oxfmt", ["--write", ...paths]);
    const diff = execFileSync("git", ["diff", "--", ...paths], {
      encoding: "utf8",
      maxBuffer: 2_000_000,
    });
    console.log("E1_R8_FORMAT_DIFF_BEGIN\\n" + diff + "\\nE1_R8_FORMAT_DIFF_END");
  });
});
