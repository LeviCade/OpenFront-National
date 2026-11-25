import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  NATIONAL_SATELLITE_COST,
  readNationalSatelliteView,
} from "@openfront/engine-api/game/NationalSatelliteView";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { unpackUnitUpdates } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { NationalObserverMapPager } from "@openfront/engine/national/observation/NationalObserverMap";
import { advanceLastKnown } from "@openfront/engine/national/observation/NationalObservation";
import { NationalSatelliteJournal } from "@openfront/engine/national/observation/NationalSatellite";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const match = "satellite-test";
const buyer = new PlayerInfo("Buyer", PlayerType.Human, "buyer-session", "buyer");
const outsider = new PlayerInfo("Outsider", PlayerType.Human, "outsider-session", "outsider");
const ally = new PlayerInfo("Ally", PlayerType.Nation, null, "ally");
const target = new PlayerInfo("Target", PlayerType.Nation, null, "target");

async function fixture() {
  const game = await setup("big_plains", { nationalMode: true }, [buyer, outsider, ally, target]);
  for (const [info, x, y] of [
    [buyer, 20, 100], [outsider, 20, 180], [ally, 20, 15], [target, 185, 175],
  ] as const) game.addExecution(new SpawnExecution(match, info, game.ref(x, y)));
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  return game;
}

type TestGame = Awaited<ReturnType<typeof fixture>>;
function admission(game: TestGame, id: string) {
  const authority = game.nationalPoliticalAuthority()!;
  return { issuedTick: game.ticks(), empireId: authority.empireOf(id), policyVersion: authority.warPolicyVersionFor(id) };
}
function observation(game: TestGame, id: string) {
  return collectLiveNationalObservation(game, id);
}
function seen(game: TestGame, id: string, unit: number) {
  return observation(game, id).observation.visibleAssets.find((a) => a.id === String(unit));
}
function packet(game: TestGame, clientID: string) {
  let result: GameUpdateViewData | null = null;
  const runner = new GameRunner(game, new Executor(game, match, clientID), (p) => {
    if ("updates" in p) result = p;
  }, clientID);
  game.queueViewResync();
  runner.addTurn({ turnNumber: game.ticks(), intents: [] });
  expect(runner.executeNextTick()).toBe(true);
  if (result === null) throw new Error("missing packet");
  return result as GameUpdateViewData;
}

describe("C7C1 E2 satellite gameplay", () => {
  it("charges actual gold, reveals distant assets to buyer only and expires on the exact tick", async () => {
    const game = await fixture();
    const actor = game.player(buyer.id);
    const foreign = game.player(target.id);
    const city = foreign.buildUnit(UnitType.City, game.ref(185, 175), {});
    const ship = foreign.buildUnit(UnitType.TransportShip, game.ref(186, 175), {
      troops: 987654, targetTile: game.ref(20, 100),
    });
    expect(seen(game, buyer.id, city.id())).toBeUndefined();
    expect(seen(game, buyer.id, ship.id())).toBeUndefined();
    expect(seen(game, outsider.id, city.id())).toBeUndefined();
    actor.addGold(NATIONAL_SATELLITE_COST);
    const before = actor.gold();
    const lease = game.performNationalSatellite(actor, "paid", admission(game, buyer.id), buyer.clientID!);
    expect(actor.gold()).toBe(before - NATIONAL_SATELLITE_COST);
    expect(lease.expiresAtTick - lease.effectiveTick).toBe(300);
    expect(seen(game, buyer.id, city.id())?.source).toBe("satellite");
    expect(seen(game, buyer.id, ship.id())?.strength).toBeUndefined();
    expect(JSON.stringify(seen(game, buyer.id, ship.id()))).not.toContain("987654");
    expect(seen(game, outsider.id, city.id())).toBeUndefined();
    expect(seen(game, outsider.id, ship.id())).toBeUndefined();
    const human = packet(game, buyer.clientID!);
    expect(human.nationalSatellite?.lease).toEqual(lease);
    const wire = unpackUnitUpdates(human.packedUnitUpdates, human.packedMissileTimers).find((u) => u.id === ship.id());
    expect(wire?.isActive).toBe(true);
    expect(wire?.troops).toBe(0);
    expect(wire?.targetable).toBe(false);
    expect(JSON.stringify(wire)).not.toContain("targetTile");
    const stranger = packet(game, outsider.clientID!);
    expect(stranger.nationalSatellite?.lease ?? null).toBeNull();
    expect(unpackUnitUpdates(stranger.packedUnitUpdates, stranger.packedMissileTimers).some((u) => u.id === city.id() && u.isActive)).toBe(false);
    const pager = new NationalObserverMapPager(game, buyer.id, "satellite-stream");
    expect(pager.page(observation(game, buyer.id)).units.some((u) => u.id === city.id())).toBe(true);
    const restored = await roundTrip(game, "big_plains");
    expect(restored.again).toEqual(restored.bytes);
    expect(restored.restored.nationalSatelliteFor(buyer.id)).toEqual(lease);
    expect(() => game.performNationalSatellite(actor, "paid", admission(game, buyer.id), buyer.clientID!)).toThrow(/duplicate/);
    while (game.ticks() < lease.expiresAtTick - 1) game.executeNextTick();
    expect(seen(game, buyer.id, city.id())).toBeDefined();
    const memory = advanceLastKnown(observation(game, buyer.id).observation, null, 60).memory;
    game.executeNextTick();
    expect(game.nationalSatelliteFor(buyer.id)).toBeNull();
    expect(seen(game, buyer.id, city.id())).toBeUndefined();
    expect(advanceLastKnown(observation(game, buyer.id).observation, memory, 60).stale.some((a) => a.id === String(city.id()))).toBe(false);
    const expired = pager.page(observation(game, buyer.id));
    expect(expired.unitReset || expired.unitRemovedIds.includes(city.id())).toBe(true);
    expect(expired.units.some((u) => u.id === city.id())).toBe(false);
  });

  it("executes an authenticated queued purchase and shares reciprocally with an AI, then revokes on dissolution", async () => {
    const game = await fixture();
    const actor = game.player(buyer.id);
    const city = game.player(target.id).buildUnit(UnitType.City, game.ref(185, 175), {});
    actor.addGold(NATIONAL_SATELLITE_COST);
    game.addExecution(new Executor(game, match, buyer.clientID!).createExec({
      type: "national_buy_satellite_recon", gameId: match, issuedTick: game.ticks(),
      requestId: "queued", clientID: buyer.clientID!,
    }));
    const debit = vi.spyOn(actor, "removeGold");
    game.executeNextTick();
    game.executeNextTick();
    expect(debit.mock.calls.filter(([gold]) => gold === NATIONAL_SATELLITE_COST)).toHaveLength(1);
    debit.mockRestore();
    expect(game.nationalSatelliteFor(buyer.id)?.requestId).toBe("queued");
    expect(seen(game, ally.id, city.id())).toBeUndefined();
    game.performNationalCommand(actor, { kind: "found-empire", empireId: "satellite-empire" });
    game.performNationalCommand(actor, { kind: "offer-empire", empireId: "satellite-empire", candidateId: ally.id });
    game.performNationalCommand(game.player(ally.id), { kind: "accept-empire", empireId: "satellite-empire", candidateId: ally.id });
    expect(seen(game, ally.id, city.id())?.sourceNationId).toBe(buyer.id);
    expect(seen(game, outsider.id, city.id())).toBeUndefined();
    game.performNationalImperialAdministration(actor, { kind: "dissolve", empireId: "satellite-empire" });
    expect(seen(game, ally.id, city.id())).toBeUndefined();
    expect(seen(game, buyer.id, city.id())).toBeDefined();
  });

  it("rejects unfunded, duplicate, forged and stale requests without granting sight", async () => {
    const game = await fixture();
    const actor = game.player(buyer.id);
    actor.removeGold(actor.gold());
    expect(() => game.performNationalSatellite(actor, "poor", admission(game, buyer.id), buyer.clientID!)).toThrow(/insufficient/);
    actor.addGold(NATIONAL_SATELLITE_COST);
    const before = actor.gold();
    expect(() => game.performNationalSatellite(actor, "poor", admission(game, buyer.id), buyer.clientID!)).toThrow(/duplicate/);
    expect(() => game.performNationalSatellite(actor, "forged", admission(game, buyer.id), outsider.clientID!)).toThrow();
    expect(() => game.performNationalSatellite(actor, "future", { ...admission(game, buyer.id), issuedTick: game.ticks() + 1 }, buyer.clientID!)).toThrow();
    expect(actor.gold()).toBe(before);
    expect(game.nationalSatelliteFor(buyer.id)).toBeNull();
  });

  it("bounds durable identities and strictly validates receipts", () => {
    const ledger = new NationalSatelliteJournal();
    let spent = 0n;
    const charge = (gold: bigint) => { spent += gold; };
    const lease = ledger.buy("payer", "first", 5, charge);
    for (let i = 0; i < 63; i++)
      expect(() => ledger.buy("payer", "denied" + i, 5, charge)).toThrow(/active/);
    expect(() => ledger.buy("payer", "overflow", 305, charge)).toThrow(/exhausted/);
    expect(spent).toBe(25000n);
    expect(NationalSatelliteJournal.restore(ledger.snapshot(), 305).activeFor("payer", 305)).toBeNull();
    const dto = { version: 1, recipientId: "payer", tick: 5, lease };
    expect(readNationalSatelliteView(dto, "payer", 5)?.lease).toEqual(lease);
    expect(readNationalSatelliteView(dto, "stranger", 5)).toBeNull();
    expect(readNationalSatelliteView({ ...dto, lease: { ...lease, troops: 10 } }, "payer", 5)).toBeNull();
    expect(readNationalSatelliteView({ ...dto, tick: 305 }, "payer", 305)).toBeNull();
  });
});
