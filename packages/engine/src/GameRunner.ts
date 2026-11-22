import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllPlayers,
  BuildableUnit,
  GameType,
  GameUpdates,
  HumanDisconnects,
  HumanStatsSnapshot,
  NameViewData,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
  UnitUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import { MapFiles } from "@openfront/engine-api/game/MapFiles";
import {
  ClientID,
  GameConfigSchema,
  GameStartInfo,
  Turn,
} from "@openfront/engine-api/Schemas";
import { packUnitUpdates } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { simpleHash } from "@openfront/engine-lib/Util";
import { EngineConfig } from "./configuration/EngineConfig";
import { DoomsdayClockExecution } from "./execution/DoomsdayClockExecution";
import { Executor } from "./execution/ExecutionManager";
import { RecomputeRailClusterExecution } from "./execution/RecomputeRailClusterExecution";
import { SpawnTimerExecution } from "./execution/SpawnTimerExecution";
import { WinCheckExecution } from "./execution/WinCheckExecution";
import { Game, Player } from "./game/Game";
import { createGame } from "./game/GameImpl";
import { humanDisconnects, humanStatsSnapshot } from "./game/HumanStats";
import { placeName, placeSpawnName } from "./game/NameBoxCalculator";
import { createNationsForGame } from "./game/NationCreation";
import {
  persistNationalHumanSight,
  restoreNationalHumanSight,
} from "./national/observation/HumanSightPersistence";
import { collectLiveNationalObservation } from "./national/observation/LiveObservation";
import { NationalOutboundFilter } from "./national/observation/NationalOutbound";
import {
  actorNationalResults,
  emptyNationalResultDeliveryState,
  initialNationalResultDeliveryState,
  type NationalResultDeliveryState,
} from "./national/observation/NationalPoliticalPacket";
import {
  NationalServerRecipientSession,
  type TrustedNationalServerConnection,
} from "./national/observation/NationalServerOutbound";
import {
  readSnapshotHeader,
  SNAPSHOT_FORMAT_VERSION,
  restoreGame,
  snapshotGame,
} from "./snapshot/GameSnapshot";

export async function createGameRunner(
  gameStart: GameStartInfo,
  clientID: ClientID | undefined,
  map: MapFiles,
  callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
): Promise<GameRunner> {
  return createGameRunnerInternal(gameStart, clientID, map, callBack, false);
}

/**
 * Trusted server ONLY. This factory does not return a raw game-state callback
 * or a viewer-selected identity. The host registers authenticated recipients
 * with the runner and receives only E3-filtered projections.
 */
export async function createTrustedNationalGameRunner(
  gameStart: GameStartInfo,
  map: MapFiles,
): Promise<GameRunner> {
  if (
    gameStart.config.nationalMode !== true ||
    gameStart.config.gameType !== GameType.Private ||
    gameStart.players.length < 2
  ) {
    throw new Error("trusted NATIONAL requires a real Private lobby roster");
  }
  return createGameRunnerInternal(gameStart, undefined, map, () => {}, true);
}

async function createGameRunnerInternal(
  gameStart: GameStartInfo,
  clientID: ClientID | undefined,
  map: MapFiles,
  callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
  trustedServerNational: boolean,
): Promise<GameRunner> {
  const config = new EngineConfig(
    gameStart.config,
    false,
    gameStart.listed,
    false,
    trustedServerNational,
  );
  const gameMap = await loadGameMap(gameStart.config, map);
  const random = new PseudoRandom(simpleHash(gameStart.gameID));

  const humans = gameStart.players.map((p) => {
    return new PlayerInfo(
      p.username,
      PlayerType.Human,
      p.clientID,
      random.nextID(),
      p.isLobbyCreator ?? false,
      p.clanTag,
      p.friends ?? [],
      p.teamIndex ?? null,
    );
  });

  const nations = createNationsForGame(
    gameStart,
    gameMap.nations,
    gameMap.additionalNations,
    humans.length,
    random,
  );

  const game: Game = createGame(
    humans,
    nations,
    gameMap.gameMap,
    gameMap.miniGameMap,
    config,
    gameMap.teamGameSpawnAreas,
  );

  const gr = new GameRunner(
    game,
    new Executor(
      game,
      gameStart.gameID,
      clientID,
      gameStart.tribes?.map((t) => t.name),
    ),
    callBack,
    clientID,
  );
  gr.init();
  return gr;
}

/** The game's maps, from its map's files (which the game takes over). */
function loadGameMap(
  config: Pick<GameStartInfo["config"], "gameMap" | "gameMapSize">,
  map: MapFiles,
) {
  if (map.map !== config.gameMap || map.mapSize !== config.gameMapSize) {
    throw new Error(
      `the game is on ${config.gameMap} (${config.gameMapSize}), ` +
        `the files passed are ${map.map} (${map.mapSize})`,
    );
  }
  return loadTerrainMap(map);
}

/**
 * Rebuilds a runner from a snapshot (see snapshot/README.md). The game resumes
 * at the snapshot's tick: the first turn added afterwards is the turn for
 * that tick. Only runtime details (game id, listing) come from `gameStart`;
 * the config, players and all state come from the snapshot.
 */
export async function createGameRunnerFromSnapshot(
  gameStart: GameStartInfo,
  snapshot: Uint8Array,
  clientID: ClientID | undefined,
  map: MapFiles,
  callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
): Promise<GameRunner> {
  return restoreRunner(gameStart, snapshot, clientID, map, callBack, false);
}

/** Exact Private NATIONAL restore adapter for the authenticated server only. */
export async function createTrustedNationalGameRunnerFromSnapshot(
  gameStart: GameStartInfo,
  snapshot: Uint8Array,
  map: MapFiles,
  source: string,
  tick: number,
): Promise<GameRunner> {
  const header = readSnapshotHeader(snapshot);
  if (
    gameStart.config.nationalMode !== true ||
    gameStart.config.gameType !== GameType.Private ||
    gameStart.listed === true ||
    header.format !== SNAPSHOT_FORMAT_VERSION ||
    header.gitCommit !== source ||
    header.gameID !== gameStart.gameID ||
    header.tick !== tick ||
    JSON.stringify(header.gameConfig) !==
      JSON.stringify(GameConfigSchema.parse(gameStart.config)) ||
    header.humans.length !== gameStart.players.length ||
    header.humans.some((h, i) => h.clientID !== gameStart.players[i]?.clientID)
  ) {
    throw new Error("NATIONAL trusted snapshot header incompatible");
  }
  return restoreRunner(gameStart, snapshot, undefined, map, () => {}, true);
}

async function restoreRunner(
  gameStart: GameStartInfo,
  snapshot: Uint8Array,
  clientID: ClientID | undefined,
  map: MapFiles,
  callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
  trustedServerNational: boolean,
): Promise<GameRunner> {
  const header = readSnapshotHeader(snapshot);
  const gameMap = await loadGameMap(header.gameConfig, map);
  const game = restoreGame(snapshot, {
    config: (gc) =>
      new EngineConfig(
        gc,
        false,
        gameStart.listed,
        false,
        trustedServerNational,
      ),
    gameMap: gameMap.gameMap,
    miniGameMap: gameMap.miniGameMap,
    teamGameSpawnAreas: gameMap.teamGameSpawnAreas,
  });
  // No init(): the snapshot already holds every execution init() adds.
  return new GameRunner(
    game,
    new Executor(
      game,
      gameStart.gameID,
      clientID,
      gameStart.tribes?.map((t) => t.name),
    ),
    callBack,
    clientID,
  );
}

export class GameRunner {
  private turns: Turn[] = [];
  private currTurn = 0;
  private isExecuting = false;

  private playerViewData: Record<PlayerID, NameViewData> = {};

  // Name placements are recomputed periodically; a runner that starts
  // mid-game (restored from a snapshot) computes them on its first tick.
  private viewDataStale = true;

  private lastSpawnTiles = new Map<PlayerID, TileRef>();

  private readonly nationalObserverId: string | null;
  private readonly nationalOutbound: NationalOutboundFilter | null;
  /** Per authenticated recipient; tracks E1's requestId and sequence. */
  private nationalResultDelivery: NationalResultDeliveryState =
    emptyNationalResultDeliveryState();

  // Server-owned NATIONAL: exactly ONE E3 authority per authenticated
  // physical socket. The runner NEVER sends its raw host-only fullPacket
  // through a trusted-recipient callback. E3 owns its sight/receipt cursor.
  private readonly trustedNationalRecipients = new Map<
    ClientID,
    {
      playerId: PlayerID;
      session: NationalServerRecipientSession;
      deliver: (packet: GameUpdateViewData) => void;
    }
  >();

  constructor(
    public game: Game,
    private execManager: Executor,
    private callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
    private readonly viewerClientID?: ClientID,
  ) {
    if (game.config().nationalMode()) {
      // Principal is resolved from the actual game player registry, NEVER
      // from an observerId asserted by a client or packet body.
      const player =
        this.viewerClientID === undefined
          ? null
          : game.playerByClientID(this.viewerClientID);
      this.nationalObserverId = player?.id() ?? null;
      this.nationalOutbound = new NationalOutboundFilter(
        game,
        this.nationalObserverId,
      );
      if (this.nationalObserverId !== null) {
        // Fresh reconnect/restore reads only the Game-owned E1 snapshot hook.
        // Principal identity was resolved from the actual clientID registry.
        this.nationalOutbound.restoreSightMemory(
          restoreNationalHumanSight(game, this.nationalObserverId),
        );
        // Do not replay old success/rejection toasts when reconnecting.
        // Reconnected clients reconstruct truth from nationalPolitics.
        this.nationalResultDelivery = initialNationalResultDeliveryState(
          game,
          game.player(this.nationalObserverId),
        );
      }
    } else {
      this.nationalObserverId = null;
      this.nationalOutbound = null;
    }
  }

  /** Host-authenticated registration; no client-asserted observer/session. */
  public registerTrustedNationalRecipient(
    clientID: ClientID,
    connection: TrustedNationalServerConnection,
    deliver: (packet: GameUpdateViewData) => void,
  ): void {
    if (
      !this.game.config().nationalMode() ||
      this.viewerClientID !== undefined ||
      this.trustedNationalRecipients.has(clientID) ||
      connection.clientID !== clientID ||
      !connection.isConnected() ||
      connection.isSpectator()
    ) {
      throw new Error("invalid trusted NATIONAL recipient registration");
    }
    const player = this.game.playerByClientID(clientID);
    if (!player || player.type() !== PlayerType.Human) {
      throw new Error("trusted NATIONAL recipient is not a real human");
    }
    // E3 owns the ONLY outbound projection and per-socket receipt cursor.
    // Create after verifying E2's independently authenticated seat binding.
    const session = new NationalServerRecipientSession(this.game, connection);
    this.trustedNationalRecipients.set(clientID, {
      playerId: player.id(),
      session,
      deliver,
    });
  }

  public removeTrustedNationalRecipient(clientID: ClientID): void {
    const recipient = this.trustedNationalRecipients.get(clientID);
    recipient?.session.close();
    this.trustedNationalRecipients.delete(clientID);
  }

  /** Principal rights follow the current engine identity, not cached init data. */
  private isCurrentNationalViewer(): boolean {
    return (
      this.nationalObserverId !== null &&
      this.viewerClientID !== undefined &&
      this.game.playerByClientID(this.viewerClientID)?.id() ===
        this.nationalObserverId
    );
  }

  /** Only the authenticated game principal may use NATIONAL private RPCs. */
  isNationalRequesterAuthorized(id: string | number): boolean {
    if (!this.game.config().nationalMode()) return true;
    const principal = this.nationalObserverId;
    if (principal === null || !this.isCurrentNationalViewer()) return false;
    return typeof id === "string"
      ? id === principal
      : this.game.player(principal).smallID() === id;
  }

  /** Fail closed on target tiles outside the authenticated observer's sight. */
  isNationalTileVisible(tile: TileRef): boolean {
    if (!this.game.config().nationalMode()) return true;
    const principal = this.nationalObserverId;
    return (
      principal !== null &&
      this.isCurrentNationalViewer() &&
      Number.isSafeInteger(tile) &&
      tile >= 0 &&
      tile < this.game.width() * this.game.height() &&
      collectLiveNationalObservation(this.game, principal).visibleTiles.has(
        tile,
      )
    );
  }

  /** A coordinate query may not probe another nation's unseen territory. */
  isNationalCoordinateVisible(x?: number, y?: number): boolean {
    if (!this.game.config().nationalMode()) return true;
    const principal = this.nationalObserverId;
    if (principal === null || !this.isCurrentNationalViewer()) return false;
    if (x === undefined && y === undefined) return true;
    if (
      x === undefined ||
      y === undefined ||
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      !this.game.isValidCoord(x, y)
    )
      return false;
    return collectLiveNationalObservation(
      this.game,
      principal,
    ).visibleTiles.has(this.game.ref(x, y));
  }

  /** Signed/stamped turn intents must match the authentic NATIONAL player. */
  isNationalIntentAuthorized(clientID: ClientID): boolean {
    if (!this.game.config().nationalMode()) return true;
    return this.isCurrentNationalViewer() && this.viewerClientID === clientID;
  }

  /**
   * Serializes the simulation at the current tick boundary. Turns that were
   * added but not executed yet are not part of it.
   */
  snapshot(gitCommit?: string): Uint8Array {
    if (this.isExecuting) {
      throw new Error("cannot snapshot while a tick is executing");
    }
    return snapshotGame(this.game, {
      gameID: this.execManager.gameID(),
      gitCommit,
    });
  }

  init() {
    if (this.game.config().gameConfig().gameType !== GameType.Singleplayer) {
      this.game.addExecution(new SpawnTimerExecution());
    }
    if (this.game.config().spawnNations()) {
      this.game.addExecution(...this.execManager.nationExecutions());
    }
    if (this.game.config().isRandomSpawn()) {
      this.game.addExecution(...this.execManager.spawnPlayers());
    }
    if (this.game.config().bots() > 0) {
      this.game.addExecution(
        ...this.execManager.spawnTribes(this.game.config().bots()),
      );
    }
    this.game.addExecution(new WinCheckExecution());
    if (this.game.config().doomsdayClockConfig().enabled) {
      this.game.addExecution(new DoomsdayClockExecution());
    }
    if (!this.game.config().isUnitDisabled(UnitType.Factory)) {
      this.game.addExecution(
        new RecomputeRailClusterExecution(this.game.railNetwork()),
      );
    }
  }

  public addTurn(turn: Turn): void {
    this.turns.push(turn);
  }

  public executeNextTick(pendingTurns?: number): boolean {
    if (this.isExecuting) {
      return false;
    }
    if (this.currTurn >= this.turns.length) {
      return false;
    }
    this.isExecuting = true;

    this.game.addExecution(
      ...this.execManager.createExecs(this.turns[this.currTurn]),
    );
    this.currTurn++;

    const wasInSpawnPhase = this.game.inSpawnPhase();
    let updates: GameUpdates;
    let tickExecutionDuration: number;

    try {
      const startTime = performance.now();
      updates = this.game.executeNextTick();
      const endTime = performance.now();
      tickExecutionDuration = endTime - startTime;
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error("Game tick error:", error.message);
        this.callBack({
          errMsg: error.message,
          stack: error.stack,
        } as ErrorUpdate);
      } else {
        console.error("Game tick error:", error);
      }
      this.isExecuting = false;
      return false;
    }

    // Track whether placements were recomputed this tick — the record is
    // only attached to the update when it could have changed, so the main
    // thread doesn't structured-clone an identical ~all-players record on
    // every other tick.
    let viewDataChanged = false;
    if (this.game.inSpawnPhase()) {
      for (const p of this.game.allPlayers()) {
        const spawnTile = p.spawnTile();
        if (spawnTile === undefined) continue;
        if (this.lastSpawnTiles.get(p.id()) !== spawnTile) {
          this.lastSpawnTiles.set(p.id(), spawnTile);
          this.playerViewData[p.id()] = placeSpawnName(this.game, p);
          viewDataChanged = true;
        }
      }
    }

    const spawnJustEnded = wasInSpawnPhase && !this.game.inSpawnPhase();
    if (
      spawnJustEnded ||
      (!this.game.inSpawnPhase() && this.lastSpawnTiles.size > 0)
    ) {
      this.lastSpawnTiles.clear();
    }
    if (
      spawnJustEnded ||
      (!this.game.inSpawnPhase() &&
        (this.viewDataStale ||
          this.game.ticks() < 3 ||
          this.game.ticks() % 30 === 0))
    ) {
      this.viewDataStale = false;
      this.playerViewData = {};
      for (const p of this.game.players()) {
        this.playerViewData[p.id()] = placeName(this.game, p);
      }
      viewDataChanged = true;
    }

    const packedTileUpdates = this.game.drainPackedTileUpdates();
    const packedMotionPlans = this.game.drainPackedMotionPlans();
    const packedPlayerUpdates = this.game.drainPackedPlayerUpdates();
    const packedAttackUpdates = this.game.drainPackedAttackUpdates();
    const nukeImpactTiles = this.game.drainNukeImpacts();
    const packedNukeImpacts =
      nukeImpactTiles.length > 0 ? new Uint32Array(nukeImpactTiles) : undefined;

    let packedUnitUpdates: Float64Array | undefined;
    let packedMissileTimers: Uint32Array | undefined;

    const unitUpdates = updates[GameUpdateType.Unit] as UnitUpdate[];
    if (unitUpdates && unitUpdates.length > 0) {
      const packed = packUnitUpdates(unitUpdates);
      packedUnitUpdates = packed.packedUnitUpdates;
      if (packed.packedMissileTimers.length > 0) {
        packedMissileTimers = packed.packedMissileTimers;
      }
      // Clear the original array so it's not structured-cloned
      updates[GameUpdateType.Unit] = [];
    }

    // E1's detached public political view is the sole source for NATIONAL
    // roster, crisis and victory UI. A queued intent is never an acceptance.
    const nationalPolitics = this.game.config().nationalMode()
      ? this.game.nationalPublicPoliticalView()
      : null;
    const fullPacket: GameUpdateViewData = {
      ...(nationalPolitics === null ? {} : { nationalPolitics }),
      tick: this.game.ticks(),
      packedTileUpdates,
      ...(packedMotionPlans ? { packedMotionPlans } : {}),
      ...(packedPlayerUpdates ? { packedPlayerUpdates } : {}),
      ...(packedAttackUpdates ? { packedAttackUpdates } : {}),
      ...(packedNukeImpacts ? { packedNukeImpacts } : {}),
      ...(packedUnitUpdates ? { packedUnitUpdates } : {}),
      ...(packedMissileTimers ? { packedMissileTimers } : {}),
      updates: updates,
      // A copy: hosts hold several ticks' updates before reading them, and
      // the record changes in place on later ticks.
      ...(viewDataChanged
        ? { playerNameViewData: { ...this.playerViewData } }
        : {}),
      tickExecutionDuration: tickExecutionDuration,
      pendingTurns: pendingTurns ?? 0,
    };
    // One canonical host-only engine tick: N E3 recipient sessions project
    // from that SAME authoritative Game, before any socket-facing callback.
    // Never expose raw fullPacket, game state or unfiltered E1 journals.
    for (const [clientID, recipient] of this.trustedNationalRecipients) {
      const player = this.game.playerByClientID(clientID);
      if (
        !player ||
        player.id() !== recipient.playerId ||
        player.type() !== PlayerType.Human
      ) {
        this.removeTrustedNationalRecipient(clientID);
        continue;
      }
      const projected = recipient.session.projectGameUpdate(fullPacket);
      if (projected === null) {
        this.removeTrustedNationalRecipient(clientID);
        continue;
      }
      recipient.deliver(projected);
    }
    if (this.nationalOutbound !== null) {
      // A takeover/disconnection may revoke the original player binding.
      // Do not keep sending the prior principal's private fields or units.
      if (!this.isCurrentNationalViewer()) {
        this.callBack(
          new NationalOutboundFilter(this.game, null).project(
            this.game,
            fullPacket,
            null,
          ),
        );
      } else {
        const verified = collectLiveNationalObservation(
          this.game,
          this.nationalObserverId!,
        );
        const results = actorNationalResults(
          this.game,
          this.game.player(this.nationalObserverId!),
          this.nationalResultDelivery,
        );
        const authenticatedPacket: GameUpdateViewData = results.length
          ? ({
              ...fullPacket,
              // E2 owns the GameUpdates type extension for further political
              // kinds. E3 only attaches types read from E1's real journal.
              nationalCommandResults: results,
            } as unknown as GameUpdateViewData)
          : fullPacket;
        const projected = this.nationalOutbound.project(
          this.game,
          authenticatedPacket,
          verified,
        );
        // Advance and persist this authenticated human's sight at the
        // canonical tick boundary before delivery or a subsequent snapshot.
        const currentViewer = this.game.player(this.nationalObserverId!);
        // E1's canonical snapshot writer admits only a living, spawned human.
        // Pre-spawn packets and eliminated players must never throw or
        // re-create a revoked human memory entry.
        if (
          currentViewer.type() === PlayerType.Human &&
          currentViewer.hasSpawned() &&
          currentViewer.isAlive()
        ) {
          persistNationalHumanSight(
            this.game,
            currentViewer.id(),
            this.nationalOutbound.snapshotSightMemory(),
          );
        }
        this.callBack(projected);
      }
    } else {
      this.callBack(fullPacket);
    }
    this.isExecuting = false;
    return true;
  }

  public pendingTurns(): number {
    return Math.max(0, this.turns.length - this.currTurn);
  }

  public playerBuildables(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[],
    includeBuildPreview = false,
  ): BuildableUnit[] {
    const player = this.game.player(playerID);
    const tile =
      x !== undefined && y !== undefined ? this.game.ref(x, y) : null;
    return player.buildableUnits(tile, units, includeBuildPreview);
  }

  public playerActions(
    playerID: PlayerID,
    x?: number,
    y?: number,
    units?: readonly PlayerBuildableUnitType[] | null,
  ): PlayerActions {
    const player = this.game.player(playerID);
    const tile =
      x !== undefined && y !== undefined ? this.game.ref(x, y) : null;
    const actions = {
      canAttack: tile !== null && player.canAttack(tile),
      buildableUnits: units === null ? [] : player.buildableUnits(tile, units),
      canSendEmojiAllPlayers: player.canSendEmoji(AllPlayers),
      canEmbargoAll: player.canEmbargoAll(),
    } as PlayerActions;

    if (tile !== null && this.game.hasOwner(tile)) {
      const other = this.game.owner(tile) as Player;
      actions.interaction = {
        sharedBorder: player.sharesBorderWith(other),
        canSendEmoji: player.canSendEmoji(other),
        canTarget: player.canTarget(other),
        canSendAllianceRequest: player.canSendAllianceRequest(other),
        canBreakAlliance: player.isAlliedWith(other),
        canDonateGold: player.canDonateGold(other),
        canDonateTroops: player.canDonateTroops(other),
        canEmbargo: !player.hasEmbargoAgainst(other),
        allianceInfo: player.allianceInfo(other) ?? undefined,
      };
    }

    return actions;
  }

  public playerProfile(playerID: number): PlayerProfile {
    const player = this.game.playerBySmallID(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return player.playerProfile();
  }
  public humanDisconnects(): HumanDisconnects {
    return humanDisconnects(this.game);
  }
  public humanStats(): HumanStatsSnapshot {
    return humanStatsSnapshot(this.game);
  }

  public playerBorderTiles(playerID: PlayerID): PlayerBorderTiles {
    const player = this.game.player(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return {
      // Copy into a plain Set: this result crosses the worker boundary via
      // structured clone, which TileSet does not survive.
      borderTiles: new Set(player.borderTiles()),
    } as PlayerBorderTiles;
  }

  public attackClusteredPositions(
    playerID: number,
    attackID?: string,
  ): { id: string; positions: { x: number; y: number }[] }[] {
    const player = this.game.playerBySmallID(playerID);
    if (!player.isPlayer())
      throw new Error(`player with id ${playerID} not found`);
    const all = [...player.outgoingAttacks(), ...player.incomingAttacks()];
    const attacks = attackID ? all.filter((a) => a.id() === attackID) : all;

    return attacks.map((a) => ({
      id: a.id(),
      positions: a.clusteredPositions().map((tile) => ({
        x: this.game.map().x(tile),
        y: this.game.map().y(tile),
      })),
    }));
  }

  public bestTransportShipSpawn(
    playerID: PlayerID,
    targetTile: TileRef,
  ): TileRef | false {
    const player = this.game.player(playerID);
    if (!player.isPlayer()) {
      throw new Error(`player with id ${playerID} not found`);
    }
    return player.bestTransportShipSpawn(targetTile);
  }
}
