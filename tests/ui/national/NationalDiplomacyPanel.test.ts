// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NationalPublicPolitics } from "../../../src/client/NationalDiplomacyState";
import "../../../src/client/NationalDiplomacyPanel";
import type { NationalDiplomacyPanel } from "../../../src/client/NationalDiplomacyPanel";
import { SendNationalFoundEmpireIntentEvent } from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";

const remove: HTMLElement[] = [];

async function mount(options: {
  national?: boolean;
  spawned?: boolean;
  alive?: boolean;
  replay?: boolean;
  politics?: NationalPublicPolitics | null;
} = {}) {
  const optionsState = {
    national: options.national ?? true,
    spawned: options.spawned ?? true,
    alive: options.alive ?? true,
    replay: options.replay ?? false,
    politics: options.politics ?? null,
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
  it("does not render inside ordinary Solo or replay", async () => {
    const { element } = await mount({ national: false });
    expect(element.querySelector("button")).toBeNull();
    const replay = await mount({ replay: true });
    expect(replay.element.querySelector("button")).toBeNull();
  });

  it("disables founding until the real player has spawned and remains alive", async () => {
    const { element } = await mount({ spawned: false });
    const button = element.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBe(true);
    expect(element.textContent).toContain("Spawn before founding");

    const dead = await mount({ alive: false });
    expect(dead.element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it("clicking Found Empire enqueues exactly one real intent, not local success", async () => {
    const { element, eventBus } = await mount();
    const sent: string[] = [];
    eventBus.on(SendNationalFoundEmpireIntentEvent, (event) => sent.push(event.empireId));
    const input = element.querySelector<HTMLInputElement>("#national-empire-id")!;
    input.value = "Atlas_Empire";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await element.updateComplete;

    const submit = element.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit.click();
    submit.click();
    await element.updateComplete;

    expect(sent).toEqual(["Atlas_Empire"]);
    expect(element.textContent).toContain("Awaiting authoritative game state");
    expect(element.textContent).not.toContain("Confirmed by game");
    expect(element.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });

  it("shows confirmed leadership only after authoritative state arrives, including restored games", async () => {
    const { element, optionsState } = await mount();
    expect(element.textContent).toContain("Verified political state has not arrived");
    optionsState.politics = {
      empires: [{ id: "Atlas_Empire", leaderId: "nation-a", memberIds: ["nation-a"] }],
    };
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("You are the emperor.");
    expect(element.textContent).toContain("Leader: A Nation");
    expect(element.querySelector('button[type="submit"]')).toBeNull();
  });

  it("keeps unavailable diplomacy actions disabled and the panel keyboard accessible", async () => {
    const { element } = await mount();
    const unavailable = [...element.querySelectorAll<HTMLButtonElement>("button[disabled]")];
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
    element.querySelector("section")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await element.updateComplete;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
