import {
  GameMode,
  GameType,
  HumansVsNations,
  PlayerInfo,
  PlayerType,
  RankedType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { maps } from "@openfront/engine-api/game/Maps.gen";
import {
  AllPlayersStats,
  ClientID,
  GameConfig,
  GameConfigPatch,
  GameID,
  Intent,
  StampedIntent,
  TeamCountConfig,
  Tribe,
  Turn,
  Winner,
} from "@openfront/engine-api/Schemas";
import {
  adjustForTeams,
  assignTeamsLobbyPreview,
  resolveTeamsList,
} from "@openfront/engine-lib/game/TeamAssignment";
import {
  createTrustedNationalGameRunner,
  createTrustedNationalGameRunnerFromSnapshot,
  type GameRunner,
} from "@openfront/engine/WinnerReplay";
import { isAdminRole, type TokenPayload } from "@openfront/shared/ApiSchemas";
import { CloseCode, CloseReason } from "@openfront/shared/CloseCodes";
import { GameEnv } from "@openfront/shared/configuration/Env";
import { createPartialGameRecord } from "@openfront/shared/SharedUtil";
import {
  ClientMessage,
  ClientReportMessage,
  ClientSendLiveStatsMessage,
  ClientSendWinnerMessage,
  GameInfo,
  LobbyAccent,
  PartialGameRecord,
  PlayerLiveStats,
  PlayerRecord,
  PlayerReport,
  PublicGameType,
  ServerDesyncSchema,
  ServerErrorMessage,
  ServerLobbyInfoMessage,
  ServerNewLobbyMessage,
  ServerPongMessage,
  ServerPrestartMessageSchema,
  ServerRedirectMessage,
  ServerStartGameMessage,
  ServerTurnMessage,
  ServerNationalStartMessage,
  ServerNationalProjectionMessage,
  WireGameStartInfo,
  WireGameStartInfoSchema,
} from "@openfront/shared/WireSchemas";
import {
  createGameWireContext,
  encodeServerMessage,
} from "@openfront/shared/ZbinWire";
import { ZbContext } from "@openfront/zbin";
import { createHash, randomBytes } from "crypto";
import ipAnonymize from "ip-anonymize";
import { Logger } from "winston";
import WebSocket from "ws";
import { z } from "zod";
import { archive, finalizeGameRecord } from "./Archive";
import { Client } from "./Client";
import { applyGameConfigPatch, hostCheatsEnabled } from "./ConfigPatch";
import { LiveStatsVote, voteKey, WinnerVote } from "./Consensus";
import { fetchCustomTribes } from "./CustomTribes";
import { DesyncDetector } from "./DesyncDetector";
import { Gatekeeper, MatchGatekeeper, noopGatekeeper } from "./Gatekeeper";
import {
  authorizeIntent,
  IntentActor,
  IntentOutcome,
} from "./IntentAuthorization";
import { ListingState } from "./ListingState";
import { friendsLookup, NameVisibility } from "./NameVisibility";
import {
  DurableNationalCheckpoint,
  nationalMapDigest,
} from "./national/DurableNationalCheckpoint";
import type { DurableNationalStore } from "./national/DurableNationalStore";
import { isNationalSignedInAccount } from "./national/NationalAccountGate";
import { encodeNationalRecipientProjection } from "./national/NationalRecipientWire";
import { loadTrustedNationalMapFiles } from "./national/TrustedNationalMapFiles";
import { TrustedNationalMatch } from "./national/TrustedNationalMatch";
import { poolTargetFor } from "./PoolRouting";
import { Roster } from "./Roster";
import { ServerEnv } from "./ServerEnv";
import { SocketIngress } from "./SocketIngress";
import {
  LONE_VOTER_REPLAY_CAP,
  replayWinnerInChild,
  winnerReplayMetrics,
  type WinnerReplayer,
} from "./WinnerReplay";

// Outcome of GameServer.joinClient. The worker maps each to a close code.
// A non-spectator join landing this soon after start() is someone who meant
// to play and missed it; after this they are taken to have come to watch.
const LATE_JOIN_GRACE_MS = 5_000;

export type JoinResult =
  | "joined"
  | "kicked"
  | "rejected"
  | "ended"
  | "not_allowlisted"
  | "not_trusted"
  | "started"
  // Not a refusal: the client was told which sibling lobby to go to instead.
  | "redirected";

export enum GamePhase {
  Lobby = "LOBBY",
  Active = "ACTIVE",
  Finished = "FINISHED",
}

// Identity + authority for an intent, supplied by whoever dispatched it: a
// per-connection websocket client, or the trusted admin-bot HTTP API.
export function hashPersistentID(persistentID: string): string {
  return createHash("sha256").update(persistentID).digest("hex");
}

// `pool` carries sibling lobby ids, which are join secrets. Strip it from every
// config that leaves the server — the client start message + game
// record, and the unauthenticated gameInfo route — in one place, so a new
// export site can't forget.
function configWithoutPool(config: GameConfig): GameConfig {
  const copy = { ...config };
  delete copy.pool;
  return copy;
}

// Sibling lobby IDs and account publicId lists are server-internal secrets.
// Strip them from every config that leaves the server to clients or public
// routes (the start message, archived game record, lobby broadcast, and /api/game/:id).
function sanitizeConfigForWire(config: GameConfig): GameConfig {
  const copy = configWithoutPool(config);
  delete copy.allowedPublicIds;
  delete copy.nameRevealPublicIds;
  return copy;
}

const KICK_REASON_DUPLICATE_SESSION = "kick_reason.duplicate_session";
const KICK_REASON_LOBBY_CREATOR = "kick_reason.lobby_creator";
const KICK_REASON_ADMIN = "kick_reason.admin";
const KICK_REASON_HOST_LEFT = "kick_reason.host_left";
const KICK_REASON_MATCH_CANCELLED = "kick_reason.match_cancelled";

export interface GameServerOptions {
  id: string;
  log: Logger;
  createdAt: number;
  gameConfig: GameConfig;
  creatorPersistentID?: string;
  startsAt?: number;
  publicGameType?: PublicGameType;
  // Matchmade team split from the matchmaking assignment: publicIds per
  // team. At start each client is stamped with its team's index.
  matchmakingTeams?: string[][];
  // Clan wars: the clan each matchmade team plays for, in team order.
  matchmakingClanTags?: string[];
}

// Everything a GameServer reaches outside itself for. Production takes the
// defaults; tests substitute the pieces they need to observe or control
// (the archive upload, the tribe fetch, the environment) without mocking
// modules. env and turnIntervalMs are thunks so the value is read when it
// is used, not when the game is created.
/** Reconnect identity freshly verified from the signed JWT and /users/@me. */
export interface NationalReconnectPrincipal {
  readonly subject: string;
  readonly publicId: string;
  /** Freshly verified Worker JWT claims, including current effective role. */
  readonly claims?: TokenPayload;
}

export interface GameServerDeps {
  // Hand a finished game's record on for upload. The default stamps the
  // deployment (finalizeGameRecord) first; a test receives the record as the
  // game built it.
  archive: (record: PartialGameRecord) => Promise<void>;
  // Replays the game to settle a disputed winner vote (see settleWinner).
  replayWinner: WinnerReplayer;
  // Replays waiting or running on this worker, against LONE_VOTER_REPLAY_CAP.
  replayPending: () => number;
  fetchTribes: typeof fetchCustomTribes;
  env: () => GameEnv;
  turnIntervalMs: () => number;
  gatekeeper: Gatekeeper;
  // This game's opaque grouping token (see mintGroupToken). Injectable only
  // so a test can pin a value it can assert on; production always takes the
  // random default.
  mintGroupToken: () => string;
  /** Injected in tests; in production this creates the ONE trusted GameRunner. */
  createNationalRunner: (info: WireGameStartInfo) => Promise<GameRunner>;
  durableNationalStore?: DurableNationalStore;
}

// 16 URL-safe characters of CSPRNG output — 12 bytes is exactly 16 base64url
// characters, so there is no padding to strip and no truncation to reason
// about. Deliberately NOT a hash or any other function of the game id: the id
// is a private lobby's join secret, and anything derived from it hands a
// holder of the token a head start on the id.
function mintGroupToken(): string {
  return randomBytes(12).toString("base64url");
}

function defaultGameServerDeps(): GameServerDeps {
  return {
    archive: (record) => archive(finalizeGameRecord(record)),
    replayWinner: replayWinnerInChild,
    replayPending: () => winnerReplayMetrics.pending,
    fetchTribes: fetchCustomTribes,
    env: () => ServerEnv.env(),
    turnIntervalMs: () => ServerEnv.turnIntervalMs(),
    gatekeeper: noopGatekeeper,
    mintGroupToken,
    createNationalRunner: async (info) =>
      createTrustedNationalGameRunner(
        info,
        await loadTrustedNationalMapFiles(
          info.config.gameMap,
          info.config.gameMapSize,
        ),
      ),
  };
}

export class GameServer {
  // Compares the per-turn state hashes clients report; a disagreeing client
  // is told once and its votes are ignored from then on.
  private readonly desync = new DesyncDetector();

  // Socket listeners and the decode / validate / rate-limit / spectator-block
  // pipeline every frame goes through before handleClientMessage.
  private readonly ingress: SocketIngress;

  private maxGameDuration = 3 * 60 * 60 * 1000; // 3 hours

  private disconnectedTimeout = 1 * 30 * 1000; // 30 seconds

  // Backstop for reaping a started game nobody is connected to. The usual
  // reap (see phase()) also needs the game-wide ping clock to go quiet; this
  // one goes on the roster being empty and nothing else.
  private emptyGameTimeout = 10 * 60 * 1000; // 10 minutes
  private emptySince: number | null = null;

  private turns: Turn[] = [];
  private intents: StampedIntent[] = [];
  private nationalMatch: TrustedNationalMatch | null = null;
  private nationalStarting = false;
  private nationalFaulted = false;
  private nationalRecoveryDeadline: number | null = null;
  // Who joined, who is connected, and the per-account reconnect, admission
  // and kick flags (see Roster.ts). The join policy stays here.
  private readonly clients = new Roster();
  // The lobby -> prestart -> started progression. `ended` is orthogonal to
  // it: a lobby can end without ever starting (host left, match cancelled),
  // and a started game is still a started game once it has ended — end()
  // archives on that, and the socket close events that follow end() still
  // go through hasStarted() in handleClientDisconnect.
  private stage: "lobby" | "prestart" | "started" = "lobby";
  // Set when the delayed start found an empty roster (see deferStart).
  private startDeferred = false;
  private ended = false;
  private paused = false;
  private _startTime: number | null = null;
  private hasReachedMaxPlayerCount: boolean = false;

  private endTurnIntervalID: ReturnType<typeof setInterval> | undefined;

  private lastPingUpdate = 0;

  // Note: This can be undefined if accessed before the game starts.
  private gameStartInfo!: WireGameStartInfo;
  // Wire-only copy of gameStartInfo sent to clients. Identical to
  // gameStartInfo unless disableClanTags is set, in which case clan tags
  // are stripped from players. Archive uses the original gameStartInfo.
  private wireGameStartInfo!: WireGameStartInfo;

  // clientID dictionary for the binary wire, seeded from gameStartInfo.players
  // at start (clients seed theirs from the same array in the start message).
  // Undefined until the game starts, which is also the last moment either peer
  // can send a dictionary-encoded field.
  private zbinCtx: ZbContext | undefined;

  private log: Logger;

  // Purchased bot tribe names drawn for this game, set when the prestart
  // fetch lands (undefined until then / on fetch failure / non-public games).
  private tribes?: Tribe[];

  // The end-of-game winner vote and the running live-stats vote: both
  // IP-weighted majorities among the players (see Consensus.ts).
  private readonly winnerVote = new WinnerVote();
  private readonly liveStatsVote = new LiveStatsVote();

  // Player reports filed this game, keyed "<reportedBy>:<reported>" so each
  // pair counts once. Never in the turn log (who reported whom is staff-only);
  // emitted as info.reports of the archived record (see handleReport).
  private readonly reports = new Map<string, PlayerReport>();

  // This private lobby's presence in the public lobby browser (see
  // ListingState.ts).
  private readonly listing = new ListingState();

  // A pool member other than the entry is never listed, so it has no listing
  // deadline of its own and takes the entry's; otherwise nothing starts it.
  private poolAutoStartAt?: number;

  private lobbyInfoIntervalId: ReturnType<typeof setInterval> | null = null;

  private visibleAt?: number;

  // The successor lobby this game has already spawned, if any. Kept so a
  // repeated create_game?previous= call (e.g. a double click) reuses the same
  // id instead of minting another lobby.
  private successorLobbyId: GameID | null = null;

  // This match's security hooks (see Gatekeeper.ts).
  private readonly gatekeeper: MatchGatekeeper;

  // Opaque per-game grouping token, minted once here and sent to every
  // participant (see mintGroupToken and the GroupToken comment in Schemas).
  // Private, and it stays private: nothing reads it back off the wire, no
  // route returns it, and it must never reach a log line or an error message
  // — a token in a log is a token in whatever the log is shipped to.
  private readonly groupToken: string;

  public readonly id: string;
  public readonly createdAt: number;
  public gameConfig: GameConfig;
  private creatorPersistentID?: string;
  private startsAt?: number;
  private publicGameType?: PublicGameType;
  // Matchmade team split from the matchmaking assignment: publicIds per
  // team. At start each client is stamped with its team's index.
  private matchmakingTeams?: string[][];
  private matchmakingClanTags?: string[];
  private readonly deps: GameServerDeps;
  // Who may see whose real identity (anonymizeNames / pinned teams / admin
  // clan-tag reveal); shapes the per-viewer lobby roster and start message.
  private readonly names: NameVisibility;

  constructor(opts: GameServerOptions, deps: Partial<GameServerDeps> = {}) {
    this.id = opts.id;
    this.createdAt = opts.createdAt;
    this.gameConfig = opts.gameConfig;
    this.creatorPersistentID = opts.creatorPersistentID;
    this.startsAt = opts.startsAt;
    this.publicGameType = opts.publicGameType;
    this.matchmakingTeams = opts.matchmakingTeams;
    this.matchmakingClanTags = opts.matchmakingClanTags;
    this.deps = { ...defaultGameServerDeps(), ...deps };
    this.groupToken = this.deps.mintGroupToken();
    this.gatekeeper = this.deps.gatekeeper.matchOpened({ gameID: opts.id });
    this.names = new NameVisibility({
      gameID: opts.id,
      config: () => this.gameConfig,
      clients: () => this.clients.all(),
      teamIndex: (c) => this.matchmakingTeamIndex(c),
    });
    this.log = opts.log.child({ gameID: opts.id });
    this.ingress = new SocketIngress(
      this.log,
      {
        zbinCtx: () => this.zbinCtx,
        serverTick: () => this.turns.length,
        onMessage: (client, msg) => this.handleClientMessage(client, msg),
        onClose: (client) => this.handleClientDisconnect(client),
        kick: (clientID, reasonKey) => this.kickClient(clientID, reasonKey),
      },
      undefined,
      this.gatekeeper,
    );
    if (opts.startsAt !== undefined && this.isPublic()) {
      this.visibleAt = Date.now();
    }
  }

  private get lobbyCreatorID(): ClientID | undefined {
    return this.creatorPersistentID
      ? this.clients.byPersistentId(this.creatorPersistentID)?.clientID
      : undefined;
  }

  public updateGameConfig(gameConfig: GameConfigPatch): void {
    applyGameConfigPatch(this.gameConfig, gameConfig);
    // A lowered cap (the admin bot can set one) may already be met; without
    // this the lobby would wait for the next join to notice it is full.
    this.markFullIfAutoStarting();
  }

  // Filling up starts host-less games (public, matchmade, admin bot) and
  // listed lobbies. An unlisted lobby's player limit only turns players
  // away: its host still starts it.
  private markFullIfAutoStarting(): void {
    if (
      (this.creatorPersistentID === undefined || this.isListed()) &&
      this.playerCount() >= (this.gameConfig.maxPlayers ?? Infinity)
    ) {
      this.hasReachedMaxPlayerCount = true;
    }
  }

  // Dispatch a control/gameplay intent from either a websocket client or the
  // trusted admin-bot HTTP API. `actor` carries the authority; the guards are
  // authorizeIntent, the per-intent actions live here. Returns an HTTP-style
  // outcome the caller maps (the bot route -> response, the websocket path ->
  // a log).
  public handleIntent(intent: Intent, actor: IntentActor): IntentOutcome {
    const serverTick = this.turns.length;
    const stamped: StampedIntent = { ...intent, clientID: actor.clientID };
    const finish = (
      outcome: IntentOutcome,
      acceptedReasonCode?: string,
    ): IntentOutcome => {
      if (!actor.isAdminBot) {
        const client = this.clients.get(actor.clientID);
        if (client !== undefined) {
          const accepted = outcome.status === 200;
          this.gatekeeper.intentObserved({
            client,
            intent: stamped,
            intentType: stamped.type,
            outcome: accepted ? "accepted" : "rejected",
            turn: serverTick,
            reasonCode: accepted ? acceptedReasonCode : String(outcome.status),
          });
        }
      }
      return outcome;
    };

    const denied = authorizeIntent(intent, actor, {
      isPublic: this.isPublic(),
      isListed: this.isListed(),
      isQueued: this.listing.isQueued(),
      hasStarted: this.hasStarted(),
    });
    if (denied !== null) {
      return finish(denied);
    }

    if (
      this.gameConfig.nationalMode === true &&
      this.nationalMatch === null &&
      this.hasStarted()
    ) {
      // Prestart is not trusted execution. No player or host can make the
      // legacy queue flush while the protected map/roster is loading.
      return finish({
        status: 409,
        error: "NATIONAL trusted runner not ready",
      });
    }

    if (this.nationalMatch !== null) {
      // The authenticated websocket path supplies a roster Client. An
      // admin-bot cannot inject engine actions or host session authority.
      if (actor.isAdminBot) {
        return finish({
          status: 403,
          error: "NATIONAL requires human session",
        });
      }
      if (this.ended)
        return finish({ status: 409, error: "NATIONAL match ended" });
      if (stamped.type === "toggle_pause") {
        try {
          this.nationalMatch.setPaused(stamped.paused);
          this.paused = stamped.paused;
          return finish({ status: 200 });
        } catch {
          this.failTrustedNational();
          return finish({
            status: 503,
            error: "NATIONAL durable commit failed",
          });
        }
      }
      if (
        stamped.type === "update_game_config" ||
        stamped.type === "toggle_game_start_timer"
      ) {
        return finish({ status: 409, error: "NATIONAL match already started" });
      }
      if (stamped.type !== "kick_player") {
        const client = this.clients.get(actor.clientID);
        if (
          client === undefined ||
          !this.clients.isConnected(client) ||
          client.ws.readyState !== WebSocket.OPEN
        ) {
          return finish({
            status: 403,
            error: "NATIONAL session disconnected",
          });
        }
        try {
          return finish(
            this.nationalMatch.submit(client, intent)
              ? { status: 200 }
              : { status: 403, error: "NATIONAL action rejected" },
          );
        } catch {
          this.failTrustedNational();
          return finish({
            status: 503,
            error: "NATIONAL durable commit failed",
          });
        }
      }
    }

    switch (stamped.type) {
      case "kick_player": {
        // Resolve the target to a clientID: an explicit clientID, or an account
        // publicId matched against everyone who ever joined (a superset of the
        // connected that retains disconnected players), so a disconnected
        // account can still be kicked — its persistentID is banned, blocking
        // rejoin/reconnect.
        let target = stamped.targetClientID;
        if (target === undefined && stamped.targetPublicID !== undefined) {
          target = [...this.clients.all().values()].find(
            (c) => c.publicId === stamped.targetPublicID,
          )?.clientID;
        }
        if (target === undefined) {
          return finish({ status: 404, error: "no matching player to kick" });
        }
        if (stamped.clientID === target) {
          return finish({ status: 400, error: "cannot kick yourself" });
        }
        const reason =
          actor.isAdmin && !actor.isLobbyCreator
            ? KICK_REASON_ADMIN
            : KICK_REASON_LOBBY_CREATOR;
        this.log.info("player kicked", {
          kicker: stamped.clientID,
          target,
          isAdmin: actor.isAdmin,
          isAdminBot: actor.isAdminBot,
          gameID: this.id,
        });
        this.kickClient(target, reason);
        return finish(
          this.nationalFaulted
            ? { status: 503, error: "NATIONAL durable commit failed" }
            : { status: 200 },
        );
      }

      case "update_game_config": {
        // A private lobby may opt in only while every seated human carries
        // API-backed signed account authority. No in-place guest promotion.
        const national =
          stamped.config.nationalMode ?? this.gameConfig.nationalMode === true;
        if (national) {
          const mode = stamped.config.gameMode ?? this.gameConfig.gameMode;
          const players = this.clients.players();
          if (
            new Set(players.map((c) => c.publicId)).size !== players.length ||
            new Set(players.map((c) => c.persistentID)).size !==
              players.length ||
            this.isPublic() ||
            this.isListed() ||
            mode !== GameMode.FFA ||
            this.gameConfig.tutorial === true ||
            this.clients
              .players()
              .some(
                (c) =>
                  !isNationalSignedInAccount(c.claims) ||
                  !c.publicId ||
                  c.claims?.sub !== c.persistentID,
              )
          ) {
            return finish({
              status: 403,
              error: "NATIONAL requires signed-in private FFA seats",
            });
          }
        }
        this.updateGameConfig(stamped.config);
        return finish({ status: 200 });
      }

      case "toggle_game_start_timer": {
        if (this.startsAt) {
          this.startsAt = undefined;
        } else {
          this.setStartsAt(
            Date.now() + (this.gameConfig.startDelay ?? 0) * 1000,
          );
        }
        return finish({ status: 200 });
      }

      case "toggle_pause": {
        const outcome = finish({ status: 200 });
        // Pausing: flush the intent into a turn before isPaused short-circuits
        // endTurn(). Unpausing: clear the flag first so the next turn runs.
        if (stamped.paused) {
          this.addIntent(stamped);
          this.endTurn();
          this.paused = true;
        } else {
          this.paused = false;
          this.addIntent(stamped);
          this.endTurn();
        }
        return outcome;
      }

      default: {
        // Gameplay intents, into the turn queue.
        // While paused the intent is accepted at ingress but not queued into a
        // turn; tag it so the gatekeeper can tell it apart from a queued intent.
        const paused = this.paused;
        const outcome = finish({ status: 200 }, paused ? "paused" : undefined);
        if (!paused) this.addIntent(stamped);
        return outcome;
      }
    }
  }

  private isKicked(clientID: ClientID): boolean {
    const persistentID = this.clients.get(clientID)?.persistentID;
    return persistentID !== undefined && this.clients.isKicked(persistentID);
  }

  // Get existing clientID for this persistentID, or null if new player
  public getClientIdForPersistentId(persistentID: string): ClientID | null {
    if (this.clients.isKicked(persistentID)) return null;
    return this.clients.byPersistentId(persistentID)?.clientID ?? null;
  }

  // Whether this persistentID has already been admitted (passed Turnstile and
  // other join authorization) for this game. Used to skip the single-use
  // Turnstile re-check when an already-admitted player reconnects. Kicked
  // players are excluded so a kick still forces them back through the gate.
  public wasAdmitted(persistentID: string): boolean {
    return this.clients.wasAdmitted(persistentID);
  }

  public markAdmitted(persistentID: string, attemptID?: string): void {
    this.clients.markAdmitted(persistentID, attemptID);
  }

  public unmarkAdmitted(persistentID: string, attemptID?: string): void {
    this.clients.unmarkAdmitted(persistentID, attemptID);
  }

  public hasEverBeenSeated(persistentID: string): boolean {
    return this.clients.hasEverBeenSeated(persistentID);
  }

  // Screened identity stored for this player's client record, or null if
  // the record (or its reconnect mapping) is gone. Lets the join path skip
  // re-screening a reconnect whose submitted identity is unchanged.
  public storedIdentity(
    persistentID: string,
  ): { username: string; clanTag: string | null } | null {
    const clientID = this.getClientIdForPersistentId(persistentID);
    if (clientID === null) return null;
    const client = this.clients.get(clientID);
    if (client === undefined) return null;
    return { username: client.username, clanTag: client.clanTag };
  }

  // Worker account lease callbacks must refer to the exact physical socket,
  // not merely a persistent ID (which can reconnect while an API call awaits).
  public nationalAccountSocket(
    persistentID: string,
    ws: WebSocket,
  ): string | null {
    const clientID = this.getClientIdForPersistentId(persistentID);
    const client = clientID ? this.clients.get(clientID) : undefined;
    return client &&
      client.ws === ws &&
      this.clients.isConnected(client) &&
      ws.readyState === WebSocket.OPEN
      ? (client.publicId ?? null)
      : null;
  }

  public revokeNationalAccountSocket(
    persistentID: string,
    ws: WebSocket,
    code: CloseCode,
    reason: CloseReason,
  ): void {
    if (
      this.gameConfig.nationalMode !== true ||
      this.nationalAccountSocket(persistentID, ws) === null
    )
      return;
    const clientID = this.getClientIdForPersistentId(persistentID);
    const client = clientID ? this.clients.get(clientID) : undefined;
    if (!client) return;
    // Disconnect now, not when the untrusted peer acknowledges CLOSE:
    // cancel all queued recipient-bound commands before the next tick.
    this.handleClientDisconnect(client);
    ws.close(code, reason);
    this.log.info("NATIONAL account lease ended", { gameID: this.id, code });
  }

  public joinClient(client: Client): JoinResult {
    // e.g. the host left an unstarted lobby and GameManager hasn't pruned
    // it yet. Distinct from "rejected" so the worker does not tell a player
    // arriving after the end that the lobby is full.
    if (this.ended) {
      return "ended";
    }
    if (this.clients.isKicked(client.persistentID)) {
      return "kicked";
    }
    if (
      this.gameConfig.nationalMode === true &&
      (!isNationalSignedInAccount(client.claims) ||
        client.claims?.sub !== client.persistentID ||
        !client.publicId)
    ) {
      return "not_trusted";
    }
    // A separately signed login may still refer to the same provider-linked
    // account row. Reject the alias before it can sabotage the starting roster.
    if (this.gameConfig.nationalMode === true) {
      // An async Worker account lookup can race another admission. Resolve
      // the same subject against the already-seated principal atomically here.
      const existingID = this.getClientIdForPersistentId(client.persistentID);
      if (existingID !== null) {
        const existing = this.clients.get(existingID);
        if (
          !existing ||
          existing.spectator ||
          client.spectator ||
          existing.publicId !== client.publicId ||
          !client.claims
        ) {
          return "not_trusted";
        }
        return this.rejoinClient(client.ws, client.persistentID, 0, undefined, {
          subject: client.claims.sub,
          publicId: client.publicId!,
          claims: client.claims,
        })
          ? "joined"
          : "not_trusted";
      }
      const occupiedByAnotherPrincipal = this.clients
        .players()
        .some(
          (seated) =>
            seated.publicId === client.publicId &&
            seated.persistentID !== client.persistentID,
        );
      if (occupiedByAnotherPrincipal) return "not_trusted";
    }

    // OFM: if an allowlist is set, only those publicIds may join. Re-checked on
    // every join attempt. Admins/root bypass it so moderation can reach any
    // private lobby; a kick still applies (checked above).
    if (!this.passesAllowlist(client)) {
      this.log.warn("client not on allowlist, rejecting", {
        clientID: client.clientID,
      });
      return "not_allowlisted";
    }

    if (!this.passesTrustGate(client)) {
      this.log.warn("client not trusted, rejecting", {
        clientID: client.clientID,
      });
      return "not_trusted";
    }

    // Being routed is not a refusal, so it must not consume the "full" or
    // "started" answer that belongs to the lobby they end up on.
    const redirect = this.poolRedirectFor(client);
    if (redirect !== null) {
      this.log.info("assigning client to pool sibling", {
        clientID: client.clientID,
        target: redirect,
      });
      client.ws.send(
        encodeServerMessage(
          {
            type: "redirect",
            gameID: redirect,
          } satisfies ServerRedirectMessage,
          this.zbinCtx,
        ),
      );
      return "redirected";
    }

    // gameStartInfo.players is frozen at start, so a late arrival could never
    // spawn. An admitted player reconnecting through the join path keeps
    // their seat. A player whose join lands just after the start meant to
    // play (a last-second click on the lobby), so they are told they missed
    // it rather than dropped into a game they cannot play. Anyone later
    // came to watch (a shared link) and joins as a spectator.
    if (this.stage === "started") {
      if (
        this.rejoinClient(
          client.ws,
          client.persistentID,
          0,
          undefined,
          this.gameConfig.nationalMode === true && client.claims?.sub
            ? {
                subject: client.claims.sub,
                publicId: client.publicId ?? "",
              }
            : undefined,
        )
      ) {
        return "joined";
      }
      // No late NATIONAL player or spectator may acquire a seat after the
      // authoritative engine was created. A new player would require a
      // second, conflicting GameRunner roster.
      if (this.nationalMatch !== null) {
        return "started";
      }
      if (
        !client.spectator &&
        Date.now() - (this._startTime ?? 0) < LATE_JOIN_GRACE_MS
      ) {
        this.log.info("cannot add client, game just started", {
          clientID: client.clientID,
        });
        client.ws.send(
          encodeServerMessage(
            {
              type: "error",
              error: "game-started",
            } satisfies ServerErrorMessage,
            this.zbinCtx,
          ),
        );
        return "started";
      }
      client.spectator = true;
    }

    if (this.nationalStarting) return "started";

    // Spectators take no slot: they never spawn, so a full lobby is still
    // watchable and a caster can never displace a player.
    if (
      !client.spectator &&
      this.gameConfig.maxPlayers &&
      this.playerCount() >= this.gameConfig.maxPlayers
    ) {
      this.log.debug(`cannot add client, game full`, {
        clientID: client.clientID,
      });

      client.ws.send(
        encodeServerMessage(
          {
            type: "error",
            error: "full-lobby",
          } satisfies ServerErrorMessage,
          this.zbinCtx,
        ),
      );
      return "rejected";
    }

    this.log.info("client joining game", {
      clientID: client.clientID,
      persistentID: client.persistentID,
      clientIP: ipAnonymize(client.ip),
    });

    // Skipped in dev: local testing (multi-tab, the matchmaking e2e) is
    // inherently same-IP.
    if (
      this.deps.env() !== GameEnv.Dev &&
      this.gameConfig.gameType === GameType.Public &&
      this.clients
        .active()
        .filter((c) => c.ip === client.ip && c.clientID !== client.clientID)
        .length >= 3
    ) {
      this.log.warn("cannot add client, already have 3 ips", {
        clientID: client.clientID,
        clientIP: ipAnonymize(client.ip),
      });
      return "rejected";
    }

    if (this.deps.env() === GameEnv.Prod) {
      // Prevent multiple clients from using the same account in prod
      const conflicting = this.clients
        .active()
        .find(
          (c) =>
            c.persistentID === client.persistentID &&
            c.clientID !== client.clientID,
        );
      if (conflicting !== undefined) {
        this.log.warn("client ids do not match", {
          clientID: client.clientID,
          clientIP: ipAnonymize(client.ip),
          clientPersistentID: client.persistentID,
          existingIP: ipAnonymize(conflicting.ip),
          existingPersistentID: conflicting.persistentID,
        });
        // Evict the conflicting socket without permanently banning the persistentID
        if (conflicting.ws.readyState === WebSocket.OPEN) {
          conflicting.ws.send(
            encodeServerMessage(
              {
                type: "error",
                error: KICK_REASON_DUPLICATE_SESSION,
              } satisfies ServerErrorMessage,
              this.zbinCtx,
            ),
          );
        }
        conflicting.ws.removeAllListeners();
        conflicting.ws.close(CloseCode.Normal, KICK_REASON_DUPLICATE_SESSION);
        this.clients.markLeft(conflicting);
      }
    }

    // Client connection accepted. Added before the first
    // markClientDisconnected: that call consults the roster to tell a
    // spectator from a player.
    this.clients.add(client);
    client.lastPing = Date.now();
    this.markClientDisconnected(client.clientID, false);
    this.gatekeeper.clientJoined(client);
    this.ingress.attach(client);
    this.startLobbyInfoBroadcast();

    this.markFullIfAutoStarting();

    // A spectator arriving mid-game missed the start message.
    if (this.stage === "started") {
      this.sendStartGameMsg(client.ws, 0);
    }

    return "joined";
  }

  // Attempt to reconnect a client by persistentID. Returns true if successful.
  // WebSocket is always updated. Identity updates — already screened by the
  // caller (join_verify, or the local fallback censor) — are applied only
  // before the game has started.
  public rejoinClient(
    ws: WebSocket,
    persistentID: string,
    lastTurn: number = 0,
    identityUpdate?: { username: string; clanTag: string | null },
    nationalPrincipal?: NationalReconnectPrincipal,
  ): boolean {
    // As in joinClient: an ended game may still be in GameManager until its
    // next tick, and the roster still holds the reconnect mapping.
    if (this.ended) return false;
    const clientID = this.getClientIdForPersistentId(persistentID);
    if (!clientID) return false;
    const client = this.clients.get(clientID);
    if (!client) return false;
    // A matching persistentID alone is NOT sufficient. For the authoritative
    // NATIONAL seat the Worker must freshly verify the token subject and
    // /users/@me publicId before replacing any socket or E3 recipient cursor.
    // Rejected attempts must not close or displace the legitimate owner.
    if (
      this.gameConfig.nationalMode === true &&
      (!nationalPrincipal ||
        nationalPrincipal.subject !== persistentID ||
        nationalPrincipal.publicId !== client.publicId ||
        !client.publicId ||
        client.spectator ||
        this.clients.isKicked(persistentID) ||
        (this.deps.durableNationalStore !== undefined &&
          !nationalPrincipal.claims) ||
        (client.claims !== null && !isNationalSignedInAccount(client.claims)) ||
        (client.claims === null && !nationalPrincipal.claims) ||
        (nationalPrincipal.claims !== undefined &&
          (!isNationalSignedInAccount(nationalPrincipal.claims) ||
            nationalPrincipal.claims.sub !== persistentID)))
    )
      return false;

    // An API-reverified reconnect must not retain a revoked elevated role.
    if (this.gameConfig.nationalMode === true && nationalPrincipal?.claims) {
      client.claims = nationalPrincipal.claims;
      client.role = nationalPrincipal.claims.role ?? null;
    }
    this.log.info("client rejoining", { clientID, lastTurn });
    // Also closes the old WebSocket, to prevent resource leaks.
    this.clients.reconnect(client, ws);
    if (identityUpdate && !this.hasStarted()) {
      // A pre-start identity change to a different name means the player
      // switched to a custom name, so the check is dropped. The server only
      // resolves the check from the account at first join
      // (resolveVerifiedJoin); this rejoin path never re-derives it.
      if (
        identityUpdate.username !== client.username &&
        client.cosmetics?.verified
      ) {
        delete client.cosmetics.verified;
      }
      client.username = identityUpdate.username;
      client.clanTag = identityUpdate.clanTag;
    }
    client.lastPing = Date.now();
    this.markClientDisconnected(client.clientID, false);

    this.ingress.attach(client);
    this.startLobbyInfoBroadcast();

    if (this.stage === "started") {
      if (this.nationalMatch !== null) {
        if (!this.nationalMatch.resumeRecipient(client)) {
          return false;
        }
        this.markClientDisconnected(client.clientID, false);
        this.log.info("NATIONAL authenticated socket resumed", {
          gameID: this.id,
          seat: client.clientID,
          tick: this.nationalMatch.currentTick(),
        });
      }
      this.sendStartGameMsg(client.ws, lastTurn);
      if (
        this.nationalRecoveryDeadline !== null &&
        this.nationalMatch !== null
      ) {
        this.nationalRecoveryDeadline = null;
        this.lastPingUpdate = Date.now();
        this.endTurnIntervalID = setInterval(
          () => this.commitTrustedNationalTick(),
          this.deps.turnIntervalMs(),
        );
      }
    }
    return true;
  }

  // A validated message from a connected client, after SocketIngress has
  // applied the rate limit and the spectator block.
  private handleClientMessage(client: Client, clientMsg: ClientMessage) {
    // Nothing from a socket that is no longer on the roster reaches the game.
    // Dropping a client (a kick, the stale-ping prune, a close) leaves its
    // listener attached and the socket able to deliver frames — close() is a
    // handshake, and the prune only calls it on an OPEN socket at all — so
    // without this a kicked player could still land intents and votes, and a
    // ghost's pings could hold the empty-game reap off forever.
    if (!this.clients.isConnected(client)) {
      return;
    }
    switch (clientMsg.type) {
      case "rejoin": {
        // Client is already connected, no auth required, send start game message if game has started
        if (this.stage === "started") {
          this.sendStartGameMsg(client.ws, clientMsg.lastTurn);
        }
        break;
      }
      case "intent": {
        // Server stamps clientID from the authenticated connection.
        const outcome = this.handleIntent(clientMsg.intent, {
          clientID: client.clientID,
          isLobbyCreator: client.clientID === this.lobbyCreatorID,
          isAdmin: isAdminRole(client.role),
          isAdminBot: false,
        });
        if (outcome.status !== 200) {
          this.log.warn(`intent rejected`, {
            type: clientMsg.intent.type,
            clientID: client.clientID,
            gameID: this.id,
            reason: outcome.error,
          });
        }
        break;
      }
      case "ping": {
        // Only a roster member reaches here, so this is also the game-wide
        // "someone is still out there" clock the empty-game reap waits on.
        this.lastPingUpdate = Date.now();
        client.lastPing = Date.now();
        client.ws.send(
          encodeServerMessage(
            {
              type: "pong",
              sentAt: clientMsg.sentAt,
            } satisfies ServerPongMessage,
            this.zbinCtx,
          ),
        );
        break;
      }
      case "hash": {
        // The trusted server is the only NATIONAL simulation. A client hash
        // or winner vote is not evidence about canonical state.
        if (this.nationalMatch === null) {
          client.hashes.set(clientMsg.turnNumber, clientMsg.hash);
        }
        break;
      }
      case "spectate": {
        // NATIONAL roster and recipient rights freeze at server match start.
        if (this.gameConfig.nationalMode === true) break;
        this.setSpectator(client, clientMsg.spectator);
        break;
      }
      case "winner": {
        if (this.nationalMatch !== null) break;
        this.handleWinner(client, clientMsg);
        break;
      }
      case "live_stats": {
        if (this.nationalMatch !== null) break;
        this.handleLiveStats(client, clientMsg);
        break;
      }
      case "report": {
        this.handleReport(client, clientMsg);
        break;
      }
      default: {
        this.log.warn(`Unknown message type: ${(clientMsg as any).type}`, {
          clientID: client.clientID,
        });
        break;
      }
    }
  }

  private handleClientDisconnect(client: Client) {
    if (!this.clients.isConnected(client)) return;
    this.clients.markLeft(client);
    if (this.nationalMatch !== null) {
      this.nationalMatch.revokeRecipient(client);
      this.markClientDisconnected(client.clientID, true);
    }
    this.checkWinnerAfterElectorateShrink();

    // hasStarted() includes prestart: during the lobby -> game transition
    // clients reconnect, and a host socket closing then must not tear the
    // starting game down.
    if (this.hasStarted()) {
      return;
    }
    // Remove persistentId if the game has not started to prevent going over max players
    this.clients.forgetReconnect(client);
    // Close lobby when host leaves before game starts: without a host it can
    // never start. phase() reports Finished once ended, so GameManager's next
    // tick prunes it. A listed lobby carries on without its host: it starts
    // on its listing deadline (or the queue's countdown), and the players who
    // joined it from the lobby browser keep their game.
    if (
      !this.isPublic() &&
      !this.isListed() &&
      client.persistentID === this.creatorPersistentID
    ) {
      this.log.info("Host left, closing lobby", {
        gameID: this.id,
      });
      for (const c of [...this.clients.active()]) {
        this.kickClient(c.clientID, KICK_REASON_HOST_LEFT);
      }
      this.ended = true;
    }
  }

  public setStartsAt(startsAt: number) {
    this.startsAt = startsAt;
    // Record when the lobby first became visible to players, used to measure lobby fill time.
    if (this.isPublic()) {
      this.visibleAt ??= Date.now();
    }
  }

  public numClients(): number {
    return this.clients.active().length;
  }

  public activeClients(): readonly Client[] {
    return this.clients.active();
  }

  public numDesyncedClients(): number {
    return this.desync.count();
  }

  // Matchmade ranked games (1v1/2v2/clan wars) must start with full
  // attendance: the roster freezes at start(), so a game missing a player
  // would run short-handed only to be voided by the sim (2v2, clan wars) or
  // hand out a walkover the absent player never contested (1v1). Called at
  // the start deadline; cancels the game and returns true when too few
  // matched players connected.
  public cancelShortHandedMatch(): boolean {
    // Explicitly 1v1/2v2/clan wars only — a future ranked type must opt
    // in rather than inherit pre-start cancellation.
    const rankedType = this.gameConfig.rankedType;
    let expected: number | undefined;
    if (
      rankedType === RankedType.OneVOne ||
      rankedType === RankedType.TwoVTwo ||
      rankedType === RankedType.ClanWars
    ) {
      expected = this.gameConfig.maxPlayers;
    } else {
      return false;
    }
    if (expected === undefined || this.playerCount() >= expected) {
      return false;
    }
    this.log.info("cancelling matchmade game, missing players at deadline", {
      gameID: this.id,
      connected: this.playerCount(),
      expected,
    });
    for (const c of [...this.clients.active()]) {
      this.kickClient(c.clientID, KICK_REASON_MATCH_CANCELLED);
    }
    // phase() reports Finished once ended, so GameManager's next tick prunes.
    this.ended = true;
    return true;
  }

  // Nobody was connected when the delayed start came due. An empty roster at
  // that moment is not proof the game is abandoned: handleClientDisconnect
  // drops a client the instant its socket closes, blip or not, and the client
  // is normally reconnecting already. Ending the game there would be
  // permanent and silent — rejoinClient refuses an ended game, the worker
  // closes that socket with 1002, and the client treats 1002 as terminal
  // rather than retrying. So hold the start instead of cancelling it.
  public deferStart(): void {
    if (this.stage !== "prestart") {
      return;
    }
    this.log.info("deferring start, no clients connected", {
      gameID: this.id,
    });
    this.startDeferred = true;
  }

  // Runs a held start once someone is connected again. Nobody comes back ->
  // the game stays empty and phase() reaps it on the usual rules, so a truly
  // abandoned game still never reaches start(). Returns whether it started.
  public resumeDeferredStart(): boolean {
    if (!this.startDeferred || this.ended || this.numClients() === 0) {
      return false;
    }
    this.startDeferred = false;
    this.start();
    return true;
  }

  public prestart() {
    if (this.ended || this.hasStarted()) {
      return;
    }
    this.stage = "prestart";
    this.fetchTribes();

    const prestartMsg = ServerPrestartMessageSchema.safeParse({
      type: "prestart",
      gameMap: this.gameConfig.gameMap,
      gameMapSize: this.gameConfig.gameMapSize,
    });

    if (!prestartMsg.success) {
      this.log.error("error creating prestart message", {
        error: z.prettifyError(prestartMsg.error).substring(0, 250),
      });
      return;
    }

    const msg = encodeServerMessage(prestartMsg.data, this.zbinCtx);
    this.clients.active().forEach((c) => {
      this.log.info("sending prestart message", {
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(msg);
      }
    });
  }

  // Public games draw purchased bot tribe names from the API at prestart —
  // its 1.5s timeout fits the 2s prestart->start gap, so the pool is
  // normally in hand when start() builds the game start info. Best effort:
  // on timeout/error the game starts with organic bot names.
  private fetchTribes(): void {
    if (!this.isPublic() || this.gameConfig.bots === 0) {
      return;
    }
    // Logged-in humans only — guests can't own tribe names.
    const players = this.clients
      .active()
      .flatMap((c) =>
        c.publicId !== undefined
          ? [{ clientId: c.clientID, publicId: c.publicId }]
          : [],
      );
    this.deps
      .fetchTribes(players)
      .then((tribes) => {
        // One tribe per bot: with fewer bots than tribes, drop from the
        // tail (the global-pool slice).
        const used = tribes.slice(0, this.gameConfig.bots);
        if (used.length > 0) {
          this.tribes = used;
        }
      })
      .catch((error) => {
        this.log.warn(`failed to fetch custom tribes: ${error}`);
      });
  }

  private startLobbyInfoBroadcast() {
    if (this.stage === "started" || this.ended) {
      return;
    }
    if (this.lobbyInfoIntervalId !== null) {
      return;
    }
    this.broadcastLobbyInfo();
    this.lobbyInfoIntervalId = setInterval(() => {
      if (
        this.stage === "started" ||
        this.ended ||
        this.clients.active().length === 0
      ) {
        this.stopLobbyInfoBroadcast();
        return;
      }
      this.broadcastLobbyInfo();
    }, 1000);
  }

  private stopLobbyInfoBroadcast() {
    if (this.lobbyInfoIntervalId === null) {
      return;
    }
    clearInterval(this.lobbyInfoIntervalId);
    this.lobbyInfoIntervalId = null;
  }

  private broadcastLobbyInfo() {
    // Off: same payload for everyone (build once). On: per-recipient.
    const shared = this.gameConfig.anonymizeNames ? null : this.gameInfo();
    this.clients.active().forEach((c) => {
      if (c.ws.readyState === WebSocket.OPEN) {
        const msg = encodeServerMessage(
          {
            type: "lobby_info",
            lobby: shared ?? this.gameInfo(c.clientID),
            myClientID: c.clientID,
            // Same value for every recipient, including spectators: the
            // point of the token is that one game is one group.
            groupToken: this.groupToken,
          } satisfies ServerLobbyInfoMessage,
          this.zbinCtx,
        );
        c.ws.send(msg);
      }
    });
  }

  // The worker created a successor lobby for this game (the host asked to
  // reuse the private lobby via create_game?previous=). Remember it so repeat
  // requests reuse the same lobby, and tell everyone still connected its id so
  // they can hop over without re-sharing a link.
  public setSuccessorLobby(gameID: GameID) {
    this.successorLobbyId = gameID;
    this.log.info("successor lobby created", {
      gameID: this.id,
      successorID: gameID,
    });
    this.broadcastNewLobby(gameID);
  }

  public successorLobby(): GameID | null {
    return this.successorLobbyId;
  }

  private broadcastNewLobby(gameID: GameID) {
    const msg = encodeServerMessage(
      {
        type: "new_lobby",
        gameID,
      } satisfies ServerNewLobbyMessage,
      this.zbinCtx,
    );
    this.clients.active().forEach((c) => {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(msg);
      }
    });
  }

  public start() {
    if (this.stage === "started" || this.ended) {
      return;
    }
    // Private NATIONAL NEVER enters this legacy turn broadcaster. It
    // starts asynchronously only after a trusted map, authenticated host and
    // frozen human roster have been verified; errors fail closed.
    if (this.gameConfig.nationalMode === true) {
      void this.startTrustedNational();
      return;
    }
    this.stage = "started";
    this._startTime = Date.now();
    // Set last ping to start so we don't immediately stop the game
    // if no client connects/pings.
    this.lastPingUpdate = Date.now();

    this.convertClanOverflowToSpectators();

    const friendsFor = friendsLookup(this.clients.active());

    // allowedPublicIds / nameRevealPublicIds hold account publicIds and are
    // enforced server-side against this.gameConfig (joinClient / seesReal).
    // Keep them out of gameStartInfo: its config goes to every client in the
    // start message and into the publicly downloadable game record.
    const config = sanitizeConfigForWire(this.gameConfig);

    const result = WireGameStartInfoSchema.safeParse({
      gameID: this.id,
      lobbyCreatedAt: this.createdAt,
      visibleAt: this.visibleAt,
      config,
      players: this.clients.players().map((c) => ({
        username: c.username,
        clanTag: this.startClanTag(c),
        clientID: c.clientID,
        cosmetics: c.cosmetics,
        isLobbyCreator: this.lobbyCreatorID === c.clientID,
        friends: friendsFor(c),
        teamIndex: this.matchmakingTeamIndex(c),
      })),
      tribes: this.tribes,
    });
    if (!result.success) {
      const error = z.prettifyError(result.error);
      this.log.error("Error parsing game start info", { message: error });
      return;
    }
    this.gameStartInfo = result.data satisfies WireGameStartInfo;
    const wireGameStartInfo = {
      ...this.gameStartInfo,
      listed: this.listing.isListed(),
    };
    this.wireGameStartInfo = this.gameConfig.disableClanTags
      ? {
          ...wireGameStartInfo,
          players: this.gameStartInfo.players.map((p) => ({
            ...p,
            clanTag: null,
          })),
        }
      : wireGameStartInfo;
    // Seed the dictionary from the same players array, in the same order,
    // every client receives in the start message.
    this.zbinCtx = createGameWireContext(this.gameStartInfo.players);

    this.endTurnIntervalID = setInterval(
      () => this.endTurn(),
      this.deps.turnIntervalMs(),
    );
    this.clients.active().forEach((c) => {
      this.log.info("sending start message", {
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      this.sendStartGameMsg(c.ws, 0);
    });
  }

  /**
   * One authenticated Private lobby becomes ONE trusted server-owned Game.
   * No browser receives a ServerTurnMessage, a canonical Game, or a snapshot.
   * Map loading is asynchronous; the roster and host are checked again AFTER
   * it resolves, so no late admission or disconnected host can hijack start.
   */
  private async startTrustedNational(): Promise<void> {
    if (this.nationalStarting || this.ended || this.nationalMatch !== null) {
      return;
    }
    this.nationalStarting = true;
    try {
      if (
        this.gameConfig.nationalMode !== true ||
        this.gameConfig.gameType !== GameType.Private ||
        this.gameConfig.gameMode !== GameMode.FFA ||
        this.gameConfig.tutorial === true ||
        this.gameConfig.rankedType !== undefined ||
        this.isListed() ||
        this.creatorPersistentID === undefined
      ) {
        throw new Error(
          "NATIONAL requires authenticated unlisted Private FFA host",
        );
      }
      const seated = this.clients.players();
      const host = seated.find(
        (c) => c.persistentID === this.creatorPersistentID,
      );
      if (
        !host?.claims ||
        !isNationalSignedInAccount(host.claims) ||
        !host.publicId ||
        seated.length < 2
      ) {
        throw new Error(
          "NATIONAL requires authenticated host and two real seats",
        );
      }
      const accounts = new Set<string>();
      const persistents = new Set<string>();
      for (const client of seated) {
        if (
          !isNationalSignedInAccount(client.claims) ||
          !client.publicId ||
          !client.persistentID ||
          client.claims?.sub !== client.persistentID ||
          !this.clients.isConnected(client) ||
          client.ws.readyState !== WebSocket.OPEN ||
          accounts.has(client.publicId) ||
          persistents.has(client.persistentID)
        ) {
          throw new Error(
            "NATIONAL requires distinct connected authenticated seats",
          );
        }
        accounts.add(client.publicId);
        persistents.add(client.persistentID);
      }
      const friendsFor = friendsLookup(this.clients.active());
      const parsed = WireGameStartInfoSchema.safeParse({
        gameID: this.id,
        lobbyCreatedAt: this.createdAt,
        visibleAt: this.visibleAt,
        config: sanitizeConfigForWire(this.gameConfig),
        players: seated.map((c) => ({
          username: c.username,
          clanTag: this.startClanTag(c),
          clientID: c.clientID,
          cosmetics: c.cosmetics,
          isLobbyCreator: this.lobbyCreatorID === c.clientID,
          friends: friendsFor(c),
          teamIndex: this.matchmakingTeamIndex(c),
        })),
        tribes: this.tribes,
      });
      if (!parsed.success) {
        throw new Error("NATIONAL trusted start info validation failed");
      }
      const info = parsed.data satisfies WireGameStartInfo;
      const durableStore = this.deps.durableNationalStore;
      const map = durableStore
        ? await loadTrustedNationalMapFiles(
            info.config.gameMap,
            info.config.gameMapSize,
          )
        : undefined;
      const mapDigest = map ? nationalMapDigest(map) : undefined;
      const runner = map
        ? await createTrustedNationalGameRunner(info, map)
        : await this.deps.createNationalRunner(info);

      // The loader may take seconds. Never start a Game whose authenticated
      // seat disappeared or whose socket/host changed while it was loading.
      const stillHere = this.clients.players();
      if (
        this.ended ||
        this.gameConfig.nationalMode !== true ||
        stillHere.length !== seated.length ||
        seated.some(
          (client, index) =>
            stillHere[index] !== client ||
            !this.clients.isConnected(client) ||
            client.ws.readyState !== WebSocket.OPEN,
        ) ||
        !this.clients.isConnected(host)
      ) {
        throw new Error("NATIONAL authenticated roster changed during boot");
      }

      const checkpoint = durableStore
        ? DurableNationalCheckpoint.create(
            durableStore,
            ServerEnv.gitCommit(),
            mapDigest!,
            info,
            seated,
            runner,
          )
        : undefined;
      const match = new TrustedNationalMatch(
        this.id,
        runner,
        seated,
        (client, packet) => this.sendNationalRecipientPacket(client, packet),
        checkpoint,
      );
      this.gameStartInfo = info;
      this.wireGameStartInfo = {
        ...info,
        listed: false,
        players: info.config.disableClanTags
          ? info.players.map((p) => ({ ...p, clanTag: null }))
          : info.players,
      };
      this.zbinCtx = createGameWireContext(info.players);
      this.nationalMatch = match;
      this.stage = "started";
      this._startTime = Date.now();
      this.lastPingUpdate = Date.now();
      this.stopLobbyInfoBroadcast();
      // Sanctioned host-only proof: counts and ticks, no user subjects,
      // bearer tokens, public IDs or recipient-private state.
      this.log.info("NATIONAL authoritative host ready", {
        gameID: this.id,
        authenticatedSeats: seated.length,
        distinctAccounts: accounts.size,
        authoritativeRunners: 1,
        initialTick: match.currentTick(),
        durableTick: match.durableTick(),
        stateCommitment: match.stateCommitment(),
      });

      // No spectators in the first trusted-host slice. They cannot join an
      // authoritative Game seat, nor obtain a privileged projection.
      for (const c of this.clients.active()) {
        if (c.spectator && c.ws.readyState === WebSocket.OPEN) {
          c.ws.send(
            encodeServerMessage(
              {
                type: "error",
                error: "national-spectator-not-supported",
              } satisfies ServerErrorMessage,
              this.zbinCtx,
            ),
          );
          c.ws.close(CloseCode.Forbidden, CloseReason.CannotJoin);
        }
      }
      for (const client of seated) this.sendTrustedNationalStart(client);
      // First real server tick occurs after every admitted seat received its
      // safe start. All subsequent ticks use the same canonical GameRunner.
      this.commitTrustedNationalTick();
      if (!this.ended) {
        this.endTurnIntervalID = setInterval(
          () => this.commitTrustedNationalTick(),
          this.deps.turnIntervalMs(),
        );
      }
    } catch (error) {
      // Fail closed. In particular, do NOT fall back to legacy client turn
      // broadcast on map-load, account or E3 filtering failure.
      this.log.error("NATIONAL trusted boot refused", {
        gameID: this.id,
        reason: error instanceof Error ? error.name : "unknown",
      });
      this.failTrustedNational();
    } finally {
      this.nationalStarting = false;
    }
  }

  /** Worker startup only; durable ownership is acquired before this object
   * can enter GameManager. There are no live sessions until fresh account
   * verification. Do not call the legacy lobby or init path. */
  public async recoverTrustedNational(
    checkpoint: DurableNationalCheckpoint,
  ): Promise<void> {
    if (
      this.stage !== "lobby" ||
      this.nationalMatch !== null ||
      this.id !== checkpoint.info.gameID ||
      !this.deps.durableNationalStore
    ) {
      throw new Error("NATIONAL invalid recovery lifecycle");
    }
    const info = checkpoint.info;
    const map = await loadTrustedNationalMapFiles(
      info.config.gameMap,
      info.config.gameMapSize,
    );
    if (nationalMapDigest(map) !== checkpoint.mapDigest)
      throw new Error("NATIONAL durable map mismatch");
    const runner = await createTrustedNationalGameRunnerFromSnapshot(
      info,
      checkpoint.snapshot,
      map,
      checkpoint.source,
      checkpoint.tick,
    );
    checkpoint.validateRunner(runner);
    const seats = checkpoint.seats.map((seat, index) => {
      const player = info.players[index];
      // An inert server-side ws shell has no transport, listeners, JWT or
      // recipient. It is replaced only by a freshly validated account.
      return new Client(
        seat.clientID,
        seat.subject,
        null,
        null,
        undefined,
        "",
        player.username,
        player.clanTag ?? null,
        new WebSocket(null),
        player.cosmetics,
        seat.accountId,
        player.friends ?? [],
      );
    });
    const match = new TrustedNationalMatch(
      this.id,
      runner,
      seats,
      (client, packet) => this.sendNationalRecipientPacket(client, packet),
      checkpoint,
      true,
    );
    for (const client of seats) {
      this.clients.restoreDisconnected(
        client,
        checkpoint.state.kicked.includes(client.clientID),
      );
      // Physical connection status changes only on the next committed tick.
      match.recordServerDisconnect(client.clientID, true);
    }
    this.gameStartInfo = info;
    this.wireGameStartInfo = {
      ...info,
      listed: false,
      players: info.config.disableClanTags
        ? info.players.map((p) => ({ ...p, clanTag: null }))
        : info.players,
    };
    this.zbinCtx = createGameWireContext(info.players);
    this.nationalMatch = match;
    this.stage = "started";
    this.paused = checkpoint.state.paused;
    this._startTime = Date.now();
    this.lastPingUpdate = Date.now();
    this.nationalRecoveryDeadline = Date.now() + this.emptyGameTimeout;
    this.log.info("NATIONAL durable match restored", {
      gameID: this.id,
      tick: match.currentTick(),
      durableTick: match.durableTick(),
      stateCommitment: match.stateCommitment(),
      replayDigest: match.replayDigest(),
      authoritativeRunners: 1,
      authenticatedSeats: 0,
    });
  }

  private failTrustedNational(): void {
    this.nationalFaulted = true;
    this.ended = true;
    if (this.endTurnIntervalID !== undefined) {
      clearInterval(this.endTurnIntervalID);
      this.endTurnIntervalID = undefined;
    }
    this.clients.closeAll(CloseReason.GameEnded);
  }

  private sendTrustedNationalStart(client: Client): void {
    if (
      this.nationalMatch === null ||
      !this.clients.isConnected(client) ||
      client.spectator ||
      client.ws.readyState !== WebSocket.OPEN
    )
      return;
    // The protocol intentionally has NO turns array or snapshot field.
    client.ws.send(
      encodeServerMessage(
        {
          type: "national_start",
          gameStartInfo: this.names.startInfoFor(
            client.clientID,
            isAdminRole(client.role),
            this.gameStartInfo,
            this.wireGameStartInfo,
          ),
          myClientID: client.clientID,
          tick: this.nationalMatch.currentTick(),
          groupToken: this.groupToken,
        } satisfies ServerNationalStartMessage,
        this.zbinCtx,
      ),
    );
  }

  private sendNationalRecipientPacket(
    client: Client,
    packet: GameUpdateViewData,
  ): void {
    if (
      this.ended ||
      this.nationalMatch === null ||
      !this.clients.isConnected(client) ||
      client.spectator ||
      client.ws.readyState !== WebSocket.OPEN
    )
      return;
    const payload = encodeNationalRecipientProjection(packet);
    client.ws.send(
      encodeServerMessage(
        {
          type: "national_projection",
          tick: packet.tick,
          payload,
        } satisfies ServerNationalProjectionMessage,
        this.zbinCtx,
      ),
    );
  }

  private commitTrustedNationalTick(): void {
    if (this.paused || this.ended || this.nationalMatch === null) return;
    try {
      const receipt = this.nationalMatch.tick();
      if (
        receipt.committedIntents > 0 ||
        receipt.tick % 100 === 0 ||
        this.nationalMatch.durableTick() !== null
      ) {
        this.log.info("NATIONAL authoritative tick", {
          gameID: this.id,
          tick: receipt.tick,
          queuedIntents: receipt.committedIntents,
          replayDigestPrefix: receipt.replayDigest.slice(0, 12),
          durableTick: this.nationalMatch.durableTick(),
          stateCommitment: this.nationalMatch.stateCommitment(),
          replayDigest: receipt.replayDigest,
        });
      }
    } catch (error) {
      this.log.error("NATIONAL authoritative tick failed", {
        gameID: this.id,
        reason: error instanceof Error ? error.name : "unknown",
      });
      // Do not delete the last good checkpoint on a storage or tick failure.
      this.failTrustedNational();
    }
  }

  // Connected clients who will actually play. Spectators are excluded
  // everywhere a "player" is meant: the lobby cap, and gameStartInfo.
  private playerCount(): number {
    return this.clients.players().length;
  }

  private convertClanOverflowToSpectators(): void {
    if (
      this.gameConfig.gameMode !== GameMode.Team ||
      this.gameConfig.playerTeams === undefined ||
      this.gameConfig.playerTeams === HumansVsNations ||
      this.matchmakingTeams !== undefined ||
      this.gameConfig.rankedType !== undefined ||
      this.gameConfig.disableClanTags === true ||
      this.gameConfig.anonymizeNames === true
    ) {
      return;
    }
    const playerTeams = this.gameConfig.playerTeams;
    const nationCount = this.resolveDefaultNationCount();
    const convertedClientIDs = new Set<ClientID>();
    let kickedClients = this.findClanOverflowKicks(playerTeams, nationCount);
    while (kickedClients.length > 0) {
      for (const client of kickedClients) {
        client.spectator = true;
        convertedClientIDs.add(client.clientID);
        this.log.info("Converted clan overflow player to spectator", {
          clientID: client.clientID,
          clanTag: client.clanTag,
        });
      }
      kickedClients = this.findClanOverflowKicks(playerTeams, nationCount);
    }
    if (convertedClientIDs.size > 0) {
      this.intents = this.intents.filter(
        (i) => !convertedClientIDs.has(i.clientID),
      );
    }
  }

  private resolveDefaultNationCount(): number {
    if (typeof this.gameConfig.nations === "number") {
      return this.gameConfig.nations;
    }
    if (this.gameConfig.nations === "default") {
      const mapInfo = maps.find((m) => m.type === this.gameConfig.gameMap);
      return mapInfo?.defaultNationCount ?? 0;
    }
    return 0;
  }

  private findClanOverflowKicks(
    playerTeams: TeamCountConfig,
    nationCount: number,
  ): Client[] {
    const playingClients = this.clients
      .players()
      .filter((c) => this.matchmakingTeamIndex(c) === undefined);
    const totalPlayers = playingClients.length + nationCount;
    let teams;
    try {
      teams = resolveTeamsList(playerTeams, totalPlayers);
    } catch {
      return [];
    }
    const playerInfos = playingClients.map(
      (c) =>
        new PlayerInfo(
          c.username,
          PlayerType.Human,
          c.clientID,
          c.clientID,
          false,
          c.clanTag ?? null,
        ),
    );
    const preview = assignTeamsLobbyPreview(
      playerInfos,
      teams,
      playerTeams,
      nationCount,
    );
    const kickedIDs = new Set<ClientID>();
    for (const [info, assignment] of preview.entries()) {
      if (assignment === "kicked" && info.clanTag && info.clientID !== null) {
        kickedIDs.add(info.clientID);
      }
    }
    return playingClients.filter((c) => kickedIDs.has(c.clientID));
  }

  // ONE definition of who the allowlist admits, shared by every path that can
  // put someone in (or seat someone into) this game — joinClient and the lobby
  // Play/Spectate toggle. Admins bypass it so moderation can reach any lobby.
  private passesAllowlist(client: Client): boolean {
    const allowed = this.gameConfig.allowedPublicIds;
    if (allowed === undefined || allowed.length === 0) return true;
    if (isAdminRole(client.role)) return true;
    return client.publicId !== undefined && allowed.includes(client.publicId);
  }

  // Trusted-only lobbies (GameConfig.trusted) admit only accounts the API
  // reported as trusted at join time. Shared by joinClient and the seat toggle
  // for the same reason as passesAllowlist; admins bypass it the same way.
  private passesTrustGate(client: Client): boolean {
    if (this.gameConfig.trusted !== true) return true;
    if (isAdminRole(client.role)) return true;
    return client.trusted;
  }

  // ONE definition of which member a client belongs to, shared by every path
  // that can seat someone here — joinClient and the Play/Spectate toggle — the
  // same way passesAllowlist is. Null means seat them here.
  //
  // Naming a publicId in allowedPublicIds pins them to this member on purpose,
  // so it overrides the hash.
  private poolTargetForClient(client: Client): GameID | null {
    const pool = this.gameConfig.pool;
    if (pool === undefined) return null;
    if (isAdminRole(client.role)) return null;
    if (
      client.publicId !== undefined &&
      this.gameConfig.allowedPublicIds?.includes(client.publicId) === true
    ) {
      return null;
    }
    return poolTargetFor(
      pool,
      client.publicId ?? hashPersistentID(client.persistentID),
      this.id,
    );
  }

  // The join-path view. Both extra guards belong here and NOT in
  // poolTargetForClient: a client that is already in this game is a known
  // client, and a spectator that later asks for a seat is too, so sharing
  // either one would make the seat toggle a way past the pool.
  //
  // Already here: a mid-game drop reconnects as a fresh join, and routing it
  // out would take the player out of the game they are playing. (A reconnect
  // that arrives as a rejoin never reaches any of this — rejoinClient hands
  // an existing client a new socket and seats nobody.)
  //
  // Spectator: they take no seat on the way in, so a caster can watch whichever
  // member they asked for.
  private poolRedirectFor(client: Client): GameID | null {
    if (this.getClientIdForPersistentId(client.persistentID) !== null) {
      return null;
    }
    if (client.spectator) return null;
    return this.poolTargetForClient(client);
  }

  // Switch a client between playing and watching from the lobby screen. Seating
  // is refused once the game has started (the player list is frozen), when the
  // lobby is full, when the allowlist does not name them, or when the pool puts
  // them on another member — the toggle must not be a way past any of them. The
  // allowlist can gain entries AFTER people are in the lobby
  // (update_game_config replaces it), so someone admitted before it was set is
  // not proof they may hold a seat now.
  private setSpectator(client: Client, spectator: boolean): void {
    if (client.spectator === spectator) return;
    if (!spectator) {
      if (this.stage === "started" || this.ended) return;
      if (!this.passesAllowlist(client)) return;
      if (!this.passesTrustGate(client)) return;
      if (this.poolTargetForClient(client) !== null) return;
      const max = this.gameConfig.maxPlayers;
      if (max !== undefined && this.playerCount() >= max) return;
    }
    client.spectator = spectator;
    // The lobby list is derived from this flag, so everyone's view of who is
    // playing has to be refreshed rather than waiting out the next tick.
    this.broadcastLobbyInfo();
  }

  // Pin a publicId to a team slot after the lobby exists, so a lobby that fills
  // over time can still seat late joiners with their partners.
  // matchmakingTeamIndex resolves against this array live and is only read when
  // gameStartInfo is built at start, so nothing needs recomputing.
  public addMatchmakingPin(
    publicId: string,
    teamIndex: number,
  ):
    | { ok: true; teams: string[][] }
    | { ok: false; status: number; error: string } {
    if (this.matchmakingTeams === undefined) {
      return { ok: false, status: 400, error: "game_not_matchmade" };
    }
    if (this.hasStarted()) {
      return { ok: false, status: 409, error: "game_already_started" };
    }
    if (
      !Number.isInteger(teamIndex) ||
      teamIndex < 0 ||
      teamIndex >= this.matchmakingTeams.length
    ) {
      return { ok: false, status: 400, error: "team_index_out_of_range" };
    }
    const existing = this.matchmakingTeams.findIndex((team) =>
      team.includes(publicId),
    );
    // Idempotent, so a caller retrying after a dropped response converges.
    if (existing === teamIndex) {
      return { ok: true, teams: this.matchmakingTeams };
    }
    if (existing !== -1) {
      return { ok: false, status: 409, error: "player_already_pinned" };
    }
    this.matchmakingTeams[teamIndex].push(publicId);
    return { ok: true, teams: this.matchmakingTeams };
  }

  // Resolves a client to its matchmade team slot (index into
  // matchmakingTeams), or undefined when the game isn't matchmade / the
  // client isn't in the assignment.
  private matchmakingTeamIndex(c: Client): number | undefined {
    const publicId = c.publicId;
    if (this.matchmakingTeams === undefined || publicId === undefined) {
      return undefined;
    }
    const idx = this.matchmakingTeams.findIndex((team) =>
      team.includes(publicId),
    );
    return idx === -1 ? undefined : idx;
  }

  // The clan tag a player starts with. In clan wars it is their team's clan
  // from the assignment, whatever tag they joined with: the API rates the
  // clans by the tags in the game record.
  private startClanTag(c: Client): string | null {
    const team = this.matchmakingTeamIndex(c);
    const matchmade =
      team === undefined ? undefined : this.matchmakingClanTags?.[team];
    return matchmade ?? c.clanTag ?? null;
  }

  private addIntent(intent: StampedIntent) {
    this.intents.push(intent);
  }

  private sendStartGameMsg(ws: WebSocket, lastTurn: number) {
    // Find which client this websocket belongs to
    const client = this.clients.active().find((c) => c.ws === ws);
    if (!client) {
      this.log.warn("Could not find client for websocket in sendStartGameMsg");
      return;
    }
    // Even during teardown or failed startup, NATIONAL must never fall
    // through to the legacy start frame with unfiltered turn history.
    if (this.gameConfig.nationalMode === true) {
      if (this.nationalMatch !== null) {
        this.sendTrustedNationalStart(client);
      }
      return;
    }

    this.log.info(`Sending start message to client`, {
      clientID: client.clientID,
      lobbyCreatorID: this.lobbyCreatorID,
      isLobbyCreator: this.lobbyCreatorID === client.clientID,
    });

    try {
      if (ws.readyState !== WebSocket.OPEN) {
        this.log.warn(`WebSocket not open, skipping start message`, {
          clientID: client.clientID,
          readyState: ws.readyState,
        });
        return;
      }
      ws.send(
        encodeServerMessage(
          {
            type: "start",
            turns: this.turns.slice(lastTurn),
            gameStartInfo: this.names.startInfoFor(
              client.clientID,
              isAdminRole(client.role),
              this.gameStartInfo,
              this.wireGameStartInfo,
            ),
            lobbyCreatedAt: this.createdAt,
            myClientID: client.clientID,
            // Repeated here for the late joiner, who connects after the
            // lobby broadcasts stopped and would otherwise never see it.
            groupToken: this.groupToken,
          } satisfies ServerStartGameMessage,
          this.zbinCtx,
        ),
      );
    } catch (error) {
      this.log.error(`error sending start message for game ${this.id}`, {
        clientID: client.clientID,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private endTurn() {
    // Across lobby, prestart, loading, started and failed-boot states:
    // NEVER permit NATIONAL through the legacy broadcast turn queue.
    if (this.gameConfig.nationalMode === true) return;
    // Skip turn execution if game is paused
    if (this.paused) {
      return;
    }

    const pastTurn: Turn = {
      turnNumber: this.turns.length,
      intents: this.intents,
    };
    this.turns.push(pastTurn);
    this.intents = [];
    this.gatekeeper.turnCommitted(
      pastTurn.turnNumber,
      pastTurn.intents.length,
      pastTurn.intents,
    );

    this.handleSynchronization();
    this.checkDisconnectedStatus();

    const msg = encodeServerMessage(
      {
        type: "turn",
        turn: pastTurn,
      } satisfies ServerTurnMessage,
      this.zbinCtx,
    );
    this.clients.active().forEach((c) => {
      if (c.ws.readyState === c.ws.OPEN) {
        c.ws.send(msg);
      }
    });
  }

  async end() {
    this.ended = true;
    // Close all WebSocket connections
    if (this.endTurnIntervalID) {
      clearInterval(this.endTurnIntervalID);
      this.endTurnIntervalID = undefined;
    }
    this.clients.closeAll(CloseReason.GameEnded);
    // Private NATIONAL canonical turns cannot be uploaded to the legacy
    // publicly downloadable replay archive (its state is not E3-filtered).
    const wasTrustedNational = this.nationalMatch !== null;
    if (!this.nationalFaulted) {
      try {
        this.nationalMatch?.retire();
      } catch {
        // Preserve the checkpoint and fence the writer. Never pretend the
        // intended terminal transition reached disk.
        this.log.error("NATIONAL durable retirement failed", {
          gameID: this.id,
        });
        this.nationalFaulted = true;
      }
    }
    this.nationalMatch = null;
    // The lobby broadcast would stop itself on its next tick; do not leave a
    // timer holding an ended game until then.
    this.stopLobbyInfoBroadcast();
    // Only a started game has a record to archive: gameStartInfo is built by
    // start(), so a game that ends during prestart has nothing to upload.
    if (this.stage !== "started" || wasTrustedNational) {
      this.log.info("game not eligible for legacy archive");
      this.gatekeeper.matchEnded(this.turns.length);
      return;
    }
    this.log.info(`ending game with ${this.turns.length} turns`);
    try {
      if (this.clients.all().size === 0) {
        this.log.info("no clients joined, not archiving game", {
          gameID: this.id,
        });
      } else if (this.winnerVote.winner() !== null) {
        this.log.info("winner already settled, record sent or pending replay", {
          gameID: this.id,
        });
      } else {
        // Not awaited: the upload handles its own failures (Archive.ts), and
        // waiting would only hold up GameManager's prune of this game.
        this.settleWinner();
      }
    } catch (error) {
      let errorDetails;
      if (error instanceof Error) {
        errorDetails = {
          message: error.message,
          stack: error.stack,
        };
      } else if (Array.isArray(error)) {
        errorDetails = error; // Now we'll actually see the array contents
      } else {
        try {
          errorDetails = JSON.stringify(error, null, 2);
        } catch (e) {
          errorDetails = String(error);
        }
      }

      this.log.error("Error archiving game record details:", {
        gameId: this.id,
        errorType: typeof error,
        error: errorDetails,
      });
    }
    this.gatekeeper.matchEnded(this.turns.length);
  }

  // Drops the clients that have not pinged for 60s. GameManager calls this
  // once per tick, just before phase(); it is the one lifecycle step with a
  // side effect, and keeping it out of phase() lets the lobby browser read
  // the phase as often as it likes without closing anyone's socket.
  public pruneStaleClients(): void {
    if (this.ended) {
      return;
    }
    const stale = this.clients.pruneStale(Date.now(), 60_000);
    for (const client of stale) {
      if (this.nationalMatch !== null) {
        this.nationalMatch.revokeRecipient(client);
        this.markClientDisconnected(client.clientID, true);
      }
      this.log.info("no pings received, terminating connection", {
        clientID: client.clientID,
        persistentID: client.persistentID,
      });
      if (client.ws.readyState === WebSocket.OPEN) {
        // Not a normal close: the roster keeps the reconnect mapping, so a client
        // whose pings were lost on a stuck link is meant to come back.
        client.ws.close(CloseCode.TryAgainLater, CloseReason.NoHeartbeat);
      }
    }
    // On an abrupt network drop the ws 'close' event can lag far behind this
    // ping prune, so re-check the winner vote here too.
    if (stale.length > 0) {
      this.checkWinnerAfterElectorateShrink();
    }
    // Since when has nobody been connected? Tracked here rather than in
    // phase() so phase() stays a pure read, and so emptiness accrues on the
    // tick loop instead of on however often the lobby browser asks.
    this.emptySince =
      this.clients.active().length === 0
        ? (this.emptySince ?? Date.now())
        : null;
  }

  // The 3 hour cap every game ends at, however it is going. Exposed so
  // GameManager can log the timeout once, where it prunes the game.
  pastMaxDuration(): boolean {
    return Date.now() > this.createdAt + this.maxGameDuration;
  }

  // A pure read of the lifecycle; pruneStaleClients() is the side effect.
  // It does not log: every caller (lobby listings, the tick loop, the HTTP
  // handlers) reads it, so a log here repeats per call.
  phase(): GamePhase {
    // An ended game (e.g. an unstarted lobby whose host left) must report
    // Finished: GameManager prunes on Finished, and a ghost that kept
    // reporting Lobby would stay advertised in the lobby browser and hold
    // the creator's one-listing quota until the max-duration cutoff.
    if (this.ended) {
      return GamePhase.Finished;
    }
    if (this.pastMaxDuration()) {
      return GamePhase.Finished;
    }
    const now = Date.now();
    if (this.nationalRecoveryDeadline !== null) {
      return now < this.nationalRecoveryDeadline
        ? GamePhase.Active
        : GamePhase.Finished;
    }

    const lessThanLifetime = this.startsAt ? Date.now() < this.startsAt : true;
    if (
      lessThanLifetime &&
      !this.hasStarted() &&
      !this.hasReachedMaxPlayerCount
    ) {
      return GamePhase.Lobby;
    }

    // Anyone still on the roster keeps the game running. Everything below is
    // about reaping a game nobody is connected to.
    if (this.clients.active().length > 0) {
      return GamePhase.Active;
    }

    // Grace period before an empty game is reaped, measured from whenever it
    // committed to starting. startsAt is not always set: a lobby that
    // auto-starts by filling to maxPlayers, and admin bot games, never get one
    // — and `undefined + 30_000` is NaN, so every comparison against it is
    // false. Those games could never be reaped and lived on (still ticking
    // turns, with nobody connected) until the maxGameDuration cutoff above.
    const warmupFrom = this.startsAt ?? this._startTime ?? this.createdAt;
    const warmupOver = now > warmupFrom + 30 * 1000;
    const noRecentPings = now > this.lastPingUpdate + 20 * 1000;
    if (warmupOver && noRecentPings) {
      return GamePhase.Finished;
    }

    // Backstop: an empty game whose ping clock never goes quiet. Only a client
    // on the roster refreshes lastPingUpdate now, but a game that manages to
    // keep that clock warm with nobody connected must still not outlive the
    // players by hours — sustained emptiness is enough on its own.
    if (
      this.hasStarted() &&
      this.emptySince !== null &&
      now > this.emptySince + this.emptyGameTimeout
    ) {
      this.log.warn("game had no connected clients past timeout, ending", {
        gameID: this.id,
      });
      return GamePhase.Finished;
    }

    return GamePhase.Active;
  }

  hasStarted(): boolean {
    return this.stage !== "lobby";
  }

  hasEnded(): boolean {
    return this.ended;
  }

  isPaused(): boolean {
    return this.paused;
  }

  // Omitting viewer (e.g. the HTTP /api/game/:id and link-preview routes)
  // anonymizes all names when the option is on.
  public gameInfo(viewer?: ClientID): GameInfo {
    // Goes out over the unauthenticated /api/game/:id route and the per-second
    // lobby_info broadcast, so strip secrets (see sanitizeConfigForWire).
    const gameConfig = sanitizeConfigForWire(this.gameConfig);
    return {
      gameID: this.id,
      clients: this.names.lobbyClients(viewer, this.clients.active()),
      lobbyCreatorClientID: this.lobbyCreatorID,
      gameConfig,
      startsAt: this.startsAt,
      serverTime: Date.now(),
      publicGameType: this.publicGameType,
      listed: this.isPublic() ? undefined : this.listing.isListed(),
      autoStartAt: this.autoStartAt(),
      label: this.listing.lobbyLabel(),
      accent: this.listing.lobbyAccent(),
      featured: this.listing.isFeatured() ? true : undefined,
      queued: this.listing.isQueued() ? true : undefined,
    };
  }

  public isPublic(): boolean {
    return this.gameConfig.gameType === GameType.Public;
  }

  public isListed(): boolean {
    return this.listing.isListed();
  }

  public getVisibleAt(): number | undefined {
    return this.visibleAt;
  }

  /** Who joined, and the account behind each one.
   *
   *  The public game record is PII-stripped, so a clientID can only be tied back
   *  to an account by whoever ran the lobby. Without this a host can see that 96
   *  people played and identify none of them. Restricted to lobbies the admin bot
   *  created — never a public or matchmade game.
   *
   *  Everyone who joined, not only the connected: someone who joined and left
   *  still appears in the record the host has to reconcile against. */
  public roster(): {
    clientID: ClientID;
    publicId: string | undefined;
    username: string;
  }[] {
    return [...this.clients.all().values()].map((c) => ({
      clientID: c.clientID,
      publicId: c.publicId,
      username: c.username,
    }));
  }

  // `options` are the host's picks from the listing dialog: how long until
  // the lobby auto-starts, and the player cap that starts it early once
  // filled.
  public setListed(
    listed: boolean,
    options: { autoStartMs?: number; maxPlayers?: number } = {},
  ): void {
    const wasListed = this.listing.isListed();
    this.listing.setListed(listed, options.autoStartMs);
    // Only on the transition: relisting must not change the cap players
    // joined under.
    if (listed && !wasListed) {
      this.visibleAt ??= Date.now();
      const raw = options.maxPlayers ?? this.gameConfig.maxPlayers;
      if (raw !== undefined) {
        const max =
          this.gameConfig.gameMode === GameMode.Team
            ? adjustForTeams(raw, this.gameConfig.playerTeams)
            : raw;
        this.gameConfig.maxPlayers = max;
        if (this.playerCount() >= max) {
          this.hasReachedMaxPlayerCount = true;
        }
      }
    }
  }

  public isQueued(): boolean {
    return this.listing.isQueued();
  }

  public queuedAt(): number | undefined {
    return this.listing.queuedAtTime();
  }

  // The host paid to put this listed lobby in the public Special queue. The
  // worker then reports it as a Special lobby and the queue's countdown
  // starts it; the listing deadline no longer applies.
  public queueForPublic(): void {
    this.listing.queue();
  }

  // Players (not spectators) currently seated in the lobby.
  public numPlayers(): number {
    return this.playerCount();
  }

  public autoStartAt(): number | undefined {
    return this.listing.autoStartAt() ?? this.poolAutoStartAt;
  }

  // Only create_pool calls this.
  public setPoolAutoStartAt(deadline: number): void {
    this.poolAutoStartAt = deadline;
  }

  public isFeatured(): boolean {
    return this.listing.isFeatured();
  }

  public lobbyLabel(): string | undefined {
    return this.listing.lobbyLabel();
  }

  public lobbyAccent(): LobbyAccent | undefined {
    return this.listing.lobbyAccent();
  }

  // Only create_game calls this.
  public setFeatured(opts: { label?: string; accent?: LobbyAccent }): void {
    this.listing.setFeatured(opts);
  }

  // Called from GameManager's tick while in the Lobby phase: once the
  // listed (or pool) deadline passes, arm the normal start countdown (same path as
  // the host's Start button). Cancelling the countdown re-arms it on the
  // next tick, so the only way out is to unlist.
  public maybeAutoStartListed(): void {
    if (this.hasStarted() || this.startsAt !== undefined) {
      return;
    }
    const deadline = this.autoStartAt();
    if (deadline === undefined || Date.now() < deadline) {
      return;
    }
    this.log.info("listed lobby reached auto-start deadline, starting", {
      gameID: this.id,
    });
    this.setStartsAt(Date.now() + (this.gameConfig.startDelay ?? 0) * 1000);
  }

  // Whether joining is restricted to an allowlist of publicIds. A lobby with
  // a join whitelist must not be publicly listed (it would advertise a lobby
  // that rejects every joiner).
  public hasJoinWhitelist(): boolean {
    return (this.gameConfig.allowedPublicIds?.length ?? 0) > 0;
  }

  // Whether any host-only cheat is actually granted. A lobby with host
  // cheats must not be publicly listed.
  public hasHostCheats(): boolean {
    return hostCheatsEnabled(this.gameConfig.hostCheats);
  }

  public isCreator(persistentId: string): boolean {
    return (
      this.creatorPersistentID !== undefined &&
      this.creatorPersistentID === persistentId
    );
  }

  // Hash of the creator's persistentID, safe to share between master and
  // workers (never sent to browsers) for the one-listed-lobby-per-creator
  // check. The raw persistentID must not leave this class.
  public hashedCreatorID(): string | undefined {
    return this.creatorPersistentID === undefined
      ? undefined
      : hashPersistentID(this.creatorPersistentID);
  }

  public kickClient(
    clientID: ClientID,
    reasonKey: string = KICK_REASON_DUPLICATE_SESSION,
  ): void {
    const client = this.clients.get(clientID);
    if (!client) {
      this.log.warn(`cannot kick client, not found in game`, {
        clientID,
        reasonKey,
      });
      return;
    }

    // The persistentID is banned whether or not the client is still
    // connected; every connected session holding it is told and cut off.
    // An already-banned persistentID is not proof that nothing holds it: a
    // duplicate session admitted alongside this record must still go.
    const alreadyKicked = this.isKicked(clientID);
    try {
      this.nationalMatch?.recordKick(clientID);
    } catch {
      this.failTrustedNational();
      return;
    }
    const dropped = this.clients.kick(client);
    if (dropped.length === 0) {
      this.log.warn(
        alreadyKicked
          ? `cannot kick client, already kicked`
          : `cannot kick client, not found in game`,
        { clientID, reasonKey },
      );
      return;
    }
    for (const c of dropped) {
      if (this.nationalMatch !== null) {
        this.nationalMatch.revokeRecipient(c);
        this.markClientDisconnected(c.clientID, true);
      }
      this.log.info("Kicking client from game", {
        clientID: c.clientID,
        persistentID: c.persistentID,
        reasonKey,
      });
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(
          encodeServerMessage(
            {
              type: "error",
              error: reasonKey,
            } satisfies ServerErrorMessage,
            this.zbinCtx,
          ),
        );
        c.ws.close(CloseCode.Normal, reasonKey);
      }
    }
  }

  private checkDisconnectedStatus() {
    if (this.turns.length % 5 !== 0) {
      return;
    }

    const now = Date.now();
    for (const [clientID, client] of this.clients.all()) {
      const isDisconnected = this.isClientDisconnected(clientID);
      if (!isDisconnected && now - client.lastPing > this.disconnectedTimeout) {
        this.markClientDisconnected(clientID, true);
      } else if (
        isDisconnected &&
        now - client.lastPing < this.disconnectedTimeout
      ) {
        this.markClientDisconnected(clientID, false);
      }
    }
  }

  public isClientDisconnected(clientID: string): boolean {
    return this.clients.isDisconnected(clientID);
  }

  private markClientDisconnected(clientID: string, isDisconnected: boolean) {
    this.clients.setDisconnected(clientID, isDisconnected);
    if (this.nationalMatch !== null) {
      this.nationalMatch.recordServerDisconnect(clientID, isDisconnected);
      return;
    }
    // Connection status is tracked for every client, but only a player's reaches
    // the simulation: a spectator has no entry in gameStartInfo.players, so an
    // intent naming them refers to nobody — and it is kept in the archived turn
    // log, where readers take mark_disconnected as a player having dropped.
    if (this.clients.get(clientID)?.spectator) return;
    this.addIntent({
      type: "mark_disconnected",
      clientID: clientID,
      isDisconnected: isDisconnected,
    });
  }

  // Archives the game once its winner is settled. Normally the vote settles
  // it, but a vote is only as good as its voters: when they disagree -- some
  // client named a different winner or sent different stats, or the game
  // ended with no majority -- the server replays the game itself and
  // archives what the simulation says. A vote decided by a single IP is
  // replayed too: nobody else confirmed its stats. It is common, though, so
  // when the worker already has LONE_VOTER_REPLAY_CAP replays waiting or
  // running it is archived unconfirmed instead of queued. The record waits for
  // the replay; if the replay fails, the vote's result (if any) goes out
  // instead.
  //
  // The record's statsAgreed says whether its winner and stats were checked:
  // by at least two IPs sending the same ones, or by the replay.
  private settleWinner() {
    const voted = this.winnerVote.winner();
    const candidates = this.winnerVote.candidates();
    const backers = this.winnerVote.backers();
    const votedAgreed = voted !== null && backers >= 2;
    if (candidates === 0 || (candidates === 1 && votedAgreed)) {
      this.archiveGame(voted, votedAgreed);
      return;
    }
    const reason =
      candidates > 1
        ? "disputed"
        : voted !== null
          ? "lone voter"
          : "no majority";
    const pending = this.deps.replayPending();
    if (reason === "lone voter" && pending >= LONE_VOTER_REPLAY_CAP) {
      winnerReplayMetrics.outcomes.skipped++;
      this.log.warn(
        "winner replay queue full, archiving the lone vote unconfirmed",
        {
          gameID: this.id,
          voted: voted?.winner,
          pending,
          cap: LONE_VOTER_REPLAY_CAP,
        },
      );
      this.archiveGame(voted, false);
      return;
    }
    // The record as of now; the game may run on while the replay does.
    const turns = this.turns.slice();
    const endTime = Date.now();
    // A lone voter is the common case (the loser leaves without voting) and
    // its replay almost always agrees, so it logs at info; the replay result
    // still warns when it overturns the vote.
    this.log[reason === "lone voter" ? "info" : "warn"](
      {
        disputed: "winner vote disputed, replaying game",
        "lone voter": "winner vote decided by one IP, replaying game",
        "no majority": "winner vote has no majority, replaying game",
      }[reason],
      {
        gameID: this.id,
        voted: voted?.winner,
        candidates,
        backers,
        turns: turns.length,
      },
    );
    // Set once a record is handed over, so the .catch below falls back to the
    // vote only when nothing was archived.
    let archived = false;
    this.deps
      .replayWinner(this.wireGameStartInfo, turns)
      .then((replayed) => {
        if (replayed === null) {
          winnerReplayMetrics.outcomes.failed++;
          this.log.warn("winner replay failed, archiving the vote", {
            gameID: this.id,
            reason,
            voted: voted?.winner,
            backers,
            statsAgreed: votedAgreed,
          });
          archived = true;
          this.archiveGame(voted, votedAgreed, turns, endTime);
          return;
        }
        const replayedKey = voteKey(replayed);
        const agrees =
          voted === null
            ? replayed.winner === undefined
            : voteKey(voted) === replayedKey;
        const outcome = agrees ? "agreed" : "overturned";
        winnerReplayMetrics.outcomes[outcome]++;
        this.log[agrees ? "info" : "warn"]("winner replay result", {
          gameID: this.id,
          reason,
          voted: voted?.winner,
          replayed: replayed.winner,
          winTick: replayed.tick,
          agrees,
        });
        // A vote is the client's own simulation's result, so an honest,
        // in-sync client votes what the replay found, winner and stats
        // (desynced clients' votes were dropped). One line per voter who
        // didn't, departed ones included, so they can be counted per player:
        // likely cheaters.
        for (const client of this.clients.all().values()) {
          const vote = client.reportedVote;
          if (vote === null || vote.key === replayedKey) {
            continue;
          }
          this.log.warn("wrong winner vote", {
            gameID: this.id,
            publicID: client.publicId,
            clientID: client.clientID,
            voted: vote.winner,
            replayed: replayed.winner,
            // The winner was right, only the stats differed.
            wrongStats:
              JSON.stringify(vote.winner ?? null) ===
              JSON.stringify(replayed.winner ?? null),
            outcome,
          });
        }
        archived = true;
        this.archiveGame(replayed, true, turns, endTime);
      })
      .catch((error) => {
        this.log.error(`error archiving replayed game: ${error}`, {
          gameID: this.id,
          reason,
        });
        // A replay that threw is a failed replay: the vote's result goes out,
        // as when the replay answers null.
        if (archived) return;
        winnerReplayMetrics.outcomes.failed++;
        this.archiveGame(voted, votedAgreed, turns, endTime);
      });
  }

  private archiveGame(
    winner: { winner?: Winner; allPlayersStats: AllPlayersStats } | null,
    // See GameEndInfoSchema.statsAgreed and settleWinner.
    statsAgreed: boolean,
    turns: Turn[] = this.turns,
    endTime: number = Date.now(),
  ) {
    this.log.info("archiving game", {
      gameID: this.id,
      winner: winner?.winner,
      statsAgreed,
    });

    // Players must stay in the same order as the game start info.
    const playerRecords: PlayerRecord[] = this.gameStartInfo.players.map(
      (player) => {
        const stats = winner?.allPlayersStats[player.clientID];
        if (stats === undefined) {
          this.log.debug(
            `Unable to find stats for clientID ${player.clientID}`,
          );
        }
        return {
          clientID: player.clientID,
          username: player.username,
          clanTag: player.clanTag,
          persistentID: this.clients.get(player.clientID)?.persistentID ?? "",
          stats,
          cosmetics: player.cosmetics,
          // Simulation inputs: teamIndex pins matchmade teams, friends bias
          // team grouping, isLobbyCreator gates host cheats. Replays rebuild
          // GameStartInfo from these records, so dropping any of them makes
          // the replay diverge from the recorded hashes (desync errors).
          teamIndex: player.teamIndex,
          friends: player.friends,
          isLobbyCreator: player.isLobbyCreator,
        } satisfies PlayerRecord;
      },
    );
    void this.deps.archive(
      createPartialGameRecord(
        this.id,
        this.gameStartInfo.config,
        playerRecords,
        turns,
        this._startTime ?? 0,
        endTime,
        winner?.winner,
        this.createdAt,
        this.visibleAt,
        this.gameStartInfo.tribes,
        [...this.reports.values()],
        this.publicGameType,
        statsAgreed,
      ),
    );
  }

  // A player reporting another. The API resolves both clientIDs through this
  // game's player sessions and drops anything else, so only a started game's
  // players are accepted here. One report per (reporter, reported) pair: the
  // API dedupes per account anyway, and it bounds what one player can file
  // at the number of other players — no separate rate limit needed. Rejects
  // are dropped without a log line: the message is not rate limited, so a
  // logged reject would let one client flood the logs.
  //
  // The record is archived once, when the winner vote resolves (or at
  // end() if it never does), and reports only travel with it — so anything
  // filed after that has nowhere to go and is refused rather than kept.
  private handleReport(client: Client, clientMsg: ClientReportMessage) {
    const { reported, reason } = clientMsg;
    if (
      this.stage !== "started" ||
      this.ended ||
      this.winnerVote.winner() !== null ||
      reported === client.clientID ||
      !this.gameStartInfo.players.some((p) => p.clientID === reported)
    ) {
      return;
    }
    const key = `${client.clientID}:${reported}`;
    if (this.reports.has(key)) return;
    this.reports.set(key, { reportedBy: client.clientID, reported, reason });
    this.log.info("player reported", {
      clientID: client.clientID,
      reported,
      reason,
      gameID: this.id,
    });
  }

  private handleSynchronization() {
    const check = this.desync.check(this.turns.length, this.clients.active());
    if (check === null) {
      return;
    }
    const { turn, mostCommonHash, outOfSyncClients } = check;

    if (outOfSyncClients.length === 0) {
      this.turns[turn].hash = mostCommonHash;
      return;
    }

    const serverDesync = ServerDesyncSchema.safeParse({
      type: "desync",
      turn,
      correctHash: mostCommonHash,
      clientsWithCorrectHash:
        this.clients.active().length - outOfSyncClients.length,
      totalActiveClients: this.clients.active().length,
    });
    if (!serverDesync.success) {
      this.log.warn("failed to create desync message", {
        gameID: this.id,
        error: serverDesync.error,
      });
      return;
    }

    const desyncMsg = encodeServerMessage(serverDesync.data, this.zbinCtx);
    for (const c of this.desync.record(outOfSyncClients)) {
      this.log.info("sending desync to client", {
        gameID: this.id,
        clientID: c.clientID,
        persistentID: c.persistentID,
      });
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(desyncMsg);
      }
    }
  }

  private handleWinner(client: Client, clientMsg: ClientSendWinnerMessage) {
    // Only a running game has a winner to vote on, and the replay that
    // settles a vote needs the start info start() builds.
    if (
      this.stage !== "started" ||
      this.ended ||
      this.desync.isDesynced(client.clientID) ||
      this.isKicked(client.clientID) ||
      this.winnerVote.winner() !== null ||
      client.reportedVote !== null
    ) {
      return;
    }

    const activeUniqueIPs = this.clients.votingUniqueIPs();
    const { key: winnerKey, votes } = this.winnerVote.cast(
      clientMsg,
      client.ip,
    );
    client.reportedVote = { winner: clientMsg.winner, key: winnerKey };

    this.log.info(
      `received winner vote ${clientMsg.winner}, ${votes}/${activeUniqueIPs} votes for this winner`,
      {
        clientID: client.clientID,
      },
    );

    const result = this.winnerVote.tally(activeUniqueIPs);
    if (result === null) {
      return;
    }

    // Vote succeeded
    this.log.info(
      `Winner determined by ${result.votes}/${activeUniqueIPs} active IPs`,
      {
        winnerKey,
      },
    );
    this.settleWinner();
  }

  // Votes are otherwise only tallied when one arrives (handleWinner), so a
  // vote stuck short of a majority would never resolve once the rest of the
  // electorate is gone. In a 1v1 the loser often disconnects within a second
  // of being eliminated — before their own client simulates the win tick and
  // votes — leaving the winner's vote wedged at 1 of 2 and the game archived
  // winnerless (e.g. game s5bcKtj8). Re-tally whenever the electorate
  // shrinks, counting only votes from still-active IPs (see resultAmong).
  private checkWinnerAfterElectorateShrink() {
    if (this.winnerVote.winner() !== null || this.ended) {
      return;
    }
    const activeIPs = new Set(this.clients.active().map((c) => c.ip));
    const result = this.winnerVote.tallyAmong(activeIPs);
    if (result === null) {
      return;
    }
    this.log.info(
      `Winner determined by ${result.votes}/${activeIPs.size} active IPs after electorate shrank`,
    );
    this.settleWinner();
  }

  // Clients each send a live stats snapshot every ~10s tagged with the turn it
  // was taken at. In-sync clients produce an identical snapshot for a given
  // turn, so we reach majority consensus (same IP-weighted vote as the winner)
  // and keep the latest agreed snapshot for the admin bot to read.
  private handleLiveStats(
    client: Client,
    clientMsg: ClientSendLiveStatsMessage,
  ) {
    if (
      this.desync.isDesynced(client.clientID) ||
      this.isKicked(client.clientID)
    ) {
      return;
    }
    this.liveStatsVote.cast(
      client.clientID,
      client.ip,
      clientMsg.stats,
      this.clients.votingUniqueIPs(),
    );
  }

  // Latest majority-agreed live stats snapshot, with players enriched with
  // server-authoritative info the clients don't vote on: the username and
  // current connection status. null until the first consensus.
  public liveStats(): {
    turn: number;
    // The winner's clientID once the game is decided (player win), else null.
    // Server-side (from the winner vote), so the live board can seat the winner
    // without waiting for the post-game record.
    winner: string | null;
    players: (PlayerLiveStats & {
      username: string | null;
      publicID: string | null;
      connected: boolean;
    })[];
  } | null {
    const latest = this.liveStatsVote.latest();
    if (latest === null) {
      return null;
    }
    const w = this.winnerVote.winner()?.winner;
    return {
      turn: latest.turn,
      winner: w?.[0] === "player" ? w[1] : null,
      players: latest.players.map((p) => {
        const client = this.clients.get(p.clientID);
        return {
          ...p,
          username: client?.username ?? null,
          publicID: client?.publicId ?? null,
          connected: !this.isClientDisconnected(p.clientID),
        };
      }),
    };
  }
}
