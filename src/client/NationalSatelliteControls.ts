import { GameType } from "@openfront/engine-api/game/GameTypes";
import {
  NATIONAL_SATELLITE_COST,
  NATIONAL_SATELLITE_DURATION_TICKS,
  NATIONAL_SATELLITE_REQUEST_WINDOW,
} from "@openfront/engine-api/game/NationalSatelliteView";
import type { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createNationalPoliticalRequestId } from "./NationalDiplomacyState";
import { hasTrustedNationalPrivateCapability } from "./NationalPrivateCapability";
import { SendNationalSatelliteIntentEvent } from "./Transport";
import type { GameView } from "./view";

@customElement("national-satellite-controls")
export class NationalSatelliteControls extends LitElement {
  @property({ attribute: false }) public game: GameView | null = null;
  @property({ attribute: false }) public eventBus: EventBus | null = null;
  @state() private status = "";
  private pending: {
    game: GameView;
    bus: EventBus;
    key: string;
    requestId: string;
    tick: number;
  } | null = null;

  override createRenderRoot() {
    return this;
  }

  private get context() {
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
      !actor.hasSpawned?.() ||
      game.nationalPoliticsTick?.() !== game.ticks()
    ) return null;
    if (mode === GameType.Private &&
      (!game.trustedProjectionReady?.() ||
        !hasTrustedNationalPrivateCapability(bus, game.gameID())))
      return null;
    const key = JSON.stringify([
      game.gameID(),
      actor.id(),
      game.nationalReceiptStreamId?.(),
    ]);
    const view = game.nationalSatellite?.();
    const lease = view?.recipientId === actor.id() && view.tick === game.ticks()
      ? view.lease : null;
    return { game, bus, actor, key, lease };
  }

  public refresh(): void {
    const context = this.context;
    const pending = this.pending;
    if (pending) {
      if (!context || context.game !== pending.game ||
        context.bus !== pending.bus || context.key !== pending.key ||
        context.game.ticks() < pending.tick) {
        this.pending = null;
        this.status = "Session changed; payment unconfirmed.";
      } else if (context.lease?.requestId === pending.requestId &&
        context.lease.effectiveTick >= pending.tick) {
        this.pending = null;
        this.status = "";
      } else if (context.game.ticks() - pending.tick > NATIONAL_SATELLITE_REQUEST_WINDOW + 5) {
        this.pending = null;
        this.status = "No matching paid lease received; purchase unconfirmed.";
      }
    }
    this.requestUpdate();
  }

  private submit(event: SubmitEvent, displayedKey: string): void {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement)) return;
    const context = this.context;
    if (!context || context.key !== displayedKey || this.pending ||
      context.lease !== null || context.actor.gold() < NATIONAL_SATELLITE_COST ||
      new FormData(event.currentTarget).get("confirm") !== "on") return;
    const { game, bus, key } = context;
    try {
      const requestId = createNationalPoliticalRequestId();
      const tick = game.ticks();
      this.pending = { game, bus, key, requestId, tick };
      this.status = "Submitted; awaiting matching authoritative paid lease.";
      bus.emit(new SendNationalSatelliteIntentEvent({
        type: "national_buy_satellite_recon",
        gameId: game.gameID(),
        issuedTick: tick,
        requestId,
      }));
    } catch {
      this.pending = null;
      this.status = "Transport failed; payment unconfirmed.";
    }
  }

  render() {
    const context = this.context;
    if (!context) return nothing;
    const { lease, game, actor, key } = context;
    return html`<section class="space-y-2 border-t border-white/15 pt-3"
      aria-label="Global satellite reconnaissance" data-national-satellite>
      <h2 class="font-semibold text-amber-200">Global satellite intelligence</h2>
      <p class="text-xs text-slate-300">
        ${NATIONAL_SATELLITE_COST.toString()} personal gold ·
        ${NATIONAL_SATELLITE_DURATION_TICKS} ticks. Live worldwide structure and vessel
        positions appear on the existing intelligence map; no foreign resources,
        private terms or transport destinations. Shared with current empire members.
      </p>
      <form @submit=${(event: SubmitEvent) => this.submit(event, key)}>
        <label class="flex gap-2"><input type="checkbox" name="confirm" required />
          Confirm satellite purchase</label>
        <button type="submit" data-national-buy-satellite
          class="min-h-11 w-full rounded bg-amber-400 p-2 text-slate-950 disabled:opacity-50"
          ?disabled=${this.pending !== null || lease !== null ||
            actor.gold() < NATIONAL_SATELLITE_COST}>Purchase satellite reconnaissance</button>
      </form>
      <p role="status" aria-live="polite" data-national-satellite-status>
        ${lease !== null
          ? "Active paid satellite lease: " + (lease.expiresAtTick - game.ticks()) + " ticks remaining"
          : this.status}
      </p>
    </section>`;
  }
}
