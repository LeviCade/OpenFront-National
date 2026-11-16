import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  empireForMember,
  foundingUnavailableReason,
  validEmpireId,
} from "./NationalDiplomacyState";
import { SendNationalFoundEmpireIntentEvent } from "./Transport";
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
  @state() private message: string | null = null;
  @state() private error: string | null = null;

  createRenderRoot() {
    return this;
  }

  /** Called by the live sidebar controller after the worker applies a tick. */
  public refresh(): void {
    const player = this.game?.myPlayer();
    const politics = this.game?.nationalPolitics() ?? null;
    const empire = player ? empireForMember(politics, player.id()) : null;
    if (this.pendingEmpireId && empire) {
      // Membership from the game packet, NOT an acknowledgement of enqueue.
      this.pendingEmpireId = null;
      this.message = `Confirmed by game: your nation belongs to ${empire.id}.`;
      this.error = null;
    } else if (this.pendingEmpireId && player) {
      const outcome = this.game?.nationalFoundingOutcome();
      if (
        outcome?.actorId === player.id() &&
        outcome.empireId === this.pendingEmpireId &&
        outcome.accepted === false
      ) {
        this.pendingEmpireId = null;
        this.message = null;
        this.error = outcome.reason ?? "The game rejected empire founding.";
      }
    }
    if (this.expanded) this.requestUpdate();
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

    // Set the latch BEFORE emitting so duplicate clicks/key activation cannot
    // enqueue two commands in the same frame. Transport's normal sendIntent
    // passes through the existing intent gate and stamped game pipeline.
    this.pendingEmpireId = empireId;
    this.error = null;
    this.message = "Founding request sent. Awaiting authoritative game state…";
    try {
      this.eventBus.emit(new SendNationalFoundEmpireIntentEvent(empireId));
    } catch {
      // Only a synchronous producer failure may clear the local latch.
      // An enqueued command is never equated with a successful execution.
      this.pendingEmpireId = null;
      this.message = null;
      this.error = "Could not send the founding command to the game.";
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
      game.config().gameConfig().gameType !== GameType.Singleplayer ||
      game.config().isReplay()
    ) {
      return nothing;
    }
    const politics = game.nationalPolitics();
    const ownEmpire = this.memberEmpire;
    const canFound = this.unavailableReason === null;
    return html`
      <section
        class="text-white w-[min(25rem,calc(100vw-1rem))] max-w-full rounded-xl border border-amber-400/50 bg-slate-950/95 shadow-xl backdrop-blur-sm overflow-hidden"
        aria-label="NATIONAL diplomacy"
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
                        <p id="national-id-help" class="text-xs text-slate-400">
                          1–64 letters, digits, underscores or hyphens.
                        </p>
                        <button
                          type="submit"
                          class="rounded-lg bg-amber-400 px-4 py-2 font-bold text-slate-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50"
                          ?disabled=${!canFound || !this.eventBus}
                        >
                          ${this.pendingEmpireId ? "Founding requested…" : "Found Empire"}
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

                <div class="border-t border-white/15 pt-3 space-y-2">
                  <h2 class="font-semibold text-amber-200">
                    Diplomatic actions
                  </h2>
                  <p class="text-xs text-slate-400">
                    Further actions require authenticated game command
                    contracts.
                  </p>
                  ${[
                    "Invite nation",
                    "Non-aggression pact",
                    "Mutual defense pact",
                    "Offer peace",
                  ].map(
                    (label) =>
                      html`<button
                        type="button"
                        disabled
                        aria-label="${label} (not yet available)"
                        title="Awaiting authenticated engine command"
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
