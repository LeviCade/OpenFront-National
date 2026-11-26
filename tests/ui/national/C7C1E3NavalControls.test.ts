// @vitest-environment jsdom
import {
  GameType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { readNationalImperialAdministration } from "@openfront/engine-api/game/NationalImperialView";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { GameRunner } from "@openfront/engine/GameRunner";
import { projectNationalImperialAdministration } from "@openfront/engine/national/observation/NationalPactProjection";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it } from "vitest";
import "../../../src/client/NationalImperialNavalControls";
import type { NationalImperialNavalControls } from "../../../src/client/NationalImperialNavalControls";
import { readPactReceipts } from "../../../src/client/NationalPactState";
import { SendNationalImperialPolicyIntentEvent } from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";
import { setup } from "../../util/Setup";

const [A, B, C] = ["navy0001", "navy0002", "navy0003"];
const empireId = "naval-crown";
const gameId = "naval-01";

afterEach(() => {
  document.body.replaceChildren();
});

describe("C7C1 E3 native imperial naval orders", () => {
  it("selects a real member hull and launches a real pooled expedition through native forms and GameRunner", async () => {
    const game = await setup(
      "half_land_half_ocean",
      { nationalMode: true, instantBuild: true },
      [A, B, C].map((id) => new PlayerInfo(id, PlayerType.Human, id, id)),
    );
    const [a, b, c] = [A, B, C].map((id, index) => {
      const player = game.player(id);
      const tile = game.ref(7, 2 + index * 6);
      player.conquer(tile);
      player.setSpawnTile(tile);
      player.addGold(1_000_000_000n);
      player.buildUnit(UnitType.Port, tile, {});
      return player;
    });
    a.setTroops(400);
    b.setTroops(900);
    c.setTroops(20);
    game.executeNextTick();
    game.performNationalCommand(a, { kind: "found-empire", empireId });
    game.performNationalCommand(a, {
      kind: "offer-empire",
      empireId,
      candidateId: B,
    });
    game.performNationalCommand(b, {
      kind: "accept-empire",
      empireId,
      candidateId: B,
    });
    game.performNationalImperialAdministration(a, {
      kind: "set-army-mode",
      empireId,
      mode: "centralized",
      thresholdBps: 0,
    });
    game.performNationalWarCommand(a, {
      kind: "declare-imperial",
      warId: "native-war",
      aggressor: { kind: "empire", id: empireId },
      target: { kind: "nation", id: C },
    });
    const start = game.ref(8, 8);
    const destination = game.ref(9, 8);
    const hull = b.buildUnit(UnitType.Warship, start, { patrolTile: start });
    const foreign = c.buildUnit(UnitType.Warship, game.ref(8, 14), {
      patrolTile: game.ref(8, 14),
    });
    const runner = new GameRunner(
      game,
      new Executor(game, gameId, A),
      () => {},
      A,
    );
    const submit = (event: SendNationalImperialPolicyIntentEvent) => {
      runner.addTurn({
        turnNumber: game.ticks(),
        intents: [StampedIntentSchema.parse({ ...event.intent, clientID: A })],
      });
      expect(runner.executeNextTick()).toBe(true);
      runner.addTurn({ turnNumber: game.ticks(), intents: [] });
      expect(runner.executeNextTick()).toBe(true);
    };
    const packet = (actor: string) =>
      projectNationalImperialAdministration(
        game,
        actor,
        game.nationalPublicPoliticalView(),
        game.ticks(),
        "stream",
      );
    expect(packet(A)?.warPolicyVersion).toBe(0);
    expect(packet(B)).not.toHaveProperty("warPolicyVersion");
    expect(packet(C)).toBeUndefined();
    const crownPacket = packet(A)!;
    expect(
      readNationalImperialAdministration(
        { ...crownPacket, recipientId: B, canAmend: false },
        game.nationalPublicPoliticalView(),
        B,
        game.ticks(),
        "stream",
      ),
    ).toBeNull();
    const mount = async (actor: typeof a) => {
      const bus = new EventBus();
      const sent: SendNationalImperialPolicyIntentEvent[] = [];
      bus.on(SendNationalImperialPolicyIntentEvent, (event) =>
        sent.push(event),
      );
      const view = {
        config: () => ({
          gameConfig: () => ({
            nationalMode: true,
            gameType: GameType.Singleplayer,
          }),
          isReplay: () => false,
        }),
        myPlayer: () => actor,
        players: () => [a, b, c],
        units: () => [hull, foreign],
        isSpectator: () => false,
        inSpawnPhase: () => false,
        nationalPolitics: () => game.nationalPublicPoliticalView(),
        nationalPoliticsTick: () => game.ticks(),
        nationalImperialAdministration: () =>
          readNationalImperialAdministration(
            packet(actor.id()),
            game.nationalPublicPoliticalView(),
            actor.id(),
            game.ticks(),
            "stream",
          ),
        nationalPactReceipts: () =>
          readPactReceipts(
            game.nationalPoliticalCommandResults(actor).map((row) => ({
              ...row,
              type: "national_imperial_administration",
            })),
            actor.id(),
            game.ticks(),
          ),
        nationalReceiptStreamId: () => "stream",
        ticks: () => game.ticks(),
        gameID: () => gameId,
        isValidCoord: (x: number, y: number) => game.isValidCoord(x, y),
        ref: (x: number, y: number) => game.ref(x, y),
        isWater: (tile: number) => game.isWater(tile),
        isLand: (tile: number) => game.isLand(tile),
        owner: (tile: number) => game.owner(tile),
      } as unknown as GameView;
      const element = document.createElement(
        "national-imperial-naval-controls",
      ) as NationalImperialNavalControls;
      element.game = view;
      element.eventBus = bus;
      document.body.appendChild(element);
      element.refresh();
      await element.updateComplete;
      return { element, sent };
    };
    const crown = await mount(a);
    const member = await mount(b);
    const outsider = await mount(c);
    expect(member.element.querySelector("form")).toBeNull();
    expect(outsider.element.querySelector("form")).toBeNull();
    const [moveForm, launchForm] = crown.element.querySelectorAll("form");
    const put = (form: HTMLFormElement, name: string, value: string) => {
      form.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[name="${name}"]`,
      )!.value = value;
    };
    expect(
      moveForm.querySelector(`option[value="${foreign.id()}"]`),
    ).toBeNull();
    put(moveForm, "hull", String(hull.id()));
    put(moveForm, "x", "9");
    put(moveForm, "y", "8");
    moveForm.dispatchEvent(new Event("submit", { cancelable: true }));
    moveForm.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(crown.sent).toHaveLength(1);
    expect(hull.warshipState().patrolTile).toBe(start);
    expect(crown.sent[0].intent).toMatchObject({
      command: {
        kind: "imperial-move-warship",
        memberId: B,
        unitId: hull.id(),
        tile: destination,
        expectedVersion: 0,
        gameId,
      },
    });
    submit(crown.sent[0]);
    expect(hull.warshipState().patrolTile).toBe(destination);
    crown.element.refresh();
    await crown.element.updateComplete;
    expect(crown.element.textContent).toContain("Game accepted the order");
    put(launchForm, "member", B);
    put(launchForm, "x", "7");
    put(launchForm, "y", "14");
    put(launchForm, "amount", "200");
    launchForm.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(crown.sent).toHaveLength(2);
    expect(game.nationalImperialAdministrationFor(a)?.imperialTroops).toBe(
      "1300",
    );
    submit(crown.sent[1]);
    expect(b.units(UnitType.TransportShip)[0].troops()).toBe(200);
    expect(game.nationalImperialAdministrationFor(a)?.imperialTroops).toBe(
      "1100",
    );
    crown.element.refresh();
    await crown.element.updateComplete;
    expect(crown.element.textContent).toContain(
      "Imperial reserve: 1100 troops",
    );
    game.performNationalCommand(a, {
      kind: "transfer-crown",
      empireId,
      successorId: B,
    });
    launchForm.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(crown.sent).toHaveLength(2);
    crown.element.refresh();
    member.element.refresh();
    await Promise.all([
      crown.element.updateComplete,
      member.element.updateComplete,
    ]);
    expect(crown.element.querySelector("form")).toBeNull();
    expect(member.element.querySelector("form")).not.toBeNull();
    expect(packet(B)?.warPolicyVersion).toBe(1);
  });
});
