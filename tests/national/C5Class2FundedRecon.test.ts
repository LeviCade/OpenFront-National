import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { NationalReconnaissanceIntentSchema } from "@openfront/engine-api/Schemas";
import { unpackUnitUpdates } from "@openfront/engine-lib/game/PackedUnitUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import { advanceLastKnown } from "@openfront/engine/national/observation/NationalObservation";
import {
  NationalReconnaissance,
  REGIONAL_RECON_COST,
  REGIONAL_RECON_DURATION_TICKS,
  REGIONAL_RECON_RADIUS,
} from "@openfront/engine/national/observation/NationalReconnaissance";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const BUYER = new PlayerInfo(
  "Recon Buyer",
  PlayerType.Human,
  "c5-e5-buyer-session",
  "c5-e5-buyer",
);
const TARGET = new PlayerInfo(
  "Recon Target",
  PlayerType.Nation,
  null,
  "c5-e5-target",
);
const ALLY = new PlayerInfo(
  "Recon Ally",
  PlayerType.Nation,
  null,
  "c5-e5-ally",
);
const STRANGER = new PlayerInfo(
  "Recon Stranger",
  PlayerType.Nation,
  null,
  "c5-e5-stranger",
);

async function liveGame() {
  const game = await setup("big_plains", { nationalMode: true }, [
    BUYER,
    TARGET,
    ALLY,
    STRANGER,
  ]);
  game.addExecution(
    new SpawnExecution("recon-e5", BUYER, game.ref(20, 100)),
    new SpawnExecution("recon-e5", TARGET, game.ref(185, 175)),
    new SpawnExecution("recon-e5", ALLY, game.ref(20, 15)),
    new SpawnExecution("recon-e5", STRANGER, game.ref(190, 95)),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  return game;
}

function visible(
  game: Awaited<ReturnType<typeof liveGame>>,
  who: string,
  id: number,
) {
  return collectLiveNationalObservation(
    game,
    who,
  ).observation.visibleAssets.find((asset) => asset.id === String(id));
}

function packet(game: Awaited<ReturnType<typeof liveGame>>, clientID: string) {
  let last: GameUpdateViewData | null = null;
  const runner = new GameRunner(
    game,
    new Executor(game, "c5-e5-recon", clientID),
    (result) => {
      if ("updates" in result) last = result;
    },
    clientID,
  );
  game.queueViewResync();
  runner.addTurn({ turnNumber: game.ticks(), intents: [] });
  expect(runner.executeNextTick()).toBe(true);
  if (last === null) throw new Error("No NATIONAL packet");
  return last as GameUpdateViewData;
}

function packetHasUnit(p: GameUpdateViewData, id: number): boolean {
  return unpackUnitUpdates(p.packedUnitUpdates, p.packedMissileTimers).some(
    (u) => u.id === id && u.isActive,
  );
}

describe("M7 paid regional intelligence in authoritative Game/GameRunner", () => {
  it("charges exactly once and makes a genuinely hidden ship/structure visible in AI AND human packets, then revokes on movement and expiry", async () => {
    const game = await liveGame();
    const buyer = game.player(BUYER.id);
    const target = game.player(TARGET.id);
    const center = game.ref(185, 175);
    const ship = target.buildUnit(UnitType.TransportShip, center, {
      troops: 987_654,
      targetTile: game.ref(20, 100),
    });
    const factory = target.buildUnit(UnitType.Factory, game.ref(186, 175), {});
    const far = target.buildUnit(UnitType.City, game.ref(190, 10), {});
    const unrelated = game
      .player(STRANGER.id)
      .buildUnit(UnitType.City, game.ref(190, 95), {});
    expect(visible(game, BUYER.id, ship.id())).toBeUndefined();
    expect(visible(game, BUYER.id, factory.id())).toBeUndefined();
    expect(packetHasUnit(packet(game, BUYER.clientID!), ship.id())).toBe(false);

    buyer.addGold(1_500n);
    const before = buyer.gold();
    const lease = game.performNationalReconnaissance(
      buyer,
      TARGET.id,
      185,
      175,
      "paid_recon_1",
      BUYER.clientID!,
    );
    expect(lease.cost).toBe("500");
    expect(lease.radius).toBe(REGIONAL_RECON_RADIUS);
    expect(lease.effectiveTick).toBe(game.ticks());
    expect(lease.expiresAtTick).toBe(
      game.ticks() + REGIONAL_RECON_DURATION_TICKS,
    );
    expect(buyer.gold()).toBe(before - REGIONAL_RECON_COST);

    const aiView = collectLiveNationalObservation(game, BUYER.id).observation;
    expect(
      aiView.visibleAssets.find((a) => a.id === String(ship.id()))?.source,
    ).toBe("recon");
    expect(
      aiView.visibleAssets.find((a) => a.id === String(factory.id()))?.source,
    ).toBe("recon");
    expect(visible(game, BUYER.id, far.id())).toBeUndefined();
    // Existing lawful geographic sight may reveal this co-located structure;
    // the purchase must NEVER be the authority for an unrelated owner.
    // Position is inside the 90-tile purchase circle but belongs to a
    // different actual sovereign: target-only recon MUST reject it.
    expect(unrelated.owner().id()).toBe(STRANGER.id);
    expect(visible(game, BUYER.id, unrelated.id())?.source).not.toBe("recon");
    expect(packetHasUnit(packet(game, BUYER.clientID!), ship.id())).toBe(true);

    // A full structured inspection may report an observed ship ID/type but
    // must never reveal its landing target, troop count or another treasury.
    const observed = visible(game, BUYER.id, ship.id());
    expect(observed).toBeDefined();
    expect(JSON.stringify(observed)).not.toContain("987654");
    expect(JSON.stringify(observed)).not.toContain("landingDestination");

    const afterWire = buyer.gold();
    expect(() =>
      game.performNationalReconnaissance(
        buyer,
        TARGET.id,
        185,
        175,
        "paid_recon_1",
        BUYER.clientID!,
      ),
    ).toThrow(/duplicate/);
    // Ordinary turn execution may earn independent worker gold; replays
    // may not remove even one extra unit of the current exact balance.
    expect(buyer.gold()).toBe(afterWire);

    ship.move(game.ref(15, 15));
    expect(visible(game, BUYER.id, ship.id())).toBeUndefined();
    ship.move(center);
    expect(visible(game, BUYER.id, ship.id())).toBeDefined();

    // Observe on the LAST authorized tick, then cross exactly ONE tick
    // to expiry. Prior memory would otherwise last another 60 ticks.
    while (game.ticks() < lease.expiresAtTick - 1) game.executeNextTick();
    const lastLawful = collectLiveNationalObservation(
      game,
      BUYER.id,
    ).observation;
    expect(
      lastLawful.visibleAssets.some(
        (asset) => asset.id === String(factory.id()),
      ),
    ).toBe(true);
    const memory = advanceLastKnown(lastLawful, null, 60).memory;
    game.executeNextTick();
    expect(game.ticks()).toBe(lease.expiresAtTick);
    expect(visible(game, BUYER.id, factory.id())).toBeUndefined();
    expect(visible(game, BUYER.id, ship.id())).toBeUndefined();
    const expired = collectLiveNationalObservation(game, BUYER.id).observation;
    expect(advanceLastKnown(expired, memory, 60).stale).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: String(factory.id()) }),
      ]),
    );
    expect(packetHasUnit(packet(game, BUYER.clientID!), ship.id())).toBe(false);
    expect(game.nationalReconnaissanceFor(BUYER.id)).toEqual([]);
    // Reconnection from an authoritative snapshot cannot renew an expired
    // lease or erase the durable duplicate-request receipt.
    const {
      restored: reconnected,
      bytes,
      again,
    } = await roundTrip(game, "big_plains");
    expect(again).toEqual(bytes);
    expect(reconnected.nationalReconnaissanceFor(BUYER.id)).toEqual([]);
    expect(visible(reconnected, BUYER.id, factory.id())).toBeUndefined();
    expect(
      packetHasUnit(packet(reconnected, BUYER.clientID!), factory.id()),
    ).toBe(false);
    expect(() =>
      reconnected.performNationalReconnaissance(
        reconnected.player(BUYER.id),
        TARGET.id,
        185,
        175,
        "paid_recon_1",
        BUYER.clientID!,
      ),
    ).toThrow(/duplicate/);
  });

  it("shares an active purchase only among present reciprocal empire members", async () => {
    const game = await liveGame();
    const buyer = game.player(BUYER.id);
    const ally = game.player(ALLY.id);
    const factory = game
      .player(TARGET.id)
      .buildUnit(UnitType.Factory, game.ref(185, 175), {});
    buyer.addGold(1_000n);
    game.performNationalReconnaissance(
      buyer,
      TARGET.id,
      185,
      175,
      "shared_recon_1",
      BUYER.clientID!,
    );
    expect(visible(game, ALLY.id, factory.id())).toBeUndefined();
    // A nearby outsider can legitimately see this factory by its OWN border
    // sensor, but cannot inherit the buyer's paid "recon" provenance.
    expect(visible(game, STRANGER.id, factory.id())?.source).not.toBe("recon");

    game.performNationalCommand(buyer, {
      kind: "found-empire",
      empireId: "recon_empire",
    });
    game.performNationalCommand(buyer, {
      kind: "offer-empire",
      empireId: "recon_empire",
      candidateId: ALLY.id,
    });
    game.performNationalCommand(ally, {
      kind: "accept-empire",
      empireId: "recon_empire",
      candidateId: ALLY.id,
    });
    const shared = visible(game, ALLY.id, factory.id());
    expect(shared?.source).toBe("empire");
    expect(shared?.sourceNationId).toBe(BUYER.id);
    expect(visible(game, STRANGER.id, factory.id())?.source).not.toBe("recon");

    // Fault-inject a stale membership roster (not a live revocation) and
    // require the reciprocal current empireOf guard to terminate disclosure.
    const authority = game.nationalPoliticalAuthority()!;
    const spy = vi
      .spyOn(game, "nationalPoliticalAuthority")
      .mockImplementation(() => ({
        ...authority,
        membersOf: (id: string) => authority.membersOf(id),
        emperorOf: (id: string) => authority.emperorOf(id),
        empireOf: (id: string) =>
          id === BUYER.id ? null : authority.empireOf(id),
      }));
    try {
      expect(visible(game, ALLY.id, factory.id())).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
    // Genuine Game-owned dissolution (not a mocked membership). The
    // purchased grant remains buyer-owned but the former ally loses rights.
    game.performNationalImperialAdministration(buyer, {
      kind: "dissolve",
      empireId: "recon_empire",
    });
    expect(game.nationalPoliticalAuthority()?.empireOf(ALLY.id)).toBeNull();
    expect(visible(game, ALLY.id, factory.id())).toBeUndefined();
    expect(visible(game, BUYER.id, factory.id())?.source).toBe("recon");
  });

  it("stamps payer from Game's actual human session, rejects forgery and malformed or unfunded commands, and preserves replay rejection", async () => {
    const game = await liveGame();
    const buyer = game.player(BUYER.id);
    buyer.addGold(1_000n);
    const before = buyer.gold();
    const intent = {
      type: "national_buy_regional_recon" as const,
      targetId: TARGET.id,
      centerX: 185,
      centerY: 175,
      requestId: "queued_recon_1",
    };
    expect(
      NationalReconnaissanceIntentSchema.safeParse({
        ...intent,
        centerX: -1,
      }).success,
    ).toBe(false);
    expect(
      NationalReconnaissanceIntentSchema.safeParse({
        ...intent,
        requestId: "bad space",
      }).success,
    ).toBe(false);
    expect(() =>
      game.performNationalReconnaissance(
        buyer,
        TARGET.id,
        185,
        175,
        "wrong_client",
        "other-client",
      ),
    ).toThrow(/stale authenticated/);
    expect(() =>
      game.performNationalReconnaissance(
        buyer,
        BUYER.id,
        185,
        175,
        "own_target",
        BUYER.clientID!,
      ),
    ).toThrow(/invalid region/);
    expect(buyer.gold()).toBe(before);

    const execution = new Executor(
      game,
      "recon-e5",
      BUYER.clientID!,
    ).createExec({
      ...intent,
      clientID: BUYER.clientID!,
    });
    game.addExecution(execution);
    const { restored, bytes, again } = await roundTrip(game, "big_plains");
    expect(again).toEqual(bytes);
    // GameImpl first INITs queued executions, then invokes tick on the next
    // turn. The original and restored Game must match across both boundaries.
    const originalDebits = vi.spyOn(game.player(BUYER.id), "removeGold");
    const restoredDebits = vi.spyOn(restored.player(BUYER.id), "removeGold");
    game.executeNextTick();
    restored.executeNextTick();
    game.executeNextTick();
    restored.executeNextTick();
    expect(
      originalDebits.mock.calls.filter(
        ([gold]) => gold === REGIONAL_RECON_COST,
      ),
    ).toHaveLength(1);
    expect(
      restoredDebits.mock.calls.filter(
        ([gold]) => gold === REGIONAL_RECON_COST,
      ),
    ).toHaveLength(1);
    originalDebits.mockRestore();
    restoredDebits.mockRestore();
    // The real game can also credit recurring income on execution ticks;
    // compare exact post-turn balances to the independently restored game.
    const paidBalance = game.player(BUYER.id).gold();
    expect(restored.player(BUYER.id).gold()).toBe(paidBalance);
    expect(game.nationalReconnaissanceFor(BUYER.id)).toHaveLength(1);
    expect(game.nationalReconnaissanceFor(BUYER.id)).toEqual(
      restored.nationalReconnaissanceFor(BUYER.id),
    );
    const { restored: rehydrated } = await roundTrip(restored, "big_plains");
    expect(() =>
      rehydrated.performNationalReconnaissance(
        rehydrated.player(BUYER.id),
        TARGET.id,
        185,
        175,
        intent.requestId,
        BUYER.clientID!,
      ),
    ).toThrow(/duplicate/);
    expect(rehydrated.player(BUYER.id).gold()).toBe(paidBalance);
  });

  it("rejects insufficient gold with no lease, then buys only after a real credit", async () => {
    const game = await liveGame();
    const buyer = game.player(BUYER.id);
    const initial = buyer.gold();
    if (initial >= REGIONAL_RECON_COST) buyer.removeGold(initial);
    expect(() =>
      game.performNationalReconnaissance(
        buyer,
        TARGET.id,
        185,
        175,
        "insufficient_1",
        BUYER.clientID!,
      ),
    ).toThrow(/insufficient gold/);
    expect(game.nationalReconnaissanceFor(BUYER.id)).toEqual([]);
    buyer.addGold(REGIONAL_RECON_COST);
    const original = buyer.gold();
    game.performNationalReconnaissance(
      buyer,
      TARGET.id,
      185,
      175,
      "funded_1",
      BUYER.clientID!,
    );
    expect(buyer.gold()).toBe(original - REGIONAL_RECON_COST);
  });

  it("profiles a deterministic 120-sovereign lease lookup without a global map scan", () => {
    const ledger = new NationalReconnaissance();
    for (let n = 0; n < 120; n++) {
      ledger.buy("nation" + n, "target", n, n, 5, "req" + n, () => {});
    }
    const start = performance.now();
    let total = 0;
    for (let i = 0; i < 120; i++) {
      total += ledger.activeFor("nation" + i, 5).length;
    }
    const elapsed = performance.now() - start;
    expect(total).toBe(120);
    expect(ledger.activeFor("nation0", 605)).toEqual([]);
    expect(
      NationalReconnaissance.restore(ledger.snapshot(), 5).snapshot(),
    ).toEqual(ledger.snapshot());
    const forged = ledger.snapshot();
    expect(() =>
      NationalReconnaissance.restore(
        {
          ...forged,
          grants: [
            { ...forged.grants[0], expiresAtTick: 606 },
            ...forged.grants.slice(1),
          ],
        },
        5,
      ),
    ).toThrow(/invalid restored grant/);
    console.info(
      "[M7 120-nation ledger] active=120 elapsedMs=" + elapsed.toFixed(3),
    );
  });
});
