// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { NationalUltimatumViewData } from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it } from "vitest";
import {
  NationalReconMapPickRequestedEvent,
  NationalReconMapPointSelectedEvent,
} from "../../../src/client/controllers/NationalMapTargetController";
import "../../../src/client/NationalDiplomacyPanel";
import type { NationalDiplomacyPanel } from "../../../src/client/NationalDiplomacyPanel";
import {
  SendNationalReconnaissanceIntentEvent,
  SendNationalUltimatumIntentEvent,
} from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";

const mounted: HTMLElement[] = [];
const empire = {
  id: "empire-a",
  leaderId: "nation-a",
  memberIds: ["nation-a"],
};
const ultimatum: NationalUltimatumViewData["items"][number] = {
  id: "ultimatum-20-2-5",
  issuerId: "nation-a",
  empireId: "empire-a",
  targetId: "nation-b",
  role: "issuer" as const,
  threat: "embargo" as const,
  issuedTick: 20,
  deadlineTick: 320,
  phase: "pending" as const,
  response: "none" as const,
  credibility: "pending" as const,
  version: 1,
  warId: null,
  imposedMembers: [] as string[],
  requestId: null as string | null,
  acknowledgedRequestIds: [] as string[],
};

async function mount(
  actorId = "nation-a",
  opts: {
    replay?: boolean;
    spectator?: boolean;
    privateSeat?: boolean;
    money?: bigint;
  } = {},
) {
  const state = {
    tick: 20,
    politics: { empires: [empire], warnings: [] },
    ultimatums: [] as NationalUltimatumViewData["items"][number][],
    grants: [] as {
      requestId: string;
      targetId: string;
      centerX: number;
      centerY: number;
      radius: 90;
      cost: "500";
      effectiveTick: number;
      expiresAtTick: number;
    }[],
  };
  const player = (id: string) => ({
    id: () => id,
    name: () =>
      ({
        "nation-a": "Emperor",
        "nation-b": "B Nation",
        "nation-c": "C Nation",
      })[id] ?? id,
    isAlive: () => true,
    hasSpawned: () => true,
    numTilesOwned: () => 5,
    gold: () => opts.money ?? 1500n,
    nameLocation: () => (id === actorId ? { x: 10, y: 15 } : undefined),
    outgoingAttacks: () => [],
  });
  const players = [player("nation-a"), player("nation-b"), player("nation-c")];
  const view = {
    config: () => ({
      gameConfig: () => ({
        nationalMode: true,
        gameType: opts.privateSeat ? GameType.Private : GameType.Singleplayer,
      }),
      isReplay: () => opts.replay ?? false,
    }),
    myPlayer: () => players.find((p) => p.id() === actorId)!,
    players: () => players,
    isSpectator: () => opts.spectator ?? false,
    inSpawnPhase: () => false,
    nationalPolitics: () => state.politics,
    nationalPoliticsTick: () => state.tick,
    nationalPactDisclosure: () => null,
    nationalImperialAdministration: () => null,
    nationalPactReceipts: () => [],
    nationalAccessionOffers: () => null,
    nationalUltimatums: () => ({
      version: 1,
      recipientId: actorId,
      items: state.ultimatums,
    }),
    nationalReconnaissance: () => ({
      version: 1,
      recipientId: actorId,
      tick: state.tick,
      grants: state.grants,
    }),
    nationalConflicts: () => null,
    nationalFoundingOutcome: () => null,
    nationalFoundingResults: () => [],
    ticks: () => state.tick,
    gameID: () => "national-sovereign-ui",
    isValidCoord: (x: number, y: number) =>
      x >= 0 && x < 200 && y >= 0 && y < 200,
    isPaused: () => false,
  } as unknown as GameView;
  const bus = new EventBus();
  const demands: SendNationalUltimatumIntentEvent[] = [];
  const purchases: SendNationalReconnaissanceIntentEvent[] = [];
  bus.on(SendNationalUltimatumIntentEvent, (e) => demands.push(e));
  bus.on(SendNationalReconnaissanceIntentEvent, (e) => purchases.push(e));
  const element = document.createElement(
    "national-diplomacy-panel",
  ) as NationalDiplomacyPanel;
  element.game = view;
  element.eventBus = bus;
  document.body.appendChild(element);
  mounted.push(element);
  await element.updateComplete;
  element
    .querySelector<HTMLButtonElement>(
      '[aria-controls="national-diplomacy-content"]',
    )
    ?.click();
  await element.updateComplete;
  return { element, bus, state, demands, purchases, view };
}

async function submitForm(
  element: NationalDiplomacyPanel,
  selector: string,
  target: string,
) {
  const form = element.querySelector<HTMLFormElement>(selector)!;
  const select = form.querySelector<HTMLSelectElement>('[name="target"]')!;
  select.value = target;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await element.updateComplete;
  form.querySelector<HTMLInputElement>('[name="confirm"]')!.checked = true;
  form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await element.updateComplete;
}

afterEach(() => {
  for (const node of mounted.splice(0)) node.remove();
});

describe("C5 Class Three E1 native sovereign journey", () => {
  it("selects center from a real map event while the mobile diplomacy sheet is dismissed", async () => {
    const { element, bus } = await mount();
    const requested: NationalReconMapPickRequestedEvent[] = [];
    bus.on(NationalReconMapPickRequestedEvent, (event) =>
      requested.push(event),
    );
    const choose = [
      ...element.querySelectorAll<HTMLButtonElement>(
        "section[data-national-recon] button",
      ),
    ].find((button) => button.textContent?.includes("Choose center on map"))!;
    choose.click();
    await element.updateComplete;
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({
      gameId: "national-sovereign-ui",
      active: true,
    });
    expect(element.querySelector("section[data-national-recon]")).toBeNull();
    bus.emit(new NationalReconMapPointSelectedEvent("other-session", 4, 6));
    expect(element.querySelector("section[data-national-recon]")).toBeNull();
    bus.emit(
      new NationalReconMapPointSelectedEvent("national-sovereign-ui", 12, 34),
    );
    await element.updateComplete;
    expect(
      element.querySelector<HTMLInputElement>(
        'section[data-national-recon] [name="centerX"]',
      )?.value,
    ).toBe("12");
    expect(
      element.querySelector<HTMLInputElement>(
        'section[data-national-recon] [name="centerY"]',
      )?.value,
    ).toBe("34");
    expect(element.textContent).toContain("Game map center selected");
  });

  it("a real emperor can issue exactly one demand and must await private Game receipt", async () => {
    const { element, demands, state } = await mount();
    await submitForm(
      element,
      "section[data-national-ultimatums] form",
      "nation-b",
    );
    expect(demands).toHaveLength(1);
    expect(demands[0].candidate).toMatchObject({
      type: "national_issue_ultimatum",
      empireId: "empire-a",
      targetId: "nation-b",
      threat: "embargo",
      durationTicks: 300,
    });
    expect(element.textContent).toContain(
      "Pending Game-owned ultimatum acknowledgement",
    );
    expect(element.textContent).not.toContain("Game issued ultimatum");
    expect(
      element.querySelector<HTMLButtonElement>(
        "[data-national-issue-ultimatum]",
      )?.disabled,
    ).toBe(true);
    state.tick++;
    state.ultimatums = [
      {
        ...ultimatum,
        issuedTick: 21,
        deadlineTick: 321,
        requestId: (demands[0].candidate as { requestId: string }).requestId,
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("Game issued ultimatum");
    expect(element.textContent).toContain("tick 321");
  });

  it("recipient refuses via current private demand and only matching acknowledgment confirms", async () => {
    const { element, demands, state } = await mount("nation-b");
    state.ultimatums = [{ ...ultimatum, role: "recipient", requestId: null }];
    element.refresh();
    await element.updateComplete;
    expect(element.querySelector("[data-national-issue-ultimatum]")).toBeNull();
    expect(element.textContent).toContain("Demand addressed to your nation");
    const refuse = [
      ...element.querySelectorAll<HTMLButtonElement>(
        "[data-national-ultimatum-id] button",
      ),
    ].find((button) => button.textContent?.includes("Refuse"))!;
    refuse.click();
    await element.updateComplete;
    expect(demands).toHaveLength(1);
    expect(element.textContent).toContain("Pending Game-owned ultimatum");
    const id = (demands[0].candidate as { requestId: string }).requestId;
    state.tick++;
    state.ultimatums = [
      {
        ...state.ultimatums[0],
        phase: "decision-required",
        response: "refuse",
        version: 2,
        acknowledgedRequestIds: [id],
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("Game confirmed refuse");
  });

  it("consent is not annexation; the separate two-party political process remains", async () => {
    const { element, demands, state } = await mount("nation-b");
    state.ultimatums = [{ ...ultimatum, role: "recipient", requestId: null }];
    element.refresh();
    await element.updateComplete;
    const accept = [
      ...element.querySelectorAll<HTMLButtonElement>(
        "[data-national-ultimatum-id] button",
      ),
    ].find((button) => button.textContent?.includes("Accept demand"))!;
    accept.click();
    await element.updateComplete;
    const id = (demands[0].candidate as { requestId: string }).requestId;
    state.tick++;
    state.ultimatums = [
      {
        ...state.ultimatums[0],
        phase: "consented",
        response: "accept",
        version: 2,
        acknowledgedRequestIds: [id],
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain(
      "separate two-party political offer and acceptance",
    );
    expect(state.politics.empires[0].memberIds).toEqual(["nation-a"]);
  });

  it("real map coordinates and explicit consent yield one pending recon, then verified lease and expiration", async () => {
    const { element, purchases, state } = await mount();
    const form = element.querySelector<HTMLFormElement>(
      "section[data-national-recon] form",
    )!;
    const target = form.querySelector<HTMLSelectElement>('[name="target"]')!;
    target.value = "nation-b";
    target.dispatchEvent(new Event("change", { bubbles: true }));
    for (const [name, value] of [
      ["centerX", "10"],
      ["centerY", "15"],
    ]) {
      const input = form.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    form.querySelector<HTMLInputElement>('[name="confirm"]')!.checked = true;
    form.querySelector<HTMLButtonElement>("button[type=submit]")!.click();
    form.querySelector<HTMLButtonElement>("button[type=submit]")!.click();
    await element.updateComplete;
    expect(purchases).toHaveLength(1);
    expect(purchases[0].candidate).toMatchObject({
      type: "national_buy_regional_recon",
      targetId: "nation-b",
      centerX: 10,
      centerY: 15,
    });
    expect(element.textContent).toContain(
      "awaiting the actual paid intelligence lease",
    );
    const id = (purchases[0].candidate as { requestId: string }).requestId;
    state.tick = 21;
    state.grants = [
      {
        requestId: id,
        targetId: "nation-b",
        centerX: 10,
        centerY: 15,
        radius: 90,
        cost: "500",
        effectiveTick: 21,
        expiresAtTick: 621,
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("Game confirmed 500-gold purchase");
    state.tick = 621;
    state.grants = [];
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("lease expired");
  });

  it("forged coordinates, non-emperor powers, replay, and inactive seats do not emit", async () => {
    const { element, purchases, demands } = await mount("nation-b");
    expect(element.querySelector("[data-national-issue-ultimatum]")).toBeNull();
    const recon = element.querySelector<HTMLFormElement>(
      "section[data-national-recon] form",
    )!;
    recon.querySelector<HTMLSelectElement>('[name="target"]')!.value =
      "nation-a";
    recon.querySelector<HTMLInputElement>('[name="confirm"]')!.checked = true;
    recon.querySelector<HTMLInputElement>('[name="centerX"]')!.value = "555";
    recon.querySelector<HTMLInputElement>('[name="centerY"]')!.value = "2";
    recon.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );
    await element.updateComplete;
    expect(purchases).toHaveLength(0);
    expect(demands).toHaveLength(0);
    expect(element.textContent).toContain("Invalid map center");

    const replay = await mount("nation-a", { replay: true });
    expect(
      replay.element.querySelector("[data-national-buy-recon]"),
    ).toBeNull();
    const spectator = await mount("nation-a", { spectator: true });
    expect(
      spectator.element.querySelector("[data-national-issue-ultimatum]"),
    ).toBeNull();
    const privateSeat = await mount("nation-a", { privateSeat: true });
    expect(privateSeat.element.textContent).toContain(
      "locked until the server verifies",
    );
  });
});
