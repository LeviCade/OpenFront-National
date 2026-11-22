import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  closeSync,
  lstatSync,
  openSync,
  realpathSync,
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

function privateFile(path: string): void {
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
  private readonly db: DatabaseSync;
  private failed = false;

  constructor(root: string, worker: number) {
    if (
      process.platform !== "linux" ||
      !Number.isSafeInteger(worker) ||
      worker < 0 ||
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
    const lockPath = join(root, `worker-${worker}.lock`);
    const dbPath = join(root, `worker-${worker}.sqlite`);
    privateFile(lockPath);
    privateFile(dbPath);
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
      db.exec(
        `PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA max_page_count=${MAX_PAGES};`,
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS checkpoints (gameID TEXT PRIMARY KEY, generation INTEGER NOT NULL, tick INTEGER NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL) STRICT",
      );
      this.db = db;
    } catch (error) {
      db?.close();
      closeSync(this.lockFD);
      throw error;
    }
  }

  private assertAvailable(): void {
    if (this.lockFD < 0 || this.failed)
      throw new Error("NATIONAL durable writer failed");
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
      .prepare("SELECT * FROM checkpoints WHERE gameID = ?")
      .get(gameID);
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
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const old = this.read(gameID);
      if (
        (old?.generation ?? 0) !== expected ||
        (old && (tick < old.tick || tick > old.tick + 1)) ||
        (!old && tick !== 0)
      )
        throw new Error("NATIONAL stale checkpoint generation or tick");
      if (!old && this.list().length >= MAX_MATCHES)
        throw new Error("NATIONAL match quota exceeded");
      const generation = expected + 1;
      const digest = commitment(gameID, generation, tick, payload);
      this.db
        .prepare(
          "INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?) ON CONFLICT(gameID) DO UPDATE SET generation=excluded.generation, tick=excluded.tick, payload=excluded.payload, digest=excluded.digest",
        )
        .run(gameID, generation, tick, payload, digest);
      this.db.exec("COMMIT");
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
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }
}
