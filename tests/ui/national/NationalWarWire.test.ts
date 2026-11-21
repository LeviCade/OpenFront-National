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
import {
  readNationalConflicts,
  readNationalDiplomacyResults,
  validNationalWarReference,
  type NationalDiplomacyResult,
  type NationalPublicConflicts,
  type NationalPublicWarLayer,
  type NationalPublicPeaceMotion,
} from "../../../src/client/NationalDiplomacyState";
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
    diplomacyResults: [] as NationalDiplomacyResult[],
    conflicts: null as NationalPublicConflicts | null,
    conflictTick: null as number | null,
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
    nationalDiplomacyResults: () => state.diplomacyResults,
    nationalConflicts: () => state.conflicts,
    nationalConflictsTick: () =>
      state.conflicts ? (state.conflictTick ?? state.tick) : null,
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
        requestId: expect.stringMatching(/^nc_[0-9a-f]{32}$/),
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
        requestId: expect.stringMatching(/^nc_[0-9a-f]{32}$/),
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
      {
        type: "national_propose_peace",
        warId: "national-10-1-4",
        requestId: expect.stringMatching(/^nc_[0-9a-f]{32}$/),
      },
    ]);
    expect(
      NationalProposePeaceIntentSchema.safeParse(intents()[0]).success,
    ).toBe(true);
    state.tick = 11;
    state.diplomacyResults = [
      {
        type: "national_propose_peace",
        actorId: "nation-a",
        recipientId: "nation-a",
        requestId: intents()[0].requestId,
        sequence: 7,
        tick: 11,
        accepted: false,
        reason: "political-rule",
      },
    ];
    panel.refresh();
    await panel.updateComplete;
    await enter(panel, "#national-peace-motion-id", "national-11-1-5");
    panel.querySelector<HTMLButtonElement>("#national-accept-peace")!.click();
    expect(intents()[1]).toEqual({
      type: "national_accept_peace",
      motionId: "national-11-1-5",
      requestId: expect.stringMatching(/^nc_[0-9a-f]{32}$/),
    });
    expect(intents()[1].requestId).not.toBe(intents()[0].requestId);
    expect(
      NationalAcceptPeaceIntentSchema.safeParse(intents()[1]).success,
    ).toBe(true);
    expect(panel.textContent).not.toContain("Peace accepted");
    expect(panel.textContent).not.toContain("Peace settlement confirmed by game");
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
      )?.disabled ?? true,
    ).toBe(true);
    expect(intents()).toHaveLength(0);
  });

  it("rejects foreign and mismatched WAR receipts, then displays exact authenticated rejection", async () => {
    const { panel, state } = await setup();
    await choose(panel, "#national-war-target", "nation-b");
    panel.querySelector<HTMLButtonElement>("#national-declare-war")!.click();
    const sent = intents()[0];
    const requestId = sent.requestId as string;
    expect(requestId).toMatch(/^nc_[0-9a-f]{32}$/);
    state.tick = 11;
    state.diplomacyResults = [
      {
        type: "national_declare_war",
        actorId: "nation-b",
        recipientId: "nation-b",
        requestId,
        sequence: 1,
        tick: 11,
        accepted: true,
      },
      {
        type: "national_declare_war",
        actorId: "nation-a",
        recipientId: "nation-a",
        requestId: "nc_00000000000000000000000000000000",
        sequence: 2,
        tick: 11,
        accepted: true,
      },
    ];
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).not.toContain("The game rejected");
    expect(panel.textContent).not.toContain("Confirmed by game");

    state.diplomacyResults = [
      {
        type: "national_declare_war",
        actorId: "nation-a",
        recipientId: "nation-a",
        requestId,
        sequence: 3,
        tick: 11,
        accepted: false,
        reason: "political-rule",
      },
    ];
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain(
      "The game rejected this diplomacy action",
    );
    expect(panel.textContent).toContain("political-rule");
    expect(panel.textContent).not.toContain("Confirmed by game");
  });

  it("does not claim WAR success from an authenticated positive receipt without current public war state", async () => {
    const { panel, state } = await setup();
    await choose(panel, "#national-war-target", "nation-b");
    panel.querySelector<HTMLButtonElement>("#national-declare-war")!.click();
    const requestId = intents()[0].requestId as string;
    state.tick = 11;
    state.diplomacyResults = [
      {
        type: "national_declare_war",
        actorId: "nation-a",
        recipientId: "nation-a",
        requestId,
        sequence: 4,
        tick: 11,
        accepted: true,
        warId: "national-11-1-4",
      },
    ];
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain(
      "Authenticated positive command receipt",
    );
    expect(panel.textContent).toContain("No completed action is confirmed");
    expect(panel.textContent).not.toContain("War accepted");
  });

  const canonicalWar: NationalPublicWarLayer = {
    id: "war-11",
    scope: "national",
    first: { kind: "nation", id: "nation-a" },
    second: { kind: "nation", id: "nation-b" },
    declaredBy: "nation-a",
    startedTick: 10,
    endedTick: null,
  };
  const foreignOffer: NationalPublicPeaceMotion = {
    id: "motion-12",
    layerId: "war-11",
    proposedBy: "nation-b",
    proposingSide: 1,
    proposedTick: 10,
    acceptedTick: null,
    acceptedBy: null,
  };
  function projection(
    wars: readonly NationalPublicWarLayer[] = [canonicalWar],
    motions: readonly NationalPublicPeaceMotion[] = [],
  ): NationalPublicConflicts {
    return { version: 1, recipientId: "nation-a", layers: wars, motions };
  }

  it("rejects foreign, malformed, duplicate and inconsistent E3 conflict projections", () => {
    const valid = projection([canonicalWar], [foreignOffer]);
    expect(readNationalConflicts(valid, "nation-a")).toEqual(valid);
    expect(readNationalConflicts(valid, "nation-b")).toBeNull();
    expect(
      readNationalConflicts({ ...valid, version: 2 }, "nation-a"),
    ).toBeNull();
    expect(
      readNationalConflicts(
        { ...valid, layers: [canonicalWar, canonicalWar] },
        "nation-a",
      ),
    ).toBeNull();
    expect(
      readNationalConflicts(
        { ...valid, motions: [{ ...foreignOffer, layerId: "missing" }] },
        "nation-a",
      ),
    ).toBeNull();
    expect(
      readNationalConflicts(
        { ...valid, layers: [{ ...canonicalWar, endedTick: -1 }] },
        "nation-a",
      ),
    ).toBeNull();
    expect(
      readNationalConflicts(
        {
          ...valid,
          motions: [{ ...foreignOffer, acceptedTick: 11, acceptedBy: null }],
        },
        "nation-a",
      ),
    ).toBeNull();
  });

  it("confirms real national WAR only after a matching current authoritative layer, and revokes stale state", async () => {
    const { panel, state } = await setup();
    await choose(panel, "#national-war-target", "nation-b");
    panel.querySelector<HTMLButtonElement>("#national-declare-war")!.click();
    const requestId = intents()[0].requestId as string;
    state.tick = 11;
    state.diplomacyResults = [
      {
        type: "national_declare_war",
        actorId: "nation-a",
        recipientId: "nation-a",
        requestId,
        sequence: 9,
        tick: 11,
        accepted: true,
        warId: "war-11",
      },
    ];
    state.conflicts = projection([
      { ...canonicalWar, startedTick: 11, declaredBy: "nation-b" },
    ]);
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).not.toContain("War confirmed by game");

    state.conflicts = projection([{ ...canonicalWar, startedTick: 11 }]);
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain(
      "War confirmed by game: war-11 is active",
    );
    expect(panel.textContent).toContain("WAR war-11");

    state.tick = 12;
    state.conflicts = projection([
      { ...canonicalWar, startedTick: 11, endedTick: 12 },
    ]);
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain("has since changed");
    expect(panel.textContent).not.toContain("War confirmed by game");
  });

  it("exposes eligible engine WAR IDs as selectors; rejects stale and unknown IDs", async () => {
    const { panel, state } = await setup();
    state.conflicts = projection();
    panel.refresh();
    await panel.updateComplete;
    expect(panel.querySelector("#national-peace-war-id")?.tagName).toBe(
      "SELECT",
    );
    await choose(panel, "#national-peace-war-id", "war-11");
    panel.querySelector<HTMLButtonElement>("#national-propose-peace")!.click();
    expect(intents()).toHaveLength(1);
    expect(intents()[0].warId).toBe("war-11");
    state.tick = 11;
    state.diplomacyResults = [
      {
        type: "national_propose_peace",
        actorId: "nation-a",
        recipientId: "nation-a",
        requestId: intents()[0].requestId,
        sequence: 10,
        tick: 11,
        accepted: true,
        warId: "war-11",
        motionId: "motion-11",
      },
    ];
    state.conflicts = projection(
      [canonicalWar],
      [
        {
          id: "motion-11",
          layerId: "war-11",
          proposedBy: "nation-a",
          proposingSide: 0,
          proposedTick: 11,
          acceptedTick: null,
          acceptedBy: null,
        },
      ],
    );
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain(
      "Peace proposal confirmed by game: motion motion-11",
    );

    const late = await setup();
    late.state.conflicts = projection([{ ...canonicalWar, endedTick: 11 }]);
    late.panel.refresh();
    await late.panel.updateComplete;
    expect(
      late.panel.querySelector<HTMLButtonElement>("#national-propose-peace")
        ?.disabled ?? true,
    ).toBe(true);
    expect(
      late.panel.querySelector('#national-peace-war-id option[value="war-11"]'),
    ).toBeNull();
  });

  it("shows a pending opponent motion, then confirms peace only after canonical cessation", async () => {
    const { panel, state } = await setup();
    state.conflicts = projection([canonicalWar], [foreignOffer]);
    panel.refresh();
    await panel.updateComplete;
    expect(panel.querySelector("#national-peace-motion-id")?.tagName).toBe(
      "SELECT",
    );
    await choose(panel, "#national-peace-motion-id", "motion-12");
    panel.querySelector<HTMLButtonElement>("#national-accept-peace")!.click();
    expect(intents()[0].motionId).toBe("motion-12");
    state.tick = 11;
    state.diplomacyResults = [
      {
        type: "national_accept_peace",
        actorId: "nation-a",
        recipientId: "nation-a",
        requestId: intents()[0].requestId,
        sequence: 12,
        tick: 11,
        accepted: true,
        warId: "war-11",
        motionId: "motion-12",
      },
    ];
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).not.toContain("Peace accepted by game");

    state.conflicts = projection(
      [{ ...canonicalWar, endedTick: 11 }],
      [
        {
          ...foreignOffer,
          acceptedTick: 11,
          acceptedBy: "nation-a",
        },
      ],
    );
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain("Peace accepted by game");
    expect(panel.textContent).toContain("war-11");
  });

  it("blocks a second click even on later ticks while first diplomacy remains unresolved", async () => {
    const { panel, state } = await setup();
    await choose(panel, "#national-war-target", "nation-b");
    panel.querySelector<HTMLButtonElement>("#national-declare-war")!.click();
    state.tick = 11;
    panel.refresh();
    await panel.updateComplete;
    expect(
      panel.querySelector<HTMLButtonElement>("#national-declare-war")!.disabled,
    ).toBe(true);
    expect(
      panel.querySelector<HTMLButtonElement>("#national-propose-peace")!
        .disabled,
    ).toBe(true);
    expect(intents()).toHaveLength(1);
  });

  it("rejects future-dated WAR and motion packets, and waits for a same-tick authoritative view", async () => {
    const futureWar = { ...canonicalWar, startedTick: 11 };
    expect(
      readNationalConflicts(projection([futureWar]), "nation-a", 10),
    ).toBeNull();
    expect(readNationalConflicts(projection(), "nation-a", 10)).not.toBeNull();
    expect(
      readNationalConflicts(
        projection(
          [canonicalWar],
          [
            {
              ...foreignOffer,
              acceptedTick: 11,
              acceptedBy: "nation-a",
            },
          ],
        ),
        "nation-a",
        10,
      ),
    ).toBeNull();

    const { panel, state } = await setup();
    await choose(panel, "#national-war-target", "nation-b");
    panel.querySelector<HTMLButtonElement>("#national-declare-war")!.click();
    state.tick = 11;
    state.conflictTick = 10;
    state.conflicts = projection([futureWar]);
    state.diplomacyResults = [
      {
        type: "national_declare_war",
        actorId: "nation-a",
        recipientId: "nation-a",
        requestId: intents()[0].requestId,
        sequence: 30,
        tick: 11,
        accepted: true,
        warId: "war-11",
      },
    ];
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).not.toContain("War confirmed by game");
    state.conflictTick = 11;
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain("War confirmed by game: war-11");
  });

  it("rejects contradictory same-token receipts without displaying an optimistic success", async () => {
    const { panel, state } = await setup();
    await choose(panel, "#national-war-target", "nation-b");
    panel.querySelector<HTMLButtonElement>("#national-declare-war")!.click();
    const requestId = intents()[0].requestId as string;
    state.tick = 11;
    state.conflicts = projection([{ ...canonicalWar, startedTick: 11 }]);
    state.diplomacyResults = [
      {
        type: "national_declare_war",
        actorId: "nation-a",
        recipientId: "nation-a",
        requestId,
        sequence: 40,
        tick: 11,
        accepted: true,
        warId: "war-11",
      },
      {
        type: "national_declare_war",
        actorId: "nation-a",
        recipientId: "nation-a",
        requestId,
        sequence: 41,
        tick: 11,
        accepted: false,
        reason: "political-rule",
      },
    ];
    panel.refresh();
    await panel.updateComplete;
    expect(panel.textContent).toContain(
      "Conflicting authenticated diplomacy receipts",
    );
    expect(panel.textContent).not.toContain("War confirmed by game");
  });

  it("fails closed on malformed, foreign and non-cryptographic receipt IDs", () => {
    const valid = {
      type: "national_declare_war",
      actorId: "nation-a",
      recipientId: "nation-a",
      accepted: false,
      tick: 10,
      sequence: 1,
      requestId: "nc_11111111111111111111111111111111",
      reason: "political-rule",
    };
    expect(
      readNationalDiplomacyResults([
        { ...valid, recipientId: "nation-b" },
        { ...valid, sequence: -1 },
        { ...valid, requestId: "legacy" },
        { ...valid, tick: -4 },
        { ...valid, type: "national_found_empire" },
        valid,
      ]),
    ).toEqual([valid]);
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
        "nc_00000000000000000000000000000001",
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
