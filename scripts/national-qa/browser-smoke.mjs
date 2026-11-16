#!/usr/bin/env node
/**
 * Dependency-free, actual Chromium/CDP smoke.
 * Run: CHROME_BIN=/usr/bin/google-chrome node scripts/national-qa/browser-smoke.mjs
 * Run after E4 merges: node scripts/national-qa/browser-smoke.mjs --national
 * --national is deliberately a HARD release gate, not a visual-only pass.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const full = process.argv.includes("--national");
const reportDir = "national-qa-artifacts";
mkdirSync(reportDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "national-chrome-"));
const port = 10000 + (process.pid % 10000);
const children = [];
const started = performance.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(fn, label, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      // The browser/server has not reached readiness.
    }
    await sleep(250);
  }
  throw new Error("Timed out awaiting " + label);
}

function processChild(binary, args, extraEnv = {}) {
  const child = spawn(binary, args, {
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", (error) => console.error(error));
  return child;
}

function createCdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id === undefined) return;
    const next = pending.get(message.id);
    if (!next) return;
    pending.delete(message.id);
    if (message.error) next.reject(new Error(JSON.stringify(message.error)));
    else next.resolve(message.result);
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      ws.send(JSON.stringify({ id: requestId, method, params }));
      setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        reject(new Error("CDP timeout: " + method));
      }, 15_000);
    });
}

async function main() {
  const server = processChild("npm", ["run", "start:client"], {
    SKIP_BROWSER_OPEN: "true",
    GAME_ENV: "dev",
  });
  const response = await poll(async () => {
    if (server.exitCode !== null) throw new Error("Vite exited");
    const r = await fetch("http://127.0.0.1:9000/", {
      signal: AbortSignal.timeout(1000),
    });
    return r.status === 200 ? r : null;
  }, "Vite homepage");
  const html = await response.text();
  if (!/<html/i.test(html)) throw new Error("Homepage is not HTML");

  processChild(process.env.CHROME_BIN ?? "google-chrome", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
    "--user-data-dir=" + profile,
    "--remote-debugging-port=" + port,
    "about:blank",
  ]);
  const pages = await poll(async () => {
    const r = await fetch("http://127.0.0.1:" + port + "/json/list", {
      signal: AbortSignal.timeout(1000),
    });
    return r.ok ? r.json() : null;
  }, "Chromium CDP");
  const target = pages.find((p) => p.type === "page");
  if (!target?.webSocketDebuggerUrl) throw new Error("No page target");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const command = createCdp(ws);
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        "Browser evaluation exception: " +
          JSON.stringify(result.exceptionDetails),
      );
    }
    return result.result?.value;
  };
  const screenshot = async (name) => {
    const capture = await command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    writeFileSync(join(reportDir, name), Buffer.from(capture.data, "base64"));
  };
  try {
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Page.navigate", { url: "http://127.0.0.1:9000/" });
    await poll(
      () =>
        evaluate(
          "document.readyState === 'complete' && !!document.body && document.body.innerText.length > 0",
        ),
      "homepage DOM",
    );
    await screenshot("browser-landing.png");
    const landing = await evaluate("document.body.innerText.slice(0, 3000)");
    if (!landing || landing.length < 10) {
      throw new Error("Visible landing DOM is empty");
    }
    console.info(
      "QA_BROWSER_LANDING " +
        JSON.stringify({
          title: await evaluate("document.title"),
          textLength: landing.length,
        }),
    );

    if (full) {
      // Probe actual DOM and open shadow roots, not source text. The browser
      // gate intentionally fails until E4 supplies clickable controls.
      const clickLabel = async (pattern, stage) => {
        const source = `(() => {
          const regex = new RegExp(${JSON.stringify(pattern)}, "i");
          const candidates = [];
          function walk(root) {
            for (const element of root.querySelectorAll("*")) {
              if (element.shadowRoot) walk(element.shadowRoot);
              if (!element.matches("button,a,[role=button],label,input,[role=radio]")) continue;
              const text = (element.innerText || element.getAttribute("aria-label") || element.value || "").trim();
              if (!regex.test(text) || text.length > 90) continue;
              const box = element.getBoundingClientRect();
              const css = getComputedStyle(element);
              if (!box.width || !box.height || css.visibility === "hidden" || css.display === "none") continue;
              candidates.push({ text, x: box.x + box.width / 2, y: box.y + box.height / 2 });
            }
          }
          walk(document);
          return candidates.sort((a,b) => a.text.length - b.text.length)[0] || null;
        })()`;
        const found = await poll(() => evaluate(source), stage, 40);
        await command("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: found.x,
          y: found.y,
        });
        await command("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: found.x,
          y: found.y,
          button: "left",
          clickCount: 1,
        });
        await command("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: found.x,
          y: found.y,
          button: "left",
          clickCount: 1,
        });
        await sleep(350);
        await screenshot("browser-" + stage + ".png");
        console.info("QA_BROWSER_CLICK " + JSON.stringify({ stage, found }));
      };
      await clickLabel("solo|single.?player", "solo");
      await clickLabel("national", "national");
      await clickLabel("^start|^play|begin", "start");
      await clickLabel("found empire", "found-empire");
      const visible = await evaluate("document.body.innerText");
      if (!/emperor|empire founded|founded empire/i.test(visible)) {
        throw new Error(
          "Found Empire action produced no observable successful result",
        );
      }
      await screenshot("browser-national-result.png");
    }
    console.info(
      "QA_BROWSER_PASS " +
        JSON.stringify({
          phase: full ? "national" : "landing",
          elapsedMs: Number((performance.now() - started).toFixed(2)),
        }),
    );
  } finally {
    ws.close();
  }
}

try {
  await main();
} catch (error) {
  console.error("QA_BROWSER_FAIL", String(error));
  process.exitCode = 1;
} finally {
  for (const child of children) child.kill("SIGTERM");
  rmSync(profile, { recursive: true, force: true });
}
