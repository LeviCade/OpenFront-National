// Disposable localhost process harness. Never log credentials, mailbox links,
// bearer data, private projections or raw server logs.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const issuer = "http://localhost:8787";
export const origin = "http://localhost:9000";
const identityScript = "scripts/national-staging/identity.mjs";

export async function until(predicate, label, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error("Timeout at " + label);
}

export function makeEnvironment() {
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    if (existsSync(name)) throw new Error("Use a disposable checkout without dotenv overrides");
  }
  const dir = mkdtempSync(join(tmpdir(), "national-account-"));
  // Do not inherit production API configuration or secret variables.
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? "C.UTF-8",
    GAME_ENV: "dev",
    SKIP_BROWSER_OPEN: "true",
    DOMAIN: "localhost",
    NATIONAL_LOCAL_STAGING: "1",
    NATIONAL_STAGING_STATE: dir,
    NUM_WORKERS: "1",
    INSTANCE_LETTER: "a",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    API_KEY: randomBytes(48).toString("hex"),
    GIT_COMMIT: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
  };
  return { dir, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function accountCommand(env, command, email) {
  execFileSync(process.execPath, [identityScript, command, email], {
    env, stdio: ["ignore", "pipe", "pipe"],
  });
}

export function launch(args, env) {
  const child = spawn(process.execPath, args, {
    env, detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  const messages = [];
  let identityReady = false;
  let ended = false;
  let pending = "";
  let processError = false;
  child.on("error", () => { processError = true; });
  child.on("exit", () => { ended = true; });
  child.stderr.resume();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "LOCAL STAGING AUTH listening on localhost:8787") identityReady = true;
      try {
        const log = JSON.parse(line);
        if (["NATIONAL authoritative host ready", "NATIONAL authoritative tick",
          "NATIONAL authenticated socket resumed", "NATIONAL account lease ended",
          "NATIONAL authoritative tick failed", "NATIONAL trusted host start failed"].includes(log.message)) {
          // Retain ONLY fields needed for anonymized test assertions.
          messages.push({
            message: log.message, gameID: log.gameID,
            authenticatedSeats: log.authenticatedSeats, distinctAccounts: log.distinctAccounts,
            authoritativeRunners: log.authoritativeRunners, tick: log.tick,
            code: log.code, queuedIntents: log.queuedIntents,
          });
        }
        if (typeof log.message === "string" &&
            (log.message.startsWith("Master HTTP server listening") ||
             log.message.startsWith("running on http://localhost:"))) {
          messages.push({ message: log.message });
        }
      } catch {
        // No unstructured child output ever escapes this harness.
      }
    }
  });
  async function stop() {
    if (child.pid === undefined) return;
    // The spawned process group is exclusively this disposable test, including
    // Node cluster children. Do not leave an old Worker listening after restart.
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    await delay(300);
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    await until(() => ended || processError, "owned process exit", 5000);
  }
  return {
    child, messages, identityReady: () => identityReady,
    alive: () => !processError && !ended,
    stop,
  };
}

export async function startIdentity(env) {
  const process = launch([identityScript, "serve"], env);
  try {
    await until(() => {
      assert(process.alive(), "identity process exited before listen");
      return process.identityReady();
    }, "local identity listen");
    return process;
  } catch (error) {
    await process.stop();
    throw error;
  }
}

export function request(path, { method = "GET", body, cookie, jwt, browserOrigin = origin } = {}) {
  return fetch(issuer + path, {
    method,
    headers: {
      origin: browserOrigin,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(jwt ? { authorization: "Bearer " + jwt } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error", signal: AbortSignal.timeout(5000),
  });
}

function issuedCookie(response) {
  const raw = response.headers.get("set-cookie");
  assert(raw && /;\s*HttpOnly/i.test(raw) && /;\s*Secure/i.test(raw) &&
    /;\s*SameSite=Strict/i.test(raw), "secure refresh cookie missing");
  return raw.split(";")[0];
}

export async function refresh(cookie) {
  const res = await request("/auth/refresh", { method: "POST", cookie });
  assert.equal(res.status, 200, "refresh exchange");
  const value = await res.json();
  assert(typeof value.jwt === "string" && value.jwt.split(".").length === 3, "JWT not issued");
  assert(value.expiresIn > 0 && value.expiresIn <= 900, "incorrect TTL");
  const nextCookie = issuedCookie(res);
  assert(nextCookie !== cookie, "refresh cookie was not rotated");
  return { jwt: value.jwt, cookie: nextCookie };
}

// The test operator reads the private mailbox only after the actual HTTP
// request; this is the legitimate local equivalent of receiving a login link.
// No token or browser cookie is set before a successful HTTP login exchange.
export async function login(dir, email) {
  const requested = await request("/auth/magic-link", {
    method: "POST", body: { email, redirectDomain: origin },
  });
  assert.equal(requested.status, 200, "magic-link request");
  const digest = createHash("sha256").update(email).digest("hex");
  const url = new URL(readFileSync(join(dir, "mail", digest + ".txt"), "utf8").trim());
  assert.equal(url.origin, origin);
  const token = new URLSearchParams(url.hash.split("?")[1]).get("token-login");
  assert(typeof token === "string" && token.length === 43, "missing login credential");
  const exchange = await request("/auth/login/token?login-token=" + encodeURIComponent(token));
  assert.equal(exchange.status, 200, "magic-link exchange");
  assert.equal((await exchange.json()).email, email, "incorrect registered principal");
  const cookie = issuedCookie(exchange);
  const reused = await request("/auth/login/token?login-token=" + encodeURIComponent(token));
  assert.equal(reused.status, 400, "replayed magic link");
  assert.equal((await reused.json()).code, "consumed");
  return { ...await refresh(cookie), firstCookie: cookie };
}

export async function profile(jwt) {
  const response = await request("/users/@me", { jwt });
  assert.equal(response.status, 200, "live account lookup");
  return response.json();
}
