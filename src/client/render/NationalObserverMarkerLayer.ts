import { Cell } from "@openfront/engine-api/game/GameTypes";
import type { TransformHandler } from "../TransformHandler";
import type { GameView } from "../view/GameView";

/**
 * Native map visual for E3 unit markers for which no detailed UnitUpdate
 * has arrived (including unchanged units after a reconnect). Shapes convey
 * only the authorized coarse class, never a fabricated structure subtype.
 * It is pointer transparent and has no command interface.
 */
export class NationalObserverMarkerLayer {
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D | null;
  private lastSignature = "";

  constructor(
    private readonly game: GameView,
    private readonly transform: TransformHandler,
    webgl: HTMLCanvasElement,
  ) {
    this.canvas.id = "national-observer-unit-markers";
    this.canvas.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1";
    this.canvas.setAttribute(
      "aria-label",
      "Observed units without detailed sightings",
    );
    this.canvas.setAttribute("role", "img");
    webgl.after(this.canvas);
    this.context = this.canvas.getContext("2d");
  }

  draw(width: number, height: number, dpr: number): void {
    const ctx = this.context;
    if (!ctx || width <= 0 || height <= 0) return;
    const signature = [
      this.game.trustedObserverMarkerRevision(),
      this.transform.offsetX,
      this.transform.offsetY,
      this.transform.scale,
      width,
      height,
      dpr,
    ].join(":");
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const occupied = new Set<number>();
    const columns = Math.ceil(width / 8);
    const radius = Math.max(2, Math.min(5, this.transform.scale));
    let drawn = 0;
    const ownId = this.game.myPlayer()?.id();
    for (const marker of this.game.trustedObserverFallbackMarkers()) {
      const { x, y } = this.transform.worldToScreenCoordinates(
        new Cell(
          this.game.x(marker.tile) + 0.5,
          this.game.y(marker.tile) + 0.5,
        ),
      );
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      // At distant zoom levels overlapping markers share one screen cell.
      const cell = Math.floor(y / 8) * columns + Math.floor(x / 8);
      if (occupied.has(cell)) continue;
      occupied.add(cell);
      ctx.strokeStyle = "#102032";
      ctx.fillStyle = marker.ownerId === ownId ? "#79d9ff" : "#f8d081";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (marker.kind === "structure") {
        ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
      } else if (
        marker.kind === "warship" ||
        marker.kind === "transport" ||
        marker.kind === "trade-ship"
      ) {
        ctx.moveTo(x, y - radius);
        ctx.lineTo(x + radius, y + radius);
        ctx.lineTo(x - radius, y + radius);
        ctx.closePath();
      } else {
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
      }
      ctx.fill();
      ctx.stroke();
      drawn++;
    }
    this.canvas.dataset.observedMarkersDrawn = String(drawn);
  }

  dispose(): void {
    this.canvas.remove();
  }
}
