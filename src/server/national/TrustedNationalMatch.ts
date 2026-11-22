/**
 * Trusted NATIONAL Private match authority. Never expose this object or its
 * canonical turns through a client route. The Worker has already verified
 * Client.claims/publicId using the account API before GameServer seats a Client.
 *
 * This is a server-only vertical slice, NOT the legacy websocket turn
 * protocol. No browser may execute a second authoritative NATIONAL runner.
 */
import {
  GameMode,
  GameType,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  type GameUpdateViewData,
  type PlayerUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import {
  type ClientID,
  IntentSchema,
  type StampedIntent,
  StampedIntentSchema,
  type Turn,
} from "@openfront/engine-api/Schemas";
import { GameRunner } from "@openfront/engine/WinnerReplay";
import { createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { Client } from "../Client";
import {
  type DurableNationalCheckpoint,
  type DurableNationalState,
  MAX_NATIONAL_REQUEST_IDS,
  initialNationalReplayDigest,
} from "./DurableNationalCheckpoint";

export interface NationalTickReceipt {
  readonly tick: number;
  readonly committedIntents: number;
  /** SHA-256 of server-stamped canonical turns; not a game-state snapshot. */
  readonly replayDigest: string;
}

const MANAGEMENT_INTENTS = new Set([
  "kick_player",
  "update_game_config",
  "toggle_game_start_timer",
  "toggle_pause",
  "mark_disconnected",
]);

export class TrustedNationalMatch {
  private readonly seats = new Map<ClientID, Client>();
  /** The exact admitted physical socket, not reusable clientID identity. */
  private readonly activeSocket = new Map<ClientID, () => boolean>();
  private readonly requestIds = new Map<ClientID, Set<string>>();
  /** A command token belongs to exactly one original principal for this game. */
  private readonly requestOwners = new Map<string, ClientID>();
  private replayCommitment: string;
  private readonly kicked = new Set<ClientID>();
  private paused = false;
  private deliveryQueue: Array<() => void> | null = null;
  private intents: StampedIntent[] = [];

  constructor(
    readonly gameID: string,
    private readonly runner: GameRunner,
    admittedPlayers: readonly Client[],
    private readonly deliver: (
      client: Client,
      packet: GameUpdateViewData,
    ) => void,
    private readonly checkpoint?: DurableNationalCheckpoint,
    recovered = false,
  ) {
    this.replayCommitment =
      checkpoint?.state.replayDigest ?? initialNationalReplayDigest(gameID);
    if (recovered && !checkpoint)
      throw new Error("NATIONAL recovery requires durable checkpoint");
    const config = runner.game.config().gameConfig();
    if (
      config.nationalMode !== true ||
      config.gameType !== GameType.Private ||
      config.gameMode !== GameMode.FFA ||
      config.rankedType !== undefined ||
      config.tutorial === true
    ) {
      throw new Error(
        "NATIONAL authority requires an unranked Private FFA game",
      );
    }
    if (admittedPlayers.length < 2) {
      throw new Error(
        "NATIONAL authority requires two real authenticated humans",
      );
    }

    const accounts = new Set<string>();
    const persistentIDs = new Set<string>();
    for (const client of admittedPlayers) {
      // client.publicId was resolved by Worker's authenticated /users/@me,
      // not accepted from a lobby message, username, or intent body.
      if (
        (!recovered && !client.claims) ||
        (recovered && client.claims !== null) ||
        !client.publicId ||
        !client.persistentID ||
        client.spectator ||
        this.seats.has(client.clientID) ||
        accounts.has(client.publicId) ||
        persistentIDs.has(client.persistentID)
      ) {
        throw new Error(
          "NATIONAL authority rejected unauthenticated or duplicate seat",
        );
      }
      const player = runner.game.playerByClientID(client.clientID);
      if (!player || player.type() !== PlayerType.Human) {
        throw new Error(
          "NATIONAL authority seat missing from real Game registry",
        );
      }
      this.seats.set(client.clientID, client);
      this.requestIds.set(client.clientID, new Set());
      accounts.add(client.publicId);
      persistentIDs.add(client.persistentID);
    }
    // Register projections only after validating every seat. The GameRunner
    // itself verifies clientID -> real PlayerID on each subsequent tick.
    if (checkpoint) {
      if (
        checkpoint.seats.length !== admittedPlayers.length ||
        checkpoint.seats.some((seat) => {
          const client = this.seats.get(seat.clientID);
          return (
            !client ||
            client.persistentID !== seat.subject ||
            client.publicId !== seat.accountId ||
            runner.game.playerByClientID(seat.clientID)?.id() !== seat.playerID
          );
        })
      )
        throw new Error("NATIONAL durable seat binding mismatch");
      for (const [requestId, owner] of checkpoint.state.requestOwners) {
        this.requestOwners.set(requestId, owner);
        this.requestIds.get(owner)!.add(requestId);
      }
      for (const owner of checkpoint.state.kicked) this.kicked.add(owner);
      this.paused = checkpoint.state.paused;
    }
    if (!recovered) {
      for (const client of admittedPlayers) this.registerSeat(client);
    }
  }

  private durableState(): DurableNationalState {
    return {
      replayDigest: this.replayCommitment,
      requestOwners: [...this.requestOwners],
      kicked: [...this.kicked],
      paused: this.paused,
    };
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.checkpoint?.reserve(this.durableState());
  }

  recordKick(clientID: ClientID): void {
    if (!this.seats.has(clientID)) return;
    this.kicked.add(clientID);
    this.checkpoint?.reserve(this.durableState());
  }

  retire(): void {
    this.checkpoint?.retire();
  }

  durableTick(): number | null {
    return this.checkpoint?.tick ?? null;
  }

  stateCommitment(): string | null {
    return this.checkpoint?.commitment ?? null;
  }

  /** E2's verified Client and original physical socket are authoritative.
   * A reconnect always receives a NEW E3 cursor and server-minted nonce.
   */
  private registerSeat(client: Client): void {
    const admittedSocket = client.ws;
    const sessionId = randomUUID();
    const active = () =>
      this.seats.get(client.clientID) === client &&
      !this.kicked.has(client.clientID) &&
      client.ws === admittedSocket &&
      admittedSocket.readyState === WebSocket.OPEN &&
      !client.spectator &&
      !!client.claims &&
      !!client.publicId;
    this.activeSocket.set(client.clientID, active);
    this.runner.registerTrustedNationalRecipient(
      client.clientID,
      {
        clientID: client.clientID,
        sessionId,
        isConnected: active,
        isSpectator: () => client.spectator,
      },
      (packet) => {
        // The runner already passed the host-only frame through E3's ONE
        // principal-bound projection. E2 GameServer alone owns encoding and
        // sending the existing national_projection wire variant.
        if (!active()) return;
        // The seat-to-player binding is host-owned identity metadata, not
        // sight intelligence. E3 intentionally omits clientIDs from public
        // player deltas, including the pre-spawn baseline. A global diff may
        // therefore never repeat a newly authorized recipient's clientID.
        // Restore ONLY this authenticated seat's canonical mapping so a new
        // browser can identify itself before spawn and after replacement.
        const player = this.runner.game.playerByClientID(client.clientID);
        if (!player || player.type() !== PlayerType.Human) return;
        const identity: PlayerUpdate = {
          type: GameUpdateType.Player,
          id: player.id(),
          clientID: client.clientID,
          smallID: player.smallID(),
          name: player.name(),
          displayName: player.displayName(),
          playerType: PlayerType.Human,
          hasSpawned: player.hasSpawned(),
        };
        const players = packet.updates[GameUpdateType.Player] as PlayerUpdate[];
        const ownPresent = players.some((update) => update.id === identity.id);
        const bound = players.map((update) =>
          update.id === identity.id ? { ...update, ...identity } : update,
        );
        if (!ownPresent) bound.push(identity);
        const projected = {
          ...packet,
          updates: {
            ...packet.updates,
            [GameUpdateType.Player]: bound,
          },
        };
        if (this.deliveryQueue === null) {
          // The non-durable runner retains its inherited direct-delivery
          // contract. A durable match cannot bypass the commit boundary.
          if (this.checkpoint)
            throw new Error("NATIONAL projection outside authoritative tick");
          this.deliver(client, projected);
        } else {
          this.deliveryQueue.push(() => {
            if (active()) this.deliver(client, projected);
          });
        }
      },
    );
  }

  /**
   * The caller must supply the exact Client object admitted to this match,
   * not a caller-supplied principal ID. SocketIngress / GameServer separately
   * authenticate the live socket and rate-limit its messages.
   */
  submit(sender: Client, candidate: unknown): boolean {
    if (
      this.seats.get(sender.clientID) !== sender ||
      this.kicked.has(sender.clientID) ||
      this.intents.length >= 4096 ||
      this.activeSocket.get(sender.clientID)?.() !== true ||
      sender.spectator ||
      !sender.claims ||
      !sender.publicId
    )
      return false;
    if (
      this.runner.game.playerByClientID(sender.clientID)?.type() !==
      PlayerType.Human
    ) {
      return false;
    }
    const parsed = IntentSchema.safeParse(candidate);
    if (!parsed.success || MANAGEMENT_INTENTS.has(parsed.data.type)) {
      return false;
    }
    // Zod strips any clientID the peer attempted to smuggle into candidate.
    // The only principal the executor ever sees is this admitted server seat.
    const stamped = StampedIntentSchema.parse({
      ...parsed.data,
      clientID: sender.clientID,
    });
    if ("requestId" in stamped && stamped.requestId !== undefined) {
      const seen = this.requestIds.get(sender.clientID)!;
      const owner = this.requestOwners.get(stamped.requestId);
      if (
        seen.has(stamped.requestId) ||
        owner !== undefined ||
        this.requestOwners.size >= MAX_NATIONAL_REQUEST_IDS
      )
        return false;
      seen.add(stamped.requestId);
      this.requestOwners.set(stamped.requestId, sender.clientID);
      // The ID is reserved durably even if its socket disconnects before the tick.
      this.checkpoint?.reserve(this.durableState());
    }
    this.intents.push(stamped);
    return true;
  }

  /** One deterministic simulation step, performed ONLY by the trusted host. */
  tick(): NationalTickReceipt {
    const turn: Turn = {
      turnNumber: this.runner.game.ticks(),
      intents: this.intents,
    };
    this.intents = [];
    const queue: Array<() => void> = [];
    this.deliveryQueue = queue;
    try {
      this.runner.addTurn(turn);
      if (!this.runner.executeNextTick()) {
        throw new Error("NATIONAL authoritative GameRunner refused tick");
      }
      this.replayCommitment = createHash("sha256")
        .update(this.replayCommitment)
        .update(JSON.stringify(turn))
        .digest("hex");
      // Capture AFTER recipient filtering, BEFORE any network output.
      this.checkpoint?.commit(this.runner, this.durableState());
    } finally {
      this.deliveryQueue = null;
    }
    for (const deliver of queue) deliver();
    return {
      tick: this.runner.game.ticks(),
      committedIntents: turn.intents.length,
      replayDigest: this.replayDigest(),
    };
  }

  /** Bounded digest chain; never transmit raw hidden state. */
  replayDigest(): string {
    return this.replayCommitment;
  }

  /** E2 GameServer host-only disconnect status; never client admin intent. */
  recordServerDisconnect(clientID: ClientID, disconnected: boolean): void {
    if (!this.seats.has(clientID)) return;
    this.intents.push(
      StampedIntentSchema.parse({
        type: "mark_disconnected",
        clientID,
        isDisconnected: disconnected,
      }),
    );
  }

  currentTick(): number {
    return this.runner.game.ticks();
  }

  /**
   * An uncommitted command is a capability held by its submitting physical
   * socket. A disconnect, kick or replacement cancels it BEFORE the next
   * authoritative tick. Never recycle its requestId for another session.
   * Only server-authored connection-status intents survive this cleanup.
   */
  private revokePending(clientID: ClientID): void {
    this.intents = this.intents.filter(
      (intent) =>
        intent.type === "mark_disconnected" || intent.clientID !== clientID,
    );
  }

  /** New physical socket for the SAME verified account/seat. Historical
   * command receipts must NOT replay, current pending invitations may.
   */
  resumeRecipient(client: Client): boolean {
    if (
      this.seats.get(client.clientID) !== client ||
      this.kicked.has(client.clientID) ||
      !client.claims ||
      !client.publicId ||
      client.spectator ||
      client.ws.readyState !== WebSocket.OPEN ||
      this.runner.game.playerByClientID(client.clientID)?.type() !==
        PlayerType.Human
    )
      return false;
    this.revokePending(client.clientID);
    this.runner.removeTrustedNationalRecipient(client.clientID);
    this.activeSocket.delete(client.clientID);
    this.registerSeat(client);
    return true;
  }

  /** Revokes private E3 delivery. Already-committed turns remain canonical. */
  revokeRecipient(client: Client): void {
    if (this.seats.get(client.clientID) !== client) return;
    this.revokePending(client.clientID);
    this.activeSocket.delete(client.clientID);
    this.runner.removeTrustedNationalRecipient(client.clientID);
  }
}
