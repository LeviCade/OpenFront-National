// @vitest-environment jsdom
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
import { EventBus } from "@openfront/shared/EventBus";
import "../../../src/client/NationalImperialEconomicControls";
import type { NationalImperialEconomicControls } from "../../../src/client/NationalImperialEconomicControls";
import { readPactReceipts } from "../../../src/client/NationalPactState";
import { SendNationalImperialPolicyIntentEvent } from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";
import {
  reliefIntent,
  type ReliefCommand,
} from "../../../src/client/NationalImperialReliefControls";
import { setup } from "../../util/Setup";
import { roundTrip } from "../../util/Snapshot";

const [memberId, emperorId, outsiderId] = [
  "E1Member",
  "E1Emperor",
  "E1Outsider",
];
const empireId = "E1Empire";
const map = "half_land_half_ocean";
const roster = [memberId, emperorId, outsiderId].map(
  (id, index) => new PlayerInfo(id, PlayerType.Human, "E1CLIENT" + index, id),
);
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

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
    const workers = vi
      .spyOn(game.config(), "goldAdditionRate")
      .mockReturnValue(0n);
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
    const mount = async (actor: typeof member) => {
      const bus = new EventBus();
      const sent: SendNationalImperialPolicyIntentEvent[] = [];
      bus.on(SendNationalImperialPolicyIntentEvent, (event) => sent.push(event));
      const view = {
        config: () => game.config(),
        myPlayer: () => actor,
        players: () => [member, emperor, outsider],
        isSpectator: () => false,
        inSpawnPhase: () => false,
        nationalPolitics: () => game.nationalPublicPoliticalView(),
        nationalPoliticsTick: () => game.ticks(),
        nationalImperialAdministration: () => game.nationalImperialAdministrationFor(actor),
        nationalPactReceipts: () => readPactReceipts(game.nationalPoliticalCommandResults(actor).map((row) => ({ ...row, type: "national_imperial_administration" })), actor.id(), game.ticks()),
        ticks: () => game.ticks(),
        gameID: () => "E1Match",
      } as unknown as GameView;
      const element = document.createElement("national-imperial-economic-controls") as NationalImperialEconomicControls;
      element.game = view;
      element.eventBus = bus;
      document.body.appendChild(element);
      element.refresh();
      await element.updateComplete;
      return { element, sent };
    };
    const memberUI = await mount(member);
    const emperorUI = await mount(emperor);
    const outsiderUI = await mount(outsider);
    expect(outsiderUI.element.textContent).toBe("");
    const form = memberUI.element.querySelector("form")!;
    form.querySelector<HTMLInputElement>('input[name="amount"]')!.value = grant.toString();
    form.querySelector<HTMLInputElement>('input[name="confirm"]')!.checked = true;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(memberUI.sent).toHaveLength(1);
    const memberClick = memberUI.sent[0].intent;
    if (memberClick.type !== "national_imperial_administration") throw Error("unexpected member intent");
    const requestId = memberClick.requestId!;
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
    expect(memberClick.command).toEqual(request);
    runner.addTurn({ turnNumber: turnNumber++, intents: [StampedIntentSchema.parse({ ...memberClick, clientID: member.clientID() })] });
    expect(runner.executeNextTick()).toBe(true);
    game.executeNextTick();
    memberUI.element.refresh();
    emperorUI.element.refresh();
    outsiderUI.element.refresh();
    await Promise.all([memberUI.element.updateComplete, emperorUI.element.updateComplete, outsiderUI.element.updateComplete]);
    expect(memberUI.element.textContent).toContain("Game recorded the relief request");
    expect(outsiderUI.element.textContent).toBe("");
    expect(
      game.nationalImperialAdministrationFor(member)?.reliefRequests[0]?.status,
    ).toBe("pending");
    expect(game.nationalImperialAdministrationFor(outsider)).toBeNull();
    submit(outsiderId, decide, "np_" + "3".repeat(32));
    expect(treasury()).toBe(grant + 19n);
    expect(member.gold()).toBe(0n);
    emperorUI.element.refresh();
    await emperorUI.element.updateComplete;
    emperorUI.element.querySelector<HTMLButtonElement>("[data-relief-approve]")!.click();
    expect(emperorUI.sent).toHaveLength(1);
    const emperorClick = emperorUI.sent[0].intent;
    if (emperorClick.type !== "national_imperial_administration") throw Error("unexpected emperor intent");
    expect(emperorClick.command).toEqual(decide);
    runner.addTurn({ turnNumber: turnNumber++, intents: [StampedIntentSchema.parse({ ...emperorClick, clientID: emperor.clientID() })] });
    expect(runner.executeNextTick()).toBe(true);
    game.executeNextTick();
    memberUI.element.refresh();
    emperorUI.element.refresh();
    await Promise.all([memberUI.element.updateComplete, emperorUI.element.updateComplete]);
    expect(emperorUI.element.textContent).toContain("Game confirmed the relief decision");
    expect(memberUI.element.textContent).toContain("Game wallet: " + grant.toString() + " gold");
    expect(treasury()).toBe(19n);
    expect(member.gold()).toBe(grant);
    expect(
      game.nationalImperialAdministrationFor(member)?.reliefRequests[0]?.status,
    ).toBe("approved");
    submit(emperorId, decide, "np_" + "4".repeat(32));
    expect(treasury()).toBe(19n);
    expect(member.gold()).toBe(grant);
    const placement = member.canBuild(UnitType.City, tile);
    if (placement === false) throw new Error("no lawful City placement");
    runner.addTurn({
      turnNumber: turnNumber++,
      intents: [StampedIntentSchema.parse({ type: "build_unit", unit: UnitType.City, tile: placement, clientID: member.clientID() })],
    });
    expect(runner.executeNextTick()).toBe(true);
    game.executeNextTick();
    const structure = member.units(UnitType.City).find((unit) => unit.tile() === placement);
    expect(structure?.owner()).toBe(member);
    expect(member.gold()).toBe(37n);
    expect(treasury()).toBe(19n);
    const secondRequest = "np_" + "5".repeat(32);
    submit(memberId, { ...request, reliefId: secondRequest, amount: "10" }, secondRequest);
    game.performNationalCommand(emperor, { kind: "transfer-crown", empireId, successorId: memberId });
    const staleDecision = { ...decide, reliefId: secondRequest };
    submit(emperorId, staleDecision, "np_" + "6".repeat(32));
    submit(memberId, staleDecision, "np_" + "7".repeat(32));
    expect(BigInt(game.nationalImperialAdministrationFor(member)!.treasury)).toBe(19n);
    expect(member.gold()).toBe(37n);
    expect(game.nationalImperialAdministrationFor(member)?.reliefRequests.find((item) => item.reliefId === secondRequest)?.status).toBe("pending");
    const { restored, bytes, again } = await roundTrip(game, map);
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    console.info(
      "C6C2_E1_RELIEF_WITNESS=" +
        JSON.stringify({
          treasuryBefore: (grant + 19n).toString(),
          grant: grant.toString(),
          treasuryAfter: treasury().toString(),
          staleCrownAndSelfApprovalRejected: true,
          actualMemberAndEmperorDOM: true,
          cityCost: cost.toString(),
          walletAfterConstruction: member.gold().toString(),
          snapshotBytes: bytes.length,
        }),
    );
  });
});
