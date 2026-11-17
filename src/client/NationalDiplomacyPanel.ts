import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  createNationalFoundingRequestId,
  empireForMember,
  foundingUnavailableReason,
  nationalWarActionUnavailableReason,
  reconcileNationalFounding,
  validEmpireId,
  validNationalWarReference,
  type NationalFoundingAttempt,
} from "./NationalDiplomacyState";
import {
  SendNationalAcceptPeaceIntentEvent,
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
  private lastDiplomacySubmission: {
    gameId: string;
    actorId: string;
    tick: number;
  } | null = null;

  createRenderRoot() {
    return this;
  }

  /**
   * Only an accepted E1 journal result AND current E3 public roster can
   * confirm this button click; a restored roster by itself proves membership.
   */
  public refresh(): void {
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
      } else if (tick > submission.tick) {
        // No verified E1/E3 WAR receipt stream exists in this baseline.
        // Never upgrade transport submission to accepted at the next tick.
        this.lastDiplomacySubmission = null;
      }
    }
    if (this.expanded) this.requestUpdate();
  }

  /** A dropped or replaced session must never retain optimistic success. */
  public connectionInterrupted(): void {
    if (this.lastDiplomacySubmission !== null) {
      this.lastDiplomacySubmission = null;
      this.diplomacyStatus =
        "Connection interrupted. Previous diplomacy has no confirmed result.";
      this.diplomacyError = null;
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

  private get unavailableReason(): string | null {
    const game = this.game;
    const player = game?.myPlayer();
    return foundingUnavailableReason({
      national: game?.config().gameConfig().nationalMode === true,
      solo: game?.config().gameConfig().gameType === GameType.Singleplayer,
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
    this.message =
      "Request sent to game. Awaiting its accepted or rejected result…";
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

  /** No result journal for WAR/peace yet: submission is never success. */
  private sendDiplomacyCommand(
    command:
      | SendNationalDeclareWarIntentEvent
      | SendNationalProposePeaceIntentEvent
      | SendNationalAcceptPeaceIntentEvent,
    description: string,
  ): void {
    const reason = this.warUnavailableReason;
    const game = this.game;
    const player = game?.myPlayer();
    if (reason || !game || !player || !this.eventBus) {
      this.diplomacyError = reason ?? "The authenticated game channel is unavailable.";
      return;
    }
    const tick = game.ticks();
    if (
      this.lastDiplomacySubmission?.gameId === game.gameID() &&
      this.lastDiplomacySubmission.actorId === player.id() &&
      this.lastDiplomacySubmission.tick === tick
    ) {
      this.diplomacyError =
        "One diplomacy command is already submitted this tick. Await the next game tick.";
      return;
    }
    try {
      this.eventBus.emit(command);
      this.lastDiplomacySubmission = {
        gameId: game.gameID(),
        actorId: player.id(),
        tick,
      };
      this.diplomacyStatus =
        `${description} submitted through the game transport. The authoritative result is not yet available; no success is confirmed.`;
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
      this.diplomacyError = "Only the current emperor may declare imperial war.";
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
      new SendNationalDeclareWarIntentEvent(
        this.warScope,
        actor.id(),
        this.warTargetId,
        kind,
      ),
      `${this.warScope === "imperial" ? "Imperial" : "National"} war declaration`,
    );
  }

  private submitPeace(event: SubmitEvent, action: "propose" | "accept"): void {
    event.preventDefault();
    const reference =
      action === "propose" ? this.warIdDraft.trim() : this.motionIdDraft.trim();
    if (!validNationalWarReference(reference)) {
      this.diplomacyError =
        "Enter an exact authoritative war or motion ID (1–256 characters).";
      return;
    }
    this.sendDiplomacyCommand(
      action === "propose"
        ? new SendNationalProposePeaceIntentEvent(reference)
        : new SendNationalAcceptPeaceIntentEvent(reference),
      action === "propose" ? "Peace proposal" : "Peace motion acceptance",
    );
  }

  private playerName(id: string): string {
    return (
      this.game
        ?.players()
        .find((player) => player.id() === id)
        ?.name() ?? id
    );
  }

  private handlePanelKeyDown(event: KeyboardEvent): void {
    // Do not send game map shortcuts while editing a diplomatic ID.
    event.stopPropagation();
    if (event.key === "Escape" && this.expanded) {
      event.preventDefault();
      this.expanded = false;
    }
  }

  render() {
    const game = this.game;
    if (
      game?.config().gameConfig().nationalMode !== true ||
      game.config().gameConfig().gameType !== GameType.Singleplayer
    ) {
      return nothing;
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
    const warKind =
      this.warScope === "national" ? "nation" : this.warTargetKind;
    const warTargets = this.warTargets(warKind);
    const canIssueWar =
      warReason === null &&
      this.eventBus !== null &&
      (this.warScope === "national" || isEmperor);
    return html`
      <section
        class="text-white w-[min(25rem,calc(100vw-1rem))] max-w-full rounded-xl border border-amber-400/50 bg-slate-950/95 shadow-xl backdrop-blur-sm overflow-hidden"
        aria-label="NATIONAL diplomacy"
        data-national-phase=${this.phase}
        @keydown=${this.handlePanelKeyDown}
      >
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 px-4 py-3 font-bold text-left text-sm hover:bg-amber-400/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
          aria-controls="national-diplomacy-content"
          aria-expanded=${String(this.expanded)}
          @click=${() => (this.expanded = !this.expanded)}
        >
          <span>👑 NATIONAL · Diplomacy</span>
          <span aria-hidden="true">${this.expanded ? "▴" : "▾"}</span>
        </button>
        ${
          this.expanded
            ? html`<div
                id="national-diplomacy-content"
                class="px-4 pb-4 space-y-4 max-h-[min(65vh,32rem)] overflow-y-auto text-sm"
              >
                <p class="text-xs text-slate-300">
                  Empire membership and leadership are verified from game state.
                  Requests do not become successful until the game confirms
                  them.
                </p>
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
                            class="w-full rounded-md border border-slate-400 bg-slate-900 px-3 py-2 text-white focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-50"
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
                            class="rounded-lg bg-amber-400 px-4 py-2 font-bold text-slate-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50"
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
                  this.error
                    ? html`<p role="alert" class="text-xs text-red-300">
                        ${this.error}
                      </p>`
                    : nothing
                }


                <div class="border-t border-white/15 pt-3 space-y-3">
                  <h2 class="font-semibold text-amber-200">
                    Declare war
                  </h2>
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
                      class="w-full rounded-md border border-slate-400 bg-slate-900 px-3 py-2"
                      .value=${this.warScope}
                      @change=${(event: Event) => {
                        this.warScope = (event.target as HTMLSelectElement)
                          .value as "national" | "imperial";
                        this.warTargetId = "";
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
                            class="w-full rounded-md border border-slate-400 bg-slate-900 px-3 py-2"
                            .value=${this.warTargetKind}
                            @change=${(event: Event) => {
                              this.warTargetKind = (
                                event.target as HTMLSelectElement
                              ).value as "nation" | "empire";
                              this.warTargetId = "";
                            }}
                            ?disabled=${!canIssueWar}
                          >
                            <option value="nation">Nation</option>
                            <option value="empire">Empire</option>
                          </select>`
                        : nothing
                    }
                    <label for="national-war-target" class="block font-semibold">
                      Target
                    </label>
                    <select
                      id="national-war-target"
                      required
                      class="w-full rounded-md border border-slate-400 bg-slate-900 px-3 py-2"
                      .value=${this.warTargetId}
                      @change=${(event: Event) =>
                        (this.warTargetId = (
                          event.target as HTMLSelectElement
                        ).value)}
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
                      type="submit"
                      class="rounded-lg bg-red-600 px-4 py-2 font-bold text-white hover:bg-red-500 disabled:opacity-50"
                      ?disabled=${!canIssueWar || warTargets.length === 0 || !this.warTargetId}
                    >
                      Declare ${this.warScope === "imperial" ? "imperial" : "national"} war
                    </button>
                    ${
                      warReason || (this.warScope === "imperial" && !isEmperor)
                        ? html`<p class="text-xs text-slate-300">
                            ${warReason ??
                            "Only the current emperor may declare imperial war."}
                          </p>`
                        : nothing
                    }
                  </form>
                </div>

                <div class="border-t border-white/15 pt-3 space-y-3">
                  <h2 class="font-semibold text-amber-200">Peace</h2>
                  <p class="text-xs text-slate-300">
                    The authoritative public war/motion list is not yet
                    available. These advanced commands require an exact ID
                    recorded by the engine; no acceptance is inferred from
                    submitting them.
                  </p>
                  <form class="space-y-2" @submit=${(event: SubmitEvent) => this.submitPeace(event, "propose")}>
                    <label for="national-peace-war-id" class="block font-semibold">
                      Engine war ID
                    </label>
                    <input
                      id="national-peace-war-id"
                      type="text"
                      required
                      maxlength="256"
                      autocomplete="off"
                      class="w-full rounded-md border border-slate-400 bg-slate-900 px-3 py-2"
                      .value=${this.warIdDraft}
                      @input=${(event: Event) =>
                        (this.warIdDraft = (
                          event.target as HTMLInputElement
                        ).value)}
                      ?disabled=${warReason !== null}
                    />
                    <button
                      type="submit"
                      class="rounded-lg border border-amber-400 px-4 py-2 font-semibold text-amber-100 disabled:opacity-50"
                      ?disabled=${warReason !== null || !this.eventBus || !this.warIdDraft.trim()}
                    >
                      Propose peace
                    </button>
                  </form>
                  <form class="space-y-2" @submit=${(event: SubmitEvent) => this.submitPeace(event, "accept")}>
                    <label for="national-peace-motion-id" class="block font-semibold">
                      Engine peace motion ID
                    </label>
                    <input
                      id="national-peace-motion-id"
                      type="text"
                      required
                      maxlength="256"
                      autocomplete="off"
                      class="w-full rounded-md border border-slate-400 bg-slate-900 px-3 py-2"
                      .value=${this.motionIdDraft}
                      @input=${(event: Event) =>
                        (this.motionIdDraft = (
                          event.target as HTMLInputElement
                        ).value)}
                      ?disabled=${warReason !== null}
                    />
                    <button
                      type="submit"
                      class="rounded-lg border border-amber-400 px-4 py-2 font-semibold text-amber-100 disabled:opacity-50"
                      ?disabled=${warReason !== null || !this.eventBus || !this.motionIdDraft.trim()}
                    >
                      Accept peace
                    </button>
                  </form>
                  <p
                    class="text-xs text-amber-200"
                    role="status"
                    aria-live="polite"
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

                <div class="border-t border-white/15 pt-3 space-y-2">
                  <h2 class="font-semibold text-amber-200">
                    Other diplomatic actions
                  </h2>
                  <p class="text-xs text-slate-400">
                    Membership, succession and treaty actions are blocked
                    until authenticated execution and recipient-visible result
                    contracts are available.
                  </p>
                  ${[
                    "Invite nation",
                    "Non-aggression pact",
                    "Mutual defense pact",
                    "Empire accession",
                    "Transfer crown",
                  ].map(
                    (label) =>
                      html`<button
                        type="button"
                        disabled
                        aria-label="${label} (not yet available)"
                        title="Awaiting authenticated engine command and receipt"
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
