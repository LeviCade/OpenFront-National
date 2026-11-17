/**
 * Server-side NATIONAL save primitive.
 *
 * This module must ONLY be instantiated by a host that runs the authoritative
 * Game outside the client. It is not an HTTP handler or a client Worker API.
 * A server-authenticated resolver binds a session to the Game's real player.
 *
 * The private memory map is deliberate: production persistence/encryption and
 * authenticated HTTP routing must be supplied by the trusted host. No raw
 * snapshot, private politics, troop state or intelligence is returned here.
 */
import { createHash, randomUUID } from "node:crypto";
import type { ClientID } from "@openfront/engine-api/Schemas";
import type { PlayerID } from "@openfront/engine-api/game/GameTypes";
/**
 * A minimal structural port: the trusted host injects the engine snapshot
 * callback. The server layer MUST NOT import engine internals directly.
 */
export interface TrustedHostGamePort {
  config(): { nationalMode(): boolean };
  playerByClientID(clientID: ClientID): { id(): PlayerID } | undefined;
  ticks(): number;
}

export interface AuthenticatedNationalOwner {
  /** Verified by the host account/session middleware, never packet content. */
  readonly accountId: string;
  /** Bound to this game's actual PlayerInfo by the host's roster. */
  readonly playerId: PlayerID;
  readonly clientID: ClientID;
}

export interface PrivateNationalSaveHandle {
  readonly id: string;
  readonly gameID: string;
  readonly tick: number;
}

interface StoredNationalGame {
  readonly gameID: string;
  readonly ownerAccountId: string;
  readonly ownerPlayerId: PlayerID;
  readonly ownerClientID: ClientID;
  readonly tick: number;
  readonly digest: string;
  /** Full private simulation; NEVER expose this as a download or API body. */
  readonly bytes: Uint8Array;
}

/**
 * The resolver must obtain identity from a validated server session and
 * roster, not from request JSON or a caller-selected player ID.
 */
export class TrustedNationalSaveStore<GameType extends TrustedHostGamePort> {
  private readonly saves = new Map<string, StoredNationalGame>();

  constructor(
    private readonly resolveSession: (
      session: unknown,
      gameID: string,
    ) => AuthenticatedNationalOwner | null,
    /** Host-provided canonical capture, invoked only inside trusted runtime. */
    private readonly snapshotOnHost: (
      game: GameType,
      gameID: string,
    ) => Uint8Array,
    private readonly perOwnerLimit = 8,
  ) {
    if (!Number.isSafeInteger(perOwnerLimit) || perOwnerLimit < 1) {
      throw new Error("NATIONAL host save: invalid per-owner quota");
    }
  }

  private authorize(
    session: unknown,
    gameID: string,
    game: GameType,
  ): AuthenticatedNationalOwner {
    if (!game.config().nationalMode()) {
      throw new Error("NATIONAL host save: legacy game not permitted");
    }
    const principal = this.resolveSession(session, gameID);
    if (
      principal === null ||
      typeof principal.accountId !== "string" ||
      principal.accountId.length === 0 ||
      typeof principal.playerId !== "string" ||
      principal.playerId.length === 0 ||
      game.playerByClientID(principal.clientID)?.id() !== principal.playerId
    ) {
      throw new Error("NATIONAL host save: unauthorized principal");
    }
    return principal;
  }

  /** Called by a trusted host at a completed simulation tick boundary. */
  save(
    gameID: string,
    session: unknown,
    game: GameType,
  ): PrivateNationalSaveHandle {
    const principal = this.authorize(session, gameID, game);
    const count = [...this.saves.values()].filter(
      (stored) =>
        stored.ownerAccountId === principal.accountId &&
        stored.ownerPlayerId === principal.playerId,
    ).length;
    if (count >= this.perOwnerLimit) {
      throw new Error("NATIONAL host save: owner quota exceeded");
    }
    const bytes = this.snapshotOnHost(game, gameID);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const id = randomUUID();
    this.saves.set(id, {
      gameID,
      ownerAccountId: principal.accountId,
      ownerPlayerId: principal.playerId,
      ownerClientID: principal.clientID,
      tick: game.ticks(),
      digest,
      bytes: bytes.slice(),
    });
    return { id, gameID, tick: game.ticks() };
  }

  /**
   * Only the trusted host receives a restored Game instance. The callback
   * loads fresh maps/config and validates the GameSnapshot. Never route the
   * callback result, the saved bytes, or a public save URL to a browser.
   */
  async restore(
    handleId: string,
    session: unknown,
    restoreGameOnHost: (bytes: Uint8Array) => Promise<GameType>,
  ): Promise<GameType> {
    const record = this.saves.get(handleId);
    if (!record) throw new Error("NATIONAL host save: not found");
    const principal = this.resolveSession(session, record.gameID);
    if (
      !principal ||
      principal.accountId !== record.ownerAccountId ||
      principal.playerId !== record.ownerPlayerId ||
      principal.clientID !== record.ownerClientID
    ) {
      throw new Error("NATIONAL host save: unauthorized principal");
    }
    if (
      createHash("sha256").update(record.bytes).digest("hex") !== record.digest
    ) {
      throw new Error("NATIONAL host save: snapshot integrity failure");
    }
    const game = await restoreGameOnHost(record.bytes.slice());
    this.authorize(session, record.gameID, game);
    if (game.ticks() !== record.tick) {
      throw new Error("NATIONAL host save: restored tick mismatch");
    }
    return game;
  }

  delete(handleId: string, session: unknown): void {
    const record = this.saves.get(handleId);
    if (!record) throw new Error("NATIONAL host save: not found");
    const principal = this.resolveSession(session, record.gameID);
    if (
      !principal ||
      principal.accountId !== record.ownerAccountId ||
      principal.playerId !== record.ownerPlayerId ||
      principal.clientID !== record.ownerClientID
    ) {
      throw new Error("NATIONAL host save: unauthorized principal");
    }
    this.saves.delete(handleId);
  }
}
