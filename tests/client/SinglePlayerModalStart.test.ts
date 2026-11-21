import {
  Difficulty,
  GameMode,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    requestMidgameAd: vi.fn(async () => {}),
  },
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: vi.fn() },
}));

// Side-effect import so the custom element registers (a type-only import
// would be elided and createElement would return an inert element).
import "../../src/client/SinglePlayerModal";

function createModal(): any {
  return document.createElement("single-player-modal") as any;
}

describe("SinglePlayerModal start", () => {
  it("offers NATIONAL as explicit Solo opt-in and starts with the genuine engine config", async () => {
    const modal = createModal();
    const events: any[] = [];
    modal.addEventListener("join-lobby", (event: Event) =>
      events.push((event as CustomEvent).detail),
    );
    modal.handleConfigNationalModeSelected(
      new CustomEvent("national-mode-selected", {
        detail: { enabled: true },
      }),
    );
    expect(modal.nationalMode).toBe(true);
    expect(modal.gameMode).toBe(GameMode.FFA);
    expect(modal.selectedDifficulty).toBe(Difficulty.Impossible);
    await modal.startGame();
    expect(events).toHaveLength(1);
    expect(events[0].gameStartInfo.config).toMatchObject({
      nationalMode: true,
      difficulty: Difficulty.Impossible,
      gameMode: GameMode.FFA,
    });
  });

  it("switching back to Impossible is ordinary Solo, never a hidden NATIONAL default", async () => {
    const modal = createModal();
    modal.handleConfigNationalModeSelected(
      new CustomEvent("national-mode-selected", {
        detail: { enabled: true },
      }),
    );
    modal.handleConfigDifficultySelected(
      new CustomEvent("difficulty-selected", {
        detail: { difficulty: Difficulty.Impossible },
      }),
    );
    expect(modal.nationalMode).toBe(false);
    const events: any[] = [];
    modal.addEventListener("join-lobby", (event: Event) =>
      events.push((event as CustomEvent).detail),
    );
    await modal.startGame();
    expect(events).toHaveLength(1);
    expect(events[0].gameStartInfo.config.nationalMode).toBeUndefined();
    expect(events[0].gameStartInfo.config.difficulty).toBe(Difficulty.Impossible);
  });

  it("carries the selected team count and validated disabled units into the join-lobby config", async () => {
    const modal = createModal();
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );

    // Selection arrives via the game-config-settings child event.
    modal.handleConfigTeamCountSelected(
      new CustomEvent("team-count-selected", { detail: { count: 4 } }),
    );
    // One real unit and one junk entry: the start path must keep only
    // values that are actual UnitTypes.
    modal.disabledUnits = [UnitType.Warship, "Bogus"];

    await modal.startGame();

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("singleplayer");
    const config = events[0].gameStartInfo.config;
    expect(config.playerTeams).toBe(4);
    expect(config.disabledUnits).toEqual([UnitType.Warship]);
  });
});
