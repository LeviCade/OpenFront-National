import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Cell,
  formatPlayerDisplayName,
  GameUpdates,
  PlayerID,
  PlayerType,
  Team,
  TerrainType,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  GameUpdateViewData,
  PlayerUpdate,
  SpawnPhaseEndUpdate,
  UnitUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import {
  GameLike,
  ReadonlyTileSet,
  UnitPredicate,
} from "@openfront/engine-api/game/ReadViews";
import { ClientID, GameID } from "@openfront/engine-api/Schemas";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { unpackMotionPlans } from "@openfront/engine-lib/game/MotionPlans";
import {
  PackedUnitUpdateDecoder,
  UNIT_UPDATE_STRIDE,
  unpackUnitUpdates,
} from "@openfront/engine-lib/game/PackedUnitUpdates";
import { TerrainMapData } from "@openfront/engine-lib/game/TerrainMapLoader";
import { TerraNulliusImpl } from "@openfront/engine-lib/game/TerraNulliusImpl";
import { UnitGrid } from "@openfront/engine-lib/game/UnitGrid";
import { PlayerCosmetics, WirePlayer } from "@openfront/shared/WireSchemas";
import {
  readNationalAccessionOffers,
  readNationalConflicts,
  readNationalDiplomacyResults,
  readNationalPoliticalResults,
  retainNationalPoliticalResults,
  readNationalFoundingResults,
  readNationalPolitics,
  retainNationalDiplomacyResults,
  retainNationalFoundingReceipts,
  type NationalDiplomacyResult,
  type NationalPublicConflicts,
  type NationalFoundingResult,
  type NationalPublicPolitics,
  type NationalAccessionView,
  type NationalPoliticalResult,
} from "../NationalDiplomacyState";
import type {
  NationalObserverMapContinuity,
  NationalObserverMapDelta,
} from "../NationalObserverMapContinuity";
import { computeAllianceClusters } from "../render/frame/derive/AllianceClusters";
import { extractAttackRings } from "../render/frame/derive/AttackRings";
import { extractNukeTelegraphs } from "../render/frame/derive/NukeTelegraphs";
import { computePlayerStatus } from "../render/frame/derive/PlayerStatus";
import { buildRelationMatrix } from "../render/frame/derive/RelationMatrix";
import { RailroadCache } from "../render/frame/RailroadCache";
import type { SpiralParams } from "../render/frame/SpiralTrails";
import { SpiralTrails } from "../render/frame/SpiralTrails";
import { TrailManager } from "../render/frame/TrailManager";
import type { FrameData, NameEntry } from "../render/types";
import { STRUCTURE_TYPES, TRAIL_TYPES } from "../render/types";
import type { TrustedNationalObserverMap } from "../TrustedNationalSession";
import { UserSettings } from "../UserSettings";
import { resolveTeamClanTag } from "../Utils";
import { WorkerClient } from "../WorkerClient";
import type { CosmeticVisibility } from "./CosmeticVisibility";
import {
  applyPackedAttackTroops,
  applyPackedPlayerStats,
  embargoSmallIDs,
} from "./EntityState";
import {
  MotionPlanResolver,
  type GridMotionPlan,
  type PlannedUnits,
} from "./MotionPlanResolver";
import { PlayerView } from "./PlayerView";
import { UnitView } from "./UnitView";

function readCosmeticVisibility(): CosmeticVisibility {
  return new UserSettings().graphicsOverrides().cosmetics ?? {};
}

export class GameView implements GameLike {
  private lastUpdate: GameUpdateViewData | null;
  // Authoritative, viewer-filtered worker values only. Never reconstruct
  // sovereignty from local intents or speculative client player data.
  private _nationalPolitics: NationalPublicPolitics | null = null;
  private _nationalFoundingOutcome: NationalFoundingResult | null = null;
  private _nationalFoundingResults: readonly NationalFoundingResult[] = [];
  private _nationalDiplomacyResults: readonly NationalDiplomacyResult[] = [];
  private _nationalConflicts: NationalPublicConflicts | null = null;
  private _nationalConflictsTick: number | null = null;
  private _nationalPoliticsTick: number | null = null;
  private _nationalAccessionOffers: NationalAccessionView | null = null;
  private _nationalPoliticalResults: readonly NationalPoliticalResult[] = [];
  private _trustedProjectionReady = false;
  private trustedPrincipal: string | null = null;
  private trustedSight: NationalObserverMapContinuity | null = null;

  public setTrustedPrincipal(principal: string | null): void {
    this.trustedPrincipal = principal;
  }
  private readonly trustedUnitMarkers = new Map<
    number,
    TrustedNationalObserverMap["units"][number]
  >();
  private trustedMarkerRevision = 0;

  public trustedObserverMarkerRevision(): number {
    return this.trustedMarkerRevision;
  }

  /** Fallback geometry is explicitly coarse; never fabricate a UnitType or private strength. */
  public *trustedObserverFallbackMarkers(): Iterable<
    TrustedNationalObserverMap["units"][number]
  > {
    for (const marker of this.trustedUnitMarkers.values()) {
      if (!this._units.has(marker.id)) yield marker;
    }
  }
  private readonly trustedOriginalTerrain = new Map<TileRef, number>();
  private trustedPendingTiles: TileRef[] = [];
  private trustedPendingTerrain: TileRef[] = [];
  private _trustedSpawnReady = false;

  public trustedSpawnReady(): boolean {
    return this._trustedNationalProjection && this._trustedSpawnReady && this.inSpawnPhase();
  }

  public setTrustedSpawnReady(ready: boolean): void {
    if (this._trustedNationalProjection) this._trustedSpawnReady = ready;
  }

  /** Tile and unit pager epochs are independent. A tile clear must not erase authorized units. */
  public resetTrustedTileSight(): void {
    if (!this._trustedNationalProjection) return;
    this._trustedProjectionReady = false;
    this._trustedSpawnReady = false;
    this.trustedPendingTiles = [];
    for (const [tile, terrain] of this.trustedOriginalTerrain) {
      if (this._map.updateTile(tile, terrain << 16)) this.trustedPendingTerrain.push(tile);
    }
    this.trustedOriginalTerrain.clear();
    this._map.tileStateBuffer().fill(0);
    for (const player of this._players.values()) player.nameData = undefined;
    this._names.clear();
    this._namesDirty = true;
    this._firstPopulate = true;
  }

  /** Sparse revocations publish only changed native tile refs, including restored terrain. */
  public reconcileTrustedTileVisibility(removed: readonly TileRef[]): void {
    if (!this._trustedNationalProjection || !removed.length) return;
    const removedSet = new Set(removed);
    for (const tile of removed) {
      const terrain = this.trustedOriginalTerrain.get(tile) ?? this._map.terrainByte(tile);
      if (this._map.updateTile(tile, terrain << 16)) this.trustedPendingTerrain.push(tile);
      this.trustedOriginalTerrain.delete(tile);
      this.trustedPendingTiles.push(tile);
    }
    for (const player of this._players.values()) {
      const name = player.nameData;
      if (name && removedSet.has(this._map.ref(Math.floor(name.x), Math.floor(name.y)))) {
        player.nameData = undefined;
        this._namesDirty = true;
      }
    }
  }

  /** Strictly a view of the E3 recipient packet, NEVER a browser GameRunner. */
  public isTrustedNationalProjection(): boolean {
    return this._trustedNationalProjection;
  }

  /** True only after a matching E2 seat receives a validated E3 frame. */
  public trustedProjectionReady(): boolean {
    return this._trustedNationalProjection && this._trustedProjectionReady;
  }

  public markTrustedProjectionReady(): void {
    this.setTrustedProjectionReady(true);
  }

  public setTrustedProjectionReady(ready: boolean): void {
    if (!this._trustedNationalProjection) return;
    this._trustedProjectionReady = ready;
  }

  /**
   * E3 observer-map reset (new socket or lost empire sight). Erase every
   * previously visible owner and unit before processing the new authorized
   * page. Do NOT retain old enemy locations as "last known" facts.
   */
  public resetTrustedProjectionSight(): void {
    if (!this._trustedNationalProjection) return;
    this._trustedProjectionReady = false;
    this._trustedSpawnReady = false;
    this.trustedPendingTiles = [];
    this.trustedPendingTerrain = [];
    this.trustedSight = null;
    this.updatedTerrainTiles = [];
    for (const [tile, terrain] of this.trustedOriginalTerrain) {
      if (this._map.updateTile(tile, terrain << 16))
        this.updatedTerrainTiles.push(tile);
    }
    this.trustedOriginalTerrain.clear();
    this._map.tileStateBuffer().fill(0);
    this.updatedTiles = [];
    this.nukeImpactTiles = [];
    this.trustedUnitMarkers.clear();
    this.trustedMarkerRevision++;
    this.trailManager.reset();
    this.spiralTrails.reset();
    this.railroadCache.reset();
    for (const player of this._players.values()) player.nameData = undefined;
    const frame = this._frame as {
      -readonly [K in keyof FrameData]: FrameData[K];
    };
    frame.changedTiles = null;
    frame.structuresDirty = true;
    frame.railroadDirty = true;
    frame.events.deadUnits.length = 0;
    frame.events.conquestEvents.length = 0;
    frame.events.bonusEvents.length = 0;
    frame.attackRings = [];
    frame.nukeTelegraphs = [];
    frame.playerStatus = new Map();
    frame.relationMatrix = new Uint8Array(1024 * 1024);
    frame.relationSize = 1024;
    frame.relationsDirty = true;
    frame.allianceClusters = new Map();
    this._relationsDirty = true;
    this._clustersDirty = true;
    this._firstPopulate = true;
    this._units.clear();
    this._unitStates.clear();
    this._unitsByOwner.clear();
    this._unitsByOwnerStale = true;
    this.toDelete.clear();
    // Names are renderer state too: retain no former ally/enemy placement
    // after E3 withdraws sight, even if the same browser view survives.
    this._names.clear();
    this._namesDirty = true;
    this.unitGrid = new UnitGrid<UnitView>(this._map);
    this.invalidateNationalPoliticalView();
  }

  /** Unit visibility revocation is not a battle death. Remove from native indices before applying the next frame. */
  public reconcileTrustedUnitVisibility(
    clear: boolean,
    removed: readonly number[],
  ): void {
    if (!this._trustedNationalProjection) return;
    const ids = clear ? [...this._units.keys()] : removed;
    if (clear) this.trustedUnitMarkers.clear();
    if (clear || removed.length > 0) this.trustedMarkerRevision++;
    for (const id of ids) {
      this.trustedUnitMarkers.delete(id);
      const unit = this._units.get(id);
      if (unit) this.unitGrid.removeUnit(unit);
      this._units.delete(id);
      this._unitStates.delete(id);
      this.toDelete.delete(id);
      this.motion.unitRemoved(id);
    }
    if (ids.length) {
      this._structuresDirty = true;
      this._unitsByOwnerStale = true;
    }
  }

  /** Keep exact native unit DTOs only after the independently accepted marker authorizes their ID. */
  public applyTrustedUnitPage(
    update: GameUpdateViewData,
    delta: NationalObserverMapDelta,
    receiver: NationalObserverMapContinuity,
  ): void {
    this.trustedSight = receiver;
    for (const marker of delta.units) {
      const previous = this.trustedUnitMarkers.get(marker.id);
      if (
        previous?.tile !== marker.tile ||
        previous.ownerId !== marker.ownerId ||
        previous.kind !== marker.kind
      )
        this.trustedMarkerRevision++;
      this.trustedUnitMarkers.set(marker.id, marker);
      // Coarse sight is independent from the detailed PackedUnit lane. If
      // the latter disappears, never leave an old detailed unit position.
      const native = this._units.get(marker.id);
      if (native && native.tile() !== marker.tile) {
        this.reconcileTrustedUnitVisibility(false, [marker.id]);
        this.trustedUnitMarkers.set(marker.id, marker);
      }
    }
    if (!update.packedUnitUpdates) return;
    const kept: number[] = [];
    const currentMarkers = new Map(delta.units.map((marker) => [marker.id, marker]));
    const buffer = update.packedUnitUpdates;
    for (let offset = 0; offset < buffer.length; offset += UNIT_UPDATE_STRIDE) {
      const decoded = new PackedUnitUpdateDecoder(buffer, offset);
      const marker = currentMarkers.get(decoded.id);
      if (!marker || decoded.pos !== marker.tile)
        throw new Error("NATIONAL native unit outside current authorized page");
      if (!decoded.isActive) {
        this.reconcileTrustedUnitVisibility(false, [decoded.id]);
        continue;
      }
      if (!this._units.has(decoded.id)) this.trustedMarkerRevision++;
      for (let i = 0; i < UNIT_UPDATE_STRIDE; i++)
        kept.push(buffer[offset + i]);
    }
    update.packedUnitUpdates = Float64Array.from(kept);
    // No trails/missile queue can be reconstructed from observer markers.
    update.packedMissileTimers = undefined;
  }

  /**
   * Radial Attack can be offered for a currently sighted opposing tile.
   * This is UI eligibility ONLY; the authoritative host may reject the intent.
   * Never infer targets from unsighted tiles, hidden game state or other clients.
   */
  public trustedVisibleAttack(
    playerID: string,
    tile: TileRef | undefined,
  ): boolean {
    if (
      !this._trustedNationalProjection ||
      !this._trustedProjectionReady ||
      tile === undefined ||
      this.inSpawnPhase() ||
      !this.isValidRef(tile) ||
      !this.hasOwner(tile)
    )
      return false;
    const actor = this.myPlayer();
    const target = this.owner(tile);
    return (
      actor !== null &&
      actor.id() === playerID &&
      actor.isAlive() &&
      actor.hasSpawned() &&
      actor.troops() > 0 &&
      target.isPlayer() &&
      target.id() !== playerID
    );
  }

  /**
   * Native intent eligibility, not an authority oracle. Undefined means the
   * current sight/war projection does not permit offering this action; null
   * is a positively sighted neutral land tile, never an unknown/fog tile.
   * Private treaties, geographic frontiers and execution remain host-owned.
   */
  public trustedAttackTarget(
    playerID: string,
    tile: TileRef | undefined,
  ): PlayerID | null | undefined {
    if (
      !this.trustedProjectionReady() ||
      tile === undefined ||
      this.inSpawnPhase() ||
      !this.isValidRef(tile) ||
      !this.isLand(tile) ||
      this.trustedSight?.tileStatus(tile) !== "observed"
    ) return undefined;
    const actor = this.myPlayer();
    if (!actor || actor.id() !== playerID || !actor.isAlive() || !actor.hasSpawned() || actor.troops() <= 0)
      return undefined;
    const smallID = this.ownerID(tile);
    if (smallID === 0) return null;
    const targetID = this.smallIDToID.get(smallID);
    if (!targetID || targetID === playerID || !this._players.get(targetID)?.isAlive())
      return undefined;
    const politics = this.nationalPolitics();
    const conflicts = this.nationalConflicts();
    if (!politics || !conflicts || conflicts.recipientId !== playerID ||
        this._nationalConflictsTick !== this.ticks() || this._nationalPoliticsTick !== this.ticks())
      return undefined;
    const empireOf = (id: PlayerID) => politics.empires.find((empire) => empire.memberIds.includes(id))?.id;
    const actorEmpire = empireOf(playerID);
    const targetEmpire = empireOf(targetID);
    if (actorEmpire !== undefined && actorEmpire === targetEmpire) return undefined;
    const contains = (side: { kind: "nation" | "empire"; id: string }, id: PlayerID, empire: string | undefined) =>
      side.kind === "nation" ? side.id === id : side.id === empire;
    const opposed = conflicts.layers.some((layer) =>
      layer.endedTick === null &&
      ((contains(layer.first, playerID, actorEmpire) && contains(layer.second, targetID, targetEmpire)) ||
        (contains(layer.second, playerID, actorEmpire) && contains(layer.first, targetID, targetEmpire))),
    );
    return opposed ? targetID : undefined;
  }

  /**
   * A stale nameLocation from a previous E3 sight lease must not be drawn.
   * Public roster membership is NOT permission to reveal map coordinates.
   */
  public trustedNameVisible(player: PlayerView): boolean {
    if (!this._trustedNationalProjection) return true;
    if (!this._trustedProjectionReady || !player.nameData) return false;
    const { x, y } = player.nameData;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    if (!this.isValidCoord(tileX, tileY)) return false;
    const tile = this.ref(tileX, tileY);
    if (!this.hasOwner(tile)) return false;
    const owner = this.owner(tile);
    return owner.isPlayer() && owner.id() === player.id();
  }

  public nationalPolitics(): Readonly<NationalPublicPolitics> | null {
    return this._nationalPolitics;
  }

  public nationalFoundingOutcome(): Readonly<NationalFoundingResult> | null {
    return this._nationalFoundingOutcome;
  }

  /** Short-lived, recipient-bound results received in this live session. */
  public nationalFoundingResults(): readonly Readonly<NationalFoundingResult>[] {
    return this._nationalFoundingResults;
  }

  /** A recipient's real, short-lived E1 WAR/peace receipts only. */
  public nationalDiplomacyResults(): readonly Readonly<NationalDiplomacyResult>[] {
    return this._nationalDiplomacyResults;
  }

  /** Only a fully validated, recipient-bound E3 snapshot is authoritative. */
  public nationalConflicts(): Readonly<NationalPublicConflicts> | null {
    return this._nationalConflicts;
  }

  public nationalConflictsTick(): number | null {
    return this._nationalConflictsTick;
  }

  /** Invites are recipient-only; null means NOT VERIFIED, not zero offers. */
  public nationalAccessionOffers(): Readonly<NationalAccessionView> | null {
    return this._nationalAccessionOffers;
  }

  public nationalPoliticalResults(): readonly Readonly<NationalPoliticalResult>[] {
    return this._nationalPoliticalResults;
  }

  /** Null means the worker has not delivered a valid public roster. */
  public nationalPoliticsTick(): number | null {
    return this._nationalPoliticsTick;
  }

  /** Invalidate an old roster on disconnect; await a new GameRunner packet. */
  public invalidateNationalPoliticalView(): void {
    this._nationalPolitics = null;
    this._nationalPoliticsTick = null;
    this._nationalFoundingResults = [];
    this._nationalDiplomacyResults = [];
    this._nationalFoundingOutcome = null;
    this._nationalConflicts = null;
    this._nationalConflictsTick = null;
    this._nationalAccessionOffers = null;
    this._nationalPoliticalResults = [];
  }
  private startTick: Tick | null = null;
  private smallIDToID = new Map<number, PlayerID>();
  private _players = new Map<PlayerID, PlayerView>();
  private _units = new Map<number, UnitView>();
  /**
   * Long-lived state maps (renderer's plain-object shape). Each entry shares
   * its identity with the corresponding PlayerView.state / UnitView.state, so
   * mutations through either path are visible everywhere.
   */
  private _playerStates = new Map<
    number,
    import("../render/types").PlayerState
  >();
  private _unitStates = new Map<number, import("../render/types").UnitState>();
  /** smallID → team, for the renderer's relation matrix (team games). */
  private _teams = new Map<number, string>();
  private _teamClanTags: Map<Team, string | null> | null = null;
  private updatedTiles: TileRef[] = [];
  private updatedTerrainTiles: TileRef[] = [];
  private nukeImpactTiles: TileRef[] = [];
  /**
   * Active units grouped by owner smallID, built lazily at most once per
   * tick. Keeps per-player unit queries (PlayerView.units) at O(own units)
   * instead of O(all units) — the leaderboard asks for every player's units
   * in one pass, which is O(players × units) without this.
   */
  private _unitsByOwner = new Map<number, UnitView[]>();
  private _unitsByOwnerStale = true;

  // ── FrameData accumulators (renderer-bound state) ─────────────────────
  private trailManager!: TrailManager;
  private spiralTrails!: SpiralTrails;
  private railroadCache!: RailroadCache;
  /** Long-lived NameEntry map for the renderer's NamePass. */
  private _names = new Map<string, NameEntry>();
  /** Reusable scratch buffers for per-tick deltas. */
  private readonly _trailIdsScratch: number[] = [];
  /**
   * The single long-lived FrameData object. Fields are mutated in place each
   * tick by update(). Renderer reads this each frame via frameData().
   */
  private _frame: FrameData;
  private _structuresDirty = false;
  /** True until first populateFrame() — controls full-vs-delta tile upload. */
  private _firstPopulate = true;

  private _myPlayer: PlayerView | null = null;
  private _wasInSpawnPhase = true;

  // ── populateFrame dirty flags ──────────────────────────────────────────
  // The derived structures below only depend on rarely-changing player
  // fields, so they're rebuilt only when one of their inputs arrived this
  // tick (PlayerUpdates are partial — field presence means "changed").
  /** Names: nameData record applied, or a player was added. */
  private _namesDirty = true;
  /** Relation matrix: allies/embargoes changed, or a player was added. */
  private _relationsDirty = true;
  /** Alliance clusters: allies changed, or a player was added. */
  private _clustersDirty = true;

  private unitGrid: UnitGrid<UnitView>;
  private readonly motion = new MotionPlanResolver();
  /** How the resolver moves this view's units. */
  private readonly plannedUnits: PlannedUnits = {
    tileOf: (id) => {
      const unit = this._units.get(id);
      return unit?.isActive() ? unit.tile() : undefined;
    },
    move: (id, tile) => {
      const unit = this._units.get(id)!;
      unit.applyDerivedPosition(tile as TileRef);
      this.unitGrid.updateUnitCell(unit);
    },
    rest: (id) => this._units.get(id)!.applyDerivedRest(),
  };

  private toDelete = new Set<number>();

  private _cosmetics: Map<string, PlayerCosmetics> = new Map();
  private _cosmeticVisibility: CosmeticVisibility = readCosmeticVisibility();

  private _map: GameMap;

  constructor(
    public worker: WorkerClient,
    private _config: Config,
    private _mapData: TerrainMapData,
    private _myClientID: ClientID | undefined,
    private _myUsername: string,
    private _myClanTag: string | null,
    private _gameID: GameID,
    humans: WirePlayer[],
    private _resumedFromSave = false,
    private readonly _trustedNationalProjection = false,
  ) {
    this._map = this._mapData.gameMap;
    this.lastUpdate = null;
    this.unitGrid = new UnitGrid<UnitView>(this._map);
    this._cosmetics = new Map(
      humans.map((h) => [h.clientID, h.cosmetics ?? {}]),
    );

    // Nation-type players carry their own flag on the wire (PlayerUpdate.nationFlag,
    // sourced from the manifest via PlayerInfo) rather than being looked up here by
    // name — some maps define multiple nations with the same display name (e.g.
    // India's and Pakistan's "Punjab", split by the 1947 partition), and a name-keyed
    // lookup can't tell those apart. See the Nation-branch in update() below.

    const mapW = this._map.width();
    const mapH = this._map.height();
    this.trailManager = new TrailManager(mapW, mapH);
    this.spiralTrails = new SpiralTrails(mapW);
    this.railroadCache = new RailroadCache(mapW, mapH);

    // Long-lived FrameData. Most fields are mutable references to long-lived
    // buffers (tileState, trailState, etc.); changedTiles points at this
    // tick's updatedTiles. Properties marked `readonly` on FrameData only
    // prevent reassignment, not mutation through the reference.
    // events: fresh arrays we own; cleared and repopulated each tick.
    this._frame = {
      tick: 0,
      inSpawnPhase: true,
      namesSnap: false,
      tileState: this._map.tileStateBuffer(),
      trailState: this.trailManager.getTrailState(),
      spiralRibbons: this.spiralTrails.getRibbons(),
      railroadState: this.railroadCache.railroadState,
      units: this._unitStates,
      players: this._playerStates,
      names: this._names,
      events: {
        deadUnits: [],
        conquestEvents: [],
        bonusEvents: [],
      },
      changedTiles: null,
      railroadDirty: false,
      revealedRailTiles: this.railroadCache.revealedRailTiles,
      trailDirtyRowMin: 0,
      trailDirtyRowMax: -1,
      // Derived data — populated each tick by populateFrame(). Empty defaults
      // here so the type is satisfied before the first update().
      playerStatus: new Map(),
      relationMatrix: new Uint8Array(0),
      relationSize: 0,
      relationsDirty: false,
      allianceClusters: new Map(),
      nukeTelegraphs: [],
      attackRings: [],
      structuresDirty: false,
    };
  }

  isOnEdgeOfMap(ref: TileRef): boolean {
    return this._map.isOnEdgeOfMap(ref);
  }

  public updatesSinceLastTick(): GameUpdates | null {
    return this.lastUpdate?.updates ?? null;
  }

  public isPaused(): boolean {
    const pauses = this.lastUpdate?.updates[GameUpdateType.GamePaused];
    return pauses?.[pauses.length - 1]?.paused ?? false;
  }

  public motionPlans(): ReadonlyMap<number, GridMotionPlan> {
    return this.motion.gridPlans();
  }

  public motionPlannedUnitIds(): number[] {
    return this.motion.plannedUnitIds();
  }

  public isCatchingUp(): boolean {
    return (this.lastUpdate?.pendingTurns ?? 0) > 1;
  }

  public update(gu: GameUpdateViewData) {
    // Unit set/ownership changes below; rebuild the owner index on demand.
    this._unitsByOwnerStale = true;

    this.toDelete.forEach((id) => {
      this._units.delete(id);
      this._unitStates.delete(id);
    });
    this.toDelete.clear();

    const previousTick = this.lastUpdate?.tick ?? -1;
    this.lastUpdate = gu;

    // Legacy/replay test adapters can provide a partial Config without
    // gameConfig(). Keep ordinary FFA view updates entirely unchanged.
    if (
      typeof this._config.gameConfig === "function" &&
      this._config.gameConfig().nationalMode === true
    ) {
      // Contract supplied by E1/E3: a complete public projection per tick and
      // a per-principal result. Missing/invalid projections NEVER mean success.
      const nationalPacket = gu as GameUpdateViewData & {
        nationalPolitics?: unknown;
        nationalConflicts?: unknown;
        nationalCommandResults?: unknown;
        nationalAccessionOffers?: unknown;
      };
      this._nationalPolitics = readNationalPolitics(
        nationalPacket.nationalPolitics,
      );
      this._nationalPoliticsTick =
        this._nationalPolitics === null ? null : gu.tick;

      const currentActorId =
        this.trustedPrincipal ?? this._myPlayer?.id() ?? null;
      this._nationalAccessionOffers = readNationalAccessionOffers(
        nationalPacket.nationalAccessionOffers,
        currentActorId,
      );
      this._nationalConflicts =
        this._nationalPolitics === null
          ? null
          : readNationalConflicts(
              nationalPacket.nationalConflicts,
              currentActorId,
              gu.tick,
            );
      this._nationalConflictsTick =
        this._nationalConflicts === null ? null : gu.tick;

      // E3 emits each journal result ONCE. HUD components may refresh slower
      // than engine ticks; retain a bounded, principal-scoped receipt buffer
      // until the panel sees it. Old request ticks cannot acknowledge a new
      // click, and disconnect/replay rewind clears all buffered receipts.
      const myActorId = this.trustedPrincipal ?? this._myPlayer?.id() ?? null;
      const received =
        myActorId === null
          ? []
          : readNationalFoundingResults(
              nationalPacket.nationalCommandResults,
            ).filter(
              (outcome) =>
                outcome.actorId === myActorId &&
                outcome.recipientId === myActorId &&
                typeof outcome.tick === "number" &&
                outcome.tick <= gu.tick,
            );
      this._nationalFoundingResults = retainNationalFoundingReceipts(
        this._nationalFoundingResults,
        received,
        gu.tick,
        gu.tick < previousTick || this._nationalPolitics === null,
      );
      this._nationalFoundingOutcome =
        this._nationalFoundingResults[
          this._nationalFoundingResults.length - 1
        ] ?? null;
      const diplomacyReceived =
        myActorId === null
          ? []
          : readNationalDiplomacyResults(
              nationalPacket.nationalCommandResults,
            ).filter(
              (result) =>
                result.actorId === myActorId &&
                result.recipientId === myActorId &&
                result.tick <= gu.tick,
            );
      this._nationalDiplomacyResults = retainNationalDiplomacyResults(
        this._nationalDiplomacyResults,
        diplomacyReceived,
        gu.tick,
        gu.tick < previousTick || this._nationalPolitics === null,
      );
      const politicalReceived = readNationalPoliticalResults(
        nationalPacket.nationalCommandResults,
        myActorId,
      ).filter((item) => item.tick <= gu.tick);
      this._nationalPoliticalResults = retainNationalPoliticalResults(
        this._nationalPoliticalResults,
        politicalReceived,
        gu.tick,
        gu.tick < previousTick || this._nationalPolitics === null,
      );
    }

    this.updatedTiles = this.trustedPendingTiles;
    this.updatedTerrainTiles = this.trustedPendingTerrain;
    this.trustedPendingTiles = [];
    this.trustedPendingTerrain = [];
    const packed = this.lastUpdate.packedTileUpdates;
    for (let i = 0; i + 1 < packed.length; i += 2) {
      const tile = packed[i];
      const state = packed[i + 1];
      if (this._trustedNationalProjection) {
        const terrain = this._map.terrainByte(tile);
        if (
          this._map.tileState(tile) === (state & 0xffff) &&
          terrain === ((state >>> 16) & 0xff)
        )
          continue;
        if (
          terrain !== ((state >>> 16) & 0xff) &&
          !this.trustedOriginalTerrain.has(tile)
        )
          this.trustedOriginalTerrain.set(tile, terrain);
      }
      const terrainChanged = this.updateTile(tile, state);
      this.updatedTiles.push(tile);
      if (terrainChanged) {
        this.updatedTerrainTiles.push(tile);
      }
    }

    // Nuke blast-radius tiles (for nukeable layer destruction).
    const packedNukes = gu.packedNukeImpacts;
    this.nukeImpactTiles = packedNukes ? Array.from(packedNukes) : [];

    if (gu.packedMotionPlans) {
      this.motion.applyRecords(unpackMotionPlans(gu.packedMotionPlans));
    }

    if (gu.updates === null) {
      throw new Error("lastUpdate.updates not initialized");
    }

    const spawnPhaseEndUpdate = gu.updates[GameUpdateType.SpawnPhaseEnd][0] as
      | SpawnPhaseEndUpdate
      | undefined;
    if (spawnPhaseEndUpdate) {
      this.startTick = spawnPhaseEndUpdate.startTick;
    }
    if (gu.updates[GameUpdateType.Win].length > 0) {
      this._gameOver = true;
    }

    const myDisplayName = formatPlayerDisplayName(
      this._myUsername,
      this._myClanTag,
    );

    // Name placements arrive only on ticks where the worker recomputed them
    // (see GameUpdateViewData.playerNameViewData). Apply to existing alive
    // players here; dead players keep their last placement (names freeze at
    // death), and new players get theirs via the PlayerView constructor in
    // pass 1 below.
    if (gu.playerNameViewData !== undefined) {
      for (const id in gu.playerNameViewData) {
        const pv = this._players.get(id);
        if (pv !== undefined && pv.state.isAlive) {
          pv.nameData = gu.playerNameViewData[id];
        }
      }
      this._namesDirty = true;
    }

    // Pass 1: ensure every player exists with up-to-date PlayerState. We need
    // all smallIDs registered before pass 2 can translate embargo PlayerIDs.
    // PlayerUpdate is now partial: only `id` is guaranteed; everything else
    // is present only when its value changed since the last emission.
    gu.updates[GameUpdateType.Player].forEach((wirePlayer) => {
      let pu = wirePlayer;
      // First-emission (new player) — must have all static fields populated.
      // Subsequent emissions for an existing player carry only changed fields.
      const existing = this._players.get(pu.id);
      // Public-only pre-spawn self identity has no private/static client header.
      // Wait for the first full authenticated own update, rather than creating
      // a fake local player which cannot later be promoted by a partial diff.
      if (this._trustedNationalProjection && !existing &&
          pu.id === this.trustedPrincipal && pu.clientID !== this._myClientID) return;
      if (
        this._trustedNationalProjection &&
        pu.id !== this.trustedPrincipal &&
        pu.clientID !== this._myClientID
      ) {
        // E3 deliberately strips private enemy fields. The legacy constructor
        // requires arrays and numeric slots; these are inert renderer defaults,
        // not intelligence about the other player's resources or relationships.
        if (!existing) {
          if (
            pu.smallID === undefined ||
            pu.name === undefined ||
            pu.playerType === undefined
          )
            return;
          const publicView: PlayerUpdate = {
            clientID: null,
            clanTag: null,
            displayName: pu.name,
            isDisconnected: false,
            tilesOwned: 0,
            gold: 0n,
            troops: 0,
            allies: [],
            targets: [],
            outgoingAllianceRequests: [],
            alliances: [],
            outgoingEmojis: [],
            outgoingAttacks: [],
            incomingAttacks: [],
            isTraitor: false,
            betrayals: 0,
            lastDeleteUnitTick: 0,
            isLobbyCreator: false,
            isAlive: false,
            ...pu,
            hasSpawned: (pu.tilesOwned ?? 0) > 0,
          };
          pu = publicView;
        } else if (pu.tilesOwned !== undefined) {
          pu = { ...pu, hasSpawned: pu.tilesOwned > 0 };
        }
      }

      // Replace the local player's name/displayName with their own stored values.
      // This way the user does not know they are being censored. clientID is
      // static — present only on first emission — so this branch only runs once.
      if (pu.clientID !== undefined && pu.clientID === this._myClientID) {
        pu.name = this._myUsername;
        pu.displayName = myDisplayName;
        pu.clanTag = this._myClanTag;
      }

      if (pu.smallID !== undefined) {
        this.smallIDToID.set(pu.smallID, pu.id);
      }

      // Derived-data dirty tracking: field presence on a partial update
      // means the field changed this tick.
      if (pu.allies !== undefined) {
        this._relationsDirty = true;
        this._clustersDirty = true;
      }
      if (pu.embargoes !== undefined) {
        this._relationsDirty = true;
      }

      if (existing !== undefined) {
        existing.applyUpdate(pu);
        const nextNameData = gu.playerNameViewData?.[pu.id];
        if (nextNameData !== undefined) {
          existing.nameData = nextNameData;
        }
      } else {
        const player = new PlayerView(
          this,
          pu,
          gu.playerNameViewData?.[pu.id],
          // Humans get cosmetics by clientID. Nations carry their flag
          // directly on the update (see PlayerUpdate.nationFlag) rather than
          // being looked up by name — some maps define multiple nations with
          // the same display name (e.g. India's and Pakistan's "Punjab").
          this._cosmetics.get(pu.clientID ?? "") ??
            (pu.playerType === PlayerType.Nation && pu.nationFlag
              ? ({
                  flag: `/flags/${pu.nationFlag}.svg`,
                } satisfies PlayerCosmetics)
              : undefined) ??
            {},
        );
        this._players.set(pu.id, player);
        this._playerStates.set(pu.smallID!, player.state);
        const team = player.team();
        if (team !== null) {
          this._teams.set(pu.smallID!, team);
        }
        this._namesDirty = true;
        this._relationsDirty = true;
        this._clustersDirty = true;
        this._teamClanTags = null;
      }
    });

    // Pass 2: translate engine embargoes (Set<PlayerID>) → renderer-format
    // smallIDs. Only re-translate when embargoes changed (field present);
    // unchanged sets stay at the previously-computed renderer-format list.
    gu.updates[GameUpdateType.Player].forEach((pu) => {
      if (pu.embargoes === undefined) return;
      const player = this._players.get(pu.id);
      if (player === undefined) return;
      // The JSON wire cannot encode a Set without an explicit representation.
      // Never interpret the empty serialized object as a private relationship.
      if (
        this._trustedNationalProjection &&
        !(Symbol.iterator in Object(pu.embargoes))
      )
        return;
      const smallIDs = embargoSmallIDs(pu.embargoes, (id) =>
        this._players.get(id)?.smallID(),
      );
      player.setEmbargoSmallIDs(smallIDs);
    });

    // Packed per-player stats and attack troop counts, the per-tick churn
    // that no longer travels in PlayerUpdate objects. Applied after pass 1
    // so first-emission players exist; their stats carry the same values
    // as the full update, so applying both is harmless.
    const stateOf = (smallID: number) => this._playerStates.get(smallID);
    applyPackedPlayerStats(gu.packedPlayerUpdates, stateOf);
    applyPackedAttackTroops(gu.packedAttackUpdates, stateOf);

    if (this._myClientID) {
      this._myPlayer ??= this.playerByClientID(this._myClientID);
    }

    for (const unit of this._units.values()) {
      unit._wasUpdated = false;
      // Only trim when a move appended a position — slicing a ≤1-element
      // array would allocate an identical array per unit per tick, and most
      // units (structures) never move.
      if (unit.lastPos.length > 1) {
        unit.lastPos = unit.lastPos.slice(-1);
      }
    }
    const unitUpdates = gu.packedUnitUpdates
      ? unpackUnitUpdates(gu.packedUnitUpdates, gu.packedMissileTimers)
      : (gu.updates[GameUpdateType.Unit] ?? []);
    if (gu.packedUnitUpdates) {
      gu.updates[GameUpdateType.Unit] = unitUpdates;
    }

    unitUpdates.forEach((update) => {
      let unit = this._units.get(update.id);
      const isStructure = STRUCTURE_TYPES.has(update.unitType);
      if (unit !== undefined) {
        // Structure changes that affect rendering: owner changed (captured),
        // level changed, became inactive, or finished construction
        // (underConstruction → !underConstruction).
        if (
          isStructure &&
          (unit.state.ownerID !== update.ownerID ||
            unit.state.level !== update.level ||
            unit.state.isActive !== update.isActive ||
            (unit.state.underConstruction &&
              !(update.underConstruction ?? false)))
        ) {
          this._structuresDirty = true;
        }
        const hasMotionPlan = this.motion.hasGridPlan(update.id);
        const oldPos = unit.state.pos;
        const oldLastPos = unit.state.lastPos;
        unit.update(update);
        if (hasMotionPlan) {
          unit.state.pos = oldPos;
          unit.state.lastPos = oldLastPos;
          unit.lastPos.pop();
        }
      } else {
        unit = new UnitView(this, update);
        this._units.set(update.id, unit);
        this._unitStates.set(update.id, unit.state);
        this.unitGrid.addUnit(unit);
        if (isStructure) this._structuresDirty = true;
      }
      if (!update.isActive) {
        this.unitGrid.removeUnit(unit);
      } else if (unit.tile() !== unit.lastTile()) {
        this.unitGrid.updateUnitCell(unit);
      }
      if (!unit.isActive()) {
        // Wait until next tick to delete the unit.
        this.toDelete.add(unit.id());
        this.motion.unitRemoved(unit.id());
      }
    });

    this.motion.advance(gu.tick, this.plannedUnits);

    this.populateFrame(gu);
  }

  // ── FrameData population ────────────────────────────────────────────────

  /**
   * Populate the long-lived FrameData from this tick's updates and current
   * state. Runs at the end of update() once all engine-driven mutations are
   * complete. Mutates _frame fields in place; never reassigns them.
   */
  private populateFrame(gu: GameUpdateViewData): void {
    // Reset trail dirty markers for this tick. The trailManager.update() pass
    // below repaints rows and re-sets these as it goes.
    this.trailManager.clearDirtyRows();

    // Railroad events accumulate into the cache; revealedRailTiles is cleared
    // at the start of apply().
    this.railroadCache.apply(gu);

    // Trail update: walk active trail-type units and stamp/decay.
    this._trailIdsScratch.length = 0;
    for (const u of this._units.values()) {
      if (!this._trustedNationalProjection && u.isActive() && TRAIL_TYPES.has(u.type())) {
        this._trailIdsScratch.push(u.id());
      }
    }
    this.trailManager.update(
      this._unitStates as Map<number, import("../render/types").UnitState>,
      this._trailIdsScratch,
    );
    // Spiral nukeTrail ribbons follow the same tracked units; extends the
    // path of each live spiral-cosmetic nuke and drops dead ones.
    this.spiralTrails.update(
      this._unitStates as Map<number, import("../render/types").UnitState>,
      this._trailIdsScratch,
    );

    // Trusted E3 page visibility may change every tick without nameData
    // changing. Re-evaluate each placement against current *sighted* tiles.
    // Ordinary FFA keeps its existing change-driven fast path.
    if (this._trustedNationalProjection) this._namesDirty = true;
    // Names map — rebuilt only when a placement record arrived or a player
    // was added (nameData values cannot change between those ticks). Entry
    // order is irrelevant for the renderer.
    if (this._namesDirty) {
      this._namesDirty = false;
      this._names.clear();
      for (const p of this._players.values()) {
        if (!this.trustedNameVisible(p)) continue;
        this._names.set(p.id(), {
          playerID: p.id(),
          x: p.nameData?.x ?? 0,
          y: p.nameData?.y ?? 0,
          size: p.nameData?.size ?? 0,
        });
      }
    }

    // FrameEvents — clear arrays, then re-populate from this tick's updates.
    this.buildFrameEvents(gu);

    // Update FrameData fields. Derived data is computed once per tick and
    // stored directly on _frame (no intermediate copy). The renderer's
    // `readonly` modifier on FrameData is just an external API hint —
    // not enforced at runtime; we cast off to assign here.
    const f = this._frame as {
      -readonly [K in keyof FrameData]: FrameData[K];
    };
    const inSpawnPhase = this.startTick === null;
    f.namesSnap = this._wasInSpawnPhase && !inSpawnPhase;
    this._wasInSpawnPhase = inSpawnPhase;
    f.tick = gu.tick;
    f.inSpawnPhase = inSpawnPhase;
    f.railroadDirty = this.railroadCache.railroadDirty;
    f.trailDirtyRowMin = this.trailManager.dirtyRowMin;
    f.trailDirtyRowMax = this.trailManager.dirtyRowMax;
    // References TrailManager's live array; must be read before the next tick clears it.
    f.changedTrailTiles = this.trailManager.changedTiles;

    f.playerStatus = computePlayerStatus(this._playerStates, this._unitStates, {
      localPlayerSmallID: this._myPlayer?.smallID() ?? 0,
      localPlayerID: this._myPlayer?.id() ?? "",
      tileState: this._map.tileStateBuffer(),
      tick: gu.tick,
      allianceDuration: this._config.allianceDuration(),
      isTransitiveTarget: (sid) =>
        (this._markedPlayers?.has(sid) ?? false) ||
        (this._myPlayer?.hasTransitiveTarget(sid) ?? false),
      doomsdayClockWarnTicks:
        this._config.doomsdayClockConfig().warnSeconds * 10,
    });
    // Relations + clusters depend only on allies/embargoes/teams, which
    // change rarely (teams only when a player is added) — recompute only
    // when one of those inputs arrived this tick. buildRelationMatrix
    // writes into a reusable module-level buffer, so skipping the call
    // leaves f.relationMatrix's contents intact. f.relationsDirty lets the
    // upload layer skip the GPU push (and the full-map border recompute it
    // triggers) on unchanged ticks.
    if (this._relationsDirty) {
      this._relationsDirty = false;
      const rel = buildRelationMatrix(this._playerStates, this._teams);
      f.relationMatrix = rel.matrix;
      f.relationSize = rel.size;
      f.relationsDirty = true;
    } else {
      f.relationsDirty = false;
    }
    if (this._clustersDirty) {
      this._clustersDirty = false;
      f.allianceClusters = computeAllianceClusters(this._playerStates);
    }
    f.nukeTelegraphs = extractNukeTelegraphs(
      this._unitStates,
      this._map.width(),
      this._myPlayer?.smallID() ?? 0,
      // The latest relation matrix — recomputed above when dirty, otherwise
      // carried over on the frame from the last rebuild.
      f.relationMatrix,
      f.relationSize,
      this.motion.gridPlans(),
      gu.tick,
    );
    f.attackRings = this._myPlayer
      ? extractAttackRings(
          this._unitStates,
          this._map.width(),
          this._myPlayer.smallID(),
        )
      : [];
    f.structuresDirty = this._structuresDirty;

    // First populate: signal "full upload required" by nulling changedTiles.
    // uploadFrameData() treats null as "no delta info; do a full tile+trail
    // upload" — needed because the renderer's GPU buffers are empty.
    if (this._firstPopulate) {
      f.changedTiles = null;
      f.structuresDirty = true; // force initial structure upload
      this._firstPopulate = false;
    } else {
      // Live reference to this tick's changed refs — consumers copy what
      // they keep (TerritoryPass buckets them synchronously in the upload).
      f.changedTiles = this.updatedTiles;
    }

    // Reset transient flags for next tick.
    this.railroadCache.clearDirty();
    this._structuresDirty = false;
  }

  /** Clear and repopulate _frame.events arrays from this tick's gu.updates. */
  private buildFrameEvents(gu: GameUpdateViewData): void {
    const ev = this._frame.events;
    ev.deadUnits.length = 0;
    ev.conquestEvents.length = 0;
    ev.bonusEvents.length = 0;

    if (gu.packedUnitUpdates) {
      // Re-unpacking is fine, it's just object creation for dead units, which is fast,
      // or we just decode the fields we need directly without creating objects!
      for (
        let offset = 0;
        offset < gu.packedUnitUpdates.length;
        offset += UNIT_UPDATE_STRIDE
      ) {
        const decoder = new PackedUnitUpdateDecoder(
          gu.packedUnitUpdates,
          offset,
        );
        if (!decoder.isActive) {
          ev.deadUnits.push({
            unitType: decoder.unitType,
            pos: decoder.pos,
            reachedTarget: decoder.reachedTarget,
            ownerSmallID: decoder.ownerID,
          });
        }
      }
    } else {
      const unitUpdates =
        (gu.updates[GameUpdateType.Unit] as UnitUpdate[]) ?? [];
      for (const u of unitUpdates) {
        if (u.isActive) continue;
        ev.deadUnits.push({
          unitType: u.unitType,
          pos: u.pos,
          reachedTarget: u.reachedTarget,
          ownerSmallID: u.ownerID,
        });
      }
    }
    const myID = this._myPlayer?.id();
    for (const c of gu.updates[GameUpdateType.ConquestEvent] ?? []) {
      if (c.conquerorId !== myID) continue;
      const conquered = this._players.get(c.conqueredId);
      if (conquered === undefined) continue;
      const loc = conquered.nameLocation();
      if (loc === undefined) continue;
      ev.conquestEvents.push({
        x: loc.x,
        y: loc.y,
        gold: Number(c.gold),
      });
    }
    for (const b of gu.updates[GameUpdateType.BonusEvent] ?? []) {
      const player = this._players.get(b.player);
      if (player === undefined) continue;
      ev.bonusEvents.push({
        playerID: b.player,
        smallID: player.smallID(),
        tile: b.tile,
        gold: Number(b.gold),
        troops: b.troops,
      });
    }
  }

  /** Public accessor: the renderer reads this and uploads to the GPU. */
  frameData(): FrameData {
    return this._frame;
  }

  /**
   * Set a player's spiral nuke-trail geometry (from their nukeTrail
   * cosmetic). Pushed by WebGLFrameBuilder once the player's effect
   * resolves; their nukes then grow helix ribbons (SpiralTrails →
   * SpiralRibbonPass) on top of the plain stamped trail.
   */
  setNukeTrailSpiral(smallID: number, params: SpiralParams): void {
    this.spiralTrails.setParams(smallID, params);
  }

  clearNukeTrailSpiral(smallID: number): void {
    this.spiralTrails.clearParams(smallID);
  }

  recentlyUpdatedTiles(): TileRef[] {
    return this.updatedTiles;
  }

  recentlyUpdatedTerrainTiles(): TileRef[] {
    return this.updatedTerrainTiles;
  }
  recentlyNukedTiles(): TileRef[] {
    return this.nukeImpactTiles;
  }

  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
  ): Array<{ unit: UnitView; distSquared: number }> {
    return this.unitGrid.nearbyUnits(
      tile,
      searchRange,
      types,
      predicate,
    ) as Array<{
      unit: UnitView;
      distSquared: number;
    }>;
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
    predicate: (unit: UnitView) => boolean,
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

  myClientID(): ClientID | undefined {
    return this._myClientID;
  }

  myPlayer(): PlayerView | null {
    return this._myPlayer;
  }

  player(id: PlayerID): PlayerView {
    const player = this._players.get(id);
    if (player === undefined) {
      throw Error(`player id ${id} not found`);
    }
    return player;
  }

  players(): PlayerView[] {
    return Array.from(this._players.values());
  }

  teamClanTag(team: Team | null): string | null {
    if (!team) return null;
    if (this._teamClanTags === null) {
      if (this._players.size === 0) return null;
      this._teamClanTags = this.initTeamClanTags();
    }
    return this._teamClanTags.get(team) ?? null;
  }

  invalidateTeamClanTags(): void {
    this._teamClanTags = null;
  }

  private initTeamClanTags(): Map<Team, string | null> {
    const teams = new Map<Team, PlayerView[]>();
    for (const player of this._players.values()) {
      const t = player.team();
      if (t) {
        let list = teams.get(t);
        if (!list) {
          list = [];
          teams.set(t, list);
        }
        list.push(player);
      }
    }
    const result = new Map<Team, string | null>();
    for (const [t, players] of teams.entries()) {
      result.set(t, resolveTeamClanTag(players));
    }
    return result;
  }

  /**
   * Recompute every player's theme-derived colors. Call when the active theme
   * changes mid-game (e.g. toggling colorblind mode) so existing territories
   * re-color; the renderer palette must be refreshed afterwards.
   */
  refreshPlayerColors(): void {
    for (const p of this._players.values()) {
      p.refreshColors();
    }
  }

  cosmeticVisibility(): CosmeticVisibility {
    return this._cosmeticVisibility;
  }

  /**
   * Re-read the cosmetics visibility settings and re-resolve every player's
   * drawn cosmetics and colors; the renderer must be refreshed afterwards.
   */
  refreshPlayerCosmetics(): void {
    this._cosmeticVisibility = readCosmeticVisibility();
    for (const p of this._players.values()) {
      p.refreshCosmetics();
    }
  }

  playerBySmallID(id: number): PlayerView | TerraNullius {
    if (id === 0) {
      return new TerraNulliusImpl();
    }
    const playerId = this.smallIDToID.get(id);
    if (playerId === undefined) {
      throw new Error(`small id ${id} not found`);
    }
    return this.player(playerId);
  }

  playerByClientID(id: ClientID): PlayerView | null {
    const player =
      Array.from(this._players.values()).filter(
        (p) => p.clientID() === id,
      )[0] ?? null;
    if (player === null) {
      return null;
    }
    return player;
  }
  hasPlayer(id: PlayerID): boolean {
    return false;
  }
  playerViews(): PlayerView[] {
    return Array.from(this._players.values());
  }

  owner(tile: TileRef): PlayerView | TerraNullius {
    return this.playerBySmallID(this.ownerID(tile));
  }

  ticks(): Tick {
    if (this.lastUpdate === null) return 0;
    return this.lastUpdate.tick;
  }
  // Set once the sim has decided the game (WinUpdate). Play may go on for
  // those who stay, but the server archives the record at that point.
  private _gameOver = false;
  gameOver(): boolean {
    return this._gameOver;
  }

  inSpawnPhase(): boolean {
    return this.startTick === null;
  }

  isSpawnImmunityActive(): boolean {
    return (
      this.inSpawnPhase() ||
      this.ticksSinceStart() < this._config.spawnImmunityDuration()
    );
  }
  isNationSpawnImmunityActive(): boolean {
    return (
      this.inSpawnPhase() ||
      this.ticksSinceStart() < this._config.nationSpawnImmunityDuration()
    );
  }

  elapsedGameSeconds(): number {
    return this.ticksSinceStart() / 10;
  }

  ticksSinceStart(): Tick {
    if (this.inSpawnPhase()) {
      return 0;
    }

    return Math.max(0, this.ticks() - this.startTick!);
  }
  config(): Config {
    return this._config;
  }
  isSpectator(): boolean {
    return (
      (this._trustedNationalProjection && !this._trustedProjectionReady && !this.trustedSpawnReady()) ||
      !this.myPlayer()?.isAlive() ||
      this._config.isReplay()
    );
  }
  units(...types: UnitType[]): UnitView[] {
    if (types.length === 0) {
      return Array.from(this._units.values()).filter((u) => u.isActive());
    }
    return Array.from(this._units.values()).filter(
      (u) => u.isActive() && types.includes(u.type()),
    );
  }

  /**
   * Active units owned by the given player (smallID). The grouping is built
   * lazily at most once per tick; the returned array must not be mutated.
   */
  unitsOwnedBy(ownerSmallID: number): readonly UnitView[] {
    if (this._unitsByOwnerStale) {
      this._unitsByOwnerStale = false;
      this._unitsByOwner.clear();
      for (const u of this._units.values()) {
        if (!u.isActive()) continue;
        const sid = u.state.ownerID;
        const arr = this._unitsByOwner.get(sid);
        if (arr === undefined) {
          this._unitsByOwner.set(sid, [u]);
        } else {
          arr.push(u);
        }
      }
    }
    return this._unitsByOwner.get(ownerSmallID) ?? [];
  }
  unit(id: number): UnitView | undefined {
    return this._units.get(id);
  }
  unitInfo(type: UnitType): UnitInfo {
    return this._config.unitInfo(type);
  }

  /**
   * Long-lived map of UnitState records, keyed by unit ID. Mutated in place
   * each tick by `update()`. Renderer code reads from this directly — the
   * UnitView wrapping each entry shares the same UnitState reference.
   *
   * Includes inactive units; renderer filters by `state.isActive`.
   */
  unitStates(): ReadonlyMap<number, import("../render/types").UnitState> {
    return this._unitStates;
  }

  /**
   * Long-lived map of PlayerState records, keyed by smallID. Mutated in place
   * each tick by `update()`. Renderer code reads from this directly.
   */
  playerStates(): ReadonlyMap<number, import("../render/types").PlayerState> {
    return this._playerStates;
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
  /** Map layers defined in the map's info.json, if any. */
  layers(): import("@openfront/engine-api/game/MapFiles").MapLayer[] {
    return this._mapData.layers ?? [];
  }
  /** Nations the map's manifest defines, whether or not they spawned. */
  mapNationCount(): number {
    return this._mapData.nations.length;
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
  setWater(ref: TileRef): void {
    this._map.setWater(ref);
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
    return this._map.setOwnerID(ref, playerId);
  }
  hasFallout(ref: TileRef): boolean {
    return this._map.hasFallout(ref);
  }
  setFallout(ref: TileRef, value: boolean): void {
    return this._map.setFallout(ref, value);
  }
  isBorder(ref: TileRef): boolean {
    return this._map.isBorder(ref);
  }
  neighbors(ref: TileRef): TileRef[] {
    return this._map.neighbors(ref);
  }
  forEachNeighbor(ref: TileRef, callback: (neighbor: TileRef) => void): void {
    this._map.forEachNeighbor(ref, callback);
  }
  neighbors4(ref: TileRef, out: TileRef[]): number {
    return this._map.neighbors4(ref, out);
  }
  neighbors8(ref: TileRef, out: TileRef[]): number {
    return this._map.neighbors8(ref, out);
  }
  forEachNeighborWithDiag(
    ref: TileRef,
    callback: (neighbor: TileRef) => void,
  ): void {
    this._map.forEachNeighborWithDiag(ref, callback);
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
  gameID(): GameID {
    return this._gameID;
  }

  // Started from a saved game rather than from the beginning. Such a game is
  // never archived, so it earns no XP or achievements.
  resumedFromSave(): boolean {
    return this._resumedFromSave;
  }

  private _markedPlayers: ReadonlySet<number> | null = null;

  focusedPlayer(): PlayerView | null {
    return this.myPlayer();
  }

  /**
   * Extra smallIDs drawn with the target crosshair by the name pass, on top
   * of the player's real transitive targets (e.g. the tutorial pointing at
   * capturable tribes). Null when nothing is requested.
   */
  setMarkedPlayers(ids: ReadonlySet<number> | null): void {
    this._markedPlayers = ids;
  }

  markedPlayers(): ReadonlySet<number> | null {
    return this._markedPlayers;
  }

  private _ownSpawnRing = false;

  /**
   * Keep the local player's spawn-phase ring drawn after the phase ends
   * (the tutorial uses it to show a new player where their territory is).
   */
  setOwnSpawnRing(show: boolean): void {
    this._ownSpawnRing = show;
  }

  ownSpawnRing(): boolean {
    return this._ownSpawnRing;
  }
}
