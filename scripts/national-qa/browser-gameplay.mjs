#!/usr/bin/env node
/**
 * E5 Round Five — independently executed CHROMIUM, not a mocked UI.
 *
 * This acceptance intentionally FAILS when required E1/E3/E4 wiring is absent:
 * a queued intent, local status string, or menu screenshot is never proof of
 * authoritative founding, saved-game restoration or sovereign victory.
 *
 * Run with Node 24 + installed lockfile:
 *   CHROME_BIN=/usr/bin/google-chrome node scripts/national-qa/browser-gameplay.mjs
 *   ... --mobile
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectAuthenticatedPeer } from "./browser-r11-peer.mjs";
import {
  verifyDistinctLiveSessions,
  verifyThreeLivePrincipals,
  verifyPrivateInvitation,
  reconcilePoliticalReceipt,
  corroboratePublicEmpire,
  sanitizePacketEvidence,
  sanitizeAcceptanceEvent,
  safeFailureCode,
} from "./browser-r11-political-verdict.mjs";
import {
  PANEL_TOGGLE,
  describePanel,
  unobstructedCanvasPoint,
  soloSpawnFractions,
  classifySoloBattleEvidence,
  classifyFoundingEvidence,
  acceptRadialTarget,
  distinctPeacePrincipal,
} from "./browser-r11-verdict.mjs";
import { reconcileDiplomacyEvidence } from "./browser-verdict.mjs";
import { verifyHardwareWebgl } from "./gpu-attestation.mjs";
import {
  assertSoloLaunch,
  assertSoloSelection,
  dispatchSoloPointer,
  NATIONAL_BUTTON_LABEL,
  NATIONAL_BUTTON_SELECTOR,
} from "./solo-selection.mjs";

const mobile = process.argv.includes("--mobile");
const legacy = process.argv.includes("--legacy");
// Explicit diagnostic only. The default three-principal path remains strict.
const soloOnly = process.argv.includes("--solo");
if (legacy && soloOnly) throw Error("SOLO_DIAGNOSTIC_MODE_CONFLICT");
const base = "http://127.0.0.1:9000/";
const reportDir =
  "national-qa-artifacts/browser-" +
  (legacy ? "legacy-ffa-" : "national-") +
  (mobile ? "mobile" : "desktop");
mkdirSync(reportDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "national-r5-"));
const port = 13000 + (process.pid % 10000);
const childProcesses = [];
const records = [];
const errors = [];
const observed = [];
const browserConsole = [];
const browserNetworkErrors = [];
const runtimeAssetRequests = [];
const restrictedRuntimeAssets = [];
let hardwareCapabilities = null;
let submittedFounding = null;
const start = performance.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let stage = "boot";

const watchdog = setTimeout(() => {
  record("deadline", { stage, error: "180s hard acceptance deadline" });
  persist();
  for (const child of childProcesses) child.kill("SIGKILL");
  process.exit(1);
}, 180_000);

function record(name, extra = {}) {
  records.push({
    name,
    elapsedMs: Math.round(performance.now() - start),
    ...extra,
  });
  console.info(
    "QA_R5 " + JSON.stringify(sanitizeAcceptanceEvent(records.at(-1))),
  );
}

function persist() {
  const report = {
    scenarioKind: legacy
      ? "legacy"
      : soloOnly
        ? "national-solo"
        : "national-three-player",
    exactSource:
      process.env.NATIONAL_GPU_CANDIDATE_SHA ??
      process.env.GITHUB_SHA ??
      "local-working-tree",
    hardwareAcceptanceRequired:
      process.env.NATIONAL_REQUIRE_HARDWARE_GPU === "1",
    viewport: mobile ? "390x844 mobile" : "1280x800 desktop",
    stage,
    events: records.map(sanitizeAcceptanceEvent).filter(Boolean),
    errors: errors.map((e) => ({
      stage: typeof e?.stage === "string" ? e.stage : stage,
      error: safeFailureCode(e?.error ?? e),
    })),
    workerPackets: sanitizePacketEvidence(observed),
    console: browserConsole.slice(-240).map(({ severity }) => ({ severity })),
    networkErrors: browserNetworkErrors
      .slice(-120)
      .map(({ error, blockedReason }) => ({
        failed: !!error,
        blocked: !!blockedReason,
      })),
    runtimeAssetRequests: runtimeAssetRequests.slice(-500),
    restrictedRuntimeAssets: restrictedRuntimeAssets.slice(-80),
    actualHardware: hardwareCapabilities,
    submittedFounding: submittedFounding
      ? {
          authenticRequestObserved: /^nf_[a-f0-9]{32}$/.test(
            submittedFounding.requestId ?? "",
          ),
          requestFingerprint:
            typeof submittedFounding.requestId === "string"
              ? createHash("sha256")
                  .update(submittedFounding.requestId)
                  .digest("hex")
                  .slice(0, 16)
              : null,
        }
      : null,
    elapsedMs: Math.round(performance.now() - start),
  };
  writeFileSync(
    join(reportDir, "acceptance.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}

function spawnChild(exe, args, env = {}) {
  const child = spawn(exe, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  childProcesses.push(child);
  child.stdout?.on("data", (data) => process.stdout.write(data));
  child.stderr?.on("data", (data) => process.stderr.write(data));
  child.on("error", (error) => errors.push("process: " + String(error)));
  return child;
}

async function poll(callback, label, attempts = 90, interval = 300) {
  for (let i = 0; i < attempts; i++) {
    const result = await callback().catch((error) => {
      const detail = String(error);
      if (
        detail.includes("_OWNER_") ||
        /Error: (?:POLITICAL_|PEACE_|WAR_|FOUNDING_|SPAWN_)/.test(detail)
      ) {
        throw error;
      }
      return null;
    });
    if (result) return result;
    await sleep(interval);
  }
  throw new Error("Timed out: " + label);
}

function cdp(webSocket) {
  const pending = new Map();
  let id = 0;
  webSocket.addEventListener("message", (event) => {
    const packet = JSON.parse(String(event.data));
    if (packet.method === "Runtime.consoleAPICalled") {
      browserConsole.push({
        severity: packet.params?.type,
        text: (packet.params?.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? "")
          .join(" ")
          .slice(0, 1200),
      });
    }
    if (packet.method === "Runtime.exceptionThrown") {
      browserConsole.push({
        severity: "exception",
        text: String(packet.params?.exceptionDetails?.text ?? "").slice(
          0,
          1200,
        ),
      });
    }
    if (packet.method === "Network.requestWillBeSent") {
      const raw = packet.params?.request?.url;
      try {
        const url = new URL(raw);
        // Drop query and fragment: URLs can contain authentication tokens.
        const mediaAsset =
          /[.](?:mp3|ogg|flac|wav|woff2?|ttf|svg|png|jpe?g|webp)$/i.test(
            url.pathname,
          );
        const assetFolder = /[/](?:proprietary|premium|cdn|assets)[/]/i.test(
          url.pathname,
        );
        if (/^https?:$/.test(url.protocol) && (mediaAsset || assetFolder)) {
          const evidence = {
            origin: url.origin,
            path: url.pathname,
            type: packet.params?.type ?? "other",
          };
          runtimeAssetRequests.push(evidence);
          const forbiddenLocal = /[/]proprietary[/]/i.test(url.pathname);
          const upstreamCdn =
            /[/]cdn[/]/i.test(url.pathname) &&
            /(?:[.]|^)openfront[.](?:io|dev)$/i.test(url.hostname);
          if (forbiddenLocal || upstreamCdn)
            restrictedRuntimeAssets.push(evidence);
        }
      } catch {
        // Non-URL data requests have no external asset origin.
      }
    }
    if (packet.method === "Network.loadingFailed") {
      browserNetworkErrors.push({
        id: packet.params?.requestId,
        error: packet.params?.errorText,
        blockedReason: packet.params?.blockedReason,
      });
    }
    if (packet.id === undefined) return;
    const current = pending.get(packet.id);
    if (!current) return;
    pending.delete(packet.id);
    if (packet.error) current.reject(new Error(JSON.stringify(packet.error)));
    else current.resolve(packet.result);
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const seq = ++id;
      pending.set(seq, { resolve, reject });
      webSocket.send(JSON.stringify({ id: seq, method, params }));
      setTimeout(() => {
        if (!pending.has(seq)) return;
        pending.delete(seq);
        reject(new Error("CDP RPC timed out: " + method));
      }, 12_000).unref();
    });
}

const probe = `(() => {
  // Instrument real MessagePort reception BEFORE the application starts.
  // The instrumentation never mutates a game message or injects an outcome.
  const packets = [];
  let sequence = 0;
  const scrub = (data) => {
    if (!data || typeof data !== 'object') return;
    const type = typeof data.type === 'string' ? data.type : undefined;
    const info = {
      sequence: ++sequence,
      type, tick: Number.isFinite(data.tick) ? data.tick : undefined,
      keys: Object.keys(data).filter((k) =>
        ['type','tick','gameUpdates','nationalPolitics','nationalCommandResults','updates','error','snapshot'].includes(k)
      ),
    };
    const updateCandidates = [data, ...(data.gameUpdate ? [data.gameUpdate] : []), ...(Array.isArray(data.gameUpdates) ? data.gameUpdates : [])];
    for (const candidate of updateCandidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      if (Number.isSafeInteger(candidate.tick)) info.tick = candidate.tick;
      if (candidate.nationalPolitics) info.publicPolitics = candidate.nationalPolitics;
      if (candidate.nationalAccessionOffers) info.accessionOffers = candidate.nationalAccessionOffers;
      if (candidate.nationalCommandResults) info.commandResults = candidate.nationalCommandResults;
      if (candidate.nationalConflicts) info.publicConflicts = candidate.nationalConflicts;
      if (candidate.packedAttackUpdates?.length > 0) info.hasAuthoritativeAttackDelta = true;
      if (candidate.packedMotionPlans?.length > 0) info.hasAuthoritativeMotion = true;
      if (candidate.packedTileUpdates?.length > 0) info.hasTerritoryDelta = true;
      if (candidate.type === 'snapshot_result') info.snapshotAvailable = candidate.snapshot != null;
    }
    packets.push(info);
    if (packets.length > 800) packets.shift();
  };
  const seen = new WeakSet();
  const track = (event) => {
    if (event && typeof event === 'object' && !seen.has(event)) {
      seen.add(event);
      scrub(event.data);
    }
  };
  // WorkerClient receives real GameRunner packets via a Worker, not only a MessagePort.
  // Observe both; never mutate a delivered game packet.
  const nativeWorkerAdd = Worker.prototype.addEventListener;
  Worker.prototype.addEventListener = function(type, listener, options) {
    if (type === 'message') nativeWorkerAdd.call(this, type, track, false);
    return nativeWorkerAdd.call(this, type, listener, options);
  };
  const originalAdd = MessagePort.prototype.addEventListener;
  MessagePort.prototype.addEventListener = function(type, listener, options) {
    if (type === 'message') {
      originalAdd.call(this, type, track, false);
    }
    return originalAdd.call(this, type, listener, options);
  };
  const descriptor = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  if (descriptor && descriptor.configurable) {
    Object.defineProperty(MessagePort.prototype, 'onmessage', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: function() { return descriptor.get.call(this); },
      set: function(fn) {
        if (typeof fn !== 'function') return descriptor.set.call(this, fn);
        return descriptor.set.call(this, function(event) {
          track(event);
          return fn.call(this, event);
        });
      },
    });
  }
  const findDeep = (root, selector) => {
    const direct = root.querySelector(selector);
    if (direct) return direct;
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) {
        const nested = findDeep(element.shadowRoot, selector);
        if (nested) return nested;
      }
    }
    return null;
  };
  Object.defineProperty(window, '__nationalQaFind', {
    value: (selector) => findDeep(document, selector),
  });
  Object.defineProperty(window, '__nationalQaWorkerEvidence', {
    value: packets, configurable: false, writable: false,
  });
  // Observe only the genuine bubbling Solo launch. Do not modify its detail.
  const soloLaunches = [];
  document.addEventListener('join-lobby', (event) => {
    const config = event.detail?.gameStartInfo?.config;
    if (!config) return;
    soloLaunches.push({
      origin: event.target?.localName ?? null,
      source: event.detail?.source ?? null,
      gameType: config.gameType ?? null,
      gameMode: config.gameMode ?? null,
      difficulty: config.difficulty ?? null,
      hasNationalMode: Object.prototype.hasOwnProperty.call(config, 'nationalMode'),
      nationalMode: config.nationalMode ?? null,
    });
  }, true);
  Object.defineProperty(window, '__nationalQaSoloLaunches', {
    value: soloLaunches, configurable: false, writable: false,
  });
})();`;

async function main() {
  stage = "boot";
  spawnChild(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "src/server/Server.ts"],
    {
      GAME_ENV: "dev",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      API_KEY: "WARNING_DEV_API_KEY_DO_NOT_USE_IN_PRODUCTION",
      ADMIN_BOT_API_KEY: "WARNING_DEV_ADMIN_BOT_KEY_DO_NOT_USE_IN_PRODUCTION",
      DOMAIN: "localhost",
      GIT_COMMIT: "DEV",
    },
  );
  const vite = spawnChild(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    { GAME_ENV: "dev", SKIP_BROWSER_OPEN: "true" },
  );
  await poll(async () => {
    if (vite.exitCode !== null) throw Error("Vite terminated");
    const res = await fetch(base, { signal: AbortSignal.timeout(1200) });
    return res.ok && (await res.text()).includes("<html");
  }, "Vite HTTP");
  record("vite-http-ready");

  // Never force SwiftShader: doing so makes even a GPU-backed QA runner
  // report a software renderer and fail OpenFront's legitimate WebGL gate.
  // Optional hardware backend may be selected on an actual GPU machine.
  const angleBackend = process.env.NATIONAL_CHROME_ANGLE_BACKEND;
  if (
    angleBackend !== undefined &&
    angleBackend !== "gl" &&
    angleBackend !== "gl-egl" &&
    angleBackend !== "vulkan"
  ) {
    throw new Error(
      "NATIONAL_CHROME_ANGLE_BACKEND must be gl, gl-egl or vulkan",
    );
  }
  const virglSurfaceless = angleBackend === "gl-egl";
  const hardwareOnly = process.env.NATIONAL_REQUIRE_HARDWARE_GPU === "1";
  // Hosted CI may opt into a software CDP diagnostic. It cannot pass the
  // normal game WebGL gate and is forbidden in real hardware acceptance.
  const softwareDiagnostic =
    !hardwareOnly && process.env.NATIONAL_QA_SOFTWARE_CDP === "1";
  spawnChild(
    process.env.CHROME_BIN ?? "google-chrome",
    [
      "--headless=new",
      ...(virglSurfaceless ? ["--ozone-platform=headless"] : []),
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      ...(hardwareOnly ? ["--disable-software-rasterizer"] : []),
      ...(softwareDiagnostic
        ? [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ]
        : angleBackend
          ? ["--use-gl=angle", "--use-angle=" + angleBackend]
          : []),
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-allow-origins=*",
      "--user-data-dir=" + profile,
      "--remote-debugging-port=" + port,
      "about:blank",
    ],
    virglSurfaceless ? { EGL_PLATFORM: "surfaceless" } : {},
  );
  const pages = await poll(async () => {
    const res = await fetch("http://127.0.0.1:" + port + "/json/list", {
      signal: AbortSignal.timeout(1200),
    });
    return res.ok ? res.json() : null;
  }, "Chromium remote debugging");
  const page = pages.find((p) => p.type === "page");
  if (!page?.webSocketDebuggerUrl) throw Error("No Chromium page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const send = cdp(ws);
  let politicalPeer = null;
  let peacePeer = null;
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        "Browser Runtime exception " + JSON.stringify(res.exceptionDetails),
      );
    }
    return res.result?.value;
  };
  const screenshot = async (label) => {
    const data = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(
      join(reportDir, label + ".png"),
      Buffer.from(data.data, "base64"),
    );
  };
  let lastWorkerSeq = 0;
  const worker = async () => {
    const evidence = await evaluate("window.__nationalQaWorkerEvidence || []");
    if (Array.isArray(evidence)) {
      for (const packet of evidence) {
        if (packet.sequence > lastWorkerSeq) observed.push(packet);
      }
      lastWorkerSeq = evidence[evidence.length - 1]?.sequence ?? lastWorkerSeq;
    }
    return observed;
  };
  const description = async () =>
    evaluate(`(() => {
      const nodes = [];
      const collect = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) collect(el.shadowRoot);
          if (!el.matches('button,input,label,[role="button"]')) continue;
          const box = el.getBoundingClientRect();
          if (!box.width || !box.height) continue;
          const text = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().slice(0,80);
          if (text) nodes.push({ text, tag: el.tagName, disabled: !!el.disabled });
        }
      };
      collect(document);
      return { text: document.body.innerText.slice(0, 1200), controls: nodes.slice(0,70) };
    })()`);
  const locate = async (label, scope = "", requireEnabled = true) =>
    evaluate(`(() => {
      const reg = new RegExp(${JSON.stringify(label)}, 'i');
      const root = ${scope ? `window.__nationalQaFind(${JSON.stringify(scope)})` : "document"};
      if (!root) return null;
      const found = [];
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) walk(el.shadowRoot);
          if (!el.matches('button,input,label,[role="button"]')) continue;
          const text = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim();
          if (!reg.test(text) || text.length > 100) continue;
          const rect = el.getBoundingClientRect();
          const css = getComputedStyle(el);
          if (!rect.width || !rect.height || css.display === 'none' || css.visibility === 'hidden') continue;
          if (${requireEnabled} && (el.disabled || el.getAttribute('aria-disabled') === 'true')) continue;
          found.push({ text, element: el, checked: !!el.checked });
        }
      };
      walk(root);
      const picked = found.sort((a,b) => a.text.length-b.text.length)[0];
      if (!picked) return null;
      picked.element.scrollIntoView({ block: "center", inline: "nearest" });
      const bounds = picked.element.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return null;
      return {
        text: picked.text,
        checked: picked.checked,
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2),
      };
    })()`);
  const hit = async (x, y) => {
    const route = await dispatchSoloPointer(send, mobile, x, y);
    record(route === "touch" ? "actual-touch-input" : "actual-mouse-input", {
      x: Math.round(x),
      y: Math.round(y),
    });
  };
  const click = async (label, scope = "", attempts = 90) => {
    const target = await poll(() => locate(label, scope), label, attempts);
    await hit(target.x, target.y);
    record("clicked", { label, text: target.text });
    return target;
  };
  const nationalSelection = () =>
    evaluate(`(() => {
      const button = window.__nationalQaFind("button[data-national-difficulty]");
      const modal = window.__nationalQaFind('single-player-modal');
      if (!button || !modal) return null;
      return {
        label: button.getAttribute('aria-label'),
        pressed: button.getAttribute('aria-pressed'),
        disabled: button.disabled === true,
        nationalMode: modal.nationalMode === true,
        difficulty: modal.selectedDifficulty,
        gameMode: modal.gameMode,
      };
    })()`);
  const selectNational = async () => {
    const before = await nationalSelection();
    if (!before || before.label !== NATIONAL_BUTTON_LABEL) {
      throw Error("NATIONAL_DIFFICULTY_BUTTON_MISSING_OR_MISLABELED");
    }
    if (!before.disabled && before.pressed !== "true") {
      await clickSelector(NATIONAL_BUTTON_SELECTOR);
    }
    const selected = await poll(
      async () => {
        const state = await nationalSelection();
        return state?.pressed === "true" &&
          state.nationalMode === true &&
          state.difficulty === "Impossible"
          ? state
          : null;
      },
      "E4 NATIONAL difficulty selected via native Chrome input",
      40,
      150,
    );
    assertSoloSelection(selected, true);
    record("national-difficulty-selected", {
      ariaPressed: selected.pressed,
      difficulty: selected.difficulty,
      gameMode: selected.gameMode,
      via: mobile ? "touch" : "mouse",
    });
  };
  const selectOrdinaryImpossible = async () => {
    const target = await poll(
      () =>
        evaluate(`(() => {
          const settings = window.__nationalQaFind('game-config-settings');
          const normal = [...(settings?.querySelectorAll('button') ?? [])].find(
            (button) =>
              !button.hasAttribute('data-national-difficulty') &&
              [...button.querySelectorAll('difficulty-display')].some(
                (display) => display.difficultyKey === 'Impossible'
              )
          );
          if (!normal || normal.disabled) return null;
          normal.scrollIntoView({ block: 'center', inline: 'nearest' });
          const rect = normal.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0
            ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
            : null;
        })()`),
      "ordinary Impossible difficulty in live E4 Solo",
      40,
      150,
    );
    await hit(target.x, target.y);
    const ordinary = await poll(
      async () => {
        const state = await nationalSelection();
        return state?.pressed === "false" &&
          state.nationalMode === false &&
          state.difficulty === "Impossible"
          ? state
          : null;
      },
      "ordinary Impossible deselects NATIONAL",
      40,
      150,
    );
    assertSoloSelection(ordinary, false);
    record("ordinary-solo-difficulty-restored", {
      ariaPressed: ordinary.pressed,
      difficulty: ordinary.difficulty,
      via: mobile ? "touch" : "mouse",
    });
  };
  const confirmLaunch = async (national) => {
    const launches = await poll(
      async () => {
        const events = await evaluate(
          "window.__nationalQaSoloLaunches?.slice(0, 2) ?? []",
        );
        return Array.isArray(events) && events.length > 0 ? events : null;
      },
      "real bubbling single-player join-lobby event",
      80,
      175,
    );
    record(
      "actual-singleplayer-launch-config",
      assertSoloLaunch(launches, national),
    );
  };
  const clickSelector = async (selector) => {
    const target = await poll(
      () =>
        evaluate(`(() => {
      const node = window.__nationalQaFind(${JSON.stringify(selector)});
      if (!node || node.disabled) return null;
      node.scrollIntoView({ block: "center", inline: "nearest" });
      const bounds = node.getBoundingClientRect();
      return bounds.width && bounds.height
        ? { x: bounds.x + bounds.width/2, y: bounds.y + bounds.height/2 }
        : null;
    })()`),
      selector,
    );
    await hit(target.x, target.y);
    record("clicked-selector", { selector });
  };
  const gameObservation = () =>
    evaluate(`(() => {
      const g = window.__nationalQaFind('national-diplomacy-panel')?.game;
      const p = g?.myPlayer?.();
      if (!g) return null;
      return {
        tick: g.ticks?.() ?? null,
        paused: g.isPaused?.() ?? null,
        gameId: g.gameID?.() ?? null,
        gameType: g.config?.()?.gameConfig?.()?.gameType ?? null,
        inSpawnPhase: g.inSpawnPhase?.() ?? null,
        spawned: p?.hasSpawned?.() === true,
        ownedTiles: p?.numTilesOwned?.() ?? 0,
        actorId: p?.id?.() ?? null,
      };
    })()`);
  const primaryPoliticalObservation = () =>
    evaluate(`(() => {
      const panel=document.querySelector('national-diplomacy-panel');
      const g=panel?.game, p=g?.myPlayer?.();
      if(!g||!p)return null;
      return {
        gameId:g.gameID?.() ?? null,actorId:p.id?.() ?? null,
        tick:g.ticks?.() ?? null,politicsTick:g.nationalPoliticsTick?.() ?? null,
        spectator:g.isSpectator?.() ?? true,spawned:p.hasSpawned?.()===true,
        ownedTiles:p.numTilesOwned?.() ?? 0,
        empires:g.nationalPolitics?.()?.empires ?? null,
        accessionOffers:g.nationalAccessionOffers?.() ?? null,
        politicalResults:g.nationalPoliticalResults?.() ?? null,
      };
    })()`);
  const watchPrimaryPoliticalIntent = async (type) => {
    if (!["offer", "crown"].includes(type))
      throw Error("POLITICAL_WATCH_TYPE_UNKNOWN");
    const attached = await evaluate(
      "(async()=>{" +
        "const panel=document.querySelector('national-diplomacy-panel');" +
        "if(!panel?.eventBus||!panel?.game?.myPlayer())return false;" +
        "const T=await import('/src/client/Transport.ts');" +
        "window.__e5PrimaryPoliticalClicks=[];" +
        "const klass=" +
        (type === "offer"
          ? "T.SendNationalOfferEmpireIntentEvent"
          : "T.SendNationalTransferCrownIntentEvent") +
        ";" +
        "panel.eventBus.on(klass,e=>window.__e5PrimaryPoliticalClicks.push({" +
        "requestId:e.requestId,empireId:e.empireId," +
        "targetId:e.candidateId??e.successorId??null}));" +
        "return true;})()",
    );
    if (!attached)
      throw Error("POLITICAL_REAL_EVENTBUS_OBSERVER_MISSING_OWNER_E4");
  };
  const primaryPoliticalClick = () =>
    evaluate("window.__e5PrimaryPoliticalClicks?.[0] ?? null");
  const openPeer = async (portValue) =>
    connectAuthenticatedPeer({
      port: portValue,
      primaryPort: port,
      cdp,
      dispatchSoloPointer,
      mobile,
      record,
    });
  const panelObservation = () =>
    evaluate(
      "(() => {" +
        "const panel=window.__nationalQaFind('national-diplomacy-panel');" +
        "const toggle=panel?.querySelector('button[aria-controls=\\\"national-diplomacy-content\\\"]');" +
        "return (" +
        describePanel.toString() +
        ")(toggle,panel);" +
        "})()",
    );
  const setPanelExpanded = async (expanded) => {
    const prior = await panelObservation();
    if (!prior?.valid) throw Error("PANEL_REAL_TOGGLE_MISSING");
    if (prior.expanded !== expanded) await clickSelector(PANEL_TOGGLE);
    const result = await poll(
      async () => {
        const next = await panelObservation();
        return next?.valid && next.expanded === expanded ? next : null;
      },
      expanded
        ? "real diplomacy panel expanded"
        : "real diplomacy panel collapsed",
      35,
      150,
    );
    record(expanded ? "real-panel-opened" : "real-panel-collapsed", {
      ariaExpanded: String(result.expanded),
      input: mobile ? "touch" : "mouse",
    });
  };
  const mapPoint = async (fractions) =>
    evaluate(
      "(() => {" +
        "const canvas=[...document.querySelectorAll('canvas')]" +
        ".filter(c=>c.getBoundingClientRect().width>150)" +
        ".sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0];" +
        "return (" +
        unobstructedCanvasPoint.toString() +
        ")(document,canvas," +
        JSON.stringify(fractions) +
        ");" +
        "})()",
    );
  const fill = async (selector, value) => {
    const target = await poll(
      () =>
        evaluate(`(() => {
      const element = window.__nationalQaFind(${JSON.stringify(selector)});
      if (!element || element.disabled) return null;
      element.scrollIntoView({ block: "center", inline: "nearest" });
      const rect=element.getBoundingClientRect();
      return rect.width && rect.height ? { x:rect.x+rect.width/2, y:rect.y+rect.height/2 } : null;
    })()`),
      selector,
    );
    await hit(target.x, target.y);
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers: 2,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers: 2,
    });
    await send("Input.insertText", { text: value });
    record("typed", { selector, chars: value.length });
  };
  // Select real Lit form values through Chrome's keyboard event path, not
  // DOM.value assignment or a forged event. The selected option must be live.
  const chooseNativeSelect = async (selector, requiredId = null) => {
    const options = await evaluate(
      "(() => { const e=window.__nationalQaFind(" +
        JSON.stringify(selector) +
        "); return e && e.tagName==='SELECT' && !e.disabled ? Array.from(e.options).map(o => ({value:o.value, disabled:o.disabled})) : null; })()",
    );
    if (!Array.isArray(options))
      throw Error("UI_SELECT_MISSING_OR_DISABLED: " + selector);
    if (
      requiredId !== null &&
      !options.some((o) => o.value === requiredId && !o.disabled)
    ) {
      throw Error("ENGINE_REFERENCE_NOT_SELECTABLE_FOR_PRINCIPAL: " + selector);
    }
    if (!options.some((o) => o.value && !o.disabled)) {
      throw Error("NO_REAL_SELECTABLE_GAME_TARGET: " + selector);
    }
    await clickSelector(selector);
    for (let i = 0; i < options.length + 2; i++) {
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "ArrowDown",
        code: "ArrowDown",
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "ArrowDown",
        code: "ArrowDown",
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
      });
      const picked = await evaluate(
        "window.__nationalQaFind(" +
          JSON.stringify(selector) +
          ")?.value ?? ''",
      );
      if (
        picked &&
        (requiredId === null || picked === requiredId) &&
        options.some((o) => o.value === picked && !o.disabled)
      ) {
        record("native-select", { selector, optionValue: picked });
        return picked;
      }
    }
    throw Error("CHROMIUM_NATIVE_OPTION_NOT_SELECTED: " + selector);
  };
  const currentConflicts = () =>
    evaluate(
      "(() => {" +
        "const g=window.__nationalQaFind('national-diplomacy-panel')?.game;" +
        "return g ? { actorId:g.myPlayer?.()?.id?.() ?? null," +
        "tick:g.ticks?.() ?? null," +
        "projection:g.nationalConflicts?.() ?? null," +
        "projectionTick:g.nationalConflictsTick?.() ?? null } : null;" +
        "})()",
    );
  const capture = async (name) => {
    await worker();
    await screenshot(name);
    record("screenshot", {
      label: name,
      packetCount: observed.length,
      assetRequests: runtimeAssetRequests.length,
      restrictedAssets: restrictedRuntimeAssets.length,
    });
    persist();
    if (restrictedRuntimeAssets.length) {
      throw new Error(
        "RESTRICTED_RUNTIME_ASSET_REQUEST: " +
          JSON.stringify(restrictedRuntimeAssets[0]),
      );
    }
  };
  const step = async (name, fn) => {
    stage = name;
    try {
      await fn();
      record("stage-complete", { stage: name });
    } catch (err) {
      errors.push({
        stage: name,
        error: String(err),
        observed: await description().catch(() => null),
      });
      record("stage-failed", {
        stage: name,
        failureClass: String(err).slice(0, 160),
      });
      await capture("failure-" + name).catch(() => {});
      throw err;
    }
  };

  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Log.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: mobile ? 390 : 1280,
      height: mobile ? 844 : 800,
      deviceScaleFactor: 1,
      mobile,
    });
    if (mobile) {
      await send("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 1,
      });
    }
    await send("Page.addScriptToEvaluateOnNewDocument", { source: probe });
    await send("Page.navigate", { url: base });
    await step("home", async () => {
      await poll(
        () =>
          evaluate(
            "document.readyState === 'complete' && document.body.innerText.length > 0",
          ),
        "homepage body",
        80,
      );
      hardwareCapabilities = {
        browser: await send("Browser.getVersion").catch((error) => ({
          error: String(error),
        })),
        ...(await evaluate(`(() => {
          // Real WebGL1/WebGL2 draw + readPixels, not context presence alone.
          const probe = (kind) => {
            const canvas = document.createElement("canvas");
            canvas.width = 4; canvas.height = 4;
            const gl = canvas.getContext(kind, { preserveDrawingBuffer: true });
            if (!gl) return { supported: false };
            const debug = gl.getExtension("WEBGL_debug_renderer_info");
            const info = {
              supported: true,
              vendor: gl.getParameter(gl.VENDOR),
              renderer: gl.getParameter(gl.RENDERER),
              unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
              unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
              contextLost: gl.isContextLost(),
              maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            };
            const modern = kind === "webgl2";
            const vsSource = modern
              ? "#version 300 es\\nin vec2 position;\\nvoid main(){gl_Position=vec4(position,0.,1.);}"
              : "attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}";
            const fsSource = modern
              ? "#version 300 es\\nprecision highp float;\\nout vec4 color;\\nvoid main(){color=vec4(0.2,0.4,0.6,1.0);}"
              : "precision highp float; void main(){gl_FragColor=vec4(0.2,0.4,0.6,1.0);}";
            const compile = (type, source) => {
              const shader = gl.createShader(type);
              gl.shaderSource(shader, source); gl.compileShader(shader);
              if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
                throw Error("shader compile: " + gl.getShaderInfoLog(shader));
              return shader;
            };
            try {
              const program = gl.createProgram();
              gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSource));
              gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSource));
              gl.linkProgram(program);
              if (!gl.getProgramParameter(program, gl.LINK_STATUS))
                throw Error("shader link: " + gl.getProgramInfoLog(program));
              gl.useProgram(program);
              const buffer = gl.createBuffer();
              gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
              gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                -1, -1, 1, -1, -1, 1, 1, 1,
              ]), gl.STATIC_DRAW);
              const pos = gl.getAttribLocation(program, "position");
              if (pos < 0) throw Error("shader attribute missing");
              gl.enableVertexAttribArray(pos);
              gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
              gl.viewport(0, 0, 4, 4);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              const pixels = new Uint8Array(4);
              gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
              info.shaderPixel = Array.from(pixels);
              info.glError = gl.getError();
            } catch (error) {
              info.shaderFailure = String(error);
            }
            return info;
          };
          return { webgl: probe("webgl2"), webgl1: probe("webgl") };
        })()`)),
        systemGpu: await send("SystemInfo.getInfo")
          .then((info) => info.gpu ?? { unavailable: true })
          .catch((error) => ({ unavailable: true, reason: String(error) })),
      };
      record("actual-gpu-webgl1-webgl2-capabilities", {
        graphics: hardwareCapabilities,
      });
      if (hardwareOnly) {
        // Witness is created by a trusted host/controller, not by Chrome or
        // a guest shell. The signer private key must never enter the VM.
        const proofPath = process.env.NATIONAL_GPU_ATTESTATION_FILE;
        const keyPath = process.env.NATIONAL_GPU_PUBLIC_KEY_FILE;
        const trustedKey = keyPath ? readFileSync(keyPath, "utf8") : null;
        const approvedKeys = JSON.parse(
          readFileSync(
            fileURLToPath(new URL("./trusted-gpu-keys.json", import.meta.url)),
            "utf8",
          ),
        ).trustedEd25519PublicKeySha256;
        const keyFingerprint = trustedKey
          ? createHash("sha256").update(trustedKey, "utf8").digest("hex")
          : null;
        if (
          !Array.isArray(approvedKeys) ||
          !approvedKeys.includes(keyFingerprint)
        ) {
          throw Error("GPU_RELEASE_TRUST_ROOT_NOT_ENROLLED_OR_MISMATCH");
        }
        const attestation = verifyHardwareWebgl(hardwareCapabilities, {
          signedProof: proofPath
            ? JSON.parse(readFileSync(proofPath, "utf8"))
            : null,
          trustedPublicKey: trustedKey,
          expected: {
            sourceSha:
              process.env.NATIONAL_GPU_CANDIDATE_SHA ?? process.env.GITHUB_SHA,
            runId: process.env.GITHUB_RUN_ID,
            runAttempt: process.env.GITHUB_RUN_ATTEMPT,
            runnerName: process.env.RUNNER_NAME,
            challenge: process.env.NATIONAL_GPU_ATTESTATION_CHALLENGE,
          },
        });
        record("strict-hardware-renderer-attestation", attestation);
        if (!attestation.accepted) {
          throw new Error("REAL_CHROMIUM_GPU_REQUIRED: " + attestation.reason);
        }
      }
      await capture("home");
    });
    await step("solo", async () => {
      await click("^solo$", "", 80);
      const control = await poll(
        nationalSelection,
        "E4 NATIONAL difficulty button visible in Solo modal",
        40,
        150,
      );
      if (control.label !== NATIONAL_BUTTON_LABEL) {
        throw Error("NATIONAL_SOLO_BUTTON_ACCESSIBILITY_CONTRACT_MISMATCH");
      }
      if (control.pressed !== "false" || control.nationalMode) {
        throw Error("NATIONAL_MUST_NOT_DEFAULT_ON");
      }
      await capture("solo-modal");
    });
    if (legacy) {
      await step("legacy-configuration", async () => {
        await selectNational();
        await selectOrdinaryImpossible();
        await capture("legacy-difficulty-restored");
      });
      await step("legacy-ffa", async () => {
        await click("start|play", "single-player-modal", 65);
        await confirmLaunch(false);
        const ffaStatus = await poll(
          () =>
            evaluate(`(() => {
            const gate = window.__nationalQaFind('webgl-gate');
            if (gate) return { blocked: true, status: gate.status };
            const loading = /game is starting/i.test(document.body.innerText);
            const hud = window.__nationalQaFind('game-right-sidebar');
            const canvas = [...document.querySelectorAll('canvas')].some(
              (item) => item.getBoundingClientRect().width > 150
            );
            return !loading && hud && canvas ? { running: true } : null;
          })()`),
          "real FFA canvas and HUD AFTER loading clears, or WebGL hard blocker",
          100,
          350,
        );
        if (ffaStatus.blocked) {
          throw Error(
            "REAL_CHROMIUM_GPU_REQUIRED: legacy FFA blocked by WebGL gate (" +
              ffaStatus.status +
              ")",
          );
        }
        if (!ffaStatus.running)
          throw Error("Legacy FFA never reached a running game");
        if (
          await evaluate(
            "!!window.__nationalQaFind('national-diplomacy-panel')",
          )
        ) {
          throw Error(
            "Legacy FFA leaked an active NATIONAL diplomacy component",
          );
        }
        await capture("legacy-ffa-game-hud");
        record("legacy-ffa-verified", {
          nationalPanelAbsent: true,
          workerPacketCount: observed.length,
        });
      });
      await step("legacy-player-action", async () => {
        const initial = await worker();
        const lastTick = Math.max(0, ...initial.map((p) => p.tick ?? 0));
        const spawnBefore = await evaluate(
          "(() => { const e=window.__nationalQaFind('game-right-sidebar'); const g=e?.game ?? e?.gameView; const p=g?.myPlayer?.(); return p ? {spawned:p.hasSpawned?.() === true, tiles:p.numTilesOwned?.() ?? 0} : null; })()",
        );
        for (const [u, v] of [
          [0.55, 0.55],
          [0.38, 0.48],
          [0.7, 0.42],
        ]) {
          const position = await evaluate(
            "(() => { const canvas = [...document.querySelectorAll('canvas')].filter((e) => e.getBoundingClientRect().width > 150).sort((a,b) => b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0]; const r=canvas?.getBoundingClientRect(); return r ? { x: r.x + r.width * " +
              u +
              ", y:r.y + r.height * " +
              v +
              " } : null; })()",
          );
          if (!position) throw Error("LEGACY_PLAYABLE_CANVAS_MISSING");
          await hit(position.x, position.y);
          await sleep(450);
        }
        const activity = await poll(
          async () => {
            const packets = await worker();
            return packets.some(
              (p) =>
                (p.tick ?? 0) > lastTick &&
                (p.hasTerritoryDelta === true ||
                  p.hasAuthoritativeAttackDelta === true),
            );
          },
          "legacy real map input followed by authoritative tile or attack update",
          35,
          300,
        );
        if (!activity) throw Error("LEGACY_PLAYER_ACTION_UNCONFIRMED");
        const spawned = await poll(
          async () => {
            const state = await evaluate(
              "(() => { const e=window.__nationalQaFind('game-right-sidebar'); const g=e?.game ?? e?.gameView; const p=g?.myPlayer?.(); return p ? {spawned:p.hasSpawned?.() === true, tiles:p.numTilesOwned?.() ?? 0} : null; })()",
            );
            return state?.spawned &&
              state.tiles > 0 &&
              (!spawnBefore?.spawned || state.tiles > spawnBefore.tiles)
              ? state
              : null;
          },
          "real legacy player spawn/territory after map input",
          35,
          300,
        );
        if (!spawned) throw Error("LEGACY_SPAWN_NOT_AUTHORITATIVELY_OBSERVED");
        record("legacy-actual-map-interaction-authoritative-update", {
          via: mobile ? "touch" : "mouse",
          lastTick,
          playerTiles: spawned.tiles,
        });
        await capture("legacy-player-action");
      });
      return;
    }
    await step("national-mode", async () => {
      await selectNational();
      await capture("national-enabled");
    });
    await step("start", async () => {
      await click("start|play", "single-player-modal", 65);
      await confirmLaunch(true);
      const launch = await poll(
        () =>
          evaluate(`(() => {
          const gate = window.__nationalQaFind('webgl-gate');
          if (gate) return { blocked: true, status: gate.status };
          const panel = window.__nationalQaFind('national-diplomacy-panel');
          const hud = window.__nationalQaFind('game-right-sidebar');
          const canvas = [...document.querySelectorAll('canvas')].some(
            (item) => item.getBoundingClientRect().width > 150
          );
          return panel && hud && canvas && !/game is starting/i.test(document.body.innerText)
            ? { running: true } : null;
        })()`),
        "actual started match or explicit WebGL hard blocker",
        100,
        350,
      );
      if (launch.blocked) {
        throw new Error(
          "REAL_CHROMIUM_GPU_REQUIRED: WebGL gate blocked game startup (" +
            launch.status +
            "). Hosted Ubuntu software GL is not a playable-game acceptance environment.",
        );
      }
      await capture("game-hud");
      const live = await poll(
        async () => {
          const view = await gameObservation();
          return view?.gameType === "Singleplayer" &&
            view.gameId &&
            view.actorId &&
            Number.isSafeInteger(view.tick)
            ? view
            : null;
        },
        "real NATIONAL Solo client admission and live GameView",
        35,
        200,
      ).catch(() => null);
      const packets = await worker();
      if (!live) throw Error("SOLO_TRANSPORT_ADMISSION_NOT_OBSERVED");
      record("solo-transport-admission-observed", {
        gameTypeIsSolo: true,
        actorPresent: true,
        gameIdPresent: true,
        tick: live.tick,
        workerPacketCount: packets.length,
      });
    });
    await step("spawn", async () => {
      // E4 starts collapsed while the player is pre-spawn. Never open it.
      // Inspect real aria-expanded state and only CLOSE if it is open.
      const initialPanel = await panelObservation();
      if (!initialPanel?.valid)
        throw Error("SPAWN_DIPLOMACY_PANEL_STATE_MISSING");
      record("spawn-observed-panel", {
        initiallyExpanded: initialPanel.expanded,
      });
      const before = await gameObservation();
      if (!before || !Number.isSafeInteger(before.tick)) {
        throw Error("SPAWN_GAMEVIEW_UNAVAILABLE");
      }
      record("spawn-before-real-map-input", {
        tick: before.tick,
        paused: before.paused,
        inSpawnPhase: before.inSpawnPhase,
        spawned: before.spawned,
      });
      await capture("diplomacy-before-spawn");
      await setPanelExpanded(false);
      await capture("spawn-unobstructed-map");
      // Every CDP tap must still hit a genuinely unobstructed map canvas.
      const locations = soloSpawnFractions();
      let actualSpawn = before.spawned && before.ownedTiles > 0 ? before : null;
      let unobstructedInputs = 0;
      let obstructedSamples = 0;
      for (const fraction of locations) {
        if (actualSpawn) break;
        const point = await mapPoint([fraction]);
        if (!point) {
          obstructedSamples++;
          continue;
        }
        const observedPanel = await panelObservation();
        if (!observedPanel.valid || observedPanel.expanded) {
          throw Error("SPAWN_MAP_OBSCURED_BY_DIPLOMACY");
        }
        await hit(point.x, point.y);
        unobstructedInputs++;
        actualSpawn = await poll(
          async () => {
            const state = await gameObservation();
            return state?.spawned && state.ownedTiles > 0 ? state : null;
          },
          "engine-owned player spawn from genuine unobstructed map input",
          5,
          250,
        ).catch(() => null);
        if (!actualSpawn && unobstructedInputs % 5 === 0) {
          const state = await gameObservation();
          record("spawn-real-input-checkpoint", {
            unobstructedInputs,
            obstructedSamples,
            tickBefore: before.tick,
            tickAfter: state?.tick ?? null,
            paused: state?.paused ?? null,
            inSpawnPhase: state?.inSpawnPhase ?? null,
            workerPacketCount: (await worker()).length,
          });
          if (state?.inSpawnPhase === false && state?.spawned !== true)
            throw Error("SPAWN_PHASE_EXITED_WITHOUT_OWNERSHIP");
        }
      }
      if (!actualSpawn) {
        const state = await gameObservation();
        record("spawn-real-input-failed", {
          unobstructedInputs,
          obstructedSamples,
          tickBefore: before.tick,
          tickAfter: state?.tick ?? null,
          paused: state?.paused ?? null,
          inSpawnPhase: state?.inSpawnPhase ?? null,
          workerPacketCount: (await worker()).length,
        });
        throw Error(
          unobstructedInputs === 0
            ? "SPAWN_NO_UNOBSTRUCTED_CANVAS_POINT"
            : "SPAWN_NOT_ACCEPTED_AFTER_REAL_MAP_INPUT",
        );
      }
      record("engine-spawn-verified", {
        source: "GameView.myPlayer.hasSpawned+ownedTiles",
        input: mobile ? "touch" : "mouse",
        unobstructedInputs,
        obstructedSamples,
        tickBefore: before.tick,
        tickAfter: actualSpawn.tick,
      });
      await setPanelExpanded(true);
      await poll(
        () => locate("^Found Empire$", "national-diplomacy-panel"),
        "visible enabled Found Empire after authentic spawn",
        35,
        175,
      );
      await capture("player-spawned");
    });
    await step("found-empire", async () => {
      const empireId = "R11_Browser_QA";
      const attached = await evaluate(`(async () => {
        const panel = window.__nationalQaFind("national-diplomacy-panel");
        if (!panel?.eventBus || !panel.game?.myPlayer()) return false;
        const { SendNationalFoundEmpireIntentEvent } =
          await import("/src/client/Transport.ts");
        window.__nationalQaRequests = [];
        panel.eventBus.on(SendNationalFoundEmpireIntentEvent, (event) => {
          window.__nationalQaRequests.push({
            empireId: event.empireId,
            requestId: event.requestId,
          });
        });
        return true;
      })()`);
      if (!attached) throw Error("FOUNDING_REAL_EVENTBUS_NOT_CONNECTED");
      const prior = await gameObservation();
      if (
        !prior?.spawned ||
        !(prior.ownedTiles > 0) ||
        typeof prior.actorId !== "string" ||
        !Number.isSafeInteger(prior.tick)
      ) {
        throw Error("FOUNDING_ACTOR_NOT_CANONICALLY_SPAWNED");
      }
      await fill("#national-empire-id", empireId);
      await click("^Found Empire$", "national-diplomacy-panel", 40);
      submittedFounding = await evaluate(
        "window.__nationalQaRequests?.[0] ?? null",
      );
      if (
        submittedFounding?.empireId !== empireId ||
        !/^nf_[a-f0-9]{32}$/.test(submittedFounding?.requestId ?? "")
      ) {
        throw Error("REAL_FOUNDING_REQUEST_ID_MISSING_OR_INVALID");
      }
      // E4 exposes a read-only pending-command identity, not an acceptance
      // receipt. Correlate it when visible; a fast resolved command can have
      // already cleared the pending DOM, so do not fabricate a missing view.
      const pendingUi = await evaluate(`(() => {
        const n=document.querySelector('[data-national-founding-request-id]');
        return n ? {
          requestId:n.getAttribute('data-national-founding-request-id'),
          actorId:n.getAttribute('data-national-founding-actor-id'),
        } : null;
      })()`);
      if (
        pendingUi &&
        (pendingUi.requestId !== submittedFounding.requestId ||
          pendingUi.actorId !== prior.actorId)
      )
        throw Error("FOUNDING_UI_PENDING_IDENTITY_MISMATCH_OWNER_E4");
      record("founding-real-click-submitted", {
        requestFingerprint: createHash("sha256")
          .update(submittedFounding.requestId)
          .digest("hex")
          .slice(0, 16),
        issuedTick: prior.tick,
        actorCorrelated: true,
        pendingUiObserved: pendingUi !== null,
        uiIdentityMatched: pendingUi !== null,
        source: "real EventBus via CDP clicked founding button",
      });
      await capture("founding-request");
      let last = null;
      let result = null;
      // Bounded: diagnostics distinguish a paused engine from an E3 packet
      // delivery problem, roster mismatch, and an E4 UI reconciliation bug.
      for (let attempt = 0; attempt < 32; attempt++) {
        const observedState = await evaluate(
          "(() => {" +
            "const panel=window.__nationalQaFind('national-diplomacy-panel');" +
            "const g=panel?.game;" +
            "if(!g) return null;" +
            "return { tick:g.ticks?.() ?? null," +
            "paused:g.isPaused?.() ?? null," +
            "actorId:g.myPlayer?.()?.id?.() ?? null," +
            "results:g.nationalFoundingResults?.() ?? []," +
            "publicEmpires:g.nationalPolitics?.()?.empires ?? null," +
            "uiConfirmed:/Confirmed by game: your nation founded/.test(panel.innerText)," +
            "snapshotTick:g.nationalPoliticsTick?.() ?? null };" +
            "})()",
        );
        if (!observedState) throw Error("FOUNDING_GAMEVIEW_DISAPPEARED");
        if (observedState.actorId !== prior.actorId) {
          throw Error("FOUNDING_ACTOR_CHANGED_DURING_REQUEST");
        }
        const packets = await worker();
        const journal = packets
          .flatMap((p) =>
            Array.isArray(p.commandResults) ? p.commandResults : [],
          )
          .filter((r) => r?.requestId === submittedFounding.requestId);
        const view = Array.isArray(observedState.results)
          ? observedState.results.filter(
              (r) => r?.requestId === submittedFounding.requestId,
            )
          : [];
        last = classifyFoundingEvidence({
          actorId: prior.actorId,
          empireId,
          requestId: submittedFounding.requestId,
          issuedTick: prior.tick,
          tick: observedState.tick,
          paused: observedState.paused,
          snapshotTick: observedState.snapshotTick,
          results: [...journal, ...view],
          publicEmpires: observedState.publicEmpires,
          uiConfirmed: observedState.uiConfirmed,
        });
        if (
          attempt === 0 ||
          attempt === 8 ||
          attempt === 16 ||
          attempt === 31 ||
          last.status !== "pending"
        ) {
          record("founding-engine-checkpoint", {
            attempt,
            tickBefore: prior.tick,
            tickAfter: observedState.tick,
            snapshotTick: observedState.snapshotTick,
            paused: observedState.paused,
            matchedJournal: journal.length,
            matchedView: view.length,
            hasRoster:
              Array.isArray(observedState.publicEmpires) &&
              observedState.publicEmpires.some((e) => e.id === empireId),
            uiConfirmed: observedState.uiConfirmed,
            classification: last.reason,
            owner: last.owner,
          });
        }
        if (last.status === "accepted") {
          result = last;
          break;
        }
        if (last.status === "rejected" || last.status === "blocked") {
          throw Error(last.reason + "_OWNER_" + last.owner);
        }
        await sleep(300);
      }
      if (!result)
        throw Error(
          (last?.reason ?? "FOUNDING_UNRESOLVED") +
            "_OWNER_" +
            (last?.owner ?? "UNKNOWN"),
        );
      record("authoritative-empire-accepted", {
        verified: true,
        actorCorrelated: true,
        recipientCorrelated: true,
        authenticPublicRoster: true,
      });
      await capture("confirmed-empire");
    });
    if (!soloOnly)
      await step("rejected-founding", async () => {
        // Duplicate founding is intentionally injected through the application's
        // real EventBus and Transport, NOT by faking any game/worker state.
        // The UI correctly hides its form after founding; the authenticated
        // engine must still reject a malicious duplicate command.
        const duplicateRequestId = "nf_" + randomBytes(16).toString("hex");
        const request = await evaluate(`(async () => {
        const panel = window.__nationalQaFind('national-diplomacy-panel');
        if (!panel?.eventBus) return 'missing live EventBus';
        const transport = await import('/src/client/Transport.ts');
        panel.eventBus.emit(
          new transport.SendNationalFoundEmpireIntentEvent(
            'R11_Browser_QA', ${JSON.stringify(duplicateRequestId)}
          )
        );
        return 'existing authenticated transport emitted duplicate';
      })()`);
        record("duplicate-command-request-id", {
          requestId: duplicateRequestId,
        });
        if (request !== "existing authenticated transport emitted duplicate") {
          throw Error(
            "Could not trigger actual duplicate founding via live event bus: " +
              request,
          );
        }
        const rejection = await poll(
          async () => {
            const pkts = await worker();
            return pkts.some((p) =>
              p.commandResults?.some(
                (r) =>
                  r.type === "national_found_empire" &&
                  r.empireId === "R11_Browser_QA" &&
                  r.requestId === duplicateRequestId &&
                  r.accepted === false,
              ),
            );
          },
          "actual worker-scoped rejected duplicate founding",
          65,
          350,
        );
        if (!rejection)
          throw Error("Engine did not reject duplicate founded empire");
        record("authoritative-duplicate-rejected");
        await capture("founding-rejected");
      });
    if (!soloOnly) {
      // Only REAL authenticated browser sessions can discharge these stages.
      // A standalone Solo match with a single human cannot fabricate a second.
      const empireId = "R11_Browser_QA";
      let candidateId = null;
      let accessionRequest = null;
      let accessionReceiptTick = null;
      // The shipped Solo path has one local authority. Even a manually opened
      // second Solo tab is a DIFFERENT LocalServer, not a trusted three-player
      // match. Source success below cannot be promoted into browser acceptance.
      await step("trusted-three-principal-host", async () => {
        const observedHost = await evaluate(`(() => {
        const g=window.__nationalQaFind('national-diplomacy-panel')?.game;
        const c=g?.config?.()?.gameConfig?.();
        return {
          gameType:c?.gameType ?? null,
          nationalMode:c?.nationalMode === true,
          gameTick:g?.ticks?.() ?? null,
          paused:g?.isPaused?.() ?? null,
        };
      })()`);
        record("trusted-national-host-check", {
          source: "real live GameView game configuration",
          tick: observedHost?.gameTick ?? null,
          paused: observedHost?.paused ?? null,
          nationalMode: observedHost?.nationalMode === true,
          isSolo: observedHost?.gameType === "Singleplayer",
        });
        if (observedHost?.gameType === "Singleplayer")
          throw Error("NATIONAL_SOLO_CANNOT_PROVE_THREE_PRINCIPALS_OWNER_E2");
        // Private NATIONAL is not trusted: legacy Private runs unfiltered
        // per-client game state. E2 must supply a separately verified host
        // capability before E5 can exercise multiplayer or expose packets.
        throw Error("NATIONAL_TRUSTED_SERVER_MULTIPLAYER_REQUIRED_OWNER_E2");
      });
      await step("offer-accession", async () => {
        await setPanelExpanded(true);
        const before = await primaryPoliticalObservation();
        if (
          !before?.actorId ||
          before.spectator ||
          !before.spawned ||
          !Number.isSafeInteger(before.tick)
        )
          throw Error("POLITICAL_FOUNDING_SESSION_UNAVAILABLE_OWNER_E2_E4");
        const own = before.empires?.find((e) => e.id === empireId);
        if (
          !own ||
          own.leaderId !== before.actorId ||
          !own.memberIds?.includes(before.actorId)
        )
          throw Error("POLITICAL_FOUNDING_ROSTER_NOT_CURRENT_OWNER_E1_E3");
        await watchPrimaryPoliticalIntent("offer");
        candidateId = await chooseNativeSelect(
          "#national-accession-candidate",
        ).catch(() => {
          throw Error("POLITICAL_NO_LIVING_RECIPIENT_IN_UI_OWNER_E2_E4");
        });
        if (candidateId === before.actorId)
          throw Error("POLITICAL_SELF_ACCESSION_OFFER_FORBIDDEN");
        await clickSelector("#national-offer-accession");
        accessionRequest = await primaryPoliticalClick();
        if (
          accessionRequest?.empireId !== empireId ||
          accessionRequest.targetId !== candidateId ||
          !/^np_[a-f0-9]{32}$/.test(accessionRequest?.requestId ?? "")
        )
          throw Error("POLITICAL_OFFER_REAL_CLICK_NOT_OBSERVED_OWNER_E4");
        record("political-offer-real-click", {
          actorCorrelated: true,
          targetCorrelated: true,
          requestFingerprint: createHash("sha256")
            .update(accessionRequest.requestId)
            .digest("hex")
            .slice(0, 16),
        });
        const accepted = await poll(
          async () => {
            const state = await primaryPoliticalObservation();
            if (
              state?.actorId !== before.actorId ||
              state.gameId !== before.gameId
            )
              throw Error("POLITICAL_FOUNDER_PRINCIPAL_CHANGED_OWNER_E2_E4");
            const verdict = reconcilePoliticalReceipt({
              type: "national_offer_empire",
              requestId: accessionRequest.requestId,
              actorId: before.actorId,
              empireId,
              targetId: candidateId,
              issuedTick: before.tick,
              currentTick: state.tick,
              politicsTick: state.politicsTick,
              results: state.politicalResults,
              empires: state.empires,
            });
            if (
              verdict.reason.startsWith("POLITICAL_ENGINE_REJECTED") ||
              verdict.reason.startsWith("POLITICAL_FORGED") ||
              verdict.reason.startsWith("POLITICAL_CONTRADICTORY")
            )
              throw Error(verdict.reason + "_OWNER_" + verdict.owner);
            return verdict.accepted ? verdict : null;
          },
          "actual founder offer receipt and current public roster",
          55,
          225,
        );
        accessionReceiptTick = accepted.receiptTick;
        record("political-offer-engine-accepted", {
          receiptTick: accepted.receiptTick,
          sequence: accepted.sequence,
          invitationDelivered: false,
        });
        await capture("political-offer-accepted");
      });
      await step("recipient-invitation", async () => {
        // E6 provisions an independently admitted, ALREADY LIVE browser.
        // The E5 harness neither creates a tab nor changes a player identity.
        politicalPeer = await openPeer(process.env.NATIONAL_QA_PEER_CDP_PORT);
        const founder = await primaryPoliticalObservation();
        const recipient = await politicalPeer.observe();
        const distinct = verifyDistinctLiveSessions(
          founder,
          recipient,
          candidateId,
        );
        if (!distinct.accepted)
          throw Error(distinct.reason + "_OWNER_" + distinct.owner);
        const received = await poll(
          async () => {
            const fresh = await politicalPeer.observe();
            if (
              fresh?.actorId !== candidateId ||
              fresh.gameId !== founder.gameId ||
              fresh.spectator ||
              !fresh.spawned ||
              fresh.ownedTiles <= 0
            )
              throw Error("POLITICAL_RECIPIENT_SESSION_CHANGED_OWNER_E2_E4");
            if (
              !Number.isSafeInteger(fresh.tick) ||
              fresh.tick < accessionReceiptTick
            )
              return null;
            const owner = await primaryPoliticalObservation();
            const verdict = verifyPrivateInvitation({
              founderId: founder.actorId,
              recipientId: candidateId,
              empireId,
              recipientView: fresh.accessionOffers,
              recipientTick: fresh.tick,
              founderView: owner?.accessionOffers,
            });
            if (
              verdict.reason ===
                "POLITICAL_PRIVATE_INVITATION_LEAKED_TO_SENDER" ||
              verdict.reason ===
                "POLITICAL_FOREIGN_INVITATION_IN_RECIPIENT_VIEW"
            )
              throw Error(verdict.reason + "_OWNER_E3");
            return verdict.accepted ? verdict : null;
          },
          "recipient-only authenticated accession offer in separate browser",
          40,
          225,
        );
        if (!received.accepted)
          throw Error("POLITICAL_PRIVATE_INVITATION_UNCONFIRMED_OWNER_E3");
        record("political-recipient-private-invitation", {
          recipientOnly: true,
          secondAuthenticatedSession: true,
          originatingOfferReceiptMatched: true,
        });
        await politicalPeer.ensurePanel();
        // Never publish screenshots of a recipient-only private UI.
      });
      await step("recipient-acceptance", async () => {
        if (!politicalPeer || !candidateId)
          throw Error("POLITICAL_AUTHENTIC_RECIPIENT_ABSENT");
        const before = await politicalPeer.observe();
        const founder = await primaryPoliticalObservation();
        const matching = verifyDistinctLiveSessions(
          founder,
          before,
          candidateId,
        );
        if (!matching.accepted)
          throw Error(matching.reason + "_OWNER_" + matching.owner);
        await politicalPeer.watchIntent("accept-empire");
        await politicalPeer.select("#national-invitation-empire", empireId);
        await politicalPeer.click("#national-accept-accession");
        const click = await politicalPeer.observedClick();
        if (
          click?.empireId !== empireId ||
          click.candidateId !== candidateId ||
          !/^np_[a-f0-9]{32}$/.test(click?.requestId ?? "")
        )
          throw Error("POLITICAL_ACCEPT_NATIVE_CLICK_NOT_OBSERVED_OWNER_E4");
        record("political-accept-real-recipient-click", {
          differentPrincipal: true,
          realCdpInput: true,
        });
        // Never publish screenshots of a recipient-only private UI.
        const accepted = await poll(
          async () => {
            const state = await politicalPeer.observe();
            if (
              state?.actorId !== candidateId ||
              state.gameId !== before.gameId
            )
              throw Error("POLITICAL_ACCEPT_SESSION_REPLACED_OWNER_E2_E4");
            const verdict = reconcilePoliticalReceipt({
              type: "national_accept_empire",
              requestId: click.requestId,
              actorId: candidateId,
              empireId,
              targetId: candidateId,
              issuedTick: before.tick,
              currentTick: state.tick,
              politicsTick: state.politicsTick,
              results: state.politicalResults,
              empires: state.empires,
            });
            if (
              verdict.reason.startsWith("POLITICAL_ENGINE_REJECTED") ||
              verdict.reason.startsWith("POLITICAL_FORGED") ||
              verdict.reason.startsWith("POLITICAL_CONTRADICTORY")
            )
              throw Error(verdict.reason + "_OWNER_" + verdict.owner);
            if (!verdict.accepted) return null;
            const founderNow = await primaryPoliticalObservation();
            const corroborated = corroboratePublicEmpire({
              emperor: founderNow,
              recipient: state,
              empireId,
              leaderId: founder.actorId,
              memberIds: [founder.actorId, candidateId],
              minTick: verdict.receiptTick,
            });
            return corroborated.accepted ? verdict : null;
          },
          "independent accepting principal, exact receipt and both current rosters",
          55,
          225,
        );
        record("political-membership-confirmed-by-both", {
          recipientAccepted: true,
          founderRosterAgrees: true,
          receiptTick: accepted.receiptTick,
        });
        await capture("political-member-joined-founders-view");
        // Never publish screenshots of a recipient-only private UI.
      });
      await step("transfer-crown", async () => {
        const before = await primaryPoliticalObservation();
        if (!before?.actorId || !politicalPeer)
          throw Error("POLITICAL_CROWN_FOUNDER_SESSION_MISSING");
        await watchPrimaryPoliticalIntent("crown");
        await chooseNativeSelect("#national-crown-successor", candidateId);
        await clickSelector("#national-transfer-crown");
        const request = await primaryPoliticalClick();
        if (
          request?.targetId !== candidateId ||
          request.empireId !== empireId ||
          !/^np_[a-f0-9]{32}$/.test(request?.requestId ?? "")
        )
          throw Error("POLITICAL_CROWN_CLICK_NOT_ACTUAL_OWNER_E4");
        record("political-real-crown-click", {
          successorMatched: true,
          realCdpInput: true,
        });
        const done = await poll(
          async () => {
            const founder = await primaryPoliticalObservation();
            const recipient = await politicalPeer.observe();
            if (
              founder?.actorId !== before.actorId ||
              recipient?.actorId !== candidateId ||
              founder.gameId !== before.gameId ||
              recipient.gameId !== before.gameId
            )
              throw Error("POLITICAL_CROWN_ACTOR_CHANGED_OWNER_E2_E4");
            const verdict = reconcilePoliticalReceipt({
              type: "national_transfer_crown",
              requestId: request.requestId,
              actorId: before.actorId,
              empireId,
              targetId: candidateId,
              issuedTick: before.tick,
              currentTick: founder.tick,
              politicsTick: founder.politicsTick,
              results: founder.politicalResults,
              empires: founder.empires,
            });
            if (
              verdict.reason.startsWith("POLITICAL_ENGINE_REJECTED") ||
              verdict.reason.startsWith("POLITICAL_FORGED") ||
              verdict.reason.startsWith("POLITICAL_CONTRADICTORY")
            )
              throw Error(verdict.reason + "_OWNER_" + verdict.owner);
            if (!verdict.accepted) return null;
            const agree = corroboratePublicEmpire({
              emperor: founder,
              recipient,
              empireId,
              leaderId: candidateId,
              memberIds: [founder.actorId, candidateId],
              minTick: verdict.receiptTick,
            });
            if (!agree.accepted) return null;
            const revoked = await evaluate(
              "document.querySelector('#national-offer-accession')===null&&" +
                "document.querySelector('#national-transfer-crown')===null",
            );
            return revoked ? verdict : null;
          },
          "genuine crown transfer + former emperor loses controls + both rosters",
          55,
          225,
        );
        record("political-crown-confirmed-by-both", {
          receiptTick: done.receiptTick,
          formerEmperorRevoked: true,
          successorIsDifferentPrincipal: true,
        });
        await capture("political-crown-former-emperor-revoked");
        // Never publish screenshots of a recipient-only private UI.
      });
    }
    // Save/restore is a separate protected-server gate. Do not block the
    // concrete WAR→attack→peace slice behind an unavailable browser save UI.
    // Do not treat this separation as a release-security pass.
    let warId = null;
    let warTargetId = null;
    let combatBaseline = null;
    let soloBattleAttack = null;
    let peaceMotionId = null;
    await step("declare-war", async () => {
      let realWarOpponentId = null;
      // The accession recipient is now in our empire. WAR requires a
      // DIFFERENT genuinely admitted living opponent, not a bot from the
      // first dropdown option or an invented test principal.
      if (!soloOnly) {
        peacePeer = await openPeer(process.env.NATIONAL_QA_PEACE_CDP_PORT);
        const founderSession = await primaryPoliticalObservation();
        const opposingSession = await peacePeer.observe();
        const recipientSession = await politicalPeer?.observe();
        const legitimate = verifyThreeLivePrincipals(
          founderSession,
          recipientSession,
          opposingSession,
        );
        if (!legitimate.accepted) {
          throw Error(legitimate.reason + "_OWNER_" + legitimate.owner);
        }
        if (
          founderSession.empires?.some(
            (empire) =>
              empire.memberIds?.includes(founderSession.actorId) &&
              empire.memberIds.includes(opposingSession.actorId),
          )
        ) {
          throw Error("WAR_OPPONENT_IS_SAME_EMPIRE_OWNER_E2_E4");
        }
        realWarOpponentId = opposingSession.actorId;
        record("war-opponent-identity-verified", {
          differentPrincipal: true,
          sameGameId: true,
          targetNotEmpireMember: true,
        });
      }
      const hooked = await evaluate(
        "(async () => {" +
          "const panel=window.__nationalQaFind('national-diplomacy-panel');" +
          "if (!panel?.eventBus || !panel.game?.myPlayer()) return false;" +
          "const T=await import('/src/client/Transport.ts');" +
          "window.__nationalQaDiplomacyRequests=[];" +
          "panel.eventBus.on(T.SendNationalDeclareWarIntentEvent,e=>window.__nationalQaDiplomacyRequests.push({type:'national_declare_war',requestId:e.requestId,targetId:e.targetId,scope:e.scope}));" +
          "panel.eventBus.on(T.SendNationalProposePeaceIntentEvent,e=>window.__nationalQaDiplomacyRequests.push({type:'national_propose_peace',requestId:e.requestId,warId:e.warId}));" +
          "panel.eventBus.on(T.SendNationalAcceptPeaceIntentEvent,e=>window.__nationalQaDiplomacyRequests.push({type:'national_accept_peace',requestId:e.requestId,motionId:e.motionId}));" +
          "return true;" +
          "})()",
      );
      if (!hooked) throw Error("WAR_EVENTBUS_OBSERVER_NOT_CONNECTED");
      const expectedOpponentId = soloOnly ? null : realWarOpponentId;
      const targetId = await chooseNativeSelect(
        "#national-war-target",
        expectedOpponentId,
      );
      if (soloOnly) {
        const target = await evaluate(
          "(() => {const g=document.querySelector('national-diplomacy-panel')?.game;" +
            "const id=" +
            JSON.stringify(targetId) +
            ";" +
            "const p=g?.players?.()?.find(x=>x.id?.()===id);" +
            "const self=g?.myPlayer?.();" +
            "return p&&self?{alive:p.isAlive?.()===true," +
            "spawned:p.hasSpawned?.()===true,tiles:p.numTilesOwned?.()??0," +
            "different:p.id()!==self.id()} : null;})()",
        );
        if (
          !target?.alive ||
          !target.spawned ||
          !target.different ||
          !(target.tiles > 0)
        )
          throw Error("SOLO_WAR_TARGET_NOT_LIVING_OPPONENT");
        record("solo-actual-opponent-selected", {
          alive: true,
          spawned: true,
          opponentHasTiles: true,
          nativeSelect: true,
        });
      }
      const before = await currentConflicts();
      if (!before?.actorId || !Number.isSafeInteger(before.tick)) {
        throw Error("NO_AUTHENTICATED_NATIONAL_ACTOR_FOR_WAR");
      }
      await clickSelector("#national-declare-war");
      const request = await evaluate(
        "window.__nationalQaDiplomacyRequests?.find(x=>x.type==='national_declare_war') ?? null",
      );
      if (
        !request ||
        request.scope !== "national" ||
        request.targetId !== targetId ||
        !/^nc_[a-f0-9]{32}$/.test(request.requestId)
      ) {
        throw Error("WAR_CLICK_DID_NOT_EMIT_REAL_REQUEST");
      }
      record("actual-war-button-request", { type: request.type, targetId });
      const matched = await poll(
        async () => {
          const state = await currentConflicts();
          const verdict = reconcileDiplomacyEvidence(await worker(), {
            type: request.type,
            requestId: request.requestId,
            actorId: before.actorId,
            targetId,
            issuedTick: before.tick,
            projection: state?.projection,
            projectionTick: state?.projectionTick,
          });
          const status = await evaluate(
            "window.__nationalQaFind('[data-national-diplomacy-status]')?.innerText ?? ''",
          );
          if (verdict.reason === "ENGINE_REJECTED_ACTION") {
            return {
              rejected: true,
              reason: "ENGINE_REJECTED_WAR_DECLARATION",
            };
          }
          return verdict.accepted && /War confirmed by game/i.test(status)
            ? { ...verdict, uiConfirmed: true }
            : null;
        },
        "actual user war click + recipient-scoped result + active public layer",
        90,
        350,
      );
      if (matched.rejected) throw Error(matched.reason);
      warId = matched.warId;
      warTargetId = targetId;
      record("authoritative-war-declared", {
        warId,
        receiptTick: matched.receiptTick,
        sequence: matched.sequence,
        uiConfirmed: matched.uiConfirmed,
      });
      await capture("declared-war-live");
    });
    await step("map-assault", async () => {
      const listened = await evaluate(
        "(async () => {" +
          "const panel=window.__nationalQaFind('national-diplomacy-panel');" +
          "if (!panel?.eventBus) return false;" +
          "const T=await import('/src/client/Transport.ts');" +
          "window.__nationalQaMapAttacks=[];" +
          "panel.eventBus.on(T.SendAttackIntentEvent,e=>window.__nationalQaMapAttacks.push({targetId:e.targetID,troops:e.troops}));" +
          "return true;" +
          "})()",
      );
      if (!listened) throw Error("REAL_MAP_ATTACK_OBSERVER_UNAVAILABLE");
      if (!warTargetId) throw Error("WAR_TARGET_NOT_AUTHENTICATED");
      combatBaseline = await evaluate(
        "(() => {" +
          "const g=window.__nationalQaFind('national-diplomacy-panel')?.game;" +
          "const t=g?.players?.()?.find(p=>p.id?.()===" +
          JSON.stringify(warTargetId) +
          ");" +
          "return t ? {id:t.id(),smallID:t.smallID?.() ?? null," +
          "troops:t.troops?.() ?? null," +
          "tiles:t.numTilesOwned?.() ?? null} : null;" +
          "})()",
      );
      if (
        !combatBaseline ||
        !Number.isSafeInteger(combatBaseline.smallID) ||
        !Number.isSafeInteger(combatBaseline.tiles) ||
        combatBaseline.tiles <= 0
      ) {
        throw Error("CANONICAL_WAR_TARGET_BASELINE_UNAVAILABLE");
      }
      const existing = await worker();
      const lastSequence = Math.max(0, ...existing.map((p) => p.sequence ?? 0));
      const previousOutgoing = await evaluate(
        "(() => {const a=window.__nationalQaFind('national-diplomacy-panel')" +
          "?.game?.myPlayer?.()?.outgoingAttacks?.();" +
          "return Array.isArray(a) ? a.filter(x=>x.targetID===" +
          combatBaseline.smallID +
          ").length : null;})()",
      );
      if (!Number.isSafeInteger(previousOutgoing)) {
        throw Error("PLAYER_ATTACK_STATE_UNAVAILABLE");
      }
      // E4 must expose a genuine visible map anchor for the selected living
      // rival. Never guess arbitrary screen coordinates or emit Attack intents
      // directly. The marker is only a read-only locator on the rendered map.
      await setPanelExpanded(false);
      const target = await poll(
        () =>
          evaluate(
            "(() => {" +
              "const actor=" +
              JSON.stringify(warTargetId) +
              ";" +
              "const anchor=[...document.querySelectorAll('[data-national-map-target-id]')]" +
              ".find(e=>e.getAttribute('data-national-map-target-id')===actor);" +
              "if(!anchor) return null;" +
              "const rect=anchor.getBoundingClientRect();" +
              "const x=Math.round(rect.x+rect.width/2);" +
              "const y=Math.round(rect.y+rect.height/2);" +
              "const canvas=[...document.querySelectorAll('canvas')]" +
              ".find(c=>{const r=c.getBoundingClientRect();" +
              "return x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom;});" +
              "const top=document.elementFromPoint(x,y);" +
              "return rect.width>0&&rect.height>0&&canvas&&" +
              "(top===canvas||canvas.contains(top))" +
              "? {x,y,targetId:actor}:null;" +
              "})()",
          ),
        "visible unobstructed player-target map anchor from E4",
        12,
        200,
      ).catch(() => null);
      if (!target) throw Error("TARGET_AWARE_MAP_ANCHOR_MISSING_OWNER_E4");
      if (mobile) {
        await hit(target.x, target.y);
      } else {
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: target.x,
          y: target.y,
        });
        await send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: target.x,
          y: target.y,
          button: "right",
          clickCount: 1,
        });
        await send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: target.x,
          y: target.y,
          button: "right",
          clickCount: 1,
        });
        record("actual-secondary-pointer", { targetAware: true });
      }
      const radial = await poll(
        () =>
          evaluate(
            "(() => {" +
              "const menu=document.querySelector('.radial-menu-container');" +
              "if(!menu||getComputedStyle(menu).display==='none')return null;" +
              "const center=menu.querySelector('.center-button-hitbox');" +
              "if(!center)return null;" +
              "const r=center.getBoundingClientRect();" +
              "return {targetId:menu.getAttribute('data-target-player-id')," +
              "buttonEnabled:getComputedStyle(center).cursor==='pointer'," +
              "x:r.x+r.width/2,y:r.y+r.height/2};" +
              "})()",
          ),
        "actual target-labelled radial menu and enabled Attack center",
        32,
        180,
      ).catch(() => null);
      if (!radial) throw Error("TARGET_AWARE_RADIAL_MENU_MISSING_OWNER_E4");
      const canAttack = acceptRadialTarget({
        expectedId: warTargetId,
        actualId: radial.targetId,
        buttonEnabled: radial.buttonEnabled,
      });
      if (!canAttack.accepted) throw Error(canAttack.reason + "_OWNER_E4");
      // The enabled, genuinely rendered center Attack control triggers the
      // application's normal PlayerActionHandler under real input.
      await capture("radial-attack-enabled");
      await hit(radial.x, radial.y);
      record("real-target-aware-radial-attack", {
        targetMatch: true,
        enabled: true,
        pointer: mobile ? "touch" : "mouse",
      });
      const attacks = await evaluate("window.__nationalQaMapAttacks ?? []");
      if (
        !attacks.some(
          (a) =>
            a.targetId === warTargetId &&
            Number.isFinite(a.troops) &&
            a.troops > 0,
        )
      ) {
        throw Error("MAP_ATTACK_ON_DECLARED_WAR_TARGET_NOT_DISPATCHED");
      }
      const authoritative = await poll(
        async () => {
          const packets = await worker();
          const attackCount = await evaluate(
            "(() => {const a=window.__nationalQaFind('national-diplomacy-panel')" +
              "?.game?.myPlayer?.()?.outgoingAttacks?.();" +
              "return Array.isArray(a) ? a.filter(x=>x.targetID===" +
              combatBaseline.smallID +
              ").length : null;})()",
          );
          const resultFromEngine = packets.some(
            (p) =>
              p.sequence > lastSequence &&
              (p.hasAuthoritativeAttackDelta === true ||
                p.hasAuthoritativeMotion === true),
          );
          return Number.isSafeInteger(attackCount) &&
            attackCount > previousOutgoing &&
            resultFromEngine
            ? { attackCount }
            : null;
        },
        "actual own outgoing attack plus authoritative combat packet",
        60,
        300,
      );
      if (!authoritative) throw Error("MAP_ASSAULT_LACKS_OWN_ENGINE_ATTACK");
      if (soloOnly) {
        soloBattleAttack = {
          targetId: warTargetId,
          emitted: attacks,
          before: combatBaseline,
          outgoingBefore: previousOutgoing,
          outgoingAfter: authoritative.attackCount,
          firstSequence: lastSequence,
        };
      }
      record("actual-war-map-assault", {
        input: mobile ? "touch" : "mouse",
        dispatched: attacks.length,
        observedEngineChange: true,
      });
      await capture("map-assault-confirmed");
      await setPanelExpanded(true);
    });
    await step("combat-impact", async () => {
      if (!combatBaseline || combatBaseline.id !== warTargetId) {
        throw Error("COMBAT_DAMAGE_BASELINE_MISSING");
      }
      const impact = await poll(
        async () => {
          const state = await evaluate(
            "(() => {" +
              "const g=window.__nationalQaFind('national-diplomacy-panel')?.game;" +
              "const t=g?.players?.()?.find(p=>p.id?.()===" +
              JSON.stringify(warTargetId) +
              ");" +
              "return t ? {id:t.id(),troops:t.troops?.() ?? null," +
              "tiles:t.numTilesOwned?.() ?? null} : null;" +
              "})()",
          );
          if (!state || !Number.isSafeInteger(state.tiles)) {
            return null;
          }
          const troopLoss =
            Number.isFinite(combatBaseline.troops) &&
            Number.isFinite(state.troops) &&
            state.troops < combatBaseline.troops;
          return troopLoss || state.tiles < combatBaseline.tiles ? state : null;
        },
        "engine-derived war target troop loss or territory loss",
        120,
        300,
      );
      if (!impact) throw Error("REAL_WAR_DAMAGE_NOT_OBSERVED");
      if (soloOnly) {
        const proof = classifySoloBattleEvidence({
          ...soloBattleAttack,
          after: impact,
          packets: await worker(),
        });
        if (!proof.accepted) throw Error(proof.reason);
        record("solo-real-battle-engine-correlated", {
          opponentDamaged: true,
          troopLoss: proof.troopLoss,
          territoryLoss: proof.territoryLoss,
        });
      }
      record("authoritative-combat-impact", {
        warId,
        targetId: warTargetId,
        actualOpponentLoss: true,
      });
      await capture("combat-impact-canonical");
    });
    if (soloOnly) {
      await step("solo-playability-complete", async () => {
        const live = await gameObservation();
        const packets = await worker();
        if (
          live?.gameType !== "Singleplayer" ||
          !live.spawned ||
          !(live.ownedTiles > 0) ||
          !warId ||
          !warTargetId ||
          !combatBaseline
        )
          throw Error("SOLO_GAMEPLAY_FINAL_AUTHORITY_MISSING");
        record("authoritative-solo-playability-complete", {
          founded: true,
          spawned: true,
          warDeclared: true,
          realRadialAttack: true,
          opponentDamaged: true,
          liveTick: live.tick,
          workerPacketCount: packets.length,
        });
        await capture("solo-battle-authoritative");
      });
      return;
    }
    await step("propose-peace", async () => {
      if (!warId) throw Error("NO_GAME_ISSUED_WAR_ID_FOR_PEACE");
      await chooseNativeSelect("#national-peace-war-id", warId);
      const before = await currentConflicts();
      if (!before?.actorId || !Number.isSafeInteger(before.tick)) {
        throw Error("NO_AUTHENTICATED_PRINCIPAL_FOR_PEACE");
      }
      await clickSelector("#national-propose-peace");
      const request = await evaluate(
        "window.__nationalQaDiplomacyRequests?.find(x=>x.type==='national_propose_peace') ?? null",
      );
      if (
        !request ||
        request.warId !== warId ||
        !/^nc_[a-f0-9]{32}$/.test(request.requestId)
      ) {
        throw Error("PEACE_CLICK_DID_NOT_EMIT_REAL_REQUEST");
      }
      const matched = await poll(
        async () => {
          const state = await currentConflicts();
          const result = reconcileDiplomacyEvidence(await worker(), {
            type: request.type,
            requestId: request.requestId,
            actorId: before.actorId,
            issuedTick: before.tick,
            warId,
            projection: state?.projection,
            projectionTick: state?.projectionTick,
          });
          const status = await evaluate(
            "window.__nationalQaFind('[data-national-diplomacy-status]')?.innerText ?? ''",
          );
          if (result.reason === "ENGINE_REJECTED_ACTION") {
            return { rejected: true, reason: "ENGINE_REJECTED_PEACE_PROPOSAL" };
          }
          return result.accepted &&
            /Peace proposal confirmed by game/i.test(status)
            ? result
            : null;
        },
        "real peace proposal receipt + exact game motion",
        90,
        350,
      );
      if (matched.rejected) throw Error(matched.reason);
      peaceMotionId = matched.motionId;
      record("authoritative-peace-proposal", {
        warId,
        motionId: peaceMotionId,
        sequence: matched.sequence,
      });
      await capture("peace-motion-proposed");
    });
    await step("accept-peace", async () => {
      if (!peaceMotionId || !warId || !warTargetId)
        throw Error("PEACE_CANONICAL_REFERENCES_MISSING");
      const proposer = await primaryPoliticalObservation();
      if (!proposer?.actorId || proposer.spectator)
        throw Error("PEACE_REAL_PROPOSER_MISSING");
      // Reuse the exact authenticated opponent already verified when WAR was
      // declared. Never attach another actor after the target is fixed.
      if (!peacePeer) throw Error("PEACE_REAL_WAR_OPPONENT_MISSING");
      const before = await peacePeer.observe();
      const valid = verifyDistinctLiveSessions(proposer, before, warTargetId);
      if (!valid.accepted) throw Error(valid.reason + "_OWNER_" + valid.owner);
      const proposal = before.conflicts?.motions?.find(
        (m) => m.id === peaceMotionId,
      );
      const layer = before.conflicts?.layers?.find((w) => w.id === warId);
      const permitted = distinctPeacePrincipal({
        proposerId: proposer.actorId,
        acceptorId: before.actorId,
        motionId: peaceMotionId,
        warId,
        offeredMotion: proposal,
        warLayer: layer,
      });
      if (!permitted.accepted)
        throw Error(
          "PEACE_OPPOSING_PRINCIPAL_CANNOT_ACCEPT_" +
            permitted.reason +
            "_OWNER_E2_E4",
        );
      await peacePeer.ensurePanel();
      await peacePeer.watchIntent("accept-peace");
      await peacePeer.select("#national-peace-motion-id", peaceMotionId);
      await peacePeer.click("#national-accept-peace");
      const clicked = await peacePeer.observedClick();
      if (
        clicked?.motionId !== peaceMotionId ||
        !/^nc_[a-f0-9]{32}$/.test(clicked?.requestId ?? "")
      )
        throw Error("PEACE_SECOND_PRINCIPAL_REAL_CLICK_MISSING_OWNER_E4");
      record("peace-real-opponent-click", {
        differentPrincipal: true,
        realCdpInput: true,
        requestFingerprint: createHash("sha256")
          .update(clicked.requestId)
          .digest("hex")
          .slice(0, 16),
      });
      // Never publish screenshots of a recipient-only private UI.
      const accepted = await poll(
        async () => {
          const state = await peacePeer.observe();
          if (state?.gameId !== before.gameId || state.actorId !== warTargetId)
            throw Error("PEACE_OPPONENT_SESSION_CHANGED_OWNER_E2_E4");
          const matched = reconcileDiplomacyEvidence(
            [{ commandResults: state.diplomacyResults ?? [] }],
            {
              type: "national_accept_peace",
              requestId: clicked.requestId,
              actorId: before.actorId,
              issuedTick: before.tick,
              warId,
              motionId: peaceMotionId,
              projection: state.conflicts,
              projectionTick: state.conflictsTick,
            },
          );
          if (matched.reason === "ENGINE_REJECTED_ACTION")
            throw Error("PEACE_AUTHENTIC_ENGINE_REJECTED_OWNER_E2");
          if (!matched.accepted) return null;
          const original = await currentConflicts();
          const originalWar = original?.projection?.layers?.find(
            (x) => x.id === warId,
          );
          const originalMotion = original?.projection?.motions?.find(
            (m) => m.id === peaceMotionId,
          );
          if (
            originalWar?.endedTick !== originalMotion?.acceptedTick ||
            originalWar?.endedTick === null ||
            originalMotion?.acceptedBy !== before.actorId ||
            !Number.isSafeInteger(original?.projectionTick) ||
            original.projectionTick < matched.receiptTick
          )
            return null;
          if (!/Peace accepted by game/i.test(state.peaceStatus ?? ""))
            return null;
          return matched;
        },
        "separate opponent real CDP acceptance + receipt + both ended WAR views",
        55,
        225,
      );
      record("authoritative-peace-accepted", {
        differentPrincipal: true,
        warEndedInBothViews: true,
        receiptTick: accepted.receiptTick,
        sequence: accepted.sequence,
      });
      await capture("peace-accepted-ended-war");
      // Never publish screenshots of a recipient-only private UI.
    });
    // This browser scenario is not a public-release verdict. Trusted saved
    // game restoration, replay/victory and hostile-client private state must
    // still be independently demonstrated on a protected authority.
  } finally {
    await worker().catch(() => {});
    persist();
    politicalPeer?.close();
    if (peacePeer && peacePeer !== politicalPeer) peacePeer.close();
    ws.close();
  }
}

try {
  await main();
} catch (error) {
  console.error("QA_R5_BROWSER_FAILURE " + safeFailureCode(error));
  errors.push({ stage, error: String(error) });
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  persist();
  for (const child of childProcesses) child.kill("SIGTERM");
  await sleep(500);
  try {
    rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch (error) {
    console.warn("QA_R5_TEMP_PROFILE_LEFT", String(error));
  }
}
