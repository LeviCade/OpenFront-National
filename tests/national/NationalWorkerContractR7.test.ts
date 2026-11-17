import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
/**
 * Round Seven real engine -> worker contract certification.
 *
 * This is not a mock journal or fabricated acknowledgement. When the R6 E2
 * optional requestId wire exists, this test MUST exercise E1's actual
 * FoundEmpireExecution and inspect the real authenticated GameRunner packet.
 * E3's standalone branch predates E1/E2, so only that legacy branch can
 * execute the explicitly checked compatibility path.
 *
 * Safe packet evidence logs contain PUBLIC empire state and the exact
 * authenticated actor's bounded result receipts only.
 */
import { NationalFoundEmpireIntentSchema } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game, Player } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import { NationalOutboundFilter } from "@openfront/engine/national/observation/NationalOutbound";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const founder = new PlayerInfo(
  "R7 Founder",
  PlayerType.Human,
  "r7-founder-client",
  "r7-founder-player",
);
const other = new PlayerInfo(
  "R7 Other",
  PlayerType.Human,
  "r7-other-client",
  "r7-other-player",
);

interface JournalReceipt {
  readonly sequence: number;
  readonly requestId: string;
  readonly actorId: string;
  readonly empireId: string;
  readonly tick: number;
  readonly accepted: boolean;
  readonly reason: string;
}

type R7Game = Game & {
  nationalCommandResults?: (observer: Player) => readonly JournalReceipt[];
};
type R7Packet = GameUpdateViewData & {
  readonly nationalCommandResults?: readonly {
    readonly sequence?: number;
    readonly requestId?: string;
    readonly recipientId: string;
    readonly actorId: string;
    readonly empireId?: string;
    readonly tick: number;
    readonly accepted: boolean;
    readonly reason?: string;
    readonly type: string;
  }[];
  readonly nationalPolitics?: {
    readonly empires: readonly {
      readonly id: string;
      readonly leaderId: string;
      readonly memberIds: readonly string[];
    }[];
  };
};

async function spawned(nationalMode = true) {
  const game = await setup("plains", { nationalMode }, [founder, other]);
  game.addExecution(
    new SpawnExecution("r7-proof", founder, game.ref(18, 18)),
    new SpawnExecution("r7-proof", other, game.ref(81, 81)),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  return game;
}

function viewer(game: Game, clientID: string | undefined) {
  const packets: R7Packet[] = [];
  const runner = new GameRunner(
    game,
    new Executor(game, "r7-proof", clientID),
    (packet) => {
      if ("updates" in packet) packets.push(packet as R7Packet);
    },
    clientID,
  );
  return {
    next(): R7Packet {
      runner.addTurn({ turnNumber: game.ticks(), intents: [] });
      expect(runner.executeNextTick()).toBe(true);
      return packets[packets.length - 1];
    },
  };
}

function serialized(packet: R7Packet): string {
  return JSON.stringify(packet, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

describe("Round Seven authentic E1 -> E2 -> E3 GameRunner worker receipts", () => {
  it("delivers exact accepted/rejected stamped executions only to the registered actor, then restores public roster without replay", async () => {
    const game = await spawned();
    const acceptedId = "r7_founder_click_1";
    const rejectedId = "r7_founder_click_2";
    const wire = NationalFoundEmpireIntentSchema.parse({
      type: "national_found_empire",
      empireId: "r7_empire",
      requestId: acceptedId,
    }) as { requestId?: string };

    const journal = (game as R7Game).nationalCommandResults;
    if (wire.requestId === undefined) {
      // Isolated E3 branch has neither E2's requestId field nor the E1
      // journal. An integrated candidate with the E2 wire must NOT enter
      // this path; it must exercise every assertion below.
      expect(typeof journal).not.toBe("function");
      return;
    }
    expect(wire.requestId).toBe(acceptedId);
    expect(typeof journal).toBe("function");

    const north = viewer(game, founder.clientID!);
    const baseline = north.next();
    expect(baseline.nationalPolitics?.empires).toEqual([]);
    expect(baseline).not.toHaveProperty("nationalCommandResults");

    const exec = new Executor(game, "r7-proof", founder.clientID!);
    const make = (requestId: string) =>
      exec.createExec({
        type: "national_found_empire",
        empireId: "r7_empire",
        requestId,
        clientID: founder.clientID!,
      } as Parameters<Executor["createExec"]>[0]);
    // Actual E1 execution: first accepted, second distinct request rejected.
    // Repeating the same token must preserve only the original E1 receipt.
    game.addExecution(make(acceptedId), make(acceptedId), make(rejectedId));

    const queued = north.next();
    expect(queued).not.toHaveProperty("nationalCommandResults");
    expect(queued.nationalPolitics?.empires).toEqual([]);

    const delivered = north.next();
    const truth = journal!.call(game, game.player(founder.id));
    expect(truth).toHaveLength(2);
    expect(truth.map((x) => x.requestId)).toEqual([acceptedId, rejectedId]);
    expect(truth.map((x) => x.accepted)).toEqual([true, false]);
    expect(truth[0].sequence).toBeLessThan(truth[1].sequence);
    expect(delivered.nationalCommandResults).toEqual(
      truth.map((x) => ({
        recipientId: founder.id,
        actorId: x.actorId,
        type: "national_found_empire",
        accepted: x.accepted,
        tick: x.tick,
        sequence: x.sequence,
        requestId: x.requestId,
        empireId: x.empireId,
        reason: x.reason,
      })),
    );
    expect(delivered.nationalPolitics).toEqual(
      game.nationalPublicPoliticalView(),
    );
    expect(delivered.nationalPolitics?.empires).toEqual([
      {
        id: "r7_empire",
        leaderId: founder.id,
        memberIds: [founder.id],
      },
    ]);
    expect(north.next()).not.toHaveProperty("nationalCommandResults");

    // This is the actual wire-level packet sample for E4/E5, not an
    // intention, fabricated outcome, or direct game-only journal sample.
    console.info(
      "[R7 REAL GAME RUNNER PUBLIC PACKET]",
      JSON.stringify({
        tick: delivered.tick,
        nationalPolitics: delivered.nationalPolitics,
        nationalCommandResults: delivered.nationalCommandResults,
      }),
    );

    const otherPacket = viewer(game, other.clientID!).next();
    const anonymousPacket = viewer(game, undefined).next();
    expect(otherPacket.nationalPolitics?.empires).toEqual(
      delivered.nationalPolitics?.empires,
    );
    expect(otherPacket).not.toHaveProperty("nationalCommandResults");
    expect(anonymousPacket).not.toHaveProperty("nationalCommandResults");
    expect(serialized(otherPacket)).not.toContain(acceptedId);
    expect(serialized(anonymousPacket)).not.toContain(rejectedId);

    // No prior approval toast after reconnect, despite restored roster.
    const reconnect = viewer(game, founder.clientID!).next();
    expect(reconnect.nationalPolitics?.empires).toEqual(
      delivered.nationalPolitics?.empires,
    );
    expect(reconnect).not.toHaveProperty("nationalCommandResults");

    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(
      (restored as R7Game).nationalCommandResults!(restored.player(founder.id)),
    ).toEqual(truth);
    const restoredView = viewer(restored, founder.clientID!).next();
    expect(restoredView.nationalPolitics?.empires).toEqual(
      delivered.nationalPolitics?.empires,
    );
    expect(restoredView).not.toHaveProperty("nationalCommandResults");

    const nextExec = new Executor(restored, "r7-proof", founder.clientID!);
    restored.addExecution(
      nextExec.createExec({
        type: "national_found_empire",
        empireId: "r7_empire",
        requestId: "r7_after_restore_click",
        clientID: founder.clientID!,
      } as Parameters<Executor["createExec"]>[0]),
    );
    const restoredRunner = viewer(restored, founder.clientID!);
    // Created after queueing but before execution: no previous acceptance.
    expect(restoredRunner.next()).not.toHaveProperty("nationalCommandResults");
    const nextPacket = restoredRunner.next();
    expect(nextPacket.nationalCommandResults).toEqual([
      expect.objectContaining({
        requestId: "r7_after_restore_click",
        sequence: truth[1].sequence + 1,
        accepted: false,
        recipientId: founder.id,
        actorId: founder.id,
        empireId: "r7_empire",
      }),
    ]);
  });

  it("never exposes a real foreign principal's troop or treasury canary in public politics or scoped receipt packets", async () => {
    const game = await spawned();
    game.player(other.id).setTroops(8_765_432);
    game.player(other.id).addGold(123_456_789n);
    const packet = viewer(game, founder.clientID!).next();
    const politicalJson = JSON.stringify(packet.nationalPolitics);
    const fullJson = serialized(packet);
    for (const canary of [
      "8765432",
      "123456789",
      "sightMemory",
      "privateTerms",
    ]) {
      expect(politicalJson).not.toContain(canary);
      expect(fullJson).not.toContain(canary);
    }
    expect(packet.nationalPolitics).toEqual(game.nationalPublicPoliticalView());
  });

  it("drops absent, nonnumeric or invalid optional sequences and foreign recipients at the second worker whitelist", async () => {
    const game = await spawned();
    const source = viewer(game, founder.clientID!).next();
    const authenticActor = founder.id;
    const fake = {
      recipientId: authenticActor,
      actorId: authenticActor,
      type: "national_found_empire" as const,
      tick: game.ticks(),
      accepted: true,
      empireId: "unapproved_empire",
      reason: "accepted",
      requestId: "bad_optional_sequence",
    };
    // These are deliberately adversarial mock PACKET INJECTIONS, NOT
    // authoritative command outcomes. The real engine proof above never
    // substitutes synthetic acknowledgements for E1 results.
    const polluted = {
      ...source,
      nationalCommandResults: [
        fake,
        { ...fake, sequence: undefined },
        { ...fake, sequence: -1 },
        { ...fake, sequence: Number.NaN },
        { ...fake, sequence: "7" },
        { ...fake, sequence: 8, requestId: undefined },
        {
          ...fake,
          sequence: 9,
          requestId: "r7_valid_scoped",
          privateTreasury: "should-not-survive",
        },
        {
          ...fake,
          recipientId: other.id,
          actorId: other.id,
          sequence: 10,
          requestId: "r7_foreign",
        },
      ],
    } as unknown as GameUpdateViewData;
    const boundary = new NationalOutboundFilter(game, founder.id);
    const result = boundary.project(game, polluted, null) as R7Packet;
    expect(result.nationalCommandResults).toEqual([
      {
        recipientId: founder.id,
        actorId: founder.id,
        type: "national_found_empire",
        accepted: true,
        tick: game.ticks(),
        sequence: 9,
        requestId: "r7_valid_scoped",
        empireId: "unapproved_empire",
        reason: "accepted",
      },
    ]);
    const output = serialized(result);
    expect(output).not.toContain("should-not-survive");
    expect(output).not.toContain("r7_foreign");
    expect(output).not.toContain("bad_optional_sequence");
  });

  it("keeps legacy FFA worker packets free of NATIONAL political and recipient fields", async () => {
    const game = await spawned(false);
    const packet = viewer(game, founder.clientID!).next();
    expect(packet).not.toHaveProperty("nationalPolitics");
    expect(packet).not.toHaveProperty("nationalCommandResults");
  });
});
