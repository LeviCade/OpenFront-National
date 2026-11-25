import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { ClientID } from "@openfront/engine-api/Schemas";
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

export class EmbargoAllExecution implements Execution {
  constructor(
    private player: Player,
    private action: "start" | "stop",
    private clientId: ClientID | null = null,
  ) {}

  init(mg: Game, _: number): void {
    const national = mg.nationalWarAuthority() !== null;
    if (national && !validEconomicActor(mg, this.player, this.clientId)) return;
    if (!this.player.canEmbargoAll()) {
      return;
    }
    const me = this.player;
    for (const p of mg.players()) {
      if (p.id() === me.id()) continue;
      if (p.type() === PlayerType.Bot) continue;
      if (me.isOnSameTeam(p)) continue;
      if (me.isAlliedWith(p)) continue;

      if (this.action === "start") {
        if (national || !me.hasEmbargoAgainst(p)) {
          me.addEmbargo(p, false);
        }
      } else {
        if (me.hasEmbargoAgainst(p)) me.stopEmbargo(p);
      }
    }

    this.player.recordEmbargoAll();
  }

  tick(_: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return EmbargoAllExecutionSnapshot.write({
      player: w.player(this.player),
      clientId: this.clientId,
      action: this.action,
    });
  }

  restoreSnapshot(s: EmbargoAllState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.clientId = s.clientId;
    this.action = s.action;
  }
}

const EmbargoAllStateSchema = z.object({
  player: zPlayerRef(),
  clientId: z.string().nullable(),
  action: z.enum(["start", "stop"]),
});
type EmbargoAllState = z.infer<typeof EmbargoAllStateSchema>;

export const EmbargoAllExecutionSnapshot = execSnapshotType({
  name: "EmbargoAll",
  version: 2,
  migrations: {
    1: (data: unknown) => ({
      ...(data as Record<string, unknown>),
      clientId: null,
    }),
  },
  schema: EmbargoAllStateSchema,
  cls: () => EmbargoAllExecution,
});
