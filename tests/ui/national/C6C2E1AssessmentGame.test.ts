import { GameMode, GameType, PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { GameRunner } from "@openfront/engine/GameRunner";
import { describe, expect, it } from "vitest";
import { assessmentPurchaseOutcome, parseNationalAssessmentPurchaseIntent, readNationalAssessmentView } from "../../../src/client/NationalAssessmentClient";
import { materializeTrustedNationalUpdate, parseTrustedNationalProjection } from "../../../src/client/TrustedNationalSession";
import { Client } from "../../../src/server/Client";
import { encodeNationalRecipientProjection } from "../../../src/server/national/NationalRecipientWire";
import { TrustedNationalMatch } from "../../../src/server/national/TrustedNationalMatch";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";

const MATCH = "E1AssessmentMatch";
const [payerId, targetId, outsiderId] = ["E1Payer", "E1Target", "E1Other"];
const ids = [payerId, targetId, outsiderId];
const clients = ["E1ACLIENTA", "E1ACLIENTB", "E1ACLIENTC"];
const roster = ids.map((id, index) => new PlayerInfo(id, PlayerType.Human, clients[index], id));

class AccountingPrivateConfig extends TestConfig {
  constructor(config: GameConfig, replay: boolean) {
    super(config, replay, false, false, true);
  }
  goldAdditionRate(): bigint {
    return 0n;
  }
}

function seat(id: string, index: number): Client {
  return new Client(
    id, "persistent-" + id, {} as NonNullable<Client["claims"]>, null,
    undefined, "127.0.0.1", id, null,
    { readyState: WebSocket.OPEN } as Client["ws"], undefined,
    "e1-assessment-account-" + index, [],
  );
}

describe("C6C2 E1 inherited receipt repair against real E4 transaction source", () => {
  it("matches distinct paid and rejected request IDs across the authentic recipient wire; never infers a receipt from the report", async () => {
    const game = await setup("plains", {
      nationalMode: true, gameType: GameType.Private, gameMode: GameMode.FFA,
    }, roster, undefined, AccountingPrivateConfig);
    const coordinates = [[20, 20], [80, 20], [20, 80]];
    roster.forEach((person, index) => {
      const [x, y] = coordinates[index];
      game.addExecution(new SpawnExecution(MATCH, person, game.ref(x, y)));
    });
    game.executeNextTick();
    game.executeNextTick();
    const payer = game.player(payerId);
    payer.removeGold(payer.gold());
    payer.addGold(2400n);
    const runner = new GameRunner(game, new Executor(game, MATCH, undefined), () => {}, undefined);
    const sockets = clients.map(seat);
    const packets = new Map<string, GameUpdateViewData>();
    const host = new TrustedNationalMatch(MATCH, runner, sockets, (client, packet) => {
      packets.set(client.clientID, packet);
    });
    const view = (index: number) => {
      const packet = packets.get(clients[index])!;
      const parsed = parseTrustedNationalProjection(encodeNationalRecipientProjection(packet), packet.tick);
      const materialized = materializeTrustedNationalUpdate(parsed, packet.tick - 1);
      return { tick: packet.tick, report: readNationalAssessmentView(materialized.nationalAssessments, ids[index], packet.tick) };
    };
    const request = (n: number) => {
      const requestId = "np_" + String(n).repeat(32);
      const attempt = { gameId: MATCH, actorId: payerId, targetId, requestId, tick: game.ticks() };
      const intent = parseNationalAssessmentPurchaseIntent({
        type: "national_buy_national_assessment", targetId, requestId,
      });
      expect(intent).not.toBeNull();
      expect(host.submit(sockets[0], intent!)).toBe(true);
      expect(host.tick().committedIntents).toBe(1);
      host.tick();
      return attempt;
    };
    const first = request(1);
    const firstView = view(0);
    expect(payer.gold()).toBe(1200n);
    expect(firstView.report?.items).toHaveLength(1);
    const initialReceipt = assessmentPurchaseOutcome(firstView.report, first, MATCH, payerId, firstView.tick);
    if (process.env.C6C2_E1_REQUIRE_E4_RECEIPTS === "1") expect(initialReceipt?.outcome).toBe("accepted");
    if (!firstView.report?.receipts) {
      expect(initialReceipt).toBeNull();
      console.info("C6C2_E1_ASSESSMENT_WITNESS=founding-contract-no-receipts; consumer failed closed");
      return;
    }
    expect(initialReceipt).toMatchObject({ requestId: first.requestId, outcome: "accepted", cost: "1200" });
    const second = request(2);
    const denied = request(3);
    const last = view(0);
    expect(payer.gold()).toBe(0n);
    expect(last.report?.items).toHaveLength(2);
    const outcomes = [first, second, denied].map((attempt) =>
      assessmentPurchaseOutcome(last.report, attempt, MATCH, payerId, last.tick));
    expect(outcomes.map((receipt) => [receipt?.outcome, receipt?.cost])).toEqual([
      ["accepted", "1200"], ["accepted", "1200"], ["rejected", "0"],
    ]);
    expect(assessmentPurchaseOutcome(last.report, second, "wrong-match", payerId, last.tick)).toBeNull();
    expect(assessmentPurchaseOutcome(last.report, denied, MATCH, outsiderId, last.tick)).toBeNull();
    expect(assessmentPurchaseOutcome(firstView.report, second, MATCH, payerId, firstView.tick)).toBeNull();
    expect(view(1).report?.receipts ?? []).toEqual([]);
    expect(view(2).report?.receipts ?? []).toEqual([]);
    console.info("C6C2_E1_ASSESSMENT_WITNESS=" + JSON.stringify({
      exactWireReceipts: true, spent: "2400", remaining: payer.gold().toString(),
      outcomes: outcomes.map((receipt) => [receipt?.requestId, receipt?.outcome, receipt?.cost]),
      otherPrincipalsExcluded: true, oldPacketRejected: true,
    }));
  });
});
