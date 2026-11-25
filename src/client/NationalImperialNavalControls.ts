import { GameType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { IntentSchema } from "@openfront/engine-api/Schemas";
import type { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { createNationalPoliticalRequestId } from "./NationalDiplomacyState";
import { reconcilePactReceipt } from "./NationalPactState";
import { hasTrustedNationalPrivateCapability } from "./NationalPrivateCapability";
import { SendNationalImperialPolicyIntentEvent } from "./Transport";
import type { GameView } from "./view";

const field = "block w-full min-h-11 rounded bg-slate-900 p-2";
const button =
  "min-h-11 rounded border border-amber-400/50 px-3 py-2 disabled:opacity-50";

@customElement("national-imperial-naval-controls")
export class NationalImperialNavalControls extends LitElement {
  @property({ attribute: false }) public game: GameView | null = null;
  @property({ attribute: false }) public eventBus: EventBus | null = null;
  @state() private status = "";
  private pending: {
    requestId: string;
    actorId: string;
    pactId: string;
    tick: number;
    type: "national_imperial_administration";
  } | null = null;
  private identity: string | null = null;
  private currentGame: GameView | null = null;
  private currentBus: EventBus | null = null;

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
        (!game.trustedProjectionReady() ||
          !hasTrustedNationalPrivateCapability(bus, game.gameID())))
    )
      return null;
    const empire = game
      .nationalPolitics()
      ?.empires.find(
        (e) => e.leaderId === actor.id() && e.memberIds.includes(actor.id()),
      );
    const view = game.nationalImperialAdministration();
    if (
      !empire ||
      !view?.canAmend ||
      view.empireId !== empire.id ||
      view.armyMode !== "centralized" ||
      view.warPolicyVersion === undefined ||
      view.imperialTroops === undefined
    )
      return null;
    const key = JSON.stringify([
      game.gameID(),
      game.nationalReceiptStreamId?.(),
      actor.id(),
      empire.id,
      view.warPolicyVersion,
    ]);
    const members = game
      .players()
      .filter(
        (p) =>
          empire.memberIds.includes(p.id()) && p.isAlive() && p.hasSpawned(),
      );
    const hulls = game
      .units(UnitType.Warship)
      .filter(
        (u) =>
          u.isActive() &&
          !u.isUnderConstruction() &&
          members.some((p) => p.id() === u.owner().id()),
      );
    return { game, bus, actor, empire, view, key, mode, members, hulls };
  }

  public refresh(): void {
    const c = this.context;
    if (
      !c ||
      this.identity !== c.key ||
      this.currentGame !== c.game ||
      this.currentBus !== c.bus
    ) {
      this.pending = null;
      this.status = "";
      this.identity = c?.key ?? null;
      this.currentGame = c?.game ?? null;
      this.currentBus = c?.bus ?? null;
    }
    if (c && this.pending) {
      const result =
        c.game.ticks() < this.pending.tick
          ? "conflict"
          : reconcilePactReceipt(
              c.game.nationalPactReceipts(),
              this.pending,
              c.game.ticks(),
            );
      if (result !== "pending") {
        this.pending = null;
        this.status =
          result === "accepted"
            ? "Game accepted the order. Follow the actual unit on the map."
            : result === "rejected"
              ? "Game rejected the naval order."
              : "Order outcome unconfirmed. Review the map and reserve before retrying.";
      }
    }
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.pending = null;
    this.identity = null;
    this.currentGame = null;
    this.currentBus = null;
    this.status = "";
    super.disconnectedCallback();
  }

  private submit(
    event: SubmitEvent,
    kind: "move" | "transport",
    key: string,
    game: GameView,
    bus: EventBus,
  ): void {
    event.preventDefault();
    this.refresh();
    const c = this.context;
    if (
      !c ||
      c.key !== key ||
      c.game !== game ||
      c.bus !== bus ||
      this.pending ||
      !(event.currentTarget instanceof HTMLFormElement)
    )
      return;
    const data = new FormData(event.currentTarget);
    const integer = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
    };
    const x = integer("x");
    const y = integer("y");
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      !game.isValidCoord(x, y)
    ) {
      this.status = "Choose valid map coordinates.";
      return;
    }
    const tile = game.ref(x, y);
    if (c.mode === GameType.Private && !game.trustedTileObserved(tile)) {
      this.status = "Destination is not currently observed.";
      return;
    }
    const common = {
      empireId: c.empire.id,
      gameId: game.gameID(),
      expectedVersion: c.view.warPolicyVersion,
      tile,
    };
    let command: unknown;
    if (kind === "move") {
      const hull = c.hulls.find((u) => u.id() === integer("hull"));
      if (!hull || !game.isWater(tile)) {
        this.status =
          "Select a live constituent warship and water destination.";
        return;
      }
      command = {
        ...common,
        kind: "imperial-move-warship",
        memberId: hull.owner().id(),
        unitId: hull.id(),
      };
    } else {
      const member = c.members.find((p) => p.id() === data.get("member"));
      const target = game.owner(tile);
      const amount = integer("amount");
      if (
        !member ||
        !game.isLand(tile) ||
        !target.isPlayer() ||
        c.empire.memberIds.includes(target.id()) ||
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        BigInt(amount) > BigInt(c.view.imperialTroops!)
      ) {
        this.status =
          "Select a member, opposing land, and affordable whole troop amount.";
        return;
      }
      command = {
        ...common,
        kind: "imperial-transport",
        memberId: member.id(),
        targetId: target.id(),
        amount,
      };
    }
    try {
      const requestId = createNationalPoliticalRequestId();
      const parsed = IntentSchema.safeParse({
        type: "national_imperial_administration",
        requestId,
        command,
      });
      if (!parsed.success) throw new Error("Invalid order");
      this.pending = {
        requestId,
        actorId: c.actor.id(),
        pactId: c.empire.id,
        tick: game.ticks(),
        type: "national_imperial_administration",
      };
      this.status = "Awaiting Game receipt; no action confirmed.";
      bus.emit(new SendNationalImperialPolicyIntentEvent(parsed.data));
    } catch {
      this.pending = null;
      this.status = "Naval order unavailable or transport failed.";
    }
    this.requestUpdate();
  }

  override render() {
    const c = this.context;
    if (!c) return nothing;
    const coords = html`<div class="grid grid-cols-2 gap-2">
      <label
        >Map X<input
          class=${field}
          name="x"
          type="number"
          min="0"
          step="1"
          required
      /></label>
      <label
        >Map Y<input
          class=${field}
          name="y"
          type="number"
          min="0"
          step="1"
          required
      /></label>
    </div>`;
    return keyed(
      c.key,
      html`<section
        data-national-imperial-naval
        class="space-y-3 border-t border-white/15 pt-3"
      >
        <h2 class="font-semibold text-amber-200">Imperial naval command</h2>
        <p>Imperial reserve: ${c.view.imperialTroops} troops</p>
        <form
          class="space-y-2"
          @submit=${(e: SubmitEvent) => this.submit(e, "move", c.key, c.game, c.bus)}
        >
          <label
            >Constituent warship
            <select name="hull" required class=${field}>
              <option value="">Choose an existing hull</option>
              ${c.hulls.map((u) => html`<option value=${u.id()}>${u.owner().name()} — #${u.id()}</option>`)}
            </select>
          </label>
          ${coords}
          <button
            class=${button}
            ?disabled=${!!this.pending || c.hulls.length === 0}
          >
            Order patrol
          </button>
        </form>
        <form
          class="space-y-2"
          @submit=${(e: SubmitEvent) => this.submit(e, "transport", c.key, c.game, c.bus)}
        >
          <label
            >Embark from constituent
            <select name="member" required class=${field}>
              <option value="">Choose a member</option>
              ${c.members.map((p) => html`<option value=${p.id()}>${p.name()}</option>`)}
            </select>
          </label>
          ${coords}
          <label
            >Imperial troops<input
              name="amount"
              class=${field}
              type="number"
              min="1"
              step="1"
              required
          /></label>
          <button
            class=${button}
            ?disabled=${!!this.pending || c.view.imperialTroops === "0"}
          >
            Launch expedition
          </button>
        </form>
        <p role="status" aria-live="polite">${this.status}</p>
      </section>`,
    );
  }
}
