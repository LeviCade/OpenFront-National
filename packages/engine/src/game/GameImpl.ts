import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Cell,
  ColoredTeams,
  Difficulty,
  Duos,
  EmojiMessage,
  GameMode,
  GameType,
  GameUpdates,
  HumansVsNations,
  MessageType,
  Nation,
  PlayerID,
  PlayerInfo,
  PlayerType,
  Quads,
  SpawnArea,
  Team,
  TeamGameSpawnAreas,
  TerrainType,
  TerraNullius,
  Tick,
  Trios,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import {
  NationalConfirmedVictorySchema,
  type NationalConfirmedVictory,
} from "@openfront/engine-api/game/NationalVictoryView";
import {
  ReadonlyTileSet,
  UnitPredicate,
} from "@openfront/engine-api/game/ReadViews";
import {
  AllPlayersStats,
  ClientID,
  GameID,
  Winner,
} from "@openfront/engine-api/Schemas";
import { ATTACK_INDEX_SENT } from "@openfront/engine-api/StatsSchemas";
import { renderNumber } from "@openfront/engine-lib/Format";
import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import {
  MotionPlanRecord,
  packMotionPlans,
} from "@openfront/engine-lib/game/MotionPlans";
import {
  assignTeams,
  resolveTeamsList,
} from "@openfront/engine-lib/game/TeamAssignment";
import { TerraNulliusImpl } from "@openfront/engine-lib/game/TerraNulliusImpl";
import { UnitGrid } from "@openfront/engine-lib/game/UnitGrid";
import {
  readVersioned,
  snapshotType,
  VersionedSchema,
  zInt,
  zPlayerRef,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { EngineConfig } from "../configuration/EngineConfig";
import { AttackExecution } from "../execution/AttackExecution";
import { ConstructionExecution } from "../execution/ConstructionExecution";
import {
  SharedWaterCache,
  SharedWaterCacheSnapshot,
} from "../execution/nation/SharedWaterCache";
import { NationalSanctionExecution } from "../execution/NationalSanctionExecution";
import { NationalUltimatumExecution } from "../execution/NationalUltimatumExecution";
import { NationExecution } from "../execution/NationExecution";
import { SpawnTimerExecution } from "../execution/SpawnTimerExecution";
import { TribeExecution } from "../execution/TribeExecution";
import type {
  DefenseResult,
  IncomingDefense,
  PreparedTroopDebits,
  TroopDebitTransactionAdapter,
  TroopSource,
} from "../national/conflict/DefenseLevy";
import {
  NationalRuntime,
  NationalRuntimeSnapshotSchema,
  type NationalCommand,
  type NationalAccessionOfferView,
  type NationalPublicPoliticalView,
  type NationalPactDisclosureViewData,
  type NationalUngovernableWarning,
  type NationalPublicPactView,
  type NationalRecipientPactView,
  type NationalImperialAdministrationCommand,
  type NationalImperialAdministrationView,
  type NationalEconomicCharterView,
} from "../national/NationalRuntime";
import {
  NationalAssessment,
  NationalAssessmentSnapshotSchema,
  NATIONAL_ASSESSMENT_COST,
  NATIONAL_COUNTERASSESSMENT_COST,
  captureNationalAssessmentBands,
  type NationalAssessmentGrant,
  type NationalAssessmentShield,
} from "../national/observation/NationalAssessment";
import type { NationalSightMemory } from "../national/observation/NationalObservation";
import {
  NationalReconnaissance,
  NationalReconnaissanceSnapshotSchema,
  REGIONAL_RECON_COST,
  type RegionalReconGrant,
} from "../national/observation/NationalReconnaissance";
import {
  NationalGovernanceState,
  NationalGovernanceSnapshotSchema,
  type NationalFoundEmpireResult,
  type NationalPoliticalCommandResult,
  type NationalWarCommandKind,
  type NationalWarCommandOutcome,
} from "../national/politics/NationalGovernanceState";
import {
  NationalWarStateService,
  NationalWarStateSnapshotSchema,
  type NationalWarAuthority,
  type NationalWarCommand,
  type NationalWarStateSnapshot,
} from "../national/politics/NationalWarState";
import {
  PoliticalAuthorityAdapter,
  type NationalPoliticalAuthority,
  type NationalConflictPoliticsPort,
} from "../national/politics/PoliticalAuthorityAdapter";
import type { LastSovereignResult } from "../national/politics/sovereignty";
import { AbstractGraph } from "../pathfinding/algorithms/AbstractGraph";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathFinder } from "../pathfinding/types";
import {
  nationData,
  NationSchema,
  playerInfoData,
  PlayerInfoSchema,
  UnitTypeSchema,
} from "../snapshot/CommonSchemas";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { AllianceImpl } from "./AllianceImpl";
import { AllianceRequestImpl } from "./AllianceRequestImpl";
import {
  Alliance,
  AllianceRequest,
  EngineUnitInfo,
  Execution,
  Game,
  MutableAlliance,
  Player,
  Unit,
} from "./Game";
import { PlayerImpl } from "./PlayerImpl";
import { RailNetwork } from "./RailNetwork";
import {
  createRailNetwork,
  RailNetworkImpl,
  RailNetworkSnapshot,
} from "./RailNetworkImpl";
import { Railroad } from "./Railroad";
import { Stats } from "./Stats";
import { StatsImpl, StatsSnapshot } from "./StatsImpl";
import { WaterManager, WaterManagerSnapshot } from "./WaterManager";

export function createGame(
  humans: PlayerInfo[],
  nations: Nation[],
  gameMap: GameMap,
  miniGameMap: GameMap,
  config: EngineConfig,
  teamGameSpawnAreas?: TeamGameSpawnAreas,
): Game {
  const stats = new StatsImpl();
  return new GameImpl(
    humans,
    nations,
    gameMap,
    miniGameMap,
    config,
    stats,
    teamGameSpawnAreas,
  );
}

export type CellString = string;

export class GameImpl implements Game {
  private _ticks = 0;
  private startTick: number | null = null;

  private unInitExecs: Execution[] = [];

  _players: Map<PlayerID, PlayerImpl> = new Map<PlayerID, PlayerImpl>();
  _playersBySmallID: Player[] = [];

  private execs: Execution[] = [];
  private _width: number;
  private _height: number;
  _terraNullius: TerraNulliusImpl;

  allianceRequests: AllianceRequestImpl[] = [];

  private nextPlayerID = 1;
  private _nextUnitID = 1;

  private updates: GameUpdates = createGameUpdatesMap();
  private tileUpdatePairs: number[] = [];
  private viewResyncQueued = false;
  /** [smallID, tilesOwned, gold, troops] quads — see PlayerImpl.toUpdate. */
  private playerStatsQuads: number[] = [];
  /** [smallID, direction, index, troops] quads — see packAttackTroopDeltas. */
  private attackTroopsQuads: number[] = [];
  private motionPlanRecords: MotionPlanRecord[] = [];
  private planDrivenUnitIds = new Set<number>();
  private unitGrid: UnitGrid<Unit>;
  private _unitMap = new Map<number, Unit>();

  private playerTeams: Team[] = [];
  private botTeam: Team = ColoredTeams.Bot;
  private _railNetwork: RailNetwork = createRailNetwork(this);

  // Used to assign unique IDs to each new alliance
  private nextAllianceID: number = 0;

  private _mirvsLaunched = 0;
  private shipStaggers = { tradeShip: 0, transportShip: 0 };
  private _nationMirvTargets = new Map<PlayerID, Tick>();

  private _isPaused: boolean = false;
  private _winner: Player | Team | null = null;
  private _nationalConfirmedVictory: NationalConfirmedVictory | null = null;
  private _national: NationalRuntime | null = null;
  private _nationalRecon: NationalReconnaissance | null = null;
  private _nationalAssessment: NationalAssessment | null = null;
  /** One persisted principal journal + human sight store per NATIONAL Game. */
  private _nationalGovernance: NationalGovernanceState | null = null;
  /** E2 WAR/LEVY is canonically stored here, never in a WeakMap or fork. */
  private _nationalWar: NationalWarStateService | null = null;
  /** Stable read port resolves the current Game-owned service after restore. */
  private _nationalWarReadPort: Readonly<NationalWarAuthority> | null = null;
  /** Reusable detached read sources; only PlayerImpl owns real troop balances. */
  private readonly _nationalLevySources = new Map<PlayerID, TroopSource>();
  /** Cached query facade; the closure resolves the CURRENT runtime after restore. */
  private _nationalAuthority: PoliticalAuthorityAdapter | null = null;
  private _waterManager: WaterManager;
  private _sharedWaterCache: SharedWaterCache;
  private _teamGameSpawnAreas: TeamGameSpawnAreas | undefined;
  /** Tiles from nuke blast radii this tick, drained by the renderer. */
  private _nukeImpactQueue: TileRef[] = [];

  constructor(
    private _humans: PlayerInfo[],
    private _nations: Nation[],
    private _map: GameMap,
    private miniGameMap: GameMap,
    private _config: EngineConfig,
    private _stats: Stats,
    teamGameSpawnAreas?: TeamGameSpawnAreas,
    // Restoring a snapshot: skip team and player setup, the snapshot
    // supplies both (see restoreState).
    restoring: boolean = false,
  ) {
    const constructorStart = performance.now();

    this._teamGameSpawnAreas = teamGameSpawnAreas;
    this._terraNullius = new TerraNulliusImpl();
    this._width = _map.width();
    this._height = _map.height();
    this.unitGrid = new UnitGrid<Unit>(this._map);
    this._waterManager = new WaterManager(
      this._map,
      this.miniGameMap,
      _config.disableNavMesh(),
    );
    this._sharedWaterCache = new SharedWaterCache(this);

    if (!restoring) {
      if (_config.gameConfig().gameMode === GameMode.Team) {
        this.populateTeams();
      }
      this.addPlayers();
      if (this._config.nationalMode()) {
        this._national = new NationalRuntime(
          this._playersBySmallID.map((p) => p.id()),
        );
        this._nationalGovernance = new NationalGovernanceState();
        this._nationalRecon = new NationalReconnaissance();
        this._nationalAssessment = new NationalAssessment();
        this._nationalWar = new NationalWarStateService(
          this.nationalPoliticalAuthority()!,
          this.nationalTroopDebits(),
        );
      }
    }

    console.log(
      `[GameImpl] Constructor total: ${(performance.now() - constructorStart).toFixed(0)}ms`,
    );
  }

  private populateTeams() {
    const totalPlayers = this._humans.length + this._nations.length;
    this.playerTeams = resolveTeamsList(
      this._config.playerTeams(),
      totalPlayers,
    );
  }

  private addPlayers() {
    if (this.config().gameConfig().gameMode === GameMode.FFA) {
      this._humans.forEach((p) => this.addPlayer(p));
      this._nations.forEach((n) => this.addPlayer(n.playerInfo));
      return;
    }

    if (this._config.playerTeams() === HumansVsNations) {
      this._humans.forEach((p) => this.addPlayer(p, ColoredTeams.Humans));
      this._nations.forEach((n) =>
        this.addPlayer(n.playerInfo, ColoredTeams.Nations),
      );
      return;
    }

    // Team mode
    const allPlayers = [
      ...this._humans,
      ...this._nations.map((n) => n.playerInfo),
    ];
    const pt = this._config.playerTeams();
    const isDuosTriosQuads = pt === Duos || pt === Trios || pt === Quads;
    const playerToTeam = assignTeams(
      allPlayers,
      this.playerTeams,
      isDuosTriosQuads,
    );
    for (const [playerInfo, team] of playerToTeam.entries()) {
      if (team === "kicked") {
        console.warn(`Player ${playerInfo.name} was kicked from team`);
        continue;
      }
      this.addPlayer(playerInfo, team);
    }
  }

  isOnEdgeOfMap(ref: TileRef): boolean {
    return this._map.isOnEdgeOfMap(ref);
  }

  owner(ref: TileRef): Player | TerraNullius {
    return this.playerBySmallID(this.ownerID(ref));
  }

  playerBySmallID(id: number): Player | TerraNullius {
    if (id === 0) {
      return this.terraNullius();
    }
    return this._playersBySmallID[id - 1];
  }
  map(): GameMap {
    return this._map;
  }
  miniMap(): GameMap {
    return this.miniGameMap;
  }

  addUpdate(update: GameUpdate) {
    (this.updates[update.type] as GameUpdate[]).push(update);
  }

  nextUnitID(): number {
    const old = this._nextUnitID;
    this._nextUnitID++;
    return old;
  }

  setFallout(tile: TileRef, value: boolean) {
    if (value && this.hasOwner(tile)) {
      throw Error(`cannot set fallout, tile ${tile} has owner`);
    }
    if (this._map.hasFallout(tile)) {
      return;
    }
    this._territoryVersion++;
    this._map.setFallout(tile, value);
    this.recordTileUpdate(tile);
  }

  setWater(tile: TileRef): void {
    if (!this.isLand(tile)) return;
    if (this.hasOwner(tile)) {
      throw Error(`cannot set water, tile ${tile} has owner`);
    }
    // Clear fallout if present (water tiles shouldn't have fallout)
    if (this._map.hasFallout(tile)) {
      this._map.setFallout(tile, false);
    }
    this._territoryVersion++;
    // Rail paths route around water, so a rail plan must be redone too.
    this._structureVersion++;
    this._map.setWater(tile);
    this.recordTileUpdate(tile);
  }

  queueWaterConversion(tile: TileRef): void {
    if (!this.isLand(tile)) return;
    if (this.hasOwner(tile)) {
      throw Error(`cannot queue water conversion, tile ${tile} has owner`);
    }
    if (!this._config.waterNukes()) {
      this.setFallout(tile, true);
      return;
    }
    this._waterManager.queueTile(tile);
  }

  queueNukeImpact(tile: TileRef): void {
    this._nukeImpactQueue.push(tile);
  }

  drainNukeImpacts(): TileRef[] {
    const tiles = this._nukeImpactQueue;
    this._nukeImpactQueue = [];
    return tiles;
  }

  unit(id: number): Unit | undefined {
    return this._unitMap.get(id);
  }

  units(): Unit[];
  units(types: readonly UnitType[]): Unit[];
  units(type: UnitType, type2?: UnitType, type3?: UnitType): Unit[];
  units(
    first?: UnitType | readonly UnitType[],
    second?: UnitType,
    third?: UnitType,
  ): Unit[] {
    // Built as a single flat array per call; per-player intermediate arrays
    // would churn the heap (player.units() with no args is allocation-free).
    const out: Unit[] = [];
    if (Array.isArray(first) && (first as readonly UnitType[]).length > 0) {
      const ts = new Set(first as readonly UnitType[]);
      for (const p of this._players.values()) {
        for (const u of p.units()) {
          if (ts.has(u.type())) out.push(u);
        }
      }
      return out;
    }
    if (first === undefined || Array.isArray(first)) {
      for (const p of this._players.values()) {
        for (const u of p.units()) {
          out.push(u);
        }
      }
      return out;
    }
    if (second === undefined) {
      const type = first as UnitType;
      // Single-type query: every nation asks for e.g. all transport ships on
      // every tick, and walking every player's unit list each time was ~3 %
      // of a headless game. The memo is exact — it is invalidated by any
      // unit list change — and callers get their own copy.
      const memo = this.unitsByTypeMemo.get(type);
      if (memo !== undefined && memo.version === this._unitsVersion) {
        return memo.units.slice();
      }
      for (const p of this._players.values()) {
        for (const u of p.units()) {
          if (u.type() === type) out.push(u);
        }
      }
      this.unitsByTypeMemo.set(type, {
        version: this._unitsVersion,
        units: out,
      });
      return out.slice();
    }
    for (const p of this._players.values()) {
      for (const u of p.units()) {
        const t = u.type();
        if (t === first || t === second || t === third) {
          out.push(u);
        }
      }
    }
    return out;
  }

  // Level-weighted count of one unit type across every player. Every port asked
  // for the trade-ship count every tick, and the walk over every player's unit
  // list was ~3.5 % of a long headless game. Memoised on the units version, which
  // moves on any unit list change and on every level-up (UnitImpl.increaseLevel).
  private readonly unitCountMemo = new Map<
    UnitType,
    { version: number; count: number }
  >();
  unitCount(type: UnitType): number {
    const memo = this.unitCountMemo.get(type);
    if (memo !== undefined && memo.version === this._unitsVersion) {
      return memo.count;
    }
    let total = 0;
    for (const player of this._players.values()) {
      total += player.unitCount(type);
    }
    this.unitCountMemo.set(type, { version: this._unitsVersion, count: total });
    return total;
  }

  unitInfo(type: UnitType): EngineUnitInfo {
    return this.config().unitInfo(type);
  }

  nations(): Nation[] {
    return this._nations;
  }

  createAllianceRequest(
    requestor: Player,
    recipient: Player,
  ): AllianceRequest | null {
    if (requestor.isAlliedWith(recipient)) {
      console.log("cannot request alliance, already allied");
      return null;
    }
    if (
      recipient
        .incomingAllianceRequests()
        .find((ar) => ar.requestor() === requestor) !== undefined
    ) {
      console.log(`duplicate alliance request from ${requestor.name()}`);
      return null;
    }
    const correspondingReq = requestor
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === recipient);
    if (correspondingReq !== undefined) {
      console.log(`got corresponding alliance requests, accepting`);
      correspondingReq.accept();
      return null;
    }
    const ar = new AllianceRequestImpl(requestor, recipient, this._ticks, this);
    this.allianceRequests.push(ar);
    this.addUpdate(ar.toUpdate());
    return ar;
  }

  acceptAllianceRequest(request: AllianceRequestImpl) {
    this.allianceRequests = this.allianceRequests.filter(
      (ar) => ar !== request,
    );

    const requestor = request.requestor();
    const recipient = request.recipient();

    const existing = requestor.allianceWith(recipient);
    if (existing) {
      throw new Error(
        `cannot accept alliance request, already allied with ${recipient.name()}`,
      );
    }

    // Create and register the new alliance
    const alliance = new AllianceImpl(
      this,
      requestor as PlayerImpl,
      recipient as PlayerImpl,
      this._ticks,
      this.nextAllianceID++,
    );
    (alliance.requestor() as PlayerImpl)._alliances.push(alliance);
    (alliance.recipient() as PlayerImpl)._alliances.push(alliance);
    this.stats().allianceFormed(requestor);
    this.stats().allianceFormed(recipient);
    (request.requestor() as PlayerImpl).pastOutgoingAllianceRequests.push(
      request,
    );

    this.addUpdate({
      type: GameUpdateType.AllianceRequestReply,
      request: request.toUpdate(),
      accepted: true,
    });
  }

  rejectAllianceRequest(request: AllianceRequestImpl) {
    this.allianceRequests = this.allianceRequests.filter(
      (ar) => ar !== request,
    );
    (request.requestor() as PlayerImpl).pastOutgoingAllianceRequests.push(
      request,
    );
    this.addUpdate({
      type: GameUpdateType.AllianceRequestReply,
      request: request.toUpdate(),
      accepted: false,
    });
  }

  hasPlayer(id: PlayerID): boolean {
    return this._players.has(id);
  }
  config(): EngineConfig {
    return this._config;
  }

  /** Sync the identity/territory picture after executions have changed it. */
  private synchronizeNationalState(tick = this._ticks): void {
    if (this._national === null) return;
    // Read the eight live facts from real engine players after each tick.
    const standingCount = (player: Player, type: UnitType): number =>
      player
        .units(type)
        .filter((unit) => unit.isActive() && !unit.isUnderConstruction())
        .length;
    this._national.synchronize(
      this._playersBySmallID.map((p) => ({
        id: p.id(),
        alive: p.isAlive(),
        spawned: p.hasSpawned(),
        metrics: {
          land: p.numTilesOwned(),
          maxPopulation: Math.floor(this._config.maxTroops(p)),
          activePopulation: p.troops(),
          cities: standingCount(p, UnitType.City),
          factories: standingCount(p, UnitType.Factory),
          ports: standingCount(p, UnitType.Port),
          silos: standingCount(p, UnitType.MissileSilo),
          warships: standingCount(p, UnitType.Warship),
        },
      })),
      tick,
      !this.inSpawnPhase(),
      "preserve-pending",
      (credits, empireIds, troops) =>
        this.commitImperialDisposition(credits, empireIds, troops, tick),
    );
    this.revokeNationalObserverMemory();
  }

  /** Never exposes the mutable PoliticsProjection to a caller. */
  nationalPoliticalAuthority(): Readonly<
    NationalPoliticalAuthority & NationalConflictPoliticsPort
  > | null {
    if (this._national === null) return null;
    this._nationalAuthority ??= new PoliticalAuthorityAdapter(
      () => {
        if (this._national === null) throw new Error("NATIONAL is not enabled");
        // A defensive, validated snapshot; never give another subsystem the
        // mutable PoliticsProjection. The callback follows restoreState().
        return this._national.snapshot().politics;
      },
      (memberId, action) =>
        action === "peace"
          ? this._national?.hasDelegatedNationalPeace(memberId) === true
          : this._national?.hasDelegatedNationalDeclaration(memberId) === true,
    );
    return this._nationalAuthority;
  }

  /** E2 WAR legality is read from the one Game-owned, persisted ledger. */
  nationalWarAuthority(): Readonly<NationalWarAuthority> | null {
    if (this._nationalWar === null) return null;
    this._nationalWarReadPort ??= Object.freeze({
      authorizeOffensiveAction: (attackerId: string, targetId: string | null) =>
        this._nationalWar?.authority.authorizeOffensiveAction(
          attackerId,
          targetId,
        ) ?? false,
      atWar: (a: string, b: string) =>
        this._nationalWar?.authority.atWar(a, b) ?? false,
      snapshot: () => {
        if (this._nationalWar === null)
          throw new Error("NATIONAL war: mode not enabled");
        return this._nationalWar.snapshot();
      },
    });
    return this._nationalWarReadPort;
  }

  /** Detached canonical WAR/LEVY state; cannot mutate active war records. */
  nationalWarState(): NationalWarStateSnapshot | null {
    return this._nationalWar?.snapshot() ?? null;
  }

  /**
   * Trusted-host authority: the ORIGINAL admitted session is mandatory for
   * every human command in a server-owned Private NATIONAL Game. E2 preserves
   * the stamped clientID through queued executions and snapshot/replay.
   *
   * Unbound calls remain backward compatible ONLY in Solo/legacy and for
   * trusted internal nation/bot principals. A browser cannot choose that
   * exception: Private authenticated humans fail closed BEFORE journal lookup.
   */
  private assertNationalExecutionPrincipal(
    actor: Player,
    authenticatedClientID?: ClientID,
  ): void {
    if (this._players.get(actor.id()) !== actor)
      throw new Error("NATIONAL: unauthenticated forged actor");
    if (
      this._config.nationalMode() &&
      this._config.gameConfig().gameType === GameType.Private &&
      actor.type() === PlayerType.Human &&
      authenticatedClientID === undefined
    )
      throw new Error("NATIONAL: missing authenticated actor session");
    if (
      authenticatedClientID !== undefined &&
      (actor.type() !== PlayerType.Human ||
        actor.clientID() !== authenticatedClientID ||
        this.playerByClientID(authenticatedClientID) !== actor)
    )
      throw new Error("NATIONAL: stale authenticated actor session");
  }

  private assertWarPolicyAdmission(
    actorId: PlayerID,
    command: {
      readonly admissionEmpireId?: string | null;
      readonly policyVersion?: number | null;
    },
  ): void {
    // Only the trusted executor adds membership and epoch fields together.
    // Legacy trusted direct Game port calls are allowed to remain unversioned.
    if (command.admissionEmpireId === undefined) {
      if (command.policyVersion !== undefined)
        throw new Error("NATIONAL WAR: unbound imperial policy epoch");
      return;
    }
    const currentEmpire = this._national?.authority().empireOf(actorId) ?? null;
    const currentVersion = this._national?.warPolicyVersionFor(actorId) ?? null;
    if (
      (command.admissionEmpireId !== null &&
        (typeof command.admissionEmpireId !== "string" ||
          command.admissionEmpireId.length === 0)) ||
      (command.policyVersion !== null &&
        (typeof command.policyVersion !== "number" ||
          !Number.isSafeInteger(command.policyVersion) ||
          command.policyVersion < 0)) ||
      currentEmpire !== command.admissionEmpireId ||
      currentVersion !== (command.policyVersion ?? null)
    )
      throw new Error("NATIONAL WAR: stale or invalid imperial policy epoch");
  }

  /** Legacy direct Game WAR port: preserves real WarLedger rule exceptions. */
  performNationalWarCommand(
    actor: Player,
    command: NationalWarCommand,
    authenticatedClientID?: ClientID,
  ): void {
    if (this._nationalWar === null || this._national === null)
      throw new Error("NATIONAL war: mode not enabled");
    this.assertNationalExecutionPrincipal(actor, authenticatedClientID);
    if (
      this.inSpawnPhase() ||
      this._players.get(actor.id()) !== actor ||
      !actor.hasSpawned() ||
      !actor.isAlive()
    ) {
      throw new Error("NATIONAL war: unauthenticated or inactive actor");
    }
    this.synchronizeNationalState();
    this.assertWarPolicyAdmission(actor.id(), command);
    this._nationalWar.perform(actor.id(), command, this._ticks);
  }

  /**
   * Authoritative WAR/peace decision. The existing WarLedger alone mutates
   * host-owned conflict state; the ONE governance journal owns the outcome.
   * The request fingerprint excludes engine-generated war/motion IDs, so a
   * later retry with the same client token can return the original receipt.
   */
  performNationalWarCommandWithOutcome(
    actor: Player,
    command: NationalWarCommand & { readonly requestId?: string },
    requestId: string | null = null,
    authenticatedClientID?: ClientID,
  ): NationalWarCommandOutcome {
    if (
      this._nationalWar === null ||
      this._national === null ||
      this._nationalGovernance === null
    )
      throw new Error("NATIONAL war: mode not enabled");
    // Reject stale/borrowed sessions BEFORE idempotent receipt lookup. A
    // takeover cannot resurrect the old session's once-accepted WAR result.
    this.assertNationalExecutionPrincipal(actor, authenticatedClientID);
    const suppliedRequestId = requestId ?? command.requestId ?? null;
    if (
      suppliedRequestId !== null &&
      !/^[A-Za-z0-9_-]{1,128}$/.test(suppliedRequestId)
    )
      throw new Error("NATIONAL war: invalid request ID");

    const commandKind: NationalWarCommandKind =
      command.kind === "declare-national" || command.kind === "declare-imperial"
        ? "national_declare_war"
        : command.kind === "propose-peace"
          ? "national_propose_peace"
          : "national_accept_peace";
    const intent =
      command.kind === "declare-national"
        ? {
            kind: command.kind,
            aggressorId: command.aggressorId,
            targetId: command.targetId,
          }
        : command.kind === "declare-imperial"
          ? {
              kind: command.kind,
              aggressor: command.aggressor,
              target: command.target,
            }
          : command.kind === "propose-peace"
            ? { kind: command.kind, warId: command.warId }
            : { kind: command.kind, motionId: command.motionId };
    // The admission stamp is authority, not part of the client's action identity.
    // Preserve legacy retry fingerprints; validate stamp separately on replay.
    const fingerprint = JSON.stringify(intent);
    if (typeof fingerprint !== "string" || fingerprint.length > 4096)
      throw new Error("NATIONAL war: invalid command payload");
    const safeId = (id: unknown): string | undefined =>
      typeof id === "string" && id.length > 0 && id.length <= 256
        ? id
        : undefined;
    const targetId =
      command.kind === "declare-national"
        ? command.targetId
        : command.kind === "declare-imperial"
          ? command.target.id
          : command.kind === "propose-peace"
            ? command.warId
            : command.motionId;
    const recordedTargetId = safeId(targetId) ?? "<invalid-target-id>";
    const warId =
      command.kind === "declare-national" || command.kind === "declare-imperial"
        ? safeId(command.warId)
        : command.kind === "propose-peace"
          ? safeId(command.warId)
          : this._nationalWar
              .snapshot()
              .wars.motions.find((m) => m.id === command.motionId)?.layerId;
    const motionId =
      command.kind === "propose-peace" || command.kind === "accept-peace"
        ? safeId(command.motionId)
        : undefined;
    // A syntactically invalid command must still produce a sanitized receipt
    // for its verified actor, without running the mutable WarLedger.
    const hasSafeCommandIds =
      warId !== undefined &&
      (command.kind === "declare-national" ||
        command.kind === "declare-imperial" ||
        motionId !== undefined);
    return this._nationalGovernance.recordWarCommand(
      actor.id(),
      commandKind,
      recordedTargetId,
      this._ticks,
      suppliedRequestId,
      fingerprint,
      { warId, motionId },
      () => {
        if (this.inSpawnPhase() || !actor.hasSpawned() || !actor.isAlive())
          return "actor-inactive";
        if (!hasSafeCommandIds) return "invalid-war-command";
        try {
          this.synchronizeNationalState();
          this.assertWarPolicyAdmission(actor.id(), command);
          this._nationalWar!.perform(actor.id(), command, this._ticks);
          return "accepted";
        } catch {
          // Never expose secret treaty state, stack traces or live internals.
          return "war-rule";
        }
      },
      () => {
        // A historical accepted receipt is not permission to replay a stale
        // grant after revocation + regrant under the same sovereign identity.
        try {
          this.assertWarPolicyAdmission(actor.id(), command);
          return (
            this._nationalWar?.mayReplayAsCurrentSovereign(
              actor.id(),
              command,
            ) === true
          );
        } catch {
          return false;
        }
      },
    );
  }

  /** Detached, recipient-bound WAR results; E3 owns outbound projection. */
  nationalWarCommandResults(
    observer: Player,
  ): readonly NationalWarCommandOutcome[] {
    if (
      this._nationalGovernance === null ||
      this._players.get(observer.id()) !== observer ||
      observer.type() !== PlayerType.Human
    )
      return [];
    return this._nationalGovernance.warResultsFor(observer.id());
  }

  /**
   * Returns a stable source wrapper around a real, currently living player.
   * Cached wrappers contain no authoritative balance; troops() rereads Player.
   */
  nationalLevySource(nationId: PlayerID): TroopSource | null {
    if (this._nationalWar === null) return null;
    const player = this._players.get(nationId);
    if (!player || !player.isAlive() || !player.hasSpawned()) return null;
    let source = this._nationalLevySources.get(nationId);
    if (!source) {
      source = Object.freeze({
        nationId,
        troops: () => this._players.get(nationId)?.troops() ?? 0,
      });
      this._nationalLevySources.set(nationId, source);
    }
    return source;
  }

  /**
   * Exclusive synchronous Game tick lock provides atomic compare-and-swap.
   * Prepare validates ALL sources/balances without mutation; commit checks
   * ALL expected balances before setting any real PlayerImpl troop field.
   */
  private nationalTroopDebits(): TroopDebitTransactionAdapter {
    return {
      prepare: (debits): PreparedTroopDebits => {
        const ids = new Set<string>();
        const staged = debits.map((d) => {
          const id = d.source.nationId;
          const p = this._players.get(id);
          if (
            ids.has(id) ||
            p === undefined ||
            !p.isAlive() ||
            !p.hasSpawned() ||
            this.nationalLevySource(id) !== d.source ||
            !Number.isSafeInteger(d.expectedBalance) ||
            !Number.isSafeInteger(d.debit) ||
            !Number.isSafeInteger(d.resultingBalance) ||
            d.debit <= 0 ||
            d.resultingBalance < 0 ||
            d.expectedBalance !== d.resultingBalance + d.debit ||
            p.troops() !== d.expectedBalance
          ) {
            throw new Error("NATIONAL levy: invalid or stale real troop debit");
          }
          ids.add(id);
          return {
            id,
            p,
            expected: d.expectedBalance,
            next: d.resultingBalance,
            debit: d.debit,
          };
        });
        let finalized = false;
        return {
          approved: staged.map((d) => ({
            nationId: d.id,
            troopsDebited: d.debit,
          })),
          commit: () => {
            if (finalized) throw new Error("NATIONAL levy: already finalized");
            // E2's PlayerImpl primitive stages ALL BigInts before any write,
            // including the final contributor's CAS. Never loop setTroops.
            PlayerImpl.commitNationalTroopDebits(
              staged.map((d) => ({
                player: d.p as PlayerImpl,
                expectedBalance: d.expected,
                debit: d.debit,
                resultingBalance: d.next,
              })),
            );
            finalized = true;
          },
          discard: () => {
            finalized = true;
          },
        };
      },
    };
  }

  /**
   * INTERNAL accepted-attack path. Only real formal WAR hostilities can levy;
   * every contributor must belong to a real live MDA with the defender.
   * E2's AttackExecution must supply an already validated stable campaign ID.
   */
  applyNationalDefenseLevy(
    attacks: readonly IncomingDefense[],
  ): readonly DefenseResult[] {
    if (this._nationalWar === null || this._national === null)
      throw new Error("NATIONAL levy: mode not enabled");
    this.synchronizeNationalState();
    const political = this._national.snapshot().politics;
    const alreadyProcessed = new Set(
      this._nationalWar.snapshot().levy.processed.map((p) => p.attackId),
    );
    for (const attack of attacks) {
      if (attack.confirmedAccepted !== true)
        throw new Error("NATIONAL levy: attack not formally accepted");
      // E2's ledger verifies the immutable replay fingerprint. Historical
      // accepted attacks remain idempotent after peace, MDA Betray or death:
      // no new authorization or contribution is possible on a replay.
      if (alreadyProcessed.has(attack.attackId)) continue;
      if (
        !this._nationalWar.authority.authorizeOffensiveAction(
          attack.attackerId,
          attack.defenderId,
        )
      ) {
        throw new Error("NATIONAL levy: attack not formally authorized");
      }
      const response = this._national.standingDefenseFor(attack.defenderId);
      const imperialDonors =
        response?.response === "assist" || response?.response === "both"
          ? this._national.authority().membersOf(response.empireId)
          : [];
      const expectedDonors = [
        ...new Set([
          ...this.nationalMdaAllies(attack.defenderId),
          ...imperialDonors,
        ]),
      ].filter((id) => id !== attack.attackerId && id !== attack.defenderId);
      const suppliedDonors = attack.eligible.map((e) => e.source.nationId);
      if (
        suppliedDonors.length !== expectedDonors.length ||
        new Set(suppliedDonors).size !== suppliedDonors.length ||
        expectedDonors.some((id) => !suppliedDonors.includes(id))
      ) {
        throw new Error(
          "NATIONAL levy: missing or forged MDA contributor roster",
        );
      }
      for (const entry of attack.eligible) {
        const id = entry.source.nationId;
        if (
          this.nationalLevySource(id) !== entry.source ||
          !(
            political.pacts.some(
              (p) =>
                p.kind === "MDA" &&
                p.memberIds.includes(attack.defenderId) &&
                p.memberIds.includes(id),
            ) || imperialDonors.includes(id)
          ) ||
          entry.maximumFraction !== (imperialDonors.includes(id) ? 1 : 0.1) ||
          entry.protectedCapacityFraction !== 0.3 ||
          entry.troopCapacity !==
            Math.floor(this._config.maxTroops(this.player(id)))
        ) {
          throw new Error(
            "NATIONAL levy: not an authoritative MDA contributor",
          );
        }
      }
    }
    return this._nationalWar.interceptAcceptedAttacks(attacks);
  }

  /**
   * Authoritative attack-time empire defense. Called ONLY after AttackExecution
   * has validated a funded, border-reaching offensive attack. This uses the
   * identical snapshotted WAR + LEVY service and atomic PlayerImpl CAS as MDA.
   * Neither browser intent nor emperor can invent a donor/war/attack receipt.
   */
  interceptNationalIncomingAttack(
    attackId: string,
    attackerId: PlayerID,
    defenderId: PlayerID,
    troops: number,
  ): DefenseResult {
    if (this._national === null || this._nationalWar === null)
      throw new Error("NATIONAL defense: mode not enabled");
    if (
      typeof attackId !== "string" ||
      attackId.length === 0 ||
      attackId.length > 256 ||
      !Number.isSafeInteger(troops) ||
      troops < 1
    )
      throw new Error("NATIONAL defense: malformed accepted invasion");
    this.synchronizeNationalState();
    if (
      !this._nationalWar.authority.authorizeOffensiveAction(
        attackerId,
        defenderId,
      ) ||
      !this._players.get(attackerId)?.hasSpawned() ||
      !this._players.get(attackerId)?.isAlive() ||
      !this._players.get(defenderId)?.hasSpawned() ||
      !this._players.get(defenderId)?.isAlive()
    )
      throw new Error("NATIONAL defense: unlawful or dead-member attack");

    const response = this._national.standingDefenseFor(defenderId);
    // A previously committed attack is replayed by the existing ledger even
    // after a policy, troop balance, member or crown mutation.
    const alreadyProcessed = this._nationalWar
      .snapshot()
      .levy.processed.some((record) => record.attackId === attackId);
    if (!alreadyProcessed) {
      // Formal WAR alone is insufficient: a caller cannot synthesize a
      // battlefield receipt for an army that the real Game never accepted.
      // Compare against the actual funded outgoing attack and the exact
      // pre-interception cancellation/consolidation calculation performed by
      // AttackExecution. An engine-only adapter is not a client credential.
      const attacker = this._players.get(attackerId)!;
      const defender = this._players.get(defenderId)!;
      const battle = attacker
        .outgoingAttacks()
        .find((a) => a.id() === attackId);
      if (
        !battle ||
        !battle.isActive() ||
        battle.attacker() !== attacker ||
        battle.target() !== defender
      )
        throw new Error("NATIONAL defense: no real accepted invading army");
      let projected = battle.troops();
      for (const incoming of attacker.incomingAttacks()) {
        if (incoming.attacker() !== defender) continue;
        if (incoming.troops() > projected)
          throw new Error("NATIONAL defense: canceled incoming battle");
        projected -= incoming.troops();
      }
      if (battle.sourceTile() === null) {
        for (const outgoing of attacker.outgoingAttacks()) {
          if (outgoing !== battle && outgoing.target() === defender)
            projected += outgoing.troops();
        }
      }
      if (projected < 1 || Math.floor(projected) !== troops)
        throw new Error("NATIONAL defense: forged invading troop strength");
    }
    const mode = alreadyProcessed ? "none" : (response?.response ?? "none");
    const plan =
      response && (mode === "imperial" || mode === "both")
        ? this._nationalWar.prepareStandingDefenseWar(
            response.empireId,
            attackerId,
            defenderId,
            this._ticks,
          )
        : null;

    const mda = new Set(this.nationalMdaAllies(defenderId));
    const imperials = new Set(
      response && (mode === "assist" || mode === "both")
        ? this._national.authority().membersOf(response.empireId)
        : [],
    );
    const donorIds = [...new Set([...mda, ...imperials])]
      .filter((id) => id !== attackerId && id !== defenderId)
      .sort();
    const eligible = alreadyProcessed
      ? []
      : donorIds.map((id) => {
          const source = this.nationalLevySource(id);
          const donor = this._players.get(id);
          if (!source || !donor || !donor.hasSpawned() || !donor.isAlive())
            throw new Error("NATIONAL defense: invalid standing donor");
          return {
            source,
            troopCapacity: Math.floor(this._config.maxTroops(donor)),
            maximumFraction: imperials.has(id) ? 1 : 0.1,
            protectedCapacityFraction: 0.3,
          };
        });
    const campaignId = `national:${attackerId.length}:${attackerId}:${defenderId.length}:${defenderId}`;
    // One transaction across both MDA and imperial contributors; one campaign
    // allowance per real donor, shared across repeated clicks/fronts.
    // A declaration made AFTER troop CAS would turn a late WAR failure into
    // an uncompensated donor loss. Enact the preflighted WAR under the same
    // synchronous Game tick lock BEFORE spending, and roll it back if the
    // actual donor transaction refuses the attack. No speculative WAR is
    // visible outside this indivisible engine operation.
    const beforeWar = plan ? this._nationalWar.snapshot() : null;
    if (plan) this._nationalWar.enactStandingDefenseWar(plan, this._ticks);
    try {
      return this.applyNationalDefenseLevy([
        {
          attackId,
          confirmedAccepted: true,
          campaignId,
          attackerId,
          defenderId,
          attackingTroops: troops,
          eligible,
        },
      ])[0];
    } catch (error) {
      if (beforeWar) this._nationalWar.restore(beforeWar);
      throw error;
    }
  }

  /**
   * Private E3 recipient port: never expose another player's accession offer
   * or let a borrowed Player object select someone else's recipient journal.
   */
  nationalAccessionOffers(
    observer: Player,
  ): readonly NationalAccessionOfferView[] {
    if (
      this._national === null ||
      this._players.get(observer.id()) !== observer ||
      observer.type() !== PlayerType.Human ||
      !observer.hasSpawned() ||
      !observer.isAlive()
    )
      return [];
    this.synchronizeNationalState();
    return this._national.incomingAccessionOffers(observer.id());
  }

  /** Whitelisted engine-only public facts; E3 owns actual packet filtering. */
  nationalPublicPoliticalView(): NationalPublicPoliticalView | null {
    if (this._national === null) return null;
    this.synchronizeNationalState();
    const view = this._national.publicPoliticalView();
    // Preserve the historical engine-only candidate query. It is not a WIN
    // unless the canonical terminal marker is present; recipient projections
    // omit the candidate. Once committed, later politics cannot rewrite it.
    return {
      ...view,
      victory:
        this._nationalConfirmedVictory === null
          ? view.victory
          : NationalConfirmedVictorySchema.parse(
              this._nationalConfirmedVictory,
            ),
    };
  }

  /**
   * E2 contributor authority. Read treaty membership from ONE runtime;
   * validate every actual player is live and spawned before considering it.
   */
  nationalMdaAllies(defenderId: PlayerID): readonly PlayerID[] {
    if (this._national === null || this._nationalWar === null) return [];
    const defender = this._players.get(defenderId);
    if (!defender || !defender.hasSpawned() || !defender.isAlive()) return [];
    this.synchronizeNationalState();
    return this._national.mdaAllies(defenderId).filter((id) => {
      const player = this._players.get(id);
      return player !== undefined && player.hasSpawned() && player.isAlive();
    });
  }

  nationalPublicPactRoster(): readonly NationalPublicPactView[] {
    this.synchronizeNationalState();
    return this._national?.publicPactRoster() ?? [];
  }

  nationalPactViewsFor(observer: Player): readonly NationalRecipientPactView[] {
    if (
      this._players.get(observer.id()) !== observer ||
      !observer.hasSpawned() ||
      !observer.isAlive()
    )
      return [];
    this.synchronizeNationalState();
    return this._national?.pactViewsFor(observer.id()) ?? [];
  }

  nationalPactDisclosure(
    observer: Player,
  ): NationalPactDisclosureViewData | null {
    if (
      !this._national ||
      this._players.get(observer.id()) !== observer ||
      !observer.hasSpawned() ||
      !observer.isAlive()
    )
      return null;
    this.synchronizeNationalState();
    return this._national.pactDisclosure(observer.id());
  }

  private commitImperialDisposition(
    credits: ReadonlyMap<PlayerID, bigint>,
    empireIds: readonly string[],
    troopCredits: ReadonlyMap<PlayerID, bigint>,
    tick = this._ticks,
  ): void {
    const staged = PlayerImpl.prepareNationalGoldCredits(
      [...credits].map(([id, amount]) => {
        const player = this._players.get(id);
        if (!player || !player.hasSpawned() || !player.isAlive())
          throw new Error("NATIONAL: invalid treasury disposition recipient");
        return { player, amount };
      }),
    );
    const stagedTroops = PlayerImpl.prepareNationalTroopCredits(
      [...troopCredits].map(([id, amount]) => {
        const player = this._players.get(id);
        if (!player || !player.hasSpawned() || !player.isAlive())
          throw new Error("NATIONAL: invalid troop disposition recipient");
        return {
          player,
          amount,
          capacity: Math.floor(this._config.maxTroops(player)),
        };
      }),
    );
    // Retirement validates the engine tick before changing any layer.
    // Publishing staged credits thereafter cannot invoke external code.
    this._nationalWar?.retireEmpireWars(empireIds, tick);
    staged();
    stagedTroops();
  }

  nationalImperialAdministrationFor(
    observer: Player,
  ): NationalImperialAdministrationView | null {
    if (
      this._players.get(observer.id()) !== observer ||
      !observer.hasSpawned() ||
      !observer.isAlive()
    )
      return null;
    this.synchronizeNationalState();
    return this._national?.imperialAdministrationFor(observer.id()) ?? null;
  }

  nationalEconomicCharterFor(
    observer: Player,
  ): NationalEconomicCharterView | null {
    if (
      !this._national ||
      this._players.get(observer.id()) !== observer ||
      !observer.hasSpawned() ||
      !observer.isAlive()
    )
      return null;
    this.synchronizeNationalState();
    return this._national.economicCharterFor(observer.id());
  }

  /**
   * Resolve the CURRENT live constituent and physical structure at execution
   * time. Pending orders carry identifiers, never borrowed unit objects.
   */
  private imperialStructureTarget(
    empireId: string,
    memberId: PlayerID,
    unitId: number,
  ): { member: PlayerImpl; structure: Unit } {
    const member = this._players.get(memberId);
    if (
      !member ||
      !member.hasSpawned() ||
      !member.isAlive() ||
      this._national?.authority().empireOf(member.id()) !== empireId
    )
      throw new Error("NATIONAL: structure target is not a live constituent");
    if (!Number.isSafeInteger(unitId) || unitId < 0)
      throw new Error("NATIONAL: invalid structure identifier");
    const structure = this.unit(unitId);
    if (!structure || structure.owner() !== member || !structure.isActive())
      throw new Error("NATIONAL: structure is missing or not member-owned");
    return { member, structure };
  }

  /** Trusted engine entry shared by stamped commands and in-engine principals. */
  performNationalImperialAdministration(
    actor: Player,
    command: NationalImperialAdministrationCommand,
    authenticatedClientID?: ClientID,
  ): void {
    if (!this._national) throw new Error("NATIONAL is not enabled");
    this.assertNationalExecutionPrincipal(actor, authenticatedClientID);
    if (this.inSpawnPhase() || !actor.hasSpawned() || !actor.isAlive())
      throw new Error("NATIONAL: inactive administration actor");
    this.synchronizeNationalState();
    // A member may REQUEST relief; only the current emperor may DECIDE.
    if (command.kind !== "request-relief")
      this._national.assertEmperor(actor.id(), command.empireId);
    switch (command.kind) {
      case "request-relief":
        this._national.requestImperialRelief(
          actor.id(),
          command.empireId,
          command.reliefId,
          command.amount,
        );
        break;
      case "decide-relief":
        this._national.decideImperialRelief(
          actor.id(),
          command.empireId,
          command.reliefId,
          command.expectedVersion,
          command.decision,
          (memberId, amount) => {
            const member = this._players.get(memberId);
            if (
              !member ||
              !member.hasSpawned() ||
              !member.isAlive() ||
              this._national?.authority().empireOf(memberId) !==
                command.empireId
            )
              throw new Error("NATIONAL: invalid real relief wallet");
            return PlayerImpl.prepareNationalGoldCredits([
              { player: member, amount },
            ]);
          },
        );
        break;
      case "set-policy":
        this._national.setImperialPolicy(
          actor.id(),
          command.empireId,
          command.policy,
        );
        break;
      case "set-war-policy":
        this._national.setWarPolicy(actor.id(), command);
        break;
      case "set-standing-defense-policy":
        this._national.setStandingDefensePolicy(actor.id(), command);
        break;
      case "set-economic-charter":
        this._national.setEconomicCharter(
          actor.id(),
          command.empireId,
          command.expectedVersion,
          command.delegateIds,
          command.allowInternal,
        );
        break;
      case "set-member-trade": {
        const member = this._players.get(command.memberId);
        const target = this._players.get(command.targetId);
        const auth = this._national.authority();
        const charter =
          member && this._national.economicCharterFor(member.id());
        if (
          !member ||
          !target ||
          member === target ||
          !member.hasSpawned() ||
          !member.isAlive() ||
          !target.hasSpawned() ||
          !target.isAlive() ||
          auth.empireOf(member.id()) !== command.empireId ||
          !charter ||
          charter.version !== command.expectedVersion ||
          (auth.empireOf(target.id()) === command.empireId &&
            !charter.allowInternal)
        )
          throw new Error("NATIONAL: unauthorized constituent trade order");
        // No global embargo: mutate precisely this member/target Player pair.
        // No treasury credit/debit occurs unless a later legal trade pays.
        if (command.embargo) member.addEmbargo(target, false);
        else member.stopEmbargo(target);
        this._national.advanceEconomicEpoch(
          actor.id(),
          command.empireId,
          command.expectedVersion,
        );
        break;
      }
      case "respond-member-sanction":
        NationalSanctionExecution.emperorRespond(
          this,
          actor,
          command.memberId,
          command.sanctionId,
          command.decision,
          command.empireId,
          command.expectedVersion,
          () =>
            this._national!.advanceEconomicEpoch(
              actor.id(),
              command.empireId,
              command.expectedVersion,
            ),
        );
        break;
      case "transfer-troops": {
        const source = this._players.get(command.sourceId);
        const destination = this._players.get(command.destinationId);
        const authority = this._national.authority();
        if (
          !source ||
          !destination ||
          source === destination ||
          !source.hasSpawned() ||
          !source.isAlive() ||
          !destination.hasSpawned() ||
          !destination.isAlive() ||
          authority.empireOf(source.id()) !== command.empireId ||
          authority.empireOf(destination.id()) !== command.empireId
        )
          throw new Error(
            "NATIONAL: transfer requires two live constituent nations",
          );
        PlayerImpl.transferNationalActiveTroops(
          source,
          destination,
          Math.floor(this._config.maxTroops(destination)),
          command.amount,
        );
        break;
      }
      case "build-structure": {
        const member = this._players.get(command.memberId);
        const runtime = this._national;
        if (
          !member ||
          !member.hasSpawned() ||
          !member.isAlive() ||
          runtime.authority().empireOf(member.id()) !== command.empireId
        )
          throw new Error(
            "NATIONAL: imperial construction requires a live constituent",
          );
        const structure = member.buildImperialStructure(
          command.type,
          command.tile,
          (cost) =>
            runtime.debitImperialConstruction(
              actor.id(),
              command.empireId,
              cost,
            ),
        );
        this.addExecution(
          ConstructionExecution.forImperialPurchase(this, structure),
        );
        break;
      }
      case "upgrade-structure": {
        const { member, structure } = this.imperialStructureTarget(
          command.empireId,
          command.memberId,
          command.unitId,
        );
        member.upgradeImperialStructure(structure, (cost) =>
          this._national!.debitImperialConstruction(
            actor.id(),
            command.empireId,
            cost,
          ),
        );
        break;
      }
      case "demolish-structure": {
        const { member, structure } = this.imperialStructureTarget(
          command.empireId,
          command.memberId,
          command.unitId,
        );
        member.demolishImperialStructure(structure);
        break;
      }
      case "set-army-mode":
        if (command.mode === "centralized") {
          const ids = this._national.authority().membersOf(command.empireId);
          const balances = ids.map((memberId) => {
            const member = this._players.get(memberId);
            if (!member || !member.hasSpawned() || !member.isAlive())
              throw new Error(
                "NATIONAL: inactive constituent cannot contribute troops",
              );
            return { memberId, member, balance: member.troops() };
          });
          this._national.centralizeImperialArmy(
            actor.id(),
            command.empireId,
            command.thresholdBps,
            balances,
            () =>
              PlayerImpl.commitNationalTroopDebits(
                balances
                  .filter((b) => b.balance > 0)
                  .map((b) => ({
                    player: b.member,
                    expectedBalance: b.balance,
                    debit: b.balance,
                    resultingBalance: 0,
                  })),
              ),
          );
        } else {
          this._national.setArmyMode(
            actor.id(),
            command.empireId,
            command.mode,
            command.thresholdBps,
            (credits, empireIds, troops) =>
              this.commitImperialDisposition(credits, empireIds, troops),
          );
        }
        break;
      case "release-imperial-troops":
        this._national.releaseImperialTroops(
          actor.id(),
          command.empireId,
          command.memberId,
          command.amount,
          (credits, empireIds, troops) =>
            this.commitImperialDisposition(credits, empireIds, troops),
        );
        break;
      case "imperial-attack": {
        // No virtual attackers: transfer this empire-owned reserve to the
        // actual constituent, then use ordinary AttackExecution and WAR/LEVY.
        const member = this._players.get(command.memberId);
        const target = this._players.get(command.targetId);
        if (
          !member ||
          !target ||
          member === target ||
          !member.hasSpawned() ||
          !member.isAlive() ||
          !target.hasSpawned() ||
          !target.isAlive() ||
          this._national.authority().empireOf(member.id()) !==
            command.empireId ||
          this._national.authority().empireOf(target.id()) ===
            command.empireId ||
          !member.sharesBorderWith(target) ||
          member.isFriendly(target) ||
          !member.canAttackPlayer(target) ||
          this._nationalWar?.authority.authorizeOffensiveAction(
            member.id(),
            target.id(),
          ) !== true
        )
          throw new Error(
            "NATIONAL: imperial attack requires a live lawful bordered WAR target",
          );
        this._national.releaseImperialTroops(
          actor.id(),
          command.empireId,
          member.id(),
          command.amount,
          (credits, empireIds, troops) =>
            this.commitImperialDisposition(credits, empireIds, troops),
        );
        // A later peace or crown change can abort the queued attack, but
        // it cannot cause reserve troops to be credited twice.
        this.addExecution(
          AttackExecution.forImperialOrder(command.amount, member, target.id()),
        );
        break;
      }
      case "dissolve":
        this._national.voluntarilyDissolve(
          actor.id(),
          command.empireId,
          (credits, empireIds, troops) =>
            this.commitImperialDisposition(credits, empireIds, troops),
        );
        this.revokeNationalObserverMemory();
        break;
      default:
        throw new Error("NATIONAL: unsupported administration command");
    }
  }

  nationalDeferredTroopsFor(observer: Player): string | null {
    if (
      !this._national ||
      this._players.get(observer.id()) !== observer ||
      !observer.hasSpawned() ||
      !observer.isAlive()
    )
      return null;
    return this._national.deferredTroopsFor(observer.id());
  }

  releaseNationalDeferredTroops(player: Player): void {
    if (
      !this._national ||
      this._players.get(player.id()) !== player ||
      !player.hasSpawned() ||
      !player.isAlive()
    )
      return;
    const capacity = Math.floor(this._config.maxTroops(player));
    const headroom = BigInt(Math.max(0, capacity - player.troops()));
    const amount = this._national.redeemDeferredTroops(player.id(), headroom);
    if (amount > 0n) player.addTroops(Number(amount));
  }

  creditNationalTroopGrowth(player: Player, gross: number): void {
    if (!this._national || gross <= 0) {
      player.addTroops(gross);
      return;
    }
    if (this._players.get(player.id()) !== player)
      throw new Error("NATIONAL: invalid troop growth owner");
    const personal = this._national.routeHybridGrowth(
      player.id(),
      BigInt(Math.floor(gross)),
      (ids) =>
        ids.flatMap((id) => {
          const member = this._players.get(id);
          return member && member.hasSpawned() && member.isAlive()
            ? [
                {
                  id,
                  capacity: BigInt(Math.floor(this._config.maxTroops(member))),
                  active: BigInt(member.troops()),
                },
              ]
            : [];
        }),
    );
    player.addTroops(Number(personal));
  }

  creditNationalWorkerIncome(player: Player, gross: bigint): void {
    if (this._national && this._players.get(player.id()) !== player)
      throw new Error("NATIONAL: invalid worker income owner");
    player.addGold(
      this._national?.routeWorkerIncome(player.id(), gross) ?? gross,
    );
  }

  /**
   * Production credits are split exactly once on commercial payout, not from
   * addGold (which also handles donations, conquest and treasury restitution).
   */
  creditNationalCommercialIncome(
    player: Player,
    gross: bigint,
    source?: "maritime" | "rail" | "piracy",
    tile?: TileRef,
  ): void {
    if (this._national && this._players.get(player.id()) !== player)
      throw new Error("NATIONAL: invalid commercial income owner");
    if (this._national && source === undefined)
      throw new Error(
        "NATIONAL: commercial income requires a named payout source",
      );
    player.addGold(
      this._national?.routeNonWorkerIncome(
        player.id(),
        gross,
        source ?? "maritime",
      ) ?? gross,
      tile,
    );
  }

  nationalAllowsConstruction(player: Player, type: UnitType): boolean {
    if (!this._national) return true;
    if (this._players.get(player.id()) !== player) return false;
    return this._national.allowsConstruction(player.id(), type);
  }

  /** Complete NATIONAL victor roster; old game Winner schema stays unchanged. */
  nationalVictoryRoster(): LastSovereignResult | null {
    this.synchronizeNationalState();
    return this._national?.victoryRoster() ?? null;
  }

  /** Ten-second crisis deadlines in deterministic engine-time milliseconds. */
  nationalUngovernableWarnings(): readonly NationalUngovernableWarning[] {
    this.synchronizeNationalState();
    return this._national?.ungovernableWarnings() ?? [];
  }

  nationalWinner(): PlayerID | null {
    this.synchronizeNationalState();
    return this._national?.winner() ?? null;
  }

  /**
   * Authenticate against the SAME original Game principal as diplomacy and
   * war. Gold is debited from PlayerImpl once; durable lease is the receipt.
   * No client chooses the payer, effective tick, price, radius or duration.
   */
  performNationalReconnaissance(
    actor: Player,
    targetId: PlayerID,
    centerX: number,
    centerY: number,
    requestId: string,
    authenticatedClientID?: ClientID,
  ): RegionalReconGrant {
    if (this._nationalRecon === null || !this._config.nationalMode())
      throw new Error("NATIONAL recon: mode not enabled");
    this.assertNationalExecutionPrincipal(actor, authenticatedClientID);
    if (
      this.inSpawnPhase() ||
      !actor.hasSpawned() ||
      !actor.isAlive() ||
      !this._players.has(targetId) ||
      !this._players.get(targetId)!.isAlive() ||
      targetId === actor.id() ||
      !Number.isSafeInteger(centerX) ||
      !Number.isSafeInteger(centerY) ||
      !this.isValidCoord(centerX, centerY)
    )
      throw new Error("NATIONAL recon: inactive principal or invalid region");
    return this._nationalRecon.buy(
      actor.id(),
      targetId,
      centerX,
      centerY,
      this._ticks,
      requestId,
      () => {
        if (actor.gold() < REGIONAL_RECON_COST)
          throw new Error("NATIONAL recon: insufficient gold");
        const spent = actor.removeGold(REGIONAL_RECON_COST);
        if (spent !== REGIONAL_RECON_COST) {
          actor.addGold(spent);
          throw new Error("NATIONAL recon: non-atomic gold debit");
        }
      },
    );
  }

  nationalReconnaissanceFor(payerId: PlayerID): readonly RegionalReconGrant[] {
    return this._nationalRecon?.activeFor(payerId, this._ticks) ?? [];
  }

  /** Game-owned gold debit and post-admission bounded foreign assessment. */
  performNationalAssessment(
    actor: Player,
    targetId: PlayerID,
    requestId: string,
    authenticatedClientID?: ClientID,
  ): NationalAssessmentGrant {
    if (this._nationalAssessment === null || !this._config.nationalMode())
      throw new Error("NATIONAL assessment: mode not enabled");
    this.assertNationalExecutionPrincipal(actor, authenticatedClientID);
    const target = this._players.get(targetId);
    if (
      this.inSpawnPhase() ||
      !actor.hasSpawned() ||
      !actor.isAlive() ||
      !target ||
      !target.hasSpawned() ||
      !target.isAlive() ||
      targetId === actor.id()
    )
      throw new Error("NATIONAL assessment: inactive or invalid target");
    return this._nationalAssessment.buy(
      actor.id(),
      targetId,
      this._ticks,
      requestId,
      () => {
        if (actor.gold() < NATIONAL_ASSESSMENT_COST)
          throw new Error("NATIONAL assessment: insufficient gold");
        const spent = actor.removeGold(NATIONAL_ASSESSMENT_COST);
        if (spent !== NATIONAL_ASSESSMENT_COST) {
          actor.addGold(spent);
          throw new Error("NATIONAL assessment: non-atomic debit");
        }
      },
      () => {
        actor.addGold(NATIONAL_ASSESSMENT_COST);
      },
      () => {
        const authority = this.nationalPoliticalAuthority();
        const actorEmpire = authority?.empireOf(actor.id()) ?? null;
        const targetEmpire = authority?.empireOf(targetId) ?? null;
        const allies =
          actorEmpire !== null &&
          actorEmpire === targetEmpire &&
          authority?.membersOf(actorEmpire).includes(actor.id()) === true &&
          authority?.membersOf(actorEmpire).includes(targetId) === true;
        return captureNationalAssessmentBands(
          target.gold(),
          target.troops(),
          !allies &&
            this._nationalAssessment!.isShielded(targetId, this._ticks),
        );
      },
    );
  }
  /** No target or duration can be chosen by an untrusted client. */
  performNationalCounterassessment(
    actor: Player,
    requestId: string,
    authenticatedClientID?: ClientID,
  ): NationalAssessmentShield {
    if (this._nationalAssessment === null || !this._config.nationalMode())
      throw new Error("NATIONAL counterassessment: mode not enabled");
    this.assertNationalExecutionPrincipal(actor, authenticatedClientID);
    if (this.inSpawnPhase() || !actor.hasSpawned() || !actor.isAlive())
      throw new Error("NATIONAL counterassessment: inactive principal");
    return this._nationalAssessment.buyShield(
      actor.id(),
      this._ticks,
      requestId,
      () => {
        if (actor.gold() < NATIONAL_COUNTERASSESSMENT_COST)
          throw new Error("NATIONAL counterassessment: insufficient gold");
        const spent = actor.removeGold(NATIONAL_COUNTERASSESSMENT_COST);
        if (spent !== NATIONAL_COUNTERASSESSMENT_COST) {
          actor.addGold(spent);
          throw new Error("NATIONAL counterassessment: non-atomic debit");
        }
      },
      () => actor.addGold(NATIONAL_COUNTERASSESSMENT_COST),
    );
  }
  nationalAssessmentsFor(
    payerId: PlayerID,
  ): readonly NationalAssessmentGrant[] {
    return this._nationalAssessment?.activeFor(payerId, this._ticks) ?? [];
  }

  /** Trusted player object from authenticated execution, never caller-supplied ID. */
  performNationalCommand(
    actor: Player,
    command: NationalCommand,
    authenticatedClientID?: ClientID,
  ): void {
    if (this._national === null) throw new Error("NATIONAL is not enabled");
    this.assertNationalExecutionPrincipal(actor, authenticatedClientID);
    if (
      this.inSpawnPhase() ||
      this._players.get(actor.id()) !== actor ||
      !actor.hasSpawned() ||
      !actor.isAlive()
    ) {
      throw new Error("NATIONAL: unauthenticated or inactive actor");
    }
    this.synchronizeNationalState();
    if (command.kind === "imperial-administration") {
      this.performNationalImperialAdministration(
        actor,
        command.command,
        authenticatedClientID,
      );
      return;
    }
    // Legal war with a current member MUST be negotiated away first.
    // Otherwise accession would silently create an internal national war.
    if (command.kind === "accept-empire")
      this._nationalWar?.assertAccessionCompatible(
        command.empireId,
        command.candidateId,
      );
    this._national.perform(actor.id(), command);
    if (
      command.kind === "accept-empire" &&
      this._national.accessionWarResponseFor(command.empireId) === "imperial"
    )
      this._nationalWar?.escalateAccessionWars(
        command.empireId,
        command.candidateId,
        this._ticks,
      );
    this.revokeNationalObserverMemory();
  }

  /**
   * Trusted in-engine Found Empire execution outcome. A valid registered
   * Player may be inactive: the rejection still reaches that same actor.
   * A borrowed/forged player object is never journaled or authorized.
   */
  performNationalFoundEmpireWithOutcome(
    actor: Player,
    empireId: string,
    requestId: string | null = null,
    authenticatedClientID?: ClientID,
  ): NationalFoundEmpireResult {
    if (this._national === null || this._nationalGovernance === null)
      throw new Error("NATIONAL command journal: mode not enabled");
    this.assertNationalExecutionPrincipal(actor, authenticatedClientID);
    // Reject pathological identifiers without persisting unbounded client
    // input or partially committing a result when Zod validates the journal.
    const recordedEmpireId =
      typeof empireId === "string" && empireId.length <= 256
        ? empireId
        : "<invalid-empire-id>";
    return this._nationalGovernance.recordFoundEmpire(
      actor.id(),
      recordedEmpireId,
      this._ticks,
      requestId,
      () => {
        if (this.inSpawnPhase() || !actor.hasSpawned() || !actor.isAlive())
          return "actor-inactive";
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(empireId)) return "invalid-empire-id";
        try {
          this.performNationalCommand(
            actor,
            { kind: "found-empire", empireId },
            authenticatedClientID,
          );
          return "accepted";
        } catch {
          // Never serialize exception text, engine internals or other
          // actors' private coalition/governance data.
          return "political-rule";
        }
      },
      () =>
        this._national
          ?.snapshot()
          .politics.empires.some(
            (empire) =>
              empire.id === recordedEmpireId && empire.leaderId === actor.id(),
          ) === true,
    );
  }

  nationalCommandResults(
    observer: Player,
  ): readonly NationalFoundEmpireResult[] {
    if (
      this._nationalGovernance === null ||
      this._players.get(observer.id()) !== observer ||
      observer.type() !== PlayerType.Human
    )
      return [];
    return this._nationalGovernance.resultsFor(observer.id());
  }

  /**
   * Accepted political receipts remain immutable historical evidence, not an
   * evergreen crown credential. Crown, policy and accession replay must be
   * evaluated against the current emperor, not the former command owner.
   * This reads the one canonical politics authority and stores no epoch.
   */
  private mayReplayAsCurrentPoliticalSovereign(
    actorId: PlayerID,
    command: Exclude<NationalCommand, { kind: "found-empire" }>,
  ): boolean {
    const authority = this.nationalPoliticalAuthority();
    if (!authority?.alive(actorId)) return false;
    if (command.kind === "imperial-administration") {
      if (command.command.kind === "request-relief")
        return authority.empireOf(actorId) === command.command.empireId;
      if (authority.emperorOf(command.command.empireId) !== actorId)
        return false;
      const detail = command.command;
      if (
        detail.kind === "set-economic-charter" ||
        detail.kind === "set-member-trade" ||
        detail.kind === "respond-member-sanction"
      ) {
        return (
          this._national?.economicCharterFor(actorId)?.version ===
          detail.expectedVersion
        );
      }
      return true;
    }
    if (
      command.kind === "transfer-crown" ||
      command.kind === "set-national-peace-delegation"
    )
      return authority.emperorOf(command.empireId) === actorId;
    if (command.kind === "offer-empire" || command.kind === "accept-empire") {
      if (actorId === command.candidateId)
        return (
          command.kind === "accept-empire" ||
          authority.empireOf(actorId) === null
        );
      return authority.emperorOf(command.empireId) === actorId;
    }
    return true;
  }

  /**
   * Single E1 Game-owned journal: authenticated non-founder transitions now
   * receive the same sequence/idempotence guarantees as Found Empire.
   * E2 supplies the server-stamped actor; E3 will expose a separate typed
   * recipient packet so these cannot masquerade as founding receipts.
   */
  performNationalPoliticalCommandWithOutcome(
    actor: Player,
    command: Exclude<NationalCommand, { kind: "found-empire" }>,
    requestId: string | null = null,
    authenticatedClientID?: ClientID,
  ): NationalPoliticalCommandResult {
    if (this._national === null || this._nationalGovernance === null)
      throw new Error("NATIONAL command journal: mode not enabled");
    this.assertNationalExecutionPrincipal(actor, authenticatedClientID);
    const targetId =
      command.kind === "imperial-administration"
        ? command.command.empireId
        : "pactId" in command
          ? command.pactId
          : command.empireId;
    const recordedTargetId =
      typeof targetId === "string" &&
      targetId.length > 0 &&
      targetId.length <= 256
        ? targetId
        : "<invalid-target-id>";
    // Keep the full command identity private in the Game-owned ledger.
    // Reusing a request ID for different terms/candidate/successor must reject,
    // even when actor + kind + pact/empire target happen to match.
    const commandFingerprint = JSON.stringify(command);
    if (
      typeof commandFingerprint !== "string" ||
      commandFingerprint.length > 4096
    )
      throw new Error("NATIONAL command journal: invalid command payload");
    return this._nationalGovernance.recordPoliticalCommand(
      actor.id(),
      command.kind,
      recordedTargetId,
      this._ticks,
      requestId,
      commandFingerprint,
      () => {
        if (this.inSpawnPhase() || !actor.hasSpawned() || !actor.isAlive())
          return "actor-inactive";
        try {
          this.performNationalCommand(actor, command, authenticatedClientID);
          return "accepted";
        } catch {
          // Do not transmit internal pact terms, engine state or stack traces.
          return "political-rule";
        }
      },
      () => this.mayReplayAsCurrentPoliticalSovereign(actor.id(), command),
    );
  }

  nationalPoliticalCommandResults(
    observer: Player,
  ): readonly NationalPoliticalCommandResult[] {
    if (
      this._nationalGovernance === null ||
      this._players.get(observer.id()) !== observer ||
      observer.type() !== PlayerType.Human
    )
      return [];
    return this._nationalGovernance.politicalResultsFor(observer.id());
  }

  /** Same live reciprocal empire membership check used by E3 sight. */
  private hasNationalSharedSight(
    observerId: PlayerID,
    sourceId: PlayerID,
  ): boolean {
    const auth = this.nationalPoliticalAuthority();
    const empire = auth?.empireOf(observerId) ?? null;
    return (
      empire !== null &&
      auth?.empireOf(sourceId) === empire &&
      auth?.membersOf(empire).includes(observerId) === true &&
      auth?.membersOf(empire).includes(sourceId) === true
    );
  }

  private _isRestoredHumanPrincipal(observerId: PlayerID): boolean {
    const player = this._players.get(observerId);
    return player !== undefined && player.type() === PlayerType.Human;
  }

  private isNationalHuman(observerId: PlayerID): boolean {
    const player = this._players.get(observerId);
    return (
      player !== undefined &&
      player.type() === PlayerType.Human &&
      player.hasSpawned() &&
      player.isAlive()
    );
  }

  /** Called at every political tick, transition and snapshot restore. */
  private revokeNationalObserverMemory(): void {
    this._nationalGovernance?.revokeMemory(
      this._ticks,
      (id) => this.isNationalHuman(id),
      (observer, source) => this.hasNationalSharedSight(observer, source),
    );
  }

  readNationalObserverMemory(observerId: PlayerID): NationalSightMemory | null {
    if (!this.isNationalHuman(observerId) || this._nationalGovernance === null)
      return null;
    this.synchronizeNationalState();
    return this._nationalGovernance.readMemory(observerId);
  }

  writeNationalObserverMemory(
    observerId: PlayerID,
    data: NationalSightMemory,
  ): void {
    if (!this.isNationalHuman(observerId) || this._nationalGovernance === null)
      throw new Error(
        "NATIONAL sight: unknown or unauthorized human principal",
      );
    this.synchronizeNationalState();
    this._nationalGovernance.writeMemory(
      observerId,
      data,
      this._ticks,
      (sourceId) => this.hasNationalSharedSight(observerId, sourceId),
    );
  }

  isPaused(): boolean {
    return this._isPaused;
  }

  setPaused(paused: boolean): void {
    this._isPaused = paused;
    this.addUpdate({ type: GameUpdateType.GamePaused, paused });
  }

  inSpawnPhase(): boolean {
    return this.startTick === null;
  }

  endSpawnPhase(): void {
    if (this.startTick !== null) {
      return;
    }
    this.startTick = this._ticks;
    this.addUpdate({
      type: GameUpdateType.SpawnPhaseEnd,
      startTick: this.startTick,
    });
  }

  /**
   * Queues, with the next tick's updates, what a view with no history needs
   * to show this game as it stands: a host showing a game restored from a
   * snapshot never saw the updates that built it. Players need nothing here,
   * since a restored player's first update is a full one.
   */
  queueViewResync(): void {
    this.viewResyncQueued = true;
  }

  private addViewResync(): void {
    const map = this._map as GameMapImpl;
    const terrainEdited = new Set(map.editedTerrainTiles());
    const numTiles = map.width() * map.height();
    for (let tile = 0; tile < numTiles; tile++) {
      if (map.tileState(tile) !== 0 || terrainEdited.has(tile)) {
        this.recordTileUpdate(tile);
      }
    }
    // The view never got the motion plans of moves already under way, so
    // those units report each step instead, as unplanned units do.
    this.planDrivenUnitIds.clear();
    for (const unit of this._unitMap.values()) {
      this.addUpdate(unit.toUpdate());
    }
    const railroads = new Set<Railroad>();
    for (const station of this._railNetwork.stationManager().getAll()) {
      for (const railroad of station.getRailroads()) railroads.add(railroad);
    }
    for (const railroad of railroads) {
      this.addUpdate({
        type: GameUpdateType.RailroadConstructionEvent,
        id: railroad.id,
        tiles: railroad.tiles,
      });
    }
    if (this.startTick !== null) {
      this.addUpdate({
        type: GameUpdateType.SpawnPhaseEnd,
        startTick: this.startTick,
      });
    }
  }

  ticks(): number {
    return this._ticks;
  }

  executeNextTick(): GameUpdates {
    this.updates = createGameUpdatesMap();
    this.tileUpdatePairs.length = 0;
    if (this.viewResyncQueued) {
      this.viewResyncQueued = false;
      this.addViewResync();
    }
    this.execs.forEach((e) => {
      if (
        (!this.inSpawnPhase() || e.activeDuringSpawnPhase()) &&
        e.isActive()
      ) {
        e.tick(this._ticks);
      }
    });
    if (this.unInitExecs.length > 0) {
      const inited: Execution[] = [];
      const unInited: Execution[] = [];
      for (const e of this.unInitExecs) {
        if (!this.inSpawnPhase() || e.activeDuringSpawnPhase()) {
          e.init(this, this._ticks);
          inited.push(e);
        } else {
          unInited.push(e);
        }
      }
      this.execs.push(...inited);
      this.unInitExecs = unInited;
    }

    this.removeInactiveExecutions();
    // Reconcile at the completed tick's clock; observer reads cannot advance
    // a crisis or distribute assets simply by requesting a view.
    this.synchronizeNationalState(this._ticks + 1);

    for (const player of this._playersBySmallID) {
      // Sampled before toUpdate so the reading is of the tick that just ran.
      // Dead and unspawned players are skipped: an eliminated player's fall
      // to zero tiles would otherwise register as a total collapse.
      if (player.isAlive() && player.hasSpawned()) {
        this.stats().recordTickSample(
          player,
          player.numTilesOwned(),
          player.troops(),
          player.alliances().length,
        );
      }
      const update = player.toUpdate(
        this.playerStatsQuads,
        this.attackTroopsQuads,
      );
      if (update !== null) this.addUpdate(update);
    }
    if (this.ticks() % 10 === 0) {
      this.addUpdate({
        type: GameUpdateType.Hash,
        tick: this.ticks(),
        hash: this.hash(),
      });
    }
    // Flush pending water conversions + throttled graph rebuild
    const waterChangedTiles = this._waterManager.tick(this._ticks);
    for (const tile of waterChangedTiles) {
      this.recordTileUpdate(tile);
    }
    // Queued conversions write the map directly, bypassing setWater.
    if (waterChangedTiles.length > 0) this._structureVersion++;
    this._ticks++;
    return this.updates;
  }

  private recordTileUpdate(tile: TileRef): void {
    // Low 16 bits: tile state, bits 16-23: terrain byte
    this.tileUpdatePairs.push(
      tile,
      (this._map.tileState(tile) & 0xffff) |
        (this._map.terrainByte(tile) << 16),
    );
  }

  drainPackedTileUpdates(): Uint32Array {
    const pairs = this.tileUpdatePairs;
    const packed = new Uint32Array(pairs.length);
    for (let i = 0; i < pairs.length; i++) {
      packed[i] = pairs[i];
    }
    pairs.length = 0;
    return packed;
  }

  drainPackedPlayerUpdates(): Float64Array | null {
    const quads = this.playerStatsQuads;
    if (quads.length === 0) return null;
    const packed = Float64Array.from(quads);
    quads.length = 0;
    return packed;
  }

  drainPackedAttackUpdates(): Float64Array | null {
    const quads = this.attackTroopsQuads;
    if (quads.length === 0) return null;
    const packed = Float64Array.from(quads);
    quads.length = 0;
    return packed;
  }

  recordMotionPlan(record: MotionPlanRecord): void {
    switch (record.kind) {
      case "grid":
        this.planDrivenUnitIds.add(record.unitId);
        break;
      case "train":
        this.planDrivenUnitIds.add(record.engineUnitId);
        for (const unitId of record.carUnitIds) {
          this.planDrivenUnitIds.add(unitId);
        }
        break;
    }
    this.motionPlanRecords.push(record);
  }

  private isUnitPlanDriven(unitId: number): boolean {
    return this.planDrivenUnitIds.has(unitId);
  }

  maybeAddUnitUpdate(unit: Unit): void {
    if (!this.isUnitPlanDriven(unit.id())) {
      this.addUpdate(unit.toUpdate());
    }
  }

  onUnitMoved(unit: Unit): void {
    this.updateUnitTile(unit);
    this.maybeAddUnitUpdate(unit);
  }

  drainPackedMotionPlans(): Uint32Array | null {
    const records = this.motionPlanRecords;
    if (records.length === 0) {
      return null;
    }
    const packed = packMotionPlans(records);
    records.length = 0;
    return packed;
  }

  private hash(): number {
    let hash = 1;
    this._players.forEach((p) => {
      hash += p.hash();
    });
    // Rails are not units, so without this a divergence in which rails got
    // built would only show up through the trains that later run on them.
    hash += this._railNetwork.hash();
    if (this._national !== null) {
      hash += this._national.stateHash();
      hash += NationalSanctionExecution.stateHash(this);
      hash += NationalUltimatumExecution.stateHash(this);
    }
    if (this._nationalWar !== null)
      hash += simpleHash(JSON.stringify(this._nationalWar.snapshot()));
    if (this._nationalGovernance !== null)
      hash += simpleHash(JSON.stringify(this._nationalGovernance.snapshot()));
    // Paid intelligence is authoritative game state, not UI cache. Its
    // immutable replay journal must be represented in the match state hash.
    if (this._nationalRecon !== null)
      hash += simpleHash(JSON.stringify(this._nationalRecon.snapshot()));
    if (this._nationalAssessment !== null)
      hash += simpleHash(JSON.stringify(this._nationalAssessment.snapshot()));
    return hash;
  }

  terraNullius(): TerraNullius {
    return this._terraNullius;
  }

  removeInactiveExecutions(): void {
    // Compact in place to avoid reallocating the (large) executions array
    // every tick.
    const execs = this.execs;
    const inSpawnPhase = this.inSpawnPhase();
    let w = 0;
    for (let i = 0; i < execs.length; i++) {
      const exec = execs[i];
      const keep = inSpawnPhase
        ? !exec.activeDuringSpawnPhase() || exec.isActive()
        : exec.isActive();
      if (keep) {
        execs[w++] = exec;
      }
    }
    execs.length = w;
  }

  players(): Player[] {
    return this._playersBySmallID.filter((p) => p.isAlive());
  }

  allPlayers(): Player[] {
    return this._playersBySmallID.slice();
  }

  executions(): Execution[] {
    return [...this.execs, ...this.unInitExecs];
  }

  addExecution(...exec: Execution[]) {
    this.unInitExecs.push(...exec);
  }

  removeExecution(exec: Execution) {
    this.execs = this.execs.filter((execution) => execution !== exec);
    this.unInitExecs = this.unInitExecs.filter(
      (execution) => execution !== exec,
    );
  }

  takeoverPlayer(player: Player | PlayerID, localClientID: ClientID): void {
    const target = typeof player === "string" ? this.player(player) : player;

    const oldClientID = target.clientID();
    if (oldClientID !== null) {
      this._stats.migrateClientID(oldClientID, localClientID);
    }

    // Remove any NationExecution or TribeExecution controlling this player
    for (const exec of this.executions()) {
      if (
        (exec instanceof NationExecution || exec instanceof TribeExecution) &&
        exec.playerID() === target.id()
      ) {
        this.removeExecution(exec);
      }
    }

    // Update chosen player to be the local human
    const chosenInfo = target.info();
    const updatedChosenInfo = new PlayerInfo(
      chosenInfo.name,
      PlayerType.Human,
      localClientID,
      chosenInfo.id,
      chosenInfo.isLobbyCreator,
      chosenInfo.clanTag,
      chosenInfo.friends,
      chosenInfo.teamIndex,
      chosenInfo.nationFlag,
    );
    target.setPlayerInfo(updatedChosenInfo);
    target.markDisconnected(false);

    this._humans = this._humans.filter((h) => h.id !== target.id());
    this._humans.push(updatedChosenInfo);
    this._nations = this._nations.filter(
      (n) => n.playerInfo.id !== target.id(),
    );
  }

  clearHumanPlayer(player: Player | PlayerID): void {
    const target = typeof player === "string" ? this.player(player) : player;
    const pInfo = target.info();
    const updatedBotInfo = new PlayerInfo(
      pInfo.name,
      PlayerType.Nation,
      null,
      pInfo.id,
      false,
      pInfo.clanTag,
      pInfo.friends,
      pInfo.teamIndex,
      pInfo.nationFlag,
    );
    target.setPlayerInfo(updatedBotInfo);
    target.markDisconnected(false);

    this._humans = this._humans.filter((h) => h.id !== target.id());
  }

  clearOtherHumans(keptPlayer: Player | PlayerID): void {
    const target =
      typeof keptPlayer === "string" ? this.player(keptPlayer) : keptPlayer;
    this._humans = this._humans.filter((h) => h.id === target.id());
  }

  convertHumanToNation(player: Player | PlayerID, gameID: GameID): Execution {
    const target = typeof player === "string" ? this.player(player) : player;
    this.clearHumanPlayer(target);

    this._nations = this._nations.filter(
      (n) => n.playerInfo.id !== target.id(),
    );
    const spawnTile = target.spawnTile();
    const spawnCell =
      spawnTile !== undefined ? this.cell(spawnTile) : undefined;
    const nation = new Nation(spawnCell, target.info());
    this._nations.push(nation);

    const nationExec = new NationExecution(gameID, nation);
    this.addExecution(nationExec);
    return nationExec;
  }

  applySingleplayerConfig(difficulty?: Difficulty): void {
    this.config().setGameType(GameType.Singleplayer);
    if (difficulty !== undefined) {
      this.config().setDifficulty(difficulty);
    }
    for (const exec of this.executions()) {
      if (exec instanceof SpawnTimerExecution) {
        this.removeExecution(exec);
      } else if (
        difficulty !== undefined &&
        exec instanceof NationExecution &&
        exec.isActive() &&
        exec.isInitialized()
      ) {
        exec.refreshDifficulty();
      }
    }
  }

  playerView(id: PlayerID): Player {
    return this.player(id);
  }

  addPlayer(playerInfo: PlayerInfo, team: Team | null = null): Player {
    const player = new PlayerImpl(
      this,
      this.nextPlayerID,
      playerInfo,
      this.config().startManpower(playerInfo),
      team ?? this.maybeAssignTeam(playerInfo),
    );
    this._playersBySmallID.push(player);
    this.nextPlayerID++;
    this._players.set(playerInfo.id, player);
    return player;
  }

  private maybeAssignTeam(player: PlayerInfo): Team | null {
    if (this._config.gameConfig().gameMode !== GameMode.Team) {
      return null;
    }
    if (player.playerType === PlayerType.Bot) {
      return this.botTeam;
    }
    const rand = simpleHash(player.id);
    return this.playerTeams[rand % this.playerTeams.length];
  }

  player(id: PlayerID): Player {
    const player = this._players.get(id);
    if (player === undefined) {
      throw new Error(`Player with id ${id} not found`);
    }
    return player;
  }

  playerByClientID(id: ClientID): Player | null {
    for (const [, player] of this._players) {
      if (player.clientID() === id) {
        return player;
      }
    }
    return null;
  }

  isOnMap(cell: Cell): boolean {
    return (
      cell.x >= 0 &&
      cell.x < this._width &&
      cell.y >= 0 &&
      cell.y < this._height
    );
  }

  neighborsWithDiag(tile: TileRef): TileRef[] {
    const x = this.x(tile);
    const y = this.y(tile);
    const ns: TileRef[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue; // Skip the center tile
        const newX = x + dx;
        const newY = y + dy;
        if (
          newX >= 0 &&
          newX < this._width &&
          newY >= 0 &&
          newY < this._height
        ) {
          ns.push(this._map.ref(newX, newY));
        }
      }
    }
    return ns;
  }

  // Zero-allocation neighbor iteration for performance-critical code
  forEachNeighborWithDiag(
    tile: TileRef,
    callback: (neighbor: TileRef) => void,
  ): void {
    this._map.forEachNeighborWithDiag(tile, callback);
  }

  conquer(owner: PlayerImpl, tile: TileRef): void {
    if (!this.isLand(tile)) {
      throw Error(`cannot conquer water`);
    }
    if (this.isImpassable(tile)) {
      throw Error(`cannot conquer impassable terrain`);
    }
    const previousOwner = this.owner(tile) as TerraNullius | PlayerImpl;
    if (previousOwner.isPlayer()) {
      previousOwner._lastTileChange = this._ticks;
      previousOwner._tileChangeVersion++;
      previousOwner._tiles.delete(tile);
      previousOwner._borderTiles.delete(tile);
    }
    this._territoryVersion++;
    this._map.setOwnerID(tile, owner.smallID());
    owner._tiles.add(tile);
    owner._lastTileChange = this._ticks;
    owner._tileChangeVersion++;
    this.updateBorders(tile);
    this._map.setFallout(tile, false);
    this.recordTileUpdate(tile);
  }

  relinquish(tile: TileRef) {
    if (!this.hasOwner(tile)) {
      throw new Error(`Cannot relinquish tile because it is unowned`);
    }
    if (this.isWater(tile)) {
      throw new Error("Cannot relinquish water");
    }

    const previousOwner = this.owner(tile) as PlayerImpl;
    previousOwner._lastTileChange = this._ticks;
    previousOwner._tileChangeVersion++;
    previousOwner._tiles.delete(tile);
    previousOwner._borderTiles.delete(tile);

    this._territoryVersion++;
    this._map.setOwnerID(tile, 0);
    this.updateBorders(tile);
    this.recordTileUpdate(tile);
  }

  // Reusable neighbor buffer to avoid closures/allocation in updateBorders.
  private borderNbuf: TileRef[] = [0, 0, 0, 0];

  private updateBorders(tile: TileRef) {
    this.updateBorderStatus(tile);
    const numNeighbors = this._map.neighbors4(tile, this.borderNbuf);
    for (let i = 0; i < numNeighbors; i++) {
      this.updateBorderStatus(this.borderNbuf[i]);
    }
  }

  private updateBorderStatus(t: TileRef): void {
    if (!this._map.hasOwner(t)) {
      return;
    }
    const owner = this.owner(t) as PlayerImpl;
    if (this._map.isBorder(t)) {
      owner._borderTiles.add(t);
    } else {
      owner._borderTiles.delete(t);
    }
  }

  target(targeter: Player, target: Player) {
    this.addUpdate({
      type: GameUpdateType.TargetPlayer,
      playerID: targeter.smallID(),
      targetID: target.smallID(),
    });
  }

  public breakAlliance(breaker: Player, alliance: MutableAlliance) {
    let other: Player;
    if (alliance.requestor() === breaker) {
      other = alliance.recipient();
    } else {
      other = alliance.requestor();
    }
    if (!breaker.isAlliedWith(other)) {
      throw new Error(
        `${breaker} not allied with ${other}, cannot break alliance`,
      );
    }
    const duration = this._ticks - alliance.createdAt();
    if (!other.isTraitor() && !other.isDisconnected()) {
      breaker.markTraitor();
      // Only a real betrayal counts as being betrayed. Gated on the same
      // condition as markTraitor so that a teammate dropping their connection
      // is not recorded as having stabbed anyone in the back.
      this.stats().allianceEnded(other, duration, "brokenByOther");
    } else {
      this.stats().allianceEnded(other, duration, null);
    }
    // The breaker's side is already counted by betray(); this call is only
    // here so their longest-held maximum still sees this alliance.
    this.stats().allianceEnded(breaker, duration, null);

    this.detachAlliance(alliance);

    this.addUpdate({
      type: GameUpdateType.BrokeAlliance,
      traitorID: breaker.smallID(),
      betrayedID: other.smallID(),
      allianceID: alliance.id(),
    });
  }

  public expireAlliance(alliance: Alliance) {
    const p1Set = new Set(alliance.recipient().alliances());
    const alliances = alliance
      .requestor()
      .alliances()
      .filter((a) => p1Set.has(a));
    if (alliances.length !== 1) {
      throw new Error(
        `cannot expire alliance: must have exactly one alliance, have ${alliances.length}`,
      );
    }
    const expiring = alliances[0];
    const duration = this._ticks - expiring.createdAt();
    this.stats().allianceEnded(expiring.requestor(), duration, "expired");
    this.stats().allianceEnded(expiring.recipient(), duration, "expired");
    this.detachAlliance(expiring);
    this.addUpdate({
      type: GameUpdateType.AllianceExpired,
      player1ID: alliance.requestor().smallID(),
      player2ID: alliance.recipient().smallID(),
    });
  }

  public removeAlliancesByPlayerSilently(player: Player): void {
    // Snapshot — detachAlliance reassigns the player's _alliances as it goes.
    const removed = [...(player as PlayerImpl)._alliances];
    for (const alliance of removed) {
      // Elimination is the fourth way an alliance ends, and in practice the
      // commonest. Nobody betrayed and nothing expired, so no counter moves;
      // the null counter is here purely so both sides' longest-held maximum
      // still sees the alliance. Without this the survivor's longest held
      // would silently read 0 from an alliance that ran the whole game, and
      // recordAlliancesAtEnd cannot pick it up either — by then it is
      // already detached.
      const duration = this._ticks - alliance.createdAt();
      this.stats().allianceEnded(alliance.requestor(), duration, null);
      this.stats().allianceEnded(alliance.recipient(), duration, null);
      this.detachAlliance(alliance);
    }
  }

  /** Remove an alliance from both participants' per-player alliance lists. */
  private detachAlliance(alliance: Alliance): void {
    const requestor = alliance.requestor() as PlayerImpl;
    const recipient = alliance.recipient() as PlayerImpl;
    requestor._alliances = requestor._alliances.filter((a) => a !== alliance);
    recipient._alliances = recipient._alliances.filter((a) => a !== alliance);
  }

  public isSpawnImmunityActive(): boolean {
    return (
      this.inSpawnPhase() ||
      this.ticksSinceStart() < this.config().spawnImmunityDuration()
    );
  }

  public elapsedGameSeconds(): number {
    return this.ticksSinceStart() / 10;
  }

  public isNationSpawnImmunityActive(): boolean {
    return (
      this.inSpawnPhase() ||
      this.ticksSinceStart() < this.config().nationSpawnImmunityDuration()
    );
  }

  private ticksSinceStart(): number {
    if (this.inSpawnPhase()) {
      return 0;
    }

    return Math.max(0, this.ticks() - this.startTick!);
  }

  sendEmojiUpdate(msg: EmojiMessage): void {
    this.addUpdate({
      type: GameUpdateType.Emoji,
      emoji: msg,
    });
  }

  setWinner(
    winner: Player | Team | null,
    allPlayersStats: AllPlayersStats,
  ): void {
    if (
      this._national !== null &&
      this._nationalConfirmedVictory === null &&
      winner !== null &&
      typeof winner !== "string"
    ) {
      const result = this.nationalVictoryRoster();
      if (result?.prizes[0]?.nationId === winner.id()) {
        this._nationalConfirmedVictory = NationalConfirmedVictorySchema.parse({
          ...result,
          confirmedTick: this._ticks,
        });
      }
    }
    this._winner = winner;
    // OFM: snapshot final tiles for standings (bots skipped in recordFinalTiles).
    for (const player of this.players()) {
      this.stats().recordFinalTiles(player, player.numTilesOwned());
      const standing = player.alliances();
      let longest = 0;
      for (const a of standing) {
        const held = this._ticks - a.createdAt();
        if (held > longest) longest = held;
      }
      this.stats().recordAlliancesAtEnd(player, standing.length, longest);
    }
    this.addUpdate({
      type: GameUpdateType.Win,
      winner: winner === null ? undefined : this.makeWinner(winner),
      allPlayersStats,
    });
  }

  getWinner(): Player | Team | null {
    return this._winner;
  }

  private isEligibleForTeamWin(
    p: Player,
    team: string,
    threshold: number,
  ): boolean {
    if (p.team() !== team || p.clientID() === null || !p.hasSpawned()) {
      return false;
    }
    if (!p.isDisconnected()) return true;
    const snap = p.disconnectSnapshot();
    if (!snap || !snap.wasAlive) return true;
    return (
      snap.totalLand > 0 && 10 * snap.teamTiles >= threshold * snap.totalLand
    );
  }

  makeWinner(winner: string | Player): Winner | undefined {
    if (typeof winner === "string") {
      const threshold = this._config.teamLandShareWinThresholdTenths();
      return [
        "team",
        winner,
        ...this.allPlayers()
          .filter((p) => this.isEligibleForTeamWin(p, winner, threshold))
          .map((p) => p.clientID()!),
      ];
    }
    const clientId = winner.clientID();
    return clientId === null ? ["nation", winner.name()] : ["player", clientId];
  }

  teams(): Team[] {
    if (this._config.gameConfig().gameMode !== GameMode.Team) {
      return [];
    }
    return [this.botTeam, ...this.playerTeams];
  }

  teamTilesOwned(team: Team): number {
    let teamTiles = 0;
    for (const p of this.allPlayers()) {
      if (p.team() === team) teamTiles += p.numTilesOwned();
    }
    return teamTiles;
  }

  totalLandTiles(): number {
    return Math.max(0, this.numLandTiles() - this.numTilesWithFallout());
  }

  teamSpawnArea(team: Team): SpawnArea | undefined {
    if (!this._teamGameSpawnAreas) {
      return undefined;
    }
    const numTeams = this.playerTeams.length;
    const areas = this._teamGameSpawnAreas[String(numTeams)];
    if (!areas) {
      return undefined;
    }
    const teamIndex = this.playerTeams.indexOf(team);
    if (teamIndex < 0 || teamIndex >= areas.length) {
      return undefined;
    }
    return areas[teamIndex];
  }

  displayMessage(
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
    goldAmount?: bigint,
    params?: Record<string, string | number>,
    unitID?: number,
    focusPlayerID?: PlayerID,
  ): void {
    let id: number | null = null;
    if (playerID !== null) {
      id = this.player(playerID).smallID();
    }
    const focusID =
      focusPlayerID !== undefined
        ? this.player(focusPlayerID).smallID()
        : undefined;
    this.addUpdate({
      type: GameUpdateType.DisplayEvent,
      messageType: type,
      message: message,
      playerID: id,
      goldAmount: goldAmount,
      params: params,
      unitID: unitID,
      focusPlayerID: focusID,
    });
  }

  displayChat(
    message: string,
    category: string,
    target: PlayerID | undefined,
    playerID: PlayerID | null,
    isFrom: boolean,
    recipient: string,
  ): void {
    let id: number | null = null;
    if (playerID !== null) {
      id = this.player(playerID).smallID();
    }
    this.addUpdate({
      type: GameUpdateType.DisplayChatEvent,
      key: message,
      category: category,
      target: target,
      playerID: id,
      isFrom,
      recipient: recipient,
    });
  }

  displayIncomingUnit(
    unitID: number,
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
  ): void {
    if (playerID === null) return;
    const id = this.player(playerID).smallID();

    this.addUpdate({
      type: GameUpdateType.UnitIncoming,
      unitID: unitID,
      message: message,
      messageType: type,
      playerID: id,
    });
  }

  // Bumped whenever any player's unit list changes (build, delete, capture);
  // keys the units(type) memo below.
  private _unitsVersion = 0;
  private readonly unitsByTypeMemo = new Map<
    UnitType,
    { version: number; units: Unit[] }
  >();
  bumpUnitsVersion(): void {
    this._unitsVersion++;
  }

  // Bumped when a City, Port or Factory is added or removed (the structures
  // the rail network connects) and when land turns to water (rail paths route
  // around it), so rail previews can be memoised while the trains, shells and
  // boats that churn _unitsVersion come and go.
  private _structureVersion = 0;
  structureVersion(): number {
    return this._structureVersion;
  }
  /** Call when a unit the rail network cares about appears, vanishes or changes visibility. */
  noteStructureChange(u: Unit): void {
    const type = u.type();
    if (
      type === UnitType.City ||
      type === UnitType.Port ||
      type === UnitType.Factory
    ) {
      this._structureVersion++;
    }
  }

  // Bumped on every change of tile ownership, fallout or land/water — i.e.
  // anything Player.nearby() can observe — so per-player answers can be memoised
  // for as long as nothing on the map moved.
  private _territoryVersion = 0;
  territoryVersion(): number {
    return this._territoryVersion;
  }

  addUnit(u: Unit) {
    this._unitsVersion++;
    this.noteStructureChange(u);
    this.unitGrid.addUnit(u);
    this._unitMap.set(u.id(), u);
  }
  removeUnit(u: Unit) {
    this._unitsVersion++;
    this.noteStructureChange(u);
    this.unitGrid.removeUnit(u);
    this._unitMap.delete(u.id());
    this.planDrivenUnitIds.delete(u.id());
    if (u.hasTrainStation()) {
      this._railNetwork.removeStation(u);
    }
  }
  updateUnitTile(u: Unit) {
    this.unitGrid.updateUnitCell(u);
  }

  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ) {
    return this.unitGrid.hasUnitNearby(
      tile,
      searchRange,
      type,
      playerId,
      includeUnderConstruction,
    );
  }

  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: Unit) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean {
    return this.unitGrid.anyUnitNearby(
      tile,
      searchRange,
      types,
      predicate,
      playerId,
      includeUnderConstruction,
    );
  }

  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
    includeUnderConstruction?: boolean,
  ): Array<{ unit: Unit; distSquared: number }> {
    return this.unitGrid.nearbyUnits(
      tile,
      searchRange,
      types,
      predicate,
      includeUnderConstruction,
    ) as Array<{
      unit: Unit;
      distSquared: number;
    }>;
  }

  ref(x: number, y: number): TileRef {
    return this._map.ref(x, y);
  }
  isValidRef(ref: TileRef): boolean {
    return this._map.isValidRef(ref);
  }
  x(ref: TileRef): number {
    return this._map.x(ref);
  }
  y(ref: TileRef): number {
    return this._map.y(ref);
  }
  cell(ref: TileRef): Cell {
    return this._map.cell(ref);
  }
  width(): number {
    return this._map.width();
  }
  height(): number {
    return this._map.height();
  }
  numLandTiles(): number {
    return this._map.numLandTiles();
  }
  waterVersion(): number {
    return this._map.waterVersion();
  }
  isValidCoord(x: number, y: number): boolean {
    return this._map.isValidCoord(x, y);
  }
  isLand(ref: TileRef): boolean {
    return this._map.isLand(ref);
  }
  isImpassable(ref: TileRef): boolean {
    return this._map.isImpassable(ref);
  }
  isOceanShore(ref: TileRef): boolean {
    return this._map.isOceanShore(ref);
  }
  isOcean(ref: TileRef): boolean {
    return this._map.isOcean(ref);
  }
  isShoreline(ref: TileRef): boolean {
    return this._map.isShoreline(ref);
  }
  magnitude(ref: TileRef): number {
    return this._map.magnitude(ref);
  }
  terrainByte(ref: TileRef): number {
    return this._map.terrainByte(ref);
  }
  setShorelineBit(ref: TileRef): void {
    this._map.setShorelineBit(ref);
  }
  clearShorelineBit(ref: TileRef): void {
    this._map.clearShorelineBit(ref);
  }
  setOcean(ref: TileRef): void {
    this._map.setOcean(ref);
  }
  setMagnitude(ref: TileRef, value: number): void {
    this._map.setMagnitude(ref, value);
  }
  ownerID(ref: TileRef): number {
    return this._map.ownerID(ref);
  }
  hasOwner(ref: TileRef): boolean {
    return this._map.hasOwner(ref);
  }
  setOwnerID(ref: TileRef, playerId: number): void {
    this._territoryVersion++;
    return this._map.setOwnerID(ref, playerId);
  }
  hasFallout(ref: TileRef): boolean {
    return this._map.hasFallout(ref);
  }
  isBorder(ref: TileRef): boolean {
    return this._map.isBorder(ref);
  }
  neighbors(ref: TileRef): TileRef[] {
    return this._map.neighbors(ref);
  }
  // Zero-allocation neighbor iteration (cardinal only)
  forEachNeighbor(tile: TileRef, callback: (neighbor: TileRef) => void): void {
    this._map.forEachNeighbor(tile, callback);
  }
  neighbors4(ref: TileRef, out: TileRef[]): number {
    return this._map.neighbors4(ref, out);
  }
  neighbors8(ref: TileRef, out: TileRef[]): number {
    return this._map.neighbors8(ref, out);
  }
  isWater(ref: TileRef): boolean {
    return this._map.isWater(ref);
  }
  isShore(ref: TileRef): boolean {
    return this._map.isShore(ref);
  }
  cost(ref: TileRef): number {
    return this._map.cost(ref);
  }
  terrainType(ref: TileRef): TerrainType {
    return this._map.terrainType(ref);
  }
  forEachTile(fn: (tile: TileRef) => void): void {
    return this._map.forEachTile(fn);
  }
  manhattanDist(c1: TileRef, c2: TileRef): number {
    return this._map.manhattanDist(c1, c2);
  }
  euclideanDistSquared(c1: TileRef, c2: TileRef): number {
    return this._map.euclideanDistSquared(c1, c2);
  }
  circleSearch(
    tile: TileRef,
    radius: number,
    filter?: (tile: TileRef, d2: number) => boolean,
  ): Set<TileRef> {
    return this._map.circleSearch(tile, radius, filter);
  }
  bfsSearch(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
    onVisit?: (tile: TileRef) => boolean | void,
  ): boolean {
    return this._map.bfsSearch(tile, filter, onVisit);
  }
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): ReadonlyTileSet {
    return this._map.bfs(tile, filter);
  }
  tileState(tile: TileRef): number {
    return this._map.tileState(tile);
  }
  tileStateBuffer(): Uint16Array {
    return this._map.tileStateBuffer();
  }
  updateTile(tile: TileRef, state: number): boolean {
    return this._map.updateTile(tile, state);
  }
  numTilesWithFallout(): number {
    return this._map.numTilesWithFallout();
  }
  stats(): Stats {
    return this._stats;
  }
  railNetwork(): RailNetwork {
    return this._railNetwork;
  }
  mirvsLaunched(): number {
    return this._mirvsLaunched;
  }
  recordMirvLaunch(): void {
    this._mirvsLaunched++;
  }
  nextShipStagger(kind: "tradeShip" | "transportShip"): number {
    return this.shipStaggers[kind]++ % WaterPathFinder.STAGGER_SPREAD;
  }
  nationMirvTargets(): Map<PlayerID, Tick> {
    return this._nationMirvTargets;
  }
  /** The PlayerInfo object this game holds for a player id, if any. */
  findPlayerInfo(id: PlayerID): PlayerInfo | undefined {
    return (
      this._players.get(id)?.info() ??
      this._humans.find((h) => h.id === id) ??
      this._nations.find((n) => n.playerInfo.id === id)?.playerInfo
    );
  }
  miniWaterHPA(): PathFinder<number> | null {
    return this._waterManager.miniWaterHPA();
  }
  miniWaterGraph(): AbstractGraph | null {
    return this._waterManager.miniWaterGraph();
  }
  waterGraphVersion(): number {
    return this._waterManager.waterGraphVersion();
  }
  getWaterComponent(tile: TileRef): number | null {
    return this._waterManager.getWaterComponent(tile);
  }
  hasWaterComponent(tile: TileRef, component: number): boolean {
    return this._waterManager.hasWaterComponent(tile, component);
  }
  getWaterComponentSize(tile: TileRef): number | null {
    return this._waterManager.getWaterComponentSize(tile);
  }
  sharedWaterComponents(player: Player): Set<number> | null {
    return this._sharedWaterCache.get(player);
  }
  /**
   * Game-level state for a snapshot. Taken at a tick boundary, so the
   * per-tick update buffers (updates, tile pairs, player and attack quads,
   * motion plans, nuke impacts) are always drained and are not stored.
   */
  snapshotState(w: SnapshotWriter): GameState {
    // Exec list order is state: register both lists first so their table
    // rows come out in tick order.
    const execs = this.execs.map((e) => w.exec(e));
    const unInitExecs = this.unInitExecs.map((e) => w.exec(e));
    return {
      ticks: this._ticks,
      startTick: this.startTick,
      humans: this._humans.map(playerInfoData),
      nations: this._nations.map(nationData),
      players: [...this._players.values()].map((p) => w.player(p)),
      execs,
      unInitExecs,
      allianceRequests: this.allianceRequests.map((r) => w.allianceRequest(r)),
      nextPlayerID: this.nextPlayerID,
      nextUnitID: this._nextUnitID,
      nextAllianceID: this.nextAllianceID,
      units: [...this._unitMap.values()].map((u) => w.unit(u)),
      planDrivenUnitIds: [...this.planDrivenUnitIds],
      unitGrid: this.unitGrid.snapshot((u) => w.unit(u)),
      playerTeams: [...this.playerTeams],
      botTeam: this.botTeam,
      isPaused: this._isPaused,
      winner:
        this._winner === null
          ? null
          : typeof this._winner === "string"
            ? { team: this._winner }
            : { player: w.player(this._winner) },
      ...(this._nationalConfirmedVictory === null
        ? {}
        : { nationalConfirmedVictory: this._nationalConfirmedVictory }),
      unitsVersion: this._unitsVersion,
      territoryVersion: this._territoryVersion,
      shipStaggers: { ...this.shipStaggers },
      nationMirvTargets: [...this._nationMirvTargets],
      mirvsLaunched: this._mirvsLaunched,
      rail: w.versioned(
        RailNetworkSnapshot,
        (this._railNetwork as RailNetworkImpl).snapshot(w),
      ),
      water: w.versioned(WaterManagerSnapshot, this._waterManager.snapshot()),
      sharedWaterCache: w.versioned(
        SharedWaterCacheSnapshot,
        this._sharedWaterCache.snapshot(w),
      ),
      stats: w.versioned(StatsSnapshot, (this._stats as StatsImpl).snapshot()),
      national: this._national?.snapshot() ?? null,
      nationalWar: this._nationalWar?.snapshot() ?? null,
      nationalGovernance: this._nationalGovernance?.snapshot() ?? null,
      nationalRecon: this._nationalRecon?.snapshot() ?? null,
      nationalAssessment: this._nationalAssessment?.snapshot() ?? null,
    };
  }

  /** Registers a restored player shell before any state is filled in. */
  addRestoredPlayer(player: PlayerImpl, id: PlayerID, smallID: number): void {
    this._players.set(id, player);
    this._playersBySmallID[smallID - 1] = player;
  }

  /**
   * Applies game-level state to a game constructed with `restoring`, once
   * every player, unit and execution has been restored.
   */
  restoreState(s: GameState, r: SnapshotReader): void {
    this._ticks = s.ticks;
    this.startTick = s.startTick;
    this.execs = s.execs.map((i) => r.exec(i));
    this.unInitExecs = s.unInitExecs.map((i) => r.exec(i));
    this.allianceRequests = s.allianceRequests.map((i) =>
      r.allianceRequest<AllianceRequestImpl>(i),
    );
    this.nextPlayerID = s.nextPlayerID;
    this._nextUnitID = s.nextUnitID;
    this.nextAllianceID = s.nextAllianceID;
    this._unitMap = new Map(
      s.units.map((i) => {
        const u = r.unit(i);
        return [u.id(), u];
      }),
    );
    this.planDrivenUnitIds = new Set(s.planDrivenUnitIds);
    this.unitGrid.restoreSnapshot(s.unitGrid, (i) => r.unit(i));
    this.playerTeams = [...s.playerTeams];
    this.botTeam = s.botTeam;
    this._isPaused = s.isPaused;
    this._winner =
      s.winner === null
        ? null
        : "team" in s.winner
          ? s.winner.team
          : r.player(s.winner.player);
    this._nationalConfirmedVictory = s.nationalConfirmedVictory ?? null;
    if (
      this._nationalConfirmedVictory !== null &&
      (!this._config.nationalMode() ||
        this._winner === null ||
        typeof this._winner === "string" ||
        this._nationalConfirmedVictory.prizes[0].nationId !==
          this._winner.id() ||
        this._nationalConfirmedVictory.confirmedTick > this._ticks)
    ) {
      throw new Error("NATIONAL inconsistent saved victory");
    }
    this._unitsVersion = s.unitsVersion;
    this._territoryVersion = s.territoryVersion;
    // Not snapshotted: it only keys memos, which must not outlive the restore.
    this._structureVersion++;
    this.shipStaggers = { ...s.shipStaggers };
    this._nationMirvTargets = new Map(s.nationMirvTargets);
    this._mirvsLaunched = s.mirvsLaunched;
    (this._railNetwork as RailNetworkImpl).restoreSnapshot(
      readVersioned(RailNetworkSnapshot, s.rail),
      r,
    );
    this._waterManager.restoreSnapshot(
      readVersioned(WaterManagerSnapshot, s.water),
    );
    this._sharedWaterCache.restoreSnapshot(
      readVersioned(SharedWaterCacheSnapshot, s.sharedWaterCache),
      r,
    );
    (this._stats as StatsImpl).restoreSnapshot(
      readVersioned(StatsSnapshot, s.stats),
    );
    if (this._config.nationalMode()) {
      if (s.national === null)
        throw new Error("NATIONAL snapshot state missing");
      this._nationalAssessment =
        s.nationalAssessment === null
          ? new NationalAssessment()
          : NationalAssessment.restore(s.nationalAssessment, this._ticks);
      for (const shield of this._nationalAssessment.snapshot().shields ?? []) {
        if (!this._players.has(shield.defenderId))
          throw new Error(
            "NATIONAL counterassessment: invalid restored defender",
          );
      }
      for (const grant of this._nationalAssessment.snapshot().grants) {
        if (
          !this._players.has(grant.payerId) ||
          !this._players.has(grant.targetId)
        )
          throw new Error("NATIONAL assessment: invalid restored identity");
      }
      this._nationalRecon =
        s.nationalRecon === null
          ? new NationalReconnaissance()
          : NationalReconnaissance.restore(s.nationalRecon, this._ticks);
      // A restored lease must still point to real match participants and
      // a real coordinate; a forged snapshot must never manufacture intel.
      for (const grant of this._nationalRecon.snapshot().grants) {
        if (
          !this._players.has(grant.payerId) ||
          !this._players.has(grant.targetId) ||
          !this.isValidCoord(grant.centerX, grant.centerY)
        )
          throw new Error(
            "NATIONAL recon: invalid restored identity or region",
          );
      }
      this._national = NationalRuntime.restore(
        s.national,
        this._playersBySmallID.map((p) => p.id()),
        this._ticks,
      );
      this._nationalGovernance = new NationalGovernanceState();
      if (s.nationalGovernance !== null) {
        this._nationalGovernance.restore(s.nationalGovernance, this._ticks);
        for (const receipt of s.nationalGovernance.receipts)
          if (!this._players.has(receipt.actorId))
            throw new Error("NATIONAL journal: restored actor does not exist");
        for (const stored of s.nationalGovernance.memories)
          if (!this._isRestoredHumanPrincipal(stored.observerId))
            throw new Error("NATIONAL sight: restored human principal invalid");
      }
      this.revokeNationalObserverMemory();
      this._nationalWar = new NationalWarStateService(
        this.nationalPoliticalAuthority()!,
        this.nationalTroopDebits(),
      );
      // v2 snapshot migration supplies null (no WAR/LEVY records yet).
      if (s.nationalWar !== null) {
        if (s.nationalWar.wars.lastTick > this._ticks)
          throw new Error("NATIONAL WAR: future conflict snapshot");
        this._nationalWar.restore(s.nationalWar);
      }
    } else {
      if (s.national !== null)
        throw new Error("NATIONAL data in legacy snapshot");
      this._national = null;
      if (s.nationalRecon !== null)
        throw new Error("NATIONAL recon data in legacy snapshot");
      this._nationalRecon = null;
      if (s.nationalAssessment !== null)
        throw new Error("NATIONAL assessment data in legacy snapshot");
      this._nationalAssessment = null;
      if (s.nationalGovernance !== null)
        throw new Error("NATIONAL governance in legacy game snapshot");
      this._nationalGovernance = null;
      if (s.nationalWar !== null)
        throw new Error("NATIONAL WAR state in legacy game snapshot");
      this._nationalWar = null;
    }
  }

  conquerPlayer(conqueror: Player, conquered: Player) {
    if (conquered.isDisconnected() && conqueror.isOnSameTeam(conquered)) {
      const ships = conquered
        .units()
        .filter(
          (u) =>
            u.type() === UnitType.Warship ||
            u.type() === UnitType.TransportShip,
        );

      for (const ship of ships) {
        conqueror.captureUnit(ship);
      }
    }

    // Don't transfer gold when the conquered player didn't play (never attacked anyone)
    // This is especially important when starting gold is enabled
    const stats = this._stats.getPlayerStats(conquered);
    const attacksSent = stats?.attacks?.[ATTACK_INDEX_SENT] ?? 0n;
    const skipGoldTransfer =
      attacksSent === 0n && conquered.type() === PlayerType.Human;
    const gold = skipGoldTransfer ? 0n : conquered.gold();
    const goldCaptured = skipGoldTransfer
      ? 0n
      : this._config.conquerGoldAmount(conquered);

    if (skipGoldTransfer) {
      this.displayMessage(
        "events_display.conquered_no_gold",
        MessageType.CONQUERED_PLAYER,
        conqueror.id(),
        undefined,
        {
          name: conquered.displayName(),
        },
        undefined,
        conquered.id(),
      );
    } else {
      this.displayMessage(
        "events_display.received_gold_from_conquest",
        MessageType.CONQUERED_PLAYER,
        conqueror.id(),
        gold,
        {
          gold: renderNumber(goldCaptured),
          name: conquered.displayName(),
        },
        undefined,
        conquered.id(),
      );
      conqueror.addGold(goldCaptured);
      conquered.removeGold(gold);

      // Record stats
      this.stats().goldWar(conqueror, conquered, goldCaptured);
    }

    // OFM: per-kill log for standings (humans-only filtered in recordKill).
    this.stats().recordKill(conqueror, conquered, this.ticks());
    // OFM live standings: attribute the elimination so the live snapshot can
    // credit the kill (null when the conqueror has no client, e.g. a bot/nation),
    // and stamp the finishing place NOW rather than deferring to PlayerExecution:
    // if the game ends this tick (winner declared) the conquered player's
    // execution may never run again. Exclude the conquered player from the alive
    // count. PlayerExecution keeps the same stamp as a fallback for non-conquest
    // deaths; recordDeathPosition is first-write-wins, so this value sticks.
    this.stats().recordKilledBy(conquered, conqueror.clientID());
    this.stats().recordDeathPosition(
      conquered,
      this.players().filter(
        (p) => p !== conquered && p.type() !== PlayerType.Bot,
      ).length + 1,
    );

    this.addUpdate({
      type: GameUpdateType.ConquestEvent,
      conquerorId: conqueror.id(),
      conqueredId: conquered.id(),
      gold: goldCaptured,
    });
  }
}

export const GameSnapshot = snapshotType({
  name: "Game",
  version: 7,
  migrations: {
    1: (data: unknown) => ({
      ...(data as Record<string, unknown>),
      national: null,
    }),
    2: (data: unknown) => ({
      ...(data as Record<string, unknown>),
      nationalWar: null,
    }),
    3: (data: unknown) => ({
      ...(data as Record<string, unknown>),
      nationalGovernance: null,
    }),
    4: (data: unknown) => ({
      ...(data as Record<string, unknown>),
      nationalRecon: null,
    }),
    5: (data: unknown) => ({
      ...(data as Record<string, unknown>),
      nationalAssessment: null,
    }),
    // Old saves did not record the terminal award roster. Never reconstruct it.
    6: (data: unknown) => ({ ...(data as Record<string, unknown>) }),
  },
  schema: z.object({
    ticks: zInt(),
    startTick: zInt().nullable(),
    humans: z.array(PlayerInfoSchema),
    nations: z.array(NationSchema),
    players: z.array(zPlayerRef()),
    execs: z.array(zRef()),
    unInitExecs: z.array(zRef()),
    allianceRequests: z.array(zRef()),
    nextPlayerID: zInt(),
    nextUnitID: zInt(),
    nextAllianceID: zInt(),
    units: z.array(zRef()),
    planDrivenUnitIds: z.array(zInt()),
    unitGrid: z.array(z.array(z.tuple([UnitTypeSchema, z.array(zRef())]))),
    playerTeams: z.array(z.string()),
    botTeam: z.string(),
    isPaused: z.boolean(),
    winner: z
      .union([
        z.object({ player: zPlayerRef() }),
        z.object({ team: z.string() }),
      ])
      .nullable(),
    nationalConfirmedVictory: NationalConfirmedVictorySchema.optional(),
    unitsVersion: zInt(),
    territoryVersion: zInt(),
    shipStaggers: z.object({ tradeShip: zInt(), transportShip: zInt() }),
    nationMirvTargets: z.array(z.tuple([z.string(), zInt()])),
    mirvsLaunched: zInt(),
    rail: VersionedSchema,
    water: VersionedSchema,
    sharedWaterCache: VersionedSchema,
    stats: VersionedSchema,
    national: NationalRuntimeSnapshotSchema.nullable(),
    nationalWar: NationalWarStateSnapshotSchema.nullable(),
    nationalGovernance: NationalGovernanceSnapshotSchema.nullable(),
    nationalRecon: NationalReconnaissanceSnapshotSchema.nullable(),
    nationalAssessment: NationalAssessmentSnapshotSchema.nullable(),
  }),
});
export type GameState = z.infer<typeof GameSnapshot.schema>;

const ALL_GAME_UPDATE_TYPES: readonly GameUpdateType[] = Object.values(
  GameUpdateType,
).filter((key): key is GameUpdateType => typeof key === "number");

const createGameUpdatesMap = (): GameUpdates => {
  const map = {} as GameUpdates;
  for (let i = 0; i < ALL_GAME_UPDATE_TYPES.length; i++) {
    map[ALL_GAME_UPDATE_TYPES[i]] = [];
  }
  return map;
};
