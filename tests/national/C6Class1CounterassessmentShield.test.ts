import {
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import {
  NationalCounterassessmentIntentSchema,
  type GameConfig,
} from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import {
  NATIONAL_ASSESSMENT_COST,
  NATIONAL_COUNTERASSESSMENT_COST,
  NATIONAL_COUNTERASSESSMENT_DURATION_TICKS,
  NationalAssessment,
  captureNationalAssessmentBands,
  projectLiveNationalAssessments,
} from "@openfront/engine/national/observation/NationalAssessment";
import { NationalServerRecipientSession } from "@openfront/engine/national/observation/NationalServerOutbound";
import { StreamingEncoder } from "../../src/client/replay/codec/encode/StreamingEncoder";
import { VIEW_DATA_ROUTING } from "../../src/client/replay/codec/FrameNormalizer";
import { parseTrustedNationalProjection } from "../../src/client/TrustedNationalSession";
import { encodeNationalRecipientProjection } from "../../src/server/national/NationalRecipientWire";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const BUYER = new PlayerInfo(
  "Hostile assessor",
  PlayerType.Human,
  "c6-e4-assessor-session",
  "c6-e4-assessor",
);
const DEFENDER = new PlayerInfo(
  "Shield defender",
  PlayerType.Human,
  "c6-e4-defender-session",
  "c6-e4-defender",
);
const OTHER = new PlayerInfo(
  "Other private observer",
  PlayerType.Human,
  "c6-e4-other-session",
  "c6-e4-other",
);
class PrivateAssessmentConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}
async function active(nationalMode = true, gameType = GameType.Private) {
  const game = await setup(
    "big_plains",
    { nationalMode, gameType },
    [BUYER, DEFENDER, OTHER],
    undefined,
    gameType === GameType.Private ? PrivateAssessmentConfig : TestConfig,
  );
  game.addExecution(
    new SpawnExecution("c6-e4", BUYER, game.ref(20, 100)),
    new SpawnExecution("c6-e4", DEFENDER, game.ref(185, 175)),
    new SpawnExecution("c6-e4", OTHER, game.ref(18, 15)),
  );
  game.executeNextTick();
  game.executeNextTick();
  game.endSpawnPhase();
  return game;
}
function packet(
  game: Awaited<ReturnType<typeof active>>,
  clientID: string,
): GameUpdateViewData {
  let view: GameUpdateViewData | null = null;
  const runner = new GameRunner(
    game,
    new Executor(game, "c6-counterassessment-projection", clientID),
    (event) => {
      if ("updates" in event) view = event;
    },
    clientID,
  );
  game.queueViewResync();
  runner.addTurn({ turnNumber: game.ticks(), intents: [] });
  expect(runner.executeNextTick()).toBe(true);
  if (view === null) throw new Error("GameRunner emitted no recipient view");
  return view;
}
function assertTruth(
  report: {
    treasuryGoldBand: { lower: string; upperExclusive: string };
    militaryTroopsBand: { lower: string; upperExclusive: string };
  },
  actualGold: bigint,
  actualTroops: number,
): void {
  expect(BigInt(report.treasuryGoldBand.lower)).toBeLessThanOrEqual(actualGold);
  expect(BigInt(report.treasuryGoldBand.upperExclusive)).toBeGreaterThan(
    actualGold,
  );
  expect(BigInt(report.militaryTroopsBand.lower)).toBeLessThanOrEqual(
    BigInt(actualTroops),
  );
  expect(BigInt(report.militaryTroopsBand.upperExclusive)).toBeGreaterThan(
    BigInt(actualTroops),
  );
}

describe("C6 C1 E4: actual Game-owned counterassessment shield", () => {
  it("charges both nations; prior immutable reports survive; future enemy reports truthful and wider; expires back to normal", async () => {
    const game = await active();
    const buyer = game.player(BUYER.id);
    const defender = game.player(DEFENDER.id);
    buyer.addGold(10000n);
    defender.addGold(17877n);
    const oldPrice = buyer.gold();
    const original = game.performNationalAssessment(
      buyer,
      DEFENDER.id,
      "before-shield",
      BUYER.clientID!,
    );
    expect(buyer.gold()).toBe(oldPrice - NATIONAL_ASSESSMENT_COST);
    expect(original.confidence).toBe("coarse-estimate");
    const defenseGold = defender.gold();
    const shield = game.performNationalCounterassessment(
      defender,
      "defense-1",
      DEFENDER.clientID!,
    );
    expect(defender.gold()).toBe(defenseGold - NATIONAL_COUNTERASSESSMENT_COST);
    expect(shield.cost).toBe("1800");
    expect(shield.expiresAtTick - shield.effectiveTick).toBe(
      NATIONAL_COUNTERASSESSMENT_DURATION_TICKS,
    );
    const targetWealth = defender.gold();
    const targetTroops = defender.troops();
    const boughtAt = buyer.gold();
    const shielded = game.performNationalAssessment(
      buyer,
      DEFENDER.id,
      "after-shield",
      BUYER.clientID!,
    );
    expect(buyer.gold()).toBe(boughtAt - NATIONAL_ASSESSMENT_COST);
    expect(shielded.confidence).toBe("shielded-coarse-estimate");
    expect(
      BigInt(shielded.treasuryGoldBand.upperExclusive) -
        BigInt(shielded.treasuryGoldBand.lower),
    ).toBe(10000n);
    expect(
      BigInt(shielded.militaryTroopsBand.upperExclusive) -
        BigInt(shielded.militaryTroopsBand.lower),
    ).toBe(400000n);
    assertTruth(shielded, targetWealth, targetTroops);
    expect(game.nationalAssessmentsFor(BUYER.id)[0]).toEqual(original);
    const recipient = projectLiveNationalAssessments(game, BUYER.id);
    expect(recipient.map((report) => report.confidence)).toEqual([
      "coarse-estimate",
      "shielded-coarse-estimate",
    ]);
    expect(recipient[0].treasuryGoldBand).toEqual(original.treasuryGoldBand);
    expect(recipient[1].treasuryGoldBand).toEqual(shielded.treasuryGoldBand);
    expect(
      collectLiveNationalObservation(game, BUYER.id).observation.assessments,
    ).toEqual(recipient);
    expect(projectLiveNationalAssessments(game, DEFENDER.id)).toEqual([]);
    expect(projectLiveNationalAssessments(game, OTHER.id)).toEqual([]);
    const human = packet(game, BUYER.clientID!).nationalAssessments;
    expect(human?.items.map((report) => report.confidence)).toEqual([
      "coarse-estimate",
      "shielded-coarse-estimate",
    ]);
    expect(packet(game, OTHER.clientID!).nationalAssessments?.items).toEqual(
      [],
    );
    const socket = new NationalServerRecipientSession(game, {
      clientID: BUYER.clientID!,
      sessionId: "c6-e4-private-attacker-socket",
      isConnected: () => true,
      isSpectator: () => false,
    });
    const view = socket.projectGameUpdate(packet(game, BUYER.clientID!));
    expect(view).not.toBeNull();
    const encoded = encodeNationalRecipientProjection(view!);
    const decoded = parseTrustedNationalProjection(encoded, view!.tick);
    expect(decoded.nationalAssessments).toMatchObject({
      items: [
        expect.objectContaining({ confidence: "coarse-estimate" }),
        expect.objectContaining({ confidence: "shielded-coarse-estimate" }),
      ],
    });
    // The payer now receives its own exact purchase IDs and costs, never
    // the opponent's counterassessment receipt or private shield state.
    expect(decoded.nationalAssessments).toMatchObject({
      receipts: expect.arrayContaining([
        {
          requestId: "before-shield",
          payerId: BUYER.id,
          targetId: DEFENDER.id,
          effectiveTick: original.effectiveTick,
          outcome: "accepted",
          cost: "1200",
        },
        {
          requestId: "after-shield",
          payerId: BUYER.id,
          targetId: DEFENDER.id,
          effectiveTick: shielded.effectiveTick,
          outcome: "accepted",
          cost: "1200",
        },
      ]),
    });
    expect(human?.receipts).toHaveLength(2);
    for (const item of human?.items ?? []) {
      expect(item).not.toHaveProperty("requestId");
      expect(item).not.toHaveProperty("cost");
    }
    expect(
      packet(game, OTHER.clientID!).nationalAssessments?.receipts ?? [],
    ).toEqual([]);
    expect(
      packet(game, DEFENDER.clientID!).nationalAssessments?.receipts ?? [],
    ).toEqual([]);
    expect(encoded).not.toContain("defense-1");
    expect(encoded).not.toContain('"shields"');
    const spectator = new NationalServerRecipientSession(game, {
      clientID: null,
      sessionId: "c6-e4-spectator",
      isConnected: () => true,
      isSpectator: () => true,
    });
    expect(
      spectator.projectGameUpdate(packet(game, OTHER.clientID!)),
    ).not.toHaveProperty("nationalAssessments");
    const { restored, bytes, again } = await roundTrip(game, "big_plains");
    expect(again).toEqual(bytes);
    expect(restored.nationalAssessmentsFor(BUYER.id)).toEqual(
      game.nationalAssessmentsFor(BUYER.id),
    );
    expect(projectLiveNationalAssessments(restored, BUYER.id)).toEqual(
      recipient,
    );
    expect(() =>
      restored.performNationalCounterassessment(
        restored.player(DEFENDER.id),
        "defense-1",
        DEFENDER.clientID!,
      ),
    ).toThrow(/duplicate/);
    while (game.ticks() < shield.expiresAtTick) game.executeNextTick();
    expect(game.nationalAssessmentsFor(BUYER.id)[0]).toEqual(original);
    expect(game.nationalAssessmentsFor(BUYER.id)[1]).toEqual(shielded);
    const afterExpiry = game.performNationalAssessment(
      buyer,
      DEFENDER.id,
      "expired-shield",
      BUYER.clientID!,
    );
    expect(afterExpiry.confidence).toBe("coarse-estimate");
    expect(
      BigInt(afterExpiry.treasuryGoldBand.upperExclusive) -
        BigInt(afterExpiry.treasuryGoldBand.lower),
    ).toBe(2500n);
    assertTruth(afterExpiry, defender.gold(), defender.troops());
    expect(game.nationalAssessmentsFor(BUYER.id)[1]).toEqual(shielded);
  });

  it("rejects forged sessions, insufficient balance, duplicate IDs, target and price injection without charging", async () => {
    const game = await active();
    const defender = game.player(DEFENDER.id);
    const buyer = game.player(BUYER.id);
    defender.addGold(6000n);
    const initial = defender.gold();
    expect(
      NationalCounterassessmentIntentSchema.parse({
        type: "national_buy_counterassessment",
        requestId: "canonical",
        defenderId: OTHER.id,
        targetId: BUYER.id,
        cost: 0,
        durationTicks: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({
      type: "national_buy_counterassessment",
      requestId: "canonical",
    });
    expect(
      NationalCounterassessmentIntentSchema.safeParse({
        type: "national_buy_counterassessment",
        requestId: "bad id",
      }).success,
    ).toBe(false);
    expect(() =>
      game.performNationalCounterassessment(
        defender,
        "foreign",
        BUYER.clientID!,
      ),
    ).toThrow(/stale authenticated/);
    expect(() =>
      game.performNationalCounterassessment(
        buyer,
        "foreign",
        DEFENDER.clientID!,
      ),
    ).toThrow(/stale authenticated/);
    expect(defender.gold()).toBe(initial);
    game.performNationalCounterassessment(
      defender,
      "first",
      DEFENDER.clientID!,
    );
    const charged = defender.gold();
    expect(() =>
      game.performNationalCounterassessment(
        defender,
        "first",
        DEFENDER.clientID!,
      ),
    ).toThrow(/duplicate/);
    expect(() =>
      game.performNationalCounterassessment(
        defender,
        "overlap",
        DEFENDER.clientID!,
      ),
    ).toThrow(/already active/);
    expect(defender.gold()).toBe(charged);
    buyer.removeGold(buyer.gold());
    expect(() =>
      game.performNationalCounterassessment(buyer, "unfunded", BUYER.clientID!),
    ).toThrow(/insufficient gold/);
    expect(buyer.gold()).toBe(0n);
    expect(projectLiveNationalAssessments(game, OTHER.id)).toEqual([]);
  });

  it("retains a stamped queued defense through a real Game execution snapshot and never doubles charge", async () => {
    const game = await active();
    game.player(DEFENDER.id).addGold(10000n);
    const execution = new Executor(
      game,
      "c6-e4-defense-queue",
      DEFENDER.clientID!,
    ).createExec({
      type: "national_buy_counterassessment",
      requestId: "queued-shield",
      clientID: DEFENDER.clientID!,
    });
    game.addExecution(execution);
    const { restored, bytes, again } = await roundTrip(game, "big_plains");
    expect(again).toEqual(bytes);
    const debitA = vi.spyOn(game.player(DEFENDER.id), "removeGold");
    const debitB = vi.spyOn(restored.player(DEFENDER.id), "removeGold");
    for (let i = 0; i < 2; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(
      debitA.mock.calls.filter(
        ([amount]) => amount === NATIONAL_COUNTERASSESSMENT_COST,
      ),
    ).toHaveLength(1);
    expect(
      debitB.mock.calls.filter(
        ([amount]) => amount === NATIONAL_COUNTERASSESSMENT_COST,
      ),
    ).toHaveLength(1);
    expect(game.player(DEFENDER.id).gold()).toBe(
      restored.player(DEFENDER.id).gold(),
    );
    expect(game.ticks()).toBe(restored.ticks());
    expect(() =>
      restored.performNationalCounterassessment(
        restored.player(DEFENDER.id),
        "queued-shield",
        DEFENDER.clientID!,
      ),
    ).toThrow(/duplicate/);
    debitA.mockRestore();
    debitB.mockRestore();
  });

  it("preserves legacy FFA and rejects defensive payments there", async () => {
    const game = await active(false, GameType.Singleplayer);
    game.player(DEFENDER.id).addGold(3000n);
    expect(() =>
      game.performNationalCounterassessment(
        game.player(DEFENDER.id),
        "not-national",
        DEFENDER.clientID!,
      ),
    ).toThrow(/mode not enabled/);
    expect(game.nationalAssessmentsFor(BUYER.id)).toEqual([]);
  });
});

describe("C6 C1 E4: bounded and independently restorable shield ledger", () => {
  it("rejects active shield #513 before charge and all replay IDs after expiration", () => {
    const ledger = new NationalAssessment();
    let charges = 0;
    for (let i = 0; i < 512; i++)
      ledger.buyShield(
        "defender" + i,
        10,
        "r" + i,
        () => {
          charges++;
        },
        () => {
          charges--;
        },
      );
    expect(charges).toBe(512);
    expect(() =>
      ledger.buyShield(
        "defender512",
        10,
        "excess",
        () => {
          charges++;
        },
        () => {
          charges--;
        },
      ),
    ).toThrow(/active shield capacity/);
    expect(charges).toBe(512);
    const revived = NationalAssessment.restore(ledger.snapshot(), 610);
    expect(revived.isShielded("defender0", 610)).toBe(false);
    expect(() =>
      revived.buyShield(
        "defender0",
        610,
        "r0",
        () => {
          charges++;
        },
        () => {
          charges--;
        },
      ),
    ).toThrow(/duplicate/);
    revived.buyShield(
      "defender0",
      610,
      "renewed",
      () => {
        charges++;
      },
      () => {
        charges--;
      },
    );
    expect(charges).toBe(513);
  });

  it("caps durable 4096 shield receipts and rejects forged snapshot bands, overlap and expiration", () => {
    const ledger = new NationalAssessment();
    let charges = 0;
    for (let n = 0; n < 4096; n++) {
      ledger.buyShield(
        "longlife",
        n * 600,
        "shield" + n,
        () => {
          charges++;
        },
        () => {
          charges--;
        },
      );
    }
    expect(charges).toBe(4096);
    expect(() =>
      ledger.buyShield(
        "longlife",
        4096 * 600,
        "overflow",
        () => {
          charges++;
        },
        () => {
          charges--;
        },
      ),
    ).toThrow(/shield journal exhausted/);
    expect(charges).toBe(4096);
    const original = ledger.snapshot();
    expect(() =>
      NationalAssessment.restore(
        {
          ...original,
          shields: [
            ...original.shields!,
            { ...original.shields![0], requestId: "forged", cost: "0" },
          ],
        },
        4096 * 600,
      ),
    ).toThrow();
    expect(() =>
      NationalAssessment.restore(
        {
          ...original,
          shields: [
            ...original.shields!,
            { ...original.shields![0], requestId: "overlap" },
          ],
        },
        4096 * 600,
      ),
    ).toThrow();
    // A hostile snapshot cannot claim wider paid defense without a
    // corresponding real target-owned shield receipt at purchase time.
    const counterfeit = new NationalAssessment();
    const counterfeitGrant = counterfeit.buy(
      "counterfeit-payer",
      "counterfeit-target",
      11,
      "counterfeit-report",
      () => {},
      () => {},
      () => captureNationalAssessmentBands(12345n, 123456, true),
    );
    expect(() =>
      NationalAssessment.restore(
        { version: 1, grants: [counterfeitGrant], shields: [] },
        11,
      ),
    ).toThrow(/unfunded shielded report/);
    expect(() =>
      NationalAssessment.restore(
        {
          version: 1,
          grants: [
            {
              ...counterfeitGrant,
              treasuryGoldBand: {
                lower: "1".repeat(1000),
                upperExclusive: "2".repeat(1000),
              },
            },
          ],
          shields: [],
        },
        11,
      ),
    ).toThrow();
    const old = new NationalAssessment();
    old.buy(
      "payer",
      "target",
      10,
      "legacy",
      () => {},
      () => {},
      () => captureNationalAssessmentBands(12345n, 123456),
    );
    const fifth = {
      version: 1,
      grants: old
        .snapshot()
        .grants.map(({ confidence: _confidence, ...grant }) => grant),
    };
    const migrated = NationalAssessment.restore(fifth, 11);
    expect(migrated.activeFor("payer", 11)[0].confidence).toBeUndefined();
    expect(migrated.snapshot().shields).toEqual([]);
  });
});

describe("C6 C1 E4: replay and reciprocal empire invariants", () => {
  it("produces identical public replay binary and event data with shielded private report removed", async () => {
    const game = await active();
    const defender = game.player(DEFENDER.id);
    const buyer = game.player(BUYER.id);
    defender.addGold(6000n);
    buyer.addGold(6000n);
    game.performNationalCounterassessment(
      defender,
      "replay-private-shield",
      DEFENDER.clientID!,
    );
    game.performNationalAssessment(
      buyer,
      DEFENDER.id,
      "replay-private-report",
      BUYER.clientID!,
    );
    const privatePacket = packet(game, BUYER.clientID!);
    expect(privatePacket.nationalAssessments?.items[0].confidence).toBe(
      "shielded-coarse-estimate",
    );
    expect(VIEW_DATA_ROUTING.nationalAssessments).toBe("dropped");
    const options = {
      mapWidth: game.width(),
      mapHeight: game.height(),
      terrain: new Uint8Array(game.width() * game.height()),
      numLandTiles: 0,
      gameStartInfo: {},
      keyframeInterval: 1,
      gzip: (bytes: Uint8Array) => bytes,
    };
    async function encode(view: GameUpdateViewData) {
      const replay = new StreamingEncoder(options);
      replay.pushFrame(view);
      replay.end();
      return replay.takeAppend();
    }
    const publicPacket = { ...privatePacket };
    delete publicPacket.nationalAssessments;
    const [privateEncoded, publicEncoded] = await Promise.all([
      encode(privatePacket),
      encode(publicPacket),
    ]);
    expect(privateEncoded.chunks).toEqual(publicEncoded.chunks);
    expect(privateEncoded.players).toEqual(publicEncoded.players);
    expect(privateEncoded.events).toEqual(publicEncoded.events);
    expect(privateEncoded.unitTypes).toEqual(publicEncoded.unitTypes);
  });

  it("preserves original lawful empire-member confidence through a crown transfer while shielding outsiders", async () => {
    const game = await active(true, GameType.Singleplayer);
    const defender = game.player(DEFENDER.id);
    const buyer = game.player(BUYER.id);
    const outsider = game.player(OTHER.id);
    defender.addGold(8000n);
    buyer.addGold(5000n);
    outsider.addGold(5000n);
    game.performNationalCommand(defender, {
      kind: "found-empire",
      empireId: "c6-e4-reciprocal",
    });
    game.performNationalCommand(defender, {
      kind: "offer-empire",
      empireId: "c6-e4-reciprocal",
      candidateId: BUYER.id,
    });
    game.performNationalCommand(buyer, {
      kind: "accept-empire",
      empireId: "c6-e4-reciprocal",
      candidateId: BUYER.id,
    });
    const shield = game.performNationalCounterassessment(
      defender,
      "empire-shield",
      DEFENDER.clientID!,
    );
    expect(shield.defenderId).toBe(DEFENDER.id);
    game.performNationalCommand(defender, {
      kind: "transfer-crown",
      empireId: "c6-e4-reciprocal",
      successorId: BUYER.id,
    });
    const memberReport = game.performNationalAssessment(
      buyer,
      DEFENDER.id,
      "lawful-member",
      BUYER.clientID!,
    );
    expect(memberReport.confidence).toBe("coarse-estimate");
    const outsiderReport = game.performNationalAssessment(
      outsider,
      DEFENDER.id,
      "hostile-outsider",
      OTHER.clientID!,
    );
    expect(outsiderReport.confidence).toBe("shielded-coarse-estimate");
    expect(projectLiveNationalAssessments(game, OTHER.id)[0].confidence).toBe(
      "shielded-coarse-estimate",
    );
  });
});
