import { describe, expect, it } from "vitest";
import { parseNationalReconnaissanceIntent } from "../../../src/client/NationalReconPurchase";

const valid = Object.freeze({
  type: "national_buy_regional_recon" as const,
  targetId: "Target123",
  centerX: 210,
  centerY: 185,
  requestId: "np_" + "a".repeat(32),
});

describe("C5 Third Class conductor — canonical paid recon client ingress", () => {
  it("accepts only the existing real regional reconnaissance intent", () => {
    expect(parseNationalReconnaissanceIntent(valid)).toEqual(valid);
    expect(parseNationalReconnaissanceIntent(valid)).not.toBe(valid);
  });

  it("rejects actor, payer, price, duration and scope injection at the client ingress", () => {
    for (const injected of [
      { actorId: "nation-a" },
      { payerId: "nation-c" },
      { price: 0 },
      { durationTicks: 99999 },
      { radius: 9999 },
      { empireId: "empire" },
    ])
      expect(parseNationalReconnaissanceIntent({ ...valid, ...injected })).toBeNull();
  });

  it("rejects malformed targets, coordinates and request identity", () => {
    for (const malformed of [
      { targetId: "" },
      { targetId: 33 },
      { centerX: -1 },
      { centerY: 65_536 },
      { centerX: NaN },
      { centerX: Infinity },
      { centerY: 1.5 },
      { requestId: "bad space" },
      { requestId: null },
      { type: "national_imperial_administration" },
    ])
      expect(parseNationalReconnaissanceIntent({ ...valid, ...malformed })).toBeNull();
  });

  it("rejects legacy envelopes, null and prototype-free malformed commands", () => {
    for (const malformed of [
      null,
      undefined,
      [],
      "",
      0,
      { intent: valid },
      Object.create(null),
    ])
      expect(parseNationalReconnaissanceIntent(malformed)).toBeNull();
  });

  it("never mutates a request supplied by the native panel", () => {
    const incoming = Object.freeze({ ...valid });
    const accepted = parseNationalReconnaissanceIntent(incoming);
    expect(accepted).toEqual(incoming);
    expect(Object.keys(accepted ?? {}).sort()).toEqual(Object.keys(incoming).sort());
    expect(Object.isFrozen(incoming)).toBe(true);
  });
});
