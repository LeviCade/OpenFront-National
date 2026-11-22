/**
 * E3 source acceptance: trusted private host, actual stamped turn, executor,
 * authority checks and replay witness. No browser-controlled actor identity.
 */
import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import {
  StampedIntentSchema,
  type GameConfig,
} from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationalSanctionExecution } from "@openfront/engine/execution/NationalSanctionExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { Client } from "../../src/server/Client";
import { TrustedNationalMatch } from "../../src/server/national/TrustedNationalMatch";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const MATCH = "C4E3ECO01";
const [A, B, C, D] = ["E3NATIONA", "E3NATIONB", "E3NATIONC", "E3NATIOND"];
const clients = ["E3CLIENTA", "E3CLIENTB", "E3CLIENTC", "E3CLIENTD"];
const roster = [A, B, C, D].map(
  (id, i) => new PlayerInfo(id, PlayerType.Human, clients[i], id),
);

class PrivateEconomicConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}

function seat(id: string, index: number): Client {
  return new Client(
    id,
    "persistent-" + id,
    {} as NonNullable<Client["claims"]>,
    null,
    undefined,
    "127.0.0.1",
    id,
    null,
    { readyState: WebSocket.OPEN } as Client["ws"],
    undefined,
    "e3-account-" + index,
    [],
  );
}

describe("M6 economic authority through actual private match ingress", () => {
  it("stamps real principals, rejects replay and forged resolution, and commits real embargoes", async () => {
    const game = await setup(
      "plains",
      {
        nationalMode: true,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
      },
      roster,
      undefined,
      PrivateEconomicConfig,
    );
    const coords = [
      [20, 20],
      [80, 20],
      [20, 80],
      [80, 80],
    ];
    roster.forEach((p, i) => {
      const [x, y] = coords[i];
      game.addExecution(new SpawnExecution(MATCH, p, game.ref(x, y)));
    });
    game.executeNextTick();
    game.executeNextTick();
    const runner = new GameRunner(
      game,
      new Executor(game, MATCH, undefined),
      () => {},
      undefined,
    );
    const sockets = clients.map(seat);
    const host = new TrustedNationalMatch(MATCH, runner, sockets, () => {});
    const [a, b, c, d] = [A, B, C, D].map((id) => game.player(id));
    const view = (actor: typeof a) =>
      NationalSanctionExecution.viewFor(game, actor);
    const act = (index: number, candidate: Record<string, unknown>) => {
      expect(host.submit(sockets[index], candidate)).toBe(true);
      const receipt = host.tick();
      expect(receipt.committedIntents).toBe(1);
      host.tick();
      return receipt;
    };
    const command = {
      type: "national_issue_sanction",
      scope: "national",
      targetId: D,
      recipientIds: [B, C],
      durationTicks: 12,
      requestId: "e3-wire-issue",
      // Attempt to substitute a different original seat.
      clientID: clients[3],
    };
    const issued = act(0, command);
    expect(view(a)[0].issuer).toBe(A);
    expect(view(d)).toEqual([]);
    expect(view(b)[0].recipientIds).toEqual([B]);
    expect(view(b)[0].requestId).toBeNull();
    expect(host.submit(sockets[0], command)).toBe(false);
    expect(host.submit(sockets[1], command)).toBe(false);
    expect(b.canTrade(d)).toBe(true);
    expect(c.canTrade(d)).toBe(true);
    const id = view(a)[0].id;
    act(1, {
      type: "national_respond_sanction",
      sanctionId: id,
      decision: "refuse",
      requestId: "e3-wire-refuse",
      clientID: clients[2],
    });
    expect(view(b)[0].response).toBe("refuse");
    expect(view(c)[0].response).toBe("none");
    act(2, {
      type: "national_respond_sanction",
      sanctionId: id,
      decision: "comply",
      requestId: "e3-wire-comply",
    });
    expect(c.canTrade(d)).toBe(false);
    expect(b.canTrade(d)).toBe(true);
    for (let i = 0; i < 20 && view(a)[0].phase === "pending"; i++) {
      host.tick();
    }
    expect(view(a)[0].phase).toBe("decision-required");
    // Restore the actual private game with active economic state and a
    // disconnected target, using the same registered original principals.
    host.recordServerDisconnect(clients[3], true);
    host.tick();
    host.tick();
    expect(d.isDisconnected()).toBe(true);
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    const restoredA = restored.player(A);
    const restoredB = restored.player(B);
    const restoredC = restored.player(C);
    const restoredD = restored.player(D);
    const nextClient = "E3CLIENTX";
    const manager = new Executor(restored, MATCH, undefined);
    const stale = manager.createExec(
      StampedIntentSchema.parse({
        type: "national_resolve_sanction",
        clientID: clients[0],
        sanctionId: id,
        decision: "enforce",
        requestId: "e3-wire-stale",
      }),
    );
    restored.addExecution(stale);
    restored.takeoverPlayer(restoredA, nextClient);
    restored.executeNextTick();
    restored.executeNextTick();
    expect(restoredA.canTrade(restoredB)).toBe(true);
    expect(
      NationalSanctionExecution.viewFor(restored, restoredA)[0].phase,
    ).toBe("decision-required");
    expect(
      NationalSanctionExecution.viewFor(restored, restoredA)[0].requestId,
    ).toBeNull();
    restored.addExecution(
      manager.createExec(
        StampedIntentSchema.parse({
          type: "national_resolve_sanction",
          clientID: nextClient,
          sanctionId: id,
          decision: "enforce",
          requestId: "e3-wire-new-seat",
        }),
      ),
    );
    restored.executeNextTick();
    restored.executeNextTick();
    expect(restoredA.canTrade(restoredB)).toBe(false);
    expect(restoredA.canTrade(restoredC)).toBe(true);
    expect(restoredB.canTrade(restoredD)).toBe(true);

    const forged = act(1, {
      type: "national_resolve_sanction",
      sanctionId: id,
      decision: "enforce",
      requestId: "e3-wire-forgery",
      clientID: clients[0],
    });
    expect(view(a)[0].phase).toBe("decision-required");
    expect(a.canTrade(b)).toBe(true);
    const enforced = act(0, {
      type: "national_resolve_sanction",
      sanctionId: id,
      decision: "enforce",
      requestId: "e3-wire-enforce",
    });
    expect(view(a)[0].phase).toBe("enforced");
    expect(a.canTrade(b)).toBe(false);
    expect(a.canTrade(c)).toBe(true);
    expect(b.canTrade(d)).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(A, B)).toBe(false);
    expect([a, b, c, d].every((p) => p.piracyGold() === 0n)).toBe(true);
    console.info(
      "C4_E3_ECONOMIC_INGRESS_WITNESS=" +
        JSON.stringify({
          id,
          issuer: view(a)[0].issuer,
          committed: [
            issued.committedIntents,
            forged.committedIntents,
            enforced.committedIntents,
          ],
          replayDigest: enforced.replayDigest,
          authorizedPhase: view(a)[0].phase,
          tick: game.ticks(),
        }),
    );
  });
});
