import type { ClientID } from "@openfront/engine-api/Schemas";
import { PlayerID } from "@openfront/engine-api/game/GameTypes";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

import { validEconomicActor } from "./NationalSanctionExecution";

export class EmbargoExecution implements Execution {
  private active = true;

  private target: Player;
  private game: Game | null = null;

  constructor(
    private player: Player,
    private targetID: PlayerID,
    private action: "start" | "stop",
    private clientId: ClientID | null = null,
  ) {}

  init(mg: Game, _: number): void {
    this.game = mg;
    if (!mg.hasPlayer(this.targetID)) {
      console.warn(`EmbargoExecution recipient ${this.targetID} not found`);
      this.active = false;
      return;
    }
    this.target = mg.player(this.targetID);
  }

  tick(_: number): void {
    if (
      this.game?.nationalWarAuthority() &&
      (!validEconomicActor(this.game, this.player, this.clientId) ||
        this.target === this.player)
    ) {
      this.active = false;
      return;
    }
    if (this.action === "start") this.player.addEmbargo(this.target, false);
    else this.player.stopEmbargo(this.target);

    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return EmbargoExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      clientId: this.clientId,
      target: this.target === undefined ? null : w.player(this.target),
      player: w.player(this.player),
      targetID: this.targetID,
      action: this.action,
    });
  }

  restoreSnapshot(s: EmbargoState, r: SnapshotReader): void {
    this.active = s.active;
    this.game = s.initialized ? r.game : null;
    this.clientId = s.clientId;
    if (s.target !== null) this.target = r.player(s.target);
    this.player = r.player(s.player);
    this.targetID = s.targetID;
    this.action = s.action;
  }
}

const EmbargoStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  clientId: z.string().nullable(),
  target: zPlayerRef().nullable(),
  player: zPlayerRef(),
  targetID: z.string(),
  action: z.enum(["start", "stop"]),
});
type EmbargoState = z.infer<typeof EmbargoStateSchema>;

export const EmbargoExecutionSnapshot = execSnapshotType({
  name: "Embargo",
  version: 2,
  migrations: {
    1: (data: unknown) => ({
      ...(data as Record<string, unknown>),
      initialized: (data as { target: unknown }).target !== null,
      clientId: null,
    }),
  },
  schema: EmbargoStateSchema,
  cls: () => EmbargoExecution,
});
