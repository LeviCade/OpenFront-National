import { Cell, GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus, GameEvent } from "@openfront/shared/EventBus";
import { Controller } from "../Controller";
import { TransformHandler } from "../TransformHandler";
import type { GameView } from "../view";

/** A user's actual WAR target selection, NOT an attack or authorization. */
export class NationalMapTargetSelectedEvent implements GameEvent {
  constructor(public readonly playerId: string | null) {}
}

/**
 * A genuine game-owned tile is the only acceptable clickable locator.
 * Never infer territory from labels, a previous selection, or map pixels.
 */
export function isNationalOpponentTile(
  game: GameView,
  transform: TransformHandler,
  targetPlayerId: string,
  screenX: number,
  screenY: number,
): boolean {
  // E3 may revoke a page while this marker is on screen. Do not expose
  // a former enemy tile from a stale, disconnected Private projection.
  if (
    game.isTrustedNationalProjection?.() === true &&
    !game.trustedProjectionReady?.()
  )
    return false;
  const point = transform.screenToWorldCoordinates(screenX, screenY);
  if (!game.isValidCoord(point.x, point.y)) return false;
  const tile = game.ref(point.x, point.y);
  if (!game.isLand(tile)) return false;
  // Current seat + owner bytes are insufficient: the tile itself must be
  // present in the authenticated, currently observed recipient map page.
  if (
    game.isTrustedNationalProjection?.() === true &&
    game.trustedTileObserved(tile) !== true
  )
    return false;
  const owner = game.owner(tile);
  return owner.isPlayer() && owner.id() === targetPlayerId;
}

/**
 * A visual, pointer-transparent marker *on* a selected opponent's real tile.
 * It does not intercept a click, issue an attack, or fake a Game update.
 * A visible marker always passes the SAME topmost-canvas check as real CDP
 * pointer input (the overlay cannot conceal a failed map hit).
 */
export class NationalMapTargetController implements Controller {
  private targetId: string | null = null;
  private marker: HTMLDivElement | null = null;

  constructor(
    private readonly game: GameView,
    private readonly bus: EventBus,
    private readonly transform: TransformHandler,
    private readonly inputSurface: HTMLElement,
  ) {}

  private readonly onSelection = (event: NationalMapTargetSelectedEvent) => {
    this.targetId = event.playerId;
    this.tick();
  };

  private readonly onLeave = () => this.dispose();

  public init(): void {
    if (
      this.game.config().gameConfig().nationalMode !== true ||
      this.game.config().isReplay() ||
      (this.game.config().gameConfig().gameType !== GameType.Singleplayer &&
        this.game.isTrustedNationalProjection?.() !== true)
    )
      return;
    this.marker = document.createElement("div");
    this.marker.hidden = true;
    this.marker.style.cssText =
      "position:fixed;pointer-events:none;z-index:20;" +
      "width:12px;height:12px;border:2px solid #fbbf24;" +
      "border-radius:50%;box-shadow:0 0 0 2px #0f172a99;" +
      "transform:translate(-50%,-50%);";
    this.marker.setAttribute("role", "img");
    this.marker.setAttribute(
      "aria-label",
      "Selected NATIONAL opponent territory",
    );
    document.body.appendChild(this.marker);
    this.bus.on(NationalMapTargetSelectedEvent, this.onSelection);
    document.addEventListener("leave-lobby", this.onLeave);
  }

  public getTickIntervalMs(): number {
    return 200;
  }

  private unobstructed(x: number, y: number): boolean {
    const r = this.inputSurface.getBoundingClientRect();
    if (
      r.width <= 0 ||
      r.height <= 0 ||
      x < r.left + 4 ||
      x >= r.right - 4 ||
      y < r.top + 4 ||
      y >= r.bottom - 4
    )
      return false;
    const top = document.elementFromPoint(x, y);
    return top === this.inputSurface || this.inputSurface.contains(top);
  }

  public tick(): void {
    if (!this.marker) return;
    const id = this.targetId;
    const viewer = this.game.myPlayer();
    if (
      !id ||
      !viewer ||
      (this.game.isTrustedNationalProjection?.() === true &&
        !this.game.trustedProjectionReady?.()) ||
      this.game.inSpawnPhase() ||
      this.game.isSpectator() ||
      !viewer.isAlive()
    ) {
      this.hide();
      return;
    }
    const player = this.game
      .players()
      .find(
        (item) =>
          item.id() === id &&
          item.isAlive() &&
          item.hasSpawned() &&
          item.numTilesOwned() > 0,
      );
    if (!player || player.id() === viewer.id()) {
      this.hide();
      return;
    }
    const r = this.inputSurface.getBoundingClientRect();
    const candidates: { x: number; y: number }[] = [];
    const location = player.nameLocation();
    if (location) {
      candidates.push(
        this.transform.worldToScreenCoordinates(
          new Cell(location.x + 0.5, location.y + 0.5),
        ),
      );
    }
    // Small visible opponent patches can be away from their label. Sample
    // actual screen-to-world tile ownership, never arbitrary canvas clicks.
    for (let row = 1; row <= 11; row++) {
      for (let col = 1; col <= 15; col++) {
        candidates.push({
          x: r.left + (r.width * col) / 16,
          y: r.top + (r.height * row) / 12,
        });
      }
    }
    const valid = candidates
      .filter(
        ({ x, y }) =>
          this.unobstructed(x, y) &&
          isNationalOpponentTile(this.game, this.transform, id, x, y),
      )
      .sort((a, b) => {
        const ac =
          (a.x - r.left - r.width / 2) ** 2 + (a.y - r.top - r.height / 2) ** 2;
        const bc =
          (b.x - r.left - r.width / 2) ** 2 + (b.y - r.top - r.height / 2) ** 2;
        return ac - bc;
      })[0];
    if (!valid) {
      this.hide();
      return;
    }
    this.marker.hidden = false;
    this.marker.setAttribute("data-national-map-target-id", id);
    this.marker.style.left = valid.x + "px";
    this.marker.style.top = valid.y + "px";
  }

  private hide(): void {
    if (!this.marker) return;
    this.marker.hidden = true;
    this.marker.removeAttribute("data-national-map-target-id");
  }

  public dispose(): void {
    this.bus.off(NationalMapTargetSelectedEvent, this.onSelection);
    document.removeEventListener("leave-lobby", this.onLeave);
    this.marker?.remove();
    this.marker = null;
    this.targetId = null;
  }
}
