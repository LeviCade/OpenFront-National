/**
 * E5 read-only Solo selection contract shared by the CDP harness and focused
 * independent selector/receipt tests. Never mutates game or UI state.
 */
export const NATIONAL_BUTTON_SELECTOR = "button[data-national-difficulty]";
export const NATIONAL_BUTTON_LABEL =
  "NATIONAL sovereignty mode, Solo Free For All at Impossible difficulty";

export function findDeep(root, selector) {
  if (!root?.querySelector) return null;
  const direct = root.querySelector(selector);
  if (direct) return direct;
  for (const element of root.querySelectorAll("*")) {
    if (!element.shadowRoot) continue;
    const nested = findDeep(element.shadowRoot, selector);
    if (nested) return nested;
  }
  return null;
}

export function describeSoloSelection(root) {
  const modal = findDeep(root, "single-player-modal");
  const button = findDeep(root, NATIONAL_BUTTON_SELECTOR);
  if (!modal || !button) return null;
  return {
    label: button.getAttribute("aria-label"),
    pressed: button.getAttribute("aria-pressed"),
    disabled: button.disabled === true,
    nationalMode: modal.nationalMode === true,
    difficulty: modal.selectedDifficulty,
    gameMode: modal.gameMode,
  };
}

export function assertSoloSelection(state, national) {
  if (!state || state.label !== NATIONAL_BUTTON_LABEL || state.disabled) {
    throw Error("NATIONAL_DIFFICULTY_BUTTON_NOT_OPERABLE");
  }
  if (
    state.pressed !== (national ? "true" : "false") ||
    state.nationalMode !== national ||
    state.gameMode !== "Free For All"
  ) {
    throw Error("NATIONAL_UI_SELECTION_STATE_MISMATCH");
  }
  if (national && state.difficulty !== "Impossible") {
    throw Error("NATIONAL_DIFFICULTY_NOT_IMPOSSIBLE");
  }
  return true;
}

/**
 * Only the real SinglePlayerModal's bubbling join-lobby event is admissible.
 * The browser probe makes a bounded read-only record of the event's config.
 * A successful click, a toast, or a local checkbox is not a launch receipt.
 */
export function assertSoloLaunch(launches, national) {
  if (!Array.isArray(launches) || launches.length !== 1) {
    throw Error("SOLO_LAUNCH_EVENT_MISSING_OR_DUPLICATED");
  }
  const actual = launches[0];
  if (
    !actual ||
    actual.origin !== "single-player-modal" ||
    actual.source !== "singleplayer" ||
    actual.gameType !== "Singleplayer" ||
    actual.gameMode !== "Free For All"
  ) {
    throw Error("SOLO_LAUNCH_SOURCE_OR_MODE_INVALID");
  }
  if (national) {
    if (
      actual.nationalMode !== true ||
      actual.hasNationalMode !== true ||
      actual.difficulty !== "Impossible"
    ) {
      throw Error("NATIONAL_LAUNCH_CONFIG_MISMATCH");
    }
  } else if (
    actual.hasNationalMode !== false ||
    actual.nationalMode !== null
  ) {
    throw Error("LEGACY_FFA_CONTAINS_NATIONAL_CONFIG");
  }
  return {
    source: actual.source,
    gameType: actual.gameType,
    gameMode: actual.gameMode,
    difficulty: actual.difficulty,
    nationalMode: national,
  };
}

/** Native Chrome CDP mouse/touch only. Never call DOM.click in browser QA. */
export async function dispatchSoloPointer(send, mobile, x, y) {
  if (typeof send !== "function" ||
      !Number.isFinite(x) || !Number.isFinite(y)) {
    throw Error("CHROMIUM_POINTER_ARGUMENTS_INVALID");
  }
  if (mobile) {
    await send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
    await send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    return "touch";
  }
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  return "mouse";
}
