import {
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
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
import { Client } from "../../../src/server/Client";
import { TrustedNationalMatch } from "../../../src/server/national/TrustedNationalMatch";
import { setup } from "../../util/Setup";
import { roundTrip } from "../../util/Snapshot";
import { TestConfig } from "../../util/TestConfig";

import { encodeNationalRecipientProjection } from "../../../src/server/national/NationalRecipientWire";
import { parseTrustedNationalProjection, materializeTrustedNationalUpdate } from "../../../src/client/TrustedNationalSession";
import { settlementDecisionIntent, settlementOfferIntent } from "../../../src/client/NationalImperialSettlementIntentControls";

const MATCH = "C6C2E1PAY";
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

describe("C6C2 E1 native settlement wire through authenticated GameRunner", () => {
  it("binds settlement controls to the real socket seat and discloses authoritative outcomes; requires causal E3 ownership for native payment", async () => {
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
    const packets = new Map<string, GameUpdateViewData>();
    const host = new TrustedNationalMatch(MATCH, runner, sockets, (client, packet) => { packets.set(client.clientID, packet); });
    const native = (index: number) => {
      const packet = packets.get(clients[index])!;
      expect(packet).toBeDefined();
      const wire = encodeNationalRecipientProjection(packet);
      const parsed = parseTrustedNationalProjection(wire, packet.tick);
      const materialized = materializeTrustedNationalUpdate(parsed, packet.tick - 1);
      return materialized.nationalSettlements;
    };
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
      lastPaidCommerce: { tick: game.ticks(), counterpartyId: ISSUER, grossGold: "999999999" },
    });
    expect(view(issuer)[0].settlements).toEqual([]);
    expect(native(1)?.items[0].lastPaidCommerce ?? null).toBeNull();
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
    expect(native(2)).toBeUndefined();
    expect(native(3)).toBeUndefined();
    const payerProjection = native(1);
    const causal = issuer.getEmbargoes().some((entry) => entry.target === payer && "reasons" in entry && Array.isArray(entry.reasons) && entry.reasons.includes("sanction:" + id));
    if (process.env.C6C2_E1_REQUIRE_CAUSAL === "1") expect(causal).toBe(true);
    const nativeOffer = payerProjection?.items.find((row) => row.sanctionId === id);
    expect(nativeOffer?.canOffer ?? false).toBe(causal);
    const offerIntent = nativeOffer ? settlementOfferIntent(nativeOffer, PAYER, payer.gold(), "25000", offerId) : null;
    expect(offerIntent !== null).toBe(causal);
    // The founding engine permits historical raw settlement but lacks causal ownership.
    // Only the integrated E3 path is a new native-payment witness.
    act(1, offerIntent ?? {
      type: "national_offer_sanction_settlement",
      sanctionId: id,
      amountGold: "25000",
      requestId: offerId,
      clientID: clients[0],
    });
    expect(view(issuer)[0].settlements[0]?.status).toBe("pending");
    expect(native(1)?.items[0].offer?.requestId).toBe(offerId);
    expect(native(0)?.items[0].offer?.status).toBe("pending");
    expect(native(0)?.items[0].canAccept).toBe(causal);
    expect(native(2)).toBeUndefined();
    expect(view(payer)[0].requestId).toBeNull();
    // GameRunner advances workers on every tick. An unaccepted offer
    // must produce only identical ordinary income, never a transfer.
    expect(issuer.gold() - before[0]).toBe(payer.gold() - before[1]);

    const beforeForgery = [issuer.gold(), payer.gold()];
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
    expect(issuer.gold() - beforeForgery[0]).toBe(
      payer.gold() - beforeForgery[1],
    );
    expect(issuer.canTrade(payer)).toBe(false);

    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));

    // Calibrate natural worker revenue over precisely the two ticks that
    // one submitted host decision advances. No payment can hide as income.
    const neutralBefore = [issuer.gold(), payer.gold()];
    host.tick();
    host.tick();
    restored.executeNextTick();
    restored.executeNextTick();
    const passive = [
      issuer.gold() - neutralBefore[0],
      payer.gold() - neutralBefore[1],
    ];
    const acceptanceBefore = [issuer.gold(), payer.gold()];
    const accept = {
      type: "national_decide_sanction_settlement",
      sanctionId: id,
      recipientId: PAYER,
      offerId,
      decision: "accept",
      requestId: "c6-host-authorized-accept",
    };
    const current = native(0)?.items[0];
    expect(current).toBeDefined();
    const nativeAccept = settlementDecisionIntent(current!, ISSUER, game.ticks(), "accept", accept.requestId);
    expect(nativeAccept !== null).toBe(causal);
    const receipt = act(0, nativeAccept ?? accept);
    const issuerTransfer = issuer.gold() - acceptanceBefore[0] - passive[0];
    const payerTransfer = acceptanceBefore[1] - payer.gold() + passive[1];
    expect(issuerTransfer).toBe(25_000n);
    expect(payerTransfer).toBe(25_000n);
    expect(issuerTransfer).toBe(payerTransfer);
    expect(
      issuer.gold() + payer.gold() - acceptanceBefore[0] - acceptanceBefore[1],
    ).toBe(passive[0] + passive[1]);
    expect(issuer.canTrade(payer)).toBe(true);
    expect(view(issuer)[0].settlements[0]?.status).toBe("accepted");
    expect(native(0)?.items[0]).toMatchObject({ tradePermitted: true, offer: { status: "accepted", gold: "25000" } });
    expect(native(1)?.items[0].offer?.status).toBe("accepted");
    expect(native(0)?.paidMaritimeGold).toBe(issuer.tradeGold().toString());
    expect(native(2)).toBeUndefined();

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
    expect(restoredIssuer.gold() - restoredBefore[0] - passive[0]).toBe(
      25_000n,
    );
    expect(restoredBefore[1] - restoredPayer.gold() + passive[1]).toBe(25_000n);
    expect(restoredIssuer.canTrade(restoredPayer)).toBe(true);
    expect(
      NationalSanctionExecution.viewFor(restored, restoredIssuer)[0]
        .settlements[0]?.status,
    ).toBe("accepted");

    const replayBefore = [issuer.gold(), payer.gold()];
    act(0, {
      ...accept,
      requestId: "c6-host-replay-new-id",
    });
    expect([
      issuer.gold() - replayBefore[0],
      payer.gold() - replayBefore[1],
    ]).toEqual(passive);

    console.info(
      "C6C2_E1_SETTLEMENT_WIRE_WITNESS=" +
        JSON.stringify({
          sanctionId: id,
          nativePaymentEnabled: causal,
          committed: receipt.committedIntents,
          paid: "25000",
          exactConservation: true,
          resumedTrade: issuer.canTrade(payer),
          restoredPayment:
            restoredIssuer.gold() - restoredBefore[0] - passive[0] === 25_000n,
          digest: receipt.replayDigest,
          tick: game.ticks(),
        }),
    );
  });
});
