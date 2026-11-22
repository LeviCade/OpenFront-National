// Browser-only auth witness: actual AccountModal UI, mailbox navigation,
// ordinary login/refresh machinery and three independent Chromium profiles.
// No cookie injection, JWT generation, app-state patching or GPU/human claim.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
  accountCommand,
  issuer,
  launch,
  makeEnvironment,
  origin,
  startIdentity,
  until,
} from "./operator-harness.mjs";

const fixture = makeEnvironment();
const children = [];
const sockets = [];
const passed = (name) => console.log("BROWSER_AUTH_STAGE_PASS " + name);
let stage = "startup";

function allowedLocal(value) {
  try {
    const u = new URL(value);
    return (
      ["data:", "blob:", "about:"].includes(u.protocol) ||
      (["http:", "ws:"].includes(u.protocol) &&
        u.hostname === "localhost" &&
        ["8787", "9000", "3000", "3001"].includes(u.port))
    );
  } catch {
    return false;
  }
}

async function openProfile(executable, index, email) {
  const directory = join(fixture.dir, "browser-" + index);
  mkdirSync(directory, { mode: 0o700 });
  const child = launch(
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      "--user-data-dir=" + directory,
      "about:blank",
    ],
    fixture.env,
    executable,
  );
  children.push(child);
  const portfile = join(directory, "DevToolsActivePort");
  await until(
    () => child.alive() && existsSync(portfile),
    "isolated Chrome",
    30_000,
  );
  const port = Number(readFileSync(portfile, "utf8").split("\n")[0]);
  assert(Number.isInteger(port) && port > 0 && port < 65536);
  const targets = await (
    await fetch("http://127.0.0.1:" + port + "/json/list", {
      signal: AbortSignal.timeout(5000),
    })
  ).json();
  const endpoint = new URL(
    targets.find((t) => t.type === "page").webSocketDebuggerUrl,
  );
  assert(
    endpoint.protocol === "ws:" &&
      endpoint.hostname === "127.0.0.1" &&
      Number(endpoint.port) === port,
  );
  const ws = new WebSocket(endpoint);
  sockets.push(ws);
  ws.on("error", () => {});
  await until(() => ws.readyState === WebSocket.OPEN, "browser DevTools");
  const pending = new Map();
  const profileRequests = new Set();
  const observed = {
    mail: 0,
    exchange: 0,
    refresh: 0,
    profile: 0,
    account: null,
  };
  let seq = 0;
  let protocolFailure = false;
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("browser command timed out"));
      }, 12_000);
      pending.set(id, { resolve, reject, timeout });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  ws.on("close", () => {
    for (const item of pending.values()) {
      clearTimeout(item.timeout);
      item.reject(new Error("browser closed"));
    }
    pending.clear();
  });
  ws.on("message", (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.id !== undefined) {
        const item = pending.get(m.id);
        if (!item) return;
        clearTimeout(item.timeout);
        pending.delete(m.id);
        if (m.error) item.reject(new Error("browser CDP command rejected"));
        else item.resolve(m.result);
        return;
      }
      if (m.method === "Fetch.requestPaused") {
        const { requestId, request } = m.params;
        const task = allowedLocal(request.url)
          ? send("Fetch.continueRequest", { requestId })
          : send("Fetch.failRequest", {
              requestId,
              errorReason: "BlockedByClient",
            });
        void task.catch(() => {
          protocolFailure = true;
        });
        return;
      }
      if (m.method === "Network.responseReceived") {
        const u = new URL(m.params.response.url);
        if (u.origin !== issuer || m.params.response.status !== 200) return;
        if (u.pathname === "/auth/magic-link") observed.mail++;
        if (u.pathname === "/auth/login/token") observed.exchange++;
        if (u.pathname === "/auth/refresh") observed.refresh++;
        if (u.pathname === "/users/@me")
          profileRequests.add(m.params.requestId);
      }
      if (
        m.method === "Network.loadingFinished" &&
        profileRequests.delete(m.params.requestId)
      ) {
        void send("Network.getResponseBody", { requestId: m.params.requestId })
          .then((result) => {
            const body = JSON.parse(
              result.base64Encoded
                ? Buffer.from(result.body, "base64").toString("utf8")
                : result.body,
            );
            assert(
              body.user.email === email &&
                typeof body.player.publicId === "string",
            );
            if (observed.account !== null)
              assert(observed.account === body.player.publicId);
            observed.account = body.player.publicId;
            observed.profile++;
          })
          .catch(() => {
            protocolFailure = true;
          });
      }
    } catch {
      protocolFailure = true;
    }
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error("browser UI evaluation failed");
    return result.result.value;
  };
  const click = async (selector) => {
    const point = await evaluate(`(() => {
      const roots = [document];
      for (const root of roots) {
        for (const el of root.querySelectorAll("*"))
          if (el.shadowRoot) roots.push(el.shadowRoot);
        const el = [...root.querySelectorAll(${JSON.stringify(selector)})].find(
          (candidate) => candidate.getBoundingClientRect().width > 0 &&
            candidate.getBoundingClientRect().height > 0 &&
            getComputedStyle(candidate).visibility !== "hidden");
        if (el) {
          el.scrollIntoView({block:"center"});
          const rect = el.getBoundingClientRect();
          return {x:rect.x + rect.width/2,y:rect.y + rect.height/2};
        }
      }
      return null;
    })()`);
    if (!point) return false;
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      clickCount: 1,
    });
    return true;
  };
  await send("Page.enable");
  await send("Network.enable");
  await send("Fetch.enable", {
    patterns: [{ urlPattern: "*", requestStage: "Request" }],
  });
  await send("Page.navigate", { url: origin + "/#modal=account" });
  const emailInput = 'input[type="email"]';
  stage = "ordinary account UI email input profile " + index;
  await until(() => click(emailInput), "real email input", 120_000);
  await send("Input.insertText", { text: email });
  const submit = 'o-button[translationkey="account_modal.get_magic_link"]';
  stage = "ordinary magic-link request profile " + index;
  await until(() => click(submit), "real magic-link button", 30_000);
  const mailbox = join(
    fixture.dir,
    "mail",
    createHash("sha256").update(email).digest("hex") + ".txt",
  );
  await until(
    () => observed.mail > 0 && existsSync(mailbox),
    "private mailbox",
    30_000,
  );
  const url = new URL(readFileSync(mailbox, "utf8").trim());
  assert(url.origin === origin && url.hash.startsWith("#token-login?"));
  stage = "browser link exchange and first-party account profile " + index;
  // This is a real navigation through the application's token-login UI,
  // exactly as an operator following their private emailed link would do.
  await send("Page.navigate", { url: url.href });
  await until(
    () =>
      !protocolFailure &&
      observed.exchange > 0 &&
      observed.refresh > 0 &&
      observed.profile > 0,
    "browser signed in",
    90_000,
  );
  async function refreshCredential() {
    const { cookies } = await send("Network.getCookies", {
      urls: [issuer + "/auth/refresh"],
    });
    const cookie = cookies.find((c) => c.name === "national_staging_refresh");
    assert(
      cookie &&
        cookie.httpOnly &&
        cookie.secure &&
        cookie.sameSite === "Strict",
    );
    return cookie.value;
  }
  const first = await refreshCredential();
  const refreshes = observed.refresh;
  const profiles = observed.profile;
  stage = "browser reload and refresh rotation profile " + index;
  await send("Page.reload", { ignoreCache: true });
  await until(
    () =>
      !protocolFailure &&
      observed.refresh > refreshes &&
      observed.profile > profiles,
    "real browser reload",
    90_000,
  );
  assert((await refreshCredential()) !== first, "refresh cookie unchanged");
  passed("independent-profile-" + index + "-normal-login-and-rotating-reload");
  return observed.account;
}

try {
  const executable = execFileSync("which", ["google-chrome"], {
    encoding: "utf8",
  }).trim();
  const emails = ["alpha", "bravo", "charlie"].map(
    (name) => name + "@staging.invalid",
  );
  for (const email of emails) accountCommand(fixture.env, "register", email);
  children.push(await startIdentity(fixture.env));
  const host = launch(["--import", "tsx", "src/server/Server.ts"], fixture.env);
  children.push(host);
  await until(
    () =>
      host.alive() &&
      host.messages.some(
        (message) => message.message === "running on http://localhost:3001",
      ),
    "Master/Worker",
    45_000,
  );
  const vite = launch(
    ["node_modules/vite/bin/vite.js", "--host", "localhost", "--strictPort"],
    fixture.env,
  );
  children.push(vite);
  stage = "exact source Vite";
  await until(
    async () => {
      if (!vite.alive()) throw new Error("Vite exited");
      try {
        const response = await fetch(origin, {
          signal: AbortSignal.timeout(2000),
        });
        return (
          response.ok &&
          (await response.text()).includes(fixture.env.GIT_COMMIT)
        );
      } catch {
        return false;
      }
    },
    "real Vite bootstrap",
    60_000,
  );
  passed("real-master-worker-vite-exact-source");
  const accounts = [];
  for (let i = 0; i < emails.length; i++)
    accounts.push(await openProfile(executable, i + 1, emails[i]));
  assert(
    accounts.every((id) => typeof id === "string") &&
      new Set(accounts).size === 3,
  );
  console.log(
    "LOCAL_STAGING_BROWSER_AUTH_PASS browser_profiles=3 independent_accounts=3 human_witnesses=0 upstream_oauth=0 gpu=0",
  );
} catch {
  // Never expose DevTools errors, URLs, credential bodies or profile IDs.
  console.error("LOCAL_STAGING_BROWSER_AUTH_FAIL stage=" + stage);
  process.exitCode = 1;
} finally {
  for (const ws of sockets) ws.terminate();
  for (const child of children.reverse()) await child.stop();
  fixture.cleanup();
}
