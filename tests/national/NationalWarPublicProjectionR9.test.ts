import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game, Player } from "@openfront/engine/game/Game";
import { GameRunner } from "@openfront/engine/GameRunner";
import {
  NationalOutboundFilter,
  projectNationalPublicConflict,
  type NationalPublicConflictView,
} from "@openfront/engine/national/observation/NationalOutbound";
import {
  actorNationalResults,
  emptyNationalResultDeliveryState,
} from "@openfront/engine/national/observation/NationalPoliticalPacket";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const north = new PlayerInfo(
  "North",
  PlayerType.Human,
  "r9-north-client",
  "r9-north-id",
);
const south = new PlayerInfo(
  "South",
  PlayerType.Human,
  "r9-south-client",
  "r9-south-id",
);
const third = new PlayerInfo(
  "Third",
  PlayerType.Human,
  "r9-third-client",
  "r9-third-id",
);
const warId = "real_r9_war";
const motionId = "real_r9_motion";

async function activeWar() {
  const game = await setup("plains", { nationalMode: true }, [
    north,
    south,
    third,
  ]);
  game.addExecution(
    new SpawnExecution("r9-war", north, game.ref(15, 15)),
    new SpawnExecution("r9-war", south, game.ref(85, 85)),
    new SpawnExecution("r9-war", third, game.ref(50, 50)),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  game.performNationalWarCommand(game.player(north.id), {
    kind: "declare-national",
    warId,
    aggressorId: north.id,
    targetId: south.id,
  });
  expect(game.nationalWarAuthority()?.atWar(north.id, south.id)).toBe(true);
  return game;
}

function publicWar(game: Game, observer: string | null) {
  return projectNationalPublicConflict(game, observer, game.ticks());
}

type R9Packet = GameUpdateViewData & {
  nationalConflicts?: NationalPublicConflictView;
};

function liveRunner(game: Game, clientID?: string) {
  const packets: R9Packet[] = [];
  const view = new GameRunner(
    game,
    new Executor(game, "r9-war", clientID),
    (update) => {
      if ("updates" in update) packets.push(update as R9Packet);
    },
    clientID,
  );
  return () => {
    view.addTurn({ turnNumber: game.ticks(), intents: [] });
    expect(view.executeNextTick()).toBe(true);
    return packets[packets.length - 1];
  };
}

describe("Round Nine actual Game-owned public WAR state and private receipts", () => {
  it("only publishes real active WAR IDs and participant-visible pending motion IDs, including after replay", async () => {
    const game = await activeWar();
    const spectator = publicWar(game, null)!;
    expect(spectator.layers).toEqual([
      {
        id: warId,
        scope: "national",
        first: { kind: "nation", id: north.id },
        second: { kind: "nation", id: south.id },
        startedTick: expect.any(Number),
        declaredBy: north.id,
        endedTick: null,
      },
    ]);
    expect(spectator.motions).toEqual([]);

    // A real canonical peace command; nothing is inferred from a queued click.
    game.performNationalWarCommand(game.player(north.id), {
      kind: "propose-peace",
      motionId,
      warId,
    });
    expect(publicWar(game, north.id)?.motions).toEqual([
      {
        id: motionId,
        layerId: warId,
        proposedBy: north.id,
        proposingSide: 0,
        proposedTick: expect.any(Number),
        acceptedTick: null,
        acceptedBy: null,
      },
    ]);
    expect(publicWar(game, south.id)?.motions).toHaveLength(1);
    expect(publicWar(game, third.id)?.motions).toEqual([]);
    expect(publicWar(game, null)?.motions).toEqual([]);

    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(publicWar(restored, north.id)).toEqual(publicWar(game, north.id));
    expect(publicWar(restored, third.id)?.motions).toEqual([]);

    game.performNationalWarCommand(game.player(south.id), {
      kind: "accept-peace",
      motionId,
    });
    expect(game.nationalWarAuthority()?.atWar(north.id, south.id)).toBe(false);
    expect(publicWar(game, north.id)?.layers).toEqual([
      expect.objectContaining({ id: warId, endedTick: game.ticks() }),
    ]);
    expect(publicWar(game, south.id)?.motions).toEqual([
      expect.objectContaining({
        id: motionId,
        acceptedBy: south.id,
        acceptedTick: game.ticks(),
      }),
    ]);
  });

  it("revokes pending-motion intelligence on crown transfer without hiding public wars", async () => {
    const game = await activeWar();
    game.performNationalWarCommand(game.player(north.id), {
      kind: "propose-peace",
      motionId,
      warId,
    });
    game.performNationalCommand(game.player(north.id), {
      kind: "found-empire",
      empireId: "r9_sovereign",
    });
    game.performNationalCommand(game.player(north.id), {
      kind: "offer-empire",
      empireId: "r9_sovereign",
      candidateId: third.id,
    });
    game.performNationalCommand(game.player(third.id), {
      kind: "accept-empire",
      empireId: "r9_sovereign",
      candidateId: third.id,
    });
    expect(publicWar(game, north.id)?.motions).toHaveLength(1);
    expect(publicWar(game, third.id)?.motions).toEqual([]);
    game.performNationalCommand(game.player(north.id), {
      kind: "transfer-crown",
      empireId: "r9_sovereign",
      successorId: third.id,
    });
    expect(publicWar(game, north.id)?.motions).toEqual([]);
    expect(publicWar(game, third.id)?.motions[0]?.id).toBe(motionId);
    expect(publicWar(game, north.id)?.layers[0]?.id).toBe(warId);
  });

  it("GameRunner emits real public conflicts but never emits command success from war roster alone", async () => {
    const game = await activeWar();
    const northPacket = liveRunner(game, north.clientID!)();
    const foreignPacket = liveRunner(game, third.clientID!)();
    const spectatorPacket = liveRunner(game)();
    for (const packet of [northPacket, foreignPacket, spectatorPacket]) {
      expect(packet.nationalConflicts?.layers.map((w) => w.id)).toEqual([warId]);
      expect(packet).not.toHaveProperty("nationalCommandResults");
    }
    game.performNationalWarCommand(game.player(north.id), {
      kind: "propose-peace",
      motionId,
      warId,
    });
    const owner = liveRunner(game, north.clientID!)();
    const nonparticipant = liveRunner(game, third.clientID!)();
    expect(owner.nationalConflicts?.motions[0]?.id).toBe(motionId);
    expect(nonparticipant.nationalConflicts?.motions).toEqual([]);
  });

  it("deep-whitelists WAR data and never forwards levy, attack plans or hidden motion metadata", async () => {
    const game = await activeWar();
    const original = game.nationalWarState()!;
    Object.defineProperty(game, "nationalWarState", {
      configurable: true,
      value: () => ({
        ...original,
        secretPlans: "unannounced-attack-753159",
        levy: { secretTroops: 87654321, donors: ["covert-donor"] },
        wars: {
          ...original.wars,
          layers: original.wars.layers.map((layer) => ({
            ...layer,
            secretRoute: "transport-destination-123",
          })),
        },
      }),
    });
    const projection = publicWar(game, null)!;
    const encoded = JSON.stringify(projection);
    for (const secret of [
      "unannounced-attack-753159",
      "87654321",
      "covert-donor",
      "transport-destination-123",
      "secretRoute",
    ]) {
      expect(encoded).not.toContain(secret);
    }
    expect(projection.layers.map((w) => w.id)).toEqual([warId]);
  });

  it("forged, foreign, reordered and duplicate WAR journal entries never become unrelated click results", async () => {
    const game = await activeWar();
    const northView = liveRunner(game, north.clientID!);
    const southView = liveRunner(game, south.clientID!);
    const spectatorView = liveRunner(game);
    type WarRecord = {
      sequence: number;
      requestId: string;
      actorId: string;
      empireId: string;
      commandKind: "national_declare_war";
      commandTargetId: string;
      recipientId: string;
      warId: string;
      tick: number;
      accepted: boolean;
      reason: string;
      secretTroops?: number;
    };
    const journal: WarRecord[] = [];
    // These test the outbound consumer against a hostile/delayed port.
    // The prior tests above use actual Game-owned WAR transitions.
    Object.defineProperty(game, "nationalWarCommandResults", {
      configurable: true,
      value: (_actor: Player) => journal,
    });
    const record = (sequence: number, requestId: string, actorId = north.id): WarRecord => ({
      sequence,
      requestId,
      actorId,
      empireId: warId,
      commandKind: "national_declare_war",
      commandTargetId: warId,
      recipientId: actorId,
      warId,
      tick: game.ticks(),
      accepted: true,
      reason: "accepted",
      secretTroops: 8_765_432,
    });
    const first = record(31, "nc_0123456789abcdef0123456789abcdef");
    const second = record(30, "nc_abcdef0123456789abcdef0123456789");
    journal.push(first, second, record(32, "nc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", south.id));
    const delivered = northView();
    expect(delivered.nationalCommandResults).toEqual([
      expect.objectContaining({ sequence: 30, requestId: second.requestId, warId }),
      expect.objectContaining({ sequence: 31, requestId: first.requestId, warId }),
    ]);
    expect(JSON.stringify(delivered)).not.toContain("8765432");
    expect(northView()).not.toHaveProperty("nationalCommandResults");
    expect(southView().nationalCommandResults).toEqual([
      expect.objectContaining({ recipientId: south.id, sequence: 32 }),
    ]);
    expect(spectatorView()).not.toHaveProperty("nationalCommandResults");

    const state = emptyNationalResultDeliveryState();
    journal.splice(0, journal.length, first, { ...first });
    expect(actorNationalResults(game, game.player(north.id), state)).toHaveLength(1);
    journal.push({ ...first, sequence: 33 });
    expect(() => actorNationalResults(game, game.player(north.id), state)).toThrow(
      /conflicting authoritative founder receipts/,
    );
    journal.splice(0, journal.length, { ...first, tick: game.ticks() + 1 });
    expect(() =>
      actorNationalResults(game, game.player(north.id), emptyNationalResultDeliveryState()),
    ).toThrow(/invalid authoritative founder receipt/);
    journal.splice(0, journal.length, { ...first, warId: "" });
    expect(() =>
      actorNationalResults(game, game.player(north.id), emptyNationalResultDeliveryState()),
    ).toThrow(/invalid authoritative founder receipt/);
  });

  it("can read an actual E1-style WAR result without a founder empire ID, including rejection", async () => {
    const game = await activeWar();
    const journal = [
      {
        sequence: 21,
        actorId: north.id,
        commandKind: "national_declare_war" as const,
        recipientId: north.id,
        commandTargetId: south.id,
        requestId: "nc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        accepted: true,
        tick: game.ticks(),
        reason: "accepted",
        warId,
      },
      {
        sequence: 22,
        actorId: north.id,
        commandKind: "national_propose_peace" as const,
        recipientId: north.id,
        commandTargetId: warId,
        requestId: "nc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        accepted: false,
        tick: game.ticks(),
        reason: "war-rule",
      },
    ];
    Object.defineProperty(game, "nationalWarCommandResults", {
      configurable: true,
      value: () => journal,
    });
    const results = actorNationalResults(
      game,
      game.player(north.id),
      emptyNationalResultDeliveryState(),
    );
    expect(results).toEqual([
      expect.objectContaining({
        type: "national_declare_war",
        accepted: true,
        warId,
        sequence: 21,
      }),
      expect.objectContaining({
        type: "national_propose_peace",
        accepted: false,
        sequence: 22,
      }),
    ]);
    expect(results[1]).not.toHaveProperty("motionId");
  });

  it("joins the real E1 WAR journal to GameRunner, never fabricating results on branches without that port", async () => {
    const game = await activeWar();
    const source = game as Game & {
      nationalWarCommandResults?: (
        actor: Player,
      ) => readonly { requestId: string; accepted: boolean }[];
    };
    const northView = liveRunner(game, north.clientID!);
    const southView = liveRunner(game, south.clientID!);
    const spectatorView = liveRunner(game);

    if (typeof source.nationalWarCommandResults !== "function") {
      // Standalone E3 has no E1 WAR journal; public WAR observation is NOT
      // evidence that the original command was accepted.
      expect(northView().nationalConflicts?.layers[0]?.id).toBe(warId);
      expect(southView()).not.toHaveProperty("nationalCommandResults");
      expect(spectatorView()).not.toHaveProperty("nationalCommandResults");
      return;
    }

    const command = game.performNationalWarCommand.bind(game) as unknown as (
      actor: Player,
      request:
        | { kind: "propose-peace"; warId: string; motionId: string }
        | { kind: "accept-peace"; motionId: string },
      requestId: string,
    ) => { accepted: boolean; requestId: string };
    const proposalId = "nc_1234567890abcdef1234567890abcdef";
    const acceptanceId = "nc_abcdef1234567890abcdef1234567890";
    const proposal = command(
      game.player(north.id),
      { kind: "propose-peace", warId, motionId },
      proposalId,
    );
    expect(proposal).toMatchObject({ accepted: true, requestId: proposalId });
    const owner = northView();
    expect(owner.nationalCommandResults).toEqual([
      expect.objectContaining({
        type: "national_propose_peace",
        recipientId: north.id,
        actorId: north.id,
        accepted: true,
        requestId: proposalId,
        warId,
        motionId,
        sequence: expect.any(Number),
      }),
    ]);
    expect(owner.nationalConflicts?.motions[0]?.id).toBe(motionId);
    expect(southView()).not.toHaveProperty("nationalCommandResults");
    expect(spectatorView()).not.toHaveProperty("nationalCommandResults");

    const acceptance = command(
      game.player(south.id),
      { kind: "accept-peace", motionId },
      acceptanceId,
    );
    expect(acceptance).toMatchObject({
      accepted: true,
      requestId: acceptanceId,
    });
    const southResult = southView();
    expect(southResult.nationalCommandResults).toEqual([
      expect.objectContaining({
        type: "national_accept_peace",
        actorId: south.id,
        recipientId: south.id,
        accepted: true,
        requestId: acceptanceId,
        warId,
        motionId,
        sequence: expect.any(Number),
      }),
    ]);
    expect(southResult.nationalConflicts?.layers[0]?.endedTick).not.toBeNull();
    expect(
      southResult.nationalConflicts?.motions[0]?.acceptedTick,
    ).not.toBeNull();
    expect(northView()).not.toHaveProperty("nationalCommandResults");
    expect(spectatorView()).not.toHaveProperty("nationalCommandResults");

    const { bytes, again, restored } = await roundTrip(game, "plains");
    expect([...again]).toEqual([...bytes]);
    expect(liveRunner(restored, north.clientID!)()).not.toHaveProperty(
      "nationalCommandResults",
    );
    expect(liveRunner(restored, south.clientID!)()).not.toHaveProperty(
      "nationalCommandResults",
    );
    expect(publicWar(restored, south.id)?.layers[0]?.endedTick).not.toBeNull();
  });

  it("direct outbound filter refuses foreign, future and malformed result IDs", async () => {
    const game = await activeWar();
    const filter = new NationalOutboundFilter(game, north.id);
    const packet = liveRunner(game, north.clientID!)();
    const forged = {
      ...packet,
      nationalCommandResults: [
        {
          type: "national_declare_war",
          actorId: south.id,
          recipientId: north.id,
          accepted: true,
          requestId: "nc_0123456789abcdef0123456789abcdef",
          sequence: 1,
          tick: game.ticks(),
          reason: "accepted",
          warId,
        },
        {
          type: "national_declare_war",
          actorId: north.id,
          recipientId: north.id,
          accepted: true,
          requestId: "nc_0123456789abcdef0123456789abcdef",
          sequence: 2,
          tick: game.ticks() + 1,
          reason: "accepted",
          warId,
        },
        {
          type: "national_declare_war",
          actorId: north.id,
          recipientId: north.id,
          accepted: true,
          requestId: "untrusted-auto:click",
          sequence: 3,
          tick: game.ticks(),
          reason: "accepted",
          warId,
        },
      ],
    };
    const outgoing = filter.project(game, forged as GameUpdateViewData, null);
    expect(outgoing).not.toHaveProperty("nationalCommandResults");
  });
});
