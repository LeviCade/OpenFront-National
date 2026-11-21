/**
 * CDP observer for an ALREADY RUNNING, independently authenticated opponent
 * browser. This module never creates a player, lobby, tab, identity or intent.
 * Only a native CDP pointer/keyboard event may operate a real UI control.
 *
 * E6/Conductor must provision a second lawful player browser and export the
 * localhost Chrome-debugger port. No supplied port => explicit FAIL.
 */
export async function connectAuthenticatedPeer({
  port,
  primaryPort,
  cdp,
  dispatchSoloPointer,
  mobile,
  record,
}) {
  const number = Number(port);
  if (
    !Number.isSafeInteger(number) ||
    number <= 1024 ||
    number > 65535 ||
    number === primaryPort
  ) {
    throw Error(
      "POLITICAL_SECOND_AUTHORIZED_BROWSER_SESSION_MISSING_OWNER_E2_E4_E6",
    );
  }
  const response = await fetch("http://127.0.0.1:" + number + "/json/list", {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok)
    throw Error("POLITICAL_SECOND_CDP_SESSION_UNREACHABLE_OWNER_E6");
  const tabs = await response.json();
  if (!Array.isArray(tabs))
    throw Error("POLITICAL_SECOND_CDP_PAGE_MISSING_OWNER_E6");
  const page = tabs.find(
    (p) =>
      p?.type === "page" &&
      typeof p.webSocketDebuggerUrl === "string" &&
      typeof p.url === "string" &&
      ["http://127.0.0.1:9000/", "http://localhost:9000/"].some(
        (prefix) => p.url.startsWith(prefix),
      ),
  );
  if (!page)
    throw Error("POLITICAL_SECOND_LIVE_GAME_PAGE_MISSING_OWNER_E2_E4_E6");
  const wsUrl = new URL(page.webSocketDebuggerUrl);
  if (
    wsUrl.protocol !== "ws:" ||
    !["127.0.0.1", "localhost"].includes(wsUrl.hostname) ||
    Number(wsUrl.port) !== number
  )
    throw Error("POLITICAL_SECOND_CDP_HOST_NOT_LOCAL");
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const send = cdp(socket);
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error("POLITICAL_SECOND_BROWSER_RUNTIME_FAILED");
    return result.result?.value;
  };
  // It is forbidden to set .game, .myPlayer, .nationalPolitics or any input
  // state from Runtime.evaluate. Only observe the genuine live UI.
  const observe = () =>
    evaluate(`(() => {
    const panel=document.querySelector("national-diplomacy-panel");
    const g=panel?.game, a=g?.myPlayer?.();
    if(!g||!a)return null;
    return {
      gameId:g.gameID?.() ?? null, actorId:a.id?.() ?? null,
      tick:g.ticks?.() ?? null, spectator:g.isSpectator?.() ?? true,
      spawned:a.hasSpawned?.() === true,
      ownedTiles:a.numTilesOwned?.() ?? 0,
      politicsTick:g.nationalPoliticsTick?.() ?? null,
      empires:g.nationalPolitics?.()?.empires ?? null,
      accessionOffers:g.nationalAccessionOffers?.() ?? null,
      politicalResults:g.nationalPoliticalResults?.() ?? null,
      conflicts:g.nationalConflicts?.() ?? null,
      conflictsTick:g.nationalConflictsTick?.() ?? null,
      diplomacyResults:g.nationalDiplomacyResults?.() ?? null,
      peaceStatus:panel.querySelector('[data-national-diplomacy-status]')?.innerText ?? null,
    };
  })()`);
  const hit = async (x, y) => {
    const pointer = await dispatchSoloPointer(send, mobile, x, y);
    if (pointer !== (mobile ? "touch" : "mouse"))
      throw Error("POLITICAL_SECOND_INPUT_TYPE_MISMATCH");
  };
  const position = (selector) =>
    evaluate(
      "(() => {" +
        "const element=document.querySelector(" +
        JSON.stringify(selector) +
        ");" +
        "if(!element || element.disabled)return null;" +
        "element.scrollIntoView({block:'center',inline:'nearest'});" +
        "const r=element.getBoundingClientRect();" +
        "const visible=r.width>0&&r.height>0&&" +
        "getComputedStyle(element).visibility!=='hidden';" +
        "return visible?{x:Math.round(r.x+r.width/2)," +
        "y:Math.round(r.y+r.height/2)}:null;" +
        "})()",
    );
  const click = async (selector) => {
    const where = await position(selector);
    if (!where)
      throw Error("POLITICAL_SECOND_REAL_CONTROL_UNAVAILABLE:" + selector);
    await hit(where.x, where.y);
  };
  const ensurePanel = async () => {
    const state = await evaluate(`(() => {
      const p=document.querySelector('national-diplomacy-panel');
      const b=p?.querySelector('button[aria-controls="national-diplomacy-content"]');
      return b?.getAttribute('aria-expanded') ?? null;
    })()`);
    if (state === null) throw Error("POLITICAL_SECOND_PANEL_MISSING_OWNER_E4");
    if (state === "false")
      await click(
        'national-diplomacy-panel button[aria-controls="national-diplomacy-content"]',
      );
    const after = await evaluate(`document.querySelector(
      'national-diplomacy-panel button[aria-controls="national-diplomacy-content"]'
    )?.getAttribute('aria-expanded') ?? null`);
    if (after !== "true")
      throw Error("POLITICAL_SECOND_PANEL_NOT_OPEN_OWNER_E4");
  };
  const select = async (selector, requiredId) => {
    if (typeof requiredId !== "string" || !requiredId)
      throw Error("POLITICAL_SECOND_SELECTOR_ID_REQUIRED");
    const opts = await evaluate(
      "(() => {const s=document.querySelector(" +
        JSON.stringify(selector) +
        ");" +
        "return s?.tagName==='SELECT'&&!s.disabled?" +
        "Array.from(s.options).map(o=>({value:o.value,disabled:o.disabled})):null;})()",
    );
    if (
      !Array.isArray(opts) ||
      !opts.some((o) => o.value === requiredId && !o.disabled)
    )
      throw Error("POLITICAL_SECOND_ENGINE_OPTION_NOT_AVAILABLE:" + selector);
    await click(selector);
    // Native CDP keyboard path, not DOM.value mutation/change-event forging.
    for (let i = 0; i < opts.length + 2; i++) {
      for (const key of ["ArrowDown", "Enter"]) {
        await send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key,
          code: key,
        });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key });
      }
      const value = await evaluate(
        "document.querySelector(" + JSON.stringify(selector) + ")?.value ?? ''",
      );
      if (value === requiredId) return;
    }
    throw Error("POLITICAL_SECOND_NATIVE_SELECTION_NOT_COMMITTED:" + selector);
  };
  const watchIntent = async (type) => {
    if (!["accept-empire", "accept-peace"].includes(type))
      throw Error("POLITICAL_SECOND_WATCH_TYPE_NOT_ALLOWED");
    const ok = await evaluate(`(async () => {
      const p=document.querySelector('national-diplomacy-panel');
      if(!p?.eventBus || !p.game?.myPlayer())return false;
      const t=await import('/src/client/Transport.ts');
      const klass=${
        type === "accept-empire"
          ? "t.SendNationalAcceptEmpireIntentEvent"
          : "t.SendNationalAcceptPeaceIntentEvent"
      };
      window.__e5PeerClickEvidence=[];
      p.eventBus.on(klass,e=>{
        window.__e5PeerClickEvidence.push({
          requestId:e.requestId,
          empireId:e.empireId ?? null,
          candidateId:e.candidateId ?? null,
          motionId:e.motionId ?? null,
        });
      });
      return true;
    })()`);
    if (ok !== true)
      throw Error("POLITICAL_SECOND_CLICK_OBSERVER_MISSING_OWNER_E4");
  };
  const observedClick = () =>
    evaluate("window.__e5PeerClickEvidence?.[0] ?? null");
  return {
    observe,
    click,
    select,
    ensurePanel,
    watchIntent,
    observedClick,
    close: () => socket.close(),
  };
}
