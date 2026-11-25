import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Difficulty,
  GameMode,
  Nation,
  PlayerID,
  PlayerType,
  Relation,
  TerrainType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameID } from "@openfront/engine-api/Schemas";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  VersionedSchema,
  zNum,
  zPlayerRef,
  zRandom,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { assertNever, simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import {
  initialNationalAssessmentAIMemory,
  planNationalAssessment,
  recordNationalAssessmentAttempt,
  type NationalAssessmentAIMemory,
} from "../national/ai/NationalAssessmentStrategy";
import {
  planObservedImperialCoercion,
  proposeCanonicalImperialUltimatumIntent,
  type ObservedImperialUltimatum,
} from "../national/ai/NationalCoercionStrategy";
import {
  initialNationalEconomicMemory,
  planNationalEconomicDecision,
  updateNationalEconomicMemory,
  type NationalEconomicMemory,
} from "../national/ai/NationalEconomicPlanner";
import {
  deriveNationalWarSides,
  initialNationalPlannerMemory,
  planNationalInterest,
  recordNationalWarOutcome,
  type NationalPlannerMemory,
} from "../national/ai/NationalPlanner";
import {
  holdsNationalPeace,
  NationalPeaceMemorySchema,
  planNationalPeace,
  recordNationalPeaceOutcome,
  type NationalPeaceMemory,
} from "../national/ai/NationalPeaceStrategy";
import {
  initialAIPoliticalMemory,
  planAIPoliticalInterest,
  recordAIPoliticalOutcome,
  type AIPoliticalMemory,
} from "../national/ai/NationalPoliticalStrategy";
import {
  initialNationalReconMemory,
  planNationalRecon,
  recordNationalReconAttempt,
  type NationalReconMemory,
} from "../national/ai/NationalReconStrategy";
import {
  collectLiveNationalObservation,
  liveNationalWarAuthority,
} from "../national/observation/LiveObservation";
import {
  advanceLastKnown,
  type NationalSightMemory,
} from "../national/observation/NationalObservation";
import {
  NationSchema,
  nationData,
  newCell,
  readPlayerInfo,
} from "../snapshot/CommonSchemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { AttackExecution } from "./AttackExecution";
import { NationAllianceBehavior } from "./nation/NationAllianceBehavior";
import { NationAttackBehavior } from "./nation/NationAttackBehavior";
import { NationEmojiBehavior } from "./nation/NationEmojiBehavior";
import { NationMIRVBehavior } from "./nation/NationMIRVBehavior";
import { NationNukeBehavior } from "./nation/NationNukeBehavior";
import { NationStructureBehavior } from "./nation/NationStructureBehavior";
import { NationWarshipBehavior } from "./nation/NationWarshipBehavior";
import { tutorialCollapse } from "./nation/TutorialCollapse";
import { tutorialSilo, tutorialWarship } from "./nation/TutorialSilo";
import { NationalSanctionExecution } from "./NationalSanctionExecution";
import { NationalUltimatumExecution } from "./NationalUltimatumExecution";
import { SpawnExecution } from "./SpawnExecution";

/**
 * E2 owns persistence and the live execution hook. E3's pure planner owns
 * rejected-target expiry and replay deduplication; no duplicate WAR ledger.
 * The optional module export permits each independent PR to compile before
 * the Conductor assembles E2 + E3.
 */
type NationalExecutionPlannerMemory = NationalPlannerMemory & {
  readonly rejectedWarTargets?: readonly {
    readonly targetId: string;
    readonly retryAfterTick: number;
  }[];
  readonly lastWarOutcomeSequence?: number;
  readonly political?: AIPoliticalMemory;
};

export class NationExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private behaviorsInitialized = false;
  private spawnExecAdded = false;
  private emojiBehavior!: NationEmojiBehavior;
  private mirvBehavior!: NationMIRVBehavior;
  private attackBehavior!: NationAttackBehavior;
  private allianceBehavior!: NationAllianceBehavior;
  private warshipBehavior!: NationWarshipBehavior;
  private nukeBehavior!: NationNukeBehavior;
  private structureBehavior!: NationStructureBehavior;
  private mg: Game;
  private player: Player | null = null;

  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;
  private expandRatio: number;

  private embargoMalusApplied = new Set<PlayerID>();

  // E3-owned execution snapshot state: no game-global WeakMap, no AI
  // access to an unrestricted Game/Player observation.
  private nationalPlannerMemory: NationalExecutionPlannerMemory | null = null;
  private nationalSightMemory: NationalSightMemory | null = null;
  // Economic memory is principal-local, bounded and persisted for replay.
  private nationalEconomicMemory: NationalEconomicMemory | null = null;
  // E5: private, bounded, actor-owned paid-recon history; never a second wallet.
  private nationalReconMemory: NationalReconMemory | null = null;
  // C6 E5: separate bounded 1,200-gold assessment purchase receipts.
  private nationalAssessmentMemory: NationalAssessmentAIMemory | null = null;
  private nationalPeaceMemory: NationalPeaceMemory | null = null;

  constructor(
    private gameID: GameID,
    private nation: Nation, // Nation contains PlayerInfo with PlayerType.Nation
  ) {
    this.random = new PseudoRandom(
      simpleHash(nation.playerInfo.id) + simpleHash(gameID),
    );
    this.triggerRatio = this.random.nextInt(50, 60) / 100;
    this.reserveRatio = this.random.nextInt(30, 40) / 100;
    this.expandRatio = this.random.nextInt(10, 20) / 100;
  }

  playerID(): string {
    return this.nation.playerInfo.id;
  }

  isInitialized(): boolean {
    return this.mg !== undefined;
  }

  refreshDifficulty(): void {
    if (!this.mg) return;
    this.attackRate = this.getAttackRate();
    this.attackTick = this.random.nextInt(0, this.attackRate);
  }

  currentAttackRate(): number {
    return this.attackRate;
  }

  currentAttackTick(): number {
    return this.attackTick;
  }

  init(mg: Game) {
    this.mg = mg;
    this.attackRate = this.getAttackRate();
    this.attackTick = this.random.nextInt(0, this.attackRate);

    if (!this.mg.hasPlayer(this.nation.playerInfo.id)) {
      this.player = this.mg.addPlayer(this.nation.playerInfo);
    } else {
      this.player = this.mg.player(this.nation.playerInfo.id);
    }
  }

  private getAttackRate(): number {
    const { difficulty } = this.mg.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return this.random.nextInt(65, 100); // Slower reactions
      case Difficulty.Medium:
        return this.random.nextInt(55, 70);
      case Difficulty.Hard:
        return this.random.nextInt(45, 60);
      case Difficulty.Impossible:
        return this.random.nextInt(30, 50); // Faster reactions
      default:
        assertNever(difficulty);
    }
  }

  tick(ticks: number) {
    // NATIONAL must never run legacy omniscient ship monitoring. Legacy
    // behavior remains byte-for-byte equivalent with the flag absent.
    if (this.mg.config().nationalMode() && !this.mg.inSpawnPhase()) {
      if (this.player === null) return;
      // An unspawned nation is NOT eliminated. The separate SpawnExecution
      // may still be pending; marking this execution inactive before spawn
      // would permanently disable all NATIONAL AI for that nation.
      if (!this.player.hasSpawned()) return;
      if (!this.player.isAlive()) {
        this.active = false;
        return;
      }
      this.tickNational(ticks);
      return;
    }

    // Ship tracking
    if (
      this.behaviorsInitialized &&
      this.player !== null &&
      this.player.isAlive() &&
      this.mg.config().gameConfig().difficulty !== Difficulty.Easy &&
      !this.mg.config().gameConfig().tutorial &&
      this.player.unitsConstructed(UnitType.Port) &&
      !this.mg.config().isUnitDisabled(UnitType.Warship)
    ) {
      this.warshipBehavior.trackShipsAndRetaliate();
    }

    if (this.player === null) {
      return;
    }

    if (this.mg.inSpawnPhase()) {
      if (this.player.hasSpawned()) {
        // Already on the map — periodically re-spawn so the nation
        // visibly hops to different locations during the spawn phase.
        if (ticks % this.attackRate !== this.attackTick) {
          return;
        }
      } else if (this.spawnExecAdded) {
        // First SpawnExecution already queued, wait for it to land.
        return;
      }
      // Place nations without a spawn cell (Dynamically created for HumansVsNations) randomly by SpawnExecution
      if (this.nation.spawnCell === undefined) {
        this.mg.addExecution(
          new SpawnExecution(this.gameID, this.nation.playerInfo),
        );
        this.spawnExecAdded = true;
        return;
      }

      // If team spawn areas are configured and the nation's spawn cell
      // is outside its team's area, spawn randomly within the area instead.
      const team = this.player.team();
      if (team !== null) {
        const area = this.mg.teamSpawnArea(team);
        if (area !== undefined) {
          const cell = this.nation.spawnCell;
          const inArea =
            cell.x >= area.x &&
            cell.x < area.x + area.width &&
            cell.y >= area.y &&
            cell.y < area.y + area.height;
          if (!inArea) {
            this.mg.addExecution(
              new SpawnExecution(this.gameID, this.nation.playerInfo),
            );
            this.spawnExecAdded = true;
            return;
          }
        }
      }

      // Select a tile near the position defined in the map manifest
      const rl = this.randomSpawnLand();

      if (rl === null) {
        console.warn(`cannot spawn ${this.nation.playerInfo.name}`);
        return;
      }

      this.mg.addExecution(
        new SpawnExecution(this.gameID, this.nation.playerInfo, rl),
      );
      this.spawnExecAdded = true;
      return;
    }

    // Spawn phase already ended but our SpawnExecution hasn't fired yet — wait.
    if (this.spawnExecAdded && !this.player.hasSpawned()) {
      return;
    }

    if (!this.player.isAlive()) {
      //removeOnDeath is called from nation's PlayerExecution
      this.active = false;
      return;
    }

    if (!this.behaviorsInitialized) {
      this.initializeBehaviors();
      this.attackBehavior.forceSendAttack(this.mg.terraNullius());
      return;
    }

    // The tutorial's nations only grow into free land, and the one on the
    // player's island nukes them from its silo (TutorialSilo): no attacks,
    // boats, alliances or other structures. Each falls once the player has
    // taken most of it (TutorialCollapse).
    if (this.mg.config().gameConfig().tutorial) {
      tutorialCollapse(this.mg, this.player);
      if (!this.player.isAlive()) return;
      const attackTick = ticks % this.attackRate === this.attackTick;
      if (attackTick) this.attackBehavior.expandIntoFreeLand();
      tutorialSilo(this.mg, this.player, attackTick);
      tutorialWarship(this.mg, this.player, ticks);
      return;
    }

    this.attackBehavior.followUpLandings();
    this.nukeBehavior.followUpStrikes();

    if (ticks % this.attackRate !== this.attackTick) {
      // Call handleStructures twice between regular attack ticks (at 1/3 and 2/3 of the interval)
      // Otherwise it is possible that we earn more gold than we can spend
      // The alternative is placing multiple structures in handleStructures, but that causes problems
      if (this.player.isAlive()) {
        const offset = ticks % this.attackRate;
        const oneThird =
          (this.attackTick + Math.floor(this.attackRate / 3)) % this.attackRate;
        const twoThirds =
          (this.attackTick + Math.floor((this.attackRate * 2) / 3)) %
          this.attackRate;
        if (offset === oneThird || offset === twoThirds) {
          this.structureBehavior.handleStructures();
        }
      }
      return;
    }

    this.emojiBehavior.maybeSendCasualEmoji();
    this.updateRelationsFromEmbargos();
    this.allianceBehavior.handleAllianceRequests();
    this.allianceBehavior.handleAllianceExtensionRequests();
    this.mirvBehavior.considerMIRV();
    this.structureBehavior.handleStructures();
    this.warshipBehavior.maybeSpawnWarship();
    this.handleEmbargoesToHostileNations();
    this.attackBehavior.maybeAttack();
    this.warshipBehavior.counterWarshipInfestation();
    this.nukeBehavior.maybeSendNuke();
  }

  /**
   * NATIONAL-only bounded strategy. The authoritative game reference is
   * confined to the collector and to the final validated execution primitive;
   * the decision itself observes only a whitelisted NationalObservation.
   * Foreign attacks require E2's actual opposing-war-side authority and
   * a reachable observed border. Missing war plumbing fails closed.
   * Neutral expansion remains legal in M0.
   */
  private tickNational(ticks: number): void {
    const player = this.player;
    if (player === null || !player.hasSpawned()) return;
    // The E3 planner owns cadence and public-event reactions. Poll only
    // every fifth tick before the ordinary deadline: a bounded 0–4 tick
    // public-WAR reaction delay without a costly full observation on every
    // simulation tick. The observation itself stays E3-principal-filtered.
    if (
      this.nationalPlannerMemory !== null &&
      ticks < this.nationalPlannerMemory.nextPlanningTick &&
      ticks % 5 !== 0
    )
      return;
    const verified = collectLiveNationalObservation(this.mg, player.id());
    const observation = verified.observation;
    if (observation.wars.length > 0 || this.nationalPeaceMemory !== null) {
      const peace = planNationalPeace(observation, this.nationalPeaceMemory);
      this.nationalPeaceMemory = peace.memory;
      if (peace.choice !== null) {
        const choice = peace.choice;
        const politics = this.mg.nationalPoliticalAuthority();
        if (politics === null) return;
        // This is the same authenticated Game command/journal used by the
        // human Executor. The registered Nation Player is the principal.
        // A human can preclaim a predictable request token. Let the canonical
        // journal allocate a collision-safe auto receipt; motion identity is
        // separately engine-owned and never accepted from the wire.
        const motionId =
          choice.kind === "propose-peace"
            ? `ai-peace-${player.smallID()}-${ticks}`
            : choice.motionId;
        const command =
          choice.kind === "propose-peace"
            ? { kind: choice.kind, warId: choice.warId, motionId }
            : { kind: choice.kind, motionId };
        let outcome: ReturnType<Game["performNationalWarCommandWithOutcome"]>;
        try {
          outcome = this.mg.performNationalWarCommandWithOutcome(player, {
            ...command,
            admissionEmpireId: politics.empireOf(player.id()),
            policyVersion: politics.warPolicyVersionFor(player.id()),
          });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            ![
              "NATIONAL command journal: lifetime request cap reached",
              "NATIONAL command journal: sequence exhausted",
            ].includes(error.message)
          )
            throw error;
          // No receipt exists: back off without manufacturing a rejection.
          this.nationalPeaceMemory = recordNationalPeaceOutcome(
            peace.memory,
            choice,
            ticks,
            null,
          );
          return;
        }
        if (
          outcome.actorId !== player.id() ||
          outcome.recipientId !== player.id() ||
          outcome.tick !== observation.tick ||
          outcome.warId !== choice.warId ||
          outcome.motionId !== motionId ||
          outcome.commandKind !==
            (choice.kind === "propose-peace"
              ? "national_propose_peace"
              : "national_accept_peace") ||
          outcome.commandTargetId !==
            (choice.kind === "propose-peace" ? choice.warId : choice.motionId)
        )
          throw new Error("NATIONAL peace: invalid canonical outcome");
        this.nationalPeaceMemory = recordNationalPeaceOutcome(
          peace.memory,
          choice,
          ticks,
          outcome.accepted,
        );
        // Never execute an attack against a stale, pre-settlement projection.
        if (outcome.accepted && choice.kind === "accept-peace") return;
      }
    }
    // Authorized live observer: E6 defensive escort first, offensive naval
    // pressure only if no escort action; E5 intelligence executes afterward.
    if (!this.behaviorsInitialized) this.initializeBehaviors();
    const escorted =
      this.warshipBehavior.dispatchNationalNavalEscort(observation);
    if (escorted === null) {
      this.warshipBehavior.dispatchNationalNavalPressure(observation);
    }
    // Both AI and humans have access to identical authenticated observations
    // and own trading permissions. No global foreign route or balance scan.
    const demands = NationalSanctionExecution.viewFor(this.mg, player);
    const partners = new Set(
      demands.flatMap((d) => [
        d.target,
        ...(d.authorityId === null ? [] : [d.authorityId]),
        ...d.recipientIds,
        ...(observation.coalitions.find((c) => c.id === d.empire)?.members ??
          []),
      ]),
    );
    const voyages = new Map<string, number>();
    for (const ship of player.units(UnitType.TradeShip)) {
      if (ship.owner() !== player || !ship.isActive()) continue;
      const id = ship.targetUnit()?.owner().id();
      if (id === undefined || id === player.id()) continue;
      partners.add(id);
      voyages.set(id, (voyages.get(id) ?? 0) + 1);
    }
    partners.delete(player.id());
    const ties = [...partners].sort().map((partnerId) => ({
      partnerId,
      tradePermitted:
        this.mg.hasPlayer(partnerId) &&
        player.canTrade(this.mg.player(partnerId)),
      activeOwnVoyages: voyages.get(partnerId) ?? 0,
    }));
    const priorEconomic =
      this.nationalEconomicMemory ?? initialNationalEconomicMemory(player.id());
    this.nationalEconomicMemory = updateNationalEconomicMemory(
      observation,
      demands,
      priorEconomic,
    );
    const economic = planNationalEconomicDecision(
      observation,
      demands,
      ties,
      this.nationalEconomicMemory,
    );
    if (economic) {
      const identity =
        economic.kind === "issue"
          ? economic.targetId + ":" + economic.recipientIds.join(",")
          : economic.sanctionId;
      const requestId =
        "ai-econ-" + simpleHash(player.id() + ":" + identity + ":" + ticks);
      const command =
        economic.kind === "issue"
          ? {
              type: "national_issue_sanction" as const,
              scope: economic.scope,
              targetId: economic.targetId,
              recipientIds: [...economic.recipientIds],
              durationTicks: economic.durationTicks,
              requestId,
            }
          : economic.kind === "respond"
            ? {
                type: "national_respond_sanction" as const,
                sanctionId: economic.sanctionId,
                decision: economic.decision,
                requestId,
              }
            : {
                type: "national_resolve_sanction" as const,
                sanctionId: economic.sanctionId,
                decision: economic.decision,
                requestId,
              };
      this.mg.addExecution(new NationalSanctionExecution(player, command));
    }
    // E5 M8: source-only observation -> Game-owned purchase authority -> real
    // visibility next tick. Every AI command uses the live player instance;
    // no client session spoofing and no entitlement/treasury mutation here.
    const reconDecision = planNationalRecon(
      observation,
      this.nationalReconMemory ?? initialNationalReconMemory(player.id()),
    );
    this.nationalReconMemory = reconDecision.memory;
    if (reconDecision.purchase !== null) {
      const proposal = reconDecision.purchase;
      const requestId =
        "ai_recon_" +
        (simpleHash(player.id() + ":" + proposal.targetId) >>> 0).toString(36) +
        "_" +
        ticks.toString(36);
      let expiresAtTick: number | null = null;
      try {
        const grant = this.mg.performNationalReconnaissance(
          player,
          proposal.targetId,
          proposal.centerX,
          proposal.centerY,
          requestId,
        );
        expiresAtTick = grant.expiresAtTick;
      } catch {
        // Canonical game denial cannot become a free sight grant. Keep
        // deterministic rejected-attempt memory rather than retry flooding.
      }
      this.nationalReconMemory = recordNationalReconAttempt(
        observation,
        reconDecision.memory,
        proposal,
        requestId,
        expiresAtTick,
      );
      if (expiresAtTick !== null) {
        // Reobserve through the ordinary same-principal fog projector NEXT
        // tick, before considering the pre-purchase offensive campaign.
        this.nationalPlannerMemory = {
          ...(this.nationalPlannerMemory ??
            initialNationalPlannerMemory(player.id())),
          nextPlanningTick: ticks + 1,
        };
        return;
      }
    }
    // C6 E5 original: independent 1,200-gold assessment, NOT geographic
    // reconnaissance. The optional method is supplied by E4's authoritative
    // Game-owned purchase code after Conductor integration. Absence is a
    // no-op: never fabricate a purchase, grant, ledger entry or visible report.
    const assessmentDecision = planNationalAssessment(
      observation,
      this.nationalAssessmentMemory ??
        initialNationalAssessmentAIMemory(player.id()),
    );
    this.nationalAssessmentMemory = assessmentDecision.memory;
    const assessmentGame = this.mg as Game & {
      performNationalAssessment?: (
        actor: Player,
        targetId: string,
        requestId: string,
      ) => {
        payerId: string;
        targetId: string;
        requestId: string;
        effectiveTick: number;
        expiresAtTick: number;
      };
    };
    if (
      assessmentDecision.purchase !== null &&
      typeof assessmentGame.performNationalAssessment === "function"
    ) {
      const targetId = assessmentDecision.purchase.targetId;
      const requestId =
        "ai_assessment_" +
        (simpleHash(player.id() + ":" + targetId) >>> 0).toString(36) +
        "_" +
        ticks.toString(36);
      let expiresAtTick: number | null = null;
      try {
        const grant = assessmentGame.performNationalAssessment(
          player,
          targetId,
          requestId,
        );
        if (
          grant.payerId === player.id() &&
          grant.targetId === targetId &&
          grant.requestId === requestId &&
          grant.effectiveTick === ticks
        ) {
          expiresAtTick = grant.expiresAtTick;
        }
      } catch {
        // A denied canonical purchase never becomes a free assessment.
      }
      this.nationalAssessmentMemory = recordNationalAssessmentAttempt(
        observation,
        assessmentDecision.memory,
        targetId,
        requestId,
        expiresAtTick,
      );
      if (expiresAtTick !== null) {
        // Re-observe the paid report through E4's recipient projector next
        // tick before attempting another military action against this rival.
        this.nationalPlannerMemory = {
          ...(this.nationalPlannerMemory ??
            initialNationalPlannerMemory(player.id())),
          nextPlanningTick: ticks + 1,
        };
        return;
      }
    }
    const remembered = advanceLastKnown(
      observation,
      this.nationalSightMemory,
      60,
    );
    this.nationalSightMemory = remembered.memory;
    const result = planNationalInterest(
      observation,
      this.nationalPlannerMemory ?? initialNationalPlannerMemory(player.id()),
      30,
    );
    // Strategy sees the same human-filtered observation; only GameImpl may
    // accept a proposed political command. Keep outcomes in THIS snapshotted
    // NationExecution, not a second global AI political ledger.
    // A bot must consume E3's real Game-owned, actor-filtered ultimatum view,
    // never a foreign record, guessed target, forged client packet or direct
    // access to the global demand ledger. Extra private fields are discarded.
    const ultimatums: ObservedImperialUltimatum[] =
      NationalUltimatumExecution.viewFor(this.mg, player).map((row) => ({
        id: row.id,
        empireId: row.empireId,
        issuerId: row.issuerId,
        targetId: row.targetId,
        role: row.role,
        threat: row.threat,
        deadlineTick: row.deadlineTick,
        phase: row.phase,
        response: row.response,
      }));
    const political = planAIPoliticalInterest(
      observation,
      this.nationalPlannerMemory?.political ?? initialAIPoliticalMemory(),
      25,
      result.memory.reputation,
      ultimatums,
    );
    this.nationalPlannerMemory = {
      ...result.memory,
      political: political.memory,
    };
    // The E6 strategy proposes but cannot enforce. E3's existing national
    // execution validates current principal, crown, response phase, deadline
    // and WAR/embargo authority at the actual simulation tick.
    if (political.planned && political.memory.coercion) {
      const choice = planObservedImperialCoercion(
        observation,
        ultimatums,
        political.memory.coercion,
      );
      if (choice) {
        const identity =
          choice.kind === "issue"
            ? choice.empireId + ":" + choice.candidateId
            : choice.ultimatumId;
        const requestId =
          "ai-ult-" +
          (
            simpleHash(player.id() + ":" + choice.kind + ":" + identity) >>> 0
          ).toString(36) +
          "-" +
          ticks.toString(36);
        const intent = proposeCanonicalImperialUltimatumIntent(
          observation,
          ultimatums,
          choice,
          requestId,
        );
        if (intent !== null) {
          this.mg.addExecution(new NationalUltimatumExecution(player, intent));
        }
      }
    }
    if (
      political.decision?.command !== null &&
      political.decision?.command !== undefined
    ) {
      try {
        const outcome = this.mg.performNationalPoliticalCommandWithOutcome(
          player,
          political.decision.command,
        );
        this.nationalPlannerMemory = {
          ...this.nationalPlannerMemory,
          political: recordAIPoliticalOutcome(
            observation,
            this.nationalPlannerMemory.political!,
            political.decision.command,
            outcome,
          ),
        };
        if (outcome.accepted) {
          // Fresh projection is mandatory after Betray, pact admission or
          // imperial accession. Never act militarily on the pre-command view.
          this.nationalPlannerMemory = {
            ...this.nationalPlannerMemory,
            nextPlanningTick: Math.min(
              this.nationalPlannerMemory.nextPlanningTick,
              ticks + 5,
            ),
          };
          return;
        }
      } catch {
        // Absent authority or exhausted canonical command journal fails
        // closed; never reroute the AI through direct political mutation.
        this.nationalPlannerMemory = {
          ...this.nationalPlannerMemory,
          political: {
            ...this.nationalPlannerMemory.political!,
            nextPlanningTick: ticks + 180,
          },
        };
      }
    }
    // A small nation under an observed active-war threat must still defend.
    // The old branch discarded every "defend" decision and left a real
    // front idle. Both attack and defense use the same E2 validator.
    if (
      !result.planned ||
      result.decision === null ||
      result.decision.objective === "consolidate"
    )
      return;
    const sides = deriveNationalWarSides(observation.wars, player.id());
    // "defend" is a threat alarm with NO offensive planner target. Choose
    // only an observed, adjacent, already-hostile E2 WAR combatant at the
    // actual execution boundary. Never invent a new war during defense.
    const defensiveFront =
      observation.frontiers
        .filter(
          (f) =>
            f.access === "land" &&
            sides.enemies.has(f.targetId) &&
            !sides.allies.has(f.targetId),
        )
        .map((f) => f.targetId)
        .sort()[0] ?? null;
    const targetId =
      result.decision.objective === "defend"
        ? defensiveFront
        : result.decision.targetId;
    if (result.decision.objective === "defend" && targetId === null) return;
    // A newly disclosed military force makes an elective attack strategically
    // unsound while this genuinely paid reconnaissance lease remains live.
    // An existing defensive WAR is likewise preserved, not fabricated.
    if (targetId !== null && reconDecision.holdOffenseAgainst === targetId)
      return;
    // A real recipient-scoped coarse assessment can justify conserving
    // troops against this WAR enemy. No treaty bypass or new WAR command.
    if (targetId !== null && assessmentDecision.holdOffenseAgainst === targetId)
      return;

    // The planner knows only verified frontier IDs. Confirm adjacency again
    // at execution time; neither hidden armies nor off-map enemies are probed.
    const reachable = (id: string | null): boolean => {
      for (const border of player.borderTiles()) {
        let found = false;
        this.mg.forEachNeighbor(border, (tile) => {
          if (
            !found &&
            this.mg.isLand(tile) &&
            player.canAttack(tile) &&
            (id === null
              ? !this.mg.owner(tile).isPlayer()
              : this.mg.owner(tile).id() === id)
          ) {
            found = true;
          }
        });
        if (found) return true;
      }
      return false;
    };

    if (targetId === null) {
      if (
        observation.unownedFrontier !== true ||
        player.troops() < 20 ||
        !reachable(null)
      )
        return;
      this.mg.addExecution(
        new AttackExecution(
          Math.max(1, Math.floor(player.troops() / 5)),
          player,
          this.mg.terraNullius().id(),
        ),
      );
      return;
    }

    const war = liveNationalWarAuthority(this.mg);
    if (
      war === null ||
      player.troops() < 1000 ||
      !this.mg.hasPlayer(targetId) ||
      !this.mg.player(targetId).isAlive() ||
      !player.canAttackPlayer(this.mg.player(targetId)) ||
      !observation.frontiers.some((f) => f.targetId === targetId) ||
      !reachable(targetId)
    )
      return;

    if (sides.allies.has(targetId)) return;
    if (!sides.enemies.has(targetId)) {
      if (holdsNationalPeace(this.nationalPeaceMemory, targetId, ticks)) return;
      // The live Game authority returns a principal-bound accepted/rejected
      // receipt. Dispatch is NOT acceptance. Only E1's Game-owned journal
      // decides WAR legality; the E3 planner consumes that exact result.
      if (this.mg.nationalPoliticalAuthority()?.empireOf(player.id()) !== null)
        return;
      let outcome: ReturnType<Game["performNationalWarCommandWithOutcome"]>;
      try {
        outcome = this.mg.performNationalWarCommandWithOutcome(player, {
          kind: "declare-national",
          warId: "ai_" + simpleHash(player.id() + ":" + targetId + ":" + ticks),
          aggressorId: player.id(),
          targetId,
        });
      } catch {
        // Invalid actor/engine authority must never reach AttackExecution.
        return;
      }
      if (
        outcome.commandKind !== "national_declare_war" ||
        outcome.actorId !== player.id() ||
        outcome.recipientId !== player.id() ||
        outcome.commandTargetId !== targetId
      )
        return;
      // R10 E3 is merged. A rejected real Game outcome MUST reach the
      // sole E3 cooldown/replanning helper; silently skipping that bridge
      // is no longer a permitted state of the integrated game.
      this.nationalPlannerMemory = recordNationalWarOutcome(
        observation,
        this.nationalPlannerMemory ?? initialNationalPlannerMemory(player.id()),
        outcome,
      );
      if (!outcome.accepted) return;
    }
    if (!war.authorizeOffensiveAction(player.id(), targetId)) return;
    this.mg.addExecution(
      new AttackExecution(
        Math.max(1, Math.floor(player.troops() / 5)),
        player,
        targetId,
      ),
    );
  }

  private initializeBehaviors(): void {
    if (this.player === null) throw new Error("Player not initialized");

    this.emojiBehavior = new NationEmojiBehavior(
      this.random,
      this.mg,
      this.player,
    );
    this.mirvBehavior = new NationMIRVBehavior(
      this.random,
      this.mg,
      this.player,
      this.emojiBehavior,
    );
    this.allianceBehavior = new NationAllianceBehavior(
      this.random,
      this.mg,
      this.player,
      this.emojiBehavior,
    );
    this.warshipBehavior = new NationWarshipBehavior(
      this.random,
      this.mg,
      this.player,
      this.emojiBehavior,
    );
    this.attackBehavior = new NationAttackBehavior(
      this.random,
      this.mg,
      this.player,
      this.triggerRatio,
      this.reserveRatio,
      this.expandRatio,
      this.allianceBehavior,
      this.emojiBehavior,
      this.warshipBehavior,
    );
    this.nukeBehavior = new NationNukeBehavior(
      this.random,
      this.mg,
      this.player,
      this.attackBehavior,
      this.emojiBehavior,
    );
    this.structureBehavior = new NationStructureBehavior(
      this.random,
      this.mg,
      this.player,
    );
    this.behaviorsInitialized = true;
  }

  private randomSpawnLand(): TileRef | null {
    if (this.nation.spawnCell === undefined) throw new Error("not initialized");

    const delta = 25;
    let tries = 0;
    while (tries < 50) {
      tries++;
      const cell = this.nation.spawnCell;
      const x = this.random.nextInt(cell.x - delta, cell.x + delta);
      const y = this.random.nextInt(cell.y - delta, cell.y + delta);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (
        this.mg.isLand(tile) &&
        !this.mg.hasOwner(tile) &&
        !this.mg.isImpassable(tile)
      ) {
        if (
          this.mg.terrainType(tile) === TerrainType.Mountain &&
          this.random.chance(2)
        ) {
          continue;
        }
        return tile;
      }
    }
    return null;
  }

  private updateRelationsFromEmbargos() {
    const player = this.player;
    if (player === null) return;
    const others = this.mg.players().filter((p) => p.id() !== player.id());

    others.forEach((other: Player) => {
      const embargoMalus = -20;
      if (
        other.hasManualEmbargoAgainst(player) &&
        !this.embargoMalusApplied.has(other.id())
      ) {
        player.updateRelation(other, embargoMalus);
        this.embargoMalusApplied.add(other.id());
      } else if (
        !other.hasManualEmbargoAgainst(player) &&
        this.embargoMalusApplied.has(other.id())
      ) {
        player.updateRelation(other, -embargoMalus);
        this.embargoMalusApplied.delete(other.id());
      }
    });
  }

  private handleEmbargoesToHostileNations() {
    const player = this.player;
    if (player === null) return;
    const others = this.mg.players().filter((p) => p.id() !== player.id());
    const difficulty = this.mg.config().gameConfig().difficulty;
    const isHigherDifficulty =
      difficulty === Difficulty.Hard || difficulty === Difficulty.Impossible;
    const teamGame = this.mg.config().gameConfig().gameMode === GameMode.Team;

    others.forEach((other: Player) => {
      // In team games on higher difficulties, refuse to trade with anyone
      // not on this nation's team.
      if (
        teamGame &&
        isHigherDifficulty &&
        other.type() !== PlayerType.Bot &&
        !player.isOnSameTeam(other)
      ) {
        if (!player.hasEmbargoAgainst(other)) {
          player.addEmbargo(other, false);
        }
        return;
      }

      /* When player is hostile starts embargo. Do not stop until neutral again */
      if (
        player.relation(other) <= Relation.Hostile &&
        !player.hasEmbargoAgainst(other) &&
        !player.isOnSameTeam(other)
      ) {
        player.addEmbargo(other, false);
      } else if (
        player.relation(other) >= Relation.Neutral &&
        player.hasEmbargoAgainst(other) &&
        difficulty !== Difficulty.Hard &&
        difficulty !== Difficulty.Impossible
      ) {
        player.stopEmbargo(other);
      } else if (
        player.relation(other) >= Relation.Friendly &&
        player.hasEmbargoAgainst(other) &&
        difficulty !== Difficulty.Impossible
      ) {
        player.stopEmbargo(other);
      }
    });
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    // The nation is normally one of the game's own; store it by index so
    // identity survives. Dynamically created nations are stored inline.
    const nationIndex = w.game.nations().indexOf(this.nation);
    return NationExecutionSnapshot.write({
      active: this.active,
      gameID: this.gameID,
      nationIndex: nationIndex === -1 ? null : nationIndex,
      nation: nationIndex === -1 ? nationData(this.nation) : null,
      random: w.random(this.random),
      initialized: this.mg !== undefined,
      player: w.playerOrNull(this.player),
      attackRate: this.attackRate ?? null,
      attackTick: this.attackTick ?? null,
      triggerRatio: this.triggerRatio,
      reserveRatio: this.reserveRatio,
      expandRatio: this.expandRatio,
      embargoMalusApplied: [...this.embargoMalusApplied],
      spawnExecAdded: this.spawnExecAdded,
      nationalPlannerMemory:
        this.nationalPlannerMemory === null
          ? null
          : {
              // Stable explicit snapshot key order, irrespective of which
              // legal planner transition last spread the mutable memory.
              // Snapshot -> restore -> snapshot must be byte-identical.
              observerId: this.nationalPlannerMemory.observerId,
              objective: this.nationalPlannerMemory.objective,
              targetId: this.nationalPlannerMemory.targetId,
              nextPlanningTick: this.nationalPlannerMemory.nextPlanningTick,
              lastProcessedEvent:
                this.nationalPlannerMemory.lastProcessedEvent === null
                  ? null
                  : { ...this.nationalPlannerMemory.lastProcessedEvent },
              reputation: this.nationalPlannerMemory.reputation.map(
                (entry) => ({ ...entry }),
              ),
              ...(this.nationalPlannerMemory.rejectedWarTargets === undefined
                ? {}
                : {
                    rejectedWarTargets:
                      this.nationalPlannerMemory.rejectedWarTargets.map(
                        (entry) => ({ ...entry }),
                      ),
                  }),
              ...(this.nationalPlannerMemory.lastWarOutcomeSequence ===
              undefined
                ? {}
                : {
                    lastWarOutcomeSequence:
                      this.nationalPlannerMemory.lastWarOutcomeSequence,
                  }),
              ...(this.nationalPlannerMemory.political === undefined
                ? {}
                : {
                    political: {
                      ...this.nationalPlannerMemory.political,
                      completedCommands: [
                        ...this.nationalPlannerMemory.political
                          .completedCommands,
                      ],
                      rejectedCommands:
                        this.nationalPlannerMemory.political.rejectedCommands.map(
                          (entry) => ({ ...entry }),
                        ),
                      ...(this.nationalPlannerMemory.political.coercion ===
                      undefined
                        ? {}
                        : {
                            coercion: {
                              observerId:
                                this.nationalPlannerMemory.political.coercion
                                  .observerId,
                              processedOutcomeIds: [
                                ...this.nationalPlannerMemory.political.coercion
                                  .processedOutcomeIds,
                              ],
                              issuerCredibility:
                                this.nationalPlannerMemory.political.coercion.issuerCredibility.map(
                                  (entry) => ({ ...entry }),
                                ),
                              publicEmpireLand:
                                this.nationalPlannerMemory.political.coercion.publicEmpireLand.map(
                                  (entry) => ({ ...entry }),
                                ),
                            },
                          }),
                    },
                  }),
            },
      ...(this.nationalPeaceMemory === null
        ? {}
        : { nationalPeaceMemory: this.nationalPeaceMemory }),
      ...(this.nationalReconMemory === null
        ? {}
        : {
            nationalReconMemory: {
              observerId: this.nationalReconMemory.observerId,
              nextDecisionTick: this.nationalReconMemory.nextDecisionTick,
              attempts: this.nationalReconMemory.attempts.map((a) => ({
                ...a,
              })),
              lastDiscovery:
                this.nationalReconMemory.lastDiscovery === null
                  ? null
                  : { ...this.nationalReconMemory.lastDiscovery },
            },
          }),
      ...(this.nationalAssessmentMemory === null
        ? {}
        : {
            nationalAssessmentMemory: {
              observerId: this.nationalAssessmentMemory.observerId,
              nextDecisionTick: this.nationalAssessmentMemory.nextDecisionTick,
              attempts: this.nationalAssessmentMemory.attempts.map((a) => ({
                ...a,
              })),
            },
          }),
      // Omit entirely for legacy games and pre-economics snapshots; an
      // optional null field would needlessly mutate old snapshot bytes.
      ...(this.nationalEconomicMemory === null
        ? {}
        : {
            nationalEconomicMemory: {
              observerId: this.nationalEconomicMemory.observerId,
              processedDemandIds: [
                ...this.nationalEconomicMemory.processedDemandIds,
              ],
              credibility: this.nationalEconomicMemory.credibility.map(
                (entry) => ({ ...entry }),
              ),
            },
          }),
      nationalSightMemory:
        this.nationalSightMemory === null
          ? null
          : {
              observerId: this.nationalSightMemory.observerId,
              assets: this.nationalSightMemory.assets.map((asset) => ({
                ...asset,
              })),
            },
      behaviors: this.behaviorsInitialized
        ? {
            emoji: this.emojiBehavior.snapshot(w),
            mirv: this.mirvBehavior.snapshot(w),
            alliance: this.allianceBehavior.snapshot(w),
            warship: this.warshipBehavior.snapshot(w),
            attack: this.attackBehavior.snapshot(w),
            nuke: this.nukeBehavior.snapshot(w),
            structure: this.structureBehavior.snapshot(w),
          }
        : null,
    });
  }

  restoreSnapshot(s: NationState, r: SnapshotReader): void {
    this.active = s.active;
    this.gameID = s.gameID;
    if (s.nationIndex !== null) {
      this.nation = r.game.nations()[s.nationIndex];
    } else if (s.nation !== null) {
      const cell = s.nation.spawnCell;
      this.nation = new Nation(
        cell === null ? undefined : newCell(cell),
        readPlayerInfo(s.nation.playerInfo, r),
      );
    }
    // One PRNG shared with every behavior, as in a live game.
    const random = r.random(s.random);
    this.random = random;
    if (s.initialized) this.mg = r.game;
    this.player = r.playerOrNull(s.player);
    if (s.attackRate !== null) this.attackRate = s.attackRate;
    if (s.attackTick !== null) this.attackTick = s.attackTick;
    this.triggerRatio = s.triggerRatio;
    this.reserveRatio = s.reserveRatio;
    this.expandRatio = s.expandRatio;
    this.embargoMalusApplied = new Set(s.embargoMalusApplied);
    this.spawnExecAdded = s.spawnExecAdded;
    this.nationalPlannerMemory = s.nationalPlannerMemory;
    this.nationalSightMemory = s.nationalSightMemory;
    this.nationalEconomicMemory = s.nationalEconomicMemory ?? null;
    this.nationalReconMemory = s.nationalReconMemory ?? null;
    this.nationalAssessmentMemory = s.nationalAssessmentMemory ?? null;
    this.nationalPeaceMemory = s.nationalPeaceMemory ?? null;
    this.behaviorsInitialized = s.behaviors !== null;
    const b = s.behaviors;
    const player = this.player;
    if (b === null || player === null) return;
    const shell = <T extends object>(cls: { prototype: T }): T =>
      Object.create(cls.prototype) as T;
    const emoji = shell(NationEmojiBehavior);
    const mirv = shell(NationMIRVBehavior);
    const alliance = shell(NationAllianceBehavior);
    const warship = shell(NationWarshipBehavior);
    const attack = shell(NationAttackBehavior);
    const nuke = shell(NationNukeBehavior);
    const structure = shell(NationStructureBehavior);
    emoji.restoreSnapshot(b.emoji, r, random, player);
    mirv.restoreSnapshot(b.mirv, r, random, player, emoji);
    alliance.restoreSnapshot(b.alliance, r, random, player, emoji);
    warship.restoreSnapshot(b.warship, r, random, player, emoji);
    attack.restoreSnapshot(
      b.attack,
      r,
      random,
      player,
      alliance,
      emoji,
      warship,
    );
    nuke.restoreSnapshot(b.nuke, r, random, player, attack, emoji);
    structure.restoreSnapshot(b.structure, r, random, player);
    this.emojiBehavior = emoji;
    this.mirvBehavior = mirv;
    this.allianceBehavior = alliance;
    this.warshipBehavior = warship;
    this.attackBehavior = attack;
    this.nukeBehavior = nuke;
    this.structureBehavior = structure;
  }
}

// Each behavior is its own versioned record, so its layout can change
// without bumping this one.
const NationStateSchema = z.object({
  active: z.boolean(),
  gameID: z.string(),
  nationIndex: z.number().int().nonnegative().nullable(),
  nation: NationSchema.nullable(),
  random: zRandom(),
  initialized: z.boolean(),
  player: zPlayerRef().nullable(),
  attackRate: zNum().nullable(),
  attackTick: zNum().nullable(),
  triggerRatio: zNum(),
  reserveRatio: zNum(),
  expandRatio: zNum(),
  embargoMalusApplied: z.array(z.string()),
  spawnExecAdded: z.boolean(),
  nationalPlannerMemory: z
    .object({
      observerId: z.string(),
      objective: z.enum(["defend", "expand", "consolidate"]),
      targetId: z.string().nullable(),
      nextPlanningTick: z.number().int().nonnegative(),
      lastProcessedEvent: z
        .object({ tick: z.number(), id: z.string() })
        .nullable(),
      reputation: z.array(
        z.object({
          nationId: z.string(),
          credibility: z.number(),
          lastObservedTick: z.number(),
        }),
      ),
      // Optional fields retain R9 snapshot compatibility. E3's pure planner
      // controls the lifetime and semantics; execution only persists them.
      rejectedWarTargets: z
        .array(
          z.object({
            targetId: z.string(),
            retryAfterTick: z.number().int().nonnegative(),
          }),
        )
        .max(16)
        .optional(),
      lastWarOutcomeSequence: z.number().int().min(-1).optional(),
      political: z
        .object({
          nextPlanningTick: z.number().int().nonnegative(),
          lastOutcomeSequence: z.number().int().min(-1),
          completedCommands: z.array(z.string()).max(64),
          rejectedCommands: z
            .array(
              z.object({
                key: z.string(),
                retryAfterTick: z.number().int().nonnegative(),
              }),
            )
            .max(64),
          coercion: z
            .object({
              observerId: z.string(),
              processedOutcomeIds: z.array(z.string()).max(128),
              issuerCredibility: z
                .array(
                  z.object({
                    issuerId: z.string(),
                    score: z.number().int().min(-6).max(6),
                    lastObservedTick: z.number().int().nonnegative(),
                  }),
                )
                .max(16),
              publicEmpireLand: z
                .array(
                  z.object({
                    empireId: z.string(),
                    landPercent: z.number().nonnegative(),
                    lastObservedTick: z.number().int().nonnegative(),
                  }),
                )
                .max(16),
            })
            .optional(),
        })
        .optional(),
    })
    .nullable(),
  nationalPeaceMemory: NationalPeaceMemorySchema.optional(),
  nationalReconMemory: z
    .object({
      observerId: z.string(),
      nextDecisionTick: z.number().int().nonnegative(),
      attempts: z
        .array(
          z.object({
            targetId: z.string(),
            anchorAssetId: z.string(),
            requestId: z.string().min(1).max(128),
            purchasedTick: z.number().int().nonnegative(),
            expiresAtTick: z.number().int().nonnegative(),
            outcome: z.enum(["accepted", "rejected"]),
          }),
        )
        .max(4),
      lastDiscovery: z
        .object({
          targetId: z.string(),
          assetId: z.string(),
          kind: z.enum(["army", "warship", "transport"]),
          observedTick: z.number().int().nonnegative(),
          expiresAtTick: z.number().int().nonnegative(),
        })
        .nullable(),
    })
    .optional(),
  // Optional on existing v2 and legacy FFA snapshots; no version inflation.
  nationalAssessmentMemory: z
    .object({
      observerId: z.string(),
      nextDecisionTick: z.number().int().nonnegative(),
      attempts: z
        .array(
          z.object({
            targetId: z.string(),
            requestId: z.string().min(1).max(128),
            purchasedTick: z.number().int().nonnegative(),
            expiresAtTick: z.number().int().nonnegative(),
            outcome: z.enum(["accepted", "rejected"]),
          }),
        )
        .max(3),
    })
    .optional(),
  nationalEconomicMemory: z
    .object({
      observerId: z.string(),
      processedDemandIds: z.array(z.string()).max(128),
      credibility: z
        .array(
          z.object({
            issuerId: z.string(),
            score: z.number().int().min(-6).max(6),
            lastObservedTick: z.number().int().nonnegative(),
          }),
        )
        .max(16),
    })
    .nullable()
    .optional(),
  nationalSightMemory: z
    .object({
      observerId: z.string(),
      assets: z.array(
        z.object({
          id: z.string(),
          ownerId: z.string(),
          kind: z.enum([
            "army",
            "structure",
            "warship",
            "transport",
            "trade-ship",
          ]),
          x: z.number(),
          y: z.number(),
          lastSeenTick: z.number(),
          sourceNationId: z.string().optional(),
          reconExpiresAtTick: z.number().int().nonnegative().optional(),
        }),
      ),
    })
    .nullable(),
  behaviors: z
    .object({
      emoji: VersionedSchema,
      mirv: VersionedSchema,
      alliance: VersionedSchema,
      warship: VersionedSchema,
      attack: VersionedSchema,
      nuke: VersionedSchema,
      structure: VersionedSchema,
    })
    .nullable(),
});
type NationState = z.infer<typeof NationStateSchema>;

export const NationExecutionSnapshot = execSnapshotType({
  name: "Nation",
  version: 2,
  migrations: {
    1: (prior) => ({
      ...prior,
      nationalPlannerMemory: null,
      nationalSightMemory: null,
    }),
  },
  schema: NationStateSchema,
  cls: () => NationExecution,
});
