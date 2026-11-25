import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  type ClientID,
  NationalBlockadeIntentSchema,
  type NationalBlockadeIntent,
} from "@openfront/engine-api/Schemas";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import type { Execution, Game, Player, Unit } from "../game/Game";
import { blockadeRadius } from "../national/conflict/NationalMaritime";
import { collectLiveNationalObservation } from "../national/observation/LiveObservation";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

const missionSchema = z.object({
  targetOwner: z.string(),
  approach: z.number().int().nonnegative(),
  empire: z.string().nullable(),
  authorityVersion: z.number().int().nonnegative().nullable(),
  phase: z.enum(["en-route", "active", "ended"]),
});
const stateSchema = z.object({
  retained: z.boolean(),
  initialized: z.boolean(),
  actor: zPlayerRef(),
  command: NationalBlockadeIntentSchema,
  clientId: z.string(),
  mission: missionSchema.nullable(),
});
type Mission = z.infer<typeof missionSchema>;
type State = z.infer<typeof stateSchema>;

// A bounded, durable command journal: never evict a replay receipt to
// admit a later duplicate. New orders fail closed once the journal is full.
const MAX_MISSIONS = 128;

/** Orders move an existing hull via its real WarshipExecution; no synthetic ships or income. */
export class NationalBlockadeExecution implements Execution {
  private retained = true;
  private game: Game | null = null;
  private mission: Mission | null = null;

  constructor(
    private actor: Player,
    private command: NationalBlockadeIntent,
    private clientId: ClientID,
  ) {}

  private static records(game: Game): NationalBlockadeExecution[] {
    return game
      .executions()
      .filter(
        (execution): execution is NationalBlockadeExecution =>
          execution instanceof NationalBlockadeExecution &&
          execution.game !== null &&
          execution.retained,
      );
  }

  private authorized(): boolean {
    const game = this.game!;
    const politics = game.nationalPoliticalAuthority();
    return (
      game.nationalWarAuthority() !== null &&
      !game.inSpawnPhase() &&
      this.actor.type() === PlayerType.Human &&
      this.actor.isAlive() &&
      this.actor.hasSpawned() &&
      this.actor.clientID() === this.clientId &&
      game.playerByClientID(this.clientId) === this.actor &&
      politics !== null &&
      politics.delegatedNationalWar(this.actor.id(), "declare")
    );
  }

  private exactWar(targetId: string): boolean {
    const game = this.game!;
    const war = game.nationalWarAuthority();
    const politics = game.nationalPoliticalAuthority();
    if (
      !war ||
      !politics ||
      !war.authorizeOffensiveAction(this.actor.id(), targetId)
    )
      return false;
    const layer = war
      .snapshot()
      .wars.layers.find(
        (item) => item.id === this.command.warId && item.endedTick === null,
      );
    if (!layer) return false;
    const contains = (side: typeof layer.first, id: string) =>
      side.kind === "nation"
        ? side.id === id
        : politics.empireOf(id) === side.id;
    return (
      (contains(layer.first, this.actor.id()) &&
        contains(layer.second, targetId)) ||
      (contains(layer.second, this.actor.id()) &&
        contains(layer.first, targetId))
    );
  }

  private liveUnits(): { ship: Unit; port: Unit } | null {
    const game = this.game!;
    const ship = game.unit(this.command.shipId);
    const port = game.unit(this.command.portId);
    if (
      !ship ||
      !port ||
      ship.owner() !== this.actor ||
      ship.type() !== UnitType.Warship ||
      port.type() !== UnitType.Port ||
      !ship.isActive() ||
      !port.isActive() ||
      ship.isMarkedForDeletion() ||
      port.isMarkedForDeletion() ||
      ship.isUnderConstruction() ||
      port.isUnderConstruction() ||
      ship.health() <= 0 ||
      port.tile() !== this.command.portTile ||
      !game.isWater(ship.tile())
    )
      return null;
    return { ship, port };
  }

  init(game: Game): void {
    this.game = game;
    this.retained = false;
    if (
      !NationalBlockadeIntentSchema.safeParse(this.command).success ||
      !this.authorized() ||
      !game.isValidRef(this.command.portTile)
    )
      return;
    const records = NationalBlockadeExecution.records(game);
    if (
      records.filter((record) => record.actor === this.actor).length >=
        MAX_MISSIONS ||
      records.some(
        (record) =>
          record.actor === this.actor &&
          record.command.requestId === this.command.requestId,
      )
    )
      return;
    this.retained = true;
    // Sight is obtained before accepting the foreign ID or its claimed tile.
    // Rejections are silent; callers cannot query for hidden port coordinates.
    const visible = collectLiveNationalObservation(
      game,
      this.actor.id(),
    ).observation;
    if (
      !visible.visibleAssets.some(
        (asset) =>
          asset.id === String(this.command.portId) &&
          asset.kind === "structure" &&
          asset.x === game.x(this.command.portTile) &&
          asset.y === game.y(this.command.portTile),
      )
    )
      return;
    const units = this.liveUnits();
    if (!units || !this.exactWar(units.port.owner().id())) return;
    const { ship, port } = units;
    const component = game.getWaterComponent(ship.tile());
    if (component === null || !game.hasWaterComponent(port.tile(), component))
      return;
    const approaches = [port.tile()];
    game.forEachNeighbor(port.tile(), (tile) => approaches.push(tile));
    const approach = approaches
      .filter(
        (tile) =>
          game.isWater(tile) && game.getWaterComponent(tile) === component,
      )
      .sort(
        (a, b) =>
          game.manhattanDist(ship.tile(), a) -
            game.manhattanDist(ship.tile(), b) || a - b,
      )[0];
    if (approach === undefined) return;
    const politics = game.nationalPoliticalAuthority()!;
    for (const record of records) {
      if (record.command.shipId === ship.id() && record.mission)
        record.mission.phase = "ended";
    }
    this.mission = {
      targetOwner: port.owner().id(),
      approach,
      empire: politics.empireOf(this.actor.id()),
      authorityVersion: politics.warPolicyVersionFor(this.actor.id()),
      phase: "en-route",
    };
    this.retained = true;
    ship.updateWarshipState({ patrolTile: approach });
    ship.setTargetTile(approach);
  }

  private current(): { ship: Unit; port: Unit } | null {
    const mission = this.mission;
    if (!mission || mission.phase === "ended" || !this.authorized())
      return null;
    const politics = this.game!.nationalPoliticalAuthority()!;
    const units = this.liveUnits();
    if (
      !units ||
      politics.empireOf(this.actor.id()) !== mission.empire ||
      politics.warPolicyVersionFor(this.actor.id()) !==
        mission.authorityVersion ||
      units.port.owner().id() !== mission.targetOwner ||
      units.ship.warshipState().patrolTile !== mission.approach ||
      !this.exactWar(mission.targetOwner)
    )
      return null;
    return units;
  }

  private covers(ship: Unit, port: Unit): boolean {
    const game = this.game!;
    const component = game.getWaterComponent(ship.tile());
    return (
      ship.warshipState().state === "patrolling" &&
      component !== null &&
      game.hasWaterComponent(port.tile(), component) &&
      game.euclideanDistSquared(ship.tile(), port.tile()) <=
        blockadeRadius(game) ** 2
    );
  }

  tick(): void {
    if (!this.mission || this.mission.phase === "ended") return;
    const units = this.current();
    if (!units) {
      this.mission.phase = "ended";
      return;
    }
    const { ship, port } = units;
    this.mission.phase = this.covers(ship, port) ? "active" : "en-route";
    // Repair and legal combat retain priority in WarshipExecution.
    if (ship.warshipState().state === "patrolling" && !ship.targetUnit())
      ship.setTargetTile(this.mission.approach);
  }

  /** Legacy passive blockaders stay intact. A commissioned hull may only
   * interdict its actual target while its own mandate and physical cover hold. */
  static allowsInterdiction(game: Game, ship: Unit, port: Unit): boolean {
    const records = this.records(game).filter(
      (item) =>
        item.mission !== null &&
        item.actor === ship.owner() &&
        item.command.shipId === ship.id(),
    );
    const record = records[records.length - 1];
    if (!record) return true;
    const units = record.current();
    return units !== null && units.port === port && record.covers(ship, port);
  }

  /** No other player can inspect the command journal. */
  static viewFor(game: Game, actor: Player) {
    return this.records(game)
      .filter(
        (record) =>
          record.actor === actor && actor.clientID() === record.clientId,
      )
      .map((record) => ({
        requestId: record.command.requestId,
        shipId: record.command.shipId,
        portId: record.command.portId,
        phase: record.mission?.phase ?? "rejected",
      }));
  }

  static stateHash(game: Game): number {
    const records = this.records(game);
    if (records.length === 0) return 0;
    return simpleHash(
      JSON.stringify(
        records.map((record) => ({
          actor: record.actor.id(),
          command: record.command,
          mission: record.mission,
        })),
      ),
    );
  }

  isActive(): boolean {
    return this.retained;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return NationalBlockadeExecutionSnapshot.write({
      retained: this.retained,
      initialized: this.game !== null,
      actor: w.player(this.actor),
      command: this.command,
      clientId: this.clientId,
      mission: this.mission,
    });
  }

  restoreSnapshot(state: State, r: SnapshotReader): void {
    this.retained = state.retained;
    this.game = state.initialized ? r.game : null;
    this.actor = r.player(state.actor);
    this.command = state.command;
    this.clientId = state.clientId;
    this.mission = state.mission;
  }
}

export const NationalBlockadeExecutionSnapshot = execSnapshotType({
  name: "NationalBlockade",
  version: 1,
  schema: stateSchema,
  cls: () => NationalBlockadeExecution,
});
