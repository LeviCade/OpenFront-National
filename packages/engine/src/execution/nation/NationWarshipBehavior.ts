import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllPlayers,
  Difficulty,
  Gold,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  readVersioned,
  snapshotType,
  Versioned,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { assertNever } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Game, Player, Unit } from "../../game/Game";
import { planObservedNationalNavalTargets } from "../../national/ai/NationalNavalStrategy";
import { planObservedNationalNavalEscorts } from "../../national/ai/NationalNavalEscortStrategy";
import type { NationalObservation } from "../../national/observation/NationalObservation";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { ConstructionExecution } from "../ConstructionExecution";
import { MoveWarshipExecution } from "../MoveWarshipExecution";
import {
  EMOJI_WARSHIP_RETALIATION,
  NationEmojiBehavior,
} from "./NationEmojiBehavior";

export class NationWarshipBehavior {
  // Track our transport ships we currently own
  private trackedTransportShips: Set<Unit> = new Set();
  // Track our trade ships we currently own
  private trackedTradeShips: Set<Unit> = new Set();
  // Track incoming transport ships
  private trackedIncomingTransportShips: Set<Unit> = new Set();
  // Track incoming transport ships we have dealt with
  private dealtWithTransportShip: Set<Unit> = new Set();

  // NATIONAL-only, principal-local mission memory. No foreign unit references
  // or historical unseen positions are retained; legacy FFA omits this field.
  private nationalNavalMission: {
    readonly vesselId: string;
    readonly targetOwnerId: string;
    readonly dispatchedAtTick: number;
  } | null = null;

  // Separate from inherited offensive missions: defensive orders must not
  // disappear after an enemy merchant briefly enters or exits sight.
  private nationalNavalEscortMission: {
    readonly merchantId: string;
    readonly raiderId: string;
    readonly raiderOwnerId: string;
    readonly dispatchedAtTick: number;
  } | null = null;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private emojiBehavior: NationEmojiBehavior,
  ) {}

  snapshot(w: SnapshotWriter): Versioned {
    // Sets are iterated in order and may hold dead units.
    const units = (set: Set<Unit>) => [...set].map((u) => w.unit(u));
    return w.versioned(NationWarshipBehaviorSnapshot, {
      trackedTransportShips: units(this.trackedTransportShips),
      trackedTradeShips: units(this.trackedTradeShips),
      trackedIncomingTransportShips: units(this.trackedIncomingTransportShips),
      dealtWithTransportShip: units(this.dealtWithTransportShip),
      ...(this.nationalNavalMission === null
        ? {}
        : { nationalNavalMission: { ...this.nationalNavalMission } }),
      ...(this.nationalNavalEscortMission === null
        ? {}
        : { nationalNavalEscortMission: { ...this.nationalNavalEscortMission } }),
    });
  }

  /** Fills a prototype-only shell; only assigns (see README). */
  restoreSnapshot(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
    emojiBehavior: NationEmojiBehavior,
  ): void {
    const s = readVersioned(NationWarshipBehaviorSnapshot, raw);
    const units = (refs: number[]) => new Set(refs.map((i) => r.unit(i)));
    this.random = random;
    this.game = r.game;
    this.player = player;
    this.emojiBehavior = emojiBehavior;
    this.trackedTransportShips = units(s.trackedTransportShips);
    this.trackedTradeShips = units(s.trackedTradeShips);
    this.trackedIncomingTransportShips = units(s.trackedIncomingTransportShips);
    this.dealtWithTransportShip = units(s.dealtWithTransportShip);
    this.nationalNavalMission = s.nationalNavalMission ?? null;
    this.nationalNavalEscortMission = s.nationalNavalEscortMission ?? null;
  }

  /**
   * An ACTUAL NATIONAL naval mission, not generic random FFA construction.
   * This takes an already principal-filtered, current-tick observation and
   * issues real original-engine MoveWarship / Construction executions.
   *
   * No Game.units foreign scan, no targetUnit lookup, no magical sight:
   * only currently observed enemy trade-ship coordinates are considered.
   * The original Game resolves purchase, movement, combat and payouts.
   */
  dispatchNationalNavalPressure(
    observation: NationalObservation,
  ): "move" | "build" | null {
    if (
      !this.game.config().nationalMode() ||
      this.game.config().isUnitDisabled(UnitType.Warship) ||
      observation.observerId !== this.player.id() ||
      observation.tick !== this.game.ticks() ||
      !this.player.isAlive() ||
      !this.player.hasSpawned()
    )
      return null;

    // An ongoing defensive duty wins over fresh offensive piracy. The
    // offensive planner gets another chance after the escort cooldown.
    if (
      this.nationalNavalEscortMission !== null &&
      observation.tick - this.nationalNavalEscortMission.dispatchedAtTick < 80
    )
      return null;
    const war = this.game.nationalWarAuthority();
    // The only eligible authority is an ACTUAL currently live WAR ledger.
    if (war === null) return null;
    const ports = this.player
      .units(UnitType.Port)
      .filter(
        (port) =>
          port.isActive() &&
          !port.isMarkedForDeletion() &&
          !port.isUnderConstruction(),
      );
    if (ports.length === 0) return null;
    const targets = planObservedNationalNavalTargets(
      observation,
      ports.map((port) => ({
        x: this.game.x(port.tile()),
        y: this.game.y(port.tile()),
      })),
    );
    if (targets.length === 0) {
      // Sight loss or peace stops NEW orders, but does not erase the cooldown:
      // otherwise a route briefly hidden and reacquired would fund an
      // immediate duplicate ship. In-flight ships retain engine behavior.
      return null;
    }
    if (
      this.nationalNavalMission !== null &&
      observation.tick - this.nationalNavalMission.dispatchedAtTick < 100
    )
      return null;

    for (const target of targets) {
      // Recheck after observation; a public WAR record cannot override the
      // current sovereign/imperial authority or an allied exemption.
      if (
        !war.authorizeOffensiveAction(this.player.id(), target.ownerId) ||
        !this.game.hasPlayer(target.ownerId) ||
        this.player.isFriendly(this.game.player(target.ownerId)) ||
        !this.game.isValidCoord(target.x, target.y)
      )
        continue;
      const tile = this.game.ref(target.x, target.y);
      if (!this.game.isWater(tile)) continue;
      const component = this.game.getWaterComponent(tile);
      if (component === null) continue;
      if (
        !ports.some((port) =>
          this.game.hasWaterComponent(port.tile(), component),
        )
      )
        continue;

      const warships = this.player
        .units(UnitType.Warship)
        .filter(
          (ship) =>
            ship.isActive() &&
            !ship.isMarkedForDeletion() &&
            !ship.isUnderConstruction() &&
            ship.health() > 0 &&
            ship.warshipState().state === "patrolling" &&
            this.game.getWaterComponent(ship.tile()) === component,
        )
        .sort(
          (a, b) =>
            this.game.manhattanDist(a.tile(), tile) -
              this.game.manhattanDist(b.tile(), tile) || a.id() - b.id(),
        );
      const closest = warships[0];
      if (closest !== undefined) {
        // Existing patrol coverage is inherited NAV-01/02, not new strategy.
        const patrol = closest.warshipState().patrolTile;
        if (
          patrol !== undefined &&
          this.game.euclideanDistSquared(patrol, tile) <=
            (this.game.config().warshipPatrolRange() / 2) ** 2
        )
          continue;
        this.game.addExecution(
          new MoveWarshipExecution(this.player, [closest.id()], tile),
        );
        this.nationalNavalMission = {
          vesselId: target.vesselId,
          targetOwnerId: target.ownerId,
          dispatchedAtTick: observation.tick,
        };
        return "move";
      }
      // A ship in another disconnected ocean cannot be retasked. A new one
      // must be genuinely affordable and physically built at OUR own port.
      if (
        this.player.units(UnitType.Warship).length >= 10 ||
        this.spareGold() < this.cost(UnitType.Warship) ||
        this.player.canBuild(UnitType.Warship, tile) === false
      )
        continue;
      this.game.addExecution(
        new ConstructionExecution(this.player, UnitType.Warship, tile),
      );
      this.nationalNavalMission = {
        vesselId: target.vesselId,
        targetOwnerId: target.ownerId,
        dispatchedAtTick: observation.tick,
      };
      return "build";
    }
    return null;
  }

  /**
   * Sixth-original defensive escort, deliberately distinct from inherited
   * offensive merchant interception. The input is the SAME current-tick,
   * recipient-visible observation given to human clients; no hidden ship
   * lookup or inferred enemy route is allowed.
   *
   * Existing WAR/combat executions, not this AI planner, cause combat,
   * captures and commercial payouts. A proposed purchase is a real original
   * ConstructionExecution charged by WarshipExecution at an owned port.
   */
  dispatchNationalNavalEscort(
    observation: NationalObservation,
  ): "move" | "build" | "cover" | null {
    if (
      !this.game.config().nationalMode() ||
      this.game.config().isUnitDisabled(UnitType.Warship) ||
      observation.observerId !== this.player.id() ||
      observation.tick !== this.game.ticks() ||
      !this.player.isAlive() ||
      !this.player.hasSpawned()
    )
      return null;
    const war = this.game.nationalWarAuthority();
    if (war === null) return null;
    if (
      this.nationalNavalEscortMission !== null &&
      observation.tick - this.nationalNavalEscortMission.dispatchedAtTick < 80
    )
      return null;

    const targets = planObservedNationalNavalEscorts(observation);
    for (const target of targets) {
      if (
        !this.game.hasPlayer(target.merchantOwnerId) ||
        !this.game.hasPlayer(target.raiderOwnerId)
      )
        continue;
      const merchant = this.game.player(target.merchantOwnerId);
      const raider = this.game.player(target.raiderOwnerId);
      if (
        !merchant.isAlive() ||
        !merchant.hasSpawned() ||
        !raider.isAlive() ||
        !raider.hasSpawned() ||
        (merchant !== this.player && !this.player.isFriendly(merchant)) ||
        this.player.isFriendly(raider) ||
        !war.authorizeOffensiveAction(this.player.id(), raider.id()) ||
        !war.authorizeOffensiveAction(raider.id(), merchant.id()) ||
        !this.game.isValidCoord(target.x, target.y)
      )
        continue;
      // Do not substitute a guessed or stale merchant. Own units are the
      // only first-party units examined by this dispatcher.
      if (
        merchant === this.player &&
        !this.player.units(UnitType.TradeShip).some(
          (ship) =>
            ship.isActive() &&
            !ship.isMarkedForDeletion() &&
            String(ship.id()) === target.merchantId &&
            ship.targetUnit()?.type() === UnitType.Port &&
            ship.targetUnit()?.isActive() === true &&
            ship.targetUnit()?.isMarkedForDeletion() === false &&
            ship.targetUnit()?.owner() !== this.player &&
            this.player.canTrade(ship.targetUnit()!.owner()) &&
            this.game.x(ship.tile()) === target.merchantX &&
            this.game.y(ship.tile()) === target.merchantY,
        )
      )
        continue;

      if (!this.game.isValidCoord(target.merchantX, target.merchantY))
        continue;
      const tile = this.game.ref(target.x, target.y);
      const merchantTile = this.game.ref(target.merchantX, target.merchantY);
      if (!this.game.isWater(tile) || !this.game.isWater(merchantTile))
        continue;
      const component = this.game.getWaterComponent(tile);
      if (
        component === null ||
        this.game.getWaterComponent(merchantTile) !== component
      )
        continue;

      const warships = this.player
        .units(UnitType.Warship)
        .filter(
          (ship) =>
            ship.isActive() &&
            !ship.isMarkedForDeletion() &&
            !ship.isUnderConstruction() &&
            ship.health() > 0 &&
            ship.warshipState().state === "patrolling" &&
            this.game.getWaterComponent(ship.tile()) === component,
        )
        .sort(
          (a, b) =>
            this.game.manhattanDist(a.tile(), tile) -
              this.game.manhattanDist(b.tile(), tile) || a.id() - b.id(),
        );
      const closest = warships[0];
      if (closest !== undefined) {
        const patrol = closest.warshipState().patrolTile;
        if (
          patrol === undefined ||
          this.game.euclideanDistSquared(patrol, tile) > 4
        ) {
          this.game.addExecution(
            new MoveWarshipExecution(this.player, [closest.id()], tile),
          );
        }
        this.nationalNavalEscortMission = {
          merchantId: target.merchantId,
          raiderId: target.raiderId,
          raiderOwnerId: target.raiderOwnerId,
          dispatchedAtTick: observation.tick,
        };
        return patrol !== undefined &&
          this.game.euclideanDistSquared(patrol, tile) <= 4
          ? "cover"
          : "move";
      }

      const ports = this.player
        .units(UnitType.Port)
        .filter(
          (port) =>
            port.isActive() &&
            !port.isMarkedForDeletion() &&
            !port.isUnderConstruction() &&
            this.game.hasWaterComponent(port.tile(), component),
        );
      if (
        ports.length === 0 ||
        this.player.units(UnitType.Warship).length >= 10 ||
        this.spareGold() < this.cost(UnitType.Warship) ||
        this.player.canBuild(UnitType.Warship, tile) === false
      )
        continue;

      this.game.addExecution(
        new ConstructionExecution(this.player, UnitType.Warship, tile),
      );
      this.nationalNavalEscortMission = {
        merchantId: target.merchantId,
        raiderId: target.raiderId,
        raiderOwnerId: target.raiderOwnerId,
        dispatchedAtTick: observation.tick,
      };
      return "build";
    }
    return null;
  }

  maybeSpawnWarship(): boolean {
    if (this.player === null) throw new Error("not initialized");
    if (this.game.config().isUnitDisabled(UnitType.Warship)) {
      return false;
    }
    if (!this.random.chance(50)) {
      return false;
    }
    const ports = this.player.units(UnitType.Port);
    const ships = this.player.units(UnitType.Warship);
    if (
      ports.length > 0 &&
      ships.length === 0 &&
      this.spareGold() > this.cost(UnitType.Warship)
    ) {
      const port = this.random.randElement(ports);
      const targetTile = this.warshipSpawnTile(port.tile(), 250);
      if (targetTile === null) {
        return false;
      }
      const canBuild = this.player.canBuild(UnitType.Warship, targetTile);
      if (canBuild === false) {
        return false;
      }
      this.game.addExecution(
        new ConstructionExecution(this.player, UnitType.Warship, targetTile),
      );
      return true;
    }
    return false;
  }

  private warshipSpawnTile(portTile: TileRef, radius: number): TileRef | null {
    for (let attempts = 0; attempts < 50; attempts++) {
      const randX = this.random.nextInt(
        this.game.x(portTile) - radius,
        this.game.x(portTile) + radius,
      );
      const randY = this.random.nextInt(
        this.game.y(portTile) - radius,
        this.game.y(portTile) + radius,
      );
      if (!this.game.isValidCoord(randX, randY)) {
        continue;
      }
      const tile = this.game.ref(randX, randY);
      // Sanity check
      if (!this.game.isWater(tile)) {
        continue;
      }
      return tile;
    }
    return null;
  }

  trackShipsAndRetaliate(): void {
    this.trackTransportShipsAndRetaliate();
    this.trackTradeShipsAndRetaliate();
    this.trackIncomingTransportsAndRetaliate();
  }

  // Send out a warship if our transport ship got captured
  private trackTransportShipsAndRetaliate(): void {
    if (this.game.config().isUnitDisabled(UnitType.TransportShip)) {
      return;
    }
    // Add any currently owned transport ships to our tracking set
    this.player
      .units(UnitType.TransportShip)
      .forEach((u) => this.trackedTransportShips.add(u));

    // Iterate tracked transport ships; if it got destroyed by an enemy:
    // retaliate. Deleting the current entry while iterating a Set is safe.
    for (const ship of this.trackedTransportShips) {
      if (!ship.isActive()) {
        // Distinguish between arrival/retreat and enemy destruction
        if (ship.wasDestroyedByEnemy() && ship.destroyer() !== undefined) {
          this.maybeRetaliateWithWarship(
            ship.tile(),
            ship.destroyer()!,
            "transport",
          );
        }
        this.trackedTransportShips.delete(ship);
      }
    }
  }

  // Send out a warship if our trade ship got captured
  private trackTradeShipsAndRetaliate(): void {
    // Add any currently owned trade ships to our tracking map
    this.player
      .units(UnitType.TradeShip)
      .forEach((u) => this.trackedTradeShips.add(u));

    // Iterate tracked trade ships; if we no longer own it, it was captured:
    // retaliate. Deleting the current entry while iterating a Set is safe.
    for (const ship of this.trackedTradeShips) {
      if (!ship.isActive()) {
        this.trackedTradeShips.delete(ship);
        continue;
      }
      if (ship.owner().id() !== this.player.id()) {
        // Ship was ours and is now owned by someone else -> captured
        this.maybeRetaliateWithWarship(ship.tile(), ship.owner(), "trade");
        this.trackedTradeShips.delete(ship);
      }
    }
  }

  private trackIncomingTransportsAndRetaliate(): void {
    // Add any transports which are targeting us to our tracking map
    for (const p of this.game.units(UnitType.TransportShip)) {
      const target = p.targetTile();
      if (
        target &&
        p.isActive() &&
        !p.transportShipState().isRetreating &&
        this.game.ownerID(target) === this.player?.smallID() &&
        p.owner().smallID() !== this.player?.smallID()
      ) {
        this.trackedIncomingTransportShips.add(p);
      }
    }

    // Deleting the current entry while iterating a Set is safe.
    for (const transport of this.trackedIncomingTransportShips) {
      const target = transport.targetTile();
      if (
        !transport.isActive() ||
        target === undefined ||
        transport.transportShipState().isRetreating
      ) {
        this.trackedIncomingTransportShips.delete(transport);
        this.dealtWithTransportShip.delete(transport);
        continue;
      }
      // Transport has already been dealt with
      if (this.dealtWithTransportShip.has(transport)) {
        continue;
      }

      const distanceToTarget = this.game.manhattanDist(
        transport.tile(),
        target,
      );
      // Too close to deal with
      if (distanceToTarget < 20) {
        this.dealtWithTransportShip.add(transport);
        continue;
      }

      // Possible dock snipe counter? Too niche?
      if (!transport.owner().isAlliedWith(this.player)) {
        if (
          this.game.hasUnitNearby(
            target,
            90,
            UnitType.Warship,
            this.player.id(),
            true,
          ) ||
          this.player.units(UnitType.Warship).filter((p) => {
            const patrolTile = p.warshipState().patrolTile;
            return (
              patrolTile !== undefined &&
              this.game.manhattanDist(target, patrolTile) < 90
            );
          }).length > 0
        ) {
          this.dealtWithTransportShip.add(transport);
          continue;
        }
        const oceanTiles = this.warshipSpawnTile(target, 30);
        if (oceanTiles === null) continue;
        this.maybeRetaliateWithWarship(
          oceanTiles,
          transport.owner(),
          "invasion",
        );
        this.dealtWithTransportShip.add(transport);
        break;
      }
    }
  }

  private maybeRetaliateWithWarship(
    tile: TileRef,
    enemy: Player,
    reason: "trade" | "transport" | "invasion",
  ): void {
    // Don't retaliate against ourselves (e.g. own nuke destroyed own ship)
    if (enemy === this.player) {
      return;
    }

    // One of ours already patrols there (sent by any trigger): don't pile up more
    if (this.warshipsCovering(tile).length > 0) {
      return;
    }

    // Don't send too many warships
    if (this.player.units(UnitType.Warship).length >= 10) {
      this.maybeMoveWarship(tile);
      return;
    }

    const { difficulty } = this.game.config().gameConfig();
    // In Easy never retaliate. In Medium retaliate with 15% chance. Hard with 50%, Impossible with 80%.
    if (
      (difficulty === Difficulty.Medium && this.random.nextInt(0, 100) < 15) ||
      (difficulty === Difficulty.Hard && this.random.nextInt(0, 100) < 50) ||
      (difficulty === Difficulty.Impossible && this.random.nextInt(0, 100) < 80)
    ) {
      const canBuild = this.player.canBuild(UnitType.Warship, tile);
      // Stopping an invasion may dip into the gold kept for nukes
      const affordable =
        reason === "invasion" ||
        this.spareGold() >= this.cost(UnitType.Warship);
      if (canBuild === false || !affordable) {
        this.maybeMoveWarship(tile);
        return;
      }
      this.game.addExecution(
        new ConstructionExecution(this.player, UnitType.Warship, tile),
      );
      this.emojiBehavior.maybeSendEmoji(enemy, EMOJI_WARSHIP_RETALIATION);
      this.player.updateRelation(enemy, reason === "trade" ? -7.5 : -15);
    }
  }

  // Send a squad at the fleet blocking our boats, all at once or not at all:
  // Hard as many ships as they have, Impossible one more
  clearSeaLane(blocker: Unit): void {
    if (this.game.config().isUnitDisabled(UnitType.Warship)) return;
    const { difficulty } = this.game.config().gameConfig();
    const target = blocker.tile();
    const fleet = this.hostileWarshipsNear(target);
    let wanted: number;
    switch (difficulty) {
      case Difficulty.Easy:
      case Difficulty.Medium:
        return;
      case Difficulty.Hard:
        wanted = fleet;
        break;
      case Difficulty.Impossible:
        wanted = fleet + 1;
        break;
      default:
        assertNever(difficulty);
    }

    const covering = this.warshipsCovering(target);
    const component = this.game.getWaterComponent(target);
    // Ships with enemies around their patrol tile are busy; pulling them away would thrash
    const spare = this.player
      .units(UnitType.Warship)
      .filter((w) => {
        const state = w.warshipState();
        return (
          !covering.includes(w) &&
          state.state === "patrolling" &&
          this.game.getWaterComponent(w.tile()) === component &&
          (state.patrolTile === undefined ||
            this.hostileWarshipsNear(state.patrolTile) === 0)
        );
      })
      .sort(
        (a, b) =>
          this.game.manhattanDist(a.tile(), target) -
          this.game.manhattanDist(b.tile(), target),
      );
    const recruits = spare.slice(0, Math.max(0, wanted - covering.length));
    const builds = wanted - covering.length - recruits.length;
    // Ships sent in one by one get sunk one by one
    if (builds > 0) {
      if (this.player.units(UnitType.Warship).length + builds > 10) return;
      // Each ship we own raises the price of the next
      let total = 0n;
      for (let i = 0; i < builds; i++) {
        total += this.cost(UnitType.Warship, i);
      }
      if (this.spareGold() < total) return;
      if (this.player.canBuild(UnitType.Warship, target) === false) return;
    }
    for (const w of recruits) {
      w.updateWarshipState({ patrolTile: target });
    }
    for (let i = 0; i < builds; i++) {
      this.game.addExecution(
        new ConstructionExecution(this.player, UnitType.Warship, target),
      );
    }
  }

  private hostileWarshipsNear(tile: TileRef): number {
    return this.game
      .nearbyUnits(
        tile,
        this.game.config().warshipTargettingRange(),
        UnitType.Warship,
      )
      .filter(({ unit }) => unit.owner().canAttackPlayer(this.player, true))
      .length;
  }

  // Our warships on the same water whose patrol area includes `tile`
  private warshipsCovering(tile: TileRef): Unit[] {
    const component = this.game.getWaterComponent(tile);
    const patrolRange = this.game.config().warshipPatrolRange();
    return this.player.units(UnitType.Warship).filter((w) => {
      const patrolTile = w.warshipState().patrolTile;
      return (
        patrolTile !== undefined &&
        this.game.getWaterComponent(w.tile()) === component &&
        this.game.manhattanDist(patrolTile, tile) <= patrolRange
      );
    });
  }

  private maybeMoveWarship(tile: TileRef): void {
    // Make sure we are targeting water
    if (this.game.isWater(tile)) {
      const warship = this.player
        .units(UnitType.Warship)
        .filter((p) => {
          const patrolTile = p.warshipState().patrolTile;
          return (
            patrolTile !== undefined &&
            // Dont send ships which are already traveling
            this.game.manhattanDist(p.tile(), patrolTile) < 130
          );
        })
        .sort((a, b) => {
          // Sort by distance (closest first)
          const distA = this.game.manhattanDist(a.tile(), tile);
          const distB = this.game.manhattanDist(b.tile(), tile);
          return distA - distB;
        })[0];

      if (warship) {
        warship.updateWarshipState({ patrolTile: tile });
      }
    }
  }

  // Prevent warship infestations: if current player is one of the 3 richest and an enemy has too many warships, send a counter-warship.
  // What is a warship infestation? A player tries to dominate the entire ocean to block all trade and transport boats.
  counterWarshipInfestation(): void {
    if (!this.shouldCounterWarshipInfestation()) {
      return;
    }

    const isTeamGame = this.player.team() !== null;

    if (!this.isRichPlayer(isTeamGame)) {
      return;
    }

    const target = this.findWarshipInfestationCounterTarget(isTeamGame);
    if (target !== null) {
      this.buildCounterWarship(target);
    }
  }

  private shouldCounterWarshipInfestation(): boolean {
    if (this.game.config().isUnitDisabled(UnitType.Warship)) {
      return false;
    }

    // Only the smart nations can do this
    const { difficulty } = this.game.config().gameConfig();
    if (
      difficulty !== Difficulty.Hard &&
      difficulty !== Difficulty.Impossible
    ) {
      return false;
    }

    // Quit early if there aren't many warships in the game
    if (this.game.unitCount(UnitType.Warship) <= 10) {
      return false;
    }

    // Quit early if we can't afford a warship
    if (this.cost(UnitType.Warship) > this.spareGold()) {
      return false;
    }

    // Quit early if we don't have a port to send warships from
    if (this.player.units(UnitType.Port).length === 0) {
      return false;
    }

    // Don't send too many warships
    if (this.player.units(UnitType.Warship).length >= 10) {
      return false;
    }

    return true;
  }

  // Check if current player is one of the 3 richest (We don't want poor nations to use their precious gold on this)
  private isRichPlayer(isTeamGame: boolean): boolean {
    const players = this.game.players().filter((p) => {
      if (p.type() === PlayerType.Human) return false;
      return isTeamGame ? p.team() === this.player.team() : true;
    });
    const topThree = players
      .sort((a, b) => Number(b.gold() - a.gold()))
      .slice(0, 3);
    return topThree.some((p) => p.id() === this.player.id());
  }

  private findWarshipInfestationCounterTarget(
    isTeamGame: boolean,
  ): { player: Player; warship: Unit } | null {
    return isTeamGame
      ? this.findTeamGameWarshipTarget()
      : this.findFreeForAllWarshipTarget();
  }

  private findTeamGameWarshipTarget(): {
    player: Player;
    warship: Unit;
  } | null {
    const enemyTeamWarships = new Map<
      string,
      { count: number; team: string; players: Player[] }
    >();

    let ownFleet = 0;
    for (const p of this.game.players()) {
      // Skip friendly players (our team and allies), but count their warships
      if (this.player.isFriendly(p) || p.id() === this.player.id()) {
        ownFleet += p.units(UnitType.Warship).length;
        continue;
      }

      const team = p.team();
      if (team === null) continue;

      const teamKey = team.toString();
      const warshipCount = p.units(UnitType.Warship).length;

      if (!enemyTeamWarships.has(teamKey)) {
        enemyTeamWarships.set(teamKey, {
          count: 0,
          team: teamKey,
          players: [],
        });
      }
      const teamData = enemyTeamWarships.get(teamKey)!;
      teamData.count += warshipCount;
      teamData.players.push(p);
    }

    // Find team with more than 15 warships that outnumbers our team and allies
    for (const [, teamData] of enemyTeamWarships.entries()) {
      if (teamData.count > 15 && teamData.count > ownFleet) {
        // Find player in that team with most warships
        const playerWithMostWarships = teamData.players.reduce(
          (max, p) => {
            const count = p.units(UnitType.Warship).length;
            const maxCount = max ? max.units(UnitType.Warship).length : 0;
            return count > maxCount ? p : max;
          },
          null as Player | null,
        );

        if (playerWithMostWarships) {
          const warships = playerWithMostWarships.units(UnitType.Warship);
          if (warships.length > 3) {
            return {
              player: playerWithMostWarships,
              warship: this.random.randElement(warships),
            };
          }
        }
      }
    }

    return null;
  }

  private findFreeForAllWarshipTarget(): {
    player: Player;
    warship: Unit;
  } | null {
    const enemies = this.game
      .players()
      .filter((p) => !this.player.isFriendly(p) && p.id() !== this.player.id());

    for (const enemy of enemies) {
      const enemyWarships = enemy.units(UnitType.Warship);
      if (enemyWarships.length > 10) {
        return {
          player: enemy,
          warship: this.random.randElement(enemyWarships),
        };
      }
    }

    return null;
  }

  private buildCounterWarship(target: { player: Player; warship: Unit }): void {
    const canBuild = this.player.canBuild(
      UnitType.Warship,
      target.warship.tile(),
    );
    if (canBuild === false) {
      this.maybeMoveWarship(target.warship.tile());
      return;
    }

    this.game.addExecution(
      new ConstructionExecution(
        this.player,
        UnitType.Warship,
        target.warship.tile(),
      ),
    );
    this.emojiBehavior.sendEmoji(AllPlayers, EMOJI_WARSHIP_RETALIATION);
  }

  /** Gold for warships that don't stop an invasion: with atom bombs disabled, silo owners keep a hydrogen bomb's price for nukes. */
  private spareGold(): Gold {
    const config = this.game.config();
    if (
      !config.isUnitDisabled(UnitType.AtomBomb) ||
      config.isUnitDisabled(UnitType.HydrogenBomb) ||
      this.player.unitCount(UnitType.MissileSilo) === 0
    ) {
      return this.player.gold();
    }
    return this.player.gold() - this.cost(UnitType.HydrogenBomb);
  }

  private cost(type: UnitType, extraUnits: number = 0): Gold {
    return this.game.unitInfo(type).cost(this.game, this.player, extraUnits);
  }
}

export const NationWarshipBehaviorSnapshot = snapshotType({
  name: "NationWarshipBehavior",
  version: 1,
  schema: z.object({
    trackedTransportShips: z.array(zRef()),
    trackedTradeShips: z.array(zRef()),
    trackedIncomingTransportShips: z.array(zRef()),
    dealtWithTransportShip: z.array(zRef()),
    // Additive optional entry preserves old FFA and pre-NATIONAL snapshots.
    nationalNavalMission: z
      .object({
        vesselId: z.string(),
        targetOwnerId: z.string(),
        dispatchedAtTick: z.number().int().nonnegative(),
      })
      .nullable()
      .optional(),
    // Optional additive field: snapshots without defensive escort data and
    // all legacy FFA files retain their original version-one interpretation.
    nationalNavalEscortMission: z
      .object({
        merchantId: z.string(),
        raiderId: z.string(),
        raiderOwnerId: z.string(),
        dispatchedAtTick: z.number().int().nonnegative(),
      })
      .nullable()
      .optional(),
  }),
});
