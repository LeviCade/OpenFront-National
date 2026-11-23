import { AllPlayersStats, ClientID, Winner } from "../Schemas";
import { TileRef } from "./GameMap";
import {
  EmojiMessage,
  GameUpdates,
  Gold,
  MessageType,
  NameViewData,
  NukeState,
  PlayerID,
  PlayerType,
  SamLauncherState,
  Team,
  Tick,
  TrainType,
  TransportShipState,
  UnitType,
  WarshipState,
} from "./GameTypes";
import type { NationalImperialAdministrationWire } from "./NationalImperialView";
import type {
  NationalPublicPactView,
  NationalPactDisclosureWireData,
} from "./NationalPactView";

/**
 * PUBLIC NATIONAL politics that may cross the worker boundary. This mirrors
 * E1's NationalPublicPoliticalView using protocol-owned primitive types;
 * never include the private pact terms, troop reserves, treasury, sight,
 * invitations, peace motions or raw WarLedger/LevyLedger snapshots.
 */
export interface NationalPoliticsViewData {
  readonly pacts?: readonly NationalPublicPactView[];
  readonly empires: readonly {
    readonly id: string;
    readonly leaderId: PlayerID;
    readonly memberIds: readonly PlayerID[];
  }[];
  readonly warnings: readonly {
    readonly empireId: string;
    readonly deadlineMs: number;
    readonly remainingMs: number;
    readonly blockedByAssetDisposition: boolean;
  }[];
  readonly victory: {
    readonly sovereignPowerCount: number;
    readonly resolved: boolean;
    readonly prizes: readonly (
      | { readonly kind: "SovereignVictor"; readonly nationId: PlayerID }
      | {
          readonly kind: "ImperialVictor" | "EmpireVictor";
          readonly nationId: PlayerID;
          readonly empireId: string;
        }
    )[];
  } | null;
}

/**
 * PRIVATE accession offers for one authenticated human recipient. This is
 * NOT part of nationalPolitics' public empire roster. E3 selects the viewer
 * from the registered GameRunner principal, not a caller-supplied observerId.
 * Every active recipient packet includes offers: [] when no offer survives;
 * absent entirely for spectators, unverified clients and legacy games.
 * All IDs are detached public political identities, never secret pact terms.
 */
export interface NationalAccessionOffersViewData {
  readonly version: 1;
  readonly recipientId: PlayerID;
  readonly offers: readonly {
    readonly empireId: string;
    readonly candidateId: PlayerID;
    readonly proposerId: PlayerID;
    readonly recipientId: PlayerID;
  }[];
}

/**
 * Single addressed command outcome. The worker MUST select results using its
 * authenticated principal, NOT an observerId supplied by a browser packet.
 * Only that recipient's packet may contain the result. Reason must be a
 * bounded, sanitized public error code/message, never private engine state.
 */
export interface NationalCommandResultViewData {
  readonly recipientId: PlayerID;
  readonly actorId: PlayerID;
  readonly type:
    | "national_found_empire"
    | "national_declare_war"
    | "national_propose_peace"
    | "national_accept_peace"
    | "national_offer_empire"
    | "national_accept_empire"
    | "national_transfer_crown"
    | "national_set_peace_delegation"
    | "national_found_pact"
    | "national_invite_pact"
    | "national_accept_pact"
    | "national_propose_pact_amendment"
    | "national_approve_pact_amendment"
    | "national_betray_pact"
    | "national_expel_pact"
    | "national_imperial_administration";
  readonly accepted: boolean;
  readonly tick: Tick;
  /**
   * E1 canonical command-journal sequence/request receipt when available.
   * E3 must preserve these for replay-safe recipient filtering and dedup.
   */
  readonly sequence?: number;
  readonly requestId?: string;
  /** Public identifier only, when applicable to the actual command. */
  readonly empireId?: string;
  /**
   * E1-verified political target (empire/pact/member as appropriate).
   * Required by the producing E3 political DTO, absent for Found Empire and
   * WAR results. It is NOT a user-supplied privileged actor identity.
   */
  readonly commandTargetId?: string;
  readonly warId?: string;
  readonly motionId?: string;
  readonly reason?: string;
}

/** Private principal-bound coercive diplomacy; never part of public politics. */
export interface NationalUltimatumViewData {
  readonly version: 1;
  readonly recipientId: PlayerID;
  readonly items: readonly {
    readonly id: string;
    readonly issuerId: PlayerID;
    readonly empireId: string;
    readonly targetId: PlayerID;
    readonly role: "issuer" | "recipient";
    readonly threat: "embargo" | "imperial-war";
    readonly issuedTick: number;
    readonly deadlineTick: number;
    readonly phase:
      | "pending"
      | "consented"
      | "decision-required"
      | "acceded"
      | "enforced"
      | "backed-down"
      | "withdrawn"
      | "expired";
    readonly response: "none" | "accept" | "refuse";
    readonly credibility: "pending" | "kept" | "broken" | "void";
    readonly version: number;
    readonly warId: string | null;
    readonly imposedMembers: readonly PlayerID[];
    readonly requestId: string | null;
  }[];
}

export interface NationalAssessmentViewData {
  readonly version: 1;
  readonly recipientId: PlayerID;
  readonly items: readonly {
    readonly targetId: PlayerID;
    readonly paidBy: PlayerID;
    readonly confidence: "coarse-estimate" | "shielded-coarse-estimate";
    readonly effectiveTick: number;
    readonly expiresAtTick: number;
    readonly treasuryGoldBand: {
      readonly lower: string;
      readonly upperExclusive: string;
    };
    readonly militaryTroopsBand: {
      readonly lower: string;
      readonly upperExclusive: string;
    };
  }[];
}
export interface GameUpdateViewData {
  tick: number;
  updates: GameUpdates;
  /** E1 authoritative public-only politics; E3 emits, E4 consumes. */
  nationalPolitics?: NationalPoliticsViewData;
  /**
   * Recipient-only pending accession offers; E3 generates this independently
   * from the public political view. Never synthesize offers from the roster.
   */
  nationalAccessionOffers?: NationalAccessionOffersViewData;
  nationalUltimatums?: NationalUltimatumViewData;
  nationalAssessments?: NationalAssessmentViewData;
  nationalPactDisclosure?: NationalPactDisclosureWireData;
  nationalImperialAdministration?: NationalImperialAdministrationWire;
  /**
   * Outcomes scoped to the authenticated recipient of THIS view only.
   * E3 must filter before serialization; never broadcast the E1 journal.
   */
  nationalCommandResults?: readonly NationalCommandResultViewData[];
  /**
   * Packed tile updates as `[tileRef, state]` uint32 pairs.
   *
   * `tileRef` is a `TileRef` (fits in uint32), and `state` is the packed per-tile
   * state (`uint16`) stored in a `uint32` lane.
   */
  packedTileUpdates: Uint32Array;
  /**
   * Optional packed motion plan records.
   *
   * When present, this buffer is expected to be transferred worker -> main
   * (similar to `packedTileUpdates`) to avoid structured-clone copies.
   */
  packedMotionPlans?: Uint32Array;
  /**
   * Packed unit updates (stride of 21 floats per unit, see UNIT_UPDATE_STRIDE).
   */
  packedUnitUpdates?: Float64Array;
  /**
   * Packed missile timer queues.
   * Format: `[unitId, queueLength, timer1, timer2, ...]`.
   */
  packedMissileTimers?: Uint32Array;
  /**
   * Packed per-player numeric stats as
   * `[smallID, tilesOwned, gold, troops, goldEarned]`
   * float64 quints — the fields that change for nearly every alive player
   * every tick. They travel here (transferred, not structured-cloned) instead
   * of in `PlayerUpdate` object diffs, which only carry them on a player's
   * first emission. Gold is exact in a float64 (game values stay far below
   * 2^53). Absent when no player's stats changed.
   */
  packedPlayerUpdates?: Float64Array;
  /**
   * Packed attack troop-count changes as
   * `[ownerSmallID, direction, index, troops]` float64 quads, where
   * `direction` is 0 for the owner's outgoingAttacks and 1 for
   * incomingAttacks, and `index` addresses that array. Troop counts change
   * every tick for every active attack, so they travel here instead of
   * re-sending whole attack arrays in PlayerUpdate diffs; the arrays
   * themselves are only resent when membership/order/retreating changes —
   * which also guarantees the receiver's indexes line up (see
   * packAttackTroopDeltas). Absent when no attack troop count changed.
   */
  packedAttackUpdates?: Float64Array;
  /**
   * Name placement per player. Only present on ticks where the worker
   * recomputed placements (spawn ticks, the first ticks, every 30th tick,
   * spawn end) — between those the values wouldn't change, so the record is
   * omitted instead of re-cloned every tick. Consumers keep the last applied
   * values.
   */
  playerNameViewData?: Record<string, NameViewData>;
  tickExecutionDuration?: number;
  pendingTurns?: number;
  /**
   * Packed tile refs that were inside a nuke blast radius this tick.
   * Used by the renderer to mark nukeable layer tiles as destroyed.
   * Absent when no nukes detonated.
   */
  packedNukeImpacts?: Uint32Array;
}

/**
 * Direction lane of a `packedAttackUpdates` quad: which of the owner's attack
 * arrays the index addresses. Encoder (PlayerImpl.toUpdate →
 * packAttackTroopDeltas) and decoder (client GameView.update) must both use
 * these.
 */
export const ATTACK_DELTA_OUTGOING = 0;
export const ATTACK_DELTA_INCOMING = 1;

export interface ErrorUpdate {
  errMsg: string;
  stack?: string;
}

export enum GameUpdateType {
  // Tile updates are delivered via `packedTileUpdates` on the outer GameUpdateViewData.
  Tile,
  Unit,
  Player,
  DisplayEvent,
  DisplayChatEvent,
  AllianceRequest,
  AllianceRequestReply,
  BrokeAlliance,
  AllianceExpired,
  AllianceExtension,
  TargetPlayer,
  Emoji,
  Win,
  Hash,
  UnitIncoming,
  BonusEvent,
  RailroadDestructionEvent,
  RailroadConstructionEvent,
  RailroadSnapEvent,
  ConquestEvent,
  EmbargoEvent,
  SpawnPhaseEnd,
  GamePaused,
  DonateEvent,
}

export type GameUpdate =
  | UnitUpdate
  | PlayerUpdate
  | AllianceRequestUpdate
  | AllianceRequestReplyUpdate
  | BrokeAllianceUpdate
  | AllianceExpiredUpdate
  | DisplayMessageUpdate
  | DisplayChatMessageUpdate
  | TargetPlayerUpdate
  | EmojiUpdate
  | WinUpdate
  | HashUpdate
  | UnitIncomingUpdate
  | AllianceExtensionUpdate
  | BonusEventUpdate
  | RailroadConstructionUpdate
  | RailroadDestructionUpdate
  | RailroadSnapUpdate
  | ConquestUpdate
  | EmbargoUpdate
  | SpawnPhaseEndUpdate
  | GamePausedUpdate
  | DonateEventUpdate;

export interface BonusEventUpdate {
  type: GameUpdateType.BonusEvent;
  player: PlayerID;
  tile: TileRef;
  gold: number;
  troops: number;
}

export interface RailroadConstructionUpdate {
  type: GameUpdateType.RailroadConstructionEvent;
  id: number;
  tiles: TileRef[];
}

export interface RailroadDestructionUpdate {
  type: GameUpdateType.RailroadDestructionEvent;
  id: number;
}

export interface RailroadSnapUpdate {
  type: GameUpdateType.RailroadSnapEvent;
  originalId: number;
  newId1: number;
  newId2: number;
  tiles1: TileRef[];
  tiles2: TileRef[];
}

export interface ConquestUpdate {
  type: GameUpdateType.ConquestEvent;
  conquerorId: PlayerID;
  conqueredId: PlayerID;
  gold: Gold;
}

export interface DonateEventUpdate {
  type: GameUpdateType.DonateEvent;
  donationType: "troops" | "gold";
  senderId: PlayerID;
  recipientId: PlayerID;
  amount: bigint;
}

export interface UnitUpdate {
  type: GameUpdateType.Unit;
  unitType: UnitType;
  troops: number;
  id: number;
  ownerID: number;
  lastOwnerID?: number;
  // TODO: make these tilerefs
  pos: TileRef;
  lastPos: TileRef;
  isActive: boolean;
  reachedTarget: boolean;
  warshipState?: WarshipState;
  transportShipState?: TransportShipState;
  nukeState?: NukeState;
  targetable: boolean;
  markedForDeletion: number | false;
  targetUnitId?: number; // Only for trade ships
  targetTile?: TileRef; // Only for nukes
  health?: number;
  underConstruction?: boolean;
  missileTimerQueue: number[];
  level: number;
  hasTrainStation: boolean;
  trainType?: TrainType; // Only for trains
  loaded?: boolean; // Only for trains
  samUpgrade?: SamLauncherState;
}

export interface AttackUpdate {
  attackerID: number;
  targetID: number;
  troops: number;
  id: string;
  retreating: boolean;
}

/**
 * Player snapshot delivered worker -> main thread.
 *
 * Only `type` and `id` are guaranteed. Every other field is omitted when its
 * value matches the previous emission for the same player. The first emission
 * for a player always includes all fields; consumers must handle subsequent
 * partial updates by merging into local state, not overwriting.
 *
 * When adding a field here, also wire it into diffPlayerUpdate() and
 * applyStateUpdate() in PlayerStateUpdate.ts — otherwise it is only ever sent on
 * the first emission and later changes are silently dropped.
 */
export interface PlayerUpdate {
  type: GameUpdateType.Player;
  id: PlayerID;
  nameViewData?: NameViewData;
  clientID?: ClientID | null;
  name?: string;
  displayName?: string;
  clanTag?: string | null;
  nationFlag?: string | null;
  team?: Team;
  smallID?: number;
  playerType?: PlayerType;
  isAlive?: boolean;
  isDisconnected?: boolean;
  killedBy?: ClientID | null;
  deathPosition?: number | null;
  tilesOwned?: number;
  gold?: Gold;
  /** Cumulative ship-trade revenue (changes only on arrivals, so it diffs). */
  tradeGold?: Gold;
  /** Cumulative train revenue: own trains + external stops at own stations. */
  trainGold?: Gold;
  /** Cumulative piracy revenue: captured-ship payouts. */
  piracyGold?: Gold;
  /** Cumulative gold received from all sources (workers, trade, ...). */
  goldEarned?: Gold;
  troops?: number;
  allies?: number[];
  embargoes?: Set<PlayerID>;
  isTraitor?: boolean;
  traitorRemainingTicks?: number;
  inDoomsdayClock?: boolean;
  isDecaying?: boolean;
  markedDoomsdayClockTick?: number;
  targets?: number[];
  outgoingEmojis?: EmojiMessage[];
  outgoingAttacks?: AttackUpdate[];
  incomingAttacks?: AttackUpdate[];
  outgoingAllianceRequests?: PlayerID[];
  alliances?: AllianceView[];
  hasSpawned?: boolean;
  spawnTile?: TileRef;
  betrayals?: number;
  lastDeleteUnitTick?: Tick;
  isLobbyCreator?: boolean;
}

export interface AllianceView {
  id: number;
  other: PlayerID;
  createdAt: Tick;
  expiresAt: Tick;
  hasExtensionRequest: boolean;
}

export interface AllianceRequestUpdate {
  type: GameUpdateType.AllianceRequest;
  requestorID: number;
  recipientID: number;
  createdAt: Tick;
}

export interface AllianceRequestReplyUpdate {
  type: GameUpdateType.AllianceRequestReply;
  request: AllianceRequestUpdate;
  accepted: boolean;
}

export interface BrokeAllianceUpdate {
  type: GameUpdateType.BrokeAlliance;
  traitorID: number;
  betrayedID: number;
  allianceID: number;
}

export interface AllianceExpiredUpdate {
  type: GameUpdateType.AllianceExpired;
  player1ID: number;
  player2ID: number;
}

export interface AllianceExtensionUpdate {
  type: GameUpdateType.AllianceExtension;
  playerID: number;
  allianceID: number;
}

export interface TargetPlayerUpdate {
  type: GameUpdateType.TargetPlayer;
  playerID: number;
  targetID: number;
}

export interface EmojiUpdate {
  type: GameUpdateType.Emoji;
  emoji: EmojiMessage;
}

export interface DisplayMessageUpdate {
  type: GameUpdateType.DisplayEvent;
  message: string;
  messageType: MessageType;
  goldAmount?: bigint;
  playerID: number | null;
  params?: Record<string, string | number>;
  unitID?: number;
  focusPlayerID?: number;
}

export type DisplayChatMessageUpdate = {
  type: GameUpdateType.DisplayChatEvent;
  key: string;
  category: string;
  target: string | undefined;
  playerID: number | null;
  isFrom: boolean;
  recipient: string;
};

export interface WinUpdate {
  type: GameUpdateType.Win;
  allPlayersStats: AllPlayersStats;
  winner: Winner;
}

export interface HashUpdate {
  type: GameUpdateType.Hash;
  tick: Tick;
  hash: number;
}

export interface UnitIncomingUpdate {
  type: GameUpdateType.UnitIncoming;
  unitID: number;
  message: string;
  messageType: MessageType;
  playerID: number;
}

export interface EmbargoUpdate {
  type: GameUpdateType.EmbargoEvent;
  event: "start" | "stop";
  playerID: number;
  embargoedID: number;
}

export interface SpawnPhaseEndUpdate {
  type: GameUpdateType.SpawnPhaseEnd;
  startTick: Tick;
}

export interface GamePausedUpdate {
  type: GameUpdateType.GamePaused;
  paused: boolean;
}
