// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isNationalOpponentTile,
  NationalMapTargetController,
  NationalMapTargetSelectedEvent,
} from "../../../src/client/controllers/NationalMapTargetController";
import {
  ContextMenuEvent,
  InputHandler,
  MouseUpEvent,
} from "../../../src/client/InputHandler";
import "../../../src/client/NationalDiplomacyPanel";
import type { NationalDiplomacyPanel } from "../../../src/client/NationalDiplomacyPanel";
import { TransformHandler } from "../../../src/client/TransformHandler";
import { RadialMenu } from "../../../src/client/hud/layers/RadialMenu";
import type { MenuElementParams } from "../../../src/client/hud/layers/RadialMenuElements";
import type { GameView } from "../../../src/client/view";

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose();
  vi.restoreAllMocks();
});

function mapFixture() {
  const state = { spawned: true, rivalAlive: true, replay: false, national: true };
  const actor = {
    id: () => "nation-a",
    name: () => "Nation A",
    isAlive: () => true,
    hasSpawned: () => state.spawned,
    numTilesOwned: () => state.spawned ? 12 : 0,
    nameLocation: () => ({ x: 40, y: 40 }),
  };
  const rival = {
    id: () => "nation-b",
    name: () => "Nation B",
    isAlive: () => state.rivalAlive,
    hasSpawned: () => state.rivalAlive,
    numTilesOwned: () => state.rivalAlive ? 64 : 0,
    nameLocation: () => ({ x: 100, y: 100 }),
  };
  const nobody = { isPlayer: () => false };
  const game = {
    config: () => ({
      gameConfig: () => ({
        gameType: GameType.Singleplayer,
        nationalMode: state.national,
      }),
      isReplay: () => state.replay,
    }),
    width: () => 200,
    height: () => 200,
    gameID: () => "r11-map-input",
    myPlayer: () => actor,
    players: () => [actor, rival],
    inSpawnPhase: () => !state.spawned,
    isSpectator: () => false,
    isValidCoord: (x: number, y: number) => x >= 0 && x < 200 && y >= 0 && y < 200,
    ref: (x: number, y: number) => y * 200 + x,
    isLand: () => true,
    owner: (tile: number) => {
      const x = tile % 200;
      const y = Math.floor(tile / 200);
      return state.rivalAlive && x >= 95 && x <= 105 && y >= 95 && y <= 105
        ? { ...rival, isPlayer: () => true }
        : nobody;
    },
    nationalPolitics: () => ({ empires: [], warnings: [] }),
    nationalFoundingResults: () => [],
    nationalFoundingOutcome: () => null,
    nationalPoliticalResults: () => [],
    nationalAccessionOffers: () => ({ version: 1, recipientId: "nation-a", offers: [] }),
    nationalConflicts: () => null,
    ticks: () => 12,
  } as unknown as GameView;
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 390, bottom: 844,
    width: 390, height: 844, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  document.body.appendChild(canvas);
  disposals.push(() => canvas.remove());
  const originalElementFromPoint = document.elementFromPoint;
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => canvas,
  });
  disposals.push(() => {
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint,
    });
  });
  const bus = new EventBus();
  const transform = new TransformHandler(game, bus, canvas);
  transform.override(0, 0, 1);
  disposals.push(() => transform.override());
  return { state, actor, rival, game, canvas, bus, transform };
}

function pointer(
  receiver: EventTarget,
  type: "pointerdown" | "pointerup",
  x: number,
  y: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    button: 0, pointerId: 1, pointerType: "touch",
    clientX: x, clientY: y, x, y,
    ctrlKey: false, shiftKey: false,
  });
  receiver.dispatchEvent(event);
}

describe("R11 actual NATIONAL map input and target-aware radial projection", () => {
  it("uses the real transform and GameView owner for a pass-through opponent tile", () => {
    const { game, bus, canvas, transform, state } = mapFixture();
    const locator = new NationalMapTargetController(game, bus, transform, canvas);
    locator.init();
    disposals.push(() => locator.dispose());
    bus.emit(new NationalMapTargetSelectedEvent("nation-b"));
    const marker = document.querySelector<HTMLDivElement>(
      '[data-national-map-target-id="nation-b"]',
    );
    expect(marker).not.toBeNull();
    expect(marker!.hidden).toBe(false);
    expect(marker!.style.pointerEvents).toBe("none");
    const x = Number.parseFloat(marker!.style.left);
    const y = Number.parseFloat(marker!.style.top);
    expect(isNationalOpponentTile(game, transform, "nation-b", x, y)).toBe(true);
    expect(isNationalOpponentTile(game, transform, "nation-a", x, y)).toBe(false);

    state.rivalAlive = false;
    locator.tick();
    expect(document.querySelector("[data-national-map-target-id]")).toBeNull();
    state.rivalAlive = true;
    bus.emit(new NationalMapTargetSelectedEvent("forged-opponent"));
    expect(document.querySelector("[data-national-map-target-id]")).toBeNull();
  });

  it("wires actual UI war-target selection through map marker, native touches and real input events", async () => {
    const { state, game, canvas, bus, transform } = mapFixture();
    const locator = new NationalMapTargetController(game, bus, transform, canvas);
    locator.init();
    disposals.push(() => locator.dispose());
    const panel = document.createElement("national-diplomacy-panel") as NationalDiplomacyPanel;
    panel.game = game;
    panel.eventBus = bus;
    document.body.appendChild(panel);
    disposals.push(() => panel.remove());
    await panel.updateComplete;
    panel.querySelector<HTMLButtonElement>(
      'button[aria-controls="national-diplomacy-content"]',
    )!.click();
    await panel.updateComplete;
    const target = panel.querySelector<HTMLSelectElement>("#national-war-target")!;
    target.value = "nation-b";
    target.dispatchEvent(new Event("change", { bubbles: true }));
    await panel.updateComplete;
    expect(target.value).toBe("nation-b");
    const marker = document.querySelector<HTMLDivElement>(
      '[data-national-map-target-id="nation-b"]',
    )!;
    expect(marker).not.toBeNull();

    // A genuine map input receives pointerdown/up, not a fake Attack intent.
    const input = new InputHandler(game, {
      attackRatio: 20, ghostStructure: null,
      rocketDirectionUp: true, upgradeMultiplier: 1,
    }, canvas, bus);
    input.initialize();
    disposals.push(() => input.destroy());
    const spawnedTouches: MouseUpEvent[] = [];
    const radialTouches: ContextMenuEvent[] = [];
    bus.on(MouseUpEvent, (event) => spawnedTouches.push(event));
    bus.on(ContextMenuEvent, (event) => radialTouches.push(event));
    panel.querySelector<HTMLButtonElement>(
      'button[aria-controls="national-diplomacy-content"]',
    )!.click();
    await panel.updateComplete;

    const x = Number.parseFloat(marker.style.left);
    const y = Number.parseFloat(marker.style.top);
    state.spawned = false;
    pointer(canvas, "pointerdown", x, y);
    pointer(window, "pointerup", x, y);
    expect(spawnedTouches).toHaveLength(1);
    expect(radialTouches).toHaveLength(0);

    state.spawned = true;
    pointer(canvas, "pointerdown", x, y);
    pointer(window, "pointerup", x, y);
    expect(radialTouches).toHaveLength(1);
    expect(radialTouches[0]).toMatchObject({ x, y });
  });

  it("radial target label comes from the real clicked owner and revokes on wrong target or replay", () => {
    const { game, rival, actor, bus, state } = mapFixture();
    const radial = new RadialMenu(
      bus,
      { id: "root", name: "Root", disabled: () => false, subMenu: () => [] },
      { disabled: () => false, action: vi.fn() },
    );
    radial.init();
    disposals.push(() => radial.destroy());
    const params = {
      game, selected: rival, myPlayer: actor,
      tile: 100 * 200 + 100,
    } as unknown as MenuElementParams;
    radial.setParams(params);
    const container = document.querySelector(".radial-menu-container")!;
    expect(container.getAttribute("data-target-player-id")).toBe("nation-b");
    radial.setParams({ ...params, selected: actor } as unknown as MenuElementParams);
    expect(container.hasAttribute("data-target-player-id")).toBe(false);
    state.replay = true;
    radial.setParams(params);
    expect(container.hasAttribute("data-target-player-id")).toBe(false);
    state.replay = false;
    state.national = false;
    radial.setParams(params);
    expect(container.hasAttribute("data-target-player-id")).toBe(false);
  });
});
