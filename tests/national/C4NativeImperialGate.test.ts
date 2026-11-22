import { describe, expect, it } from "vitest";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { readNationalImperialAdministration, validateNationalImperialPacket } from "@openfront/engine-api/game/NationalImperialView";

describe("C4 E4 imperial administration recipient boundary", () => {
  const politics = { empires: [{ id: "empire", leaderId: "a", memberIds: ["a", "b"] }] };
  const source = { version: 1, recipientId: "a", tick: 8, streamId: "epoch", empireId: "empire", workerIncomeBps: 1250, allowedConstruction: [UnitType.Warship], treasury: "900719925474099399", canAmend: true };
  it("accepts current member policy and preserves exact treasury; detaches the construction array", () => {
    const result = readNationalImperialAdministration(source, politics, "a", 8, "epoch")!;
    expect(result.treasury).toBe(source.treasury);
    expect(result.allowedConstruction).not.toBe(source.allowedConstruction);
    expect(result.canAmend).toBe(true);
    expect(readNationalImperialAdministration({ ...source, recipientId: "b", canAmend: false }, politics, "b", 8, "epoch")?.canAmend).toBe(false);
    expect(() => validateNationalImperialPacket(undefined, politics, null, 8)).not.toThrow();
  });
  it("rejects stale epochs, outsiders, superseded leaders and hostile values", () => {
    for (const bad of [
      { ...source, recipientId: "b" }, { ...source, tick: 7 }, { ...source, streamId: "previous" },
      { ...source, canAmend: false }, { ...source, workerIncomeBps: 10001 }, { ...source, treasury: "-2" },
      { ...source, allowedConstruction: ["invalid"] }, { ...source, allowedConstruction: [UnitType.Warship, UnitType.Warship] },
      { ...source, hidden: { terms: "secret" } },
    ]) expect(() => validateNationalImperialPacket(bad, politics, "a", 8, "epoch")).toThrow();
    expect(readNationalImperialAdministration(source, politics, null, 8, "epoch")).toBeNull();
    expect(readNationalImperialAdministration(source, { empires: [] }, "a", 8, "epoch")).toBeNull();
    expect(readNationalImperialAdministration({ ...source, recipientId: "b" }, politics, "b", 8, "epoch")).toBeNull();
  });
});
