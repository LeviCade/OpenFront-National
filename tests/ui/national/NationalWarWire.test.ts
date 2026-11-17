// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import {
  NationalAcceptPeaceIntentSchema,
  NationalDeclareWarIntentSchema,
  NationalProposePeaceIntentSchema,
} from "@openfront/engine-api/Schemas";
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
import { validNationalWarReference } from "../../../src/client/NationalDiplomacyState";
import {
  SendNationalDeclareWarIntentEvent,
  SetIntentGateEvent,
  Transport,
} from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";

const mounted: HTMLElement[] = [];
const transports: Transport[] = [];

async function setup(
  options: {
    national?: boolean;
    replay?: boolean;
    spawned?: boolean;
    alive?: boolean;
    spectator?: boolean;
    emperor?: boolean;
  } = {},
) {
  const state = {
    tick: 10,
    national: options.national ?? true,
    replay: options.replay ?? false,
    spawned: options.spawned ?? true,
    alive: options.alive ?? true,
    spectator: options.spectator ?? false,
    politics: {
      empires: options.emperor
        ? [
            {
              id: "Atlas",
              leaderId: "nation-a",
              memberIds: ["nation-a"],
            },
            {
              id: "Borealis",
              leaderId: "nation-b",
              memberIds: ["nation-b"],
            },
          ]
        : [],
      warnings: [],
    },
  };
  const bus = new EventBus();
  const lobby = {
    gameID: "national-r8-test",
    gameStartInfo: {
      config: {
        gameType: GameType.Singleplayer,
        nationalMode: state.national,
      },
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
    isAlive: () => state.alive,
    numTilesOwned: () => (state.spawned ? 5 : 0),
  };
  const rival = {
    id: () => "nation-b",
    name: () => "Nation B",
    isAlive: () => true,
    numTilesOwned: () => 5,
  };
  const game = {
    config: () => ({
      gameConfig: () => ({
        gameType: GameType.Singleplayer,
        nationalMode: state.national,
      }),
      isReplay: () => state.replay,
    }),
    gameID: () => "national-r8-test",
    myPlayer: () => me,
    players: () => [me, rival],
    nationalPolitics: () => state.politics,
    nationalFoundingResults: () => [],
    nationalFoundingOutcome: () => null,
    ticks: () => state.tick,
    isSpectator: () => state.spectator,
    inSpawnPhase: () => !state.spawned,
  } as unknown as GameView;
  const panel = document.createElement(
    "national-diplomacy-panel",
  ) as NationalDiplomacyPanel;
  panel.eventBus = bus;
  panel.game = game;
  document.body.append(panel);
  mounted.push(panel);
  await panel.updateComplete;
  const toggle = panel.querySelector<HTMLButtonElement>(
    'button[aria-controls="national-diplomacy-content"]',
  );
  toggle?.click();
  await panel.updateComplete;
  return { panel, state, bus };
}

function intents() {
  return local.onMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message?.type === "intent")
    .map((message) => message.intent);
}

async function choose(
  panel: NationalDiplomacyPanel,
  selector: string,
  value: string,
) {
  const input = panel.querySelector<HTMLSelectElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await panel.updateComplete;
}

async function enter(
  panel: NationalDiplomacyPanel,
  selector: string,
  value: string,
) {
  const input = panel.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await panel.updateComplete;
}

afterEach(() => {
  for (const transport of transports.splice(0)) transport.leaveGame();
  for (const node of mounted.splice(0)) node.remove();
  local.onMessage.mockReset();
  vi.restoreAllMocks();
});

describe("NATIONAL player-operated WAR/peace through real authenticated wire", () => {
  it("accepts real deterministic WAR/motion references but rejects control characters", () => {
    expect(validNationalWarReference("national-10-1-4")).toBe(true);
    expect(validNationalWarReference("Borealis")).toBe(true);
    expect(validNationalWarReference("")).toBe(false);
    expect(validNationalWarReference("x".repeat(257))).toBe(false);
    expect(validNationalWarReference("bad\u0000id")).toBe(false);
  });

  it("dispatches a schema-valid national WAR intent for an actual living rival, never an optimistic result", async () => {
    const { panel } = await setup();
    await choose(panel, "#national-war-target", "nation-b");
    const button = panel.querySelector<HTMLButtonElement>(
      "#national-declare-war",
    )!;
    expect(button.disabled).toBe(false);
    button.click();
    button.click();
    await panel.updateComplete;
    expect(intents()).toEqual([
      {
        type: "national_declare_war",
        scope: "national",
        nationId: "nation-a",
        targetId: "nation-b",
        targetKind: "nation",
      },
    ]);
    expect(NationalDeclareWarIntentSchema.safeParse(intents()[0]).success).toBe(
      true,
    );
    expect(panel.textContent).toContain("no success is confirmed");
    expect(panel.textContent).not.toContain("War accepted");
  });

  it("allows an authoritative emperor to target a rival empire, without client actor spoofing", async () => {
    const { panel } = await setup({ emperor: true });
    await choose(panel, "#national-war-scope", "imperial");
    await choose(panel, "#national-war-target-kind", "empire");
    await choose(panel, "#national-war-target", "Borealis");
    panel.querySelector<HTMLButtonElement>("#national-declare-war")!.click();
    expect(intents()).toEqual([
      {
        type: "national_declare_war",
        scope: "imperial",
        nationId: "nation-a",
        targetId: "Borealis",
        targetKind: "empire",
      },
    ]);
    expect(NationalDeclareWarIntentSchema.safeParse(intents()[0]).success).toBe(
      true,
    );
    expect(intents()[0]).not.toHaveProperty("clientID");
  });

  it("submits real peace proposal and acceptance schema intents without implying agreement", async () => {
    const { panel, state } = await setup();
    await enter(panel, "#national-peace-war-id", "national-10-1-4");
    panel.querySelector<HTMLButtonElement>("#national-propose-peace")!.click();
    expect(intents()).toEqual([
      { type: "national_propose_peace", warId: "national-10-1-4" },
    ]);
    expect(
      NationalProposePeaceIntentSchema.safeParse(intents()[0]).success,
    ).toBe(true);
    state.tick = 11;
    panel.refresh();
    await panel.updateComplete;
    await enter(panel, "#national-peace-motion-id", "national-11-1-5");
    panel.querySelector<HTMLButtonElement>("#national-accept-peace")!.click();
    expect(intents()[1]).toEqual({
      type: "national_accept_peace",
      motionId: "national-11-1-5",
    });
    expect(
      NationalAcceptPeaceIntentSchema.safeParse(intents()[1]).success,
    ).toBe(true);
    expect(panel.textContent).not.toContain("Peace accepted");
    expect(panel.textContent).toContain("no success is confirmed");
  });

  it("fails closed for replay, eliminated players, spectators and a non-emperor", async () => {
    for (const options of [
      { replay: true },
      { alive: false },
      { spectator: true },
      { spawned: false },
    ]) {
      const { panel } = await setup(options);
      // A restricted mode may remove controls entirely or leave them inert.
      expect(
        panel.querySelector<HTMLButtonElement>("#national-declare-war")
          ?.disabled ?? true,
      ).toBe(true);
      expect(
        panel.querySelector<HTMLButtonElement>("#national-propose-peace")
          ?.disabled ?? true,
      ).toBe(true);
    }
    const { panel } = await setup();
    // A non-emperor cannot select the disabled imperial authority option.
    expect(
      panel.querySelector<HTMLOptionElement>(
        '#national-war-scope option[value="imperial"]',
      )?.disabled,
    ).toBe(true);
    expect(intents()).toHaveLength(0);
  });

  it("preserves legacy FFA isolation and respects the existing intent gate", async () => {
    const legacy = await setup({ national: false });
    expect(legacy.panel.querySelector("#national-declare-war")).toBeNull();
    legacy.bus.emit(
      new SendNationalDeclareWarIntentEvent(
        "national",
        "nation-a",
        "nation-b",
        "nation",
      ),
    );
    expect(intents()).toHaveLength(0);

    const live = await setup();
    live.bus.emit(
      new SetIntentGateEvent(
        (intent) => intent.type !== "national_declare_war",
      ),
    );
    await choose(live.panel, "#national-war-target", "nation-b");
    live.panel
      .querySelector<HTMLButtonElement>("#national-declare-war")!
      .click();
    expect(intents()).toHaveLength(0);
  });

  it("invalidates unconfirmed WAR status on disconnect, without replaying success", async () => {
    const { panel } = await setup();
    await choose(panel, "#national-war-target", "nation-b");
    panel.querySelector<HTMLButtonElement>("#national-declare-war")!.click();
    expect(intents()).toHaveLength(1);
    panel.connectionInterrupted();
    await panel.updateComplete;
    expect(panel.textContent).toContain("Connection interrupted");
    expect(panel.textContent).not.toContain("War accepted");
  });
});
