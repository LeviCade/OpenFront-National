import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  assessmentReportKey,
  NATIONAL_ASSESSMENT_QUOTE,
  type NationalAssessmentClientReport,
} from "./NationalAssessmentClient";
import { createNationalPoliticalRequestId } from "./NationalDiplomacyState";
import { hasTrustedNationalPrivateCapability } from "./NationalPrivateCapability";
import { SendNationalAssessmentIntentEvent } from "./Transport";
import type { GameView } from "./view";

interface PendingPurchase {
  readonly gameId: string;
  readonly actorId: string;
  readonly targetId: string;
  readonly requestId: string;
  readonly tick: number;
  readonly previousReports: ReadonlySet<string>;
}

/**
 * Sixth-original NATIONAL assessment interface. The regional reconnaissance
 * button and its map-pick remain the Fifth's separate 500-gold feature.
 *
 * Never mutates gold, grants sight or constructs an enemy report. A purchase
 * click is only a pending authenticated command until the Game projects data.
 */
@customElement("national-assessment-controls")
export class NationalAssessmentControls extends LitElement {
  @property({ attribute: false }) public game: GameView | null = null;
  @property({ attribute: false }) public eventBus: EventBus | null = null;
  @state() private selectedTarget = "";
  @state() private status = "";
  private pending: PendingPurchase | null = null;

  override createRenderRoot() {
    return this;
  }

  private get activeContext() {
    const game = this.game;
    const bus = this.eventBus;
    if (!game || !bus) return null;
    const config = game.config();
    const mode = config.gameConfig().gameType;
    const actor = game.myPlayer();
    if (
      config.gameConfig().nationalMode !== true ||
      (mode !== GameType.Private && mode !== GameType.Singleplayer) ||
      config.isReplay() ||
      game.isSpectator() ||
      game.inSpawnPhase() ||
      !actor?.isAlive() ||
      actor.hasSpawned?.() !== true ||
      game.nationalPolitics() === null ||
      game.nationalPoliticsTick() !== game.ticks()
    )
      return null;
    if (
      mode === GameType.Private &&
      (!game.trustedProjectionReady?.() ||
        !hasTrustedNationalPrivateCapability(bus, game.gameID()))
    )
      return null;
    return { game, bus, actor };
  }

  private get currentReports(): readonly NationalAssessmentClientReport[] {
    const context = this.activeContext;
    if (!context) return [];
    const view = context.game.nationalAssessments?.() ?? null;
    return view?.recipientId === context.actor.id() ? view.items : [];
  }

  /** The parent calls this on each actual GameView/Worker frame. */
  public refresh(): void {
    const context = this.activeContext;
    const pending = this.pending;
    if (!context) {
      if (pending) {
        this.pending = null;
        this.status =
          "Session authority changed; purchase outcome is unknown. No report is retained.";
      }
      this.requestUpdate();
      return;
    }
    if (pending) {
      const tick = context.game.ticks();
      if (
        context.game.gameID() !== pending.gameId ||
        context.actor.id() !== pending.actorId ||
        tick < pending.tick
      ) {
        this.pending = null;
        this.status = "Game or principal changed; purchase unconfirmed.";
      } else {
        const newReport = this.currentReports.find(
          (report) =>
            report.targetId === pending.targetId &&
            report.paidBy === pending.actorId &&
            report.effectiveTick >= pending.tick &&
            !pending.previousReports.has(assessmentReportKey(report)),
        );
        if (newReport) {
          this.pending = null;
          // E4 does not publish requestId in the projection. This validates a
          // NEW Game-paid lease, not exact-click ID correlation.
          this.status =
            "A new Game-owned paid national assessment arrived. An exact request-ID receipt is not exposed by the present server contract.";
        } else if (tick - pending.tick >= 200) {
          this.pending = null;
          this.status =
            "No new Game-owned report arrived within 200 ticks. The purchase result is unknown; review your actual gold and reports before retrying.";
        }
      }
    }
    this.requestUpdate();
  }

  private submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement)) return;
    // Do not replace the one outstanding receipt when a second click arrives.
    if (this.pending) return;
    const context = this.activeContext;
    const form = new FormData(event.currentTarget);
    const targetId = form.get("target");
    if (
      !context ||
      !this.candidates(context).some((player) => player.id() === targetId) ||
      form.get("confirm") !== "on" ||
      context.actor.gold() < NATIONAL_ASSESSMENT_QUOTE.cost
    ) {
      this.status =
        "Target, confirmation, current gold or authenticated authority invalid; no purchase sent.";
      return;
    }
    let requestId: string;
    try {
      requestId = createNationalPoliticalRequestId();
    } catch {
      this.status =
        "A secure request identifier is unavailable; no purchase sent.";
      return;
    }
    const { game, actor, bus } = context;
    this.pending = {
      gameId: game.gameID(),
      actorId: actor.id(),
      targetId: targetId as string,
      requestId,
      tick: game.ticks(),
      previousReports: new Set(this.currentReports.map(assessmentReportKey)),
    };
    this.status =
      "Assessment requested. Awaiting an actual Game-owned paid report; the browser has not spent gold or learned any strength.";
    try {
      bus.emit(
        new SendNationalAssessmentIntentEvent({
          type: "national_buy_national_assessment",
          targetId,
          requestId,
        }),
      );
    } catch {
      this.pending = null;
      this.status = "Transport failed. No assessment or payment is confirmed.";
    }
  }

  private candidates(context: {
    game: GameView;
    actor: NonNullable<ReturnType<GameView["myPlayer"]>>;
  }) {
    return context.game
      .players()
      .filter(
        (player) =>
          player.id() !== context.actor.id() &&
          player.isAlive() &&
          player.numTilesOwned() > 0 &&
          /^[A-Za-z0-9_-]{1,64}$/.test(player.id()),
      );
  }

  override render() {
    const context = this.activeContext;
    if (!context) return nothing;
    const candidates = this.candidates(context);
    const reports = this.currentReports;
    const pending = this.pending !== null;
    const canAfford = context.actor.gold() >= NATIONAL_ASSESSMENT_QUOTE.cost;
    return html`<section
      aria-label="Paid national strength assessment"
      data-national-assessment
      class="space-y-3 border-t border-white/15 pt-3"
    >
      <h2 class="font-semibold text-amber-200">National strength assessment</h2>
      <p class="text-xs text-slate-300">
        Separate from 500-gold regional map reconnaissance. The Game charges
        <strong>${NATIONAL_ASSESSMENT_QUOTE.cost.toString()} real gold</strong>
        for a ${NATIONAL_ASSESSMENT_QUOTE.durationTicks}-tick estimate of one
        nation. No map locations, hidden treaties or exact enemy resources are
        disclosed.
      </p>
      <p class="text-xs" data-national-assessment-wallet>
        Game-reported available gold: ${context.actor.gold().toString()}
      </p>
      <form
        class="space-y-2"
        data-national-assessment-form
        @submit=${this.submit}
      >
        <label class="block" for="national-assessment-target">
          Target nation
          <select
            id="national-assessment-target"
            name="target"
            required
            class="w-full min-h-11 rounded bg-slate-900 text-white p-2"
            .value=${this.selectedTarget}
            @change=${(e: Event) => {
              this.selectedTarget = (e.target as HTMLSelectElement).value;
            }}
          >
            <option value="">Select a living nation</option>
            ${candidates.map(
              (player) =>
                html`<option value=${player.id()}>${player.name()}</option>`,
            )}
          </select>
        </label>
        <label class="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirm" required class="mt-1" />
          I authorize one Game-owned debit of 1,200 gold for the chosen target.
        </label>
        <button
          type="submit"
          data-national-assessment-buy
          class="min-h-11 w-full rounded bg-amber-400 p-2 font-semibold text-slate-950 disabled:opacity-50"
          ?disabled=${pending || !canAfford || candidates.length === 0}
        >
          Purchase national assessment
        </button>
      </form>
      <p
        data-national-assessment-status
        role="status"
        aria-live="polite"
        aria-busy=${String(pending)}
        class="text-xs text-amber-200"
      >
        ${this.status}
      </p>
      <div class="space-y-2" data-national-assessment-reports>
        <h3 class="font-semibold">Current Game-issued reports</h3>
        ${
          reports.length === 0
            ? html`<p class="text-xs text-slate-300">
                No authenticated, unexpired strength reports.
              </p>`
            : reports.map(
                (report) =>
                  html`<article
                    data-national-assessment-report
                    class="rounded border border-amber-200/30 p-3 space-y-1"
                  >
                    <p class="font-semibold">
                      Target:
                      ${context.game.player(report.targetId)?.name() ?? report.targetId}
                    </p>
                    <p>
                      Paid by:
                      ${context.game.player(report.paidBy)?.name() ?? report.paidBy}
                    </p>
                    <p>
                      ${report.confidence === "shielded-coarse-estimate" ? "Shielded gold estimate" : "Gold estimate"}:
                      ${report.treasuryGoldBand.lower}–&lt;${report.treasuryGoldBand.upperExclusive}
                    </p>
                    <p>
                      ${report.confidence === "shielded-coarse-estimate" ? "Shielded troop estimate" : "Troop estimate"}:
                      ${report.militaryTroopsBand.lower}–&lt;${report.militaryTroopsBand.upperExclusive}
                    </p>
                    <p class="text-xs text-slate-300">
                      ${report.confidence === "shielded-coarse-estimate" ? "Counterassessment shield active: truthful broader purchase-time bands." : "Coarse purchase-time estimate."}
                      Not live exact values. Effective tick
                      ${report.effectiveTick}; expires at tick
                      ${report.expiresAtTick}
                      (${report.expiresAtTick - context.game.ticks()} ticks
                      remaining).
                    </p>
                  </article>`,
              )
        }
      </div>
    </section>`;
  }
}
