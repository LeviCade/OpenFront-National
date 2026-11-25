// @vitest-environment jsdom
import { GameType } from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  type GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import type { WireGameStartInfo } from "@openfront/shared/WireSchemas";
import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../src/client/hud/layers/WinModal";
import { readNationalPolitics } from "../../../src/client/NationalDiplomacyState";
import { NationalObserverMapContinuity } from "../../../src/client/NationalObserverMapContinuity";
import {
  acceptTrustedNationalPrivateCapability,
  revokeTrustedNationalPrivateCapability,
} from "../../../src/client/NationalPrivateCapability";
import {
  nationalCrisisAt,
  nationalVictoryAt,
} from "../../../src/client/NationalVictoryExperience";
import {
  SendNationalTransferCrownIntentEvent,
  SendWinnerEvent,
} from "../../../src/client/Transport";
import {
  materializeTrustedNationalUpdate,
  parseTrustedNationalProjection,
  readTrustedVictory,
} from "../../../src/client/TrustedNationalSession";
import type { GameView } from "../../../src/client/view";
import { encodeNationalRecipientProjection } from "../../../src/server/national/NationalRecipientWire";
import {
  A,
  B,
  C,
  I,
  EMPIRE,
  infos,
  scenario,
} from "../../national/C6C2E6Scenario";
import { makeGameView, stubConfig } from "../../util/viewStubs";

vi.mock("../../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  getTranslatedPlayerTeamLabel: (team: string) => team,
  getGamesPlayed: () => 10,
  isInIframe: () => false,
  homeHref: () => "/",
  TUTORIAL_VIDEO_URL: "https://example.com/tutorial",
}));
vi.mock("../../../src/client/Api", () => ({
  getUserMe: vi.fn(async () => null),
}));
vi.mock("../../../src/client/Cosmetics", async (original) => ({
  ...(await original<typeof import("../../../src/client/Cosmetics")>()),
  fetchCosmetics: vi.fn(async () => null),
  resolveCosmetics: vi.fn(() => []),
}));
vi.mock("../../../src/client/GamePortal", () => ({
  gamePortal: { happytime: vi.fn(), gameplayStop: vi.fn(), name: () => null },
}));

const modals: WinModal[] = [];
type Match = Awaited<ReturnType<typeof scenario>>;
function mount(m: Match, actor: string | null, privateMode = false) {
  let frame: GameUpdateViewData = m.packet();
  let replay = false;
  const bus = new EventBus();
  const events: SendNationalTransferCrownIntentEvent[] = [];
  const votes: SendWinnerEvent[] = [];
  bus.on(SendNationalTransferCrownIntentEvent, (e) => events.push(e));
  bus.on(SendWinnerEvent, (e) => votes.push(e));
  const players = infos
    .filter((p) => m.game.hasPlayer(p.id))
    .map((p) => ({
      id: () => p.id,
      clientID: () => p.clientID,
      displayName: () => p.name,
      name: () => p.name,
      isAlive: () => m.game.player(p.id).isAlive(),
      hasSpawned: () => m.game.player(p.id).hasSpawned(),
    }));
  const modal = document.createElement("win-modal") as WinModal;
  modal.eventBus = bus;
  modal.game = {
    config: () => ({
      gameConfig: () => ({
        nationalMode: true,
        gameType: privateMode ? GameType.Private : GameType.Singleplayer,
      }),
      isReplay: () => replay,
    }),
    gameID: () => "e6-test",
    ticks: () => frame.tick,
    nationalPoliticsTick: () => frame.tick,
    nationalPolitics: () => readNationalPolitics(frame.nationalPolitics),
    nationalPoliticalResults: () => [],
    updatesSinceLastTick: () => frame.updates,
    isTrustedNationalProjection: () => privateMode,
    trustedProjectionReady: () => true,
    trustedNationalPrincipal: () => privateMode ? actor : null,
    myPlayer: () => players.find((p) => p.id() === actor) ?? null,
    players: () => players,
    isSpectator: () => actor === null || replay,
    inSpawnPhase: () => false,
    resumedFromSave: () => true,
  } as unknown as GameView;
  // Suppress external cosmetic promotion only; real modal, title, action and
  // game ticks are unchanged.
  vi.spyOn(modal, "innerHtml").mockReturnValue(html``);
  document.body.append(modal);
  modals.push(modal);
  return {
    modal,
    events,
    votes,
    replay: () => {
      replay = true;
    },
    async update(next = m.packet()) {
      frame = next;
      modal.tick();
      await modal.updateComplete;
    },
  };
}
afterEach(() => {
  for (const modal of modals.splice(0)) modal.remove();
  vi.restoreAllMocks();
});

function mountPrivate(m: Match, actor: string) {
  const recipient = m.registerRecipient(actor);
  const clientID = infos.find((p) => p.id === actor)!.clientID!;
  const bus = new EventBus();
  const config = stubConfig({
    gameConfig: () => ({
      ...m.game.config().gameConfig(),
      gameType: GameType.Private,
    }),
    isReplay: () => false,
  });
  const view = makeGameView({
    width: m.game.width(),
    height: m.game.height(),
    config,
    myClientID: clientID,
    trustedProjection: true,
  });
  view.setTrustedPrincipal(actor);
  const continuity = new NationalObserverMapContinuity(actor);
  const start = {
    gameID: view.gameID(),
    config: config.gameConfig(),
    players: infos.map((p) => ({ clientID: p.clientID })),
  } as WireGameStartInfo;
  expect(
    acceptTrustedNationalPrivateCapability(
      bus,
      {
        type: "national_start",
        gameStartInfo: start,
        myClientID: clientID,
        tick: m.game.ticks(),
      },
      {
        gameID: view.gameID(),
        start,
        startClientID: clientID,
        remoteSocketOpen: true,
        sessionReady: true,
        replay: false,
        spectator: false,
      },
    ),
  ).toBe(true);
  const modal = document.createElement("win-modal") as WinModal;
  modal.eventBus = bus;
  modal.game = view;
  vi.spyOn(modal, "innerHtml").mockReturnValue(html``);
  const events: SendNationalTransferCrownIntentEvent[] = [];
  bus.on(SendNationalTransferCrownIntentEvent, (e) => events.push(e));
  document.body.append(modal);
  modals.push(modal);
  let prior = -1;
  const flush = async () => {
    for (const raw of recipient.drain()) {
      const decoded = parseTrustedNationalProjection(
        encodeNationalRecipientProjection(raw),
        raw.tick,
      );
      const delta = continuity.acceptProjection(decoded);
      const update = materializeTrustedNationalUpdate(decoded, prior);
      prior = update.tick;
      if (delta.clearAllTiles) view.resetTrustedTileSight();
      view.reconcileTrustedTileVisibility(delta.removedTileRefs);
      view.reconcileTrustedUnitVisibility(
        delta.clearAllUnits,
        delta.removedUnitIds,
      );
      update.packedUnitUpdates = delta.nativeUnits;
      view.applyTrustedUnitPage(update, delta, continuity);
      view.setTrustedProjectionReady(delta.usable);
      view.update(update);
      modal.tick();
      await modal.updateComplete;
    }
  };
  return { recipient, bus, view, modal, events, flush };
}

describe("C6C2 E6 native NATIONAL victory UI", () => {
  it("binds the actual registered Private recipient through GameView, revokes stale crown controls", async () => {
    const m = await scenario();
    const { recipient, bus, view, modal, events, flush } = mountPrivate(m, A);
    for (let i = 0; i < 10 && !view.trustedProjectionReady(); i++) {
      m.tick();
      await flush();
    }
    expect(view.myPlayer()?.id()).toBe(A);
    expect(view.nationalConflicts()?.recipientId).toBe(A);
    expect(view.nationalPoliticsTick()).toBe(view.ticks());
    expect(
      modal.querySelector('[data-national-crisis="active"]'),
    ).not.toBeNull();
    const select = modal.querySelector("select")!;
    select.value = B;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await modal.updateComplete;
    const form = modal.querySelector("form")!;
    // Revocation is immediate, even before the stale DOM is re-rendered.
    revokeTrustedNationalPrivateCapability(bus, view.gameID());
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    expect(events).toEqual([]);
    await modal.updateComplete;
    expect(modal.querySelector("[data-national-crisis]")).toBeNull();
    m.tick();
    await flush();
    expect(modal.querySelector("[data-national-crisis]")).toBeNull();
    // Rebind the server connection's identity: the original recipient must stop.
    const last = recipient.packet().tick;
    recipient.connection.sessionId = "replayed-foreign-session";
    m.tick();
    expect(recipient.packet().tick).toBe(last);
    expect(m.game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(A);
  }, 120_000);

  it("renders all three winning titles from real Private recipient GameViews", async () => {
    const m = await scenario();
    const a = mountPrivate(m, A);
    const b = mountPrivate(m, B);
    const c = mountPrivate(m, C);
    const viewers = [a, b, c];
    const flush = () => Promise.all(viewers.map((v) => v.flush()));
    for (
      let i = 0;
      i < 10 && viewers.some((v) => !v.view.trustedProjectionReady());
      i++
    ) {
      m.tick();
      await flush();
    }
    expect(viewers.every((v) => v.view.trustedProjectionReady())).toBe(true);
    const select = a.modal.querySelector("select")!;
    select.value = B;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await a.modal.updateComplete;
    a.modal
      .querySelector<HTMLButtonElement>(
        '[data-national-crisis] button[type="submit"]',
      )!
      .click();
    expect(a.events).toHaveLength(1);
    m.transfer(A, B, a.events[0].requestId);
    await flush();
    expect(a.modal.textContent).toContain("Crown transferred");
    m.conquer();
    await flush();
    for (const [v, title] of [
      [a, "Empire Victor"],
      [b, "Imperial Victor"],
      [c, "Empire Victor"],
    ] as const) {
      expect(v.modal.isVisible).toBe(true);
      expect(
        v.modal.querySelector("[data-national-award]")?.textContent?.trim(),
      ).toBe(title);
      expect(v.view.nationalPoliticsTick()).toBe(v.view.ticks());
      expect(v.view.gameOver()).toBe(true);
    }
  }, 120_000);

  it("clicks a real crown intent and renders the committed GameRunner WIN for every award", async () => {
    const m = await scenario();
    const a = mount(m, A);
    const b = mount(m, B);
    const c = mount(m, C);
    const observer = mount(m, null);
    const unauthenticated = mount(m, A, true);
    await Promise.all([
      a.update(),
      b.update(),
      c.update(),
      observer.update(),
      unauthenticated.update(),
    ]);
    expect(a.modal.querySelector('[role="timer"]')?.textContent).toContain(
      "10 seconds",
    );
    for (const viewer of [b, c, observer, unauthenticated])
      expect(viewer.modal.querySelector("[data-national-crisis]")).toBeNull();
    const select = a.modal.querySelector("select")!;
    select.focus();
    expect(document.activeElement).toBe(select);
    select.value = B;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await a.modal.updateComplete;
    const button = a.modal.querySelector<HTMLButtonElement>(
      '[data-national-crisis] button[type="submit"]',
    )!;
    expect(button.disabled).toBe(false);
    button.click();
    button.click();
    expect(a.events).toHaveLength(1);
    expect(m.game.nationalPoliticalAuthority()?.emperorOf(EMPIRE)).toBe(A);
    const action = a.events[0];
    expect(action.empireId).toBe(EMPIRE);
    expect(action.successorId).toBe(B);
    m.transfer(A, action.successorId, action.requestId);
    await a.update();
    expect(
      a.modal.querySelector("[data-national-crisis]")?.textContent,
    ).toContain("Crown transferred");
    const win = m.conquer();
    await Promise.all([
      a.update(win),
      b.update(win),
      c.update(win),
      observer.update(win),
    ]);
    for (const [viewer, award, title] of [
      [a, "EmpireVictor", "Empire Victor"],
      [b, "ImperialVictor", "Imperial Victor"],
      [c, "EmpireVictor", "Empire Victor"],
    ] as const) {
      expect(viewer.modal.isVisible).toBe(true);
      expect(
        viewer.modal
          .querySelector("[data-national-award]")
          ?.getAttribute("data-national-award"),
      ).toBe(award);
      expect(
        viewer.modal
          .querySelector("[data-national-award]")
          ?.textContent?.trim(),
      ).toBe(title);
      expect(viewer.votes).toEqual([]);
    }
    expect(observer.modal.querySelector("[data-national-award]")).toBeNull();
  }, 120_000);

  it("renders an independent sovereign and rejects premature and stale frames", async () => {
    const m = await scenario(true);
    const b = mount(m, B);
    const before = m.packet();
    const forged = {
      ...before,
      nationalPolitics: {
        ...before.nationalPolitics!,
        victory: {
          resolved: true,
          sovereignPowerCount: 1,
          confirmedTick: before.tick + 1,
          prizes: [{ kind: "SovereignVictor" as const, nationId: B }],
        },
      },
    };
    await b.update(forged);
    expect(b.modal.isVisible).toBe(false);
    const win = m.conquer();
    await b.update(win);
    expect(
      b.modal.querySelector("[data-national-award]")?.textContent?.trim(),
    ).toBe("Sovereign Victor");
    expect(b.votes).toEqual([]);
    expect(
      nationalVictoryAt(
        readNationalPolitics(win.nationalPolitics),
        win.tick - 1,
        win.tick,
      ),
    ).toBeNull();
    expect(
      readTrustedVictory(
        {
          tick: before.tick,
          nationalPolitics: forged.nationalPolitics,
        } as never,
        B,
      ),
    ).toBe("unresolved");
  }, 120_000);

  it("preserves the archived v1 public winner without reconstructing personal awards", async () => {
    const m = await scenario(true);
    const b = mount(m, B);
    const win = m.conquer();
    b.replay();
    await b.update({
      ...win,
      nationalPolitics: undefined,
      updates: { ...win.updates, [GameUpdateType.Win]: m.wins },
    });
    expect(b.modal.isVisible).toBe(true);
    expect(b.modal.textContent).toContain("win_modal.other_won");
    expect(b.modal.querySelector("[data-national-award]")).toBeNull();
    expect(b.modal.querySelector("[data-national-crisis]")).toBeNull();
    expect(b.votes).toEqual([]);
  }, 120_000);

  it("expires only on real simulation ticks; members see restored sovereignty, never a victory", async () => {
    const m = await scenario();
    const a = mount(m, A);
    const c = mount(m, C);
    await a.update();
    await c.update();
    const first = a.modal.querySelector('[role="timer"]')?.textContent;
    await a.update();
    expect(a.modal.querySelector('[role="timer"]')?.textContent).toBe(first);
    const deadline = m.game.nationalUngovernableWarnings()[0].deadlineMs;
    while (m.game.ticks() * 100 < deadline + 100) {
      m.tick();
      await a.update();
      await c.update();
    }
    for (const viewer of [a, c]) {
      expect(
        viewer.modal.querySelector("[data-national-crisis]")?.textContent,
      ).toContain("independent sovereignty is restored");
      expect(viewer.modal.isVisible).toBe(false);
    }
    expect(m.wins).toEqual([]);
  }, 120_000);

  it("rejects malformed awards, invented clocks and private WIN buckets", () => {
    const base = {
      empires: [{ id: EMPIRE, leaderId: A, memberIds: [A, B] }],
      warnings: [
        {
          empireId: EMPIRE,
          deadlineMs: 11000,
          remainingMs: 10000,
          blockedByAssetDisposition: false,
        },
      ],
    };
    expect(nationalCrisisAt(readNationalPolitics(base), A, 10)).not.toBeNull();
    expect(nationalCrisisAt(readNationalPolitics(base), A, 11)).toBeNull();
    expect(nationalCrisisAt(readNationalPolitics(base), B, 10)).toBeNull();
    const award = {
      resolved: true,
      sovereignPowerCount: 1,
      confirmedTick: 10,
      prizes: [{ kind: "SovereignVictor", nationId: A }],
    };
    for (const invalid of [
      { ...award, prizes: [...award.prizes, ...award.prizes] },
      {
        ...award,
        prizes: [{ kind: "EmpireVictor", nationId: A, empireId: EMPIRE }],
      },
      { ...award, privateConstitution: { secret: true } },
      { ...award, confirmedTick: 11 },
    ])
      expect(
        nationalVictoryAt(
          readNationalPolitics({ ...base, victory: invalid }),
          10,
          10,
        ),
      ).toBeNull();
    expect(() =>
      materializeTrustedNationalUpdate(
        {
          tick: 10,
          packedTileUpdates: [],
          updates: { [GameUpdateType.Win]: [{ winner: ["player", I] }] },
        } as never,
        9,
      ),
    ).toThrow(/unauthorized engine update bucket/);
  });
});
