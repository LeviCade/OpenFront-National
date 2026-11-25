import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { NationalSettlementRow } from "@openfront/engine-api/game/NationalSettlementView";
import type { Intent } from "@openfront/engine-api/Schemas";
import type { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createNationalPoliticalRequestId } from "./NationalDiplomacyState";
import { settlementDecisionIntent, settlementOfferIntent } from "./NationalImperialSettlementIntentControls";
import { hasTrustedNationalPrivateCapability } from "./NationalPrivateCapability";
import { SendNationalSettlementIntentEvent } from "./Transport";
import type { GameView } from "./view";

const button = "min-h-11 rounded border border-amber-400/50 px-3 py-2 disabled:opacity-50 focus-visible:outline focus-visible:outline-2";
type Pending = { key: string; offerId: string; tick: number; kind: "offer" | "decision" };
function key(row: NationalSettlementRow): string {
  return JSON.stringify([row.sanctionId, row.payerId, row.issuerId, row.role]);
}

@customElement("national-imperial-settlement-controls")
export class NationalImperialSettlementControls extends LitElement {
  @property({ attribute: false }) public game: GameView | null = null;
  @property({ attribute: false }) public eventBus: EventBus | null = null;
  @state() private status = "";
  private pending: Pending | null = null;
  private session: { game: GameView; bus: EventBus; actorId: string; gameId: string; tick: number } | null = null;

  override createRenderRoot() { return this; }

  private get context() {
    const game = this.game;
    const bus = this.eventBus;
    if (!game || !bus) return null;
    const config = game.config();
    const mode = config.gameConfig().gameType;
    const actor = game.myPlayer();
    const view = game.nationalSettlements?.();
    if (
      config.gameConfig().nationalMode !== true ||
      (mode !== GameType.Private && mode !== GameType.Singleplayer) ||
      config.isReplay() || game.isSpectator() || game.inSpawnPhase() ||
      !actor?.isAlive() || actor.hasSpawned?.() !== true ||
      game.nationalPoliticsTick?.() !== game.ticks() ||
      (mode === GameType.Private && (!game.trustedProjectionReady?.() ||
        !hasTrustedNationalPrivateCapability(bus, game.gameID()))) ||
      !view || view.recipientId !== actor.id() || view.tick !== game.ticks()
    ) return null;
    return { game, bus, actor, rows: view.items, paidMaritimeGold: view.paidMaritimeGold };
  }

  public refresh(): void {
    const c = this.context;
    const s = this.session;
    if (!c || !s || s.game !== c.game || s.bus !== c.bus ||
      s.actorId !== c.actor.id() || s.gameId !== c.game.gameID() || s.tick > c.game.ticks()) {
      this.pending = null;
      this.status = "";
    }
    this.session = c ? { game: c.game, bus: c.bus, actorId: c.actor.id(), gameId: c.game.gameID(), tick: c.game.ticks() } : null;
    const attempt = this.pending;
    if (c && attempt) {
      const offer = c.rows.find((row) => key(row) === attempt.key)?.offer;
      if (offer?.requestId === attempt.offerId &&
        (attempt.kind === "offer" || offer.status !== "pending")) {
        this.pending = null;
        this.status = attempt.kind === "offer"
          ? "Game recorded this exact settlement offer."
          : "Game reports the offer " + offer.status + "; no separate decision-click receipt is available.";
      } else if (c.game.ticks() - attempt.tick >= 200) {
        this.pending = null;
        this.status = "Outcome unconfirmed. Review the authoritative offer before retrying.";
      }
    }
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.pending = null;
    this.session = null;
    this.status = "";
    super.disconnectedCallback();
  }

  private send(
    displayed: NationalSettlementRow,
    game: GameView,
    bus: EventBus,
    actorId: string,
    build: (row: NationalSettlementRow, requestId: string, wallet: bigint, tick: number) => Intent | null,
    kind: Pending["kind"],
  ): void {
    this.refresh();
    const c = this.context;
    if (!c || this.pending || c.game !== game || c.bus !== bus || c.actor.id() !== actorId) return;
    const row = c.rows.find((r) => key(r) === key(displayed));
    if (!row || JSON.stringify(row.offer) !== JSON.stringify(displayed.offer)) {
      this.status = "Offer or authority changed. Review the current ledger.";
      return;
    }
    try {
      const id = createNationalPoliticalRequestId();
      const intent = build(row, id, c.actor.gold(), game.ticks());
      if (!intent) {
        this.status = "Invalid amount, funds, or current settlement authority.";
        return;
      }
      this.pending = { key: key(row), offerId: kind === "offer" ? id : row.offer!.requestId, tick: game.ticks(), kind };
      this.status = "Awaiting Game evidence. No payment or restored commerce confirmed.";
      bus.emit(new SendNationalSettlementIntentEvent(intent));
    } catch {
      this.pending = null;
      this.status = "Transport unavailable; settlement outcome unconfirmed.";
    }
    this.requestUpdate();
  }

  override render() {
    const c = this.context;
    if (!c || c.rows.length === 0) return nothing;
    const { game, bus, actor, rows, paidMaritimeGold } = c;
    const actorId = actor.id();
    const busy = this.pending !== null;
    return html`
      <section aria-label="Embargo restitution" data-national-settlement class="space-y-3 border-t border-white/15 pt-3">
        <h2 class="font-semibold text-amber-200">Embargo restitution</h2>
        <p>Game wallet: ${actor.gold().toString()} gold</p>
        <p>Game-recorded lifetime maritime earnings: ${paidMaritimeGold} gold (all routes, not a specific voyage receipt).</p>
        <p role="status" aria-live="polite">${this.status}</p>
        ${rows.map((row) => html`
          <article data-sanction-id=${row.sanctionId} class="space-y-2 rounded border border-white/20 p-2">
            <p>Sanction ${row.sanctionId} — ${row.role === "payer" ? "Issuer: " + row.issuerId : "Payer: " + row.payerId}</p>
            <p>Game trade permission: ${row.tradePermitted ? "permitted" : "restricted"}. Permission alone does not prove a paid voyage.</p>
            ${row.offer ? html`<p>Game offer: ${row.offer.gold} gold — ${row.offer.status}.</p>` : nothing}
            ${row.offer?.status === "accepted" ? html`<p>Game recorded a paid settlement; other trade restrictions may remain.</p>` : nothing}
            ${row.canOffer ? html`
              <form class="space-y-2" @submit=${(event: SubmitEvent) => {
                event.preventDefault();
                if (!(event.currentTarget instanceof HTMLFormElement)) return;
                const data = new FormData(event.currentTarget);
                if (data.get("confirm") !== "on") return;
                this.send(row, game, bus, actorId, (current, id, wallet) => settlementOfferIntent(current, actorId, wallet, data.get("amount"), id), "offer");
              }}>
                <label class="block">Restitution gold <input class="block w-full min-h-11 rounded bg-slate-900 p-2" name="amount" required inputmode="numeric" pattern="[1-9][0-9]{0,17}" maxlength="18" /></label>
                <label class="block"><input name="confirm" type="checkbox" required /> Authorize this funded offer.</label>
                <button class=${button} type="submit" ?disabled=${busy}>Propose restitution</button>
              </form>
            ` : nothing}
            ${row.role === "issuer" && row.offer?.status === "pending" ? html`
              <div class="flex flex-wrap gap-2">
                ${(["accept", "refuse"] as const).map((decision) => html`
                  <button class=${button} type="button" data-settlement-decision=${decision}
                    ?disabled=${busy || !(decision === "accept" ? row.canAccept : row.canRefuse)}
                    @click=${() => this.send(row, game, bus, actorId, (current, id, _wallet, tick) => settlementDecisionIntent(current, actorId, tick, decision, id), "decision")}>
                    ${decision === "accept" ? "Accept payment" : "Reject offer"}
                  </button>
                `)}
              </div>
            ` : nothing}
          </article>
        `)}
      </section>
    `;
  }
}
