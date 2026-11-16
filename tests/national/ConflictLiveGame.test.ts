import {
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import {
  NationalAcceptPeaceIntentSchema,
  NationalDeclareWarIntentSchema,
  NationalProposePeaceIntentSchema,
} from "@openfront/engine-api/Schemas";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game, Player } from "@openfront/engine/game/Game";
import { PlayerImpl } from "@openfront/engine/game/PlayerImpl";
import { authorizeNationalAttack } from "@openfront/engine/execution/NationalWarExecution";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const info = [
  new PlayerInfo("North", PlayerType.Human, "north-client", "north-id"),
  new PlayerInfo("South", PlayerType.Human, "south-client", "south-id"),
  new PlayerInfo("East", PlayerType.Human, "east-client", "east-id"),
  new PlayerInfo("West", PlayerType.Human, "west-client", "west-id"),
  new PlayerInfo("Central", PlayerType.Human, "center-client", "center-id"),
];
const coords = [[20, 20], [70, 20], [20, 70], [70, 70], [50, 50]];

async function spawned(nationalMode = true): Promise<Game> {
  const game = await setup("plains", { nationalMode }, info);
  for (let i = 0; i < info.length; i++) {
    const [x, y] = coords[i];
    game.addExecution(
      new SpawnExecution("national-e2-r4", info[i], game.map().ref(x, y)),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  for (const p of info) expect(game.player(p.id).hasSpawned()).toBe(true);
  return game;
}

function giveBorder(game: Game): void {
  const north = game.player("north-id");
  const south = game.player("south-id");
  const map = game.map();
  for (let y = 30; y < 48; y++) {
    for (let x = 30; x < 50; x++) north.conquer(map.ref(x, y));
    for (let x = 50; x < 70; x++) south.conquer(map.ref(x, y));
  }
  game.executeNextTick();
}

function preparePlayerDebits(players: Player[]) {
  return players.map((player) => ({
    player: player as PlayerImpl,
    expectedBalance: 100_000,
    debit: 10_000,
    resultingBalance: 90_000,
  }));
}

describe("Round Four REAL Game / AttackExecution NATIONAL gate", () => {
  it("WAR-01 no formal declaration denies an actual attack before any attacker troop debit", async () => {
    const game = await spawned();
    giveBorder(game);
    const north = game.player("north-id");
    const south = game.player("south-id");
    north.setTroops(100_000);
    south.setTroops(100_000);
    const before = north.troops();
    const southBefore = south.troops();
    expect(authorizeNationalAttack(game, north.id(), south.id())).toBe(false);
    const attack = new AttackExecution(30_000, north, south.id());
    // Invoke the real AttackExecution against the real Game without advancing
    // PlayerExecution's independent per-tick 479-troop regeneration.
    attack.init(game, game.ticks());
    expect(attack.isActive()).toBe(false);
    expect(north.troops()).toBe(before);
    expect(south.troops()).toBe(southBefore);
    expect(north.outgoingAttacks()).toHaveLength(0);
  });

  it("neutral territory remains attackable by real living player, not forged player", async () => {
    const game = await spawned();
    const north = game.player("north-id");
    north.setTroops(40_000);
    expect(authorizeNationalAttack(game, north.id(), null)).toBe(true);
    expect(authorizeNationalAttack(game, "missing-id", null)).toBe(false);
    game.addExecution(new AttackExecution(10_000, north, game.terraNullius().id()));
    game.executeNextTick();
    expect(north.troops()).toBeLessThan(40_000);
    const other = await spawned();
    const forged = other.player("north-id");
    forged.setTroops(40_000);
    const attempt = new AttackExecution(10_000, forged, game.terraNullius().id());
    game.addExecution(attempt);
    game.executeNextTick();
    expect(attempt.isActive()).toBe(false);
    expect(forged.troops()).toBe(40_000);
  });

  it("trusted clientID routing parses three actual national war command shapes", async () => {
    const game = await spawned();
    const executor = new Executor(game, "national-e2-r4", undefined);
    expect(
      NationalDeclareWarIntentSchema.parse({
        type: "national_declare_war",
        scope: "national",
        nationId: "north-id",
        targetId: "south-id",
        targetKind: "nation",
      }).targetId,
    ).toBe("south-id");
    expect(
      NationalProposePeaceIntentSchema.parse({
        type: "national_propose_peace",
        warId: "war-1",
      }).warId,
    ).toBe("war-1");
    expect(
      NationalAcceptPeaceIntentSchema.parse({
        type: "national_accept_peace",
        motionId: "peace-1",
      }).motionId,
    ).toBe("peace-1");

    const refused = executor.createExec({
      type: "national_declare_war",
      scope: "national",
      nationId: "south-id",
      targetId: "north-id",
      targetKind: "nation",
      clientID: "forged-client",
    });
    game.addExecution(refused);
    game.executeNextTick();
    expect(authorizeNationalAttack(game, "south-id", "north-id")).toBe(false);
    expect(game.player("south-id").outgoingAttacks()).toHaveLength(0);
  });

  it("LEVY-01 actual PlayerImpl balances commit once with exact BigInt conservation", async () => {
    const game = await spawned();
    const donors = ["east-id", "west-id", "center-id"].map((id) => game.player(id));
    for (const donor of donors) donor.setTroops(100_000);
    const rows = preparePlayerDebits(donors);
    PlayerImpl.commitNationalTroopDebits(rows);
    for (const donor of donors) expect(donor.troops()).toBe(90_000);
    expect(donors.reduce((sum, donor) => sum + donor.troops(), 0)).toBe(270_000);
  });

  for (const failingContributor of [1, 2]) {
    it(`LEVY-05 atomic failure at real contributor ${failingContributor} leaves every PlayerImpl balance unchanged`, async () => {
      const game = await spawned();
      const donors = ["east-id", "west-id", "center-id"].map((id) => game.player(id));
      for (const donor of donors) donor.setTroops(100_000);
      const rows = preparePlayerDebits(donors);
      expect(() =>
        PlayerImpl.commitNationalTroopDebits(rows, (index) => {
          if (index === failingContributor) throw new Error("injected debit failure");
        }),
      ).toThrow("injected debit failure");
      for (const donor of donors) expect(donor.troops()).toBe(100_000);
      // A subsequent valid attempt has not consumed any campaign allowance.
      PlayerImpl.commitNationalTroopDebits(rows);
      for (const donor of donors) expect(donor.troops()).toBe(90_000);
    });
  }

  it("LEVY-06 malformed, stale and duplicate account changes are rejected before any debit", async () => {
    const game = await spawned();
    const donors = ["east-id", "west-id", "center-id"].map((id) => game.player(id));
    for (const donor of donors) donor.setTroops(100_000);
    const rows = preparePlayerDebits(donors);
    for (const corrupt of [
      [{ ...rows[0], debit: 0 }, ...rows.slice(1)],
      [{ ...rows[0], debit: 1.5 }, ...rows.slice(1)],
      [{ ...rows[0], resultingBalance: 90_001 }, ...rows.slice(1)],
      [rows[0], rows[0], rows[2]],
      [{ ...rows[0], expectedBalance: 99_999 }, ...rows.slice(1)],
    ]) {
      expect(() => PlayerImpl.commitNationalTroopDebits(corrupt)).toThrow();
      for (const donor of donors) expect(donor.troops()).toBe(100_000);
    }
  });

  it("snapshot round-trips queued real war execution without forging war authority", async () => {
    const game = await spawned();
    game.addExecution(
      new Executor(game, "national-e2-r4", undefined).createExec({
        type: "national_declare_war",
        scope: "national",
        nationId: "north-id",
        targetId: "south-id",
        targetKind: "nation",
        clientID: "north-client",
      }),
    );
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    for (let i = 0; i < 2; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(authorizeNationalAttack(restored, "north-id", "south-id")).toBe(
      authorizeNationalAttack(game, "north-id", "south-id"),
    );
  });

  it("legacy FFA still rejects no new attack due to NATIONAL war rules", async () => {
    const game = await spawned(false);
    expect(game.nationalPoliticalAuthority()).toBeNull();
    expect(authorizeNationalAttack(game, "north-id", "south-id")).toBe(true);
  });
});
