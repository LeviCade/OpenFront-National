import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  fsyncSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  statfsSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const MAX_NATIONAL_RECORD_BYTES = 64 * 1024 * 1024;
const MAX_MATCHES = 16;
const MAX_PAGES = 262144;

export interface DurableNationalRecord {
  gameID: string;
  generation: number;
  tick: number;
  payload: string;
  digest: string;
}

function validID(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
    throw new Error("NATIONAL invalid game ID");
}

function privateFile(path: string, create: boolean): void {
  if (create)
    try {
      closeSync(
        openSync(
          path,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            constants.O_NOFOLLOW,
          0o600,
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  const st = lstatSync(path);
  if (
    !st.isFile() ||
    st.nlink !== 1 ||
    (st.mode & 0o777) !== 0o600 ||
    st.uid !== process.getuid?.()
  ) {
    throw new Error("NATIONAL unsafe database file");
  }
}

function commitment(
  id: string,
  generation: number,
  tick: number,
  payload: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify([1, id, generation, tick, payload]))
    .digest("hex");
}

function checked(row: Record<string, unknown>): DurableNationalRecord {
  const { gameID, generation, tick, payload, digest } = row;
  if (
    typeof gameID !== "string" ||
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    typeof tick !== "number" ||
    !Number.isSafeInteger(tick) ||
    tick < 0 ||
    typeof payload !== "string" ||
    Buffer.byteLength(payload) > MAX_NATIONAL_RECORD_BYTES ||
    typeof digest !== "string" ||
    digest !== commitment(gameID, generation, tick, payload)
  ) {
    throw new Error("NATIONAL invalid checkpoint integrity");
  }
  validID(gameID);
  return { gameID, generation, tick, payload, digest };
}

/** One process owns an entire worker shard. The separate Linux flock
 * is held until process exit; checkpoint transactions never release it.
 * Only a private, local, operator-owned filesystem is supported. */
export class DurableNationalStore {
  private readonly lockFD: number;
  private readonly lockPath: string;
  private readonly dbPath: string;
  private readonly dbIdentity: { dev: number; ino: number };
  private readonly db: DatabaseSync;
  private failed = false;

  constructor(
    root: string,
    worker: number,
    maxPages = MAX_PAGES,
    initialize = false,
  ) {
    if (
      process.platform !== "linux" ||
      !Number.isSafeInteger(worker) ||
      worker < 0 ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 16 ||
      maxPages > MAX_PAGES ||
      !isAbsolute(root) ||
      resolve(root) !== root ||
      realpathSync(root) !== root
    )
      throw new Error("NATIONAL unsafe recovery directory");
    const st = lstatSync(root);
    if (
      !st.isDirectory() ||
      (st.mode & 0o777) !== 0o700 ||
      st.uid !== process.getuid?.()
    )
      throw new Error("NATIONAL recovery directory must be private");
    // Explicit local Linux filesystem families only. The operator must also
    // ensure the underlying block storage honors fsync (including overlays).
    const localTypes = [0xef53, 0x58465342, 0x9123683e, 0x794c7630, 0xf2f52010];
    if (!localTypes.includes(statfsSync(root).type))
      throw new Error("NATIONAL unsupported recovery filesystem");
    const lockPath = join(root, `worker-${worker}.lock`);
    const dbPath = join(root, `worker-${worker}.sqlite`);
    this.lockPath = lockPath;
    this.dbPath = dbPath;
    privateFile(lockPath, initialize);
    privateFile(dbPath, initialize);
    this.lockFD = openSync(lockPath, constants.O_RDWR | constants.O_NOFOLLOW);
    let db: DatabaseSync | undefined;
    try {
      const lock = spawnSync("/usr/bin/flock", ["-n", "3"], {
        stdio: ["ignore", "ignore", "ignore", this.lockFD],
        timeout: 5000,
      });
      if (lock.status !== 0 || lock.error)
        throw new Error(
          "NATIONAL worker shard already owned or lock unavailable",
        );
      db = new DatabaseSync(dbPath);
      const dbIdentity = lstatSync(dbPath);
      if (dbIdentity.size > maxPages * 4096)
        throw new Error("NATIONAL existing database exceeds bound");
      this.dbIdentity = { dev: dbIdentity.dev, ino: dbIdentity.ino };
      db.exec(
        `PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA max_page_count=${maxPages};`,
      );
      if (initialize) {
        db.exec(
          "CREATE TABLE checkpoints (gameID TEXT PRIMARY KEY, generation INTEGER NOT NULL, tick INTEGER NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL) STRICT",
        );
      }
      // Do not silently create a missing schema in a lost or empty DB.
      db.prepare(
        "SELECT gameID, generation, tick, payload, digest FROM checkpoints LIMIT 0",
      );
      if (db.prepare("PRAGMA page_size").get()?.page_size !== 4096)
        throw new Error("NATIONAL unsupported database page size");
      this.db = db;
      this.assertAvailable();
    } catch (error) {
      db?.close();
      closeSync(this.lockFD);
      throw error;
    }
  }

  private assertAvailable(): void {
    if (this.lockFD < 0 || this.failed)
      throw new Error("NATIONAL durable writer failed");
    try {
      const lock = fstatSync(this.lockFD);
      const path = lstatSync(this.lockPath);
      const db = lstatSync(this.dbPath);
      if (
        lock.dev !== path.dev ||
        lock.ino !== path.ino ||
        path.nlink !== 1 ||
        db.dev !== this.dbIdentity.dev ||
        db.ino !== this.dbIdentity.ino ||
        db.nlink !== 1 ||
        (path.mode & 0o777) !== 0o600 ||
        (db.mode & 0o777) !== 0o600
      )
        throw new Error("NATIONAL durable ownership path replaced");
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }

  list(): string[] {
    this.assertAvailable();
    const rows = this.db
      .prepare("SELECT gameID FROM checkpoints ORDER BY gameID LIMIT ?")
      .all(MAX_MATCHES + 1);
    if (rows.length > MAX_MATCHES)
      throw new Error("NATIONAL checkpoint quota exceeded");
    return rows.map((row) => {
      const id = row.gameID;
      if (typeof id !== "string")
        throw new Error("NATIONAL invalid checkpoint ID");
      validID(id);
      return id;
    });
  }

  read(gameID: string): DurableNationalRecord | null {
    this.assertAvailable();
    validID(gameID);
    const row = this.db
      .prepare(
        "SELECT gameID, generation, tick, digest, CASE WHEN length(CAST(payload AS BLOB)) <= ? THEN payload ELSE NULL END AS payload FROM checkpoints WHERE gameID = ?",
      )
      .get(MAX_NATIONAL_RECORD_BYTES, gameID);
    return row ? checked(row) : null;
  }

  write(
    gameID: string,
    expected: number,
    tick: number,
    payload: string,
  ): DurableNationalRecord {
    this.assertAvailable();
    validID(gameID);
    if (
      !Number.isSafeInteger(expected) ||
      expected < 0 ||
      expected >= Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(tick) ||
      tick < 0 ||
      Buffer.byteLength(payload) > MAX_NATIONAL_RECORD_BYTES
    )
      throw new Error("NATIONAL checkpoint exceeds bounds");
    // All writes are synchronous under the shard lock. Reject capacity
    // exhaustion for a new world without fencing the existing worlds.
    if (expected === 0 && this.list().length >= MAX_MATCHES)
      throw new Error("NATIONAL match quota exceeded");
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const old = this.read(gameID);
      if (
        (old?.generation ?? 0) !== expected ||
        (old && (tick < old.tick || tick > old.tick + 1)) ||
        (!old && tick !== 0)
      )
        throw new Error("NATIONAL stale checkpoint generation or tick");
      const generation = expected + 1;
      const digest = commitment(gameID, generation, tick, payload);
      this.db
        .prepare(
          "INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?) ON CONFLICT(gameID) DO UPDATE SET generation=excluded.generation, tick=excluded.tick, payload=excluded.payload, digest=excluded.digest",
        )
        .run(gameID, generation, tick, payload, digest);
      this.db.exec("COMMIT");
      this.assertAvailable();
      return { gameID, generation, tick, payload, digest };
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* outcome uncertain: fence */
      }
      this.failed = true;
      throw error;
    }
  }

  retire(gameID: string, expected: number): void {
    this.assertAvailable();
    validID(gameID);
    try {
      const result = this.db
        .prepare("DELETE FROM checkpoints WHERE gameID=? AND generation=?")
        .run(gameID, expected);
      if (result.changes !== 1) throw new Error("NATIONAL stale retirement");
      this.assertAvailable();
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }
}

export function assertDurableNationalRoot(root: string, workers: number): void {
  const path = join(root, "manifest.json");
  if (
    !isAbsolute(root) ||
    resolve(root) !== root ||
    realpathSync(root) !== root
  )
    throw new Error("NATIONAL unsafe recovery root");
  const dir = lstatSync(root);
  if (
    !dir.isDirectory() ||
    (dir.mode & 0o777) !== 0o700 ||
    dir.uid !== process.getuid?.()
  )
    throw new Error("NATIONAL recovery directory must be private");
  privateFile(path, false);
  if (lstatSync(path).size > 128)
    throw new Error("NATIONAL recovery manifest exceeds bound");
  const metadata = readFileSync(path, "utf8");
  if (metadata !== JSON.stringify({ format: 1, workers }))
    throw new Error("NATIONAL recovery manifest or worker count incompatible");
}

/** Offline, explicit, one-time provisioning. Never invoke during Worker boot.
 * A partially provisioned root has no manifest and cannot become authority. */
export function initializeDurableNationalRoot(
  root: string,
  workers: number,
): void {
  if (
    !isAbsolute(root) ||
    resolve(root) !== root ||
    !Number.isSafeInteger(workers) ||
    workers < 1 ||
    workers > 128
  )
    throw new Error("NATIONAL invalid recovery initialization");
  mkdirSync(root, { mode: 0o700 });
  for (let worker = 0; worker < workers; worker++)
    new DurableNationalStore(root, worker, MAX_PAGES, true);
  const path = join(root, "manifest.json");
  const fd = openSync(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, JSON.stringify({ format: 1, workers }));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const dir = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
