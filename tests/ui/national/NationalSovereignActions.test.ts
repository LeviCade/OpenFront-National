import {
  NATIONAL_RECON_COST,
  NATIONAL_RECON_DURATION_TICKS,
  NATIONAL_RECON_RADIUS,
} from "@openfront/engine-api/game/NationalReconView";
import { describe, expect, it } from "vitest";
import {
  REGIONAL_RECON_COST,
  REGIONAL_RECON_DURATION_TICKS,
  REGIONAL_RECON_RADIUS,
} from "../../../packages/engine/src/national/observation/NationalReconnaissance";
import {
  nationalReconQuote,
  parseNationalUltimatumIntent,
  readNationalUltimatumView,
  readNationalReconnaissanceView,
} from "../../../src/client/NationalSovereignActions";

const requestId = "np_" + "b".repeat(32);
const issuerRow = {
  id: "ultimatum-20-2-5",
  issuerId: "nation-a",
  empireId: "empire-a",
  targetId: "nation-b",
  role: "issuer" as const,
  threat: "embargo" as const,
  issuedTick: 20,
  deadlineTick: 320,
  phase: "pending" as const,
  response: "none" as const,
  credibility: "pending" as const,
  version: 1,
  warId: null,
  imposedMembers: [] as string[],
  requestId,
  acknowledgedRequestIds: [] as string[],
};
const grant = {
  requestId,
  targetId: "nation-b",
  centerX: 10,
  centerY: 20,
  radius: 90 as const,
  cost: "500" as const,
  effectiveTick: 20,
  expiresAtTick: 620,
};

describe("C5 Class Three E1 canonical human commands and recipient privacy", () => {
  it("displays the exact Game-owned price, radius and lease constants", () => {
    expect(nationalReconQuote).toEqual({
      cost: 500n,
      radius: 90,
      durationTicks: 600,
    });
    expect(NATIONAL_RECON_COST).toBe(REGIONAL_RECON_COST);
    expect(NATIONAL_RECON_RADIUS).toBe(REGIONAL_RECON_RADIUS);
    expect(NATIONAL_RECON_DURATION_TICKS).toBe(REGIONAL_RECON_DURATION_TICKS);
  });

  it("rejects all extras, impersonation fields, malformed IDs, and invalid actions", () => {
    const good = {
      type: "national_issue_ultimatum",
      empireId: "empire-a",
      targetId: "nation-b",
      threat: "embargo",
      durationTicks: 300,
      requestId,
    };
    expect(parseNationalUltimatumIntent(good)).toEqual(good);
    for (const extra of [
      { actorId: "nation-b" },
      { issuerId: "nation-b" },
      { payerId: "nation-b" },
      { cost: 0 },
      { clientID: "forged" },
      { unauthorizedDisclosure: { hidden: true } },
    ]) {
      expect(parseNationalUltimatumIntent({ ...good, ...extra })).toBeNull();
    }
    for (const invalid of [
      { ...good, targetId: "" },
      { ...good, requestId: "fake" },
      { ...good, durationTicks: 0 },
      { ...good, durationTicks: 9000 },
      { ...good, threat: "instant-annexation" },
      {
        type: "national_respond_ultimatum",
        ultimatumId: issuerRow.id,
        decision: "approve",
        requestId,
      },
      {
        type: "national_resolve_ultimatum",
        ultimatumId: issuerRow.id,
        decision: "annex",
        requestId,
      },
      null,
      [],
      "national_issue_ultimatum",
    ]) {
      expect(parseNationalUltimatumIntent(invalid)).toBeNull();
    }
    expect(
      parseNationalUltimatumIntent({
        type: "national_respond_ultimatum",
        ultimatumId: issuerRow.id,
        decision: "refuse",
        requestId,
      }),
    ).not.toBeNull();
    expect(
      parseNationalUltimatumIntent({
        type: "national_resolve_ultimatum",
        ultimatumId: issuerRow.id,
        decision: "enforce",
        requestId,
      }),
    ).not.toBeNull();
  });

  it("only reads exact private issuer or recipient data on an authorized tick", () => {
    const packet = { version: 1, recipientId: "nation-a", items: [issuerRow] };
    expect(readNationalUltimatumView(packet, "nation-a", 21)?.items[0].id).toBe(
      issuerRow.id,
    );
    expect(readNationalUltimatumView(packet, "nation-c", 21)).toBeNull();
    expect(readNationalUltimatumView(packet, "nation-a", 19)).toBeNull();
    expect(
      readNationalUltimatumView(
        {
          ...packet,
          items: [{ ...issuerRow, role: "recipient" }],
        },
        "nation-a",
        21,
      ),
    ).toBeNull();
    expect(
      readNationalUltimatumView(
        {
          ...packet,
          items: [{ ...issuerRow, acknowledgedRequestIds: ["np_fake"] }],
        },
        "nation-a",
        21,
      ),
    ).toBeNull();
    expect(
      readNationalUltimatumView(
        {
          ...packet,
          items: [issuerRow, issuerRow],
        },
        "nation-a",
        21,
      ),
    ).toBeNull();
    const recipient = { ...issuerRow, role: "recipient", requestId: null };
    expect(
      readNationalUltimatumView(
        {
          version: 1,
          recipientId: "nation-b",
          items: [recipient],
        },
        "nation-b",
        21,
      ),
    ).not.toBeNull();
    expect(
      readNationalUltimatumView(
        {
          version: 1,
          recipientId: "nation-b",
          items: [issuerRow],
        },
        "nation-b",
        21,
      ),
    ).toBeNull();
  });

  it("a private gold lease is a receipt only while it is active and belongs to the player", () => {
    const view = {
      version: 1,
      recipientId: "nation-a",
      tick: 30,
      grants: [grant],
    };
    expect(
      readNationalReconnaissanceView(view, "nation-a", 30)?.grants[0].cost,
    ).toBe("500");
    expect(readNationalReconnaissanceView(view, "nation-c", 30)).toBeNull();
    expect(readNationalReconnaissanceView(view, "nation-a", 29)).toBeNull();
    expect(
      readNationalReconnaissanceView({ ...view, tick: 620 }, "nation-a", 620),
    ).toBeNull();
    expect(
      readNationalReconnaissanceView(
        {
          ...view,
          grants: [{ ...grant, cost: "0" }],
        },
        "nation-a",
        30,
      ),
    ).toBeNull();
    expect(
      readNationalReconnaissanceView(
        {
          ...view,
          grants: [{ ...grant, expiresAtTick: 621 }],
        },
        "nation-a",
        30,
      ),
    ).toBeNull();
    expect(
      readNationalReconnaissanceView(
        {
          ...view,
          grants: [grant, grant],
        },
        "nation-a",
        30,
      ),
    ).toBeNull();
  });
});
