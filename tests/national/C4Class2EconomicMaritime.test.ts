import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { NationalIssueSanctionIntentSchema } from "@openfront/engine-api/Schemas";
import { EmbargoExecution } from "@openfront/engine/execution/EmbargoExecution";
import { NationalSanctionExecution } from "@openfront/engine/execution/NationalSanctionExecution";
import { PortExecution } from "@openfront/engine/execution/PortExecution";
import { ShellExecution } from "@openfront/engine/execution/ShellExecution";
import { TradeShipExecution } from "@openfront/engine/execution/TradeShipExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import type { Game, Player, Unit } from "@openfront/engine/game/Game";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const MAP = "half_land_half_ocean";
const [A, B, C, D] = ["e3-a", "e3-b", "e3-c", "e3-d"];
const roster = [A, B, C, D].map(
  (id) => new PlayerInfo(id, PlayerType.Human, null, id),
);

// Deliberately small physical map and proportional patrol scale. No mocked
// authority, positions, balances, ship movement or pathfinder.
class MaritimeConfig extends TestConfig {
  warshipPatrolRange(): number {
    return 16;
  }
  safeFromPiratesCooldownMax(): number {
    return 0;
  }
}

async function fixture(nationalMode = true) {
  const game = await setup(
    MAP,
    { nationalMode, instantBuild: true },
    roster,
    undefined,
    MaritimeConfig,
  );
  const players = roster.map((info, index) => {
    const player = game.player(info.id);
    const spawn = game.ref(1, index * 4 + 1);
    player.conquer(spawn);
    player.setSpawnTile(spawn);
    player.addGold(1_000_000_000n);
    return player;
  });
  game.executeNextTick();
  const [a, b, c, d] = players;
  const port = (player: Player, y: number) => {
    const tile = game.ref(7, y);
    player.conquer(tile);
    return player.buildUnit(UnitType.Port, tile, {});
  };
  const home = port(c, 1);
  const enemy = port(b, 14);
  const own = port(a, 10);
  const other = port(d, 5);
  game.executeNextTick();
  return { game, a, b, c, d, home, enemy, own, other, port };
}

function ticks(game: Game, count: number) {
  for (let i = 0; i < count; i++) game.executeNextTick();
}

function until(game: Game, done: () => boolean, limit = 100) {
  for (let i = 0; i < limit && !done(); i++) game.executeNextTick();
  expect(done()).toBe(true);
}

function war(game: Game, actor = A, from = A, to = B, id = "e3-war") {
  const result = game.performNationalWarCommandWithOutcome(game.player(actor), {
    kind: "declare-national",
    warId: id,
    aggressorId: from,
    targetId: to,
  });
  expect(result.accepted).toBe(true);
}

function peace(
  game: Game,
  from = A,
  to = B,
  warId = "e3-war",
  motionId = "e3-peace",
) {
  expect(
    game.performNationalWarCommandWithOutcome(game.player(from), {
      kind: "propose-peace",
      warId,
      motionId,
    }).accepted,
  ).toBe(true);
  expect(
    game.performNationalWarCommandWithOutcome(game.player(to), {
      kind: "accept-peace",
      motionId,
    }).accepted,
  ).toBe(true);
}

function balances(game: Game) {
  return roster.map(({ id }) => {
    const p = game.player(id);
    return {
      id,
      gold: p.gold(),
      trade: p.tradeGold(),
      piracy: p.piracyGold(),
    };
  });
}

function witness(
  game: Game,
  scenario: string,
  before: ReturnType<typeof balances>,
  ship: Unit | undefined,
) {
  console.info(
    "C4_E3_MARITIME_WITNESS=" +
      JSON.stringify(
        {
          scenario,
          tick: game.ticks(),
          before,
          after: balances(game),
          ship: ship
            ? { id: ship.id(), owner: ship.owner().id(), tile: ship.tile() }
            : null,
        },
        (_, value) => (typeof value === "bigint" ? value.toString() : value),
      ),
  );
}

function sail(game: Game, owner: Player, src: Unit, dst: Unit) {
  const execution = new TradeShipExecution(owner, src, dst);
  game.addExecution(execution);
  ticks(game, 2);
  return execution;
}

function fleet(game: Game, p: Player, x: number, y: number) {
  const tile = game.ref(x, y);
  return p.buildUnit(UnitType.Warship, tile, { patrolTile: tile });
}

describe("C4 Class 2 E3 real NATIONAL economic and maritime execution", () => {
  it("ECON-01 embargo denies actual port selection and queued voyage, never grants piracy, and survives peace", async () => {
    const { game, a, b, own, enemy } = await fixture();
    game.addExecution(new EmbargoExecution(a, B, "start"));
    ticks(game, 2);
    expect(a.canTrade(b)).toBe(false);
    expect(b.canTrade(a)).toBe(false);
    expect(game.nationalWarAuthority()?.atWar(A, B)).toBe(false);

    const port = new PortExecution(own);
    port.init(game, game.ticks());
    expect(port.tradingPorts().map(({ port }) => port.id())).not.toContain(
      enemy.id(),
    );
    const before = balances(game);
    const denied = sail(game, a, own, enemy);
    expect(denied.isActive()).toBe(false);
    expect(a.units(UnitType.TradeShip)).toHaveLength(0);
    expect(balances(game)).toEqual(before);

    const ship = b.buildUnit(UnitType.TradeShip, game.ref(8, 11), {
      targetUnit: enemy,
      lastSetSafeFromPirates: -100,
    });
    const patrol = fleet(game, a, 8, 10);
    game.addExecution(new WarshipExecution(patrol));
    ticks(game, 5);
    expect(ship.owner()).toBe(b);
    expect(a.piracyGold()).toBe(0n);

    war(game);
    expect(a.canTrade(b)).toBe(false);
    peace(game);
    expect(a.hasManualEmbargoAgainst(b)).toBe(true);
    expect(a.canTrade(b)).toBe(false);
    game.addExecution(new EmbargoExecution(a, B, "stop"));
    ticks(game, 2);
    expect(a.canTrade(b)).toBe(true);
    expect(ship.owner()).toBe(b);
    witness(game, "ECON-01", before, ship);
  });

  it("formal war itself blocks both directions; temporary legacy combat embargo does not survive peace as policy", async () => {
    const { game, a, b, own, enemy } = await fixture();
    const before = balances(game);
    war(game);
    b.addEmbargo(a, true);
    expect(a.canTrade(b)).toBe(false);
    expect(b.canTrade(a)).toBe(false);
    expect(sail(game, a, own, enemy).isActive()).toBe(false);
    expect(balances(game)).toEqual(before);
    peace(game);
    expect(a.canTrade(b)).toBe(true);
    expect(b.canTrade(a)).toBe(true);
    const voyage = sail(game, a, own, enemy);
    until(game, () => !voyage.isActive());
    expect(a.tradeGold()).toBeGreaterThan(0n);
    expect(b.tradeGold()).toBe(a.tradeGold());
    expect(a.gold() - before[0].gold).toBe(a.tradeGold());
    expect(b.gold() - before[1].gold).toBe(b.tradeGold());
    witness(game, "WAR-trade-restored", before, undefined);
  });

  it("NAV-02/05: actual neutral voyage is turned home, persists through restore and peace, never earns money", async () => {
    const { game, a, b, c, home, enemy } = await fixture();
    war(game);
    const blockader = fleet(game, a, 8, 12);
    fleet(game, a, 9, 12);
    const before = balances(game);
    const voyage = sail(game, c, home, enemy);
    const ship = c.units(UnitType.TradeShip)[0];
    expect(ship).toBeDefined();
    expect(ship.targetUnit()).toBe(enemy);
    until(game, () => ship.targetUnit() === home);
    expect(ship.isActive()).toBe(true);
    expect(ship.owner()).toBe(c);
    const turningTile = ship.tile();
    expect(turningTile).not.toBe(home.tile());
    const { restored, bytes, again } = await roundTrip(game, MAP);
    expect(again).toEqual(bytes);
    // Peace and removal do not resurrect this already failed voyage.
    for (const g of [game, restored]) {
      peace(g);
      const current = g.player(C).units(UnitType.TradeShip)[0];
      expect(current.id()).toBe(ship.id());
      expect(current.targetUnit()?.id()).toBe(home.id());
      expect(current.tile()).toBe(turningTile);
      const positions = new Set<number>([turningTile]);
      for (let i = 0; i < 100 && current.isActive(); i++) {
        g.executeNextTick();
        positions.add(current.tile());
      }
      expect(current.isActive()).toBe(false);
      expect(current.owner().id()).toBe(C);
      expect(current.tile()).toBe(home.tile());
      expect(positions.size).toBeGreaterThan(1);
      expect(balances(g)).toEqual(before);
    }
    expect(voyage.isActive()).toBe(false);
    expect(blockader.isActive()).toBe(true);
    expect(b.tradeGold()).toBe(0n);
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    witness(game, "NAV-02/05", before, ship);
  });

  it("NAV-02: loss of original port during return selects a real alternative owned port", async () => {
    const { game, a, c, home, enemy, port } = await fixture();
    war(game);
    fleet(game, a, 8, 12);
    const voyage = sail(game, c, home, enemy);
    const ship = c.units(UnitType.TradeShip)[0];
    until(game, () => ship.targetUnit() === home);
    const alternative = port(c, 3);
    home.delete(false);
    const before = balances(game);
    until(game, () => !voyage.isActive());
    expect(ship.targetUnit()).toBe(alternative);
    expect(ship.tile()).toBe(alternative.tile());
    expect(ship.owner()).toBe(c);
    expect(balances(game)).toEqual(before);
    witness(game, "NAV-02-home-loss", before, ship);
  });

  it("NAV-03/04: unrelated destination, displacement, destruction and peace do not stop fresh legitimate trade", async () => {
    const { game, a, b, c, d, home, enemy, other } = await fixture();
    war(game);
    const blockader = fleet(game, a, 8, 12);
    const before = balances(game);
    const unrelated = sail(game, c, home, other);
    until(game, () => !unrelated.isActive());
    expect(c.tradeGold()).toBeGreaterThan(0n);
    expect(d.tradeGold()).toBe(c.tradeGold());
    expect(b.tradeGold()).toBe(0n);

    blockader.move(game.ref(15, 0));
    const far = sail(game, c, home, enemy);
    until(game, () => !far.isActive());
    const afterFar = b.tradeGold();
    expect(afterFar).toBeGreaterThan(0n);

    blockader.delete(false);
    const removed = sail(game, c, home, enemy);
    until(game, () => !removed.isActive());
    expect(b.tradeGold()).toBeGreaterThan(afterFar);
    const afterRemoved = b.tradeGold();

    fleet(game, a, 8, 12);
    peace(game);
    const peaceful = sail(game, c, home, enemy);
    until(game, () => !peaceful.isActive());
    expect(b.tradeGold()).toBeGreaterThan(afterRemoved);
    expect(a.piracyGold()).toBe(0n);
    witness(game, "NAV-03/04", before, undefined);
  });

  it("ECON-08/NAV-01: actual warships respect member-specific war and the imperial overlay", async () => {
    const { game, a, b, c, d, enemy } = await fixture();
    game.performNationalCommand(a, {
      kind: "found-empire",
      empireId: "e3-empire",
    });
    game.performNationalCommand(a, {
      kind: "offer-empire",
      empireId: "e3-empire",
      candidateId: D,
    });
    game.performNationalCommand(d, {
      kind: "accept-empire",
      empireId: "e3-empire",
      candidateId: D,
    });
    war(game, A, D, B, "e3-proxy");
    expect(a.canTrade(b)).toBe(true);
    expect(d.canTrade(b)).toBe(false);
    const ship = b.buildUnit(UnitType.TradeShip, game.ref(8, 11), {
      targetUnit: enemy,
      lastSetSafeFromPirates: -100,
    });
    const neutral = c.buildUnit(UnitType.TradeShip, game.ref(8, 11), {
      targetUnit: enemy,
      lastSetSafeFromPirates: -100,
    });
    const emperorFleet = fleet(game, a, 8, 10);
    const emperorExecution = new WarshipExecution(emperorFleet);
    game.addExecution(emperorExecution);
    ticks(game, 4);
    expect(ship.owner()).toBe(b);
    expect(neutral.owner()).toBe(c);
    game.removeExecution(emperorExecution);
    emperorFleet.delete(false);

    const memberFleet = fleet(game, d, 8, 10);
    const memberExecution = new WarshipExecution(memberFleet);
    game.addExecution(memberExecution);
    const before = balances(game);
    until(game, () => ship.owner() === d);
    expect(neutral.owner()).toBe(c);
    game.removeExecution(memberExecution);
    memberFleet.delete(false);

    expect(
      game.performNationalWarCommandWithOutcome(a, {
        kind: "declare-imperial",
        warId: "e3-imperial",
        aggressor: { kind: "empire", id: "e3-empire" },
        target: { kind: "nation", id: B },
      }).accepted,
    ).toBe(true);
    expect(a.canTrade(b)).toBe(false);
    expect(d.canTrade(b)).toBe(false);
    const overlayShip = b.buildUnit(UnitType.TradeShip, game.ref(8, 11), {
      targetUnit: enemy,
      lastSetSafeFromPirates: -100,
    });
    const overlayFleet = fleet(game, a, 8, 10);
    game.addExecution(new WarshipExecution(overlayFleet));
    until(game, () => overlayShip.owner() === a);
    peace(game, A, B, "e3-imperial", "e3-imperial-peace");
    expect(a.canTrade(b)).toBe(true);
    expect(d.canTrade(b)).toBe(false);

    const afterPeace = b.buildUnit(UnitType.TradeShip, game.ref(8, 11), {
      targetUnit: enemy,
      lastSetSafeFromPirates: -100,
    });
    ticks(game, 8);
    expect(afterPeace.owner()).toBe(b);
    expect(neutral.owner()).toBe(c);
    witness(game, "ECON-08/NAV-01", before, ship);
  });

  it("NAV-01: captured real commercial vessel pays only its lawful captor", async () => {
    const { game, a, b, c, home, enemy } = await fixture();
    war(game);
    const patrol = fleet(game, a, 8, 13);
    game.addExecution(new WarshipExecution(patrol));
    const before = balances(game);
    const voyage = sail(game, b, enemy, home);
    const ship = b.units(UnitType.TradeShip)[0];
    expect(ship).toBeDefined();
    until(game, () => ship.owner() === a);
    until(game, () => !voyage.isActive());
    expect(a.piracyGold()).toBeGreaterThan(0n);
    expect(a.gold() - before[0].gold).toBe(a.piracyGold());
    expect(b.gold()).toBe(before[1].gold);
    expect(c.gold()).toBe(before[2].gold);
    expect(b.tradeGold()).toBe(0n);
    expect(c.tradeGold()).toBe(0n);
    witness(game, "NAV-01-piracy-payout", before, ship);
  });

  it("ECON-02/03: demand is voluntary, actual defiant voyage pays, issuer alone enforces", async () => {
    const { game, a, b, c, d, home, enemy, other, own } = await fixture();
    const before = balances(game);
    const command = NationalIssueSanctionIntentSchema.parse({
      type: "national_issue_sanction",
      scope: "national",
      targetId: B,
      recipientIds: [C, D],
      durationTicks: 20,
      requestId: "e3-sanction-issue",
    });
    game.addExecution(new NationalSanctionExecution(a, command));
    ticks(game, 2);
    const rows = NationalSanctionExecution.viewFor(game, a);
    expect(rows).toHaveLength(1);
    const id = rows[0].id;
    expect(c.canTrade(b)).toBe(true);
    expect(d.canTrade(b)).toBe(true);
    expect(balances(game)).toEqual(before);
    expect(NationalSanctionExecution.viewFor(game, b)).toEqual([]);

    game.addExecution(
      new NationalSanctionExecution(c, {
        type: "national_respond_sanction",
        sanctionId: id,
        decision: "comply",
        requestId: "e3-comply",
      }),
      new NationalSanctionExecution(d, {
        type: "national_respond_sanction",
        sanctionId: id,
        decision: "refuse",
        requestId: "e3-refuse",
      }),
    );
    ticks(game, 2);
    expect(c.canTrade(b)).toBe(false);
    expect(d.canTrade(b)).toBe(true);
    expect(a.canTrade(d)).toBe(true);
    expect(sail(game, c, home, enemy).isActive()).toBe(false);
    expect(balances(game)).toEqual(before);

    const defiant = sail(game, d, other, enemy);
    until(game, () => !defiant.isActive());
    expect(d.tradeGold()).toBeGreaterThan(0n);
    expect(b.tradeGold()).toBe(d.tradeGold());
    expect(c.tradeGold()).toBe(0n);
    until(
      game,
      () =>
        NationalSanctionExecution.viewFor(game, a)[0].phase ===
        "decision-required",
    );

    // Mid-demand snapshot/restore must preserve the pending issuer choice.
    const { restored, bytes, again } = await roundTrip(game, MAP);
    expect(again).toEqual(bytes);
    for (const g of [game, restored]) {
      g.addExecution(
        new NationalSanctionExecution(g.player(C), {
          type: "national_resolve_sanction",
          sanctionId: id,
          decision: "enforce",
          requestId: "e3-forged-resolution",
        }),
      );
      ticks(g, 2);
      expect(g.player(A).canTrade(g.player(D))).toBe(true);
      g.addExecution(
        new NationalSanctionExecution(g.player(A), {
          type: "national_resolve_sanction",
          sanctionId: id,
          decision: "enforce",
          requestId: "e3-enforce",
        }),
      );
      ticks(g, 2);
      expect(NationalSanctionExecution.viewFor(g, g.player(A))[0].phase).toBe(
        "enforced",
      );
      expect(g.player(A).canTrade(g.player(D))).toBe(false);
      expect(g.player(D).canTrade(g.player(B))).toBe(true);
      expect(g.nationalWarAuthority()?.atWar(A, D)).toBe(false);
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    const after = balances(game);
    expect(sail(game, a, own, other).isActive()).toBe(false);
    expect(balances(game)).toEqual(after);
    witness(game, "ECON-02/03", before, undefined);
  });

  it("ECON-04: subordinate cannot issue empire sanction; emperor may explicitly withdraw", async () => {
    const { game, a, b, c, d } = await fixture();
    game.performNationalCommand(a, {
      kind: "found-empire",
      empireId: "e3-sanction-empire",
    });
    game.performNationalCommand(a, {
      kind: "offer-empire",
      empireId: "e3-sanction-empire",
      candidateId: D,
    });
    game.performNationalCommand(d, {
      kind: "accept-empire",
      empireId: "e3-sanction-empire",
      candidateId: D,
    });
    const before = balances(game);
    const command = {
      type: "national_issue_sanction",
      scope: "imperial",
      targetId: B,
      recipientIds: [C],
      durationTicks: 5,
      requestId: "e3-imperial-sanction",
    } as const;
    game.addExecution(
      new NationalSanctionExecution(d, { ...command, recipientIds: [C] }),
    );
    ticks(game, 2);
    expect(NationalSanctionExecution.viewFor(game, a)).toEqual([]);
    expect(NationalSanctionExecution.viewFor(game, c)).toEqual([]);
    game.addExecution(
      new NationalSanctionExecution(a, { ...command, recipientIds: [C] }),
    );
    ticks(game, 2);
    const id = NationalSanctionExecution.viewFor(game, a)[0].id;
    until(
      game,
      () =>
        NationalSanctionExecution.viewFor(game, a)[0].phase ===
        "decision-required",
    );
    game.addExecution(
      new NationalSanctionExecution(a, {
        type: "national_resolve_sanction",
        sanctionId: id,
        decision: "back-down",
        requestId: "e3-back-down",
      }),
    );
    ticks(game, 2);
    expect(NationalSanctionExecution.viewFor(game, c)[0].phase).toBe(
      "backed-down",
    );
    expect(a.canTrade(c)).toBe(true);
    expect(d.canTrade(c)).toBe(true);
    expect(c.canTrade(b)).toBe(true);
    expect(balances(game)).toEqual(before);
    witness(game, "ECON-04", before, undefined);
  });

  it("ECON-03: a positive post-deadline merchant settlement reopens voluntary compliance", async () => {
    const { game, a, b, c, home, enemy } = await fixture();
    game.addExecution(
      new NationalSanctionExecution(a, {
        type: "national_issue_sanction",
        scope: "national",
        targetId: B,
        recipientIds: [C],
        durationTicks: 12,
        requestId: "e3-after-deadline",
      }),
    );
    ticks(game, 2);
    const id = NationalSanctionExecution.viewFor(game, a)[0].id;
    game.addExecution(
      new NationalSanctionExecution(c, {
        type: "national_respond_sanction",
        sanctionId: id,
        decision: "comply",
        requestId: "e3-after-deadline-comply",
      }),
    );
    until(
      game,
      () => NationalSanctionExecution.viewFor(game, a)[0].phase === "satisfied",
    );
    const before = balances(game);
    game.addExecution(new EmbargoExecution(c, B, "stop"));
    ticks(game, 2);
    expect(c.canTrade(b)).toBe(true);
    expect(NationalSanctionExecution.viewFor(game, a)[0].phase).toBe(
      "satisfied",
    );
    const voyage = sail(game, c, home, enemy);
    until(game, () => !voyage.isActive());
    expect(c.tradeGold()).toBeGreaterThan(0n);
    expect(b.tradeGold()).toBe(c.tradeGold());
    expect(NationalSanctionExecution.viewFor(game, a)[0].phase).toBe(
      "decision-required",
    );
    game.addExecution(
      new NationalSanctionExecution(a, {
        type: "national_resolve_sanction",
        sanctionId: id,
        decision: "enforce",
        requestId: "e3-after-deadline-enforce",
      }),
    );
    ticks(game, 2);
    expect(a.canTrade(c)).toBe(false);
    expect(c.canTrade(b)).toBe(true);
    expect(game.nationalWarAuthority()?.atWar(A, C)).toBe(false);
    witness(game, "ECON-03-post-deadline", before, undefined);
  });

  it("NAV-02: a returning ship without any owned home retires without a payout", async () => {
    const { game, a, c, home, enemy } = await fixture();
    war(game);
    fleet(game, a, 8, 12);
    const voyage = sail(game, c, home, enemy);
    const ship = c.units(UnitType.TradeShip)[0];
    until(game, () => ship.targetUnit() === home);
    const before = balances(game);
    home.delete(false);
    until(game, () => !voyage.isActive());
    expect(ship.isActive()).toBe(false);
    expect(ship.owner()).toBe(c);
    expect(balances(game)).toEqual(before);
    witness(game, "NAV-02-no-home", before, ship);
  });

  it("AI-07: actual NationExecution voluntarily protects its observed merchant relationship", async () => {
    const { game, a, b, c, home, own } = await fixture();
    // First-party evidence: the recipient currently owns a real A-bound
    // merchant. Its decision must not read A/B's reserves or controller type.
    const merchant = sail(game, c, home, own);
    expect(merchant.isActive()).toBe(true);
    expect(c.units(UnitType.TradeShip).length).toBeGreaterThan(0);
    game.convertHumanToNation(c, "e3-economic-ai");
    game.addExecution(
      new NationalSanctionExecution(a, {
        type: "national_issue_sanction",
        scope: "national",
        targetId: B,
        recipientIds: [C],
        durationTicks: 40,
        requestId: "e3-ai-demand",
      }),
    );
    until(game, () => c.hasManualEmbargoAgainst(b), 30);
    expect(c.canTrade(a)).toBe(true);
    expect(NationalSanctionExecution.viewFor(game, c)[0].response).toBe(
      "comply",
    );
  });

  it("tactical shells cannot damage a now-peaceful target; legacy fire is unchanged", async () => {
    for (const nationalMode of [true, false]) {
      const { game, a, b } = await fixture(nationalMode);
      if (nationalMode) war(game);
      const shooter = fleet(game, a, 8, 2);
      const target = fleet(game, b, 8, 13);
      const shell = new ShellExecution(shooter.tile(), a, shooter, target);
      game.addExecution(shell);
      ticks(game, 2);
      expect(a.units(UnitType.Shell)).toHaveLength(1);
      const health = target.health();
      if (nationalMode) peace(game);
      until(game, () => !shell.isActive());
      if (nationalMode) expect(target.health()).toBe(health);
      else expect(target.health()).toBeLessThan(health);
    }
  });
});
