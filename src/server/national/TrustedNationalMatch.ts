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
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import {
  type ClientID,
  IntentSchema,
  type StampedIntent,
  StampedIntentSchema,
  type Turn,
} from "@openfront/engine-api/Schemas";
import { GameRunner } from "@openfront/engine/GameRunner";
import { createHash } from "node:crypto";
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
  private readonly requestIds = new Map<ClientID, Set<string>>();
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
    for (const client of admittedPlayers) {
      runner.registerTrustedNationalRecipient(client.clientID, (packet) => {
        if (this.seats.get(client.clientID) === client && !client.spectator) {
          this.deliver(client, packet);
        }
      });
    }
  }

  /**
   * The caller must supply the exact Client object admitted to this match,
   * not a caller-supplied principal ID. SocketIngress / GameServer separately
   * authenticate the live socket and rate-limit its messages.
   */
  submit(sender: Client, candidate: unknown): boolean {
    if (
      this.seats.get(sender.clientID) !== sender ||
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
      if (seen.has(stamped.requestId)) return false;
      seen.add(stamped.requestId);
    }
    this.intents.push(stamped);
    return true;
  }

  /** Authenticated host-only connection status; NEVER accepted from socket input. */
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

  /**
   * A legitimate account reconnects to its ORIGINAL Game seat; create a fresh
   * E3 recipient cursor but never replay prior private packet history or
   * accept a new principal claiming the old clientID.
   */
  resumeRecipient(client: Client): boolean {
    if (
      this.seats.get(client.clientID) !== client ||
      !client.claims ||
      !client.publicId ||
      client.spectator ||
      this.runner.game.playerByClientID(client.clientID)?.type() !==
        PlayerType.Human
    )
      return false;
    this.runner.removeTrustedNationalRecipient(client.clientID);
    this.runner.registerTrustedNationalRecipient(client.clientID, (packet) => {
      if (this.seats.get(client.clientID) === client && !client.spectator) {
        this.deliver(client, packet);
      }
    });
    return true;
  }

  /** Revokes private E3 delivery. Already-committed turns remain canonical. */
  revokeRecipient(client: Client): void {
    if (this.seats.get(client.clientID) !== client) return;
    this.runner.removeTrustedNationalRecipient(client.clientID);
  }
}
