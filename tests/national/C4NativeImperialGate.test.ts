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
  it("delivers the member-only commercial allocation exactly and rejects hostile wire rates", () => {
    const valid = { ...source, nonWorkerIncomeBps: 3750 };
    expect(
      readNationalImperialAdministration(valid, politics, "a", 8, "epoch")
        ?.nonWorkerIncomeBps,
    ).toBe(3750);
    expect(
      readNationalImperialAdministration(
        { ...valid, recipientId: "b" },
        politics,
        "a",
        8,
        "epoch",
      ),
    ).toBeNull();
    for (const bad of [-1, 10001, 1.5, "3750", null, Infinity, NaN]) {
      expect(
        readNationalImperialAdministration(
          { ...valid, nonWorkerIncomeBps: bad },
          politics,
          "a",
          8,
          "epoch",
        ),
      ).toBeNull();
    }
    const intent = parseImperialCommand(
      {
        kind: "set-policy",
        empireId: "empire",
        policy: {
          workerIncomeBps: 1250,
          nonWorkerIncomeBps: 3750,
          allowedConstruction: null,
        },
      },
      "np_" + "7".repeat(32),
    );
    expect(intent).toMatchObject({
      type: "national_imperial_administration",
      command: { policy: { nonWorkerIncomeBps: 3750 } },
    });
    expect(
      parseImperialCommand(
        {
          kind: "set-policy",
          empireId: "empire",
          policy: {
            workerIncomeBps: 1250,
            nonWorkerIncomeBps: 10001,
            allowedConstruction: null,
          },
        },
        "np_" + "8".repeat(32),
      ),
    ).toBeNull();
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
    expect(
      readNationalImperialAdministration(
        { ...source, ...military, armyMode: "centralized" },
        politics,
        "a",
        8,
        "epoch",
      ),
    ).toMatchObject({ ...military, armyMode: "centralized" });
    for (const bad of [
      { armyMode: "hybrid" },
      { ...military, armyMode: "invalid" },
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
