// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NationalDiplomacyPanel } from "../../../src/client/NationalDiplomacyPanel";
import "../../../src/client/NationalDiplomacyPanel";
import type {
  NationalFoundingResult,
  NationalPublicPolitics,
} from "../../../src/client/NationalDiplomacyState";
import type { NationalPactDisclosureViewData } from "@openfront/engine-api/game/NationalPactView";
import type { PactReceipt } from "../../../src/client/NationalPactState";
import { SendNationalPactIntentEvent, SendNationalFoundEmpireIntentEvent } from "../../../src/client/Transport";
import type { GameView } from "../../../src/client/view";

const remove: HTMLElement[] = [];

async function mount(
  options: {
    national?: boolean;
    spawned?: boolean;
    alive?: boolean;
    spectator?: boolean;
    replay?: boolean;
    politics?: NationalPublicPolitics | null;
  } = {},
) {
  const optionsState = {
    national: options.national ?? true,
    spawned: options.spawned ?? true,
    alive: options.alive ?? true,
    spectator: options.spectator ?? false,
    replay: options.replay ?? false,
    politics:
      options.politics === undefined
        ? { empires: [], warnings: [] }
        : options.politics,
    tick: 10,
    paused: false,
    results: [] as NationalFoundingResult[],
    disclosure: null as NationalPactDisclosureViewData | null,
    pactReceipts: [] as PactReceipt[],
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
    isSpectator: () =>
      optionsState.spectator || !optionsState.alive || optionsState.replay,
    inSpawnPhase: () => !optionsState.spawned,
    nationalPolitics: () => optionsState.politics,
    nationalPoliticsTick: () => optionsState.tick,
    nationalPactDisclosure: () => optionsState.disclosure,
    nationalPactReceipts: () => optionsState.pactReceipts,
    nationalFoundingOutcome: () => null,
    nationalFoundingResults: () => optionsState.results,
    ticks: () => optionsState.tick,
    isPaused: () => optionsState.paused,
    gameID: () => "national-test",
    players: () => [player, { ...player, id: () => "nation-b", name: () => "B Nation" }, { ...player, id: () => "nation-c", name: () => "C Nation" }],
  } as unknown as GameView;
  const eventBus = new EventBus();
  const requests: SendNationalFoundEmpireIntentEvent[] = [];
  eventBus.on(SendNationalFoundEmpireIntentEvent, (event) =>
    requests.push(event),
  );
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
  return { element, eventBus, optionsState, requests };
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
    expect(replay.element.querySelector("#national-empire-id")).toBeNull();
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
    const spectator = await mount({ spectator: true });
    expect(
      spectator.element.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!.disabled,
    ).toBe(true);
    expect(spectator.element.textContent).toContain(
      "Only an active, living nation",
    );
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
    expect(element.textContent).toContain(
      "Engine delivery and outcome are unverified",
    );
    expect(element.textContent).not.toContain("Confirmed by game");
    expect(
      element.querySelector<HTMLButtonElement>('button[type="submit"]')!
        .disabled,
    ).toBe(true);
  });

  it("exposes exact pending founder ID and actual tick/pause without implying worker delivery", async () => {
    const { element, requests, optionsState } = await mount();
    const input = element.querySelector<HTMLInputElement>(
      "#national-empire-id",
    )!;
    input.value = "Atlas";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await element.updateComplete;

    expect(requests).toHaveLength(1);
    const status = element.querySelector<HTMLElement>(
      "[data-national-founding-tick]",
    )!;
    expect(status.dataset.nationalFoundingRequestId).toBe(
      requests[0].requestId,
    );
    expect(status.dataset.nationalFoundingActorId).toBe("nation-a");
    expect(status.textContent).toContain("Submitted at Game tick");
    expect(status.textContent).toContain(
      "No matching accepted receipt observed yet",
    );
    expect(element.textContent).not.toContain("Confirmed by game");

    optionsState.tick = 13;
    optionsState.paused = true;
    element.refresh();
    await element.updateComplete;
    expect(
      element.querySelector("[data-national-founding-tick]")?.textContent,
    ).toMatch(/current Game tick\s+13, pause\s+active/);
    expect(element.textContent).not.toContain("Confirmed by game");
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
    expect(element.querySelector("#national-empire-id")).toBeNull();
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
      ]),
    );
    // Political roles are now available when authorized, not permanently
    // disabled cosmetic placeholders. A nation without an invitation cannot
    // accept and cannot claim emperor powers.
    expect(
      element.querySelector<HTMLButtonElement>("#national-accept-accession")!
        .disabled,
    ).toBe(true);
    expect(element.querySelector("#national-offer-accession")).toBeNull();
    expect(element.querySelector("#national-transfer-crown")).toBeNull();
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
  it("reports the engine rejection reason without claiming an empire", async () => {
    const { element, optionsState, requests } = await mount();
    const input = element.querySelector<HTMLInputElement>(
      "#national-empire-id",
    )!;
    input.value = "Atlas";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    optionsState.tick = 11;
    optionsState.results = [
      {
        type: "national_found_empire",
        recipientId: "nation-a",
        actorId: "nation-a",
        empireId: "Atlas",
        accepted: false,
        tick: 11,
        requestId: requests[0].requestId,
        sequence: 1,
        reason: "actor-inactive",
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(
      element
        .querySelector("[data-national-phase]")
        ?.getAttribute("data-national-phase"),
    ).toBe("rejected");
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      "actor-inactive",
    );
    expect(element.textContent).not.toContain("Confirmed by game");
    expect(
      element.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(false);
  });

  it("waits for roster after a real accepted result, even when journal entry is no longer on next tick", async () => {
    const { element, optionsState, requests } = await mount();
    const input = element.querySelector<HTMLInputElement>(
      "#national-empire-id",
    )!;
    input.value = "Atlas";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    optionsState.tick = 11;
    optionsState.results = [
      {
        type: "national_found_empire",
        recipientId: "nation-a",
        actorId: "nation-a",
        empireId: "Atlas",
        accepted: true,
        tick: 11,
        requestId: requests[0].requestId,
        sequence: 2,
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).not.toContain("Confirmed by game");
    expect(
      element
        .querySelector("[data-national-phase]")
        ?.getAttribute("data-national-phase"),
    ).toBe("pending");
    optionsState.results = [];
    optionsState.tick = 12;
    optionsState.politics = {
      empires: [{ id: "Atlas", leaderId: "nation-a", memberIds: ["nation-a"] }],
      warnings: [],
    };
    element.refresh();
    await element.updateComplete;
    expect(
      element
        .querySelector("[data-national-phase]")
        ?.getAttribute("data-national-phase"),
    ).toBe("accepted");
    expect(element.textContent).toContain("Confirmed by game");
    expect(element.textContent).toContain("You are the emperor.");

    // The next public packet loses that membership. Don't keep a success
    // toast or stale empire when the GameRunner no longer reports it.
    optionsState.politics = { empires: [], warnings: [] };
    optionsState.tick = 13;
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).not.toContain("Confirmed by game");
    expect(element.textContent).not.toContain("You are the emperor.");
  });

  it("shows actual Ungovernable warnings and allows unknown on lost connection", async () => {
    const { element, optionsState } = await mount();
    optionsState.politics = {
      empires: [{ id: "Atlas", leaderId: "nation-b", memberIds: ["nation-b"] }],
      warnings: [
        {
          empireId: "Atlas",
          deadlineMs: 30000,
          remainingMs: 5000,
          blockedByAssetDisposition: true,
        },
      ],
    };
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("Ungovernable warnings");
    expect(element.textContent).toContain("5 seconds");
    expect(element.textContent).toContain("Dissolution is deferred");

    const input = element.querySelector<HTMLInputElement>(
      "#national-empire-id",
    )!;
    input.value = "OtherEmpire";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    element.connectionInterrupted();
    await element.updateComplete;
    expect(
      element
        .querySelector("[data-national-phase]")
        ?.getAttribute("data-national-phase"),
    ).toBe("unknown");
    expect(element.textContent).toContain("Connection interrupted");
    expect(element.textContent).not.toContain("Confirmed by game");
  });

  it("generates a unique request token for two real clicks in the same engine tick", async () => {
    const { element, optionsState, requests } = await mount();
    const input = element.querySelector<HTMLInputElement>(
      "#national-empire-id",
    )!;
    input.value = "Atlas";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await element.updateComplete;

    const submit = element.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    submit.click();
    submit.click();
    await element.updateComplete;
    expect(requests).toHaveLength(1);
    expect(requests[0].requestId).toMatch(/^nf_[0-9a-f]{32}$/);

    // E1 rejects first attempt but the UI remains in the same game tick.
    optionsState.results = [
      {
        type: "national_found_empire",
        actorId: "nation-a",
        recipientId: "nation-a",
        empireId: "Atlas",
        accepted: false,
        tick: 10,
        sequence: 1,
        requestId: requests[0].requestId,
        reason: "political-rule",
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(
      element
        .querySelector("[data-national-phase]")
        ?.getAttribute("data-national-phase"),
    ).toBe("rejected");

    element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await element.updateComplete;
    expect(requests).toHaveLength(2);
    expect(requests[1].requestId).toMatch(/^nf_[0-9a-f]{32}$/);
    expect(requests[1].requestId).not.toBe(requests[0].requestId);

    // Wrong click's same-tick acceptance and the correct current roster do
    // not confirm this new request.
    optionsState.politics = {
      empires: [{ id: "Atlas", leaderId: "nation-a", memberIds: ["nation-a"] }],
      warnings: [],
    };
    optionsState.results = [
      {
        type: "national_found_empire",
        actorId: "nation-a",
        recipientId: "nation-a",
        empireId: "Atlas",
        accepted: true,
        tick: 10,
        sequence: 3,
        requestId: requests[0].requestId,
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(
      element
        .querySelector("[data-national-phase]")
        ?.getAttribute("data-national-phase"),
    ).toBe("pending");
    expect(element.textContent).not.toContain("Confirmed by game");

    optionsState.results.push({
      type: "national_found_empire",
      actorId: "nation-a",
      recipientId: "nation-a",
      empireId: "Atlas",
      accepted: true,
      tick: 10,
      sequence: 4,
      requestId: requests[1].requestId,
    });
    element.refresh();
    await element.updateComplete;
    expect(
      element
        .querySelector("[data-national-phase]")
        ?.getAttribute("data-national-phase"),
    ).toBe("accepted");
    expect(element.textContent).toContain("Confirmed by game");
  });

  it("never confirms a pending request after switching to replay", async () => {
    const { element, optionsState, requests } = await mount();
    const input = element.querySelector<HTMLInputElement>(
      "#national-empire-id",
    )!;
    input.value = "Atlas";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    expect(requests).toHaveLength(1);
    optionsState.replay = true;
    optionsState.politics = {
      empires: [{ id: "Atlas", leaderId: "nation-a", memberIds: ["nation-a"] }],
      warnings: [],
    };
    optionsState.results = [
      {
        type: "national_found_empire",
        actorId: "nation-a",
        recipientId: "nation-a",
        empireId: "Atlas",
        accepted: true,
        tick: 10,
        sequence: 1,
        requestId: requests[0].requestId,
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(
      element
        .querySelector("[data-national-phase]")
        ?.getAttribute("data-national-phase"),
    ).toBe("unknown");
    expect(element.textContent).not.toContain("Confirmed by game");
    expect(element.querySelector("#national-empire-id")).toBeNull();
  });

  it("never shows active-player acceptance after spectator transition or elimination", async () => {
    const { element, optionsState, requests } = await mount();
    const input = element.querySelector<HTMLInputElement>(
      "#national-empire-id",
    )!;
    input.value = "Atlas";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    optionsState.tick = 11;
    optionsState.alive = false;
    optionsState.politics = {
      empires: [{ id: "Atlas", leaderId: "nation-a", memberIds: ["nation-a"] }],
      warnings: [],
    };
    optionsState.results = [
      {
        type: "national_found_empire",
        actorId: "nation-a",
        recipientId: "nation-a",
        empireId: "Atlas",
        accepted: true,
        tick: 10,
        sequence: 1,
        requestId: requests[0].requestId,
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(
      element
        .querySelector("[data-national-phase]")
        ?.getAttribute("data-national-phase"),
    ).toBe("unknown");
    expect(element.textContent).not.toContain("Confirmed by game");
  });

  it("never treats a resumed member roster or old accepted result as this click's success", async () => {
    const { element, optionsState, requests } = await mount();
    const input = element.querySelector<HTMLInputElement>(
      "#national-empire-id",
    )!;
    input.value = "Atlas";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    optionsState.politics = {
      empires: [{ id: "Atlas", leaderId: "nation-a", memberIds: ["nation-a"] }],
      warnings: [],
    };
    optionsState.tick = 11;
    optionsState.results = [
      {
        type: "national_found_empire",
        recipientId: "nation-a",
        actorId: "nation-a",
        empireId: "Atlas",
        accepted: true,
        tick: 9,
        requestId: requests[0].requestId,
        sequence: 3,
      },
    ];
    element.refresh();
    await element.updateComplete;
    expect(element.textContent).toContain("You are the emperor.");
    expect(element.textContent).not.toContain("Confirmed by game");
    optionsState.tick = 210;
    element.refresh();
    await element.updateComplete;
    expect(
      element
        .querySelector("[data-national-phase]")
        ?.getAttribute("data-national-phase"),
    ).toBe("unknown");
  });
});

describe("C4 E4 native constitutional controls", () => {
  const terms = { admission: "leader", expulsion: "leader" } as const;
  const pact = { id: "pact", name: "North Sea", kind: "MDA", memberIds: ["nation-a", "nation-b"], administratorId: "nation-a" } as const;
  it("invited candidate reads terms, stale consent cannot dispatch, rejection is not membership", async () => {
    const { element, eventBus, optionsState } = await mount();
    const requests: SendNationalPactIntentEvent[] = [];
    eventBus.on(SendNationalPactIntentEvent, (e) => requests.push(e));
    optionsState.politics = { empires: [], warnings: [], pacts: [{ ...pact, memberIds: ["nation-b"], administratorId: "nation-b" }] };
    optionsState.disclosure = { version: 1, recipientId: "nation-a", pacts: [{ pactId: pact.id, relationship: "invited", terms }] };
    element.refresh();
    await element.updateComplete;
    expect(element.querySelector("[data-national-pact-terms]")?.textContent).toContain("expulsion leader");
    const old = element.querySelector<HTMLButtonElement>('[data-national-pact-action="accept"]')!;
    optionsState.disclosure = { ...optionsState.disclosure, pacts: [{ pactId: pact.id, relationship: "invited", terms: { ...terms, expulsion: "forbidden" } }] };
    old.click();
    expect(requests).toHaveLength(0);
    element.refresh();
    await element.updateComplete;
    element.querySelector<HTMLButtonElement>('[data-national-pact-action="accept"]')!.click();
    await element.updateComplete;
    expect(requests).toHaveLength(1);
    expect(requests[0].intent).toMatchObject({ type: "national_accept_pact", pactId: pact.id, requestId: /^np_[0-9a-f]{32}$/ });
    expect(element.querySelector('[data-national-pact-action="betray"]')).toBeNull();
    expect(element.querySelector("[data-national-pact-status]")?.textContent).toContain("Pending");
    optionsState.pactReceipts = [{ type: "national_accept_pact", requestId: requests[0].intent.requestId, actorId: "nation-a", recipientId: "nation-a", commandTargetId: pact.id, tick: 11, sequence: 1, accepted: false, reason: "political-rule" }];
    optionsState.tick = 11;
    element.refresh();
    await element.updateComplete;
    expect(element.querySelector("[data-national-pact-status]")?.textContent).toContain("rejected");
    optionsState.disclosure = { ...optionsState.disclosure, pacts: [] };
    element.refresh();
    await element.updateComplete;
    expect(element.querySelector("[data-national-pact-terms]")).toBeNull();
    expect(element.querySelector('[data-national-pact-action="accept"]')).toBeNull();
    expect(element.querySelector("[data-national-pact-id]")?.textContent).toContain("North Sea");
  });
  it("member sees actual proposal, cannot expel by unanimous rule, confirms betrayal, and Escape returns focus", async () => {
    const { element, eventBus, optionsState } = await mount();
    const requests: SendNationalPactIntentEvent[] = [];
    eventBus.on(SendNationalPactIntentEvent, (e) => requests.push(e));
    optionsState.politics = { empires: [], warnings: [], pacts: [pact] };
    optionsState.disclosure = { version: 1, recipientId: "nation-a", pacts: [{ pactId: pact.id, relationship: "member", terms: { ...terms, expulsion: "unanimous" }, pendingAmendment: { terms, administratorId: "nation-b", approvedBy: ["nation-b"] } }] };
    element.refresh();
    await element.updateComplete;
    expect(element.querySelector("[data-national-pact-amendment]")?.textContent).toContain("Proposed constitution");
    expect(element.querySelector('[data-national-pact-action="expel"]')).toBeNull();
    const leave = element.querySelector<HTMLButtonElement>('[data-national-pact-action="betray"]')!;
    leave.click();
    expect(requests).toHaveLength(0);
    const confirm = leave.closest("form")!.querySelector<HTMLInputElement>('input[name="confirm"]')!;
    confirm.checked = true;
    leave.click();
    await element.updateComplete;
    expect(requests[0].intent.type).toBe("national_betray_pact");
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // Keyboard event on the actual panel section, rather than the custom host.
    element.querySelector("section")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await element.updateComplete;
    expect(element.querySelector("#national-diplomacy-content")).toBeNull();
    expect(document.activeElement).toBe(element.querySelector('[aria-controls="national-diplomacy-content"]'));
  });
});
