// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import {
  readNationalSettlementView,
  type NationalSettlementRow,
  type NationalSettlementView,
} from "@openfront/engine-api/game/NationalSettlementView";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it } from "vitest";
import "../../../src/client/NationalImperialSettlementControls";
import type { NationalImperialSettlementControls } from "../../../src/client/NationalImperialSettlementControls";
import {
  settlementDecisionIntent,
  settlementOfferIntent,
} from "../../../src/client/NationalImperialSettlementIntentControls";
import { SendNationalSettlementIntentEvent } from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";

const payerRow: NationalSettlementRow = {
  sanctionId: "sanction-1",
  payerId: "payer",
  issuerId: "issuer",
  role: "payer",
  canOffer: true,
  canAccept: false,
  canRefuse: false,
  tradePermitted: false,
  offer: null,
  lastPaidCommerce: null,
};
const issuerRow: NationalSettlementRow = {
  ...payerRow,
  role: "issuer",
  canOffer: false,
  canAccept: true,
  canRefuse: true,
  offer: {
    requestId: "offer-1",
    gold: "50",
    offeredAt: 20,
    expiresAt: 140,
    status: "pending",
  },
};
const packet = (
  actor: string,
  tick: number,
  items: NationalSettlementRow[],
  streamId?: string,
): NationalSettlementView => ({
  version: 1,
  recipientId: actor,
  tick,
  paidMaritimeGold: "411",
  items,
  ...(streamId === undefined ? {} : { streamId }),
});

async function mount(actor: string, row: NationalSettlementRow) {
  const state = {
    actor,
    tick: 20,
    rows: [row],
    wallet: 100n,
    replay: false,
    spectator: false,
    gameId: "game",
  };
  const game = {
    config: () => ({
      gameConfig: () => ({
        nationalMode: true,
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
    isSpectator: () => state.spectator,
    inSpawnPhase: () => false,
    nationalPoliticsTick: () => state.tick,
    ticks: () => state.tick,
    gameID: () => state.gameId,
    nationalSettlements: () =>
      readNationalSettlementView(
        packet(actor, state.tick, state.rows),
        state.actor,
        state.tick,
      ),
  } as unknown as GameView;
  const bus = new EventBus();
  const sent: SendNationalSettlementIntentEvent[] = [];
  bus.on(SendNationalSettlementIntentEvent, (event) => sent.push(event));
  const element = document.createElement(
    "national-imperial-settlement-controls",
  ) as NationalImperialSettlementControls;
  element.game = game;
  element.eventBus = bus;
  document.body.appendChild(element);
  element.refresh();
  await element.updateComplete;
  return { element, state, sent };
}
afterEach(() => document.body.replaceChildren());

describe("C6C2-E1 settlement view and native commands", () => {
  it("rejects wrong seat, stream, tick, duplicated rows, forged wallet and incoherent authority", () => {
    const good = packet("issuer", 20, [issuerRow], "stream");
    expect(readNationalSettlementView(good, "issuer", 20, "stream")).toEqual(
      good,
    );
    expect(
      readNationalSettlementView(good, "outsider", 20, "stream"),
    ).toBeNull();
    expect(readNationalSettlementView(good, "issuer", 19, "stream")).toBeNull();
    expect(readNationalSettlementView(good, "issuer", 20, "other")).toBeNull();
    expect(readNationalSettlementView(good, "issuer", 20, null)).toBeNull();
    expect(
      readNationalSettlementView(
        { ...good, items: [issuerRow, issuerRow] },
        "issuer",
        20,
        "stream",
      ),
    ).toBeNull();
    expect(
      readNationalSettlementView(
        { ...good, items: [{ ...issuerRow, wallet: "999" }] },
        "issuer",
        20,
        "stream",
      ),
    ).toBeNull();
    expect(
      readNationalSettlementView(
        packet("payer", 20, [{ ...payerRow, canAccept: true }]),
        "payer",
        20,
      ),
    ).toBeNull();
    expect(
      settlementOfferIntent(payerRow, "outsider", 100n, "50", "request"),
    ).toBeNull();
    expect(
      settlementOfferIntent(payerRow, "payer", 100n, "101", "request"),
    ).toBeNull();
    expect(
      settlementDecisionIntent(issuerRow, "issuer", 140, "accept", "request"),
    ).toBeNull();
    expect(
      settlementDecisionIntent(issuerRow, "outsider", 20, "accept", "request"),
    ).toBeNull();
  });

  it("submits an explicitly funded offer once and waits for its exact Game row", async () => {
    const { element, state, sent } = await mount("payer", payerRow);
    const form = element.querySelector("form")!;
    const amount = form.querySelector<HTMLInputElement>(
      'input[name="amount"]',
    )!;
    form.querySelector<HTMLInputElement>('input[name="confirm"]')!.checked =
      true;
    amount.value = "101";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(sent).toHaveLength(0);
    amount.value = "50";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(sent).toHaveLength(1);
    const intent = sent[0].intent;
    expect(intent).toMatchObject({
      type: "national_offer_sanction_settlement",
      sanctionId: "sanction-1",
      amountGold: "50",
    });
    if (intent.type !== "national_offer_sanction_settlement")
      throw new Error("unexpected intent");
    expect(state.wallet).toBe(100n);
    state.tick++;
    state.rows = [
      {
        ...payerRow,
        canOffer: false,
        offer: { ...issuerRow.offer!, requestId: "other" },
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).not.toContain(
      "recorded this exact settlement offer",
    );
    state.rows = [
      {
        ...state.rows[0],
        offer: { ...state.rows[0].offer!, requestId: intent.requestId },
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain(
      "recorded this exact settlement offer",
    );
    expect(element.textContent).not.toContain("recorded a paid settlement");
  });

  it("does not carry payment consent to a replacement sanction row", async () => {
    const { element, state, sent } = await mount("payer", payerRow);
    const old = element.querySelector("form")!;
    old.querySelector<HTMLInputElement>('input[name="amount"]')!.value = "50";
    old.querySelector<HTMLInputElement>('input[name="confirm"]')!.checked =
      true;
    state.rows = [{ ...payerRow, sanctionId: "sanction-2" }];
    element.refresh();
    await element.updateComplete;
    const replacement = element.querySelector("form")!;
    expect(replacement).not.toBe(old);
    expect(
      replacement.querySelector<HTMLInputElement>('input[name="amount"]')!
        .value,
    ).toBe("");
    expect(
      replacement.querySelector<HTMLInputElement>('input[name="confirm"]')!
        .checked,
    ).toBe(false);
    old.dispatchEvent(new Event("submit", { cancelable: true }));
    replacement.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(sent).toHaveLength(0);
  });

  it("requires current issuer authority; separates accepted payment from maritime permission", async () => {
    const { element, state, sent } = await mount("issuer", issuerRow);
    const accept = element.querySelector<HTMLButtonElement>(
      '[data-settlement-decision="accept"]',
    )!;
    state.rows = [{ ...issuerRow, canAccept: false }];
    accept.click();
    expect(sent).toHaveLength(0);
    state.rows = [issuerRow];
    element.refresh();
    await element.updateComplete;
    accept.click();
    accept.click();
    expect(sent).toHaveLength(1);
    expect(sent[0].intent).toMatchObject({
      type: "national_decide_sanction_settlement",
      recipientId: "payer",
      offerId: "offer-1",
      decision: "accept",
    });
    expect(state.wallet).toBe(100n);
    state.tick++;
    state.rows = [
      {
        ...issuerRow,
        canAccept: false,
        canRefuse: false,
        offer: { ...issuerRow.offer!, status: "accepted" },
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("Game recorded a paid settlement");
    expect(element.textContent).toContain(
      "Game diplomatic trade permission: restricted",
    );
    expect(element.textContent).toContain(
      "all routes, not a specific voyage receipt",
    );
    expect(element.querySelector("[data-settlement-paid-voyage]")).toBeNull();
    state.tick++;
    state.rows = [
      {
        ...state.rows[0],
        tradePermitted: true,
        lastPaidCommerce: {
          tick: state.tick,
          counterpartyId: "issuer",
          grossGold: "411",
        },
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(
      element.querySelector("[data-settlement-paid-voyage]")?.textContent,
    ).toContain("411 gross gold");
    state.actor = "outsider";
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toBe("");
    accept.click();
    expect(sent).toHaveLength(1);
    state.actor = "issuer";
    state.replay = true;
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toBe("");
  });
});
