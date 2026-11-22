import {
  GameMode,
  GameType,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { MapFiles } from "@openfront/engine-api/game/MapFiles";
import { decodeSnapshotValue, type GameRunner } from "@openfront/engine/WinnerReplay";
import {
  WireGameStartInfoSchema,
  type WireGameStartInfo,
} from "@openfront/shared/WireSchemas";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Client } from "../Client";
import {
  DurableNationalStore,
  type DurableNationalRecord,
} from "./DurableNationalStore";

// Field names are fixed schema labels only; never emit decoded values or
// dynamic dictionary keys (which may contain identities or hidden state).
const snapshotLabels = new Set(
  "magic format gitCommit gameID tick gameConfig game map miniMap players units attacks alliances allianceRequests stations railroads clusters execs t v d ticks startTick unInitExecs national nationalWar nationalGovernance wars levy layers motions receipts results memories tiles borderTiles border borderSize toConquer pri capacity random info gold troops tradeGold trainGold piracyGold goldEarned stats water rail sharedWaterCache owner target targetID authenticatedClientID active initialized attack sourceTile startTroops removeTroops retreating retreated isActive outgoingAttacks incomingAttacks outgoingLandAttacks lastTileChange tileChangeVersion shipStaggers unitGrid _unitsVersion _territoryVersion territoryVersion unitsVersion".split(
    " ",
  ),
);
function firstSnapshotDifference(
  a: unknown,
  b: unknown,
  path = "$",
  depth = 0,
): string | null {
  if (Object.is(a, b)) return null;
  if (depth > 64 || !a || !b || typeof a !== "object" || typeof b !== "object")
    return path;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (
      !ArrayBuffer.isView(a) ||
      !ArrayBuffer.isView(b) ||
      a.constructor !== b.constructor
    )
      return path + ".view";
    return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
      Buffer.from(b.buffer, b.byteOffset, b.byteLength),
    )
      ? null
      : path + ".bytes";
  }
  if (Array.isArray(a) !== Array.isArray(b)) return path;
  const aa = a as Record<string, unknown>,
    bb = b as Record<string, unknown>;
  const ka = Object.keys(aa),
    kb = Object.keys(bb);
  if (ka.length !== kb.length || ka.some((key, i) => key !== kb[i]))
    return path + ".keys";
  for (let i = 0; i < ka.length; i++) {
    const key = ka[i];
    const name = snapshotLabels.has(key) ? key : String(i);
    const diff = firstSnapshotDifference(
      aa[key],
      bb[key],
      path + "." + name,
      depth + 1,
    );
    if (diff) return diff;
  }
  return null;
}

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourceRevision = z.string().regex(/^[a-f0-9]{40}$/);
const identity = z.string().min(1).max(256);
export const MAX_NATIONAL_REQUEST_IDS = 100_000;
const Seat = z.strictObject({
  subject: identity,
  accountId: identity,
  clientID: identity,
  playerID: identity,
});
const State = z.strictObject({
  replayDigest: digest,
  requestOwners: z
    .array(z.tuple([identity, identity]))
    .max(MAX_NATIONAL_REQUEST_IDS),
  kicked: z.array(identity).max(512),
  paused: z.boolean(),
});
const Payload = z.strictObject({
  format: z.literal(1),
  source: sourceRevision,
  mapDigest: digest,
  info: WireGameStartInfoSchema,
  seats: z.array(Seat).min(2).max(512),
  snapshot: z.string().min(1),
  state: State,
});

export type DurableNationalSeat = z.infer<typeof Seat>;
export type DurableNationalState = z.infer<typeof State>;
type CheckpointPayload = z.infer<typeof Payload>;

export function nationalMapDigest(files: MapFiles): string {
  const hash = (bytes?: Uint8Array) =>
    bytes ? createHash("sha256").update(bytes).digest("hex") : null;
  return createHash("sha256")
    .update(
      JSON.stringify([
        files.map,
        files.mapSize,
        files.manifest,
        hash(files.mapBin),
        hash(files.map4xBin),
        hash(files.map16xBin),
      ]),
    )
    .digest("hex");
}

export function initialNationalReplayDigest(gameID: string): string {
  return createHash("sha256")
    .update("trusted-national-durable-v1\n" + gameID)
    .digest("hex");
}

function validatePayload(payload: CheckpointPayload, gameID: string): void {
  const { info, seats, state } = payload;
  if (
    info.gameID !== gameID ||
    info.config.nationalMode !== true ||
    info.config.gameType !== GameType.Private ||
    info.config.gameMode !== GameMode.FFA ||
    info.config.rankedType !== undefined ||
    info.config.tutorial === true ||
    info.listed === true ||
    info.players.length !== seats.length ||
    info.players.filter((p) => p.isLobbyCreator).length !== 1 ||
    !seats.every(
      (seat, index) => seat.clientID === info.players[index]?.clientID,
    ) ||
    new Set(seats.map((s) => s.clientID)).size !== seats.length ||
    new Set(seats.map((s) => s.subject)).size !== seats.length ||
    new Set(seats.map((s) => s.accountId)).size !== seats.length ||
    new Set(seats.map((s) => s.playerID)).size !== seats.length
  ) {
    throw new Error("NATIONAL invalid durable roster or start info");
  }
  const clients = new Set(seats.map((s) => s.clientID));
  if (
    new Set(state.requestOwners.map(([id]) => id)).size !==
      state.requestOwners.length ||
    state.requestOwners.some(([, owner]) => !clients.has(owner)) ||
    new Set(state.kicked).size !== state.kicked.length ||
    state.kicked.some((id) => !clients.has(id))
  ) {
    throw new Error("NATIONAL invalid durable command ownership");
  }
  // Reject noncanonical Base64, including partial/ambiguous encodings.
  if (
    Buffer.from(payload.snapshot, "base64").toString("base64") !==
    payload.snapshot
  ) {
    throw new Error("NATIONAL invalid durable snapshot encoding");
  }
}

/** One generation-checked row contains the latest exact engine snapshot and
 * reservation/seat metadata. There is no old generation fallback. */
export class DurableNationalCheckpoint {
  private constructor(
    private readonly store: DurableNationalStore,
    private record: DurableNationalRecord,
    private data: CheckpointPayload,
  ) {}

  static create(
    store: DurableNationalStore,
    source: string,
    mapDigest: string,
    info: WireGameStartInfo,
    clients: readonly Client[],
    runner: GameRunner,
  ): DurableNationalCheckpoint {
    const data = Payload.parse({
      format: 1,
      source,
      mapDigest,
      info,
      seats: clients.map((client) => ({
        subject: client.persistentID,
        accountId: client.publicId,
        clientID: client.clientID,
        playerID: runner.game.playerByClientID(client.clientID)?.id(),
      })),
      snapshot: Buffer.from(runner.snapshot(source)).toString("base64"),
      state: {
        replayDigest: initialNationalReplayDigest(info.gameID),
        requestOwners: [],
        kicked: [],
        paused: false,
      },
    });
    validatePayload(data, info.gameID);
    const record = store.write(
      info.gameID,
      0,
      runner.game.ticks(),
      JSON.stringify(data),
    );
    return new DurableNationalCheckpoint(store, record, data);
  }

  static load(
    store: DurableNationalStore,
    record: DurableNationalRecord,
    source: string,
  ): DurableNationalCheckpoint {
    const parsed = Payload.safeParse(JSON.parse(record.payload));
    if (
      !parsed.success ||
      parsed.data.source !== source ||
      !sourceRevision.safeParse(source).success
    ) {
      throw new Error("NATIONAL incompatible durable checkpoint");
    }
    validatePayload(parsed.data, record.gameID);
    return new DurableNationalCheckpoint(store, record, parsed.data);
  }

  get info(): WireGameStartInfo {
    return this.data.info;
  }
  get seats(): readonly DurableNationalSeat[] {
    return this.data.seats;
  }
  get state(): DurableNationalState {
    return this.data.state;
  }
  get tick(): number {
    return this.record.tick;
  }
  get source(): string {
    return this.data.source;
  }
  get mapDigest(): string {
    return this.data.mapDigest;
  }
  get snapshot(): Uint8Array {
    return Buffer.from(this.data.snapshot, "base64");
  }
  get commitment(): string {
    return this.record.digest;
  }

  validateRunner(runner: GameRunner): void {
    if (
      runner.game.ticks() !== this.tick ||
      this.seats.some((seat) => {
        const player = runner.game.playerByClientID(seat.clientID);
        return (
          player?.type() !== PlayerType.Human || player.id() !== seat.playerID
        );
      })
    )
      throw new Error("NATIONAL durable engine seat or tick mismatch");
    const restored = runner.snapshot(this.source);
    const saved = this.snapshot;
    if (!Buffer.from(restored).equals(Buffer.from(saved))) {
      const error = new Error("NATIONAL durable engine roundtrip mismatch");
      const path = firstSnapshotDifference(
        decodeSnapshotValue(saved),
        decodeSnapshotValue(restored),
      );
      error.name = "SnapshotRoundtripMismatch:" + (path ?? "encoding");
      throw error;
    }
  }

  /** Reserve a request or persist host controls at the same committed tick.
   * Pending socket-owned commands are NOT restored after a process death. */
  reserve(state: DurableNationalState): void {
    this.replace(this.tick, { ...this.data, state });
  }

  commit(runner: GameRunner, state: DurableNationalState): void {
    if (runner.game.ticks() !== this.tick + 1)
      throw new Error("NATIONAL nonconsecutive durable tick");
    this.replace(runner.game.ticks(), {
      ...this.data,
      state,
      snapshot: Buffer.from(runner.snapshot(this.source)).toString("base64"),
    });
  }

  private replace(tick: number, data: CheckpointPayload): void {
    validatePayload(data, this.record.gameID);
    const next = this.store.write(
      this.record.gameID,
      this.record.generation,
      tick,
      JSON.stringify(data),
    );
    this.record = next;
    this.data = data;
  }

  retire(): void {
    this.store.retire(this.record.gameID, this.record.generation);
  }
}
