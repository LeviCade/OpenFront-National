import {
  GameType,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import {
  NationalAssessmentIntentSchema,
  type GameConfig,
} from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { collectLiveNationalObservation } from "@openfront/engine/national/observation/LiveObservation";
import {
  NATIONAL_ASSESSMENT_COST,
  NATIONAL_ASSESSMENT_DURATION_TICKS,
  NationalAssessment,
  projectLiveNationalAssessments,
} from "@openfront/engine/national/observation/NationalAssessment";
import { NationalServerRecipientSession } from "@openfront/engine/national/observation/NationalServerOutbound";
import { parseTrustedNationalProjection } from "../../src/client/TrustedNationalSession";
import { encodeNationalRecipientProjection } from "../../src/server/national/NationalRecipientWire";
import { setup } from "../util/Setup";
import { roundTrip } from "../util/Snapshot";
import { TestConfig } from "../util/TestConfig";

const BUYER = new PlayerInfo(
  "Assessment Buyer",
  PlayerType.Human,
  "assessment-session-1",
  "assessment-buyer",
);
const OTHER = new PlayerInfo(
  "Other Private Seat",
  PlayerType.Human,
  "assessment-session-2",
  "assessment-other",
);
const TARGET = new PlayerInfo(
  "Secret Victim",
  PlayerType.Nation,
  null,
  "assessment-target",
);
const ALLY = new PlayerInfo(
  "Reciprocal Member",
  PlayerType.Nation,
  null,
  "assessment-ally",
);
const STRANGER = new PlayerInfo(
  "Enemy",
  PlayerType.Nation,
  null,
  "assessment-stranger",
);

/** Private NATIONAL requires the real trusted-server authority flag, not a browser config override. */
class TrustedAssessmentConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
}

async function active(nationalMode = true, gameType = GameType.Singleplayer) {
  const game = await setup(
    "big_plains",
    { nationalMode, gameType },
    [BUYER, OTHER, TARGET, ALLY, STRANGER],
    undefined,
    gameType === GameType.Private ? TrustedAssessmentConfig : TestConfig,
  );
  game.addExecution(
    new SpawnExecution("assessment", BUYER, game.ref(20, 100)),
    new SpawnExecution("assessment", OTHER, game.ref(18, 15)),
    new SpawnExecution("assessment", TARGET, game.ref(185, 175)),
    new SpawnExecution("assessment", ALLY, game.ref(35, 20)),
    new SpawnExecution("assessment", STRANGER, game.ref(190, 95)),
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
  let result: GameUpdateViewData | null = null;
  const runner = new GameRunner(
    game,
    new Executor(game, "assessment-wire", clientID),
    (event) => {
      if ("updates" in event) result = event;
    },
    clientID,
  );
  game.queueViewResync();
  runner.addTurn({ turnNumber: game.ticks(), intents: [] });
  expect(runner.executeNextTick()).toBe(true);
  if (result === null) throw new Error("No packet");
  return result;
}

describe("M7: paid target-specific national assessment; real Game and GameRunner", () => {
  it("charges 1200 real gold and emits identical bounded estimates to human and AI, never an exact enemy balance", async () => {
    const game = await active();
    const buyer = game.player(BUYER.id);
    const victim = game.player(TARGET.id);
    victim.addGold(1377n);
    buyer.addGold(4000n);
    expect(
      collectLiveNationalObservation(game, BUYER.id).observation.assessments,
    ).toEqual([]);
    expect(packet(game, BUYER.clientID!).nationalAssessments?.items).toEqual(
      [],
    );
    expect(packet(game, OTHER.clientID!).nationalAssessments?.items).toEqual(
      [],
    );
    const goldBefore = buyer.gold();
    const hiddenGoldAtPurchase = victim.gold();
    const secretTroops = victim.troops();
    const grant = game.performNationalAssessment(
      buyer,
      TARGET.id,
      "assessment_1",
      BUYER.clientID!,
    );
    expect(buyer.gold()).toBe(goldBefore - NATIONAL_ASSESSMENT_COST);
    expect(grant.cost).toBe("1200");
    expect(grant.expiresAtTick).toBe(
      grant.effectiveTick + NATIONAL_ASSESSMENT_DURATION_TICKS,
    );
    expect(grant.treasuryGoldBand.lower).not.toBe(String(hiddenGoldAtPurchase));
    expect(BigInt(grant.treasuryGoldBand.lower)).toBeLessThanOrEqual(
      hiddenGoldAtPurchase,
    );
    expect(BigInt(grant.treasuryGoldBand.upperExclusive)).toBeGreaterThan(
      hiddenGoldAtPurchase,
    );
    expect(BigInt(grant.militaryTroopsBand.lower)).toBeLessThanOrEqual(
      BigInt(secretTroops),
    );
    expect(BigInt(grant.militaryTroopsBand.upperExclusive)).toBeGreaterThan(
      BigInt(secretTroops),
    );
    expect(grant.treasuryGoldBand.upperExclusive).not.toBe(
      String(hiddenGoldAtPurchase),
    );
    const human = packet(game, BUYER.clientID!).nationalAssessments;
    const ai = collectLiveNationalObservation(game, BUYER.id).observation
      .assessments;
    expect(human?.items).toEqual(ai);
    expect(human?.items).toHaveLength(1);
    expect(human?.recipientId).toBe(BUYER.id);
    expect(human?.items[0].confidence).toBe("coarse-estimate");
    expect(human?.items[0]).not.toHaveProperty("requestId");
    expect(human?.items[0]).not.toHaveProperty("exactTroops");
    expect(human?.items[0]).not.toHaveProperty("structures");
    expect(JSON.stringify(human)).not.toContain("landingDestination");
    expect(JSON.stringify(human)).not.toContain("constitution");
    expect(packet(game, OTHER.clientID!).nationalAssessments?.items).toEqual(
      [],
    );
    expect(
      collectLiveNationalObservation(game, STRANGER.id).observation.assessments,
    ).toEqual([]);
    expect(packet(game, OTHER.clientID!).nationalAssessments?.items).toEqual(
      [],
    );
    expect(game.nationalAssessmentsFor(OTHER.id)).toEqual([]);
  });

  it("rejects forged payer, unpurchased target, repeat request, invalid intent, and insufficient gold without a second debit", async () => {
    const game = await active();
    const buyer = game.player(BUYER.id);
    const other = game.player(OTHER.id);
    buyer.addGold(3000n);
    const before = buyer.gold();
    expect(
      NationalAssessmentIntentSchema.safeParse({
        type: "national_buy_national_assessment",
        targetId: TARGET.id,
        requestId: "malformed",
        payerId: OTHER.id,
      }).success,
    ).toBe(true);
    // A stamped incoming intent never receives payerId from this schema.
    expect(
      NationalAssessmentIntentSchema.parse({
        type: "national_buy_national_assessment",
        targetId: TARGET.id,
        requestId: "schema",
        payerId: OTHER.id,
        cost: 0,
        effectiveTick: 0,
      }),
    ).not.toHaveProperty("payerId");
    expect(
      NationalAssessmentIntentSchema.safeParse({
        type: "national_buy_national_assessment",
        targetId: TARGET.id,
        requestId: "invalid id",
      }).success,
    ).toBe(false);
    expect(() =>
      game.performNationalAssessment(
        buyer,
        TARGET.id,
        "wrong-session",
        OTHER.clientID!,
      ),
    ).toThrow(/stale authenticated/);
    expect(() =>
      game.performNationalAssessment(
        other,
        TARGET.id,
        "also-wrong",
        BUYER.clientID!,
      ),
    ).toThrow(/stale authenticated/);
    expect(() =>
      game.performNationalAssessment(
        buyer,
        BUYER.id,
        "self-target",
        BUYER.clientID!,
      ),
    ).toThrow(/invalid target/);
    expect(buyer.gold()).toBe(before);
    const original = game.performNationalAssessment(
      buyer,
      TARGET.id,
      "idempotent",
      BUYER.clientID!,
    );
    expect(original.targetId).toBe(TARGET.id);
    const once = buyer.gold();
    expect(() =>
      game.performNationalAssessment(
        buyer,
        TARGET.id,
        "idempotent",
        BUYER.clientID!,
      ),
    ).toThrow(/duplicate/);
    expect(buyer.gold()).toBe(once);
    expect(game.nationalAssessmentsFor(BUYER.id)).toHaveLength(1);
    expect(
      game
        .nationalAssessmentsFor(BUYER.id)
        .some((g) => g.targetId === STRANGER.id),
    ).toBe(false);
    buyer.removeGold(buyer.gold());
    expect(() =>
      game.performNationalAssessment(
        buyer,
        STRANGER.id,
        "unfunded",
        BUYER.clientID!,
      ),
    ).toThrow(/insufficient gold/);
    expect(game.nationalAssessmentsFor(BUYER.id)).toHaveLength(1);
  });

  it("shares only through live reciprocal empire, removes inherited report at dissolution, and restores an expired lease without resurrection", async () => {
    const game = await active();
    const buyer = game.player(BUYER.id);
    const ally = game.player(ALLY.id);
    buyer.addGold(2500n);
    const report = game.performNationalAssessment(
      buyer,
      TARGET.id,
      "shared",
      BUYER.clientID!,
    );
    expect(projectLiveNationalAssessments(game, ALLY.id)).toEqual([]);
    game.performNationalCommand(buyer, {
      kind: "found-empire",
      empireId: "assessment-empire",
    });
    game.performNationalCommand(buyer, {
      kind: "offer-empire",
      empireId: "assessment-empire",
      candidateId: ALLY.id,
    });
    game.performNationalCommand(ally, {
      kind: "accept-empire",
      empireId: "assessment-empire",
      candidateId: ALLY.id,
    });
    expect(projectLiveNationalAssessments(game, ALLY.id)[0]?.paidBy).toBe(
      BUYER.id,
    );
    expect(projectLiveNationalAssessments(game, STRANGER.id)).toEqual([]);
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
      expect(projectLiveNationalAssessments(game, ALLY.id)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    game.performNationalImperialAdministration(buyer, {
      kind: "dissolve",
      empireId: "assessment-empire",
    });
    expect(projectLiveNationalAssessments(game, ALLY.id)).toEqual([]);
    expect(projectLiveNationalAssessments(game, BUYER.id)).toHaveLength(1);
    while (game.ticks() < report.expiresAtTick) game.executeNextTick();
    expect(projectLiveNationalAssessments(game, BUYER.id)).toEqual([]);
    const { restored, bytes, again } = await roundTrip(game, "big_plains");
    expect(again).toEqual(bytes);
    expect(restored.nationalAssessmentsFor(BUYER.id)).toEqual([]);
    expect(projectLiveNationalAssessments(restored, BUYER.id)).toEqual([]);
    expect(() =>
      restored.performNationalAssessment(
        restored.player(BUYER.id),
        TARGET.id,
        "shared",
        BUYER.clientID!,
      ),
    ).toThrow(/duplicate/);
  });

  it("preserves a queued authenticated purchase across Game snapshot/replay with a single charge", async () => {
    const game = await active();
    game.player(BUYER.id).addGold(4000n);
    const intent = {
      type: "national_buy_national_assessment" as const,
      targetId: TARGET.id,
      requestId: "queued",
      clientID: BUYER.clientID!,
    };
    game.addExecution(
      new Executor(game, "assessment-queue", BUYER.clientID!).createExec(
        intent,
      ),
    );
    const { restored, bytes, again } = await roundTrip(game, "big_plains");
    expect(again).toEqual(bytes);
    const chargeA = vi.spyOn(game.player(BUYER.id), "removeGold");
    const chargeB = vi.spyOn(restored.player(BUYER.id), "removeGold");
    for (let i = 0; i < 2; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(
      chargeA.mock.calls.filter(([x]) => x === NATIONAL_ASSESSMENT_COST),
    ).toHaveLength(1);
    expect(
      chargeB.mock.calls.filter(([x]) => x === NATIONAL_ASSESSMENT_COST),
    ).toHaveLength(1);
    expect(game.player(BUYER.id).gold()).toBe(restored.player(BUYER.id).gold());
    expect(game.nationalAssessmentsFor(BUYER.id)).toEqual(
      restored.nationalAssessmentsFor(BUYER.id),
    );
    expect(
      collectLiveNationalObservation(game, BUYER.id).observation.assessments,
    ).toEqual(
      collectLiveNationalObservation(restored, BUYER.id).observation
        .assessments,
    );
    chargeA.mockRestore();
    chargeB.mockRestore();
  });

  it("bounds 120-nation independent active ledgers and private report serialization", () => {
    const ledger = new NationalAssessment();
    for (let n = 0; n < 120; n++)
      ledger.buy(
        "payer" + n,
        "target" + n,
        7,
        "r" + n,
        () => {},
        () => {
          throw new Error("unexpected refund");
        },
        () => ({
          treasuryGoldBand: { lower: "12500", upperExclusive: "15000" },
          militaryTroopsBand: { lower: "100000", upperExclusive: "200000" },
        }),
      );
    const start = performance.now();
    const reports = Array.from(
      { length: 120 },
      (_, n) => ledger.activeFor("payer" + n, 7)[0],
    );
    const ms = performance.now() - start;
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        recipientId: "empire-viewer",
        items: reports.map((g) => ({
          targetId: g.targetId,
          paidBy: g.payerId,
          effectiveTick: g.effectiveTick,
          expiresAtTick: g.expiresAtTick,
          treasuryGoldBand: g.treasuryGoldBand,
          militaryTroopsBand: g.militaryTroopsBand,
          confidence: "coarse-estimate",
        })),
      }),
    ).byteLength;
    expect(reports).toHaveLength(120);
    expect(bytes).toBeLessThan(65536);
    expect(ledger.activeFor("payer0", 907)).toEqual([]);
    expect(
      NationalAssessment.restore(ledger.snapshot(), 907).snapshot(),
    ).toEqual(ledger.snapshot());
    console.info(
      "[M7 120 nation assessment] reports=120 bytes=" +
        bytes +
        " ms=" +
        ms.toFixed(3),
    );
  });

  it("binds an original authenticated player in a real Private NATIONAL GameRunner, not another Private seat", async () => {
    const game = await active(true, GameType.Private);
    const buyer = game.player(BUYER.id);
    buyer.addGold(2500n);
    const before = buyer.gold();
    expect(() =>
      game.performNationalAssessment(buyer, TARGET.id, "private-unbound"),
    ).toThrow(/missing authenticated actor session/);
    expect(() =>
      game.performNationalAssessment(
        buyer,
        TARGET.id,
        "private-forged",
        OTHER.clientID!,
      ),
    ).toThrow(/stale authenticated actor session/);
    expect(buyer.gold()).toBe(before);
    const execution = new Executor(
      game,
      "assessment-private",
      BUYER.clientID!,
    ).createExec({
      type: "national_buy_national_assessment",
      targetId: TARGET.id,
      requestId: "private-canonical",
      clientID: BUYER.clientID!,
    });
    game.addExecution(execution);
    const beforeTick = game.ticks();
    game.executeNextTick();
    game.executeNextTick();
    expect(game.ticks()).toBe(beforeTick + 2);
    expect(game.nationalAssessmentsFor(BUYER.id)).toHaveLength(1);
    expect(buyer.gold()).toBeLessThan(before);
    expect(packet(game, OTHER.clientID!).nationalAssessments?.items).toEqual(
      [],
    );
    expect(
      packet(game, BUYER.clientID!).nationalAssessments?.items,
    ).toHaveLength(1);

    // End-to-end trusted host packet whitelist and browser decoder,
    // with a real authenticated principal and its current observer-map page.
    const liveLink = {
      clientID: BUYER.clientID!,
      sessionId: "assessment-real-private-socket",
      isConnected: () => true,
      isSpectator: () => false,
    };
    const session = new NationalServerRecipientSession(game, liveLink);
    const hostFiltered = session.projectGameUpdate(
      packet(game, BUYER.clientID!),
    );
    expect(hostFiltered).not.toBeNull();
    const hostEncoded = encodeNationalRecipientProjection(hostFiltered!);
    const browserDecoded = parseTrustedNationalProjection(
      hostEncoded,
      hostFiltered!.tick,
    );
    expect(browserDecoded.nationalAssessments).toMatchObject({
      recipientId: BUYER.id,
      items: [
        expect.objectContaining({
          targetId: TARGET.id,
          confidence: "coarse-estimate",
        }),
      ],
    });
    expect(hostEncoded).not.toContain('"requestId":"private-canonical"');
    expect(hostEncoded).not.toContain('"cost":"1200"');
    const foreign = new NationalServerRecipientSession(game, {
      ...liveLink,
      clientID: OTHER.clientID!,
      sessionId: "assessment-other-private-socket",
    });
    const foreignFiltered = foreign.projectGameUpdate(
      packet(game, OTHER.clientID!),
    );
    expect(foreignFiltered?.nationalAssessments?.items).toEqual([]);
    expect(
      parseTrustedNationalProjection(
        encodeNationalRecipientProjection(foreignFiltered!),
        foreignFiltered!.tick,
      ).nationalAssessments,
    ).toMatchObject({ recipientId: OTHER.id, items: [] });
    const spectator = new NationalServerRecipientSession(game, {
      clientID: null,
      sessionId: "assessment-spectator-socket",
      isConnected: () => true,
      isSpectator: () => true,
    });
    const spectatorPacket = spectator.projectGameUpdate(
      packet(game, OTHER.clientID!),
    );
    expect(spectatorPacket).not.toHaveProperty("nationalAssessments");
    expect(encodeNationalRecipientProjection(spectatorPacket!)).not.toContain(
      "nationalAssessments",
    );
  });

  it("caps 2048 simultaneous reports before debit and reopens capacity on expiry while preserving replay receipts", () => {
    const ledger = new NationalAssessment();
    let debits = 0;
    const bands = () => ({
      treasuryGoldBand: { lower: "2500", upperExclusive: "5000" },
      militaryTroopsBand: { lower: "100000", upperExclusive: "200000" },
    });
    for (let i = 0; i < 2048; i++) {
      ledger.buy(
        "payer" + i,
        "target" + i,
        10,
        "grant" + i,
        () => {
          debits++;
        },
        () => {
          debits--;
        },
        bands,
      );
    }
    expect(debits).toBe(2048);
    expect(() =>
      ledger.buy(
        "payer2049",
        "target2049",
        10,
        "overCapacity",
        () => {
          debits++;
        },
        () => {
          debits--;
        },
        bands,
      ),
    ).toThrow(/active report capacity/);
    expect(debits).toBe(2048);
    expect(ledger.activeFor("payer0", 910)).toEqual([]);
    const restored = NationalAssessment.restore(ledger.snapshot(), 910);
    expect(restored.activeFor("payer0", 910)).toEqual([]);
    expect(() =>
      restored.buy(
        "payer0",
        "target0",
        910,
        "grant0",
        () => {
          debits++;
        },
        () => {
          debits--;
        },
        bands,
      ),
    ).toThrow(/duplicate/);
    expect(debits).toBe(2048);
    restored.buy(
      "newpayer",
      "newtarget",
      910,
      "reopened",
      () => {
        debits++;
      },
      () => {
        debits--;
      },
      bands,
    );
    expect(debits).toBe(2049);
    expect(restored.activeFor("newpayer", 910)).toHaveLength(1);
  });

  it("leaves ordinary non-NATIONAL FFA without assessment authority", async () => {
    const game = await active(false);
    expect(game.nationalAssessmentsFor(BUYER.id)).toEqual([]);
    expect(() =>
      game.performNationalAssessment(
        game.player(BUYER.id),
        TARGET.id,
        "legacy",
        BUYER.clientID!,
      ),
    ).toThrow(/mode not enabled/);
  });
});
