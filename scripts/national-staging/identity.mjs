// LOCAL STAGING ONLY. Never deploy this account authority publicly.
import {
  createHash, createPrivateKey, createPublicKey, generateKeyPairSync,
  randomBytes, randomUUID, sign, verify,
} from "node:crypto";
import { mkdirSync, lstatSync, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const issuer = "http://localhost:8787";
const origins = new Set(["http://localhost:9000", "http://localhost:3000"]);
const ttl = 15 * 60;
const refreshTtl = 30 * 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);
const secret = () => randomBytes(32).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const validEmail = (email) =>
  typeof email === "string" && /^[a-z0-9][a-z0-9._-]{0,63}@staging\.invalid$/.test(email);

if (process.env.NATIONAL_LOCAL_STAGING !== "1" ||
    process.env.GAME_ENV !== "dev" || process.env.DOMAIN !== "localhost" ||
    process.env.API_DOMAIN || process.env.SUBDOMAIN) {
  throw new Error("Refusing to run outside explicitly isolated localhost development");
}
const directory = process.env.NATIONAL_STAGING_STATE;
if (!directory || !isAbsolute(directory)) throw new Error("Set absolute NATIONAL_STAGING_STATE");
process.umask(0o077);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const stat = lstatSync(directory);
if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())) {
  throw new Error("Staging state must be an owned, private directory");
}
const maildir = join(directory, "mail");
mkdirSync(maildir, { mode: 0o700, recursive: true });
const db = new DatabaseSync(join(directory, "identity.sqlite"));
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
db.exec(
  "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, public_id TEXT UNIQUE NOT NULL, banned INTEGER NOT NULL DEFAULT 0);" +
  "CREATE TABLE IF NOT EXISTS signing (singleton INTEGER PRIMARY KEY CHECK(singleton=1), pem TEXT NOT NULL);" +
  "CREATE TABLE IF NOT EXISTS links (digest TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);" +
  "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);" +
  "CREATE TABLE IF NOT EXISTS refresh (digest TEXT PRIMARY KEY, session TEXT NOT NULL REFERENCES sessions(id), consumed INTEGER NOT NULL DEFAULT 0);"
);
const get = (sql, ...args) => db.prepare(sql).get(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
const accountByEmail = (email) => get("SELECT * FROM accounts WHERE email=?", email);
const accountById = (id) => get("SELECT * FROM accounts WHERE id=?", id);
const revoke = (id) => run("UPDATE sessions SET revoked=1 WHERE id=?", id);
const revokeAccount = (id) => run("UPDATE sessions SET revoked=1 WHERE account=?", id);
const mailbox = (email) => join(maildir, hash(email) + ".txt");
const cookieName = "national_staging_refresh";
const cookie = (value, age) =>
  cookieName + "=" + value + "; Path=/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=" + age;

const command = process.argv[2] ?? "serve";
if (command !== "serve") {
  const email = process.argv[3];
  if (!validEmail(email)) throw new Error("Use an explicit @staging.invalid account");
  if (command === "register") {
    run("INSERT INTO accounts (id,email,public_id) VALUES (?,?,?)",
      randomUUID(), email, randomUUID());
    console.log("Registered one local staging principal");
  } else if (command === "mail") {
    if (!process.stdout.isTTY) throw new Error("Read login mail only in a private interactive terminal");
    process.stdout.write(readFileSync(mailbox(email), "utf8"));
  } else if (command === "ban" || command === "unban" || command === "revoke") {
    const account = accountByEmail(email);
    if (!account) throw new Error("Unknown staging account");
    transaction(() => {
      if (command !== "revoke") run("UPDATE accounts SET banned=? WHERE id=?", command === "ban" ? 1 : 0, account.id);
      if (command !== "unban") revokeAccount(account.id);
    });
    console.log("Updated one local staging account");
  } else {
    throw new Error("Expected register, mail, revoke, ban, unban or serve");
  }
  db.close();
} else {
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey.length < 32 || apiKey.startsWith("WARNING_DEV")) {
    throw new Error("Set an isolated random API_KEY of at least 32 characters");
  }
  transaction(() => {
    if (!get("SELECT pem FROM signing WHERE singleton=1")) {
      const { privateKey } = generateKeyPairSync("ed25519");
      run("INSERT INTO signing VALUES (1,?)", privateKey.export({ format: "pem", type: "pkcs8" }));
    }
  });
  const key = createPrivateKey(get("SELECT pem FROM signing WHERE singleton=1").pem);
  const publicKey = createPublicKey(key);
  const jwk = { ...publicKey.export({ format: "jwk" }), alg: "EdDSA", use: "sig" };
  function issue(account, session) {
    const iat = now();
    const exp = Math.min(iat + ttl, session.expires);
    const body = encode({
      iss: issuer, aud: "localhost", sub: Buffer.from(account.id.replaceAll("-", ""), "hex").toString("base64url"),
      provider: "email", jti: randomUUID(), sid: session.id, iat, exp,
    });
    const input = encode({ alg: "EdDSA", typ: "JWT" }) + "." + body;
    return { jwt: input + "." + sign(null, Buffer.from(input), key).toString("base64url"), expiresIn: exp - iat };
  }
  function authenticate(header) {
    if (typeof header !== "string" || !header.startsWith("Bearer ") || header.length > 8192) return null;
    try {
      const parts = header.slice(7).split(".");
      if (parts.length !== 3 || !verify(null, Buffer.from(parts[0] + "." + parts[1]), publicKey, Buffer.from(parts[2], "base64url"))) return null;
      const protectedHeader = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      if (protectedHeader.alg !== "EdDSA" || claims.iss !== issuer || claims.aud !== "localhost" ||
          claims.provider !== "email" || !Number.isInteger(claims.exp) || claims.exp <= now() ||
          typeof claims.sid !== "string") return null;
      const session = get("SELECT * FROM sessions WHERE id=?", claims.sid);
      if (!session || session.revoked || session.expires <= now()) return null;
      const account = accountById(session.account);
      if (!account || account.banned || Buffer.from(account.id.replaceAll("-", ""), "hex").toString("base64url") !== claims.sub) return null;
      return account;
    } catch {
      return null;
    }
  }
  function readCookie(req) {
    const matches = (req.headers.cookie ?? "").split(";").map((x) => x.trim()).filter((x) => x.startsWith(cookieName + "="));
    if (matches.length !== 1) return null;
    const value = matches[0].slice(cookieName.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  function rotate(session) {
    const value = secret();
    run("INSERT INTO refresh (digest,session) VALUES (?,?)", hash(value), session.id);
    return cookie(value, Math.max(0, session.expires - now()));
  }
  function findRefresh(req) {
    const value = readCookie(req);
    return value ? get("SELECT r.digest,r.consumed,s.id,s.account,s.expires,s.revoked FROM refresh r JOIN sessions s ON s.id=r.session WHERE r.digest=?", hash(value)) : null;
  }
  async function body(req) {
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new Error("invalid body");
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) throw new Error("oversize");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  const server = createServer(async (req, res) => {
    const reply = (status, data, setCookie) => {
      if (setCookie) res.setHeader("Set-Cookie", setCookie);
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.headers.host !== "localhost:8787") return reply(403, { error: "local host required" });
      const origin = req.headers.origin;
      if (origin && !origins.has(origin)) return reply(403, { error: "local origin required" });
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        if (!origin) return reply(403, {});
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
        return reply(204, {});
      }
      const url = new URL(req.url, issuer);
      const route = req.method + " " + url.pathname;
      if (route === "GET /.well-known/jwks.json") return reply(200, { keys: [jwk] });
      if (route === "GET /users/@me") {
        if (!origin && req.headers["x-api-key"] !== apiKey) return reply(403, {});
        const account = authenticate(req.headers.authorization);
        if (!account) return reply(401, {});
        return reply(200, {
          user: { email: account.email }, ban: null,
          player: {
            publicId: account.public_id, adfree: false, canCreatePublicLobbies: false,
            trustTier: "untrusted", achievements: { singleplayerMap: [], player: [] },
            friends: [], subscription: null, flares: [],
          },
        });
      }
      // A browser cannot read the private operator mailbox. The login link itself
      // is the single-use credential; no OAuth identity or email delivery is claimed.
      if (route === "POST /auth/magic-link") {
        if (!origin) return reply(403, {});
        const input = await body(req);
        if (!validEmail(input.email) || input.redirectDomain !== origin) return reply(400, {});
        const account = accountByEmail(input.email);
        if (account && !account.banned) {
          const token = secret();
          const inserted = transaction(() => {
            if (get("SELECT digest FROM links WHERE account=? AND expires>? AND consumed=0", account.id, now() + 270)) return false;
            run("UPDATE links SET consumed=1 WHERE account=? AND consumed=0", account.id);
            run("INSERT INTO links (digest,account,expires) VALUES (?,?,?)", hash(token), account.id, now() + 300);
            return true;
          });
          if (inserted) writeFileSync(mailbox(account.email), origin + "/#token-login?token-login=" + token + "\n", { mode: 0o600 });
        }
        return reply(200, { accepted: true });
      }
      if (route === "GET /auth/login/token") {
        if (!origin) return reply(403, {});
        const token = url.searchParams.get("login-token");
        if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return reply(400, { code: "invalid" });
        const outcome = transaction(() => {
          const link = get("SELECT * FROM links WHERE digest=?", hash(token));
          if (!link) return { code: "invalid" };
          if (link.consumed) return { code: "consumed" };
          if (link.expires <= now()) return { code: "expired" };
          const account = accountById(link.account);
          if (!account || account.banned) return { code: "invalid" };
          run("UPDATE links SET consumed=1 WHERE digest=?", link.digest);
          const existing = findRefresh(req);
          if (existing) revoke(existing.id);
          const session = { id: randomUUID(), account: account.id, expires: now() + refreshTtl };
          run("INSERT INTO sessions (id,account,expires) VALUES (?,?,?)", session.id, session.account, session.expires);
          return { email: account.email, setCookie: rotate(session) };
        });
        if ("code" in outcome) return reply(400, { code: outcome.code });
        return reply(200, { email: outcome.email }, outcome.setCookie);
      }
      if (route === "POST /auth/refresh") {
        if (!origin) return reply(403, {});
        const outcome = transaction(() => {
          const session = findRefresh(req);
          if (!session || session.revoked || session.expires <= now()) return null;
          if (session.consumed) {
            revoke(session.id);
            return null;
          }
          const account = accountById(session.account);
          if (!account || account.banned) return null;
          run("UPDATE refresh SET consumed=1 WHERE digest=?", session.digest);
          return { token: issue(account, session), setCookie: rotate(session) };
        });
        if (!outcome) return reply(401, {}, cookie("", 0));
        return reply(200, outcome.token, outcome.setCookie);
      }
      if (route === "POST /auth/logout" || route === "POST /auth/revoke") {
        if (!origin) return reply(403, {});
        transaction(() => {
          const session = findRefresh(req);
          if (session && !session.revoked && !session.consumed && session.expires > now()) {
            if (route.endsWith("/revoke")) revokeAccount(session.account);
            else revoke(session.id);
          }
        });
        return reply(200, {}, cookie("", 0));
      }
      // Do not pretend that the inherited dev Turnstile exception is real
      // challenge verification. This service intentionally has no siteverify.
      if (route === "POST /join_verify") return reply(503, { status: "error", reason: "No approved Turnstile verifier configured" });
      return reply(404, { error: "unsupported by local staging identity" });
    } catch {
      if (!res.headersSent) reply(500, { error: "local identity request failed" });
      else res.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.listen(8787, "localhost", () => console.log("LOCAL STAGING AUTH listening on localhost:8787"));
  for (const event of ["SIGTERM", "SIGINT"]) process.once(event, () => {
    server.close(() => { db.close(); process.exit(0); });
    server.closeAllConnections();
  });
}
