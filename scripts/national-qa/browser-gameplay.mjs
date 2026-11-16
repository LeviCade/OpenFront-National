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
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mobile = process.argv.includes("--mobile");
const base = "http://127.0.0.1:9000/";
const reportDir = "national-qa-artifacts/browser-" + (mobile ? "mobile" : "desktop");
mkdirSync(reportDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "national-r5-"));
const port = 13000 + (process.pid % 10000);
const childProcesses = [];
const records = [];
const errors = [];
const observed = [];
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
  const scrub = (data) => {
    if (!data || typeof data !== 'object') return;
    const type = typeof data.type === 'string' ? data.type : undefined;
    const info = {
      type, tick: Number.isFinite(data.tick) ? data.tick : undefined,
      keys: Object.keys(data).filter((k) =>
        ['type','tick','gameUpdates','nationalPolitics','nationalCommandResults','updates','error','snapshot'].includes(k)
      ),
    };
    const updateCandidates = [data, ...(Array.isArray(data.gameUpdates) ? data.gameUpdates : [])];
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
  Object.defineProperty(window, '__nationalQaWorkerEvidence', {
    value: packets, configurable: false, writable: false,
  });
})();`;

async function main() {
  stage = "boot";
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
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-allow-origins=*", "--user-data-dir=" + profile,
    "--remote-debugging-port=" + port, "about:blank",
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
      expression, returnByValue: true, awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error("Browser Runtime exception " + JSON.stringify(res.exceptionDetails));
    }
    return res.result?.value;
  };
  const screenshot = async (label) => {
    const data = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(reportDir, label + ".png"), Buffer.from(data.data, "base64"));
  };
  const worker = async () => {
    const evidence = await evaluate("window.__nationalQaWorkerEvidence || []");
    if (Array.isArray(evidence)) {
      for (const packet of evidence.slice(observed.length)) observed.push(packet);
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
      const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : "document"};
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
  const hit = async (x,y) => {
    await send("Input.dispatchMouseEvent", {type:"mouseMoved", x,y});
    await send("Input.dispatchMouseEvent", {type:"mousePressed",x,y,button:"left",clickCount:1});
    await send("Input.dispatchMouseEvent", {type:"mouseReleased",x,y,button:"left",clickCount:1});
  };
  const click = async (label, scope = "", attempts = 90) => {
    const target = await poll(() => locate(label, scope), label, attempts);
    await hit(target.x,target.y);
    record("clicked", { label, text: target.text });
    return target;
  };
  const fill = async (selector,value) => {
    const target = await poll(() => evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled) return null;
      const rect=element.getBoundingClientRect();
      return rect.width && rect.height ? { x:rect.x+rect.width/2, y:rect.y+rect.height/2 } : null;
    })()`), selector);
    await hit(target.x,target.y);
    await send("Input.dispatchKeyEvent", {type:"keyDown",key:"a",code:"KeyA",modifiers:2});
    await send("Input.dispatchKeyEvent", {type:"keyUp",key:"a",code:"KeyA",modifiers:2});
    await send("Input.insertText", {text:value});
    record("typed", {selector, chars:value.length});
  };
  const capture = async (name) => {
    await worker();
    await screenshot(name);
    record("screenshot", {name, packetCount:observed.length});
    persist();
  };
  const step = async (name,fn) => {
    stage=name;
    try {await fn();record("stage-complete",{stage:name});}
    catch(err){errors.push({stage:name,error:String(err),observed:await description().catch(()=>null)});await capture("failure-"+name).catch(()=>{});throw err;}
  };

  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: mobile ? 390 : 1280, height: mobile ? 844 : 800,
      deviceScaleFactor: 1, mobile,
    });
    await send("Page.addScriptToEvaluateOnNewDocument", {source:probe});
    await send("Page.navigate", {url:base});
    await step("home", async () => {
      await poll(() => evaluate("document.readyState === 'complete' && document.body.innerText.length > 0"), "homepage body", 80);
      await capture("home");
    });
    await step("solo", async () => {
      await click("^solo$", "", 80);
      await poll(() => evaluate("!!document.querySelector('single-player-modal input[aria-label=\"Enable NATIONAL sovereignty in Solo\"]')"), "Solo modal controls");
      await capture("solo-modal");
    });
    await step("national-mode", async () => {
      const checkbox = await locate("Enable NATIONAL sovereignty in Solo", "single-player-modal");
      if (!checkbox) throw Error("NATIONAL opt-in control missing");
      if (!checkbox.checked) await hit(checkbox.x,checkbox.y);
      await poll(() => evaluate("document.querySelector('single-player-modal input[aria-label=\"Enable NATIONAL sovereignty in Solo\"]')?.checked === true"), "NATIONAL selected");
      await capture("national-enabled");
    });
    await step("start", async () => {
      await click("start|play", "single-player-modal", 65);
      await poll(() => evaluate("!!document.querySelector('game-right-sidebar, national-diplomacy-panel')"), "real game HUD", 100, 350);
      await capture("game-hud");
    });
    await step("spawn", async () => {
      await click("NATIONAL.*Diplomacy", "national-diplomacy-panel", 75);
      await capture("diplomacy-before-spawn");
      const msg = await evaluate("document.querySelector('national-diplomacy-panel')?.innerText || ''");
      if (!/spawn before founding/i.test(msg)) record("spawn-precondition-not-observed",{text:msg.slice(0,150)});
      // Human map interaction: try coordinates and stop immediately once the
      // real game HUD enables Found Empire. Never mutate Game state from JS.
      for (const [u,v] of [[0.55,0.55],[0.4,0.4],[0.6,0.42],[0.3,0.55],[0.7,0.6],[0.2,0.4]]) {
        const enabled = await locate("^Found Empire$", "national-diplomacy-panel");
        if (enabled) break;
        const canvas = await evaluate(`(() => {
          const canvases=[...document.querySelectorAll('canvas')].filter((e)=>e.getBoundingClientRect().width>150);
          const rect=canvases.sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0]?.getBoundingClientRect();
          return rect ? {x:rect.x+rect.width*${u},y:rect.y+rect.height*${v}}:null;
        })()`);
        if (!canvas) throw Error("Playable canvas not found");
        await hit(canvas.x,canvas.y);
        await sleep(750);
      }
      await poll(() => locate("^Found Empire$", "national-diplomacy-panel"), "authenticated player spawned and Found Empire enabled", 55, 350);
      await capture("player-spawned");
    });
    await step("found-empire",async()=>{
      const empireId="R5_Browser_QA";
      await fill("#national-empire-id",empireId);
      await click("^Found Empire$", "national-diplomacy-panel",40);
      await capture("founding-request");
      const result = await poll(async()=>{
        const text=await evaluate("document.querySelector('national-diplomacy-panel')?.innerText || ''");
        const pkts=await worker();
        const truth = pkts.some((p)=>
          p.publicPolitics?.empires?.some((e)=>e.id===empireId) &&
          p.commandResults?.some((e)=>e.empireId===empireId && e.accepted===true)
        );
        return truth && text.includes("Confirmed by game") ? {text:text.slice(0,300)}:null;
      },"E1-authoritative accepted result AND worker public roster AND UI confirmation",65,350);
      record("authoritative-empire-accepted",result);
      await capture("confirmed-empire");
    });
    await step("rejected-founding",async()=>{
      const pkts=await worker();
      const rejection=pkts.some((p)=>p.commandResults?.some((r)=>r.type==="national_found_empire"&&r.accepted===false));
      if(!rejection) throw Error("No authenticated rejected founding result observed. UI-only input rejection is insufficient.");
      await capture("founding-rejected");
    });
    await step("save-restore",async()=>{
      // NATIONAL snapshot currently blocked for client-side workers. This
      // MUST fail until a trusted-host supported save/restore is provided.
      const saver=await locate("save game|save", "game-right-sidebar");
      if(!saver) throw Error("NATIONAL browser save/restore is not available through a trusted host.");
      await hit(saver.x,saver.y);
      await poll(async()=>{
        const status=await evaluate("document.querySelector('[data-save-status]')?.innerText || ''");
        return /saved/i.test(status)&&!/failed|error|unavailable/i.test(status);
      },"authoritative saved game confirmation",45);
      throw Error("Save button acknowledged, but verified restore and identical game roster have not been demonstrated.");
    });
    await step("sovereign-victory",async()=>{
      const pkts=await worker();
      if(!pkts.some((p)=>p.publicPolitics?.victor ?? p.publicPolitics?.victors)) {
        throw Error("No authoritative sovereign-victory packet observed in actual Chromium game");
      }
      await capture("sovereign-victory");
    });
  } finally {
    await worker().catch(()=>{});
    persist();
    ws.close();
  }
}

try {
  await main();
} catch (error) {
  console.error("QA_R5_BROWSER_FAILURE " + String(error));
  errors.push({stage,error:String(error)});
  process.exitCode=1;
} finally {
  clearTimeout(watchdog);
  persist();
  for(const child of childProcesses) child.kill("SIGTERM");
  await sleep(500);
  try {
    rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }catch(error){console.warn("QA_R5_TEMP_PROFILE_LEFT",String(error));}
}
