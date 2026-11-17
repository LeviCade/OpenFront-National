import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameSnapshot } from "@openfront/engine/game/GameImpl";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
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
          approvingIds: [A, B],
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
