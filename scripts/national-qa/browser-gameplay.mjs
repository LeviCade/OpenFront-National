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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mobile = process.argv.includes("--mobile");
const legacy = process.argv.includes("--legacy");
const base = "http://127.0.0.1:9000/";
const reportDir =
  "national-qa-artifacts/browser-" + (mobile ? "mobile" : "desktop");
mkdirSync(reportDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "national-r5-"));
const port = 13000 + (process.pid % 10000);
const childProcesses = [];
const records = [];
const errors = [];
const observed = [];
const browserConsole = [];
const browserNetworkErrors = [];
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
  console.info("QA_R5 " + JSON.stringify(records.at(-1)));
}

function persist() {
  const report = {
    exactSource: process.env.GITHUB_SHA ?? "local-working-tree",
    viewport: mobile ? "390x844 mobile" : "1280x800 desktop",
    stage,
    events: records,
    errors,
    workerPackets: observed.slice(-240),
    console: browserConsole.slice(-240),
    networkErrors: browserNetworkErrors.slice(-120),
    actualHardware: hardwareCapabilities,
    submittedFounding,
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
    const result = await callback().catch(() => null);
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
      if (candidate.nationalPolitics) info.publicPolitics = candidate.nationalPolitics;
      if (candidate.nationalCommandResults) info.commandResults = candidate.nationalCommandResults;
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

  spawnChild(process.env.CHROME_BIN ?? "google-chrome", [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
    "--user-data-dir=" + profile,
    "--remote-debugging-port=" + port,
    "about:blank",
  ]);
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
          found.push({ text, x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), checked: !!el.checked });
        }
      };
      walk(root);
      return found.sort((a,b) => a.text.length-b.text.length)[0] ?? null;
    })()`);
  const hit = async (x, y) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
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
  };
  const click = async (label, scope = "", attempts = 90) => {
    const target = await poll(() => locate(label, scope), label, attempts);
    await hit(target.x, target.y);
    record("clicked", { label, text: target.text });
    return target;
  };
  const clickSelector = async (selector) => {
    const target = await poll(
      () =>
        evaluate(`(() => {
      const node = window.__nationalQaFind(${JSON.stringify(selector)});
      if (!node || node.disabled) return null;
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
  const fill = async (selector, value) => {
    const target = await poll(
      () =>
        evaluate(`(() => {
      const element = window.__nationalQaFind(${JSON.stringify(selector)});
      if (!element || element.disabled) return null;
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
  const capture = async (name) => {
    await worker();
    await screenshot(name);
    record("screenshot", { name, packetCount: observed.length });
    persist();
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
        webgl: await evaluate(`(() => {
          const canvas = document.createElement("canvas");
          const gl = canvas.getContext("webgl2");
          if (!gl) return { supported: false, userAgent: navigator.userAgent };
          const debug = gl.getExtension("WEBGL_debug_renderer_info");
          return {
            supported: true,
            vendor: gl.getParameter(gl.VENDOR),
            renderer: gl.getParameter(gl.RENDERER),
            unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
            unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
            contextLost: gl.isContextLost(),
            userAgent: navigator.userAgent,
          };
        })()`),
        systemGpu: await send("SystemInfo.getInfo")
          .then((info) => info.gpu ?? { unavailable: true })
          .catch((error) => ({ unavailable: true, reason: String(error) })),
      };
      record("actual-gpu-webgl2-capabilities", {
        graphics: hardwareCapabilities,
      });
      await capture("home");
    });
    await step("solo", async () => {
      await click("^solo$", "", 80);
      await poll(
        () =>
          evaluate(
            "!!document.querySelector('single-player-modal input[aria-label=\"Enable NATIONAL sovereignty in Solo\"]')",
          ),
        "Solo modal controls",
      );
      await capture("solo-modal");
    });
    if (legacy) {
      await step("legacy-ffa", async () => {
        const national = await locate(
          "Enable NATIONAL sovereignty in Solo",
          "single-player-modal",
          false,
        );
        if (!national || national.checked) {
          throw Error(
            "Legacy FFA did not start from an unselected NATIONAL checkbox",
          );
        }
        await click("start|play", "single-player-modal", 65);
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
      return;
    }
    await step("national-mode", async () => {
      const checkbox = await locate(
        "Enable NATIONAL sovereignty in Solo",
        "single-player-modal",
      );
      if (!checkbox) throw Error("NATIONAL opt-in control missing");
      if (!checkbox.checked) await hit(checkbox.x, checkbox.y);
      await poll(
        () =>
          evaluate(
            "document.querySelector('single-player-modal input[aria-label=\"Enable NATIONAL sovereignty in Solo\"]')?.checked === true",
          ),
        "NATIONAL selected",
      );
      await capture("national-enabled");
    });
    await step("start", async () => {
      await click("start|play", "single-player-modal", 65);
      const launch = await poll(
        () =>
          evaluate(`(() => {
          const gate = window.__nationalQaFind('webgl-gate');
          if (gate) return { blocked: true, status: gate.status };
          const panel = window.__nationalQaFind('national-diplomacy-panel');
          return panel && !/game is starting/i.test(document.body.innerText)
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
    });
    await step("spawn", async () => {
      await click("NATIONAL.*Diplomacy", "national-diplomacy-panel", 75);
      await capture("diplomacy-before-spawn");
      const msg = await evaluate(
        "window.__nationalQaFind('national-diplomacy-panel')?.innerText ?? ''",
      );
      if (!/spawn before founding/i.test(msg))
        record("spawn-precondition-not-observed", { text: msg.slice(0, 150) });
      // Human map interaction: try coordinates and stop immediately once the
      // real game HUD enables Found Empire. Never mutate Game state from JS.
      for (const [u, v] of [
        [0.55, 0.55],
        [0.4, 0.4],
        [0.6, 0.42],
        [0.3, 0.55],
        [0.7, 0.6],
        [0.2, 0.4],
      ]) {
        const enabled = await locate(
          "^Found Empire$",
          "national-diplomacy-panel",
        );
        if (enabled) break;
        const canvas = await evaluate(`(() => {
          const canvases=[...document.querySelectorAll('canvas')].filter((e)=>e.getBoundingClientRect().width>150);
          const rect=canvases.sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0]?.getBoundingClientRect();
          return rect ? {x:rect.x+rect.width*${u},y:rect.y+rect.height*${v}}:null;
        })()`);
        if (!canvas) throw Error("Playable canvas not found");
        await hit(canvas.x, canvas.y);
        await sleep(750);
      }
      await poll(
        () => locate("^Found Empire$", "national-diplomacy-panel"),
        "authenticated player spawned and Found Empire enabled",
        55,
        350,
      );
      await capture("player-spawned");
    });
    await step("found-empire", async () => {
      const empireId = "R5_Browser_QA";
      const attached = await evaluate(`(async () => {
        const panel = window.__nationalQaFind("national-diplomacy-panel");
        if (!panel?.eventBus || !panel.game?.myPlayer()) return false;
        const { SendNationalFoundEmpireIntentEvent } = await import("/src/client/Transport.ts");
        window.__nationalQaRequests = [];
        panel.eventBus.on(SendNationalFoundEmpireIntentEvent, (event) => {
          window.__nationalQaRequests.push({
            empireId: event.empireId,
            requestId: event.requestId,
          });
        });
        return true;
      })()`);
      if (!attached) {
        throw Error("Cannot observe authentic per-click EventBus request ID");
      }
      await fill("#national-empire-id", empireId);
      await click("^Found Empire$", "national-diplomacy-panel", 40);
      submittedFounding = await evaluate(
        "window.__nationalQaRequests?.[0] ?? null",
      );
      if (
        submittedFounding?.empireId !== empireId ||
        typeof submittedFounding.requestId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(submittedFounding.requestId)
      ) {
        throw Error("REAL_FOUNDING_REQUEST_ID_MISSING_OR_INVALID");
      }
      record("authentic-click-request-id", {
        requestId: submittedFounding.requestId,
      });
      await capture("founding-request");
      const actorId = await evaluate(
        "window.__nationalQaFind('national-diplomacy-panel')?.game?.myPlayer()?.id() ?? null",
      );
      if (typeof actorId !== "string" || actorId.length === 0) {
        throw Error("No authenticated spawned player at founding acceptance");
      }
      const result = await poll(
        async () => {
          const text = await evaluate(
            "window.__nationalQaFind('national-diplomacy-panel')?.innerText ?? ''",
          );
          const pkts = await worker();
          const publicRoster = pkts.some((p) =>
            p.publicPolitics?.empires?.some(
              (e) =>
                e.id === empireId &&
                e.leaderId === actorId &&
                e.memberIds?.includes(actorId),
            ),
          );
          const acceptedReceipt = pkts.some((p) =>
            p.commandResults?.some(
              (e) =>
                e.empireId === empireId &&
                e.requestId === submittedFounding.requestId &&
                e.recipientId === actorId &&
                e.actorId === actorId &&
                e.accepted === true &&
                Number.isSafeInteger(e.sequence),
            ),
          );
          return publicRoster &&
            acceptedReceipt &&
            text.includes("Confirmed by game")
            ? {
                text: text.slice(0, 300),
                actorId,
                requestId: submittedFounding.requestId,
              }
            : null;
        },
        "exact click request ID, actor/recipient scoped E1 acceptance, public roster, and UI confirmation",
        65,
        350,
      );
      record("authoritative-empire-accepted", result);
      await capture("confirmed-empire");
    });
    await step("rejected-founding", async () => {
      // Duplicate founding is intentionally injected through the application's
      // real EventBus and Transport, NOT by faking any game/worker state.
      // The UI correctly hides its form after founding; the authenticated
      // engine must still reject a malicious duplicate command.
      const duplicateRequestId = "qa_r6_duplicate_" + Date.now().toString(36);
      const request = await evaluate(`(async () => {
        const panel = window.__nationalQaFind('national-diplomacy-panel');
        if (!panel?.eventBus) return 'missing live EventBus';
        const transport = await import('/src/client/Transport.ts');
        panel.eventBus.emit(
          new transport.SendNationalFoundEmpireIntentEvent(
            'R5_Browser_QA', ${JSON.stringify(duplicateRequestId)}
          )
        );
        return 'existing authenticated transport emitted duplicate';
      })()`);
      record("duplicate-command-request-id", { requestId: duplicateRequestId });
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
                r.empireId === "R5_Browser_QA" &&
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
    await step("save-restore", async () => {
      const rosterPackets = await worker();
      const lastRoster = [...rosterPackets]
        .reverse()
        .find((p) => p.publicPolitics?.empires)?.publicPolitics;
      if (!lastRoster?.empires?.some((e) => e.id === "R5_Browser_QA")) {
        throw Error(
          "Cannot save without authoritative public political roster",
        );
      }
      await clickSelector('img[alt="settings"]');
      // The live game may permit saving only for a signed-in user. A
      // deliberately denied raw NATIONAL worker snapshot MUST remain denied.
      if (!(await evaluate("!!window.__nationalQaFind('[data-save-game]')"))) {
        throw Error(
          "No authenticated trusted-host save path available for NATIONAL Solo",
        );
      }
      await clickSelector("[data-save-game]");
      await poll(
        async () => {
          const status = await evaluate(
            "window.__nationalQaFind('[data-save-status]')?.innerText ?? ''",
          );
          return (
            /saved|success/i.test(status) &&
            !/failed|error|unavailable/i.test(status)
          );
        },
        "verified saved game acknowledgement",
        65,
      );
      await capture("saved-confirmed");
      await send("Page.navigate", { url: base });
      await poll(() => locate("^solo$"), "returned home for save restore", 95);
      await click("^solo$");
      await clickSelector("[data-saved-games-toggle]");
      await poll(
        () =>
          evaluate(
            "!!window.__nationalQaFind('[data-save-id] [data-action=play]')",
          ),
        "trusted-host saved game row",
        70,
      );
      const savedId = await evaluate(
        "window.__nationalQaFind('[data-save-id]')?.getAttribute('data-save-id')",
      );
      await clickSelector("[data-save-id] [data-action=play]");
      const restored = await poll(
        async () => {
          const packets = await worker();
          const publicView = [...packets]
            .reverse()
            .find((p) => p.publicPolitics?.empires)?.publicPolitics;
          return publicView?.empires?.some((e) => e.id === "R5_Browser_QA")
            ? publicView
            : null;
        },
        "restored authoritative political roster",
        100,
        300,
      );
      if (
        JSON.stringify(restored.empires) !== JSON.stringify(lastRoster.empires)
      ) {
        throw Error(
          "NATIONAL restored authoritative roster differs from saved roster",
        );
      }
      record("trusted-host-save-restore-passed", {
        savedId,
        empires: restored.empires.length,
      });
      await capture("restored-roster");
    });
    await step("sovereign-victory", async () => {
      const pkts = await worker();
      if (
        !pkts.some((p) => p.publicPolitics?.victor ?? p.publicPolitics?.victors)
      ) {
        throw Error(
          "No authoritative sovereign-victory packet observed in actual Chromium game",
        );
      }
      await capture("sovereign-victory");
    });
  } finally {
    await worker().catch(() => {});
    persist();
    ws.close();
  }
}

try {
  await main();
} catch (error) {
  console.error("QA_R5_BROWSER_FAILURE " + String(error));
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
