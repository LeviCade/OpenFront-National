import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { StampedIntentSchema } from "@openfront/engine-api/Schemas";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { NationalFoundEmpireExecution } from "@openfront/engine/execution/NationalFoundEmpireExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import type { Game } from "@openfront/engine/game/Game";
import { GameSnapshot } from "@openfront/engine/game/GameImpl";
import { GameRunner } from "@openfront/engine/GameRunner";
import type { NationalCommand } from "@openfront/engine/national/NationalRuntime";
import { snapshotGameData } from "@openfront/engine/snapshot/GameSnapshot";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";

const principals = [
  new PlayerInfo("R10 A", PlayerType.Human, "R10CLIA1", "r10-a"),
  new PlayerInfo("R10 B", PlayerType.Human, "R10CLIB2", "r10-b"),
  new PlayerInfo("R10 C", PlayerType.Human, "R10CLIC3", "r10-c"),
  new PlayerInfo("R10 D", PlayerType.Human, "R10CLID4", "r10-d"),
];
const [A, B, C, D] = principals.map((p) => p.id);
const positions = [
  [25, 25],
  [70, 70],
  [25, 70],
  [70, 25],
] as const;
const pactTerms = {
  admission: "leader" as const,
  expulsion: "forbidden" as const,
};

async function spawned(): Promise<Game> {
  const game = await setup("plains", { nationalMode: true }, principals);
  for (let i = 0; i < principals.length; i++) {
    const [x, y] = positions[i];
    game.addExecution(
      new SpawnExecution("r10-sovereign-match", principals[i], game.ref(x, y)),
    );
  }
  game.executeNextTick();
  game.executeNextTick();
  for (const player of principals)
    expect(game.player(player.id).hasSpawned()).toBe(true);
  return game;
}

/** Actual server-stamped public founding intent through Executor and ticks. */
function foundFromWire(
  game: Game,
  founderId: string,
  empireId: string,
  requestId: string,
): void {
  const info = principals.find((p) => p.id === founderId)!;
  const intent = StampedIntentSchema.parse({
    type: "national_found_empire",
    empireId,
    requestId,
    clientID: info.clientID,
  });
  game.addExecution(
    new Executor(game, "r10-sovereign-match", undefined).createExec(intent),
  );
  game.executeNextTick();
  game.executeNextTick();
}

/**
 * Existing E1 political execution, queued through real Game ticks.
 * E2 owns registering the three missing StampedIntent/Executor variants.
 */
function politicalExecution(
  game: Game,
  actorId: string,
  command: Exclude<NationalCommand, { kind: "found-empire" }>,
  requestId: string,
): void {
  game.addExecution(
    new NationalFoundEmpireExecution(
      game.player(actorId),
      "",
      command,
      requestId,
    ),
  );
  game.executeNextTick();
  game.executeNextTick();
}

function politicalReceipts(game: Game, playerId: string) {
  return game.nationalPoliticalCommandResults(game.player(playerId));
}

function privateSnapshot(game: Game) {
  return readVersioned(GameSnapshot, snapshotGameData(game).game);
}

function last<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1];
}

describe("Round Ten live sovereignty: authenticated Game execution and replay", () => {
  it("delivers a real private consent offer; accepts exactly one sovereign roster and clears former pact", async () => {
    const game = await spawned();
    foundFromWire(game, A, "r10-empire-a", "r10-found-a");
    foundFromWire(game, C, "r10-empire-c", "r10-found-c");

    // A candidate may retain an ordinary pact while receiving offers,
    // but must exit it atomically on becoming an imperial member.
    game.performNationalCommand(game.player(B), {
      kind: "found-pact",
      pactId: "r10-before-joining",
      name: "Pre-accession treaty",
      pactKind: "NAP",
      terms: pactTerms,
    });
    game.performNationalCommand(game.player(B), {
      kind: "invite-pact",
      pactId: "r10-before-joining",
      candidateId: D,
    });
    game.performNationalCommand(game.player(D), {
      kind: "accept-pact",
      pactId: "r10-before-joining",
    });

    politicalExecution(
      game,
      A,
      { kind: "offer-empire", empireId: "r10-empire-a", candidateId: B },
      "r10-offer-a",
    );
    politicalExecution(
      game,
      C,
      { kind: "offer-empire", empireId: "r10-empire-c", candidateId: B },
      "r10-offer-c",
    );
    expect(game.nationalAccessionOffers(game.player(B))).toEqual([
      {
        empireId: "r10-empire-a",
        candidateId: B,
        proposerId: A,
        recipientId: B,
      },
      {
        empireId: "r10-empire-c",
        candidateId: B,
        proposerId: C,
        recipientId: B,
      },
    ]);
    expect(game.nationalAccessionOffers(game.player(D))).toEqual([]);
    expect(game.nationalAccessionOffers(game.player(A))).toEqual([]);
    const forgedObserver = new Proxy(game.player(B), {});
    expect(game.nationalAccessionOffers(forgedObserver)).toEqual([]);
    const beforeForgery = snapshotGameData(game);
    expect(() =>
      game.performNationalPoliticalCommandWithOutcome(
        forgedObserver,
        { kind: "accept-empire", empireId: "r10-empire-a", candidateId: B },
        "r10-borrowed-player",
      ),
    ).toThrow(/forged actor/);
    expect(snapshotGameData(game)).toEqual(beforeForgery);
    expect(game.nationalPublicPoliticalView()?.empires).toEqual([
      { id: "r10-empire-a", leaderId: A, memberIds: [A] },
      { id: "r10-empire-c", leaderId: C, memberIds: [C] },
    ]);
    expect(politicalReceipts(game, A)).toMatchObject([
      {
        requestId: "r10-offer-a",
        actorId: A,
        recipientId: A,
        commandKind: "offer-empire",
        commandTargetId: "r10-empire-a",
        accepted: true,
      },
    ]);
    expect(politicalReceipts(game, B)).toEqual([]);

    const { restored } = await roundTrip(game, "plains");
    for (const g of [game, restored]) {
      expect(g.nationalAccessionOffers(g.player(B))).toHaveLength(2);
      const before = politicalReceipts(g, A);
      politicalExecution(
        g,
        A,
        { kind: "offer-empire", empireId: "r10-empire-a", candidateId: B },
        "r10-offer-a",
      );
      expect(politicalReceipts(g, A)).toEqual(before);
      expect(g.nationalAccessionOffers(g.player(B))).toHaveLength(2);
      politicalExecution(
        g,
        D,
        { kind: "accept-empire", empireId: "r10-empire-a", candidateId: B },
        "r10-outside-forgery",
      );
      expect(last(politicalReceipts(g, D))).toMatchObject({
        actorId: D,
        recipientId: D,
        accepted: false,
        reason: "political-rule",
      });
      expect(g.nationalPoliticalAuthority()?.empireOf(B)).toBeNull();

      politicalExecution(
        g,
        B,
        { kind: "accept-empire", empireId: "r10-empire-a", candidateId: B },
        "r10-consent-b",
      );
      expect(last(politicalReceipts(g, B))).toMatchObject({
        requestId: "r10-consent-b",
        actorId: B,
        recipientId: B,
        commandKind: "accept-empire",
        accepted: true,
      });
      expect(
        g.nationalPoliticalAuthority()?.membersOf("r10-empire-a"),
      ).toEqual([A, B]);
      expect(
        g.nationalPoliticalAuthority()?.membersOf("r10-empire-c"),
      ).toEqual([C]);
      expect(g.nationalAccessionOffers(g.player(B))).toEqual([]);
      expect(privateSnapshot(g).national?.politics.pacts).toEqual([]);
      expect(g.nationalVictoryRoster()).toBeNull();

      // Consent is single-use, including rejected stale invitations to
      // another empire after the candidate is already a member.
      politicalExecution(
        g,
        B,
        { kind: "accept-empire", empireId: "r10-empire-c", candidateId: B },
        "r10-stale-consent",
      );
      expect(last(politicalReceipts(g, B))?.accepted).toBe(false);
      expect(g.nationalPoliticalAuthority()?.empireOf(B)).toBe(
        "r10-empire-a",
      );
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });

  it("removes invalid invitations when an independent nation establishes its own empire", async () => {
    const game = await spawned();
    foundFromWire(game, A, "r10-founder-a", "r10-founder-a-id");
    politicalExecution(
      game,
      A,
      { kind: "offer-empire", empireId: "r10-founder-a", candidateId: B },
      "r10-preexisting-offer",
    );
    expect(game.nationalAccessionOffers(game.player(B))).toHaveLength(1);
    foundFromWire(game, B, "r10-founder-b", "r10-founder-b-id");
    expect(last(game.nationalCommandResults(game.player(B)))).toMatchObject({
      accepted: true,
      requestId: "r10-founder-b-id",
    });
    expect(game.nationalAccessionOffers(game.player(B))).toEqual([]);
    expect(game.nationalPoliticalAuthority()?.empireOf(B)).toBe(
      "r10-founder-b",
    );
    expect(game.nationalPublicPoliticalView()?.empires).toHaveLength(2);
    const { restored } = await roundTrip(game, "plains");
    for (const g of [game, restored]) {
      politicalExecution(
        g,
        B,
        {
          kind: "accept-empire",
          empireId: "r10-founder-a",
          candidateId: B,
        },
        "r10-outdated-offer",
      );
      expect(last(politicalReceipts(g, B))).toMatchObject({
        accepted: false,
        reason: "political-rule",
      });
      expect(g.nationalPoliticalAuthority()?.empireOf(B)).toBe(
        "r10-founder-b",
      );
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });

  it("transfers the crown during layered real wars while preserving the two legal peace authorities", async () => {
    const game = await spawned();
    foundFromWire(game, A, "r10-war-empire", "r10-war-founder");
    politicalExecution(
      game,
      A,
      { kind: "offer-empire", empireId: "r10-war-empire", candidateId: B },
      "r10-war-offer",
    );
    politicalExecution(
      game,
      B,
      { kind: "accept-empire", empireId: "r10-war-empire", candidateId: B },
      "r10-war-join",
    );
    // Separate scopes are independent WarLedger layers. This is real Game
    // authority, not a test-only war roster or fabricated diplomacy packet.
    const national = game.performNationalWarCommandWithOutcome(
      game.player(A),
      {
        kind: "declare-national",
        warId: "r10-national-layer",
        aggressorId: B,
        targetId: D,
      },
      "r10-war-national",
    );
    const imperial = game.performNationalWarCommandWithOutcome(
      game.player(A),
      {
        kind: "declare-imperial",
        warId: "r10-imperial-layer",
        aggressor: { kind: "empire", id: "r10-war-empire" },
        target: { kind: "nation", id: D },
      },
      "r10-war-imperial",
    );
    expect(national.accepted).toBe(true);
    expect(imperial.accepted).toBe(true);
    const layers = game.nationalWarState()?.wars.layers;
    expect(layers).toHaveLength(2);
    expect(game.nationalWarAuthority()?.atWar(B, D)).toBe(true);
    expect(game.nationalVictoryRoster()).toBeNull();

    // No member may assume diplomacy just because they belong to the empire.
    expect(
      game.performNationalWarCommandWithOutcome(
        game.player(B),
        {
          kind: "propose-peace",
          motionId: "r10-premature",
          warId: "r10-national-layer",
        },
        "r10-peace-premature",
      ).accepted,
    ).toBe(false);
    politicalExecution(
      game,
      D,
      { kind: "transfer-crown", empireId: "r10-war-empire", successorId: B },
      "r10-crown-forgery",
    );
    expect(last(politicalReceipts(game, D))?.accepted).toBe(false);

    politicalExecution(
      game,
      A,
      { kind: "transfer-crown", empireId: "r10-war-empire", successorId: B },
      "r10-valid-crown",
    );
    expect(last(politicalReceipts(game, A))).toMatchObject({
      commandKind: "transfer-crown",
      recipientId: A,
      accepted: true,
    });
    expect(game.nationalPublicPoliticalView()?.empires).toEqual([
      { id: "r10-war-empire", leaderId: B, memberIds: [A, B] },
    ]);
    expect(game.nationalWarState()?.wars.layers).toEqual(layers);
    const { restored } = await roundTrip(game, "plains");

    for (const g of [game, restored]) {
      expect(g.nationalPoliticalAuthority()?.emperorOf("r10-war-empire")).toBe(
        B,
      );
      expect(g.nationalWarState()?.wars.layers).toEqual(layers);
      expect(
        g.performNationalWarCommandWithOutcome(
          g.player(A),
          {
            kind: "propose-peace",
            motionId: "r10-former-ruler",
            warId: "r10-imperial-layer",
          },
          "r10-rejected-old-ruler",
        ).accepted,
      ).toBe(false);
      const motionImperial = g.performNationalWarCommandWithOutcome(
        g.player(B),
        {
          kind: "propose-peace",
          motionId: "r10-imperial-peace",
          warId: "r10-imperial-layer",
        },
        "r10-imperial-proposal",
      );
      expect(motionImperial.accepted).toBe(true);
      expect(
        g.performNationalWarCommandWithOutcome(
          g.player(D),
          { kind: "accept-peace", motionId: "r10-imperial-peace" },
          "r10-imperial-settlement",
        ).accepted,
      ).toBe(true);
      const afterImperial = g.nationalWarState()?.wars.layers;
      expect(
        afterImperial?.find((w) => w.id === "r10-imperial-layer")?.endedTick,
      ).not.toBeNull();
      expect(
        afterImperial?.find((w) => w.id === "r10-national-layer")?.endedTick,
      ).toBeNull();
      expect(g.nationalWarAuthority()?.atWar(B, D)).toBe(true);

      expect(
        g.performNationalWarCommandWithOutcome(
          g.player(B),
          {
            kind: "propose-peace",
            motionId: "r10-national-peace",
            warId: "r10-national-layer",
          },
          "r10-national-proposal",
        ).accepted,
      ).toBe(true);
      expect(
        g.performNationalWarCommandWithOutcome(
          g.player(D),
          { kind: "accept-peace", motionId: "r10-national-peace" },
          "r10-national-settlement",
        ).accepted,
      ).toBe(true);
      expect(g.nationalWarAuthority()?.atWar(B, D)).toBe(false);
      expect(
        g.nationalPoliticalAuthority()?.membersOf("r10-war-empire"),
      ).toEqual([A, B]);
      expect(g.nationalVictoryRoster()).toBeNull();
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });
  it("invalidates old emperor consent on transfer and accepts only a new offer from the current crown", async () => {
    const game = await spawned();
    foundFromWire(game, A, "r10-crown-consent", "r10-crown-found");
    politicalExecution(
      game,
      A,
      { kind: "offer-empire", empireId: "r10-crown-consent", candidateId: B },
      "r10-crown-offer-b",
    );
    politicalExecution(
      game,
      B,
      { kind: "accept-empire", empireId: "r10-crown-consent", candidateId: B },
      "r10-crown-accept-b",
    );
    // The independent candidate, not the emperor, initiates the proposal.
    politicalExecution(
      game,
      C,
      { kind: "offer-empire", empireId: "r10-crown-consent", candidateId: C },
      "r10-candidate-proposal",
    );
    expect(game.nationalAccessionOffers(game.player(A))).toMatchObject([
      { candidateId: C, proposerId: C, recipientId: A },
    ]);
    expect(game.nationalAccessionOffers(game.player(B))).toEqual([]);
    politicalExecution(
      game,
      A,
      {
        kind: "transfer-crown",
        empireId: "r10-crown-consent",
        successorId: B,
      },
      "r10-crown-turnover",
    );
    expect(game.nationalAccessionOffers(game.player(A))).toEqual([]);
    expect(game.nationalAccessionOffers(game.player(B))).toEqual([]);
    expect(
      game.nationalPoliticalAuthority()?.emperorOf("r10-crown-consent"),
    ).toBe(B);
    const { restored } = await roundTrip(game, "plains");
    for (const g of [game, restored]) {
      politicalExecution(
        g,
        B,
        {
          kind: "accept-empire",
          empireId: "r10-crown-consent",
          candidateId: C,
        },
        "r10-stale-crown-consent",
      );
      expect(last(politicalReceipts(g, B))?.accepted).toBe(false);
      politicalExecution(
        g,
        A,
        {
          kind: "offer-empire",
          empireId: "r10-crown-consent",
          candidateId: C,
        },
        "r10-old-emperor-offer",
      );
      expect(last(politicalReceipts(g, A))?.accepted).toBe(false);
      politicalExecution(
        g,
        B,
        {
          kind: "offer-empire",
          empireId: "r10-crown-consent",
          candidateId: C,
        },
        "r10-new-emperor-offer",
      );
      expect(last(politicalReceipts(g, B))?.accepted).toBe(true);
      expect(g.nationalAccessionOffers(g.player(C))).toMatchObject([
        { candidateId: C, proposerId: B, recipientId: C },
      ]);
      politicalExecution(
        g,
        C,
        {
          kind: "accept-empire",
          empireId: "r10-crown-consent",
          candidateId: C,
        },
        "r10-new-crown-consent",
      );
      expect(last(politicalReceipts(g, C))?.accepted).toBe(true);
      expect(
        g.nationalPoliticalAuthority()?.membersOf("r10-crown-consent"),
      ).toEqual([A, B, C]);
      expect(g.nationalVictoryRoster()).toBeNull();
    }
    expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
  });

  it("runs founding, accession and succession in real GameRunner ticks with deterministic replay", async () => {
    const game = await setup("plains", { nationalMode: true }, principals);
    const publishedTicks: number[] = [];
    const seed = "r10-signed-action";
    const runner = new GameRunner(
      game,
      new Executor(game, seed, principals[0].clientID!),
      (packet) => {
        if ("updates" in packet) publishedTicks.push(packet.tick);
      },
      principals[0].clientID!,
    );
    runner.init();
    for (let i = 0; i < principals.length; i++) {
      const [x, y] = positions[i];
      game.addExecution(
        new SpawnExecution(seed, principals[i], game.ref(x, y)),
      );
    }
    const advance = (r: GameRunner): void => {
      r.addTurn({ turnNumber: r.game.ticks(), intents: [] });
      expect(r.executeNextTick()).toBe(true);
    };
    advance(runner);
    advance(runner);
    for (const actor of principals)
      expect(game.player(actor.id).hasSpawned()).toBe(true);

    runner.addTurn({
      turnNumber: game.ticks(),
      intents: [
        {
          type: "national_found_empire",
          empireId: "r10-runner-empire",
          requestId: "r10-runner-found",
          clientID: principals[0].clientID!,
        },
      ],
    });
    expect(runner.executeNextTick()).toBe(true);
    advance(runner);
    expect(last(game.nationalCommandResults(game.player(A)))).toMatchObject({
      requestId: "r10-runner-found",
      actorId: A,
      accepted: true,
    });

    const political = (
      actorId: string,
      command: Exclude<NationalCommand, { kind: "found-empire" }>,
      requestId: string,
    ): void => {
      game.addExecution(
        new NationalFoundEmpireExecution(
          game.player(actorId),
          "",
          command,
          requestId,
        ),
      );
      advance(runner);
      advance(runner);
    };
    // E2 still needs to expose the three nonfounder variants through wire.
    // Here their existing E1 queue runs under the actual GameRunner scheduler.
    political(
      A,
      { kind: "offer-empire", empireId: "r10-runner-empire", candidateId: B },
      "r10-runner-offer",
    );
    expect(game.nationalAccessionOffers(game.player(B))).toHaveLength(1);
    political(
      B,
      { kind: "accept-empire", empireId: "r10-runner-empire", candidateId: B },
      "r10-runner-accept",
    );
    political(
      A,
      {
        kind: "transfer-crown",
        empireId: "r10-runner-empire",
        successorId: B,
      },
      "r10-runner-crown",
    );
    expect(
      game.nationalPoliticalAuthority()?.emperorOf("r10-runner-empire"),
    ).toBe(B);
    expect(
      game.nationalPoliticalAuthority()?.membersOf("r10-runner-empire"),
    ).toEqual([A, B]);
    expect(game.nationalVictoryRoster()).toBeNull();
    expect(politicalReceipts(game, B)).toMatchObject([
      { requestId: "r10-runner-accept", recipientId: B, accepted: true },
    ]);
    expect(publishedTicks.length).toBeGreaterThan(4);

    const { restored, bytes, again } = await roundTrip(game, "plains");
    expect(again).toEqual(bytes);
    const restoredRunner = new GameRunner(
      restored,
      new Executor(restored, seed, principals[0].clientID!),
      () => {},
      principals[0].clientID!,
    );
    for (let i = 0; i < 4; i++) {
      advance(runner);
      advance(restoredRunner);
      expect(snapshotGameData(restored)).toEqual(snapshotGameData(game));
    }
    expect(restored.nationalPublicPoliticalView()?.empires).toEqual([
      { id: "r10-runner-empire", leaderId: B, memberIds: [A, B] },
    ]);
  });
});
