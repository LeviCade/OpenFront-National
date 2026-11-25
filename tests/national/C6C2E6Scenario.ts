import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType, type GameUpdateViewData, type WinUpdate } from "@openfront/engine-api/game/GameUpdates";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { expect, vi } from "vitest";
import { setup } from "../util/Setup";
import { TestConfig } from "../util/TestConfig";

export const EMPIRE = "c6c2-e6-empire";
const MATCH = "C6C2E6WIN";
export const infos = Array.from({ length: 9 }, (_, i) =>
  new PlayerInfo("Nation " + i, PlayerType.Human, "E6SEAT00" + i, "E6NATION" + i),
);
export const [A, B, C, , , , , , I] = infos.map((p) => p.id);
const spots = [[25,25],[55,20],[20,50],[50,50],[80,50],[20,80],[50,80],[80,80],[63,20]];

export async function scenario(independent = false) {
  const seats = independent ? [infos[1], infos[8]] : infos;
  const game = await setup("plains", { nationalMode: true }, seats, undefined, TestConfig);
  let packet: GameUpdateViewData | undefined;
  const errors: string[] = [];
  const wins: WinUpdate[] = [];
  const realTick = game.executeNextTick.bind(game);
  vi.spyOn(game, "executeNextTick").mockImplementation(() => {
    const updates = realTick();
    wins.push(...(updates[GameUpdateType.Win] ?? []));
    return updates;
  });
  const runner = new GameRunner(game, new Executor(game, MATCH, undefined), (p) => {
    if ("errMsg" in p) errors.push(String(p.errMsg));
    else packet = p;
  }, undefined);
  const tick = (...commands: Record<string, unknown>[]) => {
    runner.addTurn({ turnNumber: game.ticks(), intents: commands.map((c) => StampedIntentSchema.parse(c)) });
    expect(runner.executeNextTick()).toBe(true);
    expect(errors).toEqual([]);
    expect(packet).toBeDefined();
    return packet!;
  };
  const wait = (n: number) => { for (let i = 0; i < n; i++) tick(); };
  const send = (actor: string, command: Record<string, unknown>) => {
    tick({ ...command, clientID: infos.find((p) => p.id === actor)!.clientID! });
    return tick();
  };
  runner.init();
  for (const seat of seats) {
    const [x,y] = spots[infos.indexOf(seat)];
    game.addExecution(new SpawnExecution(MATCH, seat, game.ref(x,y)));
  }
  wait(3);
  for (const seat of seats) expect(game.player(seat.id).hasSpawned()).toBe(true);
  expect(game.getWinner()).toBeNull();
  const transfer = (actor: string, successor: string, requestId = "e6-transfer") =>
    send(actor, { type: "national_transfer_crown", empireId: EMPIRE, successorId: successor, requestId });
  if (!independent) {
    send(A, { type: "national_found_empire", empireId: EMPIRE, requestId: "e6-found" });
    for (const seat of infos.slice(1,8)) {
      send(A, { type: "national_offer_empire", empireId: EMPIRE, candidateId: seat.id, requestId: "offer-" + seat.id });
      send(seat.id, { type: "national_accept_empire", empireId: EMPIRE, candidateId: seat.id, requestId: "accept-" + seat.id });
    }
    expect(game.nationalPoliticalAuthority()?.membersOf(EMPIRE)).toHaveLength(8);
    // Establish an eight-metric deficit using real Player and Unit state.
    const weak = game.player(A);
    for (const tile of [...weak.tiles()].slice(1)) weak.relinquish(tile);
    weak.setTroops(1);
    for (const seat of infos.slice(1,8)) {
      const strong = game.player(seat.id);
      strong.setTroops(1_000_000);
      strong.addGold(50_000_000n);
      const tile = [...strong.tiles()][0];
      for (const [type, params] of [
        [UnitType.City, {}], [UnitType.Factory, {}], [UnitType.Port, {}],
        [UnitType.MissileSilo, {}], [UnitType.Warship, { patrolTile: tile }],
      ] as const) strong.buildUnit(type, tile, params).setUnderConstruction(false);
    }
    tick();
    expect(game.nationalUngovernableWarnings()).toHaveLength(1);
  }
  const conquer = () => {
    const attacker = game.player(B);
    const rival = game.player(I);
    expect(attacker.sharesBorderWith(rival)).toBe(true);
    send(B, {
      type: "national_declare_war", nationId: B, targetId: I,
      targetKind: "nation", scope: independent ? "national" : "imperial",
      requestId: "e6-final-war",
    });
    attacker.setTroops(100_000);
    rival.setTroops(1);
    send(B, { type: "attack", targetID: I, troops: 5_000 });
    for (let n = 0; n < 200 && (rival.isAlive() || game.getWinner() === null); n++) tick();
    expect(rival.isAlive()).toBe(false);
    expect(game.getWinner()).not.toBeNull();
    expect(wins).toHaveLength(1);
    expect(game.numLandTiles()).toBeGreaterThan(game.players().reduce((sum,p) => sum+p.numTilesOwned(),0));
    return packet!;
  };
  return { game, wins, tick, wait, send, transfer, conquer, packet: () => packet! };
}
