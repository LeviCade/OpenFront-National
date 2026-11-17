import {
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import type { Game, Player } from "@openfront/engine/game/Game";
import {
  actorNationalResults,
  emptyNationalResultDeliveryState,
  initialNationalResultDeliveryState,
  type OutboundFounderResult,
} from "@openfront/engine/national/observation/NationalPoliticalPacket";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const north = new PlayerInfo(
  "North",
  PlayerType.Human,
  "r6-north-client",
  "r6-north-id",
);
const south = new PlayerInfo(
  "South",
  PlayerType.Human,
  "r6-south-client",
  "r6-south-id",
);

type R6Packet = GameUpdateViewData & {
  nationalPolitics?: NonNullable<ReturnType<Game["nationalPublicPoliticalView"]>>;
  nationalCommandResults?: readonly OutboundFounderResult[];
};

interface Receipt {
  readonly sequence: number;
  readonly requestId: string;
  readonly actorId: string;
  readonly empireId: string;
  readonly accepted: boolean;
  readonly tick: number;
  readonly reason: string;
}

async function live() {
  const game = await setup("plains", { nationalMode: true }, [north, south]);
  game.addExecution(
    new SpawnExecution("r6-receipts", north, game.ref(18, 18)),
    new SpawnExecution("r6-receipts", south, game.ref(81, 81)),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  return game;
}

function receipt(
  game: Game,
  requestId: string,
  sequence: number,
  accepted: boolean,
  actorId: string = north.id,
): Receipt {
  return {
    requestId,
    sequence,
    actorId,
    empireId: "shared_empire",
    accepted,
    tick: game.ticks(),
    reason: accepted ? "accepted" : "political-rule",
  };
}

function mockJournal(game: Game, records: Receipt[]) {
  // Exercises E3's consumer against delayed, reordered and malicious E1
  // outputs. Real E1 always supplies a trusted Game-owned journal.
  Object.defineProperty(game, "nationalCommandResults", {
    configurable: true,
    value: (_actor: Player) => records,
  });
}

function runner(
  game: Game,
  clientId: string | undefined,
): { readonly next: () => R6Packet } {
  const packets: R6Packet[] = [];
  const gr = new GameRunner(
    game,
    new Executor(game, "r6-receipts", clientId),
    (message) => {
      if ("updates" in message) packets.push(message as R6Packet);
    },
    clientId,
  );
  return {
    next: () => {
      gr.addTurn({ turnNumber: game.ticks(), intents: [] });
      expect(gr.executeNextTick()).toBe(true);
      return packets[packets.length - 1];
    },
  };
}

describe("Round Six authenticated request-correlated NATIONAL receipts", () => {
  it("emits distinct same-tick requests for identical empire IDs with their exact, ordered E1 requestId and sequence", async () => {
    const game = await live();
    const journal: Receipt[] = [];
    mockJournal(game, journal);
    const view = runner(game, north.clientID!);
    expect(view.next()).not.toHaveProperty("nationalCommandResults");

    // A deliberately reordered E1 journal. No result may be attributed to a
    // different click just because it named the same empire.
    journal.push(
      receipt(game, "click-second", 12, false),
      receipt(game, "click-first", 11, true),
      receipt(game, "foreign-private", 13, true, south.id),
    );
    const packet = view.next();
    expect(packet.nationalCommandResults).toEqual([
      expect.objectContaining({
        requestId: "click-first",
        sequence: 11,
        recipientId: north.id,
        actorId: north.id,
        empireId: "shared_empire",
        accepted: true,
      }),
      expect.objectContaining({
        requestId: "click-second",
        sequence: 12,
        recipientId: north.id,
        actorId: north.id,
        empireId: "shared_empire",
        accepted: false,
      }),
    ]);
    expect(packet.nationalPolitics?.empires).toEqual([]);
    expect(view.next()).not.toHaveProperty("nationalCommandResults");
    const foreign = runner(game, south.clientID!).next();
    expect(foreign).not.toHaveProperty("nationalCommandResults");
    const spectator = runner(game, undefined).next();
    expect(spectator).not.toHaveProperty("nationalCommandResults");
  });

  it("does not lose an older delayed receipt when a higher E1 sequence was delivered earlier", async () => {
    const game = await live();
    const journal: Receipt[] = [];
    mockJournal(game, journal);
    const view = runner(game, north.clientID!);
    journal.push(receipt(game, "newer", 35, false));
    expect(view.next().nationalCommandResults).toEqual([
      expect.objectContaining({ requestId: "newer", sequence: 35 }),
    ]);
    // E1's read is allowed to return 35 followed by delayed 34. A max-only
    // cursor would silently drop the valid older outstanding click.
    journal.unshift(receipt(game, "delayed", 34, true));
    expect(view.next().nationalCommandResults).toEqual([
      expect.objectContaining({ requestId: "delayed", sequence: 34 }),
    ]);
    expect(view.next()).not.toHaveProperty("nationalCommandResults");
  });

  it("treats exact duplicate receipts as one and fails closed on duplicate IDs assigned another sequence", async () => {
    const game = await live();
    const journal: Receipt[] = [];
    mockJournal(game, journal);
    const actor = game.player(north.id);
    const state = emptyNationalResultDeliveryState();
    const first = receipt(game, "idempotent-click", 7, true);
    journal.push(first, { ...first });
    expect(actorNationalResults(game, actor, state)).toHaveLength(1);
    expect(actorNationalResults(game, actor, state)).toEqual([]);
    journal.push(receipt(game, "idempotent-click", 8, false));
    expect(() => actorNationalResults(game, actor, state)).toThrow(
      /conflicting authoritative founder receipts/,
    );
    expect(state.seenRequests.get("idempotent-click")).toBe(7);
    journal.pop();
    journal.push(receipt(game, "new-request-reused-sequence", 7, false));
    expect(() => actorNationalResults(game, actor, state)).toThrow(
      /conflicting authoritative founder receipts/,
    );
  });

  it("rejects malformed, future, oversized and raw-error receipts before advancing delivery state", async () => {
    const game = await live();
    const journal: Receipt[] = [];
    mockJournal(game, journal);
    const actor = game.player(north.id);
    const state = emptyNationalResultDeliveryState();
    const valid = receipt(game, "real", 0, true);
    for (const broken of [
      { ...valid, requestId: "" },
      { ...valid, requestId: "x".repeat(257) },
      { ...valid, sequence: -1 },
      { ...valid, sequence: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, tick: game.ticks() + 1 },
      { ...valid, accepted: true, reason: "political-rule" },
      { ...valid, reason: "secret attacker troops 87654321" },
    ]) {
      journal.splice(0, journal.length, broken);
      expect(() => actorNationalResults(game, actor, state)).toThrow(
        /invalid authoritative founder receipt/,
      );
      expect(state.maxSequence).toBe(-1);
    }
    journal.splice(0, journal.length, valid);
    expect(actorNationalResults(game, actor, state)).toEqual([
      expect.objectContaining({ requestId: "real", sequence: 0 }),
    ]);
  });

  it("fresh reconnect ignores previously journaled successes while delivering a genuinely later request", async () => {
    const game = await live();
    const journal = [receipt(game, "old-accepted", 20, true)];
    mockJournal(game, journal);
    const reconnected = runner(game, north.clientID!);
    expect(reconnected.next()).not.toHaveProperty("nationalCommandResults");
    journal.push(receipt(game, "new-rejected", 21, false));
    expect(reconnected.next().nationalCommandResults).toEqual([
      expect.objectContaining({
        requestId: "new-rejected",
        sequence: 21,
        accepted: false,
      }),
    ]);
    expect(reconnected.next()).not.toHaveProperty("nationalCommandResults");
    expect(initialNationalResultDeliveryState(game, game.player(north.id))
      .seenRequests.has("new-rejected")).toBe(true);
  });

  it("canonical E1 snapshot restore does not replay a prior acceptance as a new UI command", async () => {
    const game = await live();
    const gameWithJournal = game as Game & {
      performNationalFoundEmpireWithOutcome?: (
        actor: Player,
        empireId: string,
        requestId: string,
      ) => Receipt;
    };
    if (typeof gameWithJournal.performNationalFoundEmpireWithOutcome !== "function") {
      // This contract activates when E1 #31 lands on combined staging.
      // No mock snapshot journal is substituted for authoritative Game state.
      expect(game.nationalPublicPoliticalView()?.empires).toEqual([]);
      return;
    }
    const received = gameWithJournal.performNationalFoundEmpireWithOutcome(
      game.player(north.id),
      "persistent_r6_empire",
      "snapshot-click",
    );
    expect(received).toMatchObject({
      requestId: "snapshot-click",
      accepted: true,
    });
    const before = runner(game, north.clientID!).next();
    expect(before.nationalPolitics?.empires[0].id).toBe("persistent_r6_empire");
    expect(before).not.toHaveProperty("nationalCommandResults");
    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    const after = runner(restored, north.clientID!).next();
    expect(after.nationalPolitics?.empires).toEqual(before.nationalPolitics?.empires);
    expect(after).not.toHaveProperty("nationalCommandResults");
  });

  it("never serializes extra engine-journal fields, secrets, another actor's result or human sight memory", async () => {
    const game = await live();
    const journal: Receipt[] = [];
    mockJournal(game, journal);
    const view = runner(game, north.clientID!);
    const first = receipt(game, "privacy-req", 40, false);
    journal.push({
      ...first,
      secretTroops: 87654321,
      secretTreasury: "123456789-private",
      sightMemory: [{ id: "private-transport" }],
    } as Receipt);
    const packet = view.next();
    const json = JSON.stringify(packet, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(packet.nationalCommandResults?.[0]).toMatchObject({
      requestId: "privacy-req",
      sequence: 40,
      recipientId: north.id,
    });
    expect(json).not.toContain("87654321");
    expect(json).not.toContain("123456789-private");
    expect(json).not.toContain("private-transport");
    expect(json).not.toContain("sightMemory");
    expect(json).not.toContain("secretTreasury");
  });
});
