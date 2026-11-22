import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import {
  accountCommand,
  login,
  makeEnvironment,
  profile,
  refresh,
  request,
  startIdentity,
} from "./operator-harness.mjs";

const fixture = makeEnvironment();
let service;
try {
  const emails = ["alpha", "bravo", "charlie"].map(
    (name) => name + "@staging.invalid",
  );
  for (const email of emails) accountCommand(fixture.env, "register", email);
  service = await startIdentity(fixture.env);
  const auth = await Promise.all(
    emails.map((email) => login(fixture.dir, email)),
  );
  const response = await request("/.well-known/jwks.json");
  assert.equal(response.status, 200);
  const { keys } = await response.json();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].alg, "EdDSA");
  assert(!("d" in keys[0]), "private key leaked");
  const key = createPublicKey({ key: keys[0], format: "jwk" });
  const subjects = new Set();
  const publicIds = new Set();
  for (let i = 0; i < auth.length; i++) {
    const [head, body, sig] = auth[i].jwt.split(".");
    assert(
      verify(
        null,
        Buffer.from(head + "." + body),
        key,
        Buffer.from(sig, "base64url"),
      ),
    );
    const claims = JSON.parse(Buffer.from(body, "base64url"));
    assert.equal(claims.aud, "localhost");
    assert.equal(claims.iss, "http://localhost:8787");
    assert.equal(claims.provider, "email");
    subjects.add(claims.sub);
    const p = await profile(auth[i].jwt);
    assert.equal(p.user.email, emails[i]);
    publicIds.add(p.player.publicId);
  }
  assert.equal(subjects.size, 3);
  assert.equal(publicIds.size, 3);
  assert.equal(
    (await request("/auth/refresh", { method: "POST" })).status,
    401,
  );
  assert.equal(
    (
      await request("/auth/magic-link", {
        method: "POST",
        browserOrigin: "http://unexpected.invalid",
        body: { email: emails[0], redirectDomain: "http://unexpected.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/auth/login/token?login-token=invalid")).status,
    400,
  );
  const tampered = auth[0].jwt.slice(0, -10) + "AAAAAAAAAA";
  assert.equal((await request("/users/@me", { jwt: tampered })).status, 401);

  // Restart the identity process; persisted accounts, signing key, issued
  // sessions and revocations must survive. The test keeps its own cookie jar.
  await service.stop();
  service = await startIdentity(fixture.env);
  assert.equal((await profile(auth[1].jwt)).user.email, emails[1]);
  const renewed = await refresh(auth[0].cookie);
  assert.equal((await profile(renewed.jwt)).user.email, emails[0]);
  assert.equal(
    (
      await request("/auth/refresh", {
        method: "POST",
        cookie: auth[0].cookie,
      })
    ).status,
    401,
    "consumed refresh replay accepted",
  );
  assert.equal(
    (await request("/users/@me", { jwt: renewed.jwt })).status,
    401,
    "replayed refresh family was not revoked",
  );

  const logout = await request("/auth/logout", {
    method: "POST",
    cookie: auth[1].cookie,
  });
  assert.equal(logout.status, 200);
  assert.equal((await request("/users/@me", { jwt: auth[1].jwt })).status, 401);
  accountCommand(fixture.env, "ban", emails[2]);
  assert.equal((await request("/users/@me", { jwt: auth[2].jwt })).status, 401);
  assert.equal(
    (
      await request("/auth/refresh", {
        method: "POST",
        cookie: auth[2].cookie,
      })
    ).status,
    401,
  );
  accountCommand(fixture.env, "unban", emails[2]);
  const recovered = await login(fixture.dir, emails[2]);
  assert.equal((await profile(recovered.jwt)).user.email, emails[2]);
  assert.equal((await request("/join_verify", { method: "POST" })).status, 503);
  console.log(
    "LOCAL_STAGING_IDENTITY_PASS accounts=3 distinct_subjects=3 distinct_public_ids=3 persisted_restart=1 rotation=1 replay_family_revocation=1 logout=1 ban_recovery=1 upstream_oauth=0 turnstile=0",
  );
} catch {
  // Assertion values can contain credentials: never serialize the exception.
  console.error(
    "LOCAL_STAGING_IDENTITY_FAIL (run privately for debugging; no raw evidence emitted)",
  );
  process.exitCode = 1;
} finally {
  if (service) await service.stop();
  fixture.cleanup();
}
