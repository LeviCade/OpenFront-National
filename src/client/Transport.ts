import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllPlayers,
  GameType,
  Gold,
  PlayerID,
  Tick,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  AllPlayersStats,
  ClientID,
  Intent,
  IntentSchema,
  Winner,
} from "@openfront/engine-api/Schemas";
import {
  CloseCode,
  CloseReason,
  isCloseReason,
  isTerminalClose,
} from "@openfront/shared/CloseCodes";
import {
  EventBus,
  EventConstructor,
  GameEvent,
} from "@openfront/shared/EventBus";
import {
  ClientHashMessage,
  ClientIntentMessage,
  ClientJoinMessage,
  ClientMessage,
  ClientPingMessage,
  ClientRejoinMessage,
  ClientReportMessage,
  ClientSendLiveStatsMessage,
  ClientSendWinnerMessage,
  ClientSpectateMessage,
  LiveStats,
  ReportReason,
  ServerMessage,
} from "@openfront/shared/WireSchemas";
import {
  createGameWireContext,
  decodeServerMessage,
  encodeClientMessage,
} from "@openfront/shared/ZbinWire";
import { ZbContext } from "@openfront/zbin";
import { ClientEnv, NoServerError } from "src/client/ClientEnv";
import { getPlayToken } from "./Auth";
import { LobbyConfig } from "./ClientGameRunner";
import { clientDevice, clientPlatform } from "./ClientPlatform";
import { isDesktopShell } from "./DesktopShell";
import { showInGameConfirm } from "./InGameModal";
import {
  SendKickPlayerIntentEvent,
  SendSpectateEvent,
  SendToggleGameStartTimer,
  SendUpdateGameConfigIntentEvent,
} from "./LobbyEvents";
import { LocalServer } from "./LocalServer";
import { parseNationalAssessmentPurchaseIntent } from "./NationalAssessmentClient";
import type { PactIntent } from "./NationalPactState";
import {
  acceptTrustedNationalPrivateCapability,
  hasTrustedNationalPrivateCapability,
  revokeTrustedNationalPrivateCapability,
  type TrustedNationalStartLike,
} from "./NationalPrivateCapability";
import { parseNationalReconnaissanceIntent } from "./NationalReconPurchase";
import { parseNationalUltimatumIntent } from "./NationalSovereignActions";
import { describeSocketClose } from "./SocketClose";
import { TrustedNationalProjectionRejectedEvent } from "./TrustedNationalSession";
import { homeHref, translateText } from "./Utils";
import { PlayerView } from "./view";

export class PauseGameIntentEvent implements GameEvent {
  constructor(public readonly paused: boolean) {}
}

export class SendAllianceRequestIntentEvent implements GameEvent {
  constructor(
    public readonly requestor: PlayerView,
    public readonly recipient: PlayerView,
  ) {}
}

export class SendBreakAllianceIntentEvent implements GameEvent {
  constructor(
    public readonly requestor: PlayerView,
    public readonly recipient: PlayerView,
  ) {}
}

export class SendUpgradeStructureIntentEvent implements GameEvent {
  constructor(
    public readonly unitId: number,
    public readonly unitType: UnitType,
    public readonly amount: number = 1,
  ) {}
}

export class SendAllianceRejectIntentEvent implements GameEvent {
  constructor(public readonly requestor: PlayerView) {}
}

export class SendAllianceExtensionIntentEvent implements GameEvent {
  constructor(public readonly recipient: PlayerView) {}
}

/**
 * Puts a gate in front of every intent this client sends, or removes it
 * (null). An intent the gate returns false for is dropped. The onboarding
 * tutorial uses it to let through only what its current step asks for.
 */
export class SetIntentGateEvent implements GameEvent {
  constructor(public readonly gate: ((intent: Intent) => boolean) | null) {}
}

export class SendSpawnIntentEvent implements GameEvent {
  constructor(public readonly tile: TileRef) {}
}

/** User-originated NATIONAL founding, stamped by the normal transport. */
export class SendNationalPactIntentEvent implements GameEvent {
  constructor(public readonly intent: PactIntent) {}
}

export class SendNationalSettlementIntentEvent implements GameEvent {
  constructor(public readonly intent: Intent) {}
}

export class SendNationalImperialPolicyIntentEvent implements GameEvent {
  constructor(public readonly intent: Intent) {}
}

/** Ordinary authenticated NATIONAL transport for one paid recon request. */
export class SendNationalReconnaissanceIntentEvent implements GameEvent {
  constructor(public readonly candidate: unknown) {}
}

/** Separate E4 Game-owned 1,200-gold assessment, not a regional recon. */
export class SendNationalAssessmentIntentEvent implements GameEvent {
  constructor(public readonly candidate: unknown) {}
}

/** Typed sovereign action routed through the existing authenticated game seat. */
export class SendNationalUltimatumIntentEvent implements GameEvent {
  constructor(public readonly candidate: unknown) {}
}

export class SendNationalFoundEmpireIntentEvent implements GameEvent {
  constructor(
    public readonly empireId: string,
    public readonly requestId: string,
  ) {}
}

/** National war authority is always resolved by the trusted execution layer. */
export class SendNationalDeclareWarIntentEvent implements GameEvent {
  constructor(
    public readonly scope: "national" | "imperial",
    public readonly nationId: string,
    public readonly targetId: string,
    public readonly targetKind: "nation" | "empire",
    public readonly requestId: string,
  ) {}
}

export class SendNationalProposePeaceIntentEvent implements GameEvent {
  constructor(
    public readonly warId: string,
    public readonly requestId: string,
  ) {}
}

export class SendNationalAcceptPeaceIntentEvent implements GameEvent {
  constructor(
    public readonly motionId: string,
    public readonly requestId: string,
  ) {}
}

/** Request-only political commands; the engine stamps and authorizes actor. */
export class SendNationalOfferEmpireIntentEvent implements GameEvent {
  constructor(
    public readonly empireId: string,
    public readonly candidateId: PlayerID,
    public readonly requestId: string,
  ) {}
}

export class SendNationalAcceptEmpireIntentEvent implements GameEvent {
  constructor(
    public readonly empireId: string,
    public readonly candidateId: PlayerID,
    public readonly requestId: string,
  ) {}
}

export class SendNationalTransferCrownIntentEvent implements GameEvent {
  constructor(
    public readonly empireId: string,
    public readonly successorId: PlayerID,
    public readonly requestId: string,
  ) {}
}

/** Signals loss/reestablishment of a verified game transport session. */
export class NationalTransportStatusEvent implements GameEvent {
  constructor(
    public readonly ready: boolean,
    public readonly gameID: string,
  ) {}
}

export class SendAttackIntentEvent implements GameEvent {
  constructor(
    public readonly targetID: PlayerID | null,
    public readonly troops: number,
  ) {}
}

/**
 * Troops for a counter-attack: the incoming attack's size, capped at what the
 * player would send. An attack whose count is not a finite number is ignored
 * rather than turning the whole intent into NaN.
 */
export function counterAttackTroops(
  incomingTroops: number,
  available: number,
): number {
  if (!Number.isFinite(incomingTroops)) return available;
  return Math.min(incomingTroops, available);
}

export class SendBoatAttackIntentEvent implements GameEvent {
  constructor(
    public readonly dst: TileRef,
    public readonly troops: number,
  ) {}
}

export class BuildUnitIntentEvent implements GameEvent {
  constructor(
    public readonly unit: UnitType,
    public readonly tile: TileRef,
    public readonly rocketDirectionUp?: boolean,
    public readonly amount?: number,
  ) {}
}

export class SendTargetPlayerIntentEvent implements GameEvent {
  constructor(public readonly targetID: PlayerID) {}
}

export class SendEmojiIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView | typeof AllPlayers,
    public readonly emoji: number,
  ) {}
}

export class SendDonateGoldIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly gold: Gold | null,
  ) {}
}

export class SendDonateTroopsIntentEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly troops: number | null,
  ) {}
}

export class SendQuickChatEvent implements GameEvent {
  constructor(
    public readonly recipient: PlayerView,
    public readonly quickChatKey: string,
    public readonly target?: PlayerID,
  ) {}
}

export class SendEmbargoIntentEvent implements GameEvent {
  constructor(
    public readonly target: PlayerView,
    public readonly action: "start" | "stop",
  ) {}
}

export class SendEmbargoAllIntentEvent implements GameEvent {
  constructor(public readonly action: "start" | "stop") {}
}

export class SendDeleteUnitIntentEvent implements GameEvent {
  constructor(public readonly unitId: number) {}
}

export class CancelAttackIntentEvent implements GameEvent {
  constructor(public readonly attackID: string) {}
}

export class CancelBoatIntentEvent implements GameEvent {
  constructor(public readonly unitID: number) {}
}

export class SendWinnerEvent implements GameEvent {
  constructor(
    public readonly winner: Winner,
    public readonly allPlayersStats: AllPlayersStats,
  ) {}
}
export class SendLiveStatsEvent implements GameEvent {
  constructor(public readonly stats: LiveStats) {}
}
export class SendPlayerReportEvent implements GameEvent {
  constructor(
    public readonly reported: ClientID,
    public readonly reason: ReportReason,
  ) {}
}
// Emitted once a report has actually gone to the server, so the UI only
// marks a player as reported when it has been.
export class PlayerReportedEvent implements GameEvent {
  constructor(public readonly reported: ClientID) {}
}
export class SendHashEvent implements GameEvent {
  constructor(
    public readonly tick: Tick,
    public readonly hash: number,
  ) {}
}

// Emitted when the server tells us the host started a successor lobby, carrying
// the new game id to move the group to.
export class NewLobbyEvent implements GameEvent {
  constructor(public readonly gameID: string) {}
}

export class MoveWarshipIntentEvent implements GameEvent {
  constructor(
    public readonly unitIds: number[],
    public readonly tile: number,
  ) {}
}

// One-shot marker that this lobby has already sent us to a sibling, so a
// redirect can never become a bounce.
const poolRedirectLatch = (gameID: string) => `pool-redirect:${gameID}`;

// The lobby a redirect came FROM, carried across the navigation: the latch is
// keyed by the source, but only the target can see that the redirect worked.
const POOL_REDIRECT_FROM = "pool-redirect-from";

export class Transport {
  // Retry budget for a dropped game socket. The first retry is immediate (a
  // blip should not cost a second), then exponential from the base to the
  // cap with +/-25% jitter: about 90s nominal over ten attempts, 68-113s with
  // jitter — enough to ride out a router reboot or a worker restart, short
  // enough not to leave a frozen map on screen for minutes. Every requester
  // (onclose, ClientGameRunner's silence watchdog, a send on a closed
  // socket) goes through scheduleReconnect, so this is the only budget.
  static readonly RECONNECT_MAX_ATTEMPTS = 10;
  static readonly RECONNECT_BASE_DELAY_MS = 1000;
  static readonly RECONNECT_MAX_DELAY_MS = 15_000;

  private socket: WebSocket | null = null;

  private localServer: LocalServer;

  private buffer: ClientMessage[] = [];

  private onconnect: () => void;
  private onmessage: (msg: ServerMessage) => void;

  private pingInterval: number | null = null;
  private reconnectTimeout: number | null = null;
  // Consecutive retries that have not yet produced a server frame.
  private reconnectAttempts = 0;
  public readonly isLocal: boolean;
  // Latched by a terminal close (a rejection the server will repeat), by
  // exhausting the reconnect budget, and by leaving the game. Blocks
  // scheduleReconnect and connectRemote so nothing reopens the socket.
  private connectionRefused = false;

  // True once the server has responded to join/rejoin (via start or lobby_info),
  // proving the session is admitted and ready to accept gameplay intents.
  private isSessionReady = false;
  private nationalStreamRejected = false;
  /** Exact server start seat on this socket, not a lobby-config assertion. */
  private trustedNationalStart: {
    gameStartInfo: NonNullable<LobbyConfig["gameStartInfo"]>;
    clientID: string | null;
  } | null = null;

  // clientID dictionary for the binary wire (see ZbinWire.ts), seeded from
  // the roster in the start message. Null until the game starts, which is
  // also the last moment a peer can send a dictionary-encoded field.
  private zbinCtx: ZbContext | null = null;

  private intentGate: ((intent: Intent) => boolean) | null = null;

  // The bus outlives the transport (one per page, one transport per join),
  // so every subscription must be undone in leaveGame or a superseded
  // transport keeps answering the live game's events.
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private lobbyConfig: LobbyConfig,
    private eventBus: EventBus,
  ) {
    // If gameRecord is not null, we are replaying an archived game.
    // For multiplayer games, GameConfig is not known until game starts.
    this.isLocal =
      this.lobbyConfig.gameRecord !== undefined ||
      this.lobbyConfig.gameStartInfo?.config.gameType === GameType.Singleplayer;

    this.subscribe(SendAllianceRequestIntentEvent, (e) =>
      this.onSendAllianceRequest(e),
    );
    this.subscribe(SendAllianceRejectIntentEvent, (e) =>
      this.onAllianceRejectUIEvent(e),
    );
    this.subscribe(SendAllianceExtensionIntentEvent, (e) =>
      this.onSendAllianceExtensionIntent(e),
    );
    this.subscribe(SendBreakAllianceIntentEvent, (e) =>
      this.onBreakAllianceRequestUIEvent(e),
    );
    this.subscribe(SetIntentGateEvent, (e) => (this.intentGate = e.gate));
    this.subscribe(TrustedNationalProjectionRejectedEvent, (e) => {
      if (e.gameID !== this.lobbyConfig.gameID || this.isLocal) return;
      if (
        !this.trustedNationalStart &&
        !hasTrustedNationalPrivateCapability(this.eventBus, e.gameID)
      )
        return;
      this.rejectNationalStream();
    });
    this.subscribe(SendSpawnIntentEvent, (e) => this.onSendSpawnIntentEvent(e));
    this.subscribe(SendNationalPactIntentEvent, (e) => {
      if (this.nationalDiplomacyWireEnabled()) this.sendIntent(e.intent);
    });
    this.subscribe(SendNationalReconnaissanceIntentEvent, (e) => {
      if (!this.nationalDiplomacyWireEnabled()) return;
      const parsed = parseNationalReconnaissanceIntent(e.candidate);
      if (parsed !== null) this.sendIntent(parsed);
    });
    this.subscribe(SendNationalAssessmentIntentEvent, (e) => {
      if (!this.nationalDiplomacyWireEnabled()) return;
      const parsed = parseNationalAssessmentPurchaseIntent(e.candidate);
      if (parsed === null) return;
      // The E4 schema/engine owns this new intent variant. This adapter does
      // not change IntentSchema or bypass the authenticated sendIntent gate.
      this.sendIntent(parsed as unknown as Intent);
    });
    this.subscribe(SendNationalUltimatumIntentEvent, (e) => {
      if (!this.nationalDiplomacyWireEnabled()) return;
      const parsed = parseNationalUltimatumIntent(e.candidate);
      if (parsed !== null) this.sendIntent(parsed);
    });
    this.subscribe(SendNationalSettlementIntentEvent, (e) => {
      if (!this.nationalDiplomacyWireEnabled()) return;
      const parsed = IntentSchema.safeParse(e.intent);
      if (
        parsed.success &&
        (parsed.data.type === "national_offer_sanction_settlement" ||
          parsed.data.type === "national_decide_sanction_settlement")
      )
        this.sendIntent(parsed.data);
    });
    this.subscribe(SendNationalImperialPolicyIntentEvent, (e) => {
      if (!this.nationalDiplomacyWireEnabled()) return;
      const parsed = IntentSchema.safeParse(e.intent);
      if (
        parsed.success &&
        String(parsed.data.type) === "national_imperial_administration"
      )
        this.sendIntent(parsed.data);
    });
    this.subscribe(SendNationalFoundEmpireIntentEvent, (e) =>
      this.onSendNationalFoundEmpireIntent(e),
    );
    this.subscribe(SendNationalDeclareWarIntentEvent, (e) =>
      this.onSendNationalDeclareWarIntent(e),
    );
    this.subscribe(SendNationalProposePeaceIntentEvent, (e) =>
      this.onSendNationalProposePeaceIntent(e),
    );
    this.subscribe(SendNationalAcceptPeaceIntentEvent, (e) =>
      this.onSendNationalAcceptPeaceIntent(e),
    );
    this.subscribe(SendNationalOfferEmpireIntentEvent, (e) =>
      this.onSendNationalOfferEmpireIntent(e),
    );
    this.subscribe(SendNationalAcceptEmpireIntentEvent, (e) =>
      this.onSendNationalAcceptEmpireIntent(e),
    );
    this.subscribe(SendNationalTransferCrownIntentEvent, (e) =>
      this.onSendNationalTransferCrownIntent(e),
    );
    this.subscribe(SendAttackIntentEvent, (e) => this.onSendAttackIntent(e));
    this.subscribe(SendUpgradeStructureIntentEvent, (e) =>
      this.onSendUpgradeStructureIntent(e),
    );
    this.subscribe(SendBoatAttackIntentEvent, (e) =>
      this.onSendBoatAttackIntent(e),
    );
    this.subscribe(SendTargetPlayerIntentEvent, (e) =>
      this.onSendTargetPlayerIntent(e),
    );
    this.subscribe(SendEmojiIntentEvent, (e) => this.onSendEmojiIntent(e));
    this.subscribe(SendDonateGoldIntentEvent, (e) =>
      this.onSendDonateGoldIntent(e),
    );
    this.subscribe(SendDonateTroopsIntentEvent, (e) =>
      this.onSendDonateTroopIntent(e),
    );
    this.subscribe(SendQuickChatEvent, (e) => this.onSendQuickChatIntent(e));
    this.subscribe(SendEmbargoIntentEvent, (e) => this.onSendEmbargoIntent(e));
    this.subscribe(SendEmbargoAllIntentEvent, (e) =>
      this.onSendEmbargoAllIntent(e),
    );
    this.subscribe(BuildUnitIntentEvent, (e) => this.onBuildUnitIntent(e));

    this.subscribe(PauseGameIntentEvent, (e) => this.onPauseGameIntent(e));
    this.subscribe(SendWinnerEvent, (e) => this.onSendWinnerEvent(e));
    this.subscribe(SendLiveStatsEvent, (e) => this.onSendLiveStatsEvent(e));
    this.subscribe(SendPlayerReportEvent, (e) =>
      this.onSendPlayerReportEvent(e),
    );
    this.subscribe(SendHashEvent, (e) => this.onSendHashEvent(e));
    this.subscribe(CancelAttackIntentEvent, (e) =>
      this.onCancelAttackIntentEvent(e),
    );
    this.subscribe(CancelBoatIntentEvent, (e) =>
      this.onCancelBoatIntentEvent(e),
    );

    this.subscribe(MoveWarshipIntentEvent, (e) => {
      this.onMoveWarshipEvent(e);
    });

    this.subscribe(SendDeleteUnitIntentEvent, (e) =>
      this.onSendDeleteUnitIntent(e),
    );

    this.subscribe(SendKickPlayerIntentEvent, (e) =>
      this.onSendKickPlayerIntent(e),
    );

    this.subscribe(SendUpdateGameConfigIntentEvent, (e) =>
      this.onSendUpdateGameConfigIntent(e),
    );

    this.subscribe(SendToggleGameStartTimer, (e) =>
      this.onSendToggleGameStartTimer(e),
    );
    this.subscribe(SendSpectateEvent, (e) => {
      const hadTrustedSeat = hasTrustedNationalPrivateCapability(
        this.eventBus,
        this.lobbyConfig.gameID,
      );
      revokeTrustedNationalPrivateCapability(
        this.eventBus,
        this.lobbyConfig.gameID,
      );
      this.dropBufferedNationalIntents();
      if (hadTrustedSeat)
        this.eventBus.emit(
          new NationalTransportStatusEvent(false, this.lobbyConfig.gameID),
        );
      this.lobbyConfig.spectator = e.spectator;
      this.sendMsg({
        type: "spectate",
        spectator: e.spectator,
      } satisfies ClientSpectateMessage);
    });
  }

  private subscribe<T extends GameEvent>(
    eventType: EventConstructor<T>,
    handler: (event: T) => void,
  ) {
    this.eventBus.on(eventType, handler);
    this.unsubscribers.push(() => this.eventBus.off(eventType, handler));
  }

  private startPing() {
    if (this.isLocal) return;
    this.pingInterval ??= window.setInterval(() => {
      if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
        this.sendMsg({
          type: "ping",
          sentAt: Math.floor(performance.now()),
        } satisfies ClientPingMessage);
      }
    }, 5 * 1000);
  }

  private stopPing() {
    if (this.pingInterval) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public connect(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    if (this.isLocal) {
      this.connectLocal(onconnect, onmessage);
    } else {
      this.connectRemote(onconnect, onmessage);
    }
  }

  public updateCallback(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    if (this.isLocal) {
      this.localServer.updateCallback(onconnect, onmessage);
    } else {
      this.onconnect = onconnect;
      this.onmessage = onmessage;
    }
  }

  private connectLocal(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    this.localServer = new LocalServer(
      this.lobbyConfig,
      this.lobbyConfig.gameRecord !== undefined,
      this.eventBus,
    );
    this.localServer.updateCallback(onconnect, onmessage);
    this.localServer.start();
  }

  private connectRemote(
    onconnect: () => void,
    onmessage: (message: ServerMessage) => void,
  ) {
    if (this.connectionRefused) {
      return;
    }
    const hadTrustedSeat = hasTrustedNationalPrivateCapability(
      this.eventBus,
      this.lobbyConfig.gameID,
    );
    this.isSessionReady = false;
    this.trustedNationalStart = null;
    revokeTrustedNationalPrivateCapability(
      this.eventBus,
      this.lobbyConfig.gameID,
    );
    this.dropBufferedNationalIntents();
    if (hadTrustedSeat)
      this.eventBus.emit(
        new NationalTransportStatusEvent(false, this.lobbyConfig.gameID),
      );
    this.startPing();
    this.killExistingSocket();
    // WS origin comes from ClientEnv, resolved per game: the id's letter
    // names the hosting deployment, so a shared lobby link or rejoin works
    // from any shell in the fleet. Own/legacy ids keep the historical
    // behavior (same-origin on web, serverHost on the desktop app).
    // No server known at all (a static page whose list never loaded, and an
    // id whose letter nothing in it carries) means there is no worker to
    // dial. That is a connection that cannot be made, not a bug: route it
    // into the same terminal dialog a refused socket produces rather than
    // letting it escape as an unhandled exception from the join.
    let workerPath: string;
    try {
      workerPath = ClientEnv.gameWorkerPath(this.lobbyConfig.gameID);
    } catch (e) {
      if (!(e instanceof NoServerError)) throw e;
      console.warn("No server for game", this.lobbyConfig.gameID, e);
      this.handleConnectionRefused(CloseReason.Unknown);
      return;
    }
    const socket = new WebSocket(
      `${ClientEnv.gameWsBase(this.lobbyConfig.gameID)}/${workerPath}`,
    );
    this.socket = socket;
    let openedAt: number | null = null;
    let nationalStartSeen = false;
    this.nationalStreamRejected = false;
    // Every frame is a zbin payload; without this they would arrive as Blobs.
    this.socket.binaryType = "arraybuffer";
    this.onconnect = onconnect;
    this.onmessage = onmessage;
    this.socket.onopen = () => {
      openedAt = Date.now();
      console.log("Connected to game server!");
      if (this.socket === null) {
        console.error("socket is null");
        return;
      }
      onconnect();
    };
    this.socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket || this.nationalStreamRejected) return;
      // A frame from the server is the proof the connection is real; onopen
      // is not (a proxy can accept and drop us in a loop). It resets the
      // budget and settles any retry the watchdog scheduled while this
      // socket was silent — left armed, it would tear down the socket that
      // just recovered.
      this.reconnectAttempts = 0;
      this.cancelReconnect();
      try {
        const msg = decodeServerMessage(
          new Uint8Array(event.data as ArrayBuffer),
          this.zbinCtx ?? undefined,
        );
        if (msg.type === "redirect") {
          this.handlePoolRedirect(msg.gameID);
          return;
        }
        if (msg.type === "national_start") {
          // A second start on one physical socket is not a fresh admission.
          if (nationalStartSeen) return;
          nationalStartSeen = true;
        }
        if (msg.type === "start" || msg.type === "national_start") {
          this.trustedNationalStart = {
            gameStartInfo: msg.gameStartInfo,
            clientID: msg.myClientID ?? null,
          };
          // Seed the dictionary from the same players array, in the same
          // order, that the server seeded its own from.
          this.zbinCtx = createGameWireContext(msg.gameStartInfo.players);
        }
        if (msg.type === "lobby_info" || msg.type === "start") {
          // Admitted, so the redirect that sent us here is spent: drop the
          // source's latch so it can route this player again later. Any other
          // frame proves nothing — a full sibling sends an error frame first.
          const from = sessionStorage.getItem(POOL_REDIRECT_FROM);
          if (from !== null) {
            sessionStorage.removeItem(poolRedirectLatch(from));
            sessionStorage.removeItem(POOL_REDIRECT_FROM);
          }
        }
        // E2's native national_start is distinct from legacy "start".
        // On old servers the decoder never produces it: fail closed.
        const trustedStart =
          msg as unknown as Partial<TrustedNationalStartLike>;
        if (trustedStart.type === "national_start") {
          this.trustedNationalStart =
            trustedStart.gameStartInfo &&
            typeof trustedStart.myClientID === "string"
              ? {
                  gameStartInfo: trustedStart.gameStartInfo,
                  clientID: trustedStart.myClientID,
                }
              : null;
          this.isSessionReady = this.trustedNationalStart !== null;
          if (
            this.trustedNationalStart &&
            typeof trustedStart.tick === "number"
          ) {
            acceptTrustedNationalPrivateCapability(
              this.eventBus,
              trustedStart as TrustedNationalStartLike,
              {
                gameID: this.lobbyConfig.gameID,
                start: this.trustedNationalStart.gameStartInfo,
                startClientID: this.trustedNationalStart.clientID,
                remoteSocketOpen:
                  !this.isLocal && socket.readyState === WebSocket.OPEN,
                sessionReady: this.isSessionReady,
                replay: this.lobbyConfig.gameRecord !== undefined,
                spectator: this.lobbyConfig.spectator === true,
              },
            );
          } else {
            revokeTrustedNationalPrivateCapability(
              this.eventBus,
              this.lobbyConfig.gameID,
            );
          }
          // E2 native NATIONAL start seeds the wire dictionary and authenticates readiness.
          this.eventBus.emit(
            new NationalTransportStatusEvent(true, this.lobbyConfig.gameID),
          );
          this.onmessage(msg);
          return;
        }
        if (msg.type === "lobby_info" || msg.type === "start") {
          this.isSessionReady = true;
        }
        if (msg.type === "lobby_info" || msg.type === "start") {
          this.eventBus.emit(
            new NationalTransportStatusEvent(true, this.lobbyConfig.gameID),
          );
        }
        this.flushBuffer();
        this.onmessage(msg);
      } catch (e) {
        if (nationalStartSeen) {
          this.rejectNationalStream();
          this.eventBus.emit(
            new TrustedNationalProjectionRejectedEvent(this.lobbyConfig.gameID),
          );
          console.warn("NATIONAL wire rejected; fresh admission required");
          return;
        }
        // Deliberately NOT the frame. This catch wraps the downstream
        // handler as well as the decode, so it fires on ordinary
        // application errors too — and the desktop shell persists
        // console.error by default, while a lobby_info or start frame
        // carries the game's group token in the clear. For a decode failure
        // the size is the part that actually helps.
        //
        // The size goes in its own argument rather than interpolated into
        // the first one: console.* treats argument one as a format string
        // (%s, %d, %o), so building it from anything that came off the wire
        // is a format-string sink even when the value can only ever be
        // digits (CodeQL js/tainted-format-string).
        const frame =
          event.data instanceof ArrayBuffer
            ? `${event.data.byteLength} bytes`
            : typeof event.data;
        console.error("Error in onmessage handler:", e, "frame:", frame);
        return;
      }
    };
    this.socket.onerror = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket.close();
    };
    this.socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.isSessionReady = false;
      this.trustedNationalStart = null;
      revokeTrustedNationalPrivateCapability(
        this.eventBus,
        this.lobbyConfig.gameID,
      );
      this.dropBufferedNationalIntents();
      this.eventBus.emit(
        new NationalTransportStatusEvent(false, this.lobbyConfig.gameID),
      );
      const detail = describeSocketClose(socket.url, event, openedAt);
      if (event.code === CloseCode.Normal) {
        console.log(`Game socket ${detail}`);
      } else {
        const next = isTerminalClose(event.code)
          ? "not retrying"
          : "reconnecting";
        console.warn(`Game socket ${detail}; ${next}`);
      }
      if (isTerminalClose(event.code)) {
        if (event.code === CloseCode.Normal) {
          // The server ended the session (game over, kick): nothing to say
          // and nothing to retry. Latch, or the silence watchdog would open
          // a fresh socket 5s later only to be refused with "game not found".
          this.connectionRefused = true;
          this.stopPing();
        } else {
          this.handleConnectionRefused(event.reason);
        }
        return;
      }
      this.scheduleReconnect();
    };
  }

  // The lobby we asked for assigned us to a sibling. Getting here twice is
  // ordinary — sent to a sibling, found it full, came back — so the latched
  // branch falls through to the refusal dialog rather than leaving a dead
  // loading screen, the way the WrongWorker recovery below does.
  //
  // The search string is dropped: it belongs to the lobby we asked for, not
  // the one we land on.
  private handlePoolRedirect(gameID: string) {
    const from = this.lobbyConfig.gameID;
    const latch = poolRedirectLatch(from);
    if (sessionStorage.getItem(latch) !== null) {
      this.handleConnectionRefused(CloseReason.PoolRedirect);
      return;
    }
    sessionStorage.setItem(latch, "1");
    sessionStorage.setItem(POOL_REDIRECT_FROM, from);
    window.location.href = ClientEnv.gamePath(gameID);
  }

  private handleConnectionRefused(reason: string) {
    if (this.connectionRefused) {
      return;
    }
    this.connectionRefused = true;
    this.stopPing();
    // WrongWorker: the worker says it doesn't own this game, which means
    // this bundle routed with a stale worker count. One full navigation to
    // the game's own host re-fetches shell + cluster map and re-resolves;
    // the sessionStorage latch stops a loop if the fresh map still
    // misroutes (a real bug), falling through to the dialog instead. Not on
    // desktop: its shell owns navigation and updates its map at boot.
    if (reason === CloseReason.WrongWorker && !isDesktopShell()) {
      const gameID = this.lobbyConfig.gameID;
      const latch = `wrong-worker-redirect:${gameID}`;
      if (sessionStorage.getItem(latch) === null) {
        sessionStorage.setItem(latch, "1");
        // gameNavigateBase, not gameHttpBase: this is a page load, and the
        // HTTP base throws when no game server is known. A tab that got here
        // has one (the worker answered), but a navigation must not depend on
        // that — every page host serves `/game/<id>`.
        window.location.href = `${ClientEnv.gameNavigateBase(gameID)}/game/${gameID}${window.location.search}`;
        return;
      }
    }
    // The reason is a close_reason.* key the server chose. Anything else (a
    // proxy closing on its own, an empty reason) gets the generic text
    // rather than a bare key.
    const reasonKey = isCloseReason(reason) ? reason : CloseReason.Unknown;
    this.showTerminalDialog(
      translateText("error_modal.connection_refused", {
        reason: translateText(reasonKey),
      }),
    );
  }

  // The session is over: say so once, offer the menu, and let the player
  // stay to look at the map if they would rather.
  private showTerminalDialog(message: string) {
    void showInGameConfirm(message, {
      variant: "warning",
      confirmText: translateText("win_modal.exit"),
      cancelText: translateText("common.close"),
    }).then((goHome) => {
      if (goHome) {
        window.location.href = homeHref();
      }
    });
  }

  // Ask for a reconnect. Callers do not decide when (or whether) it happens:
  // one attempt is scheduled at a time, on the backoff schedule, until the
  // budget runs out.
  public reconnect() {
    if (this.isLocal) {
      this.connect(this.onconnect, this.onmessage);
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.connectionRefused || this.reconnectTimeout !== null) {
      return;
    }
    // An attempt is already in flight; let it succeed or fail on its own.
    if (this.socket?.readyState === WebSocket.CONNECTING) {
      return;
    }
    if (this.reconnectAttempts >= Transport.RECONNECT_MAX_ATTEMPTS) {
      console.warn(
        `giving up after ${this.reconnectAttempts} reconnect attempts`,
      );
      this.connectionRefused = true;
      this.stopPing();
      this.showTerminalDialog(translateText("error_modal.connection_lost"));
      return;
    }
    this.reconnectAttempts++;
    const delay = Transport.reconnectDelay(this.reconnectAttempts);
    console.log(
      `reconnect attempt ${this.reconnectAttempts}/${Transport.RECONNECT_MAX_ATTEMPTS} in ${delay} ms`,
    );
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.connectRemote(this.onconnect, this.onmessage);
    }, delay);
  }

  // Delay before the n-th consecutive attempt (1-based).
  static reconnectDelay(attempt: number): number {
    if (attempt <= 1) {
      return 0;
    }
    const nominal = Math.min(
      Transport.RECONNECT_MAX_DELAY_MS,
      Transport.RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 2),
    );
    // Jitter so a fleet of clients dropped by one worker restart does not
    // come back in lockstep.
    return Math.round(nominal * (0.75 + Math.random() * 0.5));
  }

  private cancelReconnect() {
    if (this.reconnectTimeout !== null) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  public turnComplete() {
    if (this.isLocal) {
      this.localServer.turnComplete();
    }
  }

  async joinGame() {
    // Only the first join: the token is short-lived, and a later reconnect
    // must not present one that has since expired.
    const token = this.lobbyConfig.creatorToken ?? (await getPlayToken());
    delete this.lobbyConfig.creatorToken;
    this.sendMsg({
      type: "join",
      gameID: this.lobbyConfig.gameID,
      // Note: clientID is not sent - server assigns it based on persistentID
      username: this.lobbyConfig.playerName,
      clanTag: this.lobbyConfig.playerClanTag ?? null,
      cosmetics: this.lobbyConfig.cosmetics,
      turnstileToken: this.lobbyConfig.turnstileToken,
      token,
      spectator: this.lobbyConfig.spectator,
      gitCommit: ClientEnv.gitCommit(),
      platform: clientPlatform(),
      device: clientDevice(),
    } satisfies ClientJoinMessage);
  }

  async rejoinGame(lastTurn: number) {
    this.sendMsg({
      type: "rejoin",
      gameID: this.lobbyConfig.gameID,
      // Note: clientID is not sent - server looks it up from persistentID in token
      lastTurn: lastTurn,
      token: await getPlayToken(),
      gitCommit: ClientEnv.gitCommit(),
    } satisfies ClientRejoinMessage);
  }

  leaveGame() {
    revokeTrustedNationalPrivateCapability(
      this.eventBus,
      this.lobbyConfig.gameID,
    );
    this.trustedNationalStart = null;
    this.dropBufferedNationalIntents();
    this.eventBus.emit(
      new NationalTransportStatusEvent(false, this.lobbyConfig.gameID),
    );
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
    if (this.isLocal) {
      this.localServer.endGame();
      return;
    }
    // A left game is never rejoined through this transport, whatever still
    // asks (the watchdog, a late send).
    this.connectionRefused = true;
    this.stopPing();
    this.cancelReconnect();
    if (this.socket === null) {
      return;
    }
    if (this.socket.readyState === WebSocket.OPEN) {
      console.log("on stop: leaving game");
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket.readyState,
      );
    }
    this.killExistingSocket();
  }

  private onSendAllianceRequest(event: SendAllianceRequestIntentEvent) {
    this.sendIntent({
      type: "allianceRequest",
      recipient: event.recipient.id(),
    });
  }

  private onAllianceRejectUIEvent(event: SendAllianceRejectIntentEvent) {
    this.sendIntent({
      type: "allianceReject",
      requestor: event.requestor.id(),
    });
  }

  private onBreakAllianceRequestUIEvent(event: SendBreakAllianceIntentEvent) {
    this.sendIntent({
      type: "breakAlliance",
      recipient: event.recipient.id(),
    });
  }

  private onSendAllianceExtensionIntent(
    event: SendAllianceExtensionIntentEvent,
  ) {
    this.sendIntent({
      type: "allianceExtension",
      recipient: event.recipient.id(),
    });
  }

  private onSendNationalFoundEmpireIntent(
    event: SendNationalFoundEmpireIntentEvent,
  ) {
    if (!this.nationalDiplomacyWireEnabled()) return;
    // The wire schema and engine validate the ID and acting client again.
    // Do not stamp a player ID here or create political state on the client.
    // E2 owns the zod wire schema update. A typed variable preserves the
    // additional optional field before that sibling PR is integrated;
    // actor authentication remains the server-stamped clientID.
    const intent = {
      type: "national_found_empire" as const,
      empireId: event.empireId,
      requestId: event.requestId,
    };
    this.sendIntent(intent);
  }

  /**
   * All NATIONAL diplomatic intents use the existing intent gate and trusted
   * client-ID stamping. The UI never supplies an actor principal or a war ID
   * that it invents as authoritative.
   */
  private nationalDiplomacyWireEnabled(): boolean {
    const cfg = this.lobbyConfig.gameStartInfo?.config;
    if (this.lobbyConfig.gameRecord !== undefined || cfg?.nationalMode !== true)
      return false;
    if (cfg.gameType === GameType.Singleplayer) return this.isLocal;
    return (
      cfg.gameType === GameType.Private &&
      !this.isLocal &&
      this.isSessionReady &&
      !this.nationalStreamRejected &&
      this.socket?.readyState === WebSocket.OPEN &&
      this.lobbyConfig.spectator !== true &&
      hasTrustedNationalPrivateCapability(
        this.eventBus,
        this.lobbyConfig.gameID,
      )
    );
  }

  /** The renderer and decoder share one fail-closed transport boundary. */
  private rejectNationalStream(): void {
    this.nationalStreamRejected = true;
    this.isSessionReady = false;
    this.trustedNationalStart = null;
    revokeTrustedNationalPrivateCapability(
      this.eventBus,
      this.lobbyConfig.gameID,
    );
    this.dropBufferedNationalIntents();
  }

  /** Never replay national commands buffered before a socket disconnect. */
  private dropBufferedNationalIntents(): void {
    const cfg = this.lobbyConfig.gameStartInfo?.config;
    // Every prior spawn, attack and diplomatic intent belongs to the old
    // socket/seat. No queued game command may cross an authentication epoch.
    if (cfg?.gameType === GameType.Private && cfg.nationalMode === true) {
      this.buffer = this.buffer.filter((msg) => msg.type !== "intent");
      return;
    }
    this.buffer = this.buffer.filter(
      (msg) =>
        msg.type !== "intent" || !msg.intent.type.startsWith("national_"),
    );
  }

  private onSendNationalDeclareWarIntent(
    event: SendNationalDeclareWarIntentEvent,
  ) {
    if (!this.nationalDiplomacyWireEnabled()) return;
    const intent = {
      type: "national_declare_war" as const,
      scope: event.scope,
      nationId: event.nationId,
      targetId: event.targetId,
      targetKind: event.targetKind,
      requestId: event.requestId,
    };
    this.sendIntent(intent);
  }

  private onSendNationalProposePeaceIntent(
    event: SendNationalProposePeaceIntentEvent,
  ) {
    if (!this.nationalDiplomacyWireEnabled()) return;
    const intent = {
      type: "national_propose_peace" as const,
      warId: event.warId,
      requestId: event.requestId,
    };
    this.sendIntent(intent);
  }

  private onSendNationalAcceptPeaceIntent(
    event: SendNationalAcceptPeaceIntentEvent,
  ) {
    if (!this.nationalDiplomacyWireEnabled()) return;
    const intent = {
      type: "national_accept_peace" as const,
      motionId: event.motionId,
      requestId: event.requestId,
    };
    this.sendIntent(intent);
  }

  private onSendNationalOfferEmpireIntent(
    event: SendNationalOfferEmpireIntentEvent,
  ) {
    if (!this.nationalDiplomacyWireEnabled()) return;
    this.sendIntent({
      type: "national_offer_empire",
      empireId: event.empireId,
      candidateId: event.candidateId,
      requestId: event.requestId,
    });
  }

  private onSendNationalAcceptEmpireIntent(
    event: SendNationalAcceptEmpireIntentEvent,
  ) {
    if (!this.nationalDiplomacyWireEnabled()) return;
    this.sendIntent({
      type: "national_accept_empire",
      empireId: event.empireId,
      candidateId: event.candidateId,
      requestId: event.requestId,
    });
  }

  private onSendNationalTransferCrownIntent(
    event: SendNationalTransferCrownIntentEvent,
  ) {
    if (!this.nationalDiplomacyWireEnabled()) return;
    this.sendIntent({
      type: "national_transfer_crown",
      empireId: event.empireId,
      successorId: event.successorId,
      requestId: event.requestId,
    });
  }

  private onSendSpawnIntentEvent(event: SendSpawnIntentEvent) {
    this.sendIntent({
      type: "spawn",
      tile: event.tile,
    });
  }

  private onSendAttackIntent(event: SendAttackIntentEvent) {
    if (!this.isSendableTroops("attack", event.troops)) return;
    this.sendIntent({
      type: "attack",
      targetID: event.targetID,
      troops: event.troops,
    });
  }

  private onSendBoatAttackIntent(event: SendBoatAttackIntentEvent) {
    if (!this.isSendableTroops("boat", event.troops)) return;
    this.sendIntent({
      type: "boat",
      troops: event.troops,
      dst: event.dst,
    });
  }

  private onSendUpgradeStructureIntent(event: SendUpgradeStructureIntentEvent) {
    this.sendIntent({
      type: "upgrade_structure",
      unit: event.unitType,
      unitId: event.unitId,
      amount: event.amount,
    });
  }

  private onSendTargetPlayerIntent(event: SendTargetPlayerIntentEvent) {
    this.sendIntent({
      type: "targetPlayer",
      target: event.targetID,
    });
  }

  private onSendEmojiIntent(event: SendEmojiIntentEvent) {
    this.sendIntent({
      type: "emoji",
      recipient:
        event.recipient === AllPlayers ? AllPlayers : event.recipient.id(),
      emoji: event.emoji,
    });
  }

  private onSendDonateGoldIntent(event: SendDonateGoldIntentEvent) {
    this.sendIntent({
      type: "donate_gold",
      recipient: event.recipient.id(),
      gold: event.gold ? Number(event.gold) : null,
    });
  }

  private onSendDonateTroopIntent(event: SendDonateTroopsIntentEvent) {
    this.sendIntent({
      type: "donate_troops",
      recipient: event.recipient.id(),
      troops: event.troops,
    });
  }

  private onSendQuickChatIntent(event: SendQuickChatEvent) {
    this.sendIntent({
      type: "quick_chat",
      recipient: event.recipient.id(),
      quickChatKey: event.quickChatKey,
      target: event.target,
    });
  }

  private onSendEmbargoIntent(event: SendEmbargoIntentEvent) {
    this.sendIntent({
      type: "embargo",
      targetID: event.target.id(),
      action: event.action,
    });
  }

  private onSendEmbargoAllIntent(event: SendEmbargoAllIntentEvent) {
    this.sendIntent({
      type: "embargo_all",
      action: event.action,
    });
  }

  private onBuildUnitIntent(event: BuildUnitIntentEvent) {
    this.sendIntent({
      type: "build_unit",
      unit: event.unit,
      tile: event.tile,
      rocketDirectionUp: event.rocketDirectionUp,
      amount: event.amount,
    });
  }

  private onPauseGameIntent(event: PauseGameIntentEvent) {
    this.sendIntent({
      type: "toggle_pause",
      paused: event.paused,
    });
  }

  private onSendWinnerEvent(event: SendWinnerEvent) {
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      this.sendMsg({
        type: "winner",
        winner: event.winner,
        allPlayersStats: event.allPlayersStats,
      } satisfies ClientSendWinnerMessage);
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket?.readyState,
      );
    }
  }

  private onSendLiveStatsEvent(event: SendLiveStatsEvent) {
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      this.sendMsg({
        type: "live_stats",
        stats: event.stats,
      } satisfies ClientSendLiveStatsMessage);
    }
  }

  private onSendPlayerReportEvent(event: SendPlayerReportEvent) {
    // Singleplayer records are client-authored and the API ignores their
    // reports, so there is nowhere for one to go.
    if (this.isLocal) return;
    if (this.socket?.readyState !== WebSocket.OPEN) {
      console.log(
        "WebSocket is not open, dropping report. Current state:",
        this.socket?.readyState,
      );
      return;
    }
    this.sendMsg({
      type: "report",
      reported: event.reported,
      reason: event.reason,
    } satisfies ClientReportMessage);
    this.eventBus.emit(new PlayerReportedEvent(event.reported));
  }

  private onSendHashEvent(event: SendHashEvent) {
    if (this.isLocal || this.socket?.readyState === WebSocket.OPEN) {
      this.sendMsg({
        type: "hash",
        turnNumber: event.tick,
        hash: event.hash,
      } satisfies ClientHashMessage);
    } else {
      console.log(
        "WebSocket is not open. Current state:",
        this.socket?.readyState,
      );
    }
  }

  private onCancelAttackIntentEvent(event: CancelAttackIntentEvent) {
    this.sendIntent({
      type: "cancel_attack",
      attackID: event.attackID,
    });
  }

  private onCancelBoatIntentEvent(event: CancelBoatIntentEvent) {
    this.sendIntent({
      type: "cancel_boat",
      unitID: event.unitID,
    });
  }

  private onMoveWarshipEvent(event: MoveWarshipIntentEvent) {
    this.sendIntent({
      type: "move_warship",
      unitIds: event.unitIds,
      tile: event.tile,
    });
  }

  private onSendDeleteUnitIntent(event: SendDeleteUnitIntentEvent) {
    this.sendIntent({
      type: "delete_unit",
      unitId: event.unitId,
    });
  }

  private onSendKickPlayerIntent(event: SendKickPlayerIntentEvent) {
    this.sendIntent({
      type: "kick_player",
      targetClientID: event.target,
    });
  }

  private onSendUpdateGameConfigIntent(event: SendUpdateGameConfigIntentEvent) {
    this.sendIntent({
      type: "update_game_config",
      config: event.config,
    });
  }

  private onSendToggleGameStartTimer(event: SendToggleGameStartTimer) {
    this.sendIntent({ type: "toggle_game_start_timer" });
  }

  // The intent schemas take troops as a finite float >= 0, and the server
  // kicks a client whose message fails to parse. Drop the one intent instead,
  // and log it with a stack (console.error reaches telemetry) so the caller
  // that produced the bad count shows up.
  private isSendableTroops(type: Intent["type"], troops: number): boolean {
    if (Number.isFinite(troops) && troops >= 0) return true;
    console.error(
      new Error(`Dropped ${type} intent with invalid troops: ${troops}`),
    );
    return false;
  }

  private sendIntent(intent: Intent) {
    const cfg = this.lobbyConfig.gameStartInfo?.config;
    // Host-only NATIONAL Private may accept NO gameplay command before E2
    // authenticates this exact active socket/seat. This includes spawn and
    // Attack, not just diplomacy; legacy Private/Solo remain unchanged.
    if (
      cfg?.gameType === GameType.Private &&
      cfg.nationalMode === true &&
      !this.nationalDiplomacyWireEnabled()
    )
      return;
    if (this.intentGate !== null && !this.intentGate(intent)) return;
    const msg = {
      type: "intent",
      intent: intent,
    } satisfies ClientIntentMessage;
    this.sendMsg(msg);
  }

  private flushBuffer(): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    while (this.buffer.length > 0) {
      console.log("sending dropped message");
      const msg = this.buffer.shift();
      if (msg === undefined) {
        console.warn("msg is undefined");
        continue;
      }
      this.socket.send(encodeClientMessage(msg, this.zbinCtx ?? undefined));
    }
  }

  private sendMsg(msg: ClientMessage): void {
    if (this.connectionRefused) {
      return;
    }
    if (this.isLocal) {
      // Route to the in-process server; nothing goes over the wire.
      this.localServer.onMessage(msg);
      return;
    } else if (this.socket === null) {
      return;
    }

    const isHandshakeMsg =
      msg.type === "join" || msg.type === "rejoin" || msg.type === "ping";

    if (this.socket.readyState !== WebSocket.OPEN) {
      // Buffer the message for the next successful open.
      console.warn("socket not ready, buffering and reconnecting");
      this.buffer.push(msg);
      this.scheduleReconnect();
    } else if (
      !isHandshakeMsg &&
      (!this.isSessionReady || this.buffer.length > 0)
    ) {
      // Hold non-handshake messages until the session handshake is complete,
      // and keep them queued behind any previously buffered messages.
      this.buffer.push(msg);
    } else {
      // Session is ready and nothing is queued ahead: send directly.
      this.socket.send(encodeClientMessage(msg, this.zbinCtx ?? undefined));
    }
  }

  private killExistingSocket(): void {
    this.isSessionReady = false;
    if (this.socket === null) {
      return;
    }
    // Remove all event listeners
    this.socket.onmessage = null;
    this.socket.onopen = null;
    this.socket.onclose = null;
    this.socket.onerror = null;

    // Close the connection if it's still open or still connecting
    try {
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close();
      }
    } catch (e) {
      console.warn("Error while closing WebSocket:", e);
    }

    this.socket = null;
  }
}
