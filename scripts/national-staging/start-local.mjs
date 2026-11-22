// Foreground supervisor for an operator's isolated local browser session.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  accountCommand,
  launch,
  makeEnvironment,
  startIdentity,
  until,
} from "./operator-harness.mjs";

const dirty = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=no"],
  { encoding: "utf8" },
).trim();
assert(!dirty, "Commit or discard tracked edits before exact-source staging");
const fixture = makeEnvironment();
const children = [];
let requestedStop = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    requestedStop = true;
  });
}
try {
  for (const name of ["alpha", "bravo", "charlie"]) {
    accountCommand(fixture.env, "register", name + "@staging.invalid");
  }
  children.push(await startIdentity(fixture.env));
  const host = launch(["--import", "tsx", "src/server/Server.ts"], fixture.env);
  children.push(host);
  await until(
    () =>
      host.alive() &&
      host.messages.some((m) =>
        m.message.startsWith("Master HTTP server listening"),
      ) &&
      host.messages.some(
        (m) => m.message === "running on http://localhost:3001",
      ),
    "Master and Worker startup",
    45_000,
  );
  const client = launch(
    ["node_modules/vite/bin/vite.js", "--host", "localhost", "--strictPort"],
    fixture.env,
  );
  children.push(client);
  await until(
    async () => {
      if (!client.alive()) throw new Error("Vite startup failed");
      try {
        const res = await fetch("http://localhost:9000/", {
          signal: AbortSignal.timeout(2000),
        });
        return res.ok && (await res.text()).includes(fixture.env.GIT_COMMIT);
      } catch {
        return false;
      }
    },
    "exact-source browser entrypoint",
    45_000,
  );
  console.log(
    "LOCAL NATIONAL STAGING READY (NOT external OAuth or production)",
  );
  console.log("Source: " + fixture.env.GIT_COMMIT);
  console.log("Browser: http://localhost:9000/");
  console.log(
    "Local accounts: alpha@staging.invalid, bravo@staging.invalid, charlie@staging.invalid",
  );
  console.log(
    "Request each magic link in its own fresh browser profile. In a private operator terminal read only its own mailbox:",
  );
  console.log(
    "GAME_ENV=dev DOMAIN=localhost NATIONAL_LOCAL_STAGING=1 NATIONAL_STAGING_STATE='" +
      fixture.dir.replaceAll("'", "'\\''") +
      "' node scripts/national-staging/identity.mjs mail alpha@staging.invalid",
  );
  console.log(
    "Replace the account and 'mail' with 'revoke', 'ban' or 'unban' for operator controls. Never publish link contents.",
  );
  console.log(
    "Ctrl+C stops the owned process group and destroys all disposable identity state.",
  );
  while (!requestedStop && children.every((child) => child.alive()))
    await delay(200);
  if (!requestedStop) throw new Error("Local staging child terminated");
} catch {
  console.error(
    "Local staging did not complete or stopped unexpectedly; see exact-source CI for diagnostics.",
  );
  process.exitCode = 1;
} finally {
  for (const child of children.reverse()) await child.stop();
  fixture.cleanup();
}
