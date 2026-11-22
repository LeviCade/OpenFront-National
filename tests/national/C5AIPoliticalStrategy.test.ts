import {
  initialAIPoliticalMemory,
  planAIPoliticalInterest,
  recordAIPoliticalOutcome,
} from "@openfront/engine/national/ai/NationalPoliticalStrategy";
import {
  projectNationalObservation,
  type NationalWorld,
} from "@openfront/engine/national/observation/NationalObservation";
import { describe, expect, it } from "vitest";

function politicalWorld(): NationalWorld {
  return {
    tick: 60,
    nations: [
      { id: "alpha", name: "Alpha", landPercent: 0.5, status: "independent", alive: true, controllerKind: "ai", troops: 12_000, treasury: 0 },
      { id: "bravo", name: "Bravo", landPercent: 5, status: "independent", alive: true, controllerKind: "human", troops: 1_000_000, treasury: 99_999 },
      { id: "charlie", name: "Charlie", landPercent: 12, status: "imperial", alive: true, controllerKind: "ai", troops: 900_000, treasury: 900_000 },
    ],
    coalitions: [
      { id: "empire", kind: "empire", leaderId: "charlie", members: ["charlie"], terms: {} },
    ],
    invitations: [],
    imperialOffers: [{ empireId: "empire", candidateId: "alpha", proposerId: "charlie", recipientId: "alpha" }],
    wars: [],
    assets: [{ id: "bravo-army", kind: "army", ownerId: "bravo", x: 55, y: 40, strength: 999_999 }],
    sightGrants: [{ observerId: "alpha", assetId: "bravo-army", source: "border", observedAtTick: 60, expiresAtTick: 60 }],
    frontiers: [{ observerId: "alpha", targetId: "bravo", access: "land" }, { observerId: "charlie", targetId: "bravo", access: "land" }],
    diplomaticEvents: [],
  };
}
function decide(world: NationalWorld, actor = "alpha") {
  return planAIPoliticalInterest(
    projectNationalObservation(world, actor),
    initialAIPoliticalMemory(),
    25,
  ).decision;
}

describe("C5 E4 political sovereignty and FOG (AI-01/03/04/05/06, COAL-01..06)", () => {
  it("AI-01 ignores opponent human controller and hidden troop wealth", () => {
    const world = politicalWorld();
    const swapped: NationalWorld = {
      ...world,
      nations: world.nations.map((n) => ({
        ...n,
        controllerKind: n.controllerKind === "human" ? "ai" : "human",
        troops: n.id === "bravo" ? 1 : n.troops,
        treasury: n.id === "bravo" ? 0 : n.treasury,
      })),
      assets: world.assets.map((a) => ({ ...a, strength: 1 })),
    };
    expect(decide(swapped)).toEqual(decide(world));
  });

  it("AI-04 accepts an addressed empire offer under a real observed existential threat", () => {
    expect(decide(politicalWorld())).toEqual({
      command: { kind: "accept-empire", empireId: "empire", candidateId: "alpha" },
      reason: "accept-safe-empire",
    });
  });

  it("AI-04 preserves a viable small sovereign with open neutral land instead of auto-submitting", () => {
    const world: NationalWorld = {
      ...politicalWorld(),
      unownedFrontier: true,
      sightGrants: [],
    };
    expect(decide(world)).toEqual({
      command: null,
      reason: "preserve-independence",
    });
  });

  it("COAL-01/02 accepts constitutionally approved NAP invitations", () => {
    const world: NationalWorld = {
      ...politicalWorld(),
      imperialOffers: [],
      sightGrants: [],
      coalitions: [{
        id: "nap_a",
        kind: "nap",
        leaderId: "bravo",
        members: ["bravo"],
        terms: { admission: "leader", expulsion: "forbidden" },
      }],
      invitations: [{ coalitionId: "nap_a", recipientId: "alpha" }],
    };
    expect(decide(world)).toEqual({
      command: { kind: "accept-pact", pactId: "nap_a" },
      reason: "accept-nonaggression",
    });
  });

  it("AI-03 refuses discredited MDA invitations instead of automatic pact admission", () => {
    const w = politicalWorld();
    const observation = projectNationalObservation({
      ...w,
      imperialOffers: [],
      sightGrants: [],
      coalitions: [{
        id: "mda_b",
        kind: "mda",
        leaderId: "bravo",
        members: ["bravo"],
        terms: { admission: "leader", expulsion: "forbidden" },
      }],
      invitations: [{ coalitionId: "mda_b", recipientId: "alpha" }],
    }, "alpha");
    const decision = planAIPoliticalInterest(
      observation,
      initialAIPoliticalMemory(),
      25,
      [{ nationId: "bravo", credibility: -5 }],
    );
    expect(decision.decision?.command?.kind).not.toBe("accept-pact");
    expect(decision.decision?.command?.kind).not.toBe("accept-empire");
  });

  it("COAL-05 makes Betray an explicit prior command before any protected attack", () => {
    const world: NationalWorld = {
      ...politicalWorld(),
      imperialOffers: [],
      sightGrants: [],
      nations: politicalWorld().nations.map((n) =>
        n.id === "alpha" ? { ...n, landPercent: 9, troops: 100_000 } :
        n.id === "bravo" ? { ...n, landPercent: 1 } : n),
      coalitions: [{
        id: "nap_a",
        kind: "nap",
        leaderId: "alpha",
        members: ["alpha", "bravo"],
        terms: { admission: "leader", expulsion: "forbidden" },
      }],
      unownedFrontier: false,
    };
    expect(decide(world)).toEqual({
      command: { kind: "betray-pact", pactId: "nap_a" },
      reason: "renounce-hostile-pact",
    });
  });

  it("AI-06 imperial members serve the empire without attempting secession", () => {
    const w = politicalWorld();
    const world: NationalWorld = {
      ...w,
      nations: w.nations.map((n) =>
        n.id === "alpha" ? { ...n, status: "member" as const } : n),
      coalitions: [{
        id: "empire",
        kind: "empire",
        leaderId: "charlie",
        members: ["alpha", "charlie"],
        terms: {},
      }],
      imperialOffers: [],
    };
    expect(decide(world)).toEqual({ command: null, reason: "serve-empire" });
  });

  it("AI-06 incumbent emperor offers real recruitment when a public neighbor is viable", () => {
    const world: NationalWorld = { ...politicalWorld(), imperialOffers: [] };
    expect(decide(world, "charlie")).toEqual({
      command: { kind: "offer-empire", empireId: "empire", candidateId: "bravo" },
      reason: "recruit-imperial-member",
    });
  });

  it("recipient-only offers, pact private terms, and pending invitees never leak", () => {
    const world: NationalWorld = {
      ...politicalWorld(),
      coalitions: [{
        id: "nap_a",
        kind: "nap",
        leaderId: "alpha",
        members: ["alpha"],
        terms: { admission: "unanimous", expulsion: "forbidden" },
        pendingInvitees: ["bravo"],
      }],
    };
    const alpha = projectNationalObservation(world, "alpha");
    const bravo = projectNationalObservation(world, "bravo");
    expect(alpha.imperialOffers).toHaveLength(1);
    expect(bravo.imperialOffers).toEqual([]);
    expect(alpha.coalitions[0].terms).toEqual({ admission: "unanimous", expulsion: "forbidden" });
    expect(alpha.coalitions[0].pendingInvitees).toEqual(["bravo"]);
    expect(bravo.coalitions[0]).not.toHaveProperty("terms");
    expect(bravo.coalitions[0]).not.toHaveProperty("pendingInvitees");
  });

  it("political outcome memory is principal-bound, bounded, and deterministic on JSON replay", () => {
    const world = politicalWorld();
    const observation = projectNationalObservation(world, "alpha");
    const command = { kind: "offer-empire" as const, empireId: "empire", candidateId: "alpha" };
    const first = recordAIPoliticalOutcome(observation, initialAIPoliticalMemory(), command, {
      sequence: 8,
      requestId: "real-authoritative",
      actorId: "alpha",
      recipientId: "alpha",
      empireId: "empire",
      commandTargetId: "empire",
      commandKind: "offer-empire",
      tick: 60,
      accepted: true,
      reason: "accepted",
    });
    expect(first.completedCommands).toHaveLength(1);
    const saved = JSON.parse(JSON.stringify(first));
    expect(
      planAIPoliticalInterest({ ...observation, tick: 90, imperialOffers: [] }, saved, 25),
    ).toEqual(
      planAIPoliticalInterest({ ...observation, tick: 90, imperialOffers: [] }, first, 25),
    );
    expect(() => recordAIPoliticalOutcome(observation, first, command, {
      sequence: 9, requestId: "foreign", actorId: "bravo", recipientId: "bravo",
      empireId: "empire", commandTargetId: "empire", commandKind: "offer-empire",
      tick: 60, accepted: true, reason: "accepted",
    })).toThrow(/nonprincipal/);
  });
});
