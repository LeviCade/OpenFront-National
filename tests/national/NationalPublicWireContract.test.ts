import type {
  GameUpdateViewData,
  NationalCommandResultViewData,
  NationalPoliticsViewData,
} from "@openfront/engine-api/game/GameUpdates";
import type { NationalPublicPoliticalView } from "@openfront/engine/national/NationalRuntime";
import { describe, expect, expectTypeOf, it } from "vitest";

const publicView: NationalPublicPoliticalView = {
  empires: [
    { id: "union", leaderId: "north-id", memberIds: ["north-id", "east-id"] },
  ],
  warnings: [
    {
      empireId: "union",
      deadlineMs: 16000,
      remainingMs: 1000,
      blockedByAssetDisposition: false,
    },
  ],
  victory: {
    sovereignPowerCount: 1,
    resolved: true,
    prizes: [
      { kind: "ImperialVictor", nationId: "north-id", empireId: "union" },
      { kind: "EmpireVictor", nationId: "east-id", empireId: "union" },
    ],
  },
};

describe("Round Five public NATIONAL worker wire DTO", () => {
  it("accepts E1 public view exactly without importing private politics", () => {
    expectTypeOf<NationalPublicPoliticalView>().toExtend<NationalPoliticsViewData>();
    const packet: Pick<GameUpdateViewData, "nationalPolitics"> = {
      nationalPolitics: publicView,
    };
    expect(packet.nationalPolitics?.empires[0]?.leaderId).toBe("north-id");
    expect(packet.nationalPolitics?.victory?.prizes).toHaveLength(2);
    expect("troops" in packet.nationalPolitics!.empires[0]).toBe(false);
    expect("treasury" in packet.nationalPolitics!.empires[0]).toBe(false);
  });

  it("models only authenticated recipient-specific outcomes with sanitized reasons", () => {
    const accepted: NationalCommandResultViewData = {
      recipientId: "north-id",
      actorId: "north-id",
      type: "national_found_empire",
      accepted: true,
      tick: 12,
      empireId: "union",
    };
    const rejected: NationalCommandResultViewData = {
      recipientId: "east-id",
      actorId: "east-id",
      type: "national_declare_war",
      accepted: false,
      tick: 13,
      reason: "not_authorized",
    };
    const packet: Pick<GameUpdateViewData, "nationalCommandResults"> = {
      nationalCommandResults: [accepted],
    };
    expect(packet.nationalCommandResults).toEqual([accepted]);
    expect(packet.nationalCommandResults).not.toContain(rejected);
    expectTypeOf<NonNullable<GameUpdateViewData["nationalCommandResults"]>[number]>().toEqualTypeOf<NationalCommandResultViewData>();
  });

  it("keeps legacy FFA packets optional, not fabricated as NATIONAL data", () => {
    const packet: Pick<
      GameUpdateViewData,
      "nationalPolitics" | "nationalCommandResults"
    > = {};
    expect(packet.nationalPolitics).toBeUndefined();
    expect(packet.nationalCommandResults).toBeUndefined();
  });
});
