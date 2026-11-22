import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  readNationalImperialAdministration,
  validateNationalImperialPacket,
} from "@openfront/engine-api/game/NationalImperialView";
import { describe, expect, it } from "vitest";
import {
  imperialPolicyIntentAvailable,
  imperialPolicyKey,
  parseImperialCommand,
} from "../../src/client/NationalImperialState";

describe("C4 E4 imperial administration recipient boundary", () => {
  const politics = {
    empires: [{ id: "empire", leaderId: "a", memberIds: ["a", "b"] }],
  };
  const source = {
    version: 1,
    recipientId: "a",
    tick: 8,
    streamId: "epoch",
    empireId: "empire",
    workerIncomeBps: 1250,
    allowedConstruction: [UnitType.Warship],
    treasury: "900719925474099399",
    canAmend: true,
  };
  it("accepts current member policy and preserves exact treasury; detaches the construction array", () => {
    const result = readNationalImperialAdministration(
      source,
      politics,
      "a",
      8,
      "epoch",
    )!;
    expect(result.treasury).toBe(source.treasury);
    expect(result.allowedConstruction).not.toBe(source.allowedConstruction);
    expect(result.canAmend).toBe(true);
    expect(
      readNationalImperialAdministration(
        { ...source, recipientId: "b", canAmend: false },
        politics,
        "b",
        8,
        "epoch",
      )?.canAmend,
    ).toBe(false);
    expect(() =>
      validateNationalImperialPacket(undefined, politics, null, 8),
    ).not.toThrow();
  });
  it("readies the exact E1 hybrid reserve fields without numeric coercion", () => {
    const military = {
      armyMode: "hybrid",
      hybridThresholdBps: 6000,
      imperialTroops: "900719925474099399",
      imperialTroopCapacity: "900719925474099400",
    };
    expect(
      readNationalImperialAdministration(
        { ...source, ...military },
        politics,
        "a",
        8,
        "epoch",
      ),
    ).toMatchObject(military);
    for (const bad of [
      { armyMode: "hybrid" },
      { ...military, armyMode: "centralized" },
      { ...military, armyMode: "decentralized" },
      { ...military, imperialTroops: -1 },
      { ...military, hybridThresholdBps: 10001 },
    ])
      expect(
        readNationalImperialAdministration(
          { ...source, ...bad },
          politics,
          "a",
          8,
          "epoch",
        ),
      ).toBeNull();
  });
  it("offers stamped policy only when the canonical E1 schema exists, never for subordinates", () => {
    const view = readNationalImperialAdministration(
      source,
      politics,
      "a",
      8,
      "epoch",
    )!;
    const command = {
      kind: "set-policy",
      empireId: "empire",
      policy: {
        workerIncomeBps: 1250,
        allowedConstruction: [UnitType.Warship],
      },
    } as const;
    const parsed = parseImperialCommand(
      {
        ...command,
        policy: {
          ...command.policy,
          allowedConstruction: [...command.policy.allowedConstruction],
        },
      },
      "np_" + "3".repeat(32),
    );
    if (process.env.NATIONAL_C4_REQUIRE_PACT_READ === "1")
      expect(parsed).not.toBeNull();
    expect(imperialPolicyIntentAvailable(view, "set-policy")).toBe(
      parsed !== null,
    );
    expect(
      imperialPolicyIntentAvailable({ ...view, canAmend: false }, "set-policy"),
    ).toBe(false);
    expect(imperialPolicyKey(view)).toBe(
      imperialPolicyKey({ ...view, treasury: "12" }),
    );
    expect(imperialPolicyKey(view)).not.toBe(
      imperialPolicyKey({ ...view, workerIncomeBps: 999 }),
    );
  });
  it("rejects stale epochs, outsiders, superseded leaders and hostile values", () => {
    for (const bad of [
      { ...source, recipientId: "b" },
      { ...source, tick: 7 },
      { ...source, streamId: "previous" },
      { ...source, canAmend: false },
      { ...source, workerIncomeBps: 10001 },
      { ...source, treasury: "-2" },
      { ...source, allowedConstruction: ["invalid"] },
      { ...source, allowedConstruction: [UnitType.Warship, UnitType.Warship] },
      { ...source, hidden: { terms: "secret" } },
    ])
      expect(() =>
        validateNationalImperialPacket(bad, politics, "a", 8, "epoch"),
      ).toThrow();
    expect(
      readNationalImperialAdministration(source, politics, null, 8, "epoch"),
    ).toBeNull();
    expect(
      readNationalImperialAdministration(
        source,
        { empires: [] },
        "a",
        8,
        "epoch",
      ),
    ).toBeNull();
    expect(
      readNationalImperialAdministration(
        { ...source, recipientId: "b" },
        politics,
        "b",
        8,
        "epoch",
      ),
    ).toBeNull();
  });
});
