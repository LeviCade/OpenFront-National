import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DurableNationalStore,
  MAX_NATIONAL_RECORD_BYTES,
} from "../../src/server/national/DurableNationalStore.ts";

const dir = mkdtempSync(join(tmpdir(), "national-durable-"));
const moduleURL = new URL(
  "../../src/server/national/DurableNationalStore.ts",
  import.meta.url,
).href;
const childCode = `import { DurableNationalStore } from ${JSON.stringify(moduleURL)}; const store = new DurableNationalStore(process.argv[1], 0, 262144, process.argv[2] === 'create'); if (process.argv[2] === 'create') { store.write('world', 0, 0, 'genesis'); store.write('world', 1, 1, 'tick-one'); } else if (process.argv[2] === 'replace') { const old=store.read('world'); store.write('world', old.generation, old.tick+1, 'tick-two'); } console.log('ready'); setInterval(()=>{}, 1000);`;
const args = ["--experimental-strip-types", "--input-type=module", "-e"];
let child;
async function start(code, mode) {
  const p = spawn(process.execPath, [...args, code, dir, mode], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("child timed out"));
    }, 5000);
    p.stdout.on("data", (c) => {
      output += c;
      if (output.includes("ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    p.once("exit", (c) => {
      clearTimeout(timeout);
      reject(new Error("child exited " + c));
    });
  });
  return p;
}
async function kill(p) {
  const exited = once(p, "exit");
  p.kill("SIGKILL");
  const [code, signal] = await exited;
  assert.equal(code, null);
  assert.equal(signal, "SIGKILL");
}
try {
  assert.throws(() => new DurableNationalStore(dir, 0), /ENOENT/);
  child = await start(childCode, "create");
  assert.throws(() => new DurableNationalStore(dir, 0), /already owned/);
  const competitor = spawnSync(
    process.execPath,
    [...args, childCode, dir, "replace"],
    { timeout: 5000 },
  );
  assert.equal(competitor.signal, null);
  assert.notEqual(competitor.status, 0);
  assert.match(competitor.stderr.toString(), /already owned/);
  console.log("PASS simultaneous writer denied (two independent processes)");
  await kill(child);
  child = undefined;
  child = await start(childCode, "replace");
  await kill(child);
  child = undefined;
  console.log("PASS SIGKILL then replacement advanced durable generation");
  child = await start(childCode, "ownership-only");
  await kill(child);
  child = undefined;
  console.log(
    "PASS recovery interrupted after ownership and before publication",
  );
  const rawPath = join(dir, "worker-0.sqlite");
  const interruption = `import {DatabaseSync} from 'node:sqlite'; import {join} from 'node:path'; const db=new DatabaseSync(join(process.argv[1],'worker-0.sqlite')); db.exec('BEGIN IMMEDIATE'); db.exec("UPDATE checkpoints SET payload='partial' WHERE gameID='world'"); console.log('ready'); setInterval(()=>{},1000);`;
  child = await start(interruption, "");
  await kill(child);
  child = undefined;
  const checkCode = `import {DurableNationalStore} from ${JSON.stringify(moduleURL)}; import assert from 'node:assert/strict'; const store=new DurableNationalStore(process.argv[1],0); const row=store.read('world'); assert.equal(row.tick,2); assert.equal(row.generation,3); assert.equal(row.payload,'tick-two'); console.log(row.digest);`;
  const verified = spawnSync(process.execPath, [...args, checkCode, dir]);
  assert.equal(verified.status, 0, verified.stderr.toString());
  console.log(
    "PASS interrupted transaction recovered last committed row",
    verified.stdout.toString().trim(),
  );
  const raw = new DatabaseSync(rawPath);
  raw.exec("UPDATE checkpoints SET payload='corrupt' WHERE gameID='world'");
  raw.close();
  const store = new DurableNationalStore(dir, 0);
  assert.throws(() => store.read("world"), /integrity/);
  assert.throws(() => store.read("../world"), /invalid game ID/);
  assert.throws(
    () => store.write("other", 0, 0, "x".repeat(MAX_NATIONAL_RECORD_BYTES + 1)),
    /bounds/,
  );
  store.write("other", 0, 0, "ok");
  assert.throws(() => store.write("other", 0, 0, "stale"), /stale/);
  assert.throws(() => store.write("other", 1, 1, "fenced"), /writer failed/);
  console.log(
    "PASS corruption, traversal, oversized data, stale generation and failure fence",
  );
  chmodSync(dir, 0o755);
  assert.throws(() => new DurableNationalStore(dir, 1), /private/);
  chmodSync(dir, 0o700);
  symlinkSync(rawPath, join(dir, "worker-1.sqlite"));
  assert.throws(() => new DurableNationalStore(dir, 1, 262144, true), /unsafe/);
  console.log("PASS unsafe permissions and symlink rejected");
  const limited = new DurableNationalStore(dir, 2, 16, true);
  const before = limited.write("quota", 0, 0, "init");
  assert.throws(
    () => limited.write("quota", 1, 1, "x".repeat(200000)),
    /full/i,
  );
  assert.throws(() => limited.read("quota"), /writer failed/);
  const independent = new DatabaseSync(join(dir, "worker-2.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    independent
      .prepare("SELECT digest FROM checkpoints WHERE gameID='quota'")
      .get().digest,
    before.digest,
  );
  independent.close();
  console.log("PASS SQLITE_FULL transaction rolls back and writer fences");
  const fenced = new DurableNationalStore(dir, 3, 262144, true);
  fenced.write("inode", 0, 0, "init");
  renameSync(join(dir, "worker-3.lock"), join(dir, "detached.lock"));
  assert.throws(
    () => fenced.write("inode", 1, 1, "unsafe"),
    /ENOENT|ownership path/,
  );
  assert.throws(() => fenced.write("inode", 1, 1, "unsafe"), /writer failed/);
  console.log("PASS lock pathname loss fences old writer");
} finally {
  if (child) await kill(child);
  rmSync(dir, { recursive: true, force: true });
}
