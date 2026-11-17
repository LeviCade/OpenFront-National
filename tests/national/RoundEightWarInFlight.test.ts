import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { TransportShipExecution } from "@openfront/engine/execution/TransportShipExecution";
import type { Game, Player } from "@openfront/engine/game/Game";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const A = "r8-attacker";
const B = "r8-defender";
const C = "r8-member";
const records = [
  new PlayerInfo("R8 attacker", PlayerType.Human, "r8-attacker-client", A),
  new PlayerInfo("R8 defender", PlayerType.Human, "r8-defender-client", B),
  new PlayerInfo("R8 member", PlayerType.Human, "r8-member-client", C),
];

async function spawnOnPlains(): Promise<Game> {
  const game = await setup(
    "plains",
    { nationalMode: true, infiniteGold: true, instantBuild: true },
    records,
  );
  const centers = [
    [25, 25],
    [70, 70],
    [25, 70],
  ];
  for (let i = 0; i < records.length; i++) {
    game.addExecution(
      new SpawnExecution(
        "r8-war",
        records[i],
        game.ref(centers[i][0], centers[i][1]),
      ),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  for (const info of records)
    expect(game.player(info.id).hasSpawned()).toBe(true);
  return game;
}

async function spawnOnIslands(): Promise<{
  game: Game;
  attacker: Player;
  defender: Player;
  targetTile: number;
}> {
  const game = await setup(
    "ocean_and_land",
    { nationalMode: true, infiniteGold: true, instantBuild: true },
    records.slice(0, 2),
  );
  let left: number | undefined;
  let right: number | undefined;
  game.map().forEachTile((tile) => {
    if (!game.isLand(tile)) return;
    if (game.x(tile) <= 7 && left === undefined) left = tile;
    if (game.x(tile) >= 14 && right === undefined) right = tile;
  });
  if (left === undefined || right === undefined)
    throw new Error("island fixture missing land");
  game.addExecution(new SpawnExecution("r8-islands", records[0], left));
  game.addExecution(new SpawnExecution("r8-islands", records[1], right));
  game.executeNextTick();
  game.executeNextTick();
  const attacker = game.player(A);
  const defender = game.player(B);
  expect(attacker.hasSpawned()).toBe(true);
  expect(defender.hasSpawned()).toBe(true);

  let targetTile = right;
  game.map().forEachTile((tile) => {
    if (!game.isLand(tile)) return;
    if (game.x(tile) <= 7) attacker.conquer(tile);
    if (game.x(tile) >= 14) {
      defender.conquer(tile);
      targetTile = tile;
    }
  });
  attacker.setTroops(100_000);
  defender.setTroops(100_000);
  return { game, attacker, defender, targetTile };
}

function declare(
  game: Game,
  aggressorId = A,
  targetId = B,
  warId = "r8-national",
): void {
  game.performNationalWarCommand(game.player(aggressorId), {
    kind: "declare-national",
    warId,
    aggressorId,
    targetId,
  });
}

function makePeace(game: Game, warId = "r8-national"): void {
  game.performNationalWarCommand(game.player(A), {
    kind: "propose-peace",
    motionId: `r8-motion-${warId}`,
    warId,
  });
  game.performNationalWarCommand(game.player(B), {
    kind: "accept-peace",
    motionId: `r8-motion-${warId}`,
  });
  expect(game.nationalWarAuthority()?.atWar(A, B)).toBe(false);
}

describe("Round Eight actual WAR-09–12 in-flight combat", () => {
  it("WAR-09: live land invasion returns survivors on accepted peace without further territorial conquest", async () => {
    const game = await spawnOnPlains();
    const attacker = game.player(A);
    const defender = game.player(B);
    for (let y = 36; y < 45; y++) {
      for (let x = 36; x < 50; x++) attacker.conquer(game.ref(x, y));
      for (let x = 50; x < 64; x++) defender.conquer(game.ref(x, y));
    }
    game.executeNextTick();
    attacker.setTroops(100_000);
    defender.setTroops(100_000);
    declare(game);
    const assault = new AttackExecution(20_000, attacker, B);
    assault.init(game, game.ticks());
    expect(assault.isActive()).toBe(true);
    const atPeace = defender.numTilesOwned();
    makePeace(game);
    assault.tick(game.ticks());
    expect(assault.isActive()).toBe(false);
    expect(attacker.outgoingAttacks()).toHaveLength(0);
    expect(defender.numTilesOwned()).toBe(atPeace);
    expect(attacker.troops()).toBe(100_000);
  });

  it("WAR-10: an airborne, already purchased missile survives peace, but a new launch is rejected", async () => {
    const game = await spawnOnPlains();
    const attacker = game.player(A);
    const defender = game.player(B);
    attacker.buildUnit(UnitType.MissileSilo, game.ref(25, 25), {});
    declare(game);
    const dst = game.ref(70, 70);
    expect(game.owner(dst)).toBe(defender);
    const airborne = new NukeExecution(UnitType.AtomBomb, attacker, dst);
    game.addExecution(airborne);
    game.executeNextTick();
    game.executeNextTick();
    const firstMissile = airborne.getNuke();
    expect(firstMissile).not.toBeNull();
    expect(airborne.isActive()).toBe(true);
    makePeace(game);
    const oldCount = attacker.units(UnitType.AtomBomb).length;
    const afterPeace = new NukeExecution(UnitType.AtomBomb, attacker, dst);
    game.addExecution(afterPeace);
    game.executeNextTick(); // enqueue/initialize
    game.executeNextTick(); // execute the prohibited post-peace launch
    expect(afterPeace.isActive()).toBe(false);
    expect(afterPeace.getNuke()).toBeNull();
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(oldCount);
    expect(airborne.isActive()).toBe(true);
    const bombLand = vi.spyOn(game.stats(), "bombLand");
    for (let i = 0; i < 300 && airborne.isActive(); i++) game.executeNextTick();
    expect(airborne.isActive()).toBe(false);
    expect(bombLand).toHaveBeenCalled();
    bombLand.mockRestore();
  });

  it("WAR-11: post-peace transport launch spends zero troops and builds no ship", async () => {
    const { game, attacker, targetTile } = await spawnOnIslands();
    const original = attacker.troops();
    const spend = vi.spyOn(attacker, "removeTroops");
    const launch = new TransportShipExecution(attacker, targetTile, 10_000);
    game.addExecution(launch);
    game.executeNextTick();
    expect(launch.isActive()).toBe(false);
    // The normal per-tick regeneration may increase the treasury's real
    // troops; an illegal naval departure itself must debit nothing.
    expect(spend).not.toHaveBeenCalled();
    expect(attacker.troops()).toBeGreaterThanOrEqual(original);
    spend.mockRestore();
    expect(attacker.units(UnitType.TransportShip)).toHaveLength(0);
  });

  it("WAR-11: a committed transport completes one landing, sends all survivors home without inland attacks, and snapshots deterministically", async () => {
    const { game, attacker, defender, targetTile } = await spawnOnIslands();
    declare(game);
    const voyage = new TransportShipExecution(attacker, targetTile, 10_000);
    game.addExecution(voyage);
    game.executeNextTick();
    expect(voyage.isActive()).toBe(true);
    expect(attacker.units(UnitType.TransportShip)).toHaveLength(1);
    const committed = attacker.units(UnitType.TransportShip)[0].troops();
    makePeace(game);
    const defenderAtPeace = new Set([...defender.tiles()]);
    const { bytes, again, restored } = await roundTrip(game, "ocean_and_land");
    expect([...again]).toEqual([...bytes]);
    expect(restored.nationalWarState()).toEqual(game.nationalWarState());
    const troopRefund = vi.spyOn(attacker, "addTroops");
    for (let i = 0; i < 500 && voyage.isActive(); i++) game.executeNextTick();
    expect(voyage.isActive()).toBe(false);
    expect(attacker.units(UnitType.TransportShip)).toHaveLength(0);
    expect(troopRefund).toHaveBeenCalledWith(committed);
    expect(attacker.outgoingAttacks()).toHaveLength(0);
    const lostDefenderTiles = [...defenderAtPeace].filter(
      (tile) => game.owner(tile) !== defender,
    );
    expect(lostDefenderTiles.length).toBeLessThanOrEqual(1);
    troopRefund.mockRestore();
  });

  it("WAR-12: national and empire-wide records survive crown transfer, old emperor cannot negotiate", async () => {
    const game = await spawnOnPlains();
    const sovereign = game.player(A);
    game.performNationalCommand(sovereign, {
      kind: "found-empire",
      empireId: "r8-empire",
    });
    game.performNationalCommand(sovereign, {
      kind: "offer-empire",
      empireId: "r8-empire",
      candidateId: C,
    });
    game.performNationalCommand(game.player(C), {
      kind: "accept-empire",
      empireId: "r8-empire",
      candidateId: C,
    });
    // Member war delegation is not enabled: only the sitting emperor may
    // start a constituent's national war in the default policy.
    game.performNationalWarCommand(sovereign, {
      kind: "declare-national",
      warId: "r8-member-war",
      aggressorId: C,
      targetId: B,
    });
    game.performNationalWarCommand(sovereign, {
      kind: "declare-imperial",
      warId: "r8-empire-war",
      aggressor: { kind: "empire", id: "r8-empire" },
      target: { kind: "nation", id: B },
    });
    const before = game.nationalWarState()!.wars.layers;
    game.performNationalCommand(sovereign, {
      kind: "transfer-crown",
      empireId: "r8-empire",
      successorId: C,
    });
    expect(game.nationalPoliticalAuthority()?.emperorOf("r8-empire")).toBe(C);
    expect(game.nationalWarState()!.wars.layers).toEqual(before);
    expect(() =>
      game.performNationalWarCommand(sovereign, {
        kind: "propose-peace",
        warId: "r8-empire-war",
        motionId: "former-peace",
      }),
    ).toThrow();
    game.performNationalWarCommand(game.player(C), {
      kind: "propose-peace",
      warId: "r8-empire-war",
      motionId: "new-peace",
    });
    game.performNationalWarCommand(game.player(B), {
      kind: "accept-peace",
      motionId: "new-peace",
    });
    expect(game.nationalWarAuthority()?.atWar(A, B)).toBe(false);
    expect(game.nationalWarAuthority()?.atWar(C, B)).toBe(true);
    const { bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
  });
});
