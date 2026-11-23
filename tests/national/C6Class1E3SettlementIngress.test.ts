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

const MATCH = "C6E3PAY01";
const [ISSUER, PAYER, STRANGER, TARGET] = [
  "C6SETTLEA",
  "C6SETTLEB",
  "C6SETTLEC",
  "C6SETTLED",
];
const clients = ["C6CLIENTA", "C6CLIENTB", "C6CLIENTC", "C6CLIENTD"];
const roster = [ISSUER, PAYER, STRANGER, TARGET].map(
  (id, index) => new PlayerInfo(id, PlayerType.Human, clients[index], id),
);

class SettlementPrivateConfig extends TestConfig {
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
    "c6-settlement-account-" + index,
    [],
  );
}

describe("C6 first-class E3 private-match restitution ingress", () => {
  it("resolves the real socket principal, conserves money, rejects forgery and replay, and restores a pending payment", async () => {
    const game = await setup(
      "plains",
      {
        nationalMode: true,
        gameType: GameType.Private,
        gameMode: GameMode.FFA,
      },
      roster,
      undefined,
      SettlementPrivateConfig,
    );
    const coords = [
      [20, 20],
      [80, 20],
      [20, 80],
      [80, 80],
    ];
    roster.forEach((person, index) => {
      const [x, y] = coords[index];
      game.addExecution(new SpawnExecution(MATCH, person, game.ref(x, y)));
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
    const issuer = game.player(ISSUER);
    const payer = game.player(PAYER);
    issuer.addGold(200_000n);
    payer.addGold(1_000_000n);
    const view = (actor: typeof issuer) =>
      NationalSanctionExecution.viewFor(game, actor);
    const act = (index: number, candidate: Record<string, unknown>) => {
      expect(host.submit(sockets[index], candidate)).toBe(true);
      const receipt = host.tick();
      expect(receipt.committedIntents).toBe(1);
      host.tick();
      return receipt;
    };

    act(0, {
      type: "national_issue_sanction",
      scope: "national",
      targetId: TARGET,
      recipientIds: [PAYER],
      durationTicks: 12,
      requestId: "c6-host-issue",
      // Host must ignore the browser's claimed actor.
      clientID: clients[3],
    });
    const id = view(issuer)[0].id;
    for (
      let tick = 0;
      tick < 30 && view(issuer)[0].phase === "pending";
      tick++
    ) {
      host.tick();
    }
    expect(view(issuer)[0].phase).toBe("decision-required");
    act(0, {
      type: "national_resolve_sanction",
      sanctionId: id,
      decision: "enforce",
      requestId: "c6-host-enforce",
    });
    expect(issuer.canTrade(payer)).toBe(false);
    expect(view(game.player(STRANGER))).toEqual([]);
    expect(view(game.player(TARGET))).toEqual([]);

    act(2, {
      type: "national_offer_sanction_settlement",
      sanctionId: id,
      amountGold: "25000",
      requestId: "c6-host-forged-offer",
      clientID: clients[1],
    });
    expect(view(issuer)[0].settlements).toEqual([]);
    expect(
      host.submit(sockets[1], {
        type: "national_offer_sanction_settlement",
        sanctionId: id,
        amountGold: "-10",
        requestId: "c6-host-negative",
      }),
    ).toBe(false);

    const before = [issuer.gold(), payer.gold()];
    const offerId = "c6-host-legitimate-offer";
    act(1, {
      type: "national_offer_sanction_settlement",
      sanctionId: id,
      amountGold: "25000",
      requestId: offerId,
      clientID: clients[0],
    });
    expect(view(issuer)[0].settlements[0]?.status).toBe("pending");
    expect(view(payer)[0].requestId).toBeNull();
    expect([issuer.gold(), payer.gold()]).toEqual(before);

    act(2, {
      type: "national_decide_sanction_settlement",
      sanctionId: id,
      recipientId: PAYER,
      offerId,
      decision: "accept",
      requestId: "c6-host-fake-issuer",
      clientID: clients[0],
    });
    expect(view(issuer)[0].settlements[0]?.status).toBe("pending");
    expect([issuer.gold(), payer.gold()]).toEqual(before);
    expect(issuer.canTrade(payer)).toBe(false);

    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));

    const accept = {
      type: "national_decide_sanction_settlement",
      sanctionId: id,
      recipientId: PAYER,
      offerId,
      decision: "accept",
      requestId: "c6-host-authorized-accept",
    };
    const receipt = act(0, accept);
    expect(issuer.gold() - before[0]).toBe(25_000n);
    expect(before[1] - payer.gold()).toBe(25_000n);
    expect(issuer.gold() + payer.gold()).toBe(before[0] + before[1]);
    expect(issuer.canTrade(payer)).toBe(true);
    expect(view(issuer)[0].settlements[0]?.status).toBe("accepted");

    const restoredIssuer = restored.player(ISSUER);
    const restoredPayer = restored.player(PAYER);
    const restoredBefore = [restoredIssuer.gold(), restoredPayer.gold()];
    restored.addExecution(
      new Executor(restored, MATCH, undefined).createExec(
        StampedIntentSchema.parse({
          ...accept,
          clientID: clients[0],
        }),
      ),
    );
    restored.executeNextTick();
    restored.executeNextTick();
    expect(restoredIssuer.gold() - restoredBefore[0]).toBe(25_000n);
    expect(restoredBefore[1] - restoredPayer.gold()).toBe(25_000n);
    expect(restoredIssuer.canTrade(restoredPayer)).toBe(true);
    expect(
      NationalSanctionExecution.viewFor(restored, restoredIssuer)[0]
        .settlements[0]?.status,
    ).toBe("accepted");

    act(0, {
      ...accept,
      requestId: "c6-host-replay-new-id",
    });
    expect(issuer.gold() - before[0]).toBe(25_000n);
    expect(before[1] - payer.gold()).toBe(25_000n);

    console.info(
      "C6_E3_PRIVATE_INGRESS_WITNESS=" +
        JSON.stringify({
          sanctionId: id,
          committed: receipt.committedIntents,
          paid: "25000",
          exactConservation: true,
          resumedTrade: issuer.canTrade(payer),
          restoredPayment:
            restoredIssuer.gold() - restoredBefore[0] === 25_000n,
          digest: receipt.replayDigest,
          tick: game.ticks(),
        }),
    );
  });
});
