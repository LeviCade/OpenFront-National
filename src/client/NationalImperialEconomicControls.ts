import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { ImperialReliefView } from "@openfront/engine-api/game/NationalImperialView";
import type { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createNationalPoliticalRequestId } from "./NationalDiplomacyState";
import {
  reliefDecisionAllowed,
  reliefIntent,
  validReliefAmount,
  type ReliefCommand,
} from "./NationalImperialReliefControls";
import { reconcilePactReceipt } from "./NationalPactState";
import { hasTrustedNationalPrivateCapability } from "./NationalPrivateCapability";
import { SendNationalImperialPolicyIntentEvent } from "./Transport";
import type { GameView } from "./view";

const button =
  "min-h-11 rounded border border-amber-400/50 px-3 py-2 disabled:opacity-50 focus-visible:outline focus-visible:outline-2";

interface Attempt {
  readonly actorId: string;
  readonly pactId: string;
  readonly tick: number;
  readonly requestId: string;
  readonly type: "national_imperial_administration";
  readonly command: ReliefCommand;
}

/** No local balances, optimistic grants, or settlement inference. */
@customElement("national-imperial-economic-controls")
export class NationalImperialEconomicControls extends LitElement {
  @property({ attribute: false }) public game: GameView | null = null;
  @property({ attribute: false }) public eventBus: EventBus | null = null;
  @state() private amount = "";
  @state() private status = "";
  private pending: Attempt | null = null;
  private identity: {
    game: GameView;
    bus: EventBus;
    key: string;
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
      actor.hasSpawned?.() !== true ||
      game.nationalPoliticsTick?.() !== game.ticks() ||
      (mode === GameType.Private &&
        (!game.trustedProjectionReady?.() ||
          !hasTrustedNationalPrivateCapability(bus, game.gameID())))
    )
      return null;
    const empire = game
      .nationalPolitics()
      ?.empires.find((e) => e.memberIds.includes(actor.id()));
    const view = game.nationalImperialAdministration?.();
    if (
      !empire ||
      !view ||
      view.empireId !== empire.id ||
      view.canAmend !== (empire.leaderId === actor.id()) ||
      view.reliefRequests === undefined
    )
      return null;
    const rows = view.reliefRequests.filter(
      (row) =>
        row.empireId === empire.id &&
        (view.canAmend || row.memberId === actor.id()),
    );
    return { game, bus, actor, empire, view, rows };
  }

  public refresh(): void {
    const context = this.context;
    const key = context
      ? JSON.stringify([
          context.game.gameID(),
          context.game.nationalReceiptStreamId?.(),
          context.actor.id(),
          context.empire.id,
          context.empire.leaderId,
        ])
      : "";
    if (
      !context ||
      this.identity?.game !== context.game ||
      this.identity?.bus !== context.bus ||
      this.identity?.key !== key
    ) {
      this.pending = null;
      this.amount = "";
      this.status = "";
      this.identity = context
        ? { game: context.game, bus: context.bus, key }
        : null;
    }
    const attempt = this.pending;
    if (context && attempt) {
      const tick = context.game.ticks();
      const result = reconcilePactReceipt(
        context.game.nationalPactReceipts(),
        attempt,
        tick,
      );
      const row = context.rows.find(
        (item) => item.reliefId === attempt.command.reliefId,
      );
      const command = attempt.command;
      const confirmed =
        command.kind === "request-relief"
          ? row?.memberId === attempt.actorId && row.amount === command.amount
          : row?.version === command.expectedVersion + 1 &&
            row.decidedBy === attempt.actorId &&
            row.status ===
              (command.decision === "approve" ? "approved" : "rejected");
      if (tick < attempt.tick || result === "conflict") {
        this.pending = null;
        this.status = "Conflicting or rewound Game evidence; outcome unknown.";
      } else if (result === "rejected") {
        this.pending = null;
        this.status = "Game rejected the relief command.";
      } else if (result === "accepted" && confirmed) {
        this.pending = null;
        this.status =
          command.kind === "request-relief"
            ? "Game recorded the relief request."
            : "Game confirmed the relief decision. Balances below are authoritative.";
      } else if (tick - attempt.tick >= 200) {
        this.pending = null;
        this.status =
          "Exact relief outcome unconfirmed. Review the Game ledger before retrying.";
      }
    }
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.pending = null;
    this.identity = null;
    this.amount = "";
    this.status = "";
    super.disconnectedCallback();
  }

  private submitRequest(
    event: SubmitEvent,
    displayed: string,
    game: GameView,
    bus: EventBus,
  ): void {
    event.preventDefault();
    this.refresh();
    const context = this.context;
    if (
      !context ||
      context.view.canAmend ||
      this.pending ||
      this.identity?.key !== displayed ||
      context.game !== game ||
      context.bus !== bus
    )
      return;
    if (!(event.currentTarget instanceof HTMLFormElement)) return;
    const form = new FormData(event.currentTarget);
    const amount = form.get("amount");
    if (!validReliefAmount(amount) || form.get("confirm") !== "on") {
      this.status =
        "Enter a positive whole gold amount and confirm the request.";
      return;
    }
    this.send((requestId) => ({
      kind: "request-relief",
      empireId: context.empire.id,
      reliefId: requestId,
      amount,
    }));
  }

  private decide(
    displayed: ImperialReliefView,
    decision: "approve" | "reject",
    displayedKey: string,
    game: GameView,
    bus: EventBus,
  ): void {
    this.refresh();
    const context = this.context;
    if (
      !context ||
      this.pending ||
      this.identity?.key !== displayedKey ||
      context.game !== game ||
      context.bus !== bus
    )
      return;
    const row = context.rows.find((r) => r.reliefId === displayed.reliefId);
    if (
      !row ||
      row.memberId !== displayed.memberId ||
      row.amount !== displayed.amount ||
      row.version !== displayed.version ||
      !reliefDecisionAllowed(context.view, context.actor.id(), row, decision)
    ) {
      this.status =
        "Relief request or authority changed; review the current ledger.";
      return;
    }
    this.send(() => ({
      kind: "decide-relief",
      empireId: context.empire.id,
      reliefId: row.reliefId,
      expectedVersion: row.version,
      decision,
    }));
  }

  private send(create: (requestId: string) => ReliefCommand): void {
    const context = this.context;
    if (!context || this.pending) return;
    try {
      const requestId = createNationalPoliticalRequestId();
      const command = create(requestId);
      const intent = reliefIntent(command, requestId);
      if (!intent) throw new Error("Invalid relief command");
      this.identity = {
        game: context.game,
        bus: context.bus,
        key: JSON.stringify([
          context.game.gameID(),
          context.game.nationalReceiptStreamId?.(),
          context.actor.id(),
          context.empire.id,
          context.empire.leaderId,
        ]),
      };
      this.pending = {
        actorId: context.actor.id(),
        pactId: context.empire.id,
        requestId,
        tick: context.game.ticks(),
        type: "national_imperial_administration",
        command,
      };
      this.status =
        "Awaiting the Game-owned relief receipt; no transfer confirmed.";
      context.bus.emit(new SendNationalImperialPolicyIntentEvent(intent));
    } catch {
      this.pending = null;
      this.status =
        "Relief command unavailable or transport failed; outcome unconfirmed.";
    }
    this.requestUpdate();
  }

  override render() {
    const context = this.context;
    if (!context) return nothing;
    const { actor, view, rows, game, bus, empire } = context;
    const displayedKey = JSON.stringify([
      game.gameID(),
      game.nationalReceiptStreamId?.(),
      actor.id(),
      empire.id,
      empire.leaderId,
    ]);
    const busy = this.pending !== null;
    return html`
      <section
        aria-label="Imperial emergency relief"
        data-national-imperial-relief
        class="space-y-3 border-t border-white/15 pt-3"
      >
        <h2 class="font-semibold text-amber-200">Imperial emergency relief</h2>
        <p>Game treasury: ${view.treasury} gold</p>
        <p>Game wallet: ${actor.gold().toString()} gold</p>
        ${
          view.canAmend
            ? nothing
            : html`
                <form
                  @submit=${(event: SubmitEvent) =>
                    this.submitRequest(event, displayedKey, game, bus)}
                  class="space-y-2"
                >
                  <label class="block">
                    Requested gold
                    <input
                      name="amount"
                      inputmode="numeric"
                      pattern="[1-9][0-9]{0,11}"
                      maxlength="12"
                      required
                      class="block w-full min-h-11 rounded bg-slate-900 p-2"
                      .value=${this.amount}
                      @input=${(event: Event) => {
                        this.amount = (event.target as HTMLInputElement).value;
                      }}
                    />
                  </label>
                  <label class="block">
                    <input name="confirm" type="checkbox" required />
                    Request assistance from the current emperor.
                  </label>
                  <button type="submit" class=${button} ?disabled=${busy}>
                    Request emergency relief
                  </button>
                </form>
              `
        }
        <p role="status" aria-live="polite" aria-busy=${String(busy)}>
          ${this.status}
        </p>
        ${
          rows.length === 0
            ? html`<p>No Game-reported relief requests.</p>`
            : rows.map(
                (row) => html`
                  <article
                    data-relief-id=${row.reliefId}
                    class="space-y-2 rounded border border-white/20 p-2"
                  >
                    <p>
                      ${
                        context.game
                          .players()
                          .find((p) => p.id() === row.memberId)
                          ?.name() ?? row.memberId
                      }:
                      ${row.amount} gold — ${row.status}
                    </p>
                    ${
                      row.status === "approved"
                        ? html`<p>
                            Approved by the Game. Use normal construction
                            controls to spend available wallet gold.
                          </p>`
                        : nothing
                    }
                    ${
                      view.canAmend &&
                      row.status === "pending" &&
                      row.memberId !== actor.id()
                        ? html`
                            <div class="flex flex-wrap gap-2">
                              <button
                                type="button"
                                data-relief-approve
                                class=${button}
                                ?disabled=${
                                  busy ||
                                  !reliefDecisionAllowed(
                                    view,
                                    actor.id(),
                                    row,
                                    "approve",
                                  )
                                }
                                @click=${() => this.decide(row, "approve", displayedKey, game, bus)}
                              >
                                Approve ${row.amount} gold
                              </button>
                              <button
                                type="button"
                                data-relief-reject
                                class=${button}
                                ?disabled=${
                                  busy ||
                                  !reliefDecisionAllowed(
                                    view,
                                    actor.id(),
                                    row,
                                    "reject",
                                  )
                                }
                                @click=${() => this.decide(row, "reject", displayedKey, game, bus)}
                              >
                                Reject request
                              </button>
                            </div>
                          `
                        : nothing
                    }
                  </article>
                `,
              )
        }
      </section>
    `;
  }
}
