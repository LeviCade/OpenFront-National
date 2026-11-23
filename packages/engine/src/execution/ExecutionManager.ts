import {
  ClientID,
  GameID,
  StampedIntent,
  Turn,
} from "@openfront/engine-api/Schemas";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { simpleHash } from "@openfront/engine-lib/Util";
import { Execution, Game } from "../game/Game";
import { AllianceExtensionExecution } from "./alliance/AllianceExtensionExecution";
import { AllianceRejectExecution } from "./alliance/AllianceRejectExecution";
import { AllianceRequestExecution } from "./alliance/AllianceRequestExecution";
import { BreakAllianceExecution } from "./alliance/BreakAllianceExecution";
import { AttackExecution } from "./AttackExecution";
import { BoatRetreatExecution } from "./BoatRetreatExecution";
import { ConstructionExecution } from "./ConstructionExecution";
import { DeleteUnitExecution } from "./DeleteUnitExecution";
import { DonateGoldExecution } from "./DonateGoldExecution";
import { DonateTroopsExecution } from "./DonateTroopExecution";
import { EmbargoAllExecution } from "./EmbargoAllExecution";
import { EmbargoExecution } from "./EmbargoExecution";
import { EmojiExecution } from "./EmojiExecution";
import { MarkDisconnectedExecution } from "./MarkDisconnectedExecution";
import { MoveWarshipExecution } from "./MoveWarshipExecution";
import { NationalFoundEmpireExecution } from "./NationalFoundEmpireExecution";
import { NationalSanctionExecution } from "./NationalSanctionExecution";
import { NationalUltimatumExecution } from "./NationalUltimatumExecution";
import { NationalWarExecution } from "./NationalWarExecution";
import { NationExecution } from "./NationExecution";
import { NoOpExecution } from "./NoOpExecution";
import { PauseExecution } from "./PauseExecution";
import { QuickChatExecution } from "./QuickChatExecution";
import { RetreatExecution } from "./RetreatExecution";
import { SpawnExecution } from "./SpawnExecution";
import { TargetPlayerExecution } from "./TargetPlayerExecution";
import { TransportShipExecution } from "./TransportShipExecution";
import { TribeSpawner } from "./TribeSpawner";
import { UpgradeStructureExecution } from "./UpgradeStructureExecution";
import { PlayerSpawner } from "./utils/PlayerSpawner";

export class Executor {
  // private random = new PseudoRandom(999)
  private random: PseudoRandom;

  constructor(
    private mg: Game,
    private gameID_: GameID,
    private clientID: ClientID | undefined,
    // Purchased bot tribe names drawn for this game (GameStartInfo.tribes).
    private purchasedTribeNames: string[] = [],
  ) {
    // Add one to avoid id collisions with tribes.
    this.random = new PseudoRandom(simpleHash(gameID_) + 1);
  }

  gameID(): GameID {
    return this.gameID_;
  }

  createExecs(turn: Turn): Execution[] {
    return turn.intents.map((i) => this.createExec(i));
  }

  createExec(intent: StampedIntent): Execution {
    const player = this.mg.playerByClientID(intent.clientID);
    if (!player) {
      console.warn(`player with clientID ${intent.clientID} not found`);
      return new NoOpExecution();
    }

    // create execution
    switch (intent.type) {
      case "attack": {
        return new AttackExecution(
          intent.troops,
          player,
          intent.targetID,
          null,
          true,
          intent.clientID,
        );
      }
      case "national_imperial_administration":
        return new NationalFoundEmpireExecution(
          player,
          "",
          { kind: "imperial-administration", command: intent.command },
          intent.requestId,
          intent.clientID,
        );
      case "national_propose_pact_amendment":
        return new NationalFoundEmpireExecution(
          player,
          "",
          {
            kind: "propose-pact-amendment",
            pactId: intent.pactId,
            terms: intent.terms,
            administratorId: intent.administratorId,
          },
          intent.requestId,
          intent.clientID,
        );
      case "national_approve_pact_amendment":
        return new NationalFoundEmpireExecution(
          player,
          "",
          { kind: "approve-pact-amendment", pactId: intent.pactId },
          intent.requestId,
          intent.clientID,
        );
      case "national_expel_pact":
        return new NationalFoundEmpireExecution(
          player,
          "",
          {
            kind: "expel-pact",
            pactId: intent.pactId,
            memberId: intent.memberId,
          },
          intent.requestId,
          intent.clientID,
        );
      case "national_betray_pact":
        return new NationalFoundEmpireExecution(
          player,
          "",
          { kind: "betray-pact", pactId: intent.pactId },
          intent.requestId,
          intent.clientID,
        );
      case "national_found_pact":
        return new NationalFoundEmpireExecution(
          player,
          "",
          {
            kind: "found-pact",
            pactId: intent.pactId,
            name: intent.name,
            pactKind: intent.pactKind,
            terms: intent.terms,
          },
          intent.requestId,
          intent.clientID,
        );
      case "national_invite_pact":
        return new NationalFoundEmpireExecution(
          player,
          "",
          {
            kind: "invite-pact",
            pactId: intent.pactId,
            candidateId: intent.candidateId,
          },
          intent.requestId,
          intent.clientID,
        );
      case "national_accept_pact":
        return new NationalFoundEmpireExecution(
          player,
          "",
          { kind: "accept-pact", pactId: intent.pactId },
          intent.requestId,
          intent.clientID,
        );
      case "national_found_empire":
        // Authenticated actor comes ONLY from the stamped clientID above.
        // requestId is untrusted correlation metadata, never a principal.
        return new NationalFoundEmpireExecution(
          player,
          intent.empireId,
          null,
          intent.requestId ?? null,
          intent.clientID,
        );
      case "national_offer_empire":
        return new NationalFoundEmpireExecution(
          player,
          "",
          {
            kind: "offer-empire",
            empireId: intent.empireId,
            candidateId: intent.candidateId,
          },
          intent.requestId ?? null,
          intent.clientID,
        );
      case "national_accept_empire":
        return new NationalFoundEmpireExecution(
          player,
          "",
          {
            kind: "accept-empire",
            empireId: intent.empireId,
            candidateId: intent.candidateId,
          },
          intent.requestId ?? null,
          intent.clientID,
        );
      case "national_transfer_crown":
        return new NationalFoundEmpireExecution(
          player,
          "",
          {
            kind: "transfer-crown",
            empireId: intent.empireId,
            successorId: intent.successorId,
          },
          intent.requestId ?? null,
          intent.clientID,
        );
      case "national_set_peace_delegation":
        // The stamped clientID has ALREADY resolved the trusted actor above.
        // The named empire/member are requested targets, never credentials.
        return new NationalFoundEmpireExecution(
          player,
          "",
          {
            kind: "set-national-peace-delegation",
            empireId: intent.empireId,
            memberId: intent.memberId,
            enabled: intent.enabled,
          },
          intent.requestId ?? null,
          intent.clientID,
        );
      case "national_issue_sanction":
      case "national_respond_sanction":
      case "national_resolve_sanction":
        return new NationalSanctionExecution(player, intent, intent.clientID);
      case "national_issue_ultimatum":
      case "national_respond_ultimatum":
      case "national_resolve_ultimatum":
        return new NationalUltimatumExecution(player, intent, intent.clientID);
      case "national_declare_war":
        return new NationalWarExecution(
          player,
          intent.scope === "national"
            ? {
                kind: "declare-national",
                nationId: intent.nationId,
                targetId: intent.targetId,
              }
            : {
                kind: "declare-imperial",
                targetKind: intent.targetKind,
                targetId: intent.targetId,
              },
          intent.requestId ?? null,
          intent.clientID,
        );
      case "national_propose_peace":
        return new NationalWarExecution(
          player,
          { kind: "propose-peace", warId: intent.warId },
          intent.requestId ?? null,
          intent.clientID,
        );
      case "national_accept_peace":
        return new NationalWarExecution(
          player,
          { kind: "accept-peace", motionId: intent.motionId },
          intent.requestId ?? null,
          intent.clientID,
        );
      case "cancel_attack":
        return new RetreatExecution(player, intent.attackID);
      case "cancel_boat":
        return new BoatRetreatExecution(player, intent.unitID);
      case "move_warship":
        return new MoveWarshipExecution(player, intent.unitIds, intent.tile);
      case "spawn":
        // fromIntent: this one came off the wire, so it is subject to the
        // spawn-phase gate that internal spawns are not.
        return new SpawnExecution(
          this.gameID_,
          player.info(),
          intent.tile,
          true,
        );
      case "boat":
        return new TransportShipExecution(player, intent.dst, intent.troops);
      case "allianceRequest":
        return new AllianceRequestExecution(player, intent.recipient);
      case "allianceReject":
        return new AllianceRejectExecution(intent.requestor, player);
      case "breakAlliance":
        return new BreakAllianceExecution(player, intent.recipient);
      case "targetPlayer":
        return new TargetPlayerExecution(player, intent.target);
      case "emoji":
        return new EmojiExecution(player, intent.recipient, intent.emoji);
      case "donate_troops":
        return new DonateTroopsExecution(
          player,
          intent.recipient,
          intent.troops,
        );
      case "donate_gold":
        return new DonateGoldExecution(player, intent.recipient, intent.gold);
      case "embargo":
        return new EmbargoExecution(
          player,
          intent.targetID,
          intent.action,
          intent.clientID,
        );
      case "embargo_all":
        return new EmbargoAllExecution(player, intent.action, intent.clientID);
      case "build_unit":
        return new ConstructionExecution(
          player,
          intent.unit,
          intent.tile,
          intent.rocketDirectionUp,
          intent.amount,
        );
      case "allianceExtension": {
        return new AllianceExtensionExecution(player, intent.recipient);
      }

      case "upgrade_structure":
        return new UpgradeStructureExecution(
          player,
          intent.unitId,
          intent.amount,
        );
      case "delete_unit":
        return new DeleteUnitExecution(player, intent.unitId);
      case "quick_chat":
        return new QuickChatExecution(
          player,
          intent.recipient,
          intent.quickChatKey,
          intent.target,
        );
      case "mark_disconnected":
        return new MarkDisconnectedExecution(player, intent.isDisconnected);
      case "toggle_pause":
        return new PauseExecution(player, intent.paused);
      default:
        throw new Error(`intent type ${intent} not found`);
    }
  }

  spawnTribes(numTribes: number): SpawnExecution[] {
    const nationCells = this.mg
      .nations()
      .map((n) => n.spawnCell)
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
    return new TribeSpawner(this.mg, this.gameID_, nationCells).spawnTribes(
      numTribes,
      this.purchasedTribeNames,
    );
  }

  spawnPlayers(): SpawnExecution[] {
    return new PlayerSpawner(this.mg, this.gameID_).spawnPlayers();
  }

  nationExecutions(): Execution[] {
    const execs: Execution[] = [];
    for (const nation of this.mg.nations()) {
      execs.push(new NationExecution(this.gameID_, nation));
    }
    return execs;
  }
}
