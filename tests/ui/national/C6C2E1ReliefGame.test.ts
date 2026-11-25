import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  reliefIntent,
  type ReliefCommand,
} from "../../../src/client/NationalImperialReliefControls";
import { setup } from "../../util/Setup";
import { roundTrip } from "../../util/Snapshot";

const [memberId, emperorId, outsiderId] = ["E1Member", "E1Emperor", "E1Outsider"];
const empireId = "E1Empire";
const map = "half_land_half_ocean";
const roster = [memberId, emperorId, outsiderId].map(
  (id, index) => new PlayerInfo(id, PlayerType.Human, "E1CLIENT" + index, id),
);
const requestId = "np_" + "1".repeat(32);
const decisionId = "np_" + "2".repeat(32);

afterEach(() => vi.restoreAllMocks());

describe("C6C2-E1-NATIVE-IMPERIAL real client intent to GameRunner", () => {
  it("uses the native request builder, real worker treasury, stamped decision, member-funded City and snapshot", async () => {
    const game = await setup(
      map,
      { nationalMode: true, instantBuild: true },
      roster,
    );
    roster.forEach((info, index) => {
      const player = game.player(info.id);
      const tile = game.ref(1, 1 + index * 4);
      player.conquer(tile);
      player.setSpawnTile(tile);
    });
    game.executeNextTick();
    const workers = vi.spyOn(game.config(), "goldAdditionRate").mockReturnValue(0n);
    const emperor = game.player(emperorId);
    const member = game.player(memberId);
    const outsider = game.player(outsiderId);
    game.performNationalCommand(emperor, { kind: "found-empire", empireId });
    game.performNationalCommand(emperor, {
      kind: "offer-empire",
      empireId,
      candidateId: memberId,
    });
    game.performNationalCommand(member, {
      kind: "accept-empire",
      empireId,
      candidateId: memberId,
    });
    game.performNationalImperialAdministration(emperor, {
      kind: "set-policy",
      empireId,
      policy: { workerIncomeBps: 10000, allowedConstruction: null },
    });
    member.removeGold(member.gold());
    const tile = game.ref(1, 13);
    member.conquer(tile);
    const cost = game.unitInfo(UnitType.City).cost(game, member);
    const grant = cost + 37n;
    workers.mockReturnValue(grant + 19n);
    const worker = new PlayerExecution(member);
    worker.init(game, game.ticks());
    worker.tick(game.ticks());
    workers.mockReturnValue(0n);
    const treasury = () =>
      BigInt(game.nationalImperialAdministrationFor(emperor)!.treasury);
    expect(treasury()).toBe(grant + 19n);
    expect(member.gold()).toBe(0n);
    const runner = new GameRunner(
      game,
      new Executor(game, "E1Match", undefined),
      () => {},
    );
    let turnNumber = 0;
    const submit = (id: string, command: ReliefCommand, click: string) => {
      const intent = reliefIntent(command, click);
      expect(intent).not.toBeNull();
      runner.addTurn({
        turnNumber: turnNumber++,
        intents: [
          StampedIntentSchema.parse({
            ...intent,
            clientID: game.player(id).clientID(),
          }),
        ],
      });
      expect(runner.executeNextTick()).toBe(true);
      game.executeNextTick();
    };
    const request: ReliefCommand = {
      kind: "request-relief",
      empireId,
      reliefId: requestId,
      amount: grant.toString(),
    };
    const decide: ReliefCommand = {
      kind: "decide-relief",
      empireId,
      reliefId: requestId,
      expectedVersion: 0,
      decision: "approve",
    };
    submit(memberId, request, requestId);
    expect(game.nationalImperialAdministrationFor(member)?.reliefRequests[0]?.status).toBe("pending");
    expect(game.nationalImperialAdministrationFor(outsider)).toBeNull();
    submit(outsiderId, decide, "np_" + "3".repeat(32));
    expect(treasury()).toBe(grant + 19n);
    expect(member.gold()).toBe(0n);
    submit(emperorId, decide, decisionId);
    expect(treasury()).toBe(19n);
    expect(member.gold()).toBe(grant);
    expect(game.nationalImperialAdministrationFor(member)?.reliefRequests[0]?.status).toBe("approved");
    submit(emperorId, decide, "np_" + "4".repeat(32));
    expect(treasury()).toBe(19n);
    expect(member.gold()).toBe(grant);
    const placement = member.canBuild(UnitType.City, tile);
    if (placement === false) throw new Error("no lawful City placement");
    const structure = member.buildUnit(UnitType.City, placement, {});
    expect(structure.owner()).toBe(member);
    expect(member.gold()).toBe(37n);
    expect(treasury()).toBe(19n);
    const { restored, bytes, again } = await roundTrip(game, map);
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    console.info("C6C2_E1_RELIEF_WITNESS=" + JSON.stringify({
      treasuryBefore: (grant + 19n).toString(),
      grant: grant.toString(),
      treasuryAfter: treasury().toString(),
      cityCost: cost.toString(),
      walletAfterConstruction: member.gold().toString(),
      snapshotBytes: bytes.length,
    }));
  });
});
