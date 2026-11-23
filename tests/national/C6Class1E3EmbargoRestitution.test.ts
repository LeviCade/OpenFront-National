import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { IntentSchema } from "@openfront/engine-api/Schemas";
import { NationalSanctionExecution } from "@openfront/engine/execution/NationalSanctionExecution";
import { TradeShipExecution } from "@openfront/engine/execution/TradeShipExecution";
import type { Game, Player, Unit } from "@openfront/engine/game/Game";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const MAP = "half_land_half_ocean";
const [CROWN, ISSUER, DELEGATE, MEMBER, TARGET] = [
  "c5-e3-crown", "c5-e3-issuer", "c5-e3-delegate", "c5-e3-member", "c5-e3-target",
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

type EconomicCommand = ConstructorParameters<typeof NationalSanctionExecution>[1];

function send(game: Game, actor: Player, command: EconomicCommand, clientId?: string) {
  game.addExecution(new NationalSanctionExecution(actor, command, clientId));
  run(game);
}
function enforce(game: Game, issuer: Player, recipient: Player, requestId: string) {
  const id = issue(game, issuer, TARGET, [recipient.id()], requestId);
  until(game, () => NationalSanctionExecution.viewFor(game, issuer).some(
    (d) => d.id === id && d.phase === "decision-required",
  ), 300);
  send(game, issuer, {
    type: "national_resolve_sanction", sanctionId: id,
    decision: "enforce", requestId: requestId + "-enforce",
  });
  expect(issuer.canTrade(recipient)).toBe(false);
  expect(NationalSanctionExecution.viewFor(game, issuer)
    .find((d) => d.id === id)?.phase).toBe("enforced");
  return id;
}
function offer(game: Game, payer: Player, sanctionId: string, amount: string, requestId: string) {
  send(game, payer, {
    type: "national_offer_sanction_settlement", sanctionId,
    amountGold: amount, requestId,
  });
}
function decide(game: Game, issuer: Player, sanctionId: string,
  recipientId: string, offerId: string, decision: "accept" | "refuse", requestId: string) {
  send(game, issuer, {
    type: "national_decide_sanction_settlement", sanctionId, recipientId,
    offerId, decision, requestId,
  });
}
function status(game: Game, issuer: Player, sanctionId: string) {
  return NationalSanctionExecution.viewFor(game, issuer)
    .find((d) => d.id === sanctionId)?.settlements[0]?.status;
}

describe("C6 Class 1 E3: actual enforced bilateral restitution", () => {
  it("blocks real paid B-to-C maritime commerce, settles conserved gold after issuer acceptance, and restores actual paid voyages across replay", async () => {
    const { game, b, c, src, other } = await world();
    const paidBefore = trade(game, b, other, src);
    expect(paidBefore).toBeGreaterThan(0n);
    const id = enforce(game, b, c, "c6-positive");
    const goldBlocked = b.gold();
    const shipsBlocked = b.tradeGold();
    expect(trade(game, b, other, src)).toBe(0n);
    expect(b.gold()).toBe(goldBlocked);
    expect(b.tradeGold()).toBe(shipsBlocked);
    offer(game, c, id, "55000", "c6-unique-positive");
    expect(status(game, b, id)).toBe("pending");

    const { restored, bytes, again } = await roundTrip(game, MAP);
    expect(again).toEqual(bytes);
    for (const g of [game, restored]) {
      const issuer = g.player(ISSUER);
      const payer = g.player(DELEGATE);
      const previousIssuer = issuer.gold();
      const previousPayer = payer.gold();
      const previousTotal = previousIssuer + previousPayer;
      decide(g, issuer, id, DELEGATE, "c6-unique-positive", "accept", "c6-issuer-accept");
      expect(issuer.gold() - previousIssuer).toBe(55_000n);
      expect(previousPayer - payer.gold()).toBe(55_000n);
      expect(issuer.gold() + payer.gold()).toBe(previousTotal);
      expect(issuer.canTrade(payer)).toBe(true);
      expect(status(g, issuer, id)).toBe("accepted");
      expect(trade(g, issuer, issuer.units(UnitType.Port)[0],
        payer.units(UnitType.Port)[0])).toBeGreaterThan(0n);
      const balanceAfter = [issuer.gold(), payer.gold()];
      decide(g, issuer, id, DELEGATE, "c6-unique-positive", "accept", "c6-replay");
      expect([issuer.gold(), payer.gold()]).toEqual(balanceAfter);
      console.info("C6_E3_RESTITUTION_WITNESS=" + JSON.stringify({
        sanctionId:id, paidBefore:paidBefore.toString(),
        settlement:"55000", tradeResumed:true,
        exactGoldConserved:true, tick:g.ticks(),
      }));
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });

  it("rejects impostors, forged client admission, insufficient payment and recipient-only disclosure; refuses without release", async () => {
    const { game, a, b, c, d } = await world();
    const id = enforce(game, b, c, "c6-hostile");
    send(game, c, { type:"national_offer_sanction_settlement",
      sanctionId:id, amountGold:"10000", requestId:"spoofed-client" }, "forged-client");
    expect(status(game,b,id)).toBeUndefined();
    offer(game, b, id, "10000", "wrong-payer");
    offer(game, c, id, "999999999999999999", "insufficient");
    expect(status(game,b,id)).toBeUndefined();
    offer(game, c, id, "12000", "c6-refusal");
    const before = [b.gold(),c.gold()];
    decide(game, a, id, DELEGATE, "c6-refusal", "accept", "fake-emperor");
    decide(game, d, id, DELEGATE, "c6-refusal", "accept", "wrong-issuer");
    decide(game, b, id, DELEGATE, "wrong-offer", "accept", "wrong-offer-id");
    expect(status(game,b,id)).toBe("pending");
    expect([b.gold(),c.gold()]).toEqual(before);
    decide(game, b, id, DELEGATE, "c6-refusal", "refuse", "lawful-refusal");
    decide(game, b, id, DELEGATE, "c6-refusal", "accept", "replay-after-refusal");
    expect(status(game,b,id)).toBe("refused");
    expect(b.canTrade(c)).toBe(false);
    expect([b.gold(),c.gold()]).toEqual(before);
    expect(NationalSanctionExecution.viewFor(game,a)).toEqual([]);
    expect(NationalSanctionExecution.viewFor(game,d)).toEqual([]);
    expect(NationalSanctionExecution.viewFor(game,c)
      .find((x)=>x.id===id)?.settlements[0]?.gold).toBe("12000");
  });

  it("expires offers on authoritative ticks and never charges after expiry", async () => {
    const {game,b,c} = await world();
    const id = enforce(game,b,c,"c6-expiry");
    offer(game,c,id,"19000","c6-expiring-offer");
    const before = [b.gold(),c.gold()];
    run(game,121);
    decide(game,b,id,DELEGATE,"c6-expiring-offer","accept","late-accept");
    expect(status(game,b,id)).toBe("expired");
    expect([b.gold(),c.gold()]).toEqual(before);
    expect(b.canTrade(c)).toBe(false);
  });

  it("rejects parallel-sanction ownership and preexisting manual restrictions without touching money or trade", async () => {
    const {game,b,c} = await world();
    const first = enforce(game,b,c,"c6-overlap-one");
    const second = enforce(game,b,c,"c6-overlap-two");
    expect(first).not.toBe(second);
    const balances=[b.gold(),c.gold()];
    offer(game,c,first,"30000","overlap-ambiguous");
    offer(game,c,second,"30000","overlap-second");
    expect(status(game,b,first)).toBeUndefined();
    expect(status(game,b,second)).toBeUndefined();
    expect([b.gold(),c.gold()]).toEqual(balances);
    expect(b.canTrade(c)).toBe(false);

    const world2 = await world();
    world2.b.addEmbargo(world2.c,false);
    const sanctioned = enforce(world2.game,world2.b,world2.c,"c6-preexisting");
    offer(world2.game,world2.c,sanctioned,"12000","c6-unsafe-owner");
    expect(status(world2.game,world2.b,sanctioned)).toBeUndefined();
    expect(world2.b.canTrade(world2.c)).toBe(false);
  });

  it("freezes imperial crown authority at enforcement; succession invalidates outstanding bilateral settlement", async () => {
    const {game,a,b,c} = await world();
    send(game,a,{type:"national_issue_sanction",scope:"imperial",
      targetId:TARGET, recipientIds:[ISSUER],durationTicks:190,
      requestId:"imperial-restitution"});
    const id=NationalSanctionExecution.viewFor(game,a).at(-1)!.id;
    until(game,()=>NationalSanctionExecution.viewFor(game,a)
      .some((d)=>d.id===id && d.phase==="decision-required"),300);
    send(game,a,{type:"national_resolve_sanction",sanctionId:id,
      decision:"enforce",requestId:"imperial-enforce"});
    expect(a.canTrade(b)).toBe(false);
    offer(game,b,id,"40000","imperial-pending");
    expect(status(game,a,id)).toBe("pending");
    const balances=[a.gold(),b.gold(),c.gold()];
    game.performNationalCommand(a,{kind:"transfer-crown",
      empireId:EMPIRE,successorId:DELEGATE});
    decide(game,c,id,ISSUER,"imperial-pending","accept","new-crown");
    decide(game,a,id,ISSUER,"imperial-pending","accept","old-crown");
    expect([a.gold(),b.gold(),c.gold()]).toEqual(balances);
    expect(a.canTrade(b)).toBe(false);
  });

  it("uses append-only wire contracts and leaves FFA without NATIONAL payment side effects", async () => {
    expect(IntentSchema.safeParse({
      type:"national_offer_sanction_settlement", sanctionId:"sanction-1",
      amountGold:"0",requestId:"bad",
    }).success).toBe(false);
    expect(IntentSchema.safeParse({
      type:"national_offer_sanction_settlement", sanctionId:"sanction-1",
      amountGold:"123",requestId:"valid",
    }).success).toBe(true);
    const game = await setup(MAP,{nationalMode:false,instantBuild:true},people);
    for(const [i, info] of people.entries()) {
      const player=game.player(info.id);
      const tile=game.ref(1,1+i*3);
      player.conquer(tile);
      player.setSpawnTile(tile);
      player.addGold(100_000n);
    }
    run(game);
    const payer=game.player(DELEGATE);
    const before=payer.gold();
    send(game,payer,{type:"national_offer_sanction_settlement",
      sanctionId:"sanction-no-national",amountGold:"10000",requestId:"ffa-offer"});
    expect(payer.gold()).toBe(before);
    expect(NationalSanctionExecution.viewFor(game,payer)).toEqual([]);
  });
});
