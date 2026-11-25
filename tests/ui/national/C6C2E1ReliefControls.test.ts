// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import type {
  ImperialReliefView,
  NationalImperialAdministrationView,
} from "@openfront/engine-api/game/NationalImperialView";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it } from "vitest";
import "../../../src/client/NationalImperialEconomicControls";
import type { NationalImperialEconomicControls } from "../../../src/client/NationalImperialEconomicControls";
import type { PactReceipt } from "../../../src/client/NationalPactState";
import { SendNationalImperialPolicyIntentEvent } from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";

const row: ImperialReliefView = {
  reliefId: "aid-1",
  empireId: "empire",
  memberId: "member",
  amount: "400",
  status: "pending",
  version: 0,
  decidedBy: null,
};

async function mount(actor = "member") {
  const state = {
    actor,
    leader: "emperor",
    tick: 20,
    wallet: 100n,
    treasury: "500",
    rows: [] as ImperialReliefView[],
    receipts: [] as PactReceipt[],
    replay: false,
    spectator: false,
    national: true,
    gameId: "game",
  };
  const view = {
    config: () => ({
      gameConfig: () => ({
        nationalMode: state.national,
        gameType: GameType.Singleplayer,
      }),
      isReplay: () => state.replay,
    }),
    myPlayer: () => ({
      id: () => state.actor,
      isAlive: () => true,
      hasSpawned: () => true,
      gold: () => state.wallet,
    }),
    players: () => [],
    isSpectator: () => state.spectator,
    inSpawnPhase: () => false,
    nationalPoliticsTick: () => state.tick,
    nationalPolitics: () => ({
      empires: [
        {
          id: "empire",
          leaderId: state.leader,
          memberIds: ["emperor", "member"],
        },
      ],
    }),
    nationalImperialAdministration: (): NationalImperialAdministrationView => ({
      empireId: "empire",
      canAmend: state.actor === state.leader,
      workerIncomeBps: 10000,
      allowedConstruction: null,
      treasury: state.treasury,
      reliefRequests: state.rows,
    }),
    nationalPactReceipts: () => state.receipts,
    ticks: () => state.tick,
    gameID: () => state.gameId,
  } as unknown as GameView;
  const bus = new EventBus();
  const sent: SendNationalImperialPolicyIntentEvent[] = [];
  bus.on(SendNationalImperialPolicyIntentEvent, (event) => sent.push(event));
  const element = document.createElement(
    "national-imperial-economic-controls",
  ) as NationalImperialEconomicControls;
  element.game = view;
  element.eventBus = bus;
  document.body.appendChild(element);
  element.refresh();
  await element.updateComplete;
  return { state, sent, element };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("C6C2-E1-NATIVE-IMPERIAL native relief controls", () => {
  it("emits a bounded native member request once without changing the wallet", async () => {
    const { state, sent, element } = await mount();
    const form = element.querySelector("form")!;
    form.querySelector<HTMLInputElement>('input[name="amount"]')!.value = "400";
    form.querySelector<HTMLInputElement>('input[name="confirm"]')!.checked =
      true;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(sent).toHaveLength(1);
    const intent = sent[0].intent;
    expect(intent).toMatchObject({
      type: "national_imperial_administration",
      command: {
        kind: "request-relief",
        empireId: "empire",
        amount: "400",
      },
    });
    if (intent.type !== "national_imperial_administration")
      throw new Error("wrong native intent");
    expect(intent.command).toMatchObject({ reliefId: intent.requestId });
    expect(state.wallet).toBe(100n);
    state.rows = [{ ...row, reliefId: intent.requestId }];
    state.tick++;
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain(
      "Awaiting the Game-owned relief receipt",
    );
    state.receipts = [
      {
        type: "national_imperial_administration",
        actorId: "member",
        recipientId: "member",
        requestId: intent.requestId,
        commandTargetId: "empire",
        tick: state.tick,
        sequence: 1,
        accepted: true,
        reason: "accepted",
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("Game recorded the relief request");
    expect(state.wallet).toBe(100n);
  });

  it("requires live authority and exact receipt plus row; never invents a transfer", async () => {
    const { state, sent, element } = await mount("emperor");
    state.rows = [row, { ...row, reliefId: "self", memberId: "emperor" }];
    element.refresh();
    await element.updateComplete;
    expect(element.querySelectorAll("[data-relief-approve]")).toHaveLength(1);
    const approve = element.querySelector<HTMLButtonElement>(
      "[data-relief-approve]",
    )!;
    approve.click();
    approve.click();
    expect(sent).toHaveLength(1);
    expect(sent[0].intent).toMatchObject({
      type: "national_imperial_administration",
      command: {
        kind: "decide-relief",
        reliefId: "aid-1",
        expectedVersion: 0,
        decision: "approve",
      },
    });
    expect(state.treasury).toBe("500");
    const intent = sent[0].intent;
    if (intent.type !== "national_imperial_administration")
      throw new Error("wrong native intent");
    state.tick++;
    state.receipts = [
      {
        type: "national_imperial_administration",
        actorId: "emperor",
        recipientId: "emperor",
        requestId: intent.requestId,
        commandTargetId: "empire",
        tick: state.tick,
        sequence: 1,
        accepted: true,
        reason: "accepted",
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).not.toContain(
      "Game confirmed the relief decision",
    );
    state.rows = [
      { ...row, status: "approved", version: 1, decidedBy: "emperor" },
    ];
    state.treasury = "100";
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("Game confirmed the relief decision");
    expect(element.textContent).toContain("Game treasury: 100 gold");
    expect(state.wallet).toBe(100n);
  });

  it("hides foreign requests and refuses stale crown buttons, spectator and replay", async () => {
    const { state, sent, element } = await mount("emperor");
    state.rows = [row];
    element.refresh();
    await element.updateComplete;
    const stale = element.querySelector<HTMLButtonElement>(
      "[data-relief-approve]",
    )!;
    state.leader = "member";
    stale.click();
    expect(sent).toHaveLength(0);
    state.actor = "outsider";
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toBe("");
    state.actor = "emperor";
    element.refresh();
    await element.updateComplete;
    expect(element.querySelector("[data-relief-id]")).toBeNull();
    state.replay = true;
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toBe("");
    state.replay = false;
    state.spectator = true;
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toBe("");
  });
});
