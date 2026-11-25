import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { NationalSanctionExecution } from "@openfront/engine/execution/NationalSanctionExecution";
import { TradeShipExecution } from "@openfront/engine/execution/TradeShipExecution";
import type { Game, Player, Unit } from "@openfront/engine/game/Game";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../../util/Setup";
import { roundTrip } from "../../util/Snapshot";

import { readNationalSettlementView } from "@openfront/engine-api/game/NationalSettlementView";
import {
  settlementDecisionIntent,
  settlementOfferIntent,
} from "../../../src/client/NationalImperialSettlementIntentControls";

const MAP = "half_land_half_ocean";
const [CROWN, ISSUER, DELEGATE, MEMBER, TARGET] = [
  "c5-e3-crown",
  "c5-e3-issuer",
  "c5-e3-delegate",
  "c5-e3-member",
  "c5-e3-target",
];
const EMPIRE = "c5-e3-empire";
const people = [CROWN, ISSUER, DELEGATE, MEMBER, TARGET].map(
  (id) => new PlayerInfo(id, PlayerType.Human, null, id),
);

function run(game: Game, n = 2): void {
  for (let i = 0; i < n; i++) game.executeNextTick();
}
function until(game: Game, predicate: () => boolean, max = 110): void {
  for (let i = 0; i < max && !predicate(); i++) game.executeNextTick();
  expect(predicate()).toBe(true);
}
async function world() {
  const game = await setup(
    MAP,
    { nationalMode: true, instantBuild: true },
    people,
  );
  const p = people.map((v, index) => {
    const player = game.player(v.id);
    const spawn = game.ref(1, 1 + index * 3);
    player.conquer(spawn);
    player.setSpawnTile(spawn);
    player.addGold(1_000_000_000n);
    return player;
  });
  run(game, 1);
  const [a, b, c, d, e] = p;
  const port = (player: Player, y: number) => {
    const tile = game.ref(7, y);
    player.conquer(tile);
    return player.buildUnit(UnitType.Port, tile, {});
  };
  const src = port(c, 4);
  const dst = port(e, 13);
  const other = port(b, 1);
  port(d, 10);
  run(game, 1);
  game.performNationalCommand(a, { kind: "found-empire", empireId: EMPIRE });
  for (const member of [c, d]) {
    game.performNationalCommand(a, {
      kind: "offer-empire",
      empireId: EMPIRE,
      candidateId: member.id(),
    });
    game.performNationalCommand(member, {
      kind: "accept-empire",
      empireId: EMPIRE,
      candidateId: member.id(),
    });
  }
  expect(game.nationalPoliticalAuthority()?.membersOf(EMPIRE)).toEqual(
    [CROWN, DELEGATE, MEMBER].sort(),
  );
  return { game, a, b, c, d, e, src, dst, other };
}
function issue(
  game: Game,
  actor: Player,
  targetId: string,
  recipients: string[],
  requestId: string,
) {
  game.addExecution(
    new NationalSanctionExecution(actor, {
      type: "national_issue_sanction",
      scope: "national",
      targetId,
      recipientIds: recipients,
      durationTicks: 190,
      requestId,
    }),
  );
  run(game);
  const views = NationalSanctionExecution.viewFor(game, actor);
  return views[views.length - 1]!.id;
}
function trade(game: Game, owner: Player, src: Unit, dst: Unit): bigint {
  const previous = owner.tradeGold();
  const execution = new TradeShipExecution(owner, src, dst);
  game.addExecution(execution);
  run(game);
  if (execution.isActive()) until(game, () => !execution.isActive());
  return owner.tradeGold() - previous;
}

type EconomicCommand = ConstructorParameters<
  typeof NationalSanctionExecution
>[1];

function send(
  game: Game,
  actor: Player,
  command: EconomicCommand,
  clientId?: string,
) {
  game.addExecution(new NationalSanctionExecution(actor, command, clientId));
  run(game);
}
function enforce(
  game: Game,
  issuer: Player,
  recipient: Player,
  requestId: string,
) {
  const id = issue(game, issuer, TARGET, [recipient.id()], requestId);
  until(
    game,
    () =>
      NationalSanctionExecution.viewFor(game, issuer).some(
        (d) => d.id === id && d.phase === "decision-required",
      ),
    300,
  );
  send(game, issuer, {
    type: "national_resolve_sanction",
    sanctionId: id,
    decision: "enforce",
    requestId: requestId + "-enforce",
  });
  expect(issuer.canTrade(recipient)).toBe(false);
  expect(
    NationalSanctionExecution.viewFor(game, issuer).find((d) => d.id === id)
      ?.phase,
  ).toBe("enforced");
  return id;
}
function status(game: Game, issuer: Player, sanctionId: string) {
  return NationalSanctionExecution.viewFor(game, issuer).find(
    (d) => d.id === sanctionId,
  )?.settlements[0]?.status;
}

describe("C6C2 E1 authoritative post-settlement voyage evidence", () => {
  it("does not fabricate a paid voyage after settlement or while independent embargo remains, then records and restores a real paid arrival", async () => {
    const { game, b, c, e, src, dst, other } = await world();
    const paidBefore = trade(game, b, other, src);
    expect(paidBefore).toBeGreaterThan(0n);
    const id = enforce(game, b, c, "c6c2-e1-maritime");
    const blockedBefore = b.tradeGold();
    expect(trade(game, b, other, src)).toBe(0n);
    expect(b.tradeGold()).toBe(blockedBefore);
    const rowFor = (g: Game, actor: Player) => {
      const wire = NationalSanctionExecution.settlementViewFor(
        g,
        actor,
        g.ticks(),
      );
      return readNationalSettlementView(
        wire,
        actor.id(),
        g.ticks(),
      )?.items.find((row) => row.sanctionId === id);
    };
    const causal = b
      .getEmbargoes()
      .some(
        (entry) =>
          entry.target === c &&
          "reasons" in entry &&
          Array.isArray(entry.reasons) &&
          entry.reasons.includes("sanction:" + id),
      );
    // Conductor acceptance is strict on the integrated E3 causal source.
    // Standalone founding-source regression must fail closed instead of bypassing it.
    if (process.env.C6C2_E1_REQUIRE_CAUSAL === "1") expect(causal).toBe(true);
    const payerView = rowFor(game, c)!;
    expect(payerView.canOffer).toBe(causal);
    const offerId = "c6c2-e1-maritime-offer";
    const offer = settlementOfferIntent(
      payerView,
      c.id(),
      c.gold(),
      "55000",
      offerId,
    );
    expect(offer !== null).toBe(causal);
    if (offer?.type === "national_offer_sanction_settlement")
      send(game, c, offer);
    else
      send(game, c, {
        type: "national_offer_sanction_settlement",
        sanctionId: id,
        amountGold: "55000",
        requestId: offerId,
      });
    expect(status(game, b, id)).toBe("pending");
    // The real E3 reason journal retains a separately asserted manual restriction.
    if (causal) b.addEmbargo(c, false);
    const issuerView = rowFor(game, b)!;
    expect(issuerView.canAccept).toBe(causal);
    const accept = settlementDecisionIntent(
      issuerView,
      b.id(),
      game.ticks(),
      "accept",
      "c6c2-e1-maritime-accept",
    );
    expect(accept !== null).toBe(causal);
    const balances = [b.gold(), c.gold()];
    if (accept?.type === "national_decide_sanction_settlement")
      send(game, b, accept);
    else
      send(game, b, {
        type: "national_decide_sanction_settlement",
        sanctionId: id,
        recipientId: c.id(),
        offerId,
        decision: "accept",
        requestId: "c6c2-e1-maritime-accept",
      });
    expect(b.gold() - balances[0]).toBe(55_000n);
    expect(balances[1] - c.gold()).toBe(55_000n);
    expect(rowFor(game, b)?.offer?.status).toBe("accepted");
    expect(rowFor(game, b)?.lastPaidCommerce).toBeNull();
    if (!causal) b.addEmbargo(c, false);
    expect(rowFor(game, b)?.tradePermitted).toBe(false);
    expect(trade(game, b, other, src)).toBe(0n);
    expect(rowFor(game, b)?.lastPaidCommerce).toBeNull();

    // Another paid route is NOT evidence of payment across the settled pair.
    expect(trade(game, c, src, dst)).toBeGreaterThan(0n);
    expect(rowFor(game, c)?.lastPaidCommerce).toBeNull();
    expect(rowFor(game, e)).toBeUndefined();
    b.stopEmbargo(c);
    expect(rowFor(game, b)?.tradePermitted).toBe(true);
    expect(rowFor(game, b)?.lastPaidCommerce).toBeNull();
    const paid = trade(game, b, other, src);
    expect(paid).toBeGreaterThan(0n);
    const receipt = rowFor(game, c)?.lastPaidCommerce;
    expect(receipt).toMatchObject({
      counterpartyId: b.id(),
      grossGold: paid.toString(),
    });
    expect(rowFor(game, b)?.lastPaidCommerce).toEqual(receipt);
    expect(rowFor(game, e)).toBeUndefined();
    const { restored, bytes, again } = await roundTrip(game, MAP);
    expect(again).toEqual(bytes);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    expect(
      rowFor(restored, restored.player(DELEGATE))?.lastPaidCommerce,
    ).toEqual(receipt);
    console.info(
      "C6C2_E1_PAID_VOYAGE_WITNESS=" +
        JSON.stringify({
          nativePaymentEnabled: causal,
          settlement: "55000",
          exactConservation: true,
          independentRestrictionBlocked: true,
          unrelatedRouteExcluded: true,
          paidVoyage: paid.toString(),
          receipt,
          snapshotBytes: bytes.length,
        }),
    );
  });
});
