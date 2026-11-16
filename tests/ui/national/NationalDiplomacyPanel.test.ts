// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NationalDiplomacyPanel } from "../../../src/client/NationalDiplomacyPanel";
import "../../../src/client/NationalDiplomacyPanel";
import type { NationalPublicPolitics } from "../../../src/client/NationalDiplomacyState";
import { SendNationalFoundEmpireIntentEvent } from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";

const remove: HTMLElement[] = [];

async function mount(
  options: {
    national?: boolean;
    spawned?: boolean;
    alive?: boolean;
    replay?: boolean;
    politics?: NationalPublicPolitics | null;
  } = {},
) {
  const optionsState = {
    national: options.national ?? true,
    spawned: options.spawned ?? true,
    alive: options.alive ?? true,
    replay: options.replay ?? false,
    politics:
      options.politics === undefined
        ? { empires: [], warnings: [] }
        : options.politics,
    tick: 10,
    results: [] as Array<{
      type: "national_found_empire";
      recipientId: string;
      actorId: string;
      empireId: string;
      accepted: boolean;
      tick: number;
      reason?: string;
    }>,
  };
  const player = {
    id: () => "nation-a",
    name: () => "A Nation",
    isAlive: () => optionsState.alive,
    numTilesOwned: () => (optionsState.spawned ? 3 : 0),
  };
  const game = {
    config: () => ({
      gameConfig: () => ({
        nationalMode: optionsState.national,
        gameType: GameType.Singleplayer,
      }),
      isReplay: () => optionsState.replay,
    }),
    myPlayer: () => player,
    isSpectator: () => !optionsState.alive || optionsState.replay,
    inSpawnPhase: () => !optionsState.spawned,
    nationalPolitics: () => optionsState.politics,
    nationalFoundingOutcome: () => null,
    nationalFoundingResults: () => optionsState.results,
    ticks: () => optionsState.tick,
    gameID: () => "national-test",
    players: () => [player],
  } as unknown as GameView;
  const eventBus = new EventBus();
  const element = document.createElement(
    "national-diplomacy-panel",
  ) as NationalDiplomacyPanel;
  element.game = game;
  element.eventBus = eventBus;
  document.body.appendChild(element);
  remove.push(element);
  await element.updateComplete;
  const toggle = element.querySelector<HTMLButtonElement>(
    'button[aria-controls="national-diplomacy-content"]',
  )!;
  if (toggle) {
    toggle.click();
    await element.updateComplete;
  }
  return { element, eventBus, optionsState };
}

afterEach(() => {
  for (const element of remove.splice(0)) element.remove();
  vi.restoreAllMocks();
});

describe("NATIONAL player-facing founding", () => {
  it("keeps ordinary Solo untouched, but shows read-only NATIONAL replay roster", async () => {
    const { element } = await mount({ national: false });
    expect(element.querySelector("button")).toBeNull();
    const replay = await mount({ replay: true });
    expect(replay.element.textContent).toContain("Replay is read-only");
    expect(replay.element.querySelector('button[type="submit"]')).toBeNull();
  });

  it("disables founding until the real player has spawned and remains alive", async () => {
    const { element } = await mount({ spawned: false });
    const button = element.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    expect(button.disabled).toBe(true);
    expect(element.textContent).toContain("Spawn before founding");

    const dead = await mount({ alive: false });
    expect(
      dead.element.querySelector<HTMLButtonElement>('button[type="submit"]')!
        .disabled,
    ).toBe(true);
  });

  it("clicking Found Empire enqueues exactly one real intent, not local success", async () => {
    const { element, eventBus } = await mount();
    const sent: string[] = [];
    eventBus.on(SendNationalFoundEmpireIntentEvent, (event) =>
      sent.push(event.empireId),
    );
    const input = element.querySelector<HTMLInputElement>(
      "#national-empire-id",
    )!;
    input.value = "Atlas_Empire";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await element.updateComplete;

    const submit = element.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    submit.click();
    submit.click();
    await element.updateComplete;

    expect(sent).toEqual(["Atlas_Empire"]);
    expect(element.textContent).toContain("Awaiting its accepted or rejected result");
    expect(element.textContent).not.toContain("Confirmed by game");
    expect(
      element.querySelector<HTMLButtonElement>('button[type="submit"]')!
        .disabled,
    ).toBe(true);
  });

  it("shows confirmed leadership only after authoritative state arrives, including restored games", async () => {
    const { element, optionsState } = await mount({ politics: null });
    expect(element.textContent).toContain(
      "Verified political state has not arrived",
    );
    optionsState.politics = {
      empires: [
        { id: "Atlas_Empire", leaderId: "nation-a", memberIds: ["nation-a"] },
      ],
      warnings: [],
    };
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("You are the emperor.");
    expect(element.textContent).not.toContain("Confirmed by game");
    expect(element.textContent).toMatch(/Leader:\s+A Nation/);
    expect(element.querySelector('button[type="submit"]')).toBeNull();
  });

  it("keeps unavailable diplomacy actions disabled and the panel keyboard accessible", async () => {
    const { element } = await mount();
    const unavailable = [
      ...element.querySelectorAll<HTMLButtonElement>("button[disabled]"),
    ];
    expect(unavailable.map((button) => button.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Non-aggression pact"),
        expect.stringContaining("Mutual defense pact"),
        expect.stringContaining("Offer peace"),
      ]),
    );
    const toggle = element.querySelector<HTMLButtonElement>(
      'button[aria-controls="national-diplomacy-content"]',
    )!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    element
      .querySelector("section")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    await element.updateComplete;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
