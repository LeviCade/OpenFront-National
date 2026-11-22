import { GameType, UnitType } from "@openfront/engine-api/game/GameTypes";
import type { NationalImperialAdministrationView } from "@openfront/engine-api/game/NationalImperialView";
import type { NationalPactTerms } from "@openfront/engine-api/game/NationalPactView";
import type { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { NationalMapTargetSelectedEvent } from "./controllers/NationalMapTargetController";
import {
  confirmedNationalDiplomacy,
  createNationalDiplomacyRequestId,
  createNationalFoundingRequestId,
  createNationalPoliticalRequestId,
  empireForMember,
  foundingUnavailableReason,
  nationalWarActionUnavailableReason,
  reconcileNationalFounding,
  validEmpireId,
  validNationalWarReference,
  type NationalDiplomacyAttempt,
  type NationalDiplomacyResult,
  type NationalPublicWarLayer,
  type NationalPublicPeaceMotion,
  type NationalFoundingAttempt,
  type NationalPoliticalAction,
} from "./NationalDiplomacyState";
import {
  imperialConstructionCategories,
  imperialPolicyIntentAvailable,
  imperialPolicyKey,
  parseImperialCommand,
  type ImperialPolicyCommand,
} from "./NationalImperialState";
import {
  pactActionAllowed,
  pactConsentKey,
  reconcilePactReceipt,
  type PactAction,
  type PactContext,
  type PactIntent,
} from "./NationalPactState";
import { hasTrustedNationalPrivateCapability } from "./NationalPrivateCapability";
import { GoToPlayerEvent } from "./TransformHandler";
import {
  SendNationalPactIntentEvent,
  SendNationalImperialPolicyIntentEvent,
  SendNationalAcceptPeaceIntentEvent,
  SendNationalAcceptEmpireIntentEvent,
  SendNationalOfferEmpireIntentEvent,
  SendNationalTransferCrownIntentEvent,
  SendNationalDeclareWarIntentEvent,
  SendNationalFoundEmpireIntentEvent,
  SendNationalProposePeaceIntentEvent,
} from "./Transport";
import type { GameView } from "./view";

/**
 * NATIONAL's first player-facing sovereignty screen. This component only
 * reads public game packets. Clicking sends the existing authenticated intent;
 * it does not award sovereignty, invent memberships, or claim success.
 */
@customElement("national-diplomacy-panel")
export class NationalDiplomacyPanel extends LitElement {
  @property({ attribute: false }) public game: GameView | null = null;
  @property({ attribute: false }) public eventBus: EventBus | null = null;

  @state() private expanded = false;
  @state() private draftEmpireId = "";
  @state() private pendingEmpireId: string | null = null;
  private pendingAttempt: NationalFoundingAttempt | null = null;
  private lastConfirmedEmpireId: string | null = null;
  @state() private phase:
    | "idle"
    | "pending"
    | "accepted"
    | "rejected"
    | "unknown" = "idle";
  @state() private message: string | null = null;
  @state() private error: string | null = null;
  @state() private warScope: "national" | "imperial" = "national";
  @state() private warTargetKind: "nation" | "empire" = "nation";
  @state() private warTargetId = "";
  @state() private warIdDraft = "";
  @state() private motionIdDraft = "";
  @state() private diplomacyStatus: string | null = null;
  @state() private diplomacyError: string | null = null;
  private lastDiplomacySubmission:
    | (NationalDiplomacyAttempt & {
        gameId: string;
        tick: number;
        requestId: string;
      })
    | null = null;
  @state() private accessionCandidateId = "";
  @state() private requestedAccessionEmpireId = "";
  @state() private chosenInvitation = "";
  @state() private crownSuccessorId = "";
  @state() private politicalStatus: string | null = null;
  @state() private politicalError: string | null = null;
  private lastPoliticalSubmission: {
    gameId: string;
    actorId: string;
    issuedTick: number;
    requestId: string;
    type: NationalPoliticalAction;
    empireId: string;
    targetId: string;
  } | null = null;
  private confirmedDiplomacy: {
    gameId: string;
    actorId: string;
    type: NationalDiplomacyResult["type"];
    warId: string;
    motionId?: string;
  } | null = null;

  createRenderRoot() {
    return this;
  }

  /**
   * Only an accepted E1 journal result AND current E3 public roster can
   * confirm this button click; a restored roster by itself proves membership.
   */
  public refresh(): void {
    this.refreshPact();
    this.refreshImperialPolicy();
    const game = this.game;
    const player = game?.myPlayer();
    const politics = game?.nationalPolitics() ?? null;
    const member = player ? empireForMember(politics, player.id()) : null;
    if (
      this.lastConfirmedEmpireId &&
      member?.id !== this.lastConfirmedEmpireId
    ) {
      this.lastConfirmedEmpireId = null;
      this.message = null;
      this.phase = "idle";
    }

    // On a phone the diplomacy sheet must never cover the first map tap.
    // A player can reopen it immediately after the real spawn is observed.
    if (
      game?.inSpawnPhase() &&
      this.expanded &&
      typeof window !== "undefined" &&
      window.innerWidth <= 640
    ) {
      this.expanded = false;
    }

    const attempt = this.pendingAttempt;
    if (attempt && game?.config().isReplay()) {
      this.pendingAttempt = null;
      this.pendingEmpireId = null;
      this.phase = "unknown";
      this.message =
        "Replay is read-only. The previous founding request is not confirmed.";
      this.error = null;
    } else if (attempt && game && player) {
      const tick = typeof game.ticks === "function" ? game.ticks() : 0;
      const results =
        typeof game.nationalFoundingResults === "function"
          ? game.nationalFoundingResults()
          : game.nationalFoundingOutcome()
            ? [game.nationalFoundingOutcome()!]
            : [];
      const decision = reconcileNationalFounding(attempt, {
        gameId: game.gameID?.() ?? "",
        actorId: player.id(),
        tick,
        politics,
        results,
      });
      if (decision.phase === "pending") {
        this.pendingAttempt = {
          ...attempt,
          acceptedResultSeen: decision.acceptedResultSeen,
        };
      } else {
        this.pendingAttempt = null;
        this.pendingEmpireId = null;
        this.phase = decision.phase;
        if (
          decision.phase === "accepted" &&
          (game.isSpectator() || !player.isAlive() || game.inSpawnPhase())
        ) {
          // The command receipt is real, but a now-inactive principal cannot
          // receive a player-facing active founding success toast.
          this.phase = "unknown";
          this.message =
            "Founding was accepted previously, but the active nation has changed. Check the current roster.";
          this.error = null;
        } else if (decision.phase === "accepted") {
          this.lastConfirmedEmpireId = attempt.empireId;
          this.message = `Confirmed by game: your nation founded ${attempt.empireId}.`;
          this.error = null;
        } else if (decision.phase === "rejected") {
          this.message = null;
          this.error = decision.reason;
        } else {
          this.message = decision.reason;
          this.error = null;
        }
      }
    }
    const prior = this.confirmedDiplomacy;
    if (prior) {
      const view = game?.nationalConflicts?.() ?? null;
      const layer = view?.layers.find((item) => item.id === prior.warId);
      const motion = view?.motions.find((item) => item.id === prior.motionId);
      if (
        game?.gameID() !== prior.gameId ||
        player?.id() !== prior.actorId ||
        game?.config().isReplay() ||
        game?.isSpectator() ||
        player?.isAlive() !== true ||
        game?.inSpawnPhase() ||
        !layer
      ) {
        this.confirmedDiplomacy = null;
        this.diplomacyStatus =
          "Current authoritative WAR state no longer verifies the previous action.";
      } else if (
        (prior.type === "national_declare_war" && layer.endedTick !== null) ||
        (prior.type === "national_propose_peace" &&
          (!motion || motion.acceptedTick !== null)) ||
        (prior.type === "national_accept_peace" &&
          (!motion ||
            motion.acceptedTick === null ||
            layer.endedTick !== motion.acceptedTick))
      ) {
        this.confirmedDiplomacy = null;
        this.diplomacyStatus =
          "The previously confirmed WAR or peace motion has since changed. Review current conflicts.";
      }
    }
    const submission = this.lastDiplomacySubmission;
    if (submission) {
      const tick = game?.ticks() ?? -1;
      if (
        !game ||
        !player ||
        game.gameID() !== submission.gameId ||
        player.id() !== submission.actorId ||
        game.config().isReplay() ||
        game.isSpectator() ||
        !player.isAlive() ||
        game.inSpawnPhase() ||
        tick < submission.tick
      ) {
        this.lastDiplomacySubmission = null;
        this.diplomacyStatus =
          "The active game or principal changed. Previous diplomacy is unconfirmed.";
      } else {
        const results =
          typeof game.nationalDiplomacyResults === "function"
            ? game.nationalDiplomacyResults()
            : [];
        const matched = results.filter(
          (result) =>
            result.requestId === submission.requestId &&
            result.type === submission.commandType &&
            result.actorId === submission.actorId &&
            result.recipientId === submission.actorId &&
            Number.isSafeInteger(result.sequence) &&
            result.sequence >= 0 &&
            result.tick >= submission.tick &&
            result.tick <= tick,
        );
        const result = matched[0];
        if (
          result &&
          matched.some(
            (entry) =>
              entry.sequence !== result.sequence ||
              entry.accepted !== result.accepted ||
              entry.tick !== result.tick ||
              entry.warId !== result.warId ||
              entry.motionId !== result.motionId ||
              entry.reason !== result.reason,
          )
        ) {
          this.lastDiplomacySubmission = null;
          this.diplomacyStatus = null;
          this.diplomacyError =
            "Conflicting authenticated diplomacy receipts. No action is confirmed.";
        } else if (result && !result.accepted) {
          this.lastDiplomacySubmission = null;
          this.diplomacyStatus = null;
          this.diplomacyError = `The game rejected this diplomacy action: ${result.reason ?? "political-rule"}.`;
        } else if (result?.accepted) {
          const confirmed = confirmedNationalDiplomacy(
            submission,
            result,
            game.nationalConflicts?.() ?? null,
            game.nationalConflictsTick?.() ?? null,
          );
          if (confirmed) {
            this.lastDiplomacySubmission = null;
            this.confirmedDiplomacy = {
              gameId: submission.gameId,
              actorId: submission.actorId,
              type: result.type,
              warId: result.warId!,
              ...(result.motionId ? { motionId: result.motionId } : {}),
            };
            this.diplomacyStatus = confirmed;
            this.diplomacyError = null;
          } else if (tick - submission.tick >= 200) {
            this.lastDiplomacySubmission = null;
            this.diplomacyStatus =
              "Accepted receipt could not be reconciled with authoritative WAR/peace state. Outcome remains unconfirmed.";
          } else {
            this.diplomacyStatus =
              "Authenticated positive command receipt received; authoritative public war/peace state is not yet available. No completed action is confirmed.";
          }
        } else if (tick - submission.tick >= 200) {
          this.lastDiplomacySubmission = null;
          this.diplomacyStatus =
            "No authenticated diplomacy result arrived. Outcome is unknown; inspect the game before resubmitting.";
        }
      }
    }
    const political = this.lastPoliticalSubmission;
    if (political) {
      const tick = game?.ticks() ?? -1;
      const actor = game?.myPlayer();
      if (
        !game ||
        !actor ||
        game.gameID() !== political.gameId ||
        actor.id() !== political.actorId ||
        game.config().isReplay() ||
        game.isSpectator() ||
        !actor.isAlive() ||
        game.inSpawnPhase() ||
        tick < political.issuedTick
      ) {
        this.lastPoliticalSubmission = null;
        this.politicalStatus =
          "Political session or principal changed. The prior action is unconfirmed.";
      } else {
        const relevant = (game.nationalPoliticalResults?.() ?? []).filter(
          (result) =>
            result.requestId === political.requestId &&
            result.type === political.type &&
            result.actorId === political.actorId &&
            result.recipientId === political.actorId &&
            result.commandTargetId === political.empireId &&
            result.tick >= political.issuedTick &&
            result.tick <= tick &&
            Number.isSafeInteger(result.sequence),
        );
        const result = relevant[0];
        if (
          result &&
          relevant.some(
            (item) =>
              item.sequence !== result.sequence ||
              item.accepted !== result.accepted ||
              item.tick !== result.tick ||
              item.reason !== result.reason,
          )
        ) {
          this.lastPoliticalSubmission = null;
          this.politicalStatus = null;
          this.politicalError =
            "Conflicting political receipts; no action is confirmed.";
        } else if (result?.accepted === false) {
          this.lastPoliticalSubmission = null;
          this.politicalStatus = null;
          this.politicalError = `The game rejected this political action: ${result.reason}.`;
        } else if (result?.accepted === true) {
          const empire = politics?.empires.find(
            (item) => item.id === political.empireId,
          );
          const fresh =
            (game.nationalPoliticsTick?.() ?? null) !== null &&
            (game.nationalPoliticsTick?.() ?? -1) >= result.tick;
          const confirmed =
            fresh &&
            (political.type === "national_offer_empire"
              ? political.targetId === political.actorId
                ? empire !== undefined
                : empire?.leaderId === political.actorId
              : political.type === "national_accept_empire"
                ? empire?.memberIds.includes(political.targetId) === true
                : empire?.leaderId === political.targetId &&
                  empire.memberIds.includes(political.actorId));
          if (confirmed) {
            this.lastPoliticalSubmission = null;
            this.politicalError = null;
            this.politicalStatus =
              political.type === "national_offer_empire"
                ? political.targetId === political.actorId
                  ? `Game accepted your request to join ${political.empireId}. Only the emperor can verify delivery; membership is not confirmed.`
                  : `Game accepted accession offer command for ${this.playerName(political.targetId)}. Only the recipient can verify delivery of the invitation.`
                : political.type === "national_accept_empire"
                  ? political.targetId === political.actorId
                    ? `Confirmed by game: your nation joined ${political.empireId}.`
                    : `Confirmed by game: ${this.playerName(political.targetId)} joined ${political.empireId}.`
                  : `Confirmed by game: ${this.playerName(political.targetId)} now leads ${political.empireId}. Your emperor powers have ended.`;
          } else if (tick - political.issuedTick >= 200) {
            this.lastPoliticalSubmission = null;
            this.politicalStatus =
              "The game accepted the request but a matching fresh political roster did not arrive. Outcome is unconfirmed.";
          } else {
            this.politicalStatus =
              "Accepted political receipt seen; waiting for authoritative current membership and leadership.";
          }
        } else if (tick - political.issuedTick >= 200) {
          this.lastPoliticalSubmission = null;
          this.politicalStatus =
            "No authenticated political receipt arrived. The outcome is unknown.";
        }
      }
    }
    // A transfer or accession can revoke an imperial target's eligibility
    // immediately. Never leave a stale visual target on the live map.
    const currentWarKind =
      this.warScope === "national" ? "nation" : this.warTargetKind;
    if (
      this.warTargetId &&
      !this.warTargets(currentWarKind).some(
        (target) => target.id === this.warTargetId,
      )
    ) {
      this.selectWarTarget("");
    }
    if (this.expanded) this.requestUpdate();
  }

  /** A dropped or replaced session must never retain optimistic success. */
  public connectionInterrupted(): void {
    this.pactAttempt = null;
    this.pactPhase = "unknown";
    this.pactSession = null;
    this.pactStatus = "Connection interrupted; outcome unconfirmed.";
    this.imperialAttempt = null;
    this.imperialStatus = "Connection interrupted; policy outcome unconfirmed.";
    this.selectWarTarget("");
    if (this.confirmedDiplomacy !== null) {
      this.confirmedDiplomacy = null;
      this.diplomacyStatus =
        "Connection interrupted. Current WAR state must be verified again.";
    }
    if (this.lastDiplomacySubmission !== null) {
      this.lastDiplomacySubmission = null;
      this.diplomacyStatus =
        "Connection interrupted. Previous diplomacy has no confirmed result.";
      this.diplomacyError = null;
    }
    if (this.lastPoliticalSubmission !== null) {
      this.lastPoliticalSubmission = null;
      this.politicalStatus =
        "Connection interrupted; political acceptance cannot be confirmed.";
      this.politicalError = null;
    }
    if (this.pendingAttempt === null) {
      this.requestUpdate();
      return;
    }
    this.pendingAttempt = null;
    this.pendingEmpireId = null;
    this.phase = "unknown";
    this.message =
      "Connection interrupted. Founding is unconfirmed; check the game roster after reconnecting.";
    this.error = null;
    this.requestUpdate();
  }

  private get memberEmpire() {
    const player = this.game?.myPlayer();
    return player
      ? empireForMember(this.game?.nationalPolitics() ?? null, player.id())
      : null;
  }

  /** A Private lobby flag is NOT server authorization. */
  private get trustedPrivateCommandsReady(): boolean {
    const game = this.game;
    if (!game || game.config().isReplay() || game.isSpectator()) return false;
    if (
      game.isTrustedNationalProjection?.() === true &&
      game.trustedProjectionReady?.() !== true
    )
      return false;
    const cfg = game.config().gameConfig();
    return (
      cfg.nationalMode === true &&
      cfg.gameType === GameType.Private &&
      hasTrustedNationalPrivateCapability(this.eventBus, game.gameID())
    );
  }

  private get unavailableReason(): string | null {
    const game = this.game;
    const player = game?.myPlayer();
    return foundingUnavailableReason({
      national: game?.config().gameConfig().nationalMode === true,
      solo: game?.config().gameConfig().gameType === GameType.Singleplayer,
      trustedPrivate: this.trustedPrivateCommandsReady,
      replay: game?.config().isReplay() === true,
      spawned:
        player !== null &&
        player !== undefined &&
        game?.inSpawnPhase() === false &&
        player.numTilesOwned() > 0,
      alive: player?.isAlive() === true,
      spectator: game?.isSpectator() === true,
      memberEmpire: this.memberEmpire,
      pending: this.pendingEmpireId !== null,
    });
  }

  private submitFounding(event: SubmitEvent): void {
    event.preventDefault();
    const reason = this.unavailableReason;
    if (reason !== null) {
      this.error = reason;
      return;
    }
    const empireId = this.draftEmpireId.trim();
    if (!validEmpireId(empireId)) {
      this.error =
        "Enter 1–64 letters, numbers, underscores or hyphens for the empire ID.";
      return;
    }
    if (!this.eventBus) {
      this.error = "The game command channel is not ready.";
      return;
    }

    const game = this.game;
    const player = game?.myPlayer();
    if (!game || !player) {
      this.error = "There is no active player to authorize founding.";
      return;
    }
    // Cryptographic uniqueness is required; if the browser cannot generate
    // a secure token the command is NOT sent and no pending receipt is set.
    let requestId: string;
    try {
      requestId = createNationalFoundingRequestId();
    } catch {
      this.error =
        "Secure command identification is unavailable. Founding was not sent.";
      this.phase = "unknown";
      return;
    }
    this.pendingAttempt = {
      requestId,
      gameId: game.gameID?.() ?? "",
      actorId: player.id(),
      empireId,
      issuedTick: typeof game.ticks === "function" ? game.ticks() : 0,
      acceptedResultSeen: false,
    };
    this.pendingEmpireId = empireId;
    this.lastConfirmedEmpireId = null;
    this.phase = "pending";
    this.error = null;
    // EventBus delivery is a local UI action, not proof that Transport's
    // intent gate, LocalServer, or GameRunner accepted the command.
    this.message =
      "Founding submitted from the interface. Engine delivery and outcome are unverified.";
    try {
      this.eventBus.emit(
        new SendNationalFoundEmpireIntentEvent(empireId, requestId),
      );
    } catch {
      // Only a synchronous producer failure may clear the local latch.
      // An enqueued command is never equated with a successful execution.
      this.pendingAttempt = null;
      this.pendingEmpireId = null;
      this.phase = "unknown";
      this.message = null;
      this.error = "Could not send the founding command to the game.";
    }
  }

  private get warUnavailableReason(): string | null {
    const game = this.game;
    const player = game?.myPlayer();
    return nationalWarActionUnavailableReason({
      national: game?.config().gameConfig().nationalMode === true,
      solo: game?.config().gameConfig().gameType === GameType.Singleplayer,
      trustedPrivate: this.trustedPrivateCommandsReady,
      replay: game?.config().isReplay() === true,
      spawned:
        player !== null &&
        player !== undefined &&
        game?.inSpawnPhase() === false &&
        player.numTilesOwned() > 0,
      alive: player?.isAlive() === true,
      spectator: game?.isSpectator() === true,
      hasPublicPolitics: game?.nationalPolitics() !== null,
    });
  }

  /** Only actual living game players or E1-public empires are selectable. */
  private warTargets(
    kind: "nation" | "empire",
  ): readonly { id: string; name: string }[] {
    const game = this.game;
    const actor = game?.myPlayer();
    if (!game || !actor) return [];
    const ownEmpire = this.memberEmpire;
    if (kind === "empire") {
      return (game.nationalPolitics()?.empires ?? [])
        .filter((empire) => empire.id !== ownEmpire?.id)
        .map((empire) => ({ id: empire.id, name: empire.id }));
    }
    return game
      .players()
      .filter(
        (player) =>
          player.id() !== actor.id() &&
          player.isAlive() &&
          player.numTilesOwned() > 0 &&
          !ownEmpire?.memberIds.includes(player.id()),
      )
      .map((player) => ({ id: player.id(), name: player.name() }));
  }

  /** Only journal plus current recipient-bound projection can confirm. */
  private sendDiplomacyCommand(
    command: (
      requestId: string,
    ) =>
      | SendNationalDeclareWarIntentEvent
      | SendNationalProposePeaceIntentEvent
      | SendNationalAcceptPeaceIntentEvent,
    description: string,
    commandType: NationalDiplomacyResult["type"],
    context: Omit<
      NationalDiplomacyAttempt,
      "commandType" | "actorId" | "issuedTick"
    > = {},
  ): void {
    const reason = this.warUnavailableReason;
    const game = this.game;
    const player = game?.myPlayer();
    if (reason || !game || !player || !this.eventBus) {
      this.diplomacyError =
        reason ?? "The authenticated game channel is unavailable.";
      return;
    }
    const tick = game.ticks();
    if (this.lastDiplomacySubmission !== null) {
      this.diplomacyError =
        "A diplomacy command is still pending authoritative confirmation.";
      return;
    }
    let requestId: string;
    try {
      requestId = createNationalDiplomacyRequestId();
    } catch {
      this.diplomacyError =
        "Secure request identity is unavailable. No diplomacy command was sent.";
      return;
    }
    try {
      this.eventBus.emit(command(requestId));
      this.lastDiplomacySubmission = {
        gameId: game.gameID(),
        actorId: player.id(),
        tick,
        requestId,
        commandType,
        issuedTick: tick,
        ...context,
      };
      this.confirmedDiplomacy = null;
      // An EventBus producer does not prove that an intent gate, worker or
      // E1 accepted this action. Exact request receipts are still pending E1/E3.
      this.diplomacyStatus = `${description} handed to the command producer (request ${requestId}). Delivery and authoritative outcome remain unconfirmed; no success is confirmed.`;
      this.diplomacyError = null;
    } catch {
      this.diplomacyError = "The diplomacy command could not be submitted.";
    }
  }

  private submitWar(event: SubmitEvent): void {
    event.preventDefault();
    const game = this.game;
    const actor = game?.myPlayer();
    if (!game || !actor || this.warUnavailableReason) {
      this.diplomacyError =
        this.warUnavailableReason ?? "No authorized player is available.";
      return;
    }
    const ownEmpire = this.memberEmpire;
    if (
      this.warScope === "imperial" &&
      (!ownEmpire || ownEmpire.leaderId !== actor.id())
    ) {
      this.diplomacyError =
        "Only the current emperor may declare imperial war.";
      return;
    }
    const kind = this.warScope === "national" ? "nation" : this.warTargetKind;
    if (
      !validNationalWarReference(this.warTargetId) ||
      !this.warTargets(kind).some((target) => target.id === this.warTargetId)
    ) {
      this.diplomacyError =
        "Choose a living, eligible target from the current game roster.";
      return;
    }
    this.sendDiplomacyCommand(
      (requestId) =>
        new SendNationalDeclareWarIntentEvent(
          this.warScope,
          actor.id(),
          this.warTargetId,
          kind,
          requestId,
        ),
      `${this.warScope === "imperial" ? "Imperial" : "National"} war declaration`,
      "national_declare_war",
      {
        scope: this.warScope,
        ownEmpireId: ownEmpire?.id,
        targetKind: kind,
        targetId: this.warTargetId,
      },
    );
  }

  /** Candidate visibility is NOT a replacement for E1's authority checks. */
  /** A sender is not allowed to read invitation packets for its recipient. */
  private get accessionOffers() {
    const actorId = this.game?.myPlayer()?.id();
    const view = this.game?.nationalAccessionOffers?.() ?? null;
    return view && view.recipientId === actorId ? view.offers : [];
  }

  /** Independent candidates can ask the actual current emperor to admit them. */
  private requestableAccessionEmpires(): readonly {
    id: string;
    leaderName: string;
  }[] {
    const game = this.game;
    const actor = game?.myPlayer();
    if (!game || !actor || this.memberEmpire !== null) return [];
    return (game.nationalPolitics()?.empires ?? [])
      .filter(
        (empire) =>
          !empire.memberIds.includes(actor.id()) &&
          game
            .players()
            .some(
              (player) =>
                player.id() === empire.leaderId &&
                player.isAlive() &&
                player.numTilesOwned() > 0,
            ),
      )
      .map((empire) => ({
        id: empire.id,
        leaderName: this.playerName(empire.leaderId),
      }));
  }

  private accessionCandidates(): readonly { id: string; name: string }[] {
    const actor = this.game?.myPlayer();
    const empire = this.memberEmpire;
    if (!actor || !empire || empire.leaderId !== actor.id()) return [];
    return this.game!.players()
      .filter(
        (player) =>
          player.id() !== actor.id() &&
          player.isAlive() &&
          player.numTilesOwned() > 0 &&
          !this.game!.nationalPolitics()?.empires.some((item) =>
            item.memberIds.includes(player.id()),
          ),
      )
      .map((player) => ({ id: player.id(), name: player.name() }));
  }

  private crownSuccessors(): readonly { id: string; name: string }[] {
    const actor = this.game?.myPlayer();
    const empire = this.memberEmpire;
    if (!actor || !empire || empire.leaderId !== actor.id()) return [];
    return this.game!.players()
      .filter(
        (player) =>
          player.id() !== actor.id() &&
          empire.memberIds.includes(player.id()) &&
          player.isAlive() &&
          player.numTilesOwned() > 0,
      )
      .map((player) => ({ id: player.id(), name: player.name() }));
  }

  private submitPolitical(
    event: SubmitEvent,
    action: NationalPoliticalAction,
  ): void {
    event.preventDefault();
    const game = this.game;
    const actor = game?.myPlayer();
    const reason = this.warUnavailableReason;
    if (reason || !game || !actor || !this.eventBus) {
      this.politicalError =
        reason ?? "The authenticated game channel is unavailable.";
      return;
    }
    if (this.lastPoliticalSubmission !== null) {
      this.politicalError =
        "A political request is awaiting an authoritative outcome.";
      return;
    }
    const ownEmpire = this.memberEmpire;
    let empireId: string;
    let targetId: string;
    if (action === "national_accept_empire") {
      const offer = this.accessionOffers.find(
        (item) =>
          `${item.empireId}:${item.candidateId}` === this.chosenInvitation,
      );
      const candidateAccepts =
        offer?.candidateId === actor.id() && ownEmpire === null;
      const emperorAccepts =
        offer?.proposerId === offer?.candidateId &&
        offer?.candidateId !== actor.id() &&
        ownEmpire?.id === offer?.empireId &&
        ownEmpire?.leaderId === actor.id();
      if (!offer || (!candidateAccepts && !emperorAccepts)) {
        this.politicalError =
          "Choose an authenticated invitation you are authorized to accept.";
        return;
      }
      empireId = offer.empireId;
      targetId = offer.candidateId;
    } else if (action === "national_offer_empire" && ownEmpire === null) {
      const empire = this.requestableAccessionEmpires().find(
        (entry) => entry.id === this.requestedAccessionEmpireId,
      );
      if (!empire) {
        this.politicalError =
          "Choose an active empire with an eligible emperor before requesting accession.";
        return;
      }
      empireId = empire.id;
      targetId = actor.id();
    } else {
      if (!ownEmpire || ownEmpire.leaderId !== actor.id()) {
        this.politicalError =
          "Only the current emperor can send offers or transfer the crown.";
        return;
      }
      empireId = ownEmpire.id;
      targetId =
        action === "national_offer_empire"
          ? this.accessionCandidateId
          : this.crownSuccessorId;
      const authorized =
        action === "national_offer_empire"
          ? this.accessionCandidates()
          : this.crownSuccessors();
      if (!authorized.some((item) => item.id === targetId)) {
        this.politicalError =
          "Select an eligible living nation from the current roster.";
        return;
      }
    }
    let requestId: string;
    try {
      requestId = createNationalPoliticalRequestId();
    } catch {
      this.politicalError =
        "Secure political request identity is unavailable. Nothing was sent.";
      return;
    }
    try {
      if (action === "national_offer_empire") {
        this.eventBus.emit(
          new SendNationalOfferEmpireIntentEvent(empireId, targetId, requestId),
        );
      } else if (action === "national_accept_empire") {
        this.eventBus.emit(
          new SendNationalAcceptEmpireIntentEvent(
            empireId,
            targetId,
            requestId,
          ),
        );
      } else {
        this.eventBus.emit(
          new SendNationalTransferCrownIntentEvent(
            empireId,
            targetId,
            requestId,
          ),
        );
      }
      this.lastPoliticalSubmission = {
        gameId: game.gameID(),
        actorId: actor.id(),
        issuedTick: game.ticks(),
        requestId,
        type: action,
        empireId,
        targetId,
      };
      this.politicalStatus = `Sent ${action} to authenticated command producer (request ${requestId}). Awaiting game receipt; no success confirmed.`;
      this.politicalError = null;
    } catch {
      this.politicalError = "Could not enqueue the political command.";
    }
  }

  private ourWarSide(layer: NationalPublicWarLayer): 0 | 1 | null {
    const actorId = this.game?.myPlayer()?.id();
    if (!actorId) return null;
    const empire = this.memberEmpire;
    const canRepresent = (side: NationalPublicWarLayer["first"]): boolean => {
      if (side.kind === "nation") {
        return (
          side.id === actorId ||
          (layer.scope === "national" &&
            empire?.leaderId === actorId &&
            empire.memberIds.includes(side.id))
        );
      }
      return empire?.id === side.id && empire.leaderId === actorId;
    };
    if (canRepresent(layer.first)) return 0;
    if (canRepresent(layer.second)) return 1;
    return null;
  }

  private eligiblePeaceWars(): readonly NationalPublicWarLayer[] {
    return (
      this.game
        ?.nationalConflicts?.()
        ?.layers.filter(
          (layer) =>
            layer.endedTick === null && this.ourWarSide(layer) !== null,
        ) ?? []
    );
  }

  private eligiblePeaceMotions(): readonly NationalPublicPeaceMotion[] {
    const view = this.game?.nationalConflicts?.();
    if (!view) return [];
    const wars = new Map(
      this.eligiblePeaceWars().map((layer) => [layer.id, layer]),
    );
    return view.motions.filter((motion) => {
      const layer = wars.get(motion.layerId);
      return (
        layer !== undefined &&
        motion.acceptedTick === null &&
        this.ourWarSide(layer) !== motion.proposingSide
      );
    });
  }

  private submitPeace(event: SubmitEvent, action: "propose" | "accept"): void {
    event.preventDefault();
    const reference =
      action === "propose" ? this.warIdDraft.trim() : this.motionIdDraft.trim();
    if (!validNationalWarReference(reference)) {
      this.diplomacyError = "Select an exact game-issued war or motion ID.";
      return;
    }
    const projection = this.game?.nationalConflicts?.() ?? null;
    if (!projection) {
      this.diplomacyError =
        "Awaiting authoritative WAR/peace state. No manual or guessed IDs are permitted.";
      return;
    }
    if (
      !(
        action === "propose"
          ? this.eligiblePeaceWars()
          : this.eligiblePeaceMotions()
      ).some((item) => item.id === reference)
    ) {
      this.diplomacyError =
        "That ID is not an eligible current engine reference.";
      return;
    }
    this.sendDiplomacyCommand(
      (requestId) =>
        action === "propose"
          ? new SendNationalProposePeaceIntentEvent(reference, requestId)
          : new SendNationalAcceptPeaceIntentEvent(reference, requestId),
      action === "propose" ? "Peace proposal" : "Peace motion acceptance",
      action === "propose" ? "national_propose_peace" : "national_accept_peace",
      action === "propose" ? { warId: reference } : { motionId: reference },
    );
  }

  /** Human war target selection moves the ordinary camera toward an actual
   * current player; the overlay controller verifies real tile ownership.
   * A selection can NEVER emit an Attack or manufacture a map location. */
  private selectWarTarget(id: string): void {
    const kind = this.warScope === "national" ? "nation" : this.warTargetKind;
    const selected = this.warTargets(kind).some((target) => target.id === id);
    this.warTargetId = selected ? id : "";
    const game = this.game;
    const playerId =
      !selected || !game
        ? null
        : kind === "empire"
          ? (game.nationalPolitics()?.empires.find((empire) => empire.id === id)
              ?.leaderId ?? null)
          : id;
    const player = playerId
      ? game?.players().find((item) => item.id() === playerId)
      : null;
    this.eventBus?.emit(
      new NationalMapTargetSelectedEvent(player?.id() ?? null),
    );
    if (player?.nameLocation?.() && player.isAlive()) {
      // Normal player-facing camera action: actual GameView name location.
      this.eventBus?.emit(new GoToPlayerEvent(player, 9));
    }
  }

  private playerName(id: string): string {
    return (
      this.game
        ?.players()
        .find((player) => player.id() === id)
        ?.name() ?? id
    );
  }

  /** Drop HUD focus so the player can use ordinary map controls. */
  private closeForMap(): void {
    this.expanded = false;
  }

  private handlePanelKeyDown(event: KeyboardEvent): void {
    // Do not send game map shortcuts while editing a diplomatic ID.
    event.stopPropagation();
    if (event.key === "Escape" && this.expanded) {
      event.preventDefault();
      this.expanded = false;
      void this.updateComplete.then(() =>
        this.querySelector<HTMLButtonElement>(
          '[aria-controls="national-diplomacy-content"]',
        )?.focus(),
      );
    }
  }

  @state() private pactStatus = "";
  @state() private pactPhase = "available";
  private pactSession: string | null = null;
  private pactAttempt: {
    requestId: string;
    actorId: string;
    gameId: string;
    pactId: string;
    type: PactIntent["type"];
    tick: number;
  } | null = null;

  private pactContext(): PactContext | null {
    const game = this.game;
    const actor = game?.myPlayer();
    const politics = game?.nationalPolitics();
    const disclosure = game?.nationalPactDisclosure?.();
    if (
      !game ||
      !actor ||
      !politics?.pacts ||
      !disclosure ||
      this.warUnavailableReason !== null ||
      this.memberEmpire ||
      game.nationalPoliticsTick?.() !== game.ticks() ||
      disclosure.recipientId !== actor.id()
    )
      return null;
    return {
      actor: actor.id(),
      roster: politics.pacts,
      disclosure,
      independentCandidates: game
        .players()
        .filter(
          (p) =>
            p.id() !== actor.id() &&
            p.isAlive() &&
            p.numTilesOwned() > 0 &&
            !politics.empires.some((e) => e.memberIds.includes(p.id())),
        )
        .map((p) => p.id()),
    };
  }
  private refreshPact(): void {
    const game = this.game;
    const context = this.pactContext();
    const session =
      context && game ? JSON.stringify([game.gameID(), context.actor]) : null;
    if (session !== this.pactSession) {
      this.pactSession = session;
      if (!session) {
        this.pactAttempt = null;
        this.pactPhase = "unauthorized";
        this.pactStatus = "No longer authorized; outcome unconfirmed.";
        return;
      }
      if (this.pactAttempt && this.pactAttempt.actorId !== context?.actor)
        this.pactAttempt = null;
      if (!this.pactAttempt) {
        this.pactPhase = "available";
        this.pactStatus = "";
      }
    }
    const a = this.pactAttempt;
    if (!a) return;
    if (
      !game ||
      game.gameID() !== a.gameId ||
      game.myPlayer()?.id() !== a.actorId ||
      !this.pactContext() ||
      game.ticks() < a.tick
    ) {
      this.pactAttempt = null;
      this.pactPhase = "unauthorized";
      this.pactStatus = "No longer authorized; outcome unconfirmed.";
      return;
    }
    const result = reconcilePactReceipt(
      game.nationalPactReceipts?.() ?? [],
      a,
      game.ticks(),
    );
    if (result === "pending") return;
    this.pactAttempt = null;
    this.pactPhase = result;
    this.pactStatus =
      result === "accepted"
        ? "Game accepted command. Current roster and terms below are authoritative."
        : result === "rejected"
          ? "Game rejected command under current political rules."
          : result === "conflict"
            ? "Conflicting receipts; outcome unconfirmed."
            : "No matching receipt; outcome unknown.";
  }
  private sendPact(action: PactAction, displayedKey: string): void {
    if (this.pactAttempt) return;
    const context = this.pactContext();
    const game = this.game;
    if (
      !context ||
      !game ||
      !this.eventBus ||
      !pactActionAllowed(action, context) ||
      pactConsentKey(context, action.pactId) !== displayedKey
    ) {
      this.pactPhase = "unauthorized";
      this.pactStatus =
        "No longer authorized or terms changed. Review current pact.";
      return;
    }
    let requestId: string;
    try {
      requestId = createNationalPoliticalRequestId();
    } catch {
      this.pactStatus = "Secure request identity unavailable.";
      return;
    }
    this.pactAttempt = {
      requestId,
      actorId: context.actor,
      gameId: game.gameID(),
      pactId: action.pactId,
      type: action.type,
      tick: game.ticks(),
    };
    this.pactPhase = "pending";
    this.pactStatus = "Pending authoritative receipt.";
    try {
      this.eventBus.emit(
        new SendNationalPactIntentEvent({ ...action, requestId }),
      );
    } catch {
      this.pactAttempt = null;
      this.pactPhase = "unknown";
      this.pactStatus = "Command transport failed; outcome unconfirmed.";
    }
  }
  private pactTermsControls(t: NationalPactTerms) {
    return html`<label
        >Admission
        <select class="bg-slate-800" name="admission">
          <option value="leader" ?selected=${t.admission === "leader"}>
            Administrator
          </option>
          <option value="unanimous" ?selected=${t.admission === "unanimous"}>
            Unanimous
          </option>
        </select></label
      >
      <label
        >Expulsion
        <select class="bg-slate-800" name="expulsion">
          <option value="leader" ?selected=${t.expulsion === "leader"}>
            Administrator
          </option>
          <option value="unanimous" ?selected=${t.expulsion === "unanimous"}>
            Unanimous (multi-member voting unavailable)
          </option>
          <option value="forbidden" ?selected=${t.expulsion === "forbidden"}>
            Forbidden
          </option>
        </select></label
      >`;
  }
  private readPactTerms(data: FormData): NationalPactTerms | null {
    const admission = data.get("admission"),
      expulsion = data.get("expulsion");
    return (admission === "leader" || admission === "unanimous") &&
      (expulsion === "leader" ||
        expulsion === "unanimous" ||
        expulsion === "forbidden")
      ? { admission, expulsion }
      : null;
  }
  @state() private imperialStatus = "";
  private imperialAttempt: {
    gameId: string;
    actorId: string;
    pactId: string;
    type: "national_imperial_administration";
    tick: number;
    requestId: string;
  } | null = null;
  private currentImperialView(): NationalImperialAdministrationView | null {
    const game = this.game,
      view = game?.nationalImperialAdministration?.();
    return view &&
      !this.warUnavailableReason &&
      game?.nationalPoliticsTick?.() === game?.ticks() &&
      this.memberEmpire?.id === view.empireId
      ? view
      : null;
  }
  private refreshImperialPolicy(): void {
    const attempt = this.imperialAttempt;
    if (!attempt) return;
    const game = this.game,
      view = this.currentImperialView();
    if (
      !game ||
      game.gameID() !== attempt.gameId ||
      game.myPlayer()?.id() !== attempt.actorId ||
      !view?.canAmend ||
      view.empireId !== attempt.pactId
    ) {
      this.imperialAttempt = null;
      this.imperialStatus = "No longer authorized; policy outcome unconfirmed.";
      return;
    }
    const result = reconcilePactReceipt(
      game.nationalPactReceipts(),
      attempt,
      game.ticks(),
    );
    if (result === "pending") return;
    this.imperialAttempt = null;
    this.imperialStatus =
      result === "accepted"
        ? "Game accepted imperial policy command; current policy is shown above."
        : result === "rejected"
          ? "Game rejected imperial policy command."
          : "Imperial policy outcome unconfirmed.";
  }
  private sendImperialPolicy(
    command: ImperialPolicyCommand,
    displayedKey: string,
  ): void {
    if (this.imperialAttempt) return;
    const game = this.game,
      view = this.currentImperialView(),
      actor = game?.myPlayer();
    if (
      !game ||
      !view ||
      !view.canAmend ||
      !actor ||
      !this.eventBus ||
      imperialPolicyKey(view) !== displayedKey ||
      command.empireId !== view.empireId ||
      !imperialPolicyIntentAvailable(view, command.kind)
    ) {
      this.imperialStatus =
        "Policy or authority changed; review the current decree.";
      return;
    }
    let requestId: string;
    try {
      requestId = createNationalPoliticalRequestId();
    } catch {
      this.imperialStatus = "Cannot generate a secure command identifier.";
      return;
    }
    const intent = parseImperialCommand(command, requestId);
    if (!intent) {
      this.imperialStatus = "Invalid policy or command schema unavailable.";
      return;
    }
    this.imperialAttempt = {
      gameId: game.gameID(),
      actorId: actor.id(),
      pactId: view.empireId,
      type: "national_imperial_administration",
      tick: game.ticks(),
      requestId,
    };
    this.imperialStatus = "Pending authoritative policy receipt.";
    try {
      this.eventBus.emit(new SendNationalImperialPolicyIntentEvent(intent));
    } catch {
      this.imperialAttempt = null;
      this.imperialStatus = "Command transport failed; outcome unconfirmed.";
    }
  }
  private renderImperialPolicyControls(
    view: NationalImperialAdministrationView,
  ) {
    if (!view.canAmend || !imperialPolicyIntentAvailable(view, "set-policy"))
      return nothing;
    const key = imperialPolicyKey(view),
      pending = this.imperialAttempt !== null;
    const button =
      "rounded border border-amber-400/50 px-3 py-2 min-h-10 disabled:opacity-50 focus-visible:outline focus-visible:outline-2";
    const submit = (
      event: SubmitEvent,
      kind: ImperialPolicyCommand["kind"],
    ) => {
      event.preventDefault();
      if (!(event.currentTarget instanceof HTMLFormElement)) return;
      const data = new FormData(event.currentTarget);
      if (!data.has("confirm")) return;
      const raw = data.get("basisPoints");
      if (
        typeof raw !== "string" ||
        !/^\d{1,5}$/.test(raw) ||
        Number(raw) > 10000
      )
        return;
      const bps = Number(raw);
      if (kind === "set-policy") {
        const categories = data.getAll("categories");
        if (
          !categories.every((c) =>
            imperialConstructionCategories.includes(c as UnitType),
          )
        )
          return;
        this.sendImperialPolicy(
          {
            kind,
            empireId: view.empireId,
            policy: {
              workerIncomeBps: bps,
              allowedConstruction:
                data.get("constructionMode") === "all"
                  ? null
                  : (categories as UnitType[]),
            },
          },
          key,
        );
      } else {
        const mode = data.get("armyMode");
        if (mode !== "decentralized" && mode !== "hybrid" && mode !== "centralized") return;
        this.sendImperialPolicy(
          { kind, empireId: view.empireId, mode, thresholdBps: bps },
          key,
        );
      }
      event.currentTarget.reset();
    };
    return keyed(
      key,
      html`<div class="space-y-3">
        <p role="status" aria-live="polite" data-national-imperial-status>
          ${this.imperialStatus || "Available"}
        </p>
        <form
          class="flex flex-col gap-2"
          @submit=${(e: SubmitEvent) => submit(e, "set-policy")}
        >
          <label
            >Worker allocation basis points (100 = 1%)
            <input
              name="basisPoints"
              type="number"
              min="0"
              max="10000"
              step="1"
              required
              .value=${String(view.workerIncomeBps)}
              class="w-full rounded bg-slate-900 px-2 py-2"
          /></label>
          <label
            >Construction policy
            <select
              name="constructionMode"
              class="w-full rounded bg-slate-900 px-2 py-2"
            >
              <option
                value="all"
                ?selected=${view.allowedConstruction === null}
              >
                All regulated categories
              </option>
              <option
                value="restricted"
                ?selected=${view.allowedConstruction !== null}
              >
                Only selected categories
              </option>
            </select></label
          >
          <label
            >Allowed categories (restricted policy)
            <select
              multiple
              name="categories"
              size="4"
              class="w-full rounded bg-slate-900 px-2 py-2"
            >
              ${imperialConstructionCategories.map((category) => html`<option .value=${category} ?selected=${view.allowedConstruction?.includes(category) ?? false}>${category}</option>`)}
            </select></label
          >
          <label
            ><input type="checkbox" name="confirm" required /> Confirm
            empire-wide worker and construction decree</label
          >
          <button
            type="submit"
            data-national-imperial-action="set-policy"
            class=${button}
            ?disabled=${pending}
          >
            Submit imperial policy
          </button>
        </form>
        ${
          imperialPolicyIntentAvailable(view, "set-army-mode")
            ? html`<form
                class="flex flex-col gap-2"
                @submit=${(e: SubmitEvent) => submit(e, "set-army-mode")}
              >
                <label
                  >Army administration
                  <select
                    name="armyMode"
                    class="w-full rounded bg-slate-900 px-2 py-2"
                  >
                    <option
                      value="decentralized"
                      ?selected=${view.armyMode === "decentralized"}
                    >
                      Decentralized
                    </option>
                    <option
                      value="hybrid"
                      ?selected=${view.armyMode === "hybrid"}
                    >
                      Hybrid
                    </option>
                    <option
                      value="centralized"
                      ?selected=${view.armyMode === "centralized"}
                    >
                      Centralized
                    </option>
                  </select></label
                >
                <label
                  >Hybrid threshold basis points (100 = 1%)
                  <input
                    name="basisPoints"
                    type="number"
                    min="0"
                    max="10000"
                    step="1"
                    required
                    .value=${String(view.hybridThresholdBps ?? 0)}
                    class="w-full rounded bg-slate-900 px-2 py-2"
                /></label>
                <label
                  ><input type="checkbox" name="confirm" required /> Confirm
                  military administration change</label
                >
                <button
                  type="submit"
                  data-national-imperial-action="set-army-mode"
                  class=${button}
                  ?disabled=${pending}
                >
                  Submit military policy
                </button>
              </form>`
            : nothing
        }
        <p>
          Troop transfers, imperial-funded construction and dissolution have no
          controls here yet.
        </p>
      </div>`,
    );
  }
  private renderImperialAdministration() {
    const game = this.game;
    const view = game?.nationalImperialAdministration?.();
    if (
      !view ||
      this.warUnavailableReason ||
      game?.nationalPoliticsTick?.() !== game?.ticks() ||
      this.memberEmpire?.id !== view.empireId
    )
      return nothing;
    return html`<section
      data-national-imperial-administration
      aria-label="Imperial administration"
      class="space-y-2 rounded border border-amber-400/40 p-3"
    >
      <h2 class="font-semibold text-amber-200">
        Imperial administration · ${view.empireId}
      </h2>
      <p>Imperial treasury: <strong>${view.treasury}</strong> gold</p>
      <p>
        Worker income allocated to treasury:
        ${(view.workerIncomeBps / 100).toFixed(2)}%
      </p>
      <p>
        Member construction authority:
        ${view.allowedConstruction === null ? "All regulated construction categories permitted" : view.allowedConstruction.length ? view.allowedConstruction.join(", ") : "No regulated construction categories permitted"}
      </p>
      ${
        view.armyMode === undefined
          ? nothing
          : html`<p>
                Military administration:
                ${view.armyMode === "hybrid" ? "Hybrid imperial reserve" : "Decentralized national forces"}.
              </p>
              ${view.armyMode === "hybrid" ? html`<p>Hybrid reserve threshold: ${((view.hybridThresholdBps ?? 0) / 100).toFixed(2)}%; imperial troops: ${view.imperialTroops} / ${view.imperialTroopCapacity} capacity.</p>` : nothing}`
      }
      <p>
        ${view.canAmend ? "Current emperor holds policy and military administration authority." : "The current emperor holds policy and military administration authority."}
        ${view.canAmend && !imperialPolicyIntentAvailable(view, "set-policy") ? "Administration command schema unavailable; this is a read-only policy." : ""}
        No unilateral secession control.
      </p>
      ${this.renderImperialPolicyControls(view)}
    </section>`;
  }

  private renderPacts(includePrivate = true) {
    const roster = this.game?.nationalPolitics?.()?.pacts;
    const c = includePrivate ? this.pactContext() : null;
    const enabled = c !== null && !this.pactAttempt;
    const button =
      "rounded border border-amber-400/50 px-3 py-2 min-h-10 disabled:opacity-50 focus-visible:outline focus-visible:outline-2";
    const formClass = "flex flex-col gap-2";
    const submit = (event: SubmitEvent, callback: (data: FormData) => void) => {
      event.preventDefault();
      if (event.currentTarget instanceof HTMLFormElement) {
        const form = event.currentTarget;
        const data = new FormData(form);
        form.reset();
        callback(data);
      }
    };
    return html`<section
      data-national-pacts
      aria-label="Ordinary pacts"
      class="space-y-3"
    >
      <h2 class="font-semibold text-amber-200">
        Non-aggression and mutual defense pacts
      </h2>
      <p
        role="status"
        aria-live="polite"
        data-national-pact-status
        data-national-pact-phase=${c ? this.pactPhase : "unauthorized"}
        data-national-pact-request-id=${this.pactAttempt?.requestId ?? ""}
      >
        ${c ? this.pactStatus || "Available" : "Private constitutional controls unavailable"}
      </p>
      ${
        roster === undefined
          ? html`<p>Public pact roster not available.</p>`
          : roster.length === 0
            ? html`<p>No ordinary pacts.</p>`
            : repeat(
                roster,
                (p) => p.id,
                (p) => {
                  const d = c?.disclosure.pacts.find((x) => x.pactId === p.id);
                  const key = c ? pactConsentKey(c, p.id) : "";
                  const allowed = (action: PactAction) =>
                    enabled && c !== null && pactActionAllowed(action, c);
                  const send = (action: PactAction) =>
                    this.sendPact(action, key);
                  const candidates =
                    c?.independentCandidates.filter(
                      (id) => !p.memberIds.includes(id),
                    ) ?? [];
                  const pending = d?.pendingAmendment;
                  const accept = {
                    type: "national_accept_pact",
                    pactId: p.id,
                  } as const;
                  const betray = {
                    type: "national_betray_pact",
                    pactId: p.id,
                  } as const;
                  const approve = {
                    type: "national_approve_pact_amendment",
                    pactId: p.id,
                  } as const;
                  return keyed(
                    key,
                    html`<article
                      data-national-pact-id=${p.id}
                      class="rounded border border-white/20 p-3 space-y-2"
                    >
                      <h3 class="font-bold break-words">
                        ${p.name} (${p.kind}) · ${p.id}
                      </h3>
                      <p>
                        Administrator:
                        ${p.administratorId ? this.playerName(p.administratorId) : "None"}
                      </p>
                      <p>
                        Members:
                        ${p.memberIds.map((id) => this.playerName(id)).join(", ")}
                      </p>
                      ${d ? html`<p data-national-pact-terms>Constitution: admission ${d.terms.admission}; expulsion ${d.terms.expulsion}.</p>` : nothing}
                      ${
                        d?.relationship === "invited"
                          ? html`<p>
                                Accepting binds your nation to the displayed
                                terms.
                                ${p.kind === "MDA" ? "Defense levies may commit your troops." : "You cannot attack fellow members without betraying first."}
                              </p>
                              <button
                                class=${button}
                                type="button"
                                data-national-pact-action="accept"
                                ?disabled=${!allowed(accept)}
                                @click=${() => send(accept)}
                              >
                                Accept displayed constitution
                              </button>`
                          : nothing
                      }
                      ${
                        d?.relationship === "member"
                          ? html`
                              <form
                                class=${formClass}
                                @submit=${(e: SubmitEvent) => submit(e, (data) => send({ type: "national_invite_pact", pactId: p.id, candidateId: String(data.get("candidate")) }))}
                              >
                                <label
                                  >Invite independent nation
                                  <select
                                    name="candidate"
                                    required
                                    class="bg-slate-800"
                                  >
                                    <option value="">Choose nation</option>
                                    ${candidates.map((id) => html`<option value=${id}>${this.playerName(id)}</option>`)}
                                  </select></label
                                >
                                <button
                                  class=${button}
                                  data-national-pact-action="invite"
                                  ?disabled=${!enabled || !candidates.some((candidateId) => allowed({ type: "national_invite_pact", pactId: p.id, candidateId }))}
                                >
                                  ${d.terms.admission === "unanimous" && p.memberIds.length > 1 ? "Record initial admission vote" : "Submit invitation"}
                                </button>
                                ${d.terms.admission === "unanimous" ? html`<p>Unanimous admission requires all members’ consent. With multiple members, this records the first vote, not an authorized invitation; additional admission ballot controls are not available.</p>` : nothing}
                              </form>
                              <form
                                class=${formClass}
                                @submit=${(e: SubmitEvent) =>
                                  submit(e, (data) => {
                                    if (data.get("confirm") === "on")
                                      send(betray);
                                  })}
                              >
                                <p>
                                  Betrayal immediately leaves this coalition and
                                  removes its treaty protection and defense
                                  obligations.
                                </p>
                                <label
                                  ><input
                                    type="checkbox"
                                    required
                                    name="confirm"
                                  />
                                  I understand and choose to leave</label
                                >
                                <button
                                  class=${button}
                                  data-national-pact-action="betray"
                                  ?disabled=${!allowed(betray)}
                                >
                                  Betray and leave
                                </button>
                              </form>
                              ${
                                pending
                                  ? html`<div data-national-pact-amendment>
                                      <p>
                                        Proposed constitution: admission
                                        ${pending.terms.admission}; expulsion
                                        ${pending.terms.expulsion};
                                        administrator
                                        ${pending.administratorId ? this.playerName(pending.administratorId) : "None"}.
                                      </p>
                                      <p>
                                        Approved: ${pending.approvedBy.length}
                                        of ${p.memberIds.length} members. All
                                        current members must consent.
                                      </p>
                                      <button
                                        class=${button}
                                        type="button"
                                        data-national-pact-action="approve"
                                        ?disabled=${!allowed(approve)}
                                        @click=${() => send(approve)}
                                      >
                                        Approve displayed amendment
                                      </button>
                                    </div>`
                                  : html`<form
                                      class=${formClass}
                                      @submit=${(e: SubmitEvent) =>
                                        submit(e, (data) => {
                                          const terms =
                                            this.readPactTerms(data);
                                          const admin = String(
                                            data.get("administrator") ?? "",
                                          );
                                          if (terms)
                                            send({
                                              type: "national_propose_pact_amendment",
                                              pactId: p.id,
                                              terms,
                                              administratorId: admin || null,
                                            });
                                        })}
                                    >
                                      <h4>Propose constitutional amendment</h4>
                                      ${this.pactTermsControls(d.terms)}
                                      <label
                                        >Administrator
                                        <select
                                          class="bg-slate-800"
                                          name="administrator"
                                        >
                                          <option
                                            value=""
                                            ?selected=${p.administratorId === null}
                                          >
                                            None
                                          </option>
                                          ${p.memberIds.map((id) => html`<option value=${id} ?selected=${id === p.administratorId}>${this.playerName(id)}</option>`)}
                                        </select></label
                                      >
                                      <button
                                        class=${button}
                                        data-national-pact-action="propose"
                                        ?disabled=${!enabled}
                                      >
                                        Propose amendment (casts your approval)
                                      </button>
                                    </form>`
                              }
                              ${
                                (d.terms.expulsion === "leader" &&
                                  p.administratorId === c?.actor) ||
                                (d.terms.expulsion === "unanimous" &&
                                  p.memberIds.length === 2)
                                  ? html`<form
                                      class=${formClass}
                                      @submit=${(e: SubmitEvent) =>
                                        submit(e, (data) => {
                                          if (data.get("confirm") === "on")
                                            send({
                                              type: "national_expel_pact",
                                              pactId: p.id,
                                              memberId: String(
                                                data.get("member"),
                                              ),
                                            });
                                        })}
                                    >
                                      <label
                                        >Expel member
                                        <select
                                          name="member"
                                          required
                                          class="bg-slate-800"
                                        >
                                          <option value="">
                                            Choose member
                                          </option>
                                          ${p.memberIds.filter((id) => id !== c?.actor).map((id) => html`<option value=${id}>${this.playerName(id)}</option>`)}
                                        </select></label
                                      >
                                      <label
                                        ><input
                                          type="checkbox"
                                          required
                                          name="confirm"
                                        />
                                        ${d.terms.expulsion === "unanimous" ? "Confirm consent as sole remaining member" : "Confirm discretionary expulsion"}</label
                                      >
                                      <button
                                        class=${button}
                                        data-national-pact-action="expel"
                                        ?disabled=${!enabled || p.memberIds.length < 2}
                                      >
                                        Expel member
                                      </button>
                                    </form>`
                                  : html`<p>
                                      Expulsion:
                                      ${d.terms.expulsion === "forbidden" ? "Forbidden by constitution" : d.terms.expulsion === "unanimous" ? "Requires unanimous consent; voting unavailable" : "Administrator only"}.
                                    </p>`
                              }
                            `
                          : nothing
                      }
                    </article>`,
                  );
                },
              )
      }
      ${
        c
          ? html`<form
              class=${formClass}
              data-national-pact-found
              @submit=${(e: SubmitEvent) =>
                submit(e, (data) => {
                  const terms = this.readPactTerms(data),
                    kind = data.get("kind"),
                    pactId = String(data.get("id") ?? "").trim();
                  if (terms && (kind === "NAP" || kind === "MDA"))
                    this.sendPact(
                      {
                        type: "national_found_pact",
                        pactId,
                        name: String(data.get("name") ?? "").trim(),
                        pactKind: kind,
                        terms,
                      },
                      pactConsentKey(c, pactId),
                    );
                })}
            >
              <h3>Found a pact</h3>
              <label
                >Pact ID
                <input
                  class="bg-slate-800"
                  name="id"
                  required
                  maxlength="64"
                  pattern="[A-Za-z0-9_\\-]{1,64}"
              /></label>
              <label
                >Public name
                <input class="bg-slate-800" name="name" required maxlength="64"
              /></label>
              <label
                >Category
                <select class="bg-slate-800" name="kind">
                  <option value="NAP">Non-aggression pact</option>
                  <option value="MDA">Mutual defense alliance</option>
                </select></label
              >
              ${this.pactTermsControls({ admission: "leader", expulsion: "forbidden" })}
              <button
                class=${button}
                data-national-pact-action="found"
                ?disabled=${!enabled}
              >
                Found pact with displayed terms
              </button>
            </form>`
          : nothing
      }
    </section>`;
  }

  render() {
    const game = this.game;
    const mode = game?.config().gameConfig().gameType;
    if (
      game?.config().gameConfig().nationalMode !== true ||
      (mode !== GameType.Singleplayer && mode !== GameType.Private)
    ) {
      return nothing;
    }
    if (mode === GameType.Private && !this.trustedPrivateCommandsReady) {
      return html`<section
        aria-label="NATIONAL diplomacy"
        data-national-private-capability="blocked"
        role="status"
        class="max-w-60 rounded-md bg-slate-950/90 px-3 py-2 text-xs text-amber-200"
      >
        NATIONAL Private controls are locked until the server verifies your
        current active seat and trusted match.
        <details>
          <summary>Public pact roster</summary>
          ${this.renderPacts(false)}
        </details>
      </section>`;
    }
    const politics = game.nationalPolitics();
    const ownEmpire = this.memberEmpire;
    const canFound =
      this.unavailableReason === null &&
      politics !== null &&
      !game.config().isReplay();
    const readonlyReplay = game.config().isReplay();
    const warReason = this.warUnavailableReason;
    const isEmperor =
      ownEmpire !== null && ownEmpire.leaderId === game.myPlayer()?.id();
    const requestableEmpires = this.requestableAccessionEmpires();
    const warKind =
      this.warScope === "national" ? "nation" : this.warTargetKind;
    const warTargets = this.warTargets(warKind);
    const canIssueWar =
      warReason === null &&
      this.eventBus !== null &&
      this.lastDiplomacySubmission === null &&
      (this.warScope === "national" || isEmperor);
    const conflicts = game.nationalConflicts?.() ?? null;
    const peaceWars = this.eligiblePeaceWars();
    const peaceMotions = this.eligiblePeaceMotions();
    const canIssuePeace =
      warReason === null &&
      this.eventBus !== null &&
      conflicts !== null &&
      this.lastDiplomacySubmission === null;
    const combatWars =
      conflicts?.layers.filter(
        (layer) => layer.endedTick === null && this.ourWarSide(layer) !== null,
      ) ?? [];
    // Real GameRunner player attack projection only, not an intent counter.
    const observedOutgoingAttacks =
      game
        .myPlayer()
        ?.outgoingAttacks?.()
        .filter((attack) => !attack.retreating).length ?? 0;
    return html`
      <section
        class="text-white w-[min(25rem,calc(100vw-1rem))] max-w-full rounded-xl border border-amber-400/50 bg-slate-950/95 shadow-xl backdrop-blur-sm overflow-hidden"
        aria-label="NATIONAL diplomacy"
        data-national-phase=${this.phase}
        @keydown=${this.handlePanelKeyDown}
      >
        <button
          type="button"
          class="flex w-full min-h-12 items-center justify-between gap-3 px-4 py-3 font-bold text-left text-sm hover:bg-amber-400/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
          aria-controls="national-diplomacy-content"
          aria-expanded=${String(this.expanded)}
          @click=${() => {
            if (
              game.inSpawnPhase() &&
              typeof window !== "undefined" &&
              window.innerWidth <= 640
            ) {
              this.expanded = false;
            } else {
              this.expanded = !this.expanded;
            }
          }}
        >
          <span
            >${game.inSpawnPhase() ? "👑 NATIONAL · Diplomacy · Tap map to spawn" : "👑 NATIONAL · Diplomacy"}</span
          >
          <span aria-hidden="true">${this.expanded ? "▴" : "▾"}</span>
        </button>
        ${
          this.expanded
            ? html`<div
                id="national-diplomacy-content"
                class="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-4 max-h-[min(70dvh,calc(100dvh-8rem))] overflow-y-auto overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch] text-sm"
              >
                <p class="text-xs text-slate-300">
                  Choose a nation, declare WAR, then fight on the actual game
                  map. Membership and outcomes come only from the engine.
                </p>
                <p
                  data-national-map-instructions
                  class="text-xs text-slate-300"
                >
                  ${
                    game.inSpawnPhase()
                      ? "Spawn first: click or tap an unoccupied land tile."
                      : "Battle: right-click opposing territory on desktop, or tap it on mobile, then choose the enabled Attack action."
                  }
                </p>
                ${this.renderPacts()} ${this.renderImperialAdministration()}
                ${
                  politics
                    ? html`<div class="space-y-2">
                        <h2 class="font-semibold text-amber-200">Empires</h2>
                        ${
                          politics.empires.length === 0
                            ? html`<p class="text-slate-300">
                                No empires founded yet.
                              </p>`
                            : politics.empires.map(
                                (empire) =>
                                  html`<article
                                    class="rounded-lg border border-white/15 p-3 space-y-1"
                                  >
                                    <h3 class="font-semibold break-words">
                                      ${empire.id}
                                    </h3>
                                    <p>
                                      Leader:
                                      ${this.playerName(empire.leaderId)}
                                    </p>
                                    <p class="text-xs text-slate-300">
                                      Members (${empire.memberIds.length}):
                                      ${empire.memberIds.map((id) => this.playerName(id)).join(", ")}
                                    </p>
                                  </article>`,
                              )
                        }
                      </div>`
                    : html`<p class="text-amber-200 text-xs" role="status">
                        Verified political state has not arrived from the game.
                        Leadership and membership are not yet available.
                      </p>`
                }
                ${
                  politics?.warnings.length
                    ? html`<div
                        class="rounded-lg border border-orange-400/60 bg-orange-900/30 p-3 space-y-2"
                        role="alert"
                      >
                        <h2 class="font-semibold text-orange-200">
                          Ungovernable warnings
                        </h2>
                        ${politics.warnings.map(
                          (warning) =>
                            html`<p class="text-sm text-orange-100">
                              Empire <strong>${warning.empireId}</strong>:
                              ${Math.ceil(warning.remainingMs / 1000)} seconds
                              to the recorded deadline.
                              ${
                                warning.blockedByAssetDisposition
                                  ? "Dissolution is deferred pending asset-disposition rules."
                                  : "Review imperial control and succession."
                              }
                            </p>`,
                        )}
                      </div>`
                    : nothing
                }
                ${
                  ownEmpire
                    ? html`<p
                        class="rounded-lg bg-emerald-900/35 p-3 text-emerald-200"
                      >
                        Your nation belongs to <strong>${ownEmpire.id}</strong>.
                        ${
                          ownEmpire.leaderId === game.myPlayer()?.id()
                            ? "You are the emperor."
                            : `Emperor: ${this.playerName(ownEmpire.leaderId)}.`
                        }
                      </p>`
                    : readonlyReplay
                      ? html`<p class="text-xs text-slate-300" role="status">
                          Replay is read-only. Empire founding is unavailable.
                        </p>`
                      : html`<form
                          class="space-y-2"
                          @submit=${this.submitFounding}
                        >
                          <label
                            for="national-empire-id"
                            class="block font-semibold"
                          >
                            Found an empire
                          </label>
                          <input
                            id="national-empire-id"
                            name="empireId"
                            type="text"
                            required
                            minlength="1"
                            maxlength="64"
                            pattern="[A-Za-z0-9_-]+"
                            autocomplete="off"
                            autocapitalize="off"
                            spellcheck="false"
                            class="w-full min-h-11 rounded-md border border-slate-400 bg-slate-900 px-3 py-2 text-base text-white focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-50"
                            placeholder="e.g. Atlas_Empire"
                            aria-describedby="national-id-help"
                            .value=${this.draftEmpireId}
                            @input=${(e: Event) =>
                              (this.draftEmpireId = (
                                e.target as HTMLInputElement
                              ).value)}
                            ?disabled=${!canFound}
                          />
                          <p
                            id="national-id-help"
                            class="text-xs text-slate-400"
                          >
                            1–64 letters, digits, underscores or hyphens.
                          </p>
                          <button
                            type="submit"
                            class="min-h-11 rounded-lg bg-amber-400 px-4 py-2 font-bold text-slate-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50"
                            ?disabled=${!canFound || !this.eventBus}
                          >
                            ${this.pendingEmpireId ? "Awaiting game result…" : "Found Empire"}
                          </button>
                          ${
                            this.unavailableReason
                              ? html`<p class="text-xs text-slate-300">
                                  ${this.unavailableReason}
                                </p>`
                              : nothing
                          }
                        </form>`
                }

                <div
                  role="status"
                  aria-live="polite"
                  class="text-xs text-amber-200"
                >
                  ${this.message ?? nothing}
                </div>
                ${
                  this.pendingAttempt
                    ? html`<p
                        data-national-founding-tick
                        data-national-founding-request-id=${this.pendingAttempt.requestId}
                        data-national-founding-actor-id=${this.pendingAttempt.actorId}
                        role="status"
                        aria-live="polite"
                        class="text-xs text-amber-200"
                      >
                        Awaiting authoritative founder resolution for request
                        ${this.pendingAttempt.requestId} (actor
                        ${this.pendingAttempt.actorId}). Submitted at Game tick
                        ${this.pendingAttempt.issuedTick}; current Game tick
                        ${game.ticks()}, pause
                        ${
                          game.isPaused?.() === true
                            ? "active"
                            : game.isPaused?.() === false
                              ? "inactive"
                              : "unknown"
                        },
                        public roster tick
                        ${game.nationalPoliticsTick?.() ?? "unavailable"}.
                        ${
                          this.pendingAttempt.acceptedResultSeen
                            ? "Matching accepted receipt observed; waiting for current authoritative roster."
                            : "No matching accepted receipt observed yet."
                        }
                        A 00:00 Solo HUD clock is not proof of stopped Game
                        ticks, delivery or founding success.
                      </p>`
                    : nothing
                }
                ${
                  this.error
                    ? html`<p role="alert" class="text-xs text-red-300">
                        ${this.error}
                      </p>`
                    : nothing
                }

                <div class="border-t border-white/15 pt-3 space-y-3">
                  <h2 class="font-semibold text-amber-200">Declare war</h2>
                  <p class="text-xs text-slate-300">
                    Declarations use the real authenticated NATIONAL engine.
                    Sending a command does not prove that war was accepted.
                  </p>
                  <form class="space-y-2" @submit=${this.submitWar}>
                    <label for="national-war-scope" class="block font-semibold">
                      War authority
                    </label>
                    <select
                      id="national-war-scope"
                      class="w-full min-h-11 rounded-md border border-slate-400 bg-slate-900 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-amber-300"
                      .value=${this.warScope}
                      @change=${(event: Event) => {
                        this.warScope = (event.target as HTMLSelectElement)
                          .value as "national" | "imperial";
                        this.selectWarTarget("");
                      }}
                      ?disabled=${warReason !== null}
                    >
                      <option value="national">National war</option>
                      <option value="imperial" ?disabled=${!isEmperor}>
                        Imperial war (emperor only)
                      </option>
                    </select>
                    ${
                      this.warScope === "imperial"
                        ? html`<label
                              for="national-war-target-kind"
                              class="block font-semibold"
                            >
                              Opposing power
                            </label>
                            <select
                              id="national-war-target-kind"
                              class="w-full min-h-11 rounded-md border border-slate-400 bg-slate-900 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-amber-300"
                              .value=${this.warTargetKind}
                              @change=${(event: Event) => {
                                this.warTargetKind = (
                                  event.target as HTMLSelectElement
                                ).value as "nation" | "empire";
                                this.selectWarTarget("");
                              }}
                              ?disabled=${!canIssueWar}
                            >
                              <option value="nation">Nation</option>
                              <option value="empire">Empire</option>
                            </select>`
                        : nothing
                    }
                    <label
                      for="national-war-target"
                      class="block font-semibold"
                    >
                      Target
                    </label>
                    <select
                      id="national-war-target"
                      required
                      class="w-full min-h-11 rounded-md border border-slate-400 bg-slate-900 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-amber-300"
                      .value=${this.warTargetId}
                      @change=${(event: Event) =>
                        this.selectWarTarget(
                          (event.target as HTMLSelectElement).value,
                        )}
                      ?disabled=${!canIssueWar || warTargets.length === 0}
                    >
                      <option value="">Choose an eligible target</option>
                      ${warTargets.map(
                        (target) =>
                          html`<option value=${target.id}>
                            ${target.name} (${target.id})
                          </option>`,
                      )}
                    </select>
                    <button
                      id="national-declare-war"
                      type="submit"
                      class="min-h-11 rounded-lg bg-red-600 px-4 py-2 font-bold text-white hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
                      ?disabled=${!canIssueWar || warTargets.length === 0 || !this.warTargetId}
                    >
                      Declare
                      ${this.warScope === "imperial" ? "imperial" : "national"}
                      war
                    </button>
                    ${
                      warReason || (this.warScope === "imperial" && !isEmperor)
                        ? html`<p class="text-xs text-slate-300">
                            ${
                              warReason ??
                              "Only the current emperor may declare imperial war."
                            }
                          </p>`
                        : nothing
                    }
                  </form>
                </div>

                <div class="border-t border-white/15 pt-3 space-y-3">
                  <h2 class="font-semibold text-amber-200">Peace</h2>
                  <p class="text-xs text-slate-300">
                    ${
                      conflicts
                        ? "Choose a real engine-issued WAR or motion ID. The game still decides constitutional authority."
                        : "Awaiting authoritative current conflicts. Peace controls remain unavailable until the game sends live IDs."
                    }
                  </p>
                  ${
                    conflicts
                      ? html`<div
                          aria-label="Current conflicts"
                          class="space-y-1 text-xs text-slate-300"
                        >
                          <p>
                            Active layers:
                            ${conflicts.layers.filter((layer) => layer.endedTick === null).length};
                            pending peace motions:
                            ${conflicts.motions.filter((motion) => motion.acceptedTick === null).length}.
                          </p>
                          ${conflicts.layers.map(
                            (layer) =>
                              html`<p class="break-all">
                                WAR ${layer.id} · ${layer.first.id} vs
                                ${layer.second.id} ·
                                ${layer.endedTick === null ? "ACTIVE" : "ENDED"}
                              </p>`,
                          )}
                          ${conflicts.motions.map(
                            (motion) =>
                              html`<p class="break-all">
                                Motion ${motion.id} for WAR ${motion.layerId} ·
                                ${motion.acceptedTick === null ? "PENDING" : "ACCEPTED"}
                              </p>`,
                          )}
                        </div>`
                      : nothing
                  }
                  ${
                    combatWars.length
                      ? html`<div
                          data-national-map-combat
                          class="rounded-lg border border-cyan-400/40 bg-cyan-900/25 p-3 space-y-2"
                        >
                          <strong>⚔️ War is active — attack on the map</strong>
                          <p class="text-xs">
                            Close this panel, then right-click enemy land
                            (desktop) or tap it (mobile). Choose Attack in the
                            existing map menu. The engine decides whether troops
                            move. Use the normal troop-ratio control to set how
                            many are sent.
                          </p>
                          <p
                            data-national-live-attacks
                            class="text-xs"
                            role="status"
                          >
                            Observed live outgoing map attacks:
                            ${observedOutgoingAttacks}. This is reported from
                            game state, not from clicking Attack.
                          </p>
                          <button
                            id="national-return-to-map"
                            type="button"
                            class="min-h-11 rounded-lg border border-cyan-300 px-4 py-2 font-semibold text-white focus-visible:outline-2 focus-visible:outline-white"
                            @click=${this.closeForMap}
                          >
                            Return to map
                          </button>
                        </div>`
                      : nothing
                  }
                  <form
                    class="space-y-2"
                    @submit=${(event: SubmitEvent) =>
                      this.submitPeace(event, "propose")}
                  >
                    <label
                      for="national-peace-war-id"
                      class="block font-semibold"
                    >
                      Engine war ID
                    </label>
                    <select
                      id="national-peace-war-id"
                      required
                      class="w-full min-h-11 rounded-md border border-slate-400 bg-slate-900 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-amber-300"
                      .value=${this.warIdDraft}
                      @change=${(event: Event) =>
                        (this.warIdDraft = (
                          event.target as HTMLSelectElement
                        ).value)}
                      ?disabled=${!canIssuePeace || peaceWars.length === 0}
                    >
                      <option value="">Choose an active WAR</option>
                      ${peaceWars.map(
                        (war) =>
                          html`<option value=${war.id}>
                            ${war.id} · ${war.first.id} vs ${war.second.id}
                          </option>`,
                      )}
                    </select>
                    <button
                      id="national-propose-peace"
                      type="submit"
                      class="min-h-11 rounded-lg border border-amber-400 px-4 py-2 font-semibold text-amber-100 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
                      ?disabled=${
                        !canIssuePeace ||
                        !this.warIdDraft.trim() ||
                        (conflicts !== null &&
                          !peaceWars.some((war) => war.id === this.warIdDraft))
                      }
                    >
                      Propose peace
                    </button>
                  </form>
                  <form
                    class="space-y-2"
                    @submit=${(event: SubmitEvent) =>
                      this.submitPeace(event, "accept")}
                  >
                    <label
                      for="national-peace-motion-id"
                      class="block font-semibold"
                    >
                      Engine peace motion ID
                    </label>
                    <select
                      id="national-peace-motion-id"
                      required
                      class="w-full min-h-11 rounded-md border border-slate-400 bg-slate-900 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-amber-300"
                      .value=${this.motionIdDraft}
                      @change=${(event: Event) =>
                        (this.motionIdDraft = (
                          event.target as HTMLSelectElement
                        ).value)}
                      ?disabled=${!canIssuePeace || peaceMotions.length === 0}
                    >
                      <option value="">
                        Choose an opponent's peace motion
                      </option>
                      ${peaceMotions.map(
                        (motion) =>
                          html`<option value=${motion.id}>
                            ${motion.id} · WAR ${motion.layerId}
                          </option>`,
                      )}
                    </select>
                    <button
                      id="national-accept-peace"
                      type="submit"
                      class="min-h-11 rounded-lg border border-amber-400 px-4 py-2 font-semibold text-amber-100 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"
                      ?disabled=${
                        !canIssuePeace ||
                        !this.motionIdDraft.trim() ||
                        (conflicts !== null &&
                          !peaceMotions.some(
                            (motion) => motion.id === this.motionIdDraft,
                          ))
                      }
                    >
                      Accept peace
                    </button>
                  </form>
                  <p
                    class="text-xs text-amber-200"
                    role="status"
                    aria-live="polite"
                    aria-busy=${String(this.lastDiplomacySubmission !== null)}
                    data-national-diplomacy-status
                  >
                    ${this.diplomacyStatus ?? nothing}
                  </p>
                  ${
                    this.diplomacyError
                      ? html`<p role="alert" class="text-xs text-red-300">
                          ${this.diplomacyError}
                        </p>`
                      : nothing
                  }
                </div>

                <div
                  class="border-t border-white/15 pt-3 space-y-3"
                  aria-label="NATIONAL accession and succession"
                >
                  <h2 class="font-semibold text-amber-200">
                    Accession and succession
                  </h2>
                  ${
                    ownEmpire === null
                      ? html`<form
                          class="space-y-2"
                          @submit=${(event: SubmitEvent) => this.submitPolitical(event, "national_offer_empire")}
                        >
                          <label
                            for="national-request-empire"
                            class="block font-semibold"
                            >Request to join an empire</label
                          >
                          <select
                            id="national-request-empire"
                            required
                            class="w-full min-h-11 rounded-md border border-slate-400 bg-slate-900 px-3 py-2 text-base text-white"
                            .value=${this.requestedAccessionEmpireId}
                            @change=${(event: Event) => (this.requestedAccessionEmpireId = (event.target as HTMLSelectElement).value)}
                            ?disabled=${warReason !== null || this.lastPoliticalSubmission !== null || requestableEmpires.length === 0}
                          >
                            <option value="">Choose a current empire</option>
                            ${requestableEmpires.map((empire) => html`<option value=${empire.id}>${empire.id} · Emperor ${empire.leaderName}</option>`)}
                          </select>
                          <button
                            id="national-request-accession"
                            type="submit"
                            class="min-h-11 rounded-md bg-amber-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
                            ?disabled=${warReason !== null || this.lastPoliticalSubmission !== null || this.eventBus === null || !requestableEmpires.some((empire) => empire.id === this.requestedAccessionEmpireId)}
                          >
                            Request accession
                          </button>
                          <p class="text-xs text-slate-300">
                            The emperor must accept your request before your
                            nation joins. Sending is not membership.
                          </p>
                        </form>`
                      : nothing
                  }
                  ${
                    isEmperor
                      ? html`<form
                            class="space-y-2"
                            @submit=${(event: SubmitEvent) => this.submitPolitical(event, "national_offer_empire")}
                          >
                            <label
                              for="national-accession-candidate"
                              class="block font-semibold"
                              >Offer accession to nation</label
                            >
                            <select
                              id="national-accession-candidate"
                              required
                              class="w-full min-h-11 rounded-md border border-slate-400 bg-slate-900 px-3 py-2 text-base text-white"
                              .value=${this.accessionCandidateId}
                              @change=${(event: Event) => (this.accessionCandidateId = (event.target as HTMLSelectElement).value)}
                              ?disabled=${warReason !== null || this.lastPoliticalSubmission !== null || this.accessionCandidates().length === 0}
                            >
                              <option value="">
                                Choose an independent living nation
                              </option>
                              ${this.accessionCandidates().map((candidate) => html`<option value=${candidate.id}>${candidate.name} (${candidate.id})</option>`)}
                            </select>
                            <button
                              id="national-offer-accession"
                              type="submit"
                              class="min-h-11 rounded-md bg-amber-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
                              ?disabled=${warReason !== null || this.lastPoliticalSubmission !== null || !this.accessionCandidates().some((item) => item.id === this.accessionCandidateId)}
                            >
                              Offer accession
                            </button>
                          </form>
                          <form
                            class="space-y-2"
                            @submit=${(event: SubmitEvent) => this.submitPolitical(event, "national_transfer_crown")}
                          >
                            <label
                              for="national-crown-successor"
                              class="block font-semibold"
                              >Transfer crown to member</label
                            >
                            <select
                              id="national-crown-successor"
                              required
                              class="w-full min-h-11 rounded-md border border-slate-400 bg-slate-900 px-3 py-2 text-base text-white"
                              .value=${this.crownSuccessorId}
                              @change=${(event: Event) => (this.crownSuccessorId = (event.target as HTMLSelectElement).value)}
                              ?disabled=${warReason !== null || this.lastPoliticalSubmission !== null || this.crownSuccessors().length === 0}
                            >
                              <option value="">
                                Choose a living empire member
                              </option>
                              ${this.crownSuccessors().map((successor) => html`<option value=${successor.id}>${successor.name} (${successor.id})</option>`)}
                            </select>
                            <button
                              id="national-transfer-crown"
                              type="submit"
                              class="min-h-11 rounded-md bg-amber-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
                              ?disabled=${warReason !== null || this.lastPoliticalSubmission !== null || !this.crownSuccessors().some((item) => item.id === this.crownSuccessorId)}
                            >
                              Transfer crown
                            </button>
                          </form>`
                      : nothing
                  }
                  ${
                    ownEmpire === null || isEmperor
                      ? html`<form
                          class="space-y-2"
                          @submit=${(event: SubmitEvent) => this.submitPolitical(event, "national_accept_empire")}
                        >
                          <label
                            for="national-invitation-empire"
                            class="block font-semibold"
                            >Received accession invitations</label
                          >
                          <select
                            id="national-invitation-empire"
                            required
                            class="w-full min-h-11 rounded-md border border-slate-400 bg-slate-900 px-3 py-2 text-base text-white"
                            .value=${this.chosenInvitation}
                            @change=${(event: Event) => (this.chosenInvitation = (event.target as HTMLSelectElement).value)}
                            ?disabled=${warReason !== null || this.lastPoliticalSubmission !== null || this.accessionOffers.length === 0}
                          >
                            <option value="">
                              Choose a verified invitation
                            </option>
                            ${this.accessionOffers.map((offer) => html`<option value=${`${offer.empireId}:${offer.candidateId}`}>${offer.candidateId === game.myPlayer()?.id() ? `Invitation from ${this.playerName(offer.proposerId)} to join ${offer.empireId}` : `Request from ${this.playerName(offer.candidateId)} to join ${offer.empireId}`}</option>`)}
                          </select>
                          <button
                            id="national-accept-accession"
                            type="submit"
                            class="min-h-11 rounded-md bg-amber-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
                            ?disabled=${warReason !== null || this.lastPoliticalSubmission !== null || !this.accessionOffers.some((offer) => `${offer.empireId}:${offer.candidateId}` === this.chosenInvitation)}
                          >
                            ${this.accessionOffers.find((offer) => `${offer.empireId}:${offer.candidateId}` === this.chosenInvitation)?.candidateId === game.myPlayer()?.id() ? "Accept invitation and join" : "Admit candidate into empire"}
                          </button>
                          ${
                            game.nationalAccessionOffers?.() === null ||
                            game.nationalAccessionOffers?.() === undefined
                              ? html`<p
                                  role="status"
                                  class="text-xs text-amber-200"
                                >
                                  Recipient-only invitations have not been
                                  verified by the game yet.
                                </p>`
                              : this.accessionOffers.length === 0
                                ? html`<p
                                    role="status"
                                    class="text-xs text-slate-300"
                                  >
                                    No verified invitations currently addressed
                                    to your nation.
                                  </p>`
                                : nothing
                          }
                        </form>`
                      : nothing
                  }
                  <p
                    role="status"
                    aria-live="polite"
                    aria-busy=${String(this.lastPoliticalSubmission !== null)}
                    data-national-political-status
                    class="text-xs text-amber-200"
                  >
                    ${this.politicalStatus ?? nothing}
                  </p>
                  ${
                    this.politicalError
                      ? html`<p role="alert" class="text-xs text-red-300">
                          ${this.politicalError}
                        </p>`
                      : nothing
                  }
                  <p class="text-xs text-slate-400">
                    An accepted command receipt does not prove that an
                    invitation was delivered. Accession and crown transfer
                    require a fresh, authoritative empire roster.
                  </p>
                </div>
                <div class="border-t border-white/15 pt-3 space-y-2">
                  <h2 class="font-semibold text-amber-200">
                    Other diplomatic actions
                  </h2>
                  ${["Non-aggression pact", "Mutual defense pact"].map(
                    (label) =>
                      html`<button
                        type="button"
                        disabled
                        aria-label="${label} (not yet available)"
                        class="mr-2 mb-2 rounded-md border border-white/20 px-3 py-1.5 text-xs text-slate-500 cursor-not-allowed"
                      >
                        ${label} · Unavailable
                      </button>`,
                  )}
                </div>
              </div>`
            : nothing
        }
      </section>
    `;
  }
}
