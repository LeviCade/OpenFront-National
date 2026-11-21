// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it } from "vitest";
import "../../../src/client/NationalDiplomacyPanel";
import type { NationalDiplomacyPanel } from "../../../src/client/NationalDiplomacyPanel";
import {
  createNationalPoliticalRequestId,
  readNationalAccessionOffers,
  readNationalPoliticalResults,
  retainNationalPoliticalResults,
  type NationalPoliticalResult,
  type NationalPublicPolitics,
  type NationalAccessionView,
} from "../../../src/client/NationalDiplomacyState";
import {
  SendNationalAcceptEmpireIntentEvent,
  SendNationalOfferEmpireIntentEvent,
  SendNationalTransferCrownIntentEvent,
} from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";

const mounted: HTMLElement[] = [];
const savedWidth = window.innerWidth;

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
  Object.defineProperty(window, "innerWidth", {
    value: savedWidth,
    configurable: true,
  });
});

function politicalReceipt(
  type: NationalPoliticalResult["type"],
  requestId: string,
  empireId: string,
  accepted = true,
): NationalPoliticalResult {
  return {
    type,
    requestId,
    actorId: "nation-a",
    recipientId: "nation-a",
    commandTargetId: empireId,
    accepted,
    reason: accepted ? "accepted" : "political-rule",
    tick: 12,
    sequence: 9,
  };
}

async function mount(
  options: {
    emperor?: boolean;
    spawned?: boolean;
    offers?: NationalAccessionView | null;
  } = {},
) {
  const state = {
    spawned: options.spawned ?? true,
    tick: 12,
    politicsTick: 12,
    politicalResults: [] as NationalPoliticalResult[],
    politics: {
      empires: options.emperor
        ? [
            {
              id: "Atlas",
              leaderId: "nation-a",
              memberIds: ["nation-a", "nation-b"],
            },
          ]
        : [{ id: "Atlas", leaderId: "nation-b", memberIds: ["nation-b"] }],
      warnings: [],
    } as NationalPublicPolitics,
    offers: options.offers === undefined ? null : options.offers,
  };
  const nations = [
    { id: "nation-a", name: "Nation A" },
    { id: "nation-b", name: "Nation B" },
    { id: "nation-c", name: "Nation C" },
  ].map((nation) => ({
    id: () => nation.id,
    name: () => nation.name,
    isAlive: () => true,
    numTilesOwned: () => (state.spawned ? 5 : 0),
  }));
  const game = {
    config: () => ({
      gameConfig: () => ({
        gameType: GameType.Singleplayer,
        nationalMode: true,
      }),
      isReplay: () => false,
    }),
    gameID: () => "r11-political-test",
    myPlayer: () => nations[0],
    players: () => nations,
    ticks: () => state.tick,
    inSpawnPhase: () => !state.spawned,
    isSpectator: () => false,
    nationalPolitics: () => state.politics,
    nationalPoliticsTick: () => state.politicsTick,
    nationalAccessionOffers: () => state.offers,
    nationalPoliticalResults: () => state.politicalResults,
    nationalFoundingResults: () => [],
    nationalFoundingOutcome: () => null,
    nationalConflicts: () => null,
  } as unknown as GameView;
  const bus = new EventBus();
  const panel = document.createElement(
    "national-diplomacy-panel",
  ) as NationalDiplomacyPanel;
  panel.game = game;
  panel.eventBus = bus;
  document.body.appendChild(panel);
  mounted.push(panel);
  await panel.updateComplete;
  panel
    .querySelector<HTMLButtonElement>(
      'button[aria-controls="national-diplomacy-content"]',
    )!
    .click();
  await panel.updateComplete;
  return { panel, bus, state };
}

async function choose(
  panel: NationalDiplomacyPanel,
  selector: string,
  value: string,
) {
  const select = panel.querySelector<HTMLSelectElement>(selector);
  expect(select).not.toBeNull();
  select!.value = value;
  select!.dispatchEvent(new Event("change", { bubbles: true }));
  await panel.updateComplete;
}

describe("R11 NATIONAL political wire authorization", () => {
  it("rejects absent, foreign, forged and duplicate invitation snapshots", () => {
    const valid = {
      version: 1,
      recipientId: "nation-a",
      offers: [
        {
          empireId: "Atlas",
          candidateId: "nation-a",
          proposerId: "nation-b",
          recipientId: "nation-a",
        },
      ],
    } as const;
    expect(readNationalAccessionOffers(undefined, "nation-a")).toBeNull();
    expect(readNationalAccessionOffers(valid, "nation-a")?.offers).toHaveLength(
      1,
    );
    expect(
      readNationalAccessionOffers(
        { ...valid, recipientId: "nation-c" },
        "nation-a",
      ),
    ).toBeNull();
    expect(
      readNationalAccessionOffers(
        { ...valid, offers: [...valid.offers, ...valid.offers] },
        "nation-a",
      ),
    ).toBeNull();
    expect(
      readNationalAccessionOffers(
        {
          ...valid,
          offers: [{ ...valid.offers[0], candidateId: "nation-c" }],
        },
        "nation-a",
      ),
    ).toBeNull();
  });

  it("retains only matching E1 political receipts within a bounded tick window", () => {
    const requestId = "np_" + "a".repeat(32);
    const valid = politicalReceipt("national_offer_empire", requestId, "Atlas");
    expect(
      readNationalPoliticalResults(
        [
          valid,
          { ...valid, actorId: "nation-b" },
          { ...valid, recipientId: "nation-b" },
          { ...valid, requestId: "made-up" },
          { ...valid, tick: -2 },
        ],
        "nation-a",
      ),
    ).toEqual([valid]);
    expect(retainNationalPoliticalResults([valid], [], 300, false)).toEqual([]);
    expect(retainNationalPoliticalResults([], [valid], 12, false)).toEqual([
      valid,
    ]);
    expect(createNationalPoliticalRequestId()).toMatch(/^np_[0-9a-f]{32}$/);
  });

  it("only the current emperor offers accession; a receipt never proves delivery", async () => {
    const { panel, bus, state } = await mount({ emperor: true });
    const events: SendNationalOfferEmpireIntentEvent[] = [];
    bus.on(SendNationalOfferEmpireIntentEvent, (event) => events.push(event));
    await choose(panel, "#national-accession-candidate", "nation-c");
    panel
      .querySelector<HTMLButtonElement>("#national-offer-accession")!
      .click();
    await panel.updateComplete;
    expect(events).toHaveLength(1);
    expect(events[0].candidateId).toBe("nation-c");
    expect(panel.textContent).toContain("Awaiting game receipt");
    expect(panel.textContent).not.toContain("Game accepted accession offer");
    state.politicalResults = [
      politicalReceipt("national_offer_empire", events[0].requestId, "Atlas"),
    ];
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain(
      "Game accepted accession offer command",
    );
    expect(panel.textContent).toContain(
      "Only the recipient can verify delivery",
    );
  });

  it("recipient cannot accept until their own real invitation arrives; membership needs new roster", async () => {
    const { panel, bus, state } = await mount();
    const events: SendNationalAcceptEmpireIntentEvent[] = [];
    bus.on(SendNationalAcceptEmpireIntentEvent, (event) => events.push(event));
    expect(
      panel.querySelector<HTMLButtonElement>("#national-accept-accession")!
        .disabled,
    ).toBe(true);
    state.offers = {
      version: 1,
      recipientId: "nation-a",
      offers: [
        {
          empireId: "Atlas",
          candidateId: "nation-a",
          proposerId: "nation-b",
          recipientId: "nation-a",
        },
      ],
    };
    panel.refresh();
    await panel.updateComplete;
    await choose(panel, "#national-invitation-empire", "Atlas:nation-a");
    panel
      .querySelector<HTMLButtonElement>("#national-accept-accession")!
      .click();
    await panel.updateComplete;
    expect(events).toHaveLength(1);
    expect(events[0].candidateId).toBe("nation-a");
    state.politicalResults = [
      politicalReceipt("national_accept_empire", events[0].requestId, "Atlas"),
    ];
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).not.toContain(
      "Confirmed by game: your nation joined",
    );
    state.politics = {
      empires: [
        {
          id: "Atlas",
          leaderId: "nation-b",
          memberIds: ["nation-a", "nation-b"],
        },
      ],
      warnings: [],
    };
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain(
      "Confirmed by game: your nation joined Atlas",
    );
    expect(panel.querySelector("#national-accept-accession")).toBeNull();
  });

  it("emperor accepts a candidate-initiated invitation only after the candidate joins the live roster", async () => {
    const { panel, bus, state } = await mount({
      emperor: true,
      offers: {
        version: 1,
        recipientId: "nation-a",
        offers: [
          {
            empireId: "Atlas",
            candidateId: "nation-c",
            proposerId: "nation-c",
            recipientId: "nation-a",
          },
        ],
      },
    });
    expect(
      readNationalAccessionOffers(state.offers, "nation-a"),
    ).toMatchObject({
      offers: [{ candidateId: "nation-c", recipientId: "nation-a" }],
    });
    const events: SendNationalAcceptEmpireIntentEvent[] = [];
    bus.on(SendNationalAcceptEmpireIntentEvent, (event) => events.push(event));
    await choose(panel, "#national-invitation-empire", "Atlas:nation-c");
    panel
      .querySelector<HTMLButtonElement>("#national-accept-accession")!
      .click();
    await panel.updateComplete;
    expect(events).toHaveLength(1);
    expect(events[0].candidateId).toBe("nation-c");
    state.politicalResults = [
      politicalReceipt("national_accept_empire", events[0].requestId, "Atlas"),
    ];
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).not.toContain(
      "Confirmed by game: Nation C joined",
    );
    state.politics = {
      empires: [
        {
          id: "Atlas",
          leaderId: "nation-a",
          memberIds: ["nation-a", "nation-b", "nation-c"],
        },
      ],
      warnings: [],
    };
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain(
      "Confirmed by game: Nation C joined Atlas",
    );
  });

  it("crown transfer revokes former emperor's privileged controls on current roster", async () => {
    const { panel, bus, state } = await mount({ emperor: true });
    const events: SendNationalTransferCrownIntentEvent[] = [];
    bus.on(SendNationalTransferCrownIntentEvent, (event) => events.push(event));
    await choose(panel, "#national-crown-successor", "nation-b");
    panel.querySelector<HTMLButtonElement>("#national-transfer-crown")!.click();
    expect(events).toHaveLength(1);
    state.politicalResults = [
      politicalReceipt("national_transfer_crown", events[0].requestId, "Atlas"),
    ];
    state.politics = {
      empires: [
        {
          id: "Atlas",
          leaderId: "nation-b",
          memberIds: ["nation-a", "nation-b"],
        },
      ],
      warnings: [],
    };
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain("Your emperor powers have ended");
    expect(panel.querySelector("#national-transfer-crown")).toBeNull();
    expect(panel.querySelector("#national-offer-accession")).toBeNull();
  });

  it("a pre-spawn mobile viewport keeps the real map uncovered and opens the panel after spawn", async () => {
    Object.defineProperty(window, "innerWidth", {
      value: 390,
      configurable: true,
    });
    const { panel, state } = await mount({ spawned: false });
    const toggle = panel.querySelector<HTMLButtonElement>(
      'button[aria-controls="national-diplomacy-content"]',
    )!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.querySelector("#national-diplomacy-content")).toBeNull();
    expect(toggle.textContent).toContain("Tap map to spawn");
    state.spawned = true;
    panel.refresh();
    await panel.updateComplete;
    toggle.click();
    await panel.updateComplete;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.querySelector("#national-empire-id")).not.toBeNull();
    panel.querySelector<HTMLButtonElement>("#national-return-to-map")?.click();
  });
});
