// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  assertSoloLaunch,
  assertSoloSelection,
  describeSoloSelection,
  dispatchSoloPointer,
  findDeep,
  NATIONAL_BUTTON_LABEL,
  NATIONAL_BUTTON_SELECTOR,
} from "../../../scripts/national-qa/solo-selection.mjs";

function createNestedSolo() {
  const root = document.createElement("section");
  const modal = document.createElement("single-player-modal");
  modal.nationalMode = false;
  modal.selectedDifficulty = "Easy";
  modal.gameMode = "Free For All";
  root.append(modal);

  const outer = document.createElement("div");
  const firstShadow = outer.attachShadow({ mode: "open" });
  modal.append(outer);
  const inner = document.createElement("div");
  firstShadow.append(inner);
  const secondShadow = inner.attachShadow({ mode: "open" });
  const settings = document.createElement("game-config-settings");
  secondShadow.append(settings);

  const national = document.createElement("button");
  national.setAttribute("data-national-difficulty", "");
  national.setAttribute("aria-label", NATIONAL_BUTTON_LABEL);
  national.setAttribute("aria-pressed", "false");
  national.addEventListener("click", () => {
    modal.nationalMode = true;
    modal.selectedDifficulty = "Impossible";
    modal.gameMode = "Free For All";
    national.setAttribute("aria-pressed", "true");
  });
  const normal = document.createElement("button");
  const difficulty = document.createElement("difficulty-display");
  difficulty.difficultyKey = "Impossible";
  normal.append(difficulty);
  normal.addEventListener("click", () => {
    modal.nationalMode = false;
    modal.selectedDifficulty = "Impossible";
    national.setAttribute("aria-pressed", "false");
  });
  settings.append(national, normal);
  return { root, modal, national, normal };
}

const authenticNational = {
  origin: "single-player-modal",
  source: "singleplayer",
  gameType: "Singleplayer",
  gameMode: "Free For All",
  difficulty: "Impossible",
  hasNationalMode: true,
  nationalMode: true,
};
const authenticLegacy = {
  ...authenticNational,
  hasNationalMode: false,
  nationalMode: null,
};

describe("R10 E5 actual E4 Solo difficulty selector contract", () => {
  it("finds the exact accessible NATIONAL button through two shadow roots", () => {
    const fixture = createNestedSolo();
    expect(findDeep(fixture.root, NATIONAL_BUTTON_SELECTOR)).toBe(
      fixture.national,
    );
    expect(describeSoloSelection(fixture.root)).toMatchObject({
      label: NATIONAL_BUTTON_LABEL,
      pressed: "false",
      nationalMode: false,
    });
    expect(() =>
      assertSoloSelection(describeSoloSelection(fixture.root), true),
    ).toThrow("NATIONAL_UI_SELECTION_STATE_MISMATCH");
  });

  it("detects real button activation and ordinary Impossible reverses selection", () => {
    const fixture = createNestedSolo();
    fixture.national.click();
    expect(assertSoloSelection(describeSoloSelection(fixture.root), true)).toBe(
      true,
    );
    expect(fixture.modal.selectedDifficulty).toBe("Impossible");
    fixture.normal.click();
    expect(
      assertSoloSelection(describeSoloSelection(fixture.root), false),
    ).toBe(true);
    expect(fixture.modal.nationalMode).toBe(false);
  });

  it("fails when a button is absent, mislabeled, disabled or aria falsely claims selection", () => {
    const fixture = createNestedSolo();
    fixture.national.setAttribute("aria-label", "Old checkbox");
    expect(() =>
      assertSoloSelection(describeSoloSelection(fixture.root), false),
    ).toThrow("NATIONAL_DIFFICULTY_BUTTON_NOT_OPERABLE");
    fixture.national.setAttribute("aria-label", NATIONAL_BUTTON_LABEL);
    fixture.national.disabled = true;
    expect(() =>
      assertSoloSelection(describeSoloSelection(fixture.root), false),
    ).toThrow("NATIONAL_DIFFICULTY_BUTTON_NOT_OPERABLE");
    fixture.national.disabled = false;
    fixture.national.setAttribute("aria-pressed", "true");
    expect(() =>
      assertSoloSelection(describeSoloSelection(fixture.root), false),
    ).toThrow("NATIONAL_UI_SELECTION_STATE_MISMATCH");
    fixture.national.remove();
    expect(describeSoloSelection(fixture.root)).toBeNull();
  });
});

describe("R10 E5 actual Solo launch event contract", () => {
  it("requires exactly one real-shaped modal join-lobby with nationalMode=true", () => {
    expect(assertSoloLaunch([authenticNational], true)).toMatchObject({
      nationalMode: true,
      difficulty: "Impossible",
    });
    for (const launches of [
      [],
      [authenticNational, authenticNational],
      [{ ...authenticNational, origin: "fake-ui" }],
      [{ ...authenticNational, hasNationalMode: false }],
      [{ ...authenticNational, nationalMode: null }],
      [{ ...authenticNational, gameMode: "Team" }],
    ]) {
      expect(() => assertSoloLaunch(launches, true)).toThrow();
    }
  });

  it("ordinary Solo requires the NATIONAL field to be absent, not false", () => {
    expect(assertSoloLaunch([authenticLegacy], false)).toMatchObject({
      nationalMode: false,
      source: "singleplayer",
    });
    expect(() =>
      assertSoloLaunch([{ ...authenticLegacy, nationalMode: false }], false),
    ).toThrow("LEGACY_FFA_CONTAINS_NATIONAL_CONFIG");
    expect(() => assertSoloLaunch([authenticNational], false)).toThrow(
      "LEGACY_FFA_CONTAINS_NATIONAL_CONFIG",
    );
  });
});

describe("R10 E5 real Chromium input routing contract", () => {
  it("desktop produces mouse move, press and release, without DOM click", async () => {
    const send = vi.fn(async () => ({}));
    expect(await dispatchSoloPointer(send, false, 91, 72)).toBe("mouse");
    expect(send.mock.calls.map(([type]) => type)).toEqual([
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
    ]);
    expect(send.mock.calls[1][1]).toMatchObject({
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      x: 91,
      y: 72,
    });
  });

  it("mobile produces genuine CDP touchStart and touchEnd", async () => {
    const send = vi.fn(async () => ({}));
    expect(await dispatchSoloPointer(send, true, 17, 39)).toBe("touch");
    expect(send.mock.calls.map(([type]) => type)).toEqual([
      "Input.dispatchTouchEvent",
      "Input.dispatchTouchEvent",
    ]);
    expect(send.mock.calls[0][1]).toMatchObject({
      type: "touchStart",
      touchPoints: [{ x: 17, y: 39, id: 1 }],
    });
    expect(send.mock.calls[1][1]).toMatchObject({
      type: "touchEnd",
      touchPoints: [],
    });
  });

  it("rejects bogus CDP coordinates instead of sending a fake interaction", async () => {
    const send = vi.fn(async () => ({}));
    await expect(
      dispatchSoloPointer(send, true, Number.NaN, 10),
    ).rejects.toThrow("CHROMIUM_POINTER_ARGUMENTS_INVALID");
    expect(send).not.toHaveBeenCalled();
  });
});
