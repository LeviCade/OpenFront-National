import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { NationalSanctionExecution } from "@openfront/engine/execution/NationalSanctionExecution";
import { TradeShipExecution } from "@openfront/engine/execution/TradeShipExecution";
import { TrainExecution } from "@openfront/engine/execution/TrainExecution";
import type { Game, Player, Unit } from "@openfront/engine/game/Game";
import { Railroad } from "@openfront/engine/game/Railroad";
import { TrainStation } from "@openfront/engine/game/TrainStation";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

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
function trace(game: Game, label: string) {
  console.info(
    "C5_E3_IMPERIAL_TRADE_WITNESS=" +
      JSON.stringify({
        label,
        tick: game.ticks(),
        money: people.map((i) => {
          const p = game.player(i.id);
          return {
            id: p.id(),
            gold: p.gold().toString(),
            ship: p.tradeGold().toString(),
            rail: p.trainGold().toString(),
            canTradeTarget:
              p.id() === TARGET ? null : p.canTrade(game.player(TARGET)),
          };
        }),
        charter: game.nationalEconomicCharterFor(game.player(DELEGATE)),
        treasury:
          game.nationalImperialAdministrationFor(game.player(CROWN))
            ?.treasury ?? null,
        demands: NationalSanctionExecution.viewFor(game, game.player(ISSUER)),
      }),
  );
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
function charter(
  game: Game,
  emperor: Player,
  expectedVersion: number,
  delegateIds: string[],
  allowInternal = false,
) {
  game.performNationalCommand(emperor, {
    kind: "imperial-administration",
    command: {
      kind: "set-economic-charter",
      empireId: EMPIRE,
      expectedVersion,
      delegateIds,
      allowInternal,
    },
  });
}
function order(
  game: Game,
  emperor: Player,
  memberId: string,
  targetId: string,
  embargo: boolean,
  expectedVersion: number,
) {
  game.performNationalCommand(emperor, {
    kind: "imperial-administration",
    command: {
      kind: "set-member-trade",
      empireId: EMPIRE,
      memberId,
      targetId,
      embargo,
      expectedVersion,
    },
  });
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
function respond(
  game: Game,
  player: Player,
  sanctionId: string,
  decision: "comply" | "refuse",
  requestId: string,
  expectedCharterVersion?: number,
) {
  game.addExecution(
    new NationalSanctionExecution(player, {
      type: "national_respond_sanction",
      sanctionId,
      decision,
      requestId,
      ...(expectedCharterVersion === undefined
        ? {}
        : { expectedCharterVersion }),
    }),
  );
  run(game);
}
function trade(game: Game, owner: Player, src: Unit, dst: Unit): bigint {
  const previous = owner.tradeGold();
  const execution = new TradeShipExecution(owner, src, dst);
  game.addExecution(execution);
  run(game);
  if (execution.isActive()) until(game, () => !execution.isActive());
  return owner.tradeGold() - previous;
}
function railway(game: Game, sourcePlayer: Player, targetPlayer: Player) {
  const route = Array.from({ length: 12 }, (_, y) => game.ref(3, y + 1));
  sourcePlayer.conquer(route[0]);
  targetPlayer.conquer(route[route.length - 1]);
  const source = new TrainStation(
    game,
    sourcePlayer.buildUnit(UnitType.City, route[0], {}),
  );
  const target = new TrainStation(
    game,
    targetPlayer.buildUnit(UnitType.City, route[route.length - 1], {}),
  );
  const network = game.railNetwork();
  network.stationManager().addStation(source);
  network.stationManager().addStation(target);
  const line = new Railroad(source, target, route, 1);
  source.addRailroad(line);
  target.addRailroad(line);
  return () => {
    const before = sourcePlayer.trainGold();
    const train = new TrainExecution(network, sourcePlayer, source, target, 1);
    game.addExecution(train);
    run(game);
    if (train.isActive()) until(game, () => !train.isActive());
    return sourcePlayer.trainGold() - before;
  };
}

describe("C5 C3 E3 imperial member economic charter on real Game", () => {
  it("delegated external sanction blocks actual paid ship and rail, emperor overrides one pair, independent trade survives", async () => {
    const { game, a, b, c, d, e, src, dst, other } = await world();
    game.performNationalCommand(a, {
      kind: "imperial-administration",
      command: {
        kind: "set-policy",
        empireId: EMPIRE,
        policy: {
          workerIncomeBps: 0,
          nonWorkerIncomeBps: 4000,
          allowedConstruction: null,
        },
      },
    });
    const train = railway(game, c, e);
    const paidShip = trade(game, c, src, dst);
    const paidRail = train();
    expect(paidShip).toBeGreaterThan(0n);
    expect(paidRail).toBeGreaterThan(0n);
    const initialTreasury = BigInt(
      game.nationalImperialAdministrationFor(a)!.treasury,
    );
    expect(initialTreasury).toBeGreaterThan(0n);

    charter(game, a, 0, [DELEGATE]);
    const id = issue(game, b, TARGET, [DELEGATE, MEMBER], "member-sanction-1");
    expect(game.nationalEconomicCharterFor(c)?.delegated).toBe(true);
    expect(game.nationalEconomicCharterFor(d)?.delegated).toBe(false);
    // Forged principal and undelegated subordinates cannot change policy.
    game.addExecution(
      new NationalSanctionExecution(
        c,
        {
          type: "national_respond_sanction",
          sanctionId: id,
          decision: "comply",
          expectedCharterVersion: 1,
          requestId: "forged-origin",
        },
        "forged-client",
      ),
    );
    respond(game, d, id, "comply", "undelegated");
    expect(c.canTrade(e)).toBe(true);
    expect(d.canTrade(e)).toBe(true);
    respond(game, c, id, "comply", "delegated-yes", 1);
    expect(c.canTrade(e)).toBe(false);
    expect(d.canTrade(e)).toBe(true);
    const noGold = [
      c.gold(),
      e.gold(),
      BigInt(game.nationalImperialAdministrationFor(a)!.treasury),
    ];
    expect(trade(game, c, src, dst)).toBe(0n);
    expect(train()).toBe(0n);
    expect([
      c.gold(),
      e.gold(),
      BigInt(game.nationalImperialAdministrationFor(a)!.treasury),
    ]).toEqual(noGold);

    order(game, a, DELEGATE, TARGET, false, 1);
    expect(c.canTrade(e)).toBe(true);
    expect(train()).toBeGreaterThan(0n);
    expect(trade(game, c, src, dst)).toBeGreaterThan(0n);
    expect(game.nationalEconomicCharterFor(c)?.version).toBe(2);
    game.performNationalCommand(a, {
      kind: "imperial-administration",
      command: {
        kind: "respond-member-sanction",
        empireId: EMPIRE,
        expectedVersion: 2,
        memberId: MEMBER,
        sanctionId: id,
        decision: "comply",
      },
    });
    expect(d.canTrade(e)).toBe(false);
    expect(c.canTrade(e)).toBe(true);
    expect(trade(game, b, other, dst)).toBeGreaterThan(0n);
    expect(game.nationalWarAuthority()?.atWar(DELEGATE, TARGET)).toBe(false);
    trace(game, "paid-ship-rail-and-override");
  });

  it("rejects internal outsider coercion, forged emperor, stale epochs, and revoked/replayed grants", async () => {
    const { game, a, b, c, d, e } = await world();
    charter(game, a, 0, [MEMBER]);
    const internal = issue(game, b, DELEGATE, [MEMBER], "internal-issuer");
    expect(() => charter(game, d, 1, [MEMBER])).toThrow();
    expect(() => charter(game, a, 0, [MEMBER])).toThrow();
    respond(game, d, internal, "comply", "no-internal-right", 1);
    expect(d.canTrade(c)).toBe(true);
    expect(NationalSanctionExecution.viewFor(game, d)[0].response).toBe("none");

    charter(game, a, 1, [MEMBER], true);
    respond(game, d, internal, "comply", "old-epoch", 1);
    expect(d.canTrade(c)).toBe(true);
    respond(game, d, internal, "comply", "authorized-internal", 2);
    expect(d.canTrade(c)).toBe(false);
    expect(game.nationalWarAuthority()?.atWar(MEMBER, DELEGATE)).toBe(false);
    expect(() => order(game, a, MEMBER, TARGET, true, 1)).toThrow();
    order(game, a, MEMBER, TARGET, true, 2);
    expect(d.canTrade(e)).toBe(false);
    expect(c.canTrade(e)).toBe(true);
    expect(() => order(game, a, MEMBER, TARGET, false, 2)).toThrow();

    charter(game, a, 3, []);
    const external = issue(game, b, TARGET, [MEMBER], "revoked-grant");
    respond(game, d, external, "comply", "revoked-member", 3);
    expect(
      NationalSanctionExecution.viewFor(game, d).find((v) => v.id === external)
        ?.response,
    ).toBe("none");

    game.performNationalCommand(a, {
      kind: "transfer-crown",
      empireId: EMPIRE,
      successorId: DELEGATE,
    });
    expect(game.nationalEconomicCharterFor(d)?.delegated).toBe(false);
    expect(() => order(game, a, MEMBER, TARGET, false, 4)).toThrow();
    expect(() => order(game, c, MEMBER, TARGET, false, 3)).toThrow();
    charter(game, c, 4, [MEMBER]);
    order(game, c, MEMBER, TARGET, false, 5);
    expect(d.canTrade(e)).toBe(true);
    trace(game, "crown-revocation-internal-boundary");
  });

  it("retains current charter, embargo and paid-trade hash through snapshot/replay; collapse invalidates queued imperial grants", async () => {
    const { game, a, b, c, e } = await world();
    charter(game, a, 0, [DELEGATE]);
    const id = issue(game, b, TARGET, [DELEGATE], "save-sanction");
    respond(game, c, id, "comply", "save-comply", 1);
    expect(c.canTrade(e)).toBe(false);
    const { restored, bytes, again } = await roundTrip(game, MAP);
    expect(again).toEqual(bytes);
    for (const g of [game, restored]) {
      expect(g.nationalEconomicCharterFor(g.player(DELEGATE))?.delegated).toBe(
        true,
      );
      expect(g.player(DELEGATE).canTrade(g.player(TARGET))).toBe(false);
      expect(
        trade(
          g,
          g.player(DELEGATE),
          g.player(DELEGATE).units(UnitType.Port)[0],
          g.player(TARGET).units(UnitType.Port)[0],
        ),
      ).toBe(0n);
      g.performNationalCommand(g.player(CROWN), {
        kind: "imperial-administration",
        command: {
          kind: "set-economic-charter",
          empireId: EMPIRE,
          expectedVersion: 1,
          delegateIds: [],
          allowInternal: false,
        },
      });
      respond(
        g,
        g.player(DELEGATE),
        id,
        "refuse",
        "stale-response-after-revoke",
        1,
      );
      expect(g.player(DELEGATE).canTrade(g.player(TARGET))).toBe(false);
      g.performNationalCommand(g.player(CROWN), {
        kind: "imperial-administration",
        command: {
          kind: "dissolve",
          empireId: EMPIRE,
        },
      });
      expect(g.nationalEconomicCharterFor(g.player(DELEGATE))).toBeNull();
      // A previously stamped imperial grant MUST NOT revive as independent authority.
      respond(g, g.player(DELEGATE), id, "comply", "stale-after-collapse", 1);
      expect(g.player(DELEGATE).hasManualEmbargoAgainst(g.player(TARGET))).toBe(
        true,
      );
      expect(g.nationalPoliticalAuthority()?.empireOf(DELEGATE)).toBeNull();
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    trace(game, "durable-replay-and-collapse");
  });
  it("delegated refusal leaves foreign trade lawful while independent issuer enforces only its own recipients", async () => {
    const { game, a, b, c, d, e, src, dst, other } = await world();
    charter(game, a, 0, [DELEGATE]);
    const id = issue(game, b, TARGET, [DELEGATE, MEMBER], "member-refusal");
    respond(game, c, id, "refuse", "member-explicit-refusal", 1);
    expect(NationalSanctionExecution.viewFor(game, c)[0].response).toBe("refuse");
    expect(c.canTrade(e)).toBe(true);
    expect(d.canTrade(e)).toBe(true);
    until(
      game,
      () => NationalSanctionExecution.viewFor(game, b)[0].phase === "decision-required",
      300,
    );
    // A foreign issuer's resolve choice is independent: emperor is NOT issuer.
    game.addExecution(new NationalSanctionExecution(a, {
      type: "national_resolve_sanction", sanctionId: id,
      decision: "enforce", requestId: "forged-emperor-issuer",
    }));
    run(game);
    expect(b.canTrade(c)).toBe(true);
    const before = b.tradeGold();
    game.addExecution(new NationalSanctionExecution(b, {
      type: "national_resolve_sanction", sanctionId: id,
      decision: "enforce", requestId: "issuer-enforce-member-refusal",
    }));
    run(game);
    expect(NationalSanctionExecution.viewFor(game, b)[0].phase).toBe("enforced");
    expect(b.canTrade(c)).toBe(false);
    expect(b.canTrade(d)).toBe(false);
    expect(c.canTrade(e)).toBe(true);
    expect(d.canTrade(e)).toBe(true);
    expect(a.canTrade(e)).toBe(true);
    expect(trade(game, c, src, dst)).toBeGreaterThan(0n);
    expect(trade(game, b, other, dst)).toBeGreaterThan(0n);
    expect(b.tradeGold()).toBeGreaterThan(before);
    expect(game.nationalWarAuthority()?.atWar(ISSUER, DELEGATE)).toBe(false);
    trace(game, "member-refusal-and-scoped-issuer-enforcement");
  });

  it("authenticated political journal issues recipient-only receipts and rejects replay after spent CAS", async () => {
    const { game, a, b, c, d } = await world();
    const cmd = {
      kind: "imperial-administration" as const,
      command: {
        kind: "set-economic-charter" as const, empireId: EMPIRE,
        expectedVersion: 0, delegateIds: [DELEGATE], allowInternal: false,
      },
    };
    const original = game.performNationalPoliticalCommandWithOutcome(
      a, cmd, "c5-e3-journal-charter",
    );
    expect(original.accepted).toBe(true);
    expect(original.requestId).toBe("c5-e3-journal-charter");
    expect(game.nationalPoliticalCommandResults(a).some(
      (row) => row.requestId === "c5-e3-journal-charter" && row.accepted,
    )).toBe(true);
    expect(game.nationalPoliticalCommandResults(b)).toEqual([]);
    expect(game.nationalPoliticalCommandResults(c)).toEqual([]);
    expect(game.nationalEconomicCharterFor(c)?.version).toBe(1);
    // A duplicate cannot silently re-enforce an outdated economic decree.
    expect(() => game.performNationalPoliticalCommandWithOutcome(
      a, cmd, "c5-e3-journal-charter",
    )).toThrow(/stale sovereign replay authority/);
    expect(game.nationalEconomicCharterFor(c)?.version).toBe(1);
    expect(() => game.performNationalPoliticalCommandWithOutcome(
      d, cmd, "c5-e3-journal-charter",
    )).toThrow(/reused foreign request ID/);
    const spoof = game.performNationalPoliticalCommandWithOutcome(
      d, { ...cmd, command: { ...cmd.command, expectedVersion: 1 } },
      "c5-e3-journal-impostor",
    );
    expect(spoof.accepted).toBe(false);
    expect(game.nationalEconomicCharterFor(c)?.version).toBe(1);
    const noPolicy = game.nationalPoliticalCommandResults(b);
    expect(noPolicy).toEqual([]);
    trace(game, "journal-receipt-and-epoch-replay");
  });

});
