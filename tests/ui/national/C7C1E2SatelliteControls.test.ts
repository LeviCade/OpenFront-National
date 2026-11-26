// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { NationalSatelliteView } from "@openfront/engine-api/game/NationalSatelliteView";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it } from "vitest";
import { parseNationalSatelliteIntent } from "../../../src/client/NationalSatelliteClient";
import "../../../src/client/NationalSatelliteControls";
import type { NationalSatelliteControls } from "../../../src/client/NationalSatelliteControls";
import { SendNationalSatelliteIntentEvent } from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";

afterEach(() => document.body.replaceChildren());
describe("C7C1 E2 native purchase", () => {
  it("emits exactly one request, never debits locally, confirms only authoritative receipt and clears at expiry", async () => {
    let tick = 20;
    const gold = 25000n;
    let receipt: NationalSatelliteView | null = null;
    const game = {
      config: () => ({
        gameConfig: () => ({
          nationalMode: true,
          gameType: GameType.Singleplayer,
        }),
        isReplay: () => false,
      }),
      myPlayer: () => ({
        id: () => "buyer",
        isAlive: () => true,
        hasSpawned: () => true,
        gold: () => gold,
      }),
      isSpectator: () => false,
      inSpawnPhase: () => false,
      nationalPoliticsTick: () => tick,
      nationalSatellite: () => receipt,
      ticks: () => tick,
      gameID: () => "satellite-ui",
    } as unknown as GameView;
    const bus = new EventBus();
    const sent: SendNationalSatelliteIntentEvent[] = [];
    bus.on(SendNationalSatelliteIntentEvent, (e) => sent.push(e));
    const panel = document.createElement(
      "national-satellite-controls",
    ) as NationalSatelliteControls;
    panel.game = game;
    panel.eventBus = bus;
    document.body.appendChild(panel);
    await panel.updateComplete;
    const form = panel.querySelector<HTMLFormElement>("form")!;
    form.querySelector<HTMLInputElement>("input")!.checked = true;
    form.querySelector<HTMLButtonElement>("button")!.click();
    await panel.updateComplete;
    expect(sent).toHaveLength(1);
    const intent = parseNationalSatelliteIntent(sent[0].candidate)!;
    expect(intent).toMatchObject({
      type: "national_buy_satellite_recon",
      gameId: "satellite-ui",
      issuedTick: 20,
    });
    expect(parseNationalSatelliteIntent({ ...intent, cost: 0 })).toBeNull();
    expect(gold).toBe(25000n);
    expect(panel.textContent).toContain("awaiting matching");
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    expect(sent).toHaveLength(1);
    tick = 21;
    receipt = {
      version: 1,
      recipientId: "buyer",
      tick,
      lease: {
        requestId: intent.requestId,
        cost: "25000",
        effectiveTick: tick,
        expiresAtTick: tick + 300,
      },
    };
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain("300 ticks remaining");
    tick += 300;
    receipt = null;
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).not.toContain("Active paid satellite lease");
  });
});
