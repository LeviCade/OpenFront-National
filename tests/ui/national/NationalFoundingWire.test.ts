// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import { NationalFoundEmpireIntentSchema } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it, vi } from "vitest";

const local = vi.hoisted(() => ({
  onMessage: vi.fn(),
  start: vi.fn(),
  updateCallback: vi.fn(),
  endGame: vi.fn(),
}));

vi.mock("../../../src/client/LocalServer", () => ({
  LocalServer: class {
    onMessage = local.onMessage;
    start = local.start;
    updateCallback = local.updateCallback;
    endGame = local.endGame;
  },
}));

vi.mock("../../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(async () => false),
}));

import "../../../src/client/NationalDiplomacyPanel";
import type { LobbyConfig } from "../../../src/client/ClientGameRunner";
import type { NationalDiplomacyPanel } from "../../../src/client/NationalDiplomacyPanel";
import type { NationalFoundingResult } from "../../../src/client/NationalDiplomacyState";
import { SetIntentGateEvent, Transport } from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";

const mounted: HTMLElement[] = [];
const transports: Transport[] = [];

async function setup() {
  const bus = new EventBus();
  const lobby = {
    gameID: "national-test",
    gameStartInfo: {
      config: { gameType: GameType.Singleplayer, nationalMode: true },
    },
  } as LobbyConfig;
  const transport = new Transport(lobby, bus);
  transports.push(transport);
  transport.connect(
    () => {},
    () => {},
  );

  const me = {
    id: () => "nation-a",
    name: () => "Nation A",
    isAlive: () => true,
    numTilesOwned: () => 12,
  };
  const state = {
    politics: {
      empires: [] as { id: string; leaderId: string; memberIds: string[] }[],
      warnings: [],
    },
    tick: 10,
    results: [] as NationalFoundingResult[],
  };
  const game = {
    config: () => ({
      gameConfig: () => ({
        nationalMode: true,
        gameType: GameType.Singleplayer,
      }),
      isReplay: () => false,
    }),
    myPlayer: () => me,
    isSpectator: () => false,
    inSpawnPhase: () => false,
    nationalPolitics: () => state.politics,
    nationalFoundingOutcome: () => null,
    nationalFoundingResults: () => state.results,
    ticks: () => state.tick,
    gameID: () => "national-test",
    players: () => [me],
  } as unknown as GameView;

  const panel = document.createElement(
    "national-diplomacy-panel",
  ) as NationalDiplomacyPanel;
  panel.eventBus = bus;
  panel.game = game;
  document.body.append(panel);
  mounted.push(panel);
  await panel.updateComplete;
  panel
    .querySelector<HTMLButtonElement>(
      'button[aria-controls="national-diplomacy-content"]',
    )!
    .click();
  await panel.updateComplete;
  return { panel, state, bus };
}

async function clickFounding(panel: NationalDiplomacyPanel, name: string) {
  const input = panel.querySelector<HTMLInputElement>("#national-empire-id")!;
  input.value = name;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await panel.updateComplete;
  panel.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await panel.updateComplete;
}

afterEach(() => {
  for (const transport of transports.splice(0)) transport.leaveGame();
  for (const element of mounted.splice(0)) element.remove();
  local.onMessage.mockReset();
});

describe("NATIONAL UI → normal local server command", () => {
  it("turns the actual Found Empire button into one schema-valid, unstamped national_found_empire intent", async () => {
    const { panel, state } = await setup();
    await clickFounding(panel, "Atlas_Empire");
    panel.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    const intents = local.onMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "intent");
    expect(intents).toHaveLength(1);
    expect(intents[0]).toEqual({
      type: "intent",
      intent: {
        type: "national_found_empire",
        empireId: "Atlas_Empire",
        requestId: expect.stringMatching(/^nf_[a-f0-9]{32}$/),
      },
    });
    const clickRequestId = intents[0].intent.requestId as string;
    expect(
      NationalFoundEmpireIntentSchema.safeParse(intents[0].intent).success,
    ).toBe(true);
    expect(panel.textContent).not.toContain("Confirmed by game");

    // Only the authoritative game packet changes what the player sees.
    state.politics = {
      empires: [
        { id: "Atlas_Empire", leaderId: "nation-a", memberIds: ["nation-a"] },
      ],
      warnings: [],
    };
    state.tick = 11;
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).not.toContain("Confirmed by game");

    // E1's real journal, E2's recipient-scoped DTO, E3's routed packet:
    // only their exact accepted result confirms the action.
    state.results = [
      {
        type: "national_found_empire",
        recipientId: "nation-a",
        actorId: "nation-a",
        empireId: "Atlas_Empire",
        accepted: true,
        tick: 11,
        requestId: clickRequestId,
        sequence: 7,
      },
    ];
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain("Confirmed by game");
    expect(panel.textContent).toContain("You are the emperor.");
  });

  it("respects the existing transport intent gate; never bypasses the normal producer", async () => {
    const { panel, bus } = await setup();
    bus.emit(
      new SetIntentGateEvent(
        (intent) => intent.type !== "national_found_empire",
      ),
    );
    await clickFounding(panel, "Atlas");
    expect(
      local.onMessage.mock.calls.filter(
        ([message]) => message?.type === "intent",
      ),
    ).toHaveLength(0);
    expect(panel.textContent).not.toContain("Confirmed by game");
  });
});
