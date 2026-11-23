// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it } from "vitest";
import {
  assessmentReportKey,
  NATIONAL_ASSESSMENT_QUOTE,
  parseNationalAssessmentPurchaseIntent,
  readNationalAssessmentView,
  type NationalAssessmentClientView,
} from "../../../src/client/NationalAssessmentClient";
import "../../../src/client/NationalAssessmentControls";
import type { NationalAssessmentControls } from "../../../src/client/NationalAssessmentControls";
import { SendNationalAssessmentIntentEvent } from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";

const mounted: HTMLElement[] = [];
const validReport = {
  targetId: "nation-b",
  paidBy: "nation-a",
  confidence: "coarse-estimate" as const,
  effectiveTick: 20,
  expiresAtTick: 920,
  treasuryGoldBand: { lower: "2500", upperExclusive: "5000" },
  militaryTroopsBand: { lower: "100000", upperExclusive: "200000" },
};
const packet = (
  items: NationalAssessmentClientView["items"] = [validReport],
): NationalAssessmentClientView => ({
  version: 1,
  recipientId: "nation-a",
  items,
});

async function mount(
  options: {
    replay?: boolean;
    spectator?: boolean;
    private?: boolean;
    gold?: bigint;
    noPolitics?: boolean;
    active?: boolean;
    spawned?: boolean;
  } = {},
) {
  const state = {
    gameId: "assessment-ui-game",
    tick: 20,
    actorId: "nation-a",
    gold: options.gold ?? 2000n,
    reports: null as NationalAssessmentClientView | null,
    replay: options.replay ?? false,
    spectator: options.spectator ?? false,
    mode: options.private ? GameType.Private : GameType.Singleplayer,
    politics: options.noPolitics ? null : { empires: [], warnings: [] },
    alive: options.active ?? true,
    spawned: options.spawned ?? true,
  };
  const player = (id: string) => ({
    id: () => id,
    name: () =>
      id === "nation-a"
        ? "A Republic"
        : id === "nation-b"
          ? "B Nation"
          : "C Nation",
    isAlive: () => (id === state.actorId ? state.alive : true),
    hasSpawned: () => (id === state.actorId ? state.spawned : true),
    numTilesOwned: () => 10,
    gold: () => state.gold,
  });
  const players = [player("nation-a"), player("nation-b"), player("nation-c")];
  const view = {
    config: () => ({
      gameConfig: () => ({ nationalMode: true, gameType: state.mode }),
      isReplay: () => state.replay,
    }),
    myPlayer: () => players.find((p) => p.id() === state.actorId) ?? null,
    players: () => players,
    player: (id: string) => players.find((p) => p.id() === id),
    isSpectator: () => state.spectator,
    inSpawnPhase: () => false,
    nationalPolitics: () => state.politics,
    nationalPoliticsTick: () => state.tick,
    nationalAssessments: () => state.reports,
    trustedProjectionReady: () => false,
    ticks: () => state.tick,
    gameID: () => state.gameId,
  } as unknown as GameView;
  const bus = new EventBus();
  const sent: SendNationalAssessmentIntentEvent[] = [];
  bus.on(SendNationalAssessmentIntentEvent, (e) => sent.push(e));
  const element = document.createElement(
    "national-assessment-controls",
  ) as NationalAssessmentControls;
  element.game = view;
  element.eventBus = bus;
  document.body.appendChild(element);
  mounted.push(element);
  await element.updateComplete;
  return { state, element, sent, view, bus };
}

async function purchase(
  element: NationalAssessmentControls,
  targetId = "nation-b",
) {
  const select = element.querySelector<HTMLSelectElement>(
    'select[name="target"]',
  )!;
  select.value = targetId;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await element.updateComplete;
  const form = element.querySelector<HTMLFormElement>(
    "[data-national-assessment-form]",
  )!;
  form.querySelector<HTMLInputElement>('input[name="confirm"]')!.checked = true;
  form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await element.updateComplete;
}

afterEach(() => {
  for (const node of mounted.splice(0)) node.remove();
});

describe("Sixth E1: strict presentation-only purchase and report boundary", () => {
  it("fixes the distinct 1,200-gold / 900-tick quote", () => {
    expect(NATIONAL_ASSESSMENT_QUOTE).toEqual({
      cost: 1200n,
      durationTicks: 900,
    });
  });

  it("permits only the exact Game-owned intent shape, never forged prices or principals", () => {
    const good = {
      type: "national_buy_national_assessment",
      targetId: "nation-b",
      requestId: "np_1234567890abcdef1234567890abcdef",
    };
    expect(parseNationalAssessmentPurchaseIntent(good)).toEqual(good);
    for (const malformed of [
      null,
      [],
      { ...good, actorId: "nation-b" },
      { ...good, clientID: "foreign-client" },
      { ...good, cost: 0 },
      { ...good, price: "0" },
      { ...good, expiresAtTick: 999999 },
      { ...good, scope: "public" },
      { ...good, requestId: "" },
      { ...good, targetId: "nation a" },
      { ...good, type: "national_buy_regional_recon" },
      { type: good.type, targetId: good.targetId },
    ]) {
      expect(parseNationalAssessmentPurchaseIntent(malformed)).toBeNull();
    }
  });

  it("rejects cross-seat, stale, future, precise, forged and duplicated private reports", () => {
    const valid = packet();
    expect(readNationalAssessmentView(valid, "nation-a", 21)).toEqual(valid);
    expect(assessmentReportKey(validReport)).toBe("nation-b:nation-a:20");
    expect(readNationalAssessmentView(valid, "nation-x", 21)).toBeNull();
    expect(readNationalAssessmentView(valid, null, 21)).toBeNull();
    expect(readNationalAssessmentView(valid, "nation-a", 920)).toBeNull();
    expect(readNationalAssessmentView(valid, "nation-a", 19)).toBeNull();
    expect(
      readNationalAssessmentView({ ...valid, secret: "key" }, "nation-a", 21),
    ).toBeNull();
    // Multiple authenticated purchases may share a payer/target/tick.
    expect(
      readNationalAssessmentView(packet([validReport, validReport]), "nation-a", 21)
        ?.items,
    ).toHaveLength(2);
    expect(
      readNationalAssessmentView(
        packet([{ ...validReport, targetId: "nation-a" }]),
        "nation-a",
        21,
      ),
    ).toBeNull();
    expect(
      readNationalAssessmentView(
        packet([
          { ...validReport, troopPosition: [12, 44] } as typeof validReport,
        ]),
        "nation-a",
        21,
      ),
    ).toBeNull();
    expect(
      readNationalAssessmentView(
        packet([{ ...validReport, expiresAtTick: 921 }]),
        "nation-a",
        21,
      ),
    ).toBeNull();
    expect(
      readNationalAssessmentView(
        packet([
          {
            ...validReport,
            treasuryGoldBand: { lower: "1377", upperExclusive: "3877" },
          },
        ]),
        "nation-a",
        21,
      ),
    ).toBeNull();
    expect(
      readNationalAssessmentView(
        packet([
          {
            ...validReport,
            militaryTroopsBand: { lower: "100000", upperExclusive: "100001" },
          },
        ]),
        "nation-a",
        21,
      ),
    ).toBeNull();
  });

  it("accepts E4 truthful counterassessment bands only when marked shielded, and labels them in UI", async () => {
    const shielded = {
      ...validReport,
      confidence: "shielded-coarse-estimate" as const,
      treasuryGoldBand: { lower: "10000", upperExclusive: "20000" },
      militaryTroopsBand: { lower: "400000", upperExclusive: "800000" },
    };
    const valid = packet([shielded]);
    expect(readNationalAssessmentView(valid, "nation-a", 21)).toEqual(valid);
    expect(
      readNationalAssessmentView(
        packet([{ ...shielded, confidence: "coarse-estimate" }]),
        "nation-a",
        21,
      ),
    ).toBeNull();
    expect(
      readNationalAssessmentView(
        packet([{ ...validReport, confidence: "shielded-coarse-estimate" }]),
        "nation-a",
        21,
      ),
    ).toBeNull();
    expect(
      readNationalAssessmentView(
        packet([
          {
            ...shielded,
            militaryTroopsBand: { lower: "400000", upperExclusive: "400001" },
          },
        ]),
        "nation-a",
        21,
      ),
    ).toBeNull();
    const { element, state } = await mount();
    state.tick = 21;
    state.reports = valid;
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("Counterassessment shield active");
    expect(element.textContent).toContain("Shielded troop estimate");
    expect(element.textContent).not.toContain("100000");
  });

  it("quotes actual player gold and emits one opaque authenticated request, never debits the browser wallet", async () => {
    const { element, state, sent } = await mount();
    expect(element.textContent).toContain("1200");
    expect(element.textContent).toContain("900");
    expect(element.textContent).toContain("2000");
    await purchase(element);
    expect(sent).toHaveLength(1);
    expect(sent[0].candidate).toMatchObject({
      type: "national_buy_national_assessment",
      targetId: "nation-b",
      requestId: expect.stringMatching(/^np_[0-9a-f]{32}$/),
    });
    expect(
      parseNationalAssessmentPurchaseIntent(sent[0].candidate),
    ).not.toBeNull();
    expect(state.gold).toBe(2000n);
    expect(
      element.querySelectorAll("[data-national-assessment-report]"),
    ).toHaveLength(0);
    // Even a programmatic second submit cannot replace a pending request.
    const form = element.querySelector<HTMLFormElement>("form")!;
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    expect(sent).toHaveLength(1);
  });

  it("only displays new authenticated Game reports, then revokes them at expiry", async () => {
    const { element, state } = await mount();
    await purchase(element);
    state.tick = 21;
    state.gold = 800n; // Simulate actual server/Worker player update, never client-side mutation.
    state.reports = packet([
      { ...validReport, effectiveTick: 21, expiresAtTick: 921 },
    ]);
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain(
      "Game-owned paid national assessment",
    );
    expect(element.textContent).toContain("800");
    expect(
      element.querySelectorAll("[data-national-assessment-report]"),
    ).toHaveLength(1);
    expect(element.textContent).toContain("2500");
    expect(element.textContent).toContain("200000");
    state.tick = 921;
    state.reports = null; // the authoritative Game filtered the expired grant
    element.refresh();
    await element.updateComplete;
    expect(
      element.querySelectorAll("[data-national-assessment-report]"),
    ).toHaveLength(0);
    expect(element.textContent).not.toContain("200000");
  });

  it("never counts an old report as a fresh click receipt", async () => {
    const { element, state } = await mount();
    state.reports = packet();
    element.refresh();
    await element.updateComplete;
    await purchase(element);
    state.tick = 21;
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain(
      "Awaiting an actual Game-owned paid report",
    );
    expect(element.textContent).not.toContain(
      "A new Game-owned paid national assessment",
    );
    state.tick = 220;
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("purchase result is unknown");
  });

  it("fails closed on insufficient gold, spectator, replay, Private without trust, dead seat and no public roster", async () => {
    for (const options of [
      { gold: 1199n },
      { spectator: true },
      { replay: true },
      { private: true },
      { active: false },
      { spawned: false },
      { noPolitics: true },
    ]) {
      const { element, sent } = await mount(options);
      if (element.querySelector("form")) await purchase(element);
      expect(sent).toHaveLength(0);
    }
  });

  it("invalidates pending actions and all private report display on session change", async () => {
    const { element, state, sent } = await mount();
    await purchase(element);
    expect(sent).toHaveLength(1);
    state.gameId = "other-game";
    state.reports = packet();
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("Game or principal changed");
    state.spectator = true;
    element.refresh();
    await element.updateComplete;
    expect(
      element.querySelectorAll("[data-national-assessment-report]"),
    ).toHaveLength(0);
    expect(element.textContent).toBe("");
  });
});
