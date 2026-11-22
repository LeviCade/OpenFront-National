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
  private readonly committed: Turn[] = [];
  private intents: StampedIntent[] = [];

  constructor(
    readonly gameID: string,
    private readonly runner: GameRunner,
    admittedPlayers: readonly Client[],
    private readonly deliver: (
      client: Client,
      packet: GameUpdateViewData,
    ) => void,
  ) {
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
        !client.claims ||
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
    for (const client of admittedPlayers) this.registerSeat(client);
  }

  /** E2's verified Client and original physical socket are authoritative.
   * A reconnect always receives a NEW E3 cursor and server-minted nonce.
   */
  private registerSeat(client: Client): void {
    const admittedSocket = client.ws;
    const sessionId = randomUUID();
    const active = () =>
      this.seats.get(client.clientID) === client &&
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
        this.deliver(client, {
          ...packet,
          updates: {
            ...packet.updates,
            [GameUpdateType.Player]: bound,
          },
        });
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
      if (seen.has(stamped.requestId) || owner !== undefined) return false;
      seen.add(stamped.requestId);
      this.requestOwners.set(stamped.requestId, sender.clientID);
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
    this.runner.addTurn(turn);
    if (!this.runner.executeNextTick()) {
      throw new Error("NATIONAL authoritative GameRunner refused tick");
    }
    this.committed.push(turn);
    return {
      tick: this.runner.game.ticks(),
      committedIntents: turn.intents.length,
      replayDigest: this.replayDigest(),
    };
  }

  /** Deterministic transcript commitment; never transmit raw hidden state. */
  replayDigest(): string {
    return createHash("sha256")
      .update("trusted-national-v1\n")
      .update(this.gameID)
      .update("\n")
      .update(JSON.stringify(this.committed))
      .digest("hex");
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
