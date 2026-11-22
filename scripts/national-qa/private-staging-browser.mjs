// E5 operator extension of E2's pinned national-staging/browser-auth-check.mjs.
// Auth, profiles, native lobby creation/join and host tick correlation.
// This is partial automated participation, NEVER a victory or human witness.
import { decodeServerMessage } from "@openfront/shared/ZbinWire";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
} from "../national-staging/operator-harness.mjs";

const authOnly = process.argv.includes("--auth-only");
const lobbyOnly = process.argv.includes("--lobby-only");
const diagnosticOnly = authOnly || lobbyOnly;
const fixture = makeEnvironment();
const head = fixture.env.GIT_COMMIT;
const screenshotHashes = new Set();
let screenshotDir;
const withheld = new Set([
  "gameplay.mp3",
  "gameplay-2.mp3",
  "gameplay-3.mp3",
  "menu-theme.mp3",
]);
const children = [];
const sockets = [];
const passed = (name) => console.log("BROWSER_AUTH_STAGE_PASS " + name);
let stage = "startup";
let diagnostic = () => ({});

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
      ...(diagnosticOnly ? ["--headless=new"] : []),
      "--lang=en-US",
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
    {
      ...fixture.env,
      ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
      ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
      ...(process.env.XDG_RUNTIME_DIR
        ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR }
        : {}),
    },
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
  const localSockets = new Set();
  const observed = {
    mail: 0,
    exchange: 0,
    refresh: 0,
    profile: 0,
    account: null,
    missingMusicRequests: 0,
    lobby: null,
  };
  let seq = 0;
  let protocolFailure = false;
  let profileReadFailures = 0;
  let accountMismatch = false;
  const statuses = { mail: [], exchange: [], refresh: [], profile: [] };
  diagnostic = () => ({
    status: statuses,
    mail: observed.mail,
    exchange: observed.exchange,
    refresh: observed.refresh,
    profile: observed.profile,
    protocolFailure,
    profileReadFailures,
    accountMismatch,
    missingMusicRequests: observed.missingMusicRequests,
    observedLobbySeats: observed.lobby?.lobby?.clients?.length ?? 0,
  });
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
        const pathname = new URL(request.url).pathname;
        if (withheld.has(pathname.split("/").at(-1)))
          observed.missingMusicRequests++;
        const task = allowedLocal(request.url)
          ? send("Fetch.continueRequest", { requestId })
          : send("Fetch.failRequest", {
              requestId,
              errorReason: "BlockedByClient",
            });
        // Navigation may cancel a CDP interception before the response to
        // continue/fail arrives. That is not an authorization success.
        void task.catch(() => {});
        return;
      }
      if (m.method === "Network.webSocketCreated") {
        if (allowedLocal(m.params.url)) localSockets.add(m.params.requestId);
      }
      if (
        m.method === "Network.webSocketFrameReceived" &&
        localSockets.has(m.params.requestId) &&
        m.params.response.opcode === 2
      ) {
        // Passive observation of real server frames, never an injected client intent.
        try {
          const packet = decodeServerMessage(
            Buffer.from(m.params.response.payloadData, "base64"),
          );
          if (packet.type === "lobby_info") observed.lobby = packet;
        } catch {
          // Other local sockets or post-start frames may need a different codec.
          // No undecoded frame can become a roster witness.
        }
      }
      if (m.method === "Network.responseReceived") {
        const u = new URL(m.params.response.url);
        if (u.origin !== issuer) return;
        const status = m.params.response.status;
        const key = {
          "/auth/magic-link": "mail",
          "/auth/login/token": "exchange",
          "/auth/refresh": "refresh",
          "/users/@me": "profile",
        }[u.pathname];
        if (key && statuses[key].length < 20) statuses[key].push(status);
        if (status !== 200) return;
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
            if (
              body.user.email !== email ||
              typeof body.player.publicId !== "string" ||
              (observed.account !== null &&
                observed.account !== body.player.publicId)
            ) {
              accountMismatch = true;
              return;
            }
            observed.account = body.player.publicId;
            observed.profile++;
          })
          .catch(() => {
            // A navigation can discard a completed response body. Never
            // count such a response as a verified account profile.
            profileReadFailures++;
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
  const click = async (selector, exactText = null) => {
    const point = await evaluate(`(() => {
      const roots = [document];
      for (const root of roots) {
        for (const el of root.querySelectorAll("*"))
          if (el.shadowRoot) roots.push(el.shadowRoot);
        const el = [...root.querySelectorAll(${JSON.stringify(selector)})].find(
          (candidate) => candidate.getBoundingClientRect().width > 0 &&
            candidate.getBoundingClientRect().height > 0 &&
            getComputedStyle(candidate).visibility !== "hidden" &&
            !candidate.disabled && candidate.getAttribute("aria-disabled") !== "true" &&
            (${JSON.stringify(exactText)} === null || candidate.textContent.trim() === ${JSON.stringify(exactText)}));
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
  // Opening a real mail link creates a fresh document, not merely a
  // same-document hash change under the email-confirmation modal.
  await send("Page.navigate", { url: "about:blank" });
  await until(
    async () => (await evaluate("location.href")) === "about:blank",
    "fresh link document",
  );
  await send("Page.navigate", { url: url.href });
  await until(
    () =>
      !protocolFailure &&
      !accountMismatch &&
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
      !accountMismatch &&
      observed.refresh > refreshes &&
      observed.profile > profiles,
    "real browser reload",
    90_000,
  );
  assert((await refreshCredential()) !== first, "refresh cookie unchanged");
  passed("independent-profile-" + index + "-normal-login-and-rotating-reload");
  return { account: observed.account, send, evaluate, click, observed };
}

try {
  assert.match(head, /^[a-f0-9]{40}$/);
  if (!diagnosticOnly) {
    stage = "E6 physical operator authorization";
    assert.equal(process.env.NATIONAL_GPU_CANDIDATE_SHA, head);
    assert.equal(process.env.NATIONAL_E6_APPROVED_CANDIDATE_SHA, head);
    assert.match(process.env.NATIONAL_E6_APPROVED_RUN_ID ?? "", /^[0-9]+$/);
    assert(process.env.DISPLAY, "physical display required");
    mkdirSync("national-qa-artifacts", { recursive: true, mode: 0o700 });
    screenshotDir = mkdtempSync("national-qa-artifacts/private-staging-");
  }
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
  const profiles = [];
  for (let i = 0; i < emails.length; i++)
    profiles.push(await openProfile(executable, i + 1, emails[i]));
  const accounts = profiles.map((profile) => profile.account);
  assert(
    accounts.every((id) => typeof id === "string") &&
      new Set(accounts).size === 3,
  );
  assert(profiles.every((p) => p.observed.missingMusicRequests === 0));
  console.log(
    "LOCAL_STAGING_BROWSER_AUTH_PASS browser_profiles=3 independent_accounts=3 human_witnesses=0 upstream_oauth=0 gpu_attestation=0 missing_music_requests=0",
  );
  if (!authOnly) {
    const [a, b, c] = profiles;
    stage = "native create lobby";
    await until(
      () => a.click("game-mode-selector button", "Create Lobby"),
      stage,
      60_000,
    );
    stage = "native NATIONAL configuration";
    await until(
      () =>
        a.click(
          'input[aria-label="Private NATIONAL authoritative multiplayer"]',
        ),
      stage,
      45_000,
    );
    await until(
      () =>
        a.evaluate(
          "document.querySelector('input[aria-label=\"Private NATIONAL authoritative multiplayer\"]')?.checked === true",
        ),
      stage,
    );
    let url;
    await until(async () => {
      const current = new URL(await a.evaluate("location.href"));
      if (current.origin !== origin || !current.searchParams.has("lobby"))
        return false;
      url = current.href;
      return true;
    }, "actual host share URL");
    stage = "independent native invite navigation";
    await Promise.all([b, c].map((p) => p.send("Page.navigate", { url })));
    await until(
      () =>
        a.evaluate(
          '[...document.querySelectorAll("#page-host-lobby .player-tag")].filter(e=>e.getBoundingClientRect().width>0).length === 3',
        ),
      "three visible lobby participants",
      60_000,
    );
    stage = "same three authoritative server lobby seats";
    await until(
      () => {
        const packets = profiles.map((p) => p.observed.lobby);
        if (
          !packets.every(
            (p) =>
              p?.lobby?.gameConfig?.nationalMode === true &&
              p.lobby.clients?.length === 3,
          )
        )
          return false;
        const seats = packets.map((p) => p.myClientID);
        return (
          new Set(seats).size === 3 &&
          seats.every((seat) => typeof seat === "string") &&
          packets.every((p) => {
            const roster = p.lobby.clients.map((client) => client.clientID);
            return (
              new Set(roster).size === 3 &&
              seats.every((seat) => roster.includes(seat))
            );
          })
        );
      },
      stage,
      60_000,
    );
    assert(profiles.every((p) => p.observed.missingMusicRequests === 0));
    console.log(
      "LOCAL_STAGING_BROWSER_LOBBY_PASS browser_profiles=3 authoritative_roster=3 distinct_seats=3 national=true gameplay=0 gpu_attestation=0 human_witnesses=0 missing_music_requests=0",
    );
    if (!lobbyOnly) {
      stage = "native start control";
      await until(
        () => a.click('#page-host-lobby o-button[width="block"][size="lg"]'),
        stage,
        30_000,
      );
      stage = "independent authoritative host admission";
      let admission;
      await until(
        () => {
          admission = host.messages.find(
            (m) =>
              m.message === "NATIONAL authoritative host ready" &&
              m.authenticatedSeats === 3 &&
              m.distinctAccounts === 3 &&
              m.authoritativeRunners === 1 &&
              typeof m.gameID === "string",
          );
          return Boolean(admission);
        },
        stage,
        90_000,
      );
      const snapshots = () =>
        Promise.all(
          profiles.map((p) =>
            p.evaluate(`(() => {
      const node = document.querySelector("[data-national-trusted-session]");
      const tick = node?.getAttribute("data-national-projection-tick");
      return {
        match: node?.getAttribute("data-national-match-id"),
        principal: node?.getAttribute("data-national-principal-id"),
        admitted: node?.getAttribute("data-national-host-admitted") === "true",
        tick: tick && /^\\d+$/.test(tick) ? Number(tick) : -1,
        canvas: [...document.querySelectorAll("canvas")].some(e => e.getBoundingClientRect().width > 150 && e.getBoundingClientRect().height > 100),
      };
    })()`),
          ),
        );
      stage = "three graphical seat projections";
      let first;
      await until(
        async () => {
          first = await snapshots();
          return (
            first.every(
              (s) =>
                s.admitted &&
                s.canvas &&
                s.tick >= 0 &&
                s.match === admission.gameID &&
                s.principal,
            ) && new Set(first.map((s) => s.principal)).size === 3
          );
        },
        stage,
        90_000,
      );
      stage = "host and browser advancing tick correlation";
      let last;
      await until(
        async () => {
          last = await snapshots();
          const ticks = host.messages
            .filter(
              (m) =>
                m.message === "NATIONAL authoritative tick" &&
                m.gameID === admission.gameID &&
                Number.isSafeInteger(m.tick),
            )
            .map((m) => m.tick);
          return (
            new Set(ticks).size >= 2 &&
            last.every(
              (s, i) =>
                s.admitted &&
                s.match === first[i].match &&
                s.principal === first[i].principal &&
                s.canvas &&
                s.tick > first[i].tick &&
                s.tick <= Math.max(...ticks),
            )
          );
        },
        stage,
        90_000,
      );
      stage = "distinct graphical artifacts";
      for (let i = 0; i < profiles.length; i++) {
        const response = await profiles[i].send("Page.captureScreenshot", {
          format: "png",
        });
        const bytes = Buffer.from(response.data, "base64");
        assert(
          bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        );
        const hash = createHash("sha256").update(bytes).digest("hex");
        assert(!screenshotHashes.has(hash));
        screenshotHashes.add(hash);
        writeFileSync(join(screenshotDir, `participant-${i + 1}.png`), bytes, {
          mode: 0o600,
          flag: "wx",
        });
      }
      assert(profiles.every((p) => p.observed.missingMusicRequests === 0));
      console.log(
        JSON.stringify({
          exactSource: head,
          browserProfiles: 3,
          hostAuthenticatedSeats: 3,
          independentHumanWitnesses: 0,
          screenshotSha256: [...screenshotHashes],
          browserTickDeltas: last.map((s, i) => s.tick - first[i].tick),
          privateJourney: "BLOCKED",
          firstUnverifiedStage:
            "native political and military controls followed by canonical victory",
          gpuAttested: false,
        }),
      );
      process.exitCode = 2;
    }
  }
} catch {
  // Never expose DevTools errors, URLs, credential bodies or profile IDs.
  console.error("LOCAL_STAGING_BROWSER_AUTH_FAIL stage=" + stage);
  console.error("SAFE_BROWSER_STATUS " + JSON.stringify(diagnostic()));
  process.exitCode = 1;
} finally {
  for (const ws of sockets) ws.terminate();
  for (const child of children.reverse()) await child.stop();
  fixture.cleanup();
}
