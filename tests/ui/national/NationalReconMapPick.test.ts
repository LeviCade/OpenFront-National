// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NationalMapTargetController,
  NationalReconMapPickRequestedEvent,
  NationalReconMapPointSelectedEvent,
} from "../../../src/client/controllers/NationalMapTargetController";
import type { TransformHandler } from "../../../src/client/TransformHandler";
import type { GameView } from "../../../src/client/view";

const instances: { controller: NationalMapTargetController; surface: HTMLElement }[] = [];

function mount(options: { private?: boolean; replay?: boolean; spectator?: boolean } = {}) {
  const surface = document.createElement("div");
  document.body.appendChild(surface);
  surface.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 390,
      bottom: 844,
      width: 390,
      height: 844,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  const bus = new EventBus();
  const game = {
    gameID: () => "map-session",
    config: () => ({
      gameConfig: () => ({
        nationalMode: true,
        gameType: options.private ? GameType.Private : GameType.Singleplayer,
      }),
      isReplay: () => options.replay ?? false,
    }),
    myPlayer: () => ({ id: () => "nation-a", isAlive: () => true, hasSpawned: () => true }),
    isSpectator: () => options.spectator ?? false,
    inSpawnPhase: () => false,
    isTrustedNationalProjection: () => options.private ?? false,
    trustedProjectionReady: () => options.private ?? false,
    isValidCoord: (x: number, y: number) => x >= 0 && x < 128 && y >= 0 && y < 128,
  } as unknown as GameView;
  const transform = {
    screenToWorldCoordinates: () => ({ x: 12, y: 34 }),
  } as unknown as TransformHandler;
  const controller = new NationalMapTargetController(game, bus, transform, surface);
  controller.init();
  instances.push({ controller, surface });
  const selected: NationalReconMapPointSelectedEvent[] = [];
  bus.on(NationalReconMapPointSelectedEvent, (event) => selected.push(event));
  const tap = (x: number, y: number, button = 0) => {
    const event = new Event("pointerdown", { cancelable: true, bubbles: true });
    Object.defineProperties(event, {
      button: { value: button },
      isPrimary: { value: true },
      clientX: { value: x },
      clientY: { value: y },
    });
    surface.dispatchEvent(event);
    return event;
  };
  return { bus, controller, selected, surface, tap };
}

afterEach(() => {
  for (const { controller, surface } of instances.splice(0)) {
    controller.dispose();
    surface.remove();
  }
  vi.restoreAllMocks();
});

describe("E1 actual map touch, 390x844 and hostile map selections", () => {
  it("captures one real map tap without allowing an attack pointerdown", () => {
    const { bus, selected, surface, tap } = mount();
    let gameplayPointers = 0;
    surface.addEventListener("pointerdown", () => gameplayPointers++);
    bus.emit(new NationalReconMapPickRequestedEvent("map-session", true));
    expect(surface.style.cursor).toBe("crosshair");
    const event = tap(195, 422);
    expect(event.defaultPrevented).toBe(true);
    expect(gameplayPointers).toBe(0);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ gameId: "map-session", x: 12, y: 34 });
    expect(surface.style.cursor).toBe("");
    tap(200, 500);
    expect(selected).toHaveLength(1);
    expect(gameplayPointers).toBe(1);
  });

  it("rejects cross-game requests, out-of-map taps, secondary clicks and cancellation", () => {
    const { bus, tap, selected } = mount();
    bus.emit(new NationalReconMapPickRequestedEvent("other-session", true));
    tap(10, 40);
    expect(selected).toHaveLength(0);
    bus.emit(new NationalReconMapPickRequestedEvent("map-session", true));
    tap(400, 40);
    tap(20, 40, 2);
    expect(selected).toHaveLength(0);
    bus.emit(new NationalReconMapPickRequestedEvent("map-session", false));
    tap(20, 40);
    expect(selected).toHaveLength(0);
  });

  it("spectator, replay and unadmitted Private seats cannot select", () => {
    for (const option of [
      { replay: true },
      { spectator: true },
      { private: true },
    ]) {
      const { bus, selected, tap } = mount(option);
      bus.emit(new NationalReconMapPickRequestedEvent("map-session", true));
      tap(100, 300);
      expect(selected).toHaveLength(0);
    }
  });
});
