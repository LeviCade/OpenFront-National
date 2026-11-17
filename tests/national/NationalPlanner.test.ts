import {
  planNationalInterest,
  initialNationalPlannerMemory,
} from "@openfront/engine/national/ai/NationalPlanner";
import {
  projectNationalObservation,
  type NationalWorld,
} from "@openfront/engine/national/observation/NationalObservation";

function situation(): NationalWorld {
  return {
    tick: 50,
    nations: [
      {
        id: "self",
        name: "Self",
        landPercent: 0.4,
        status: "independent",
        alive: true,
        troops: 2000,
        treasury: 20,
        controllerKind: "ai",
      },
      {
        id: "neighbor",
        name: "Neighbor",
        landPercent: 2,
        status: "independent",
        alive: true,
        troops: 900000,
        treasury: 900000,
        controllerKind: "human",
      },
      {
        id: "leader",
        name: "Leader",
        landPercent: 78,
        status: "imperial",
        alive: true,
        troops: 500000,
        treasury: 4000000,
      },
    ],
    coalitions: [
      {
        id: "empire",
        kind: "empire",
        leaderId: "leader",
        members: ["leader"],
        terms: { taxRate: 9 },
      },
    ],
    wars: [],
    invitations: [{ coalitionId: "empire", recipientId: "self" }],
    assets: [
      {
        id: "secret-tank",
        ownerId: "neighbor",
        kind: "army",
        x: 900,
        y: 800,
        strength: 50000,
      },
    ],
    sightGrants: [],
    frontiers: [{ observerId: "self", targetId: "neighbor", access: "land" }],
    diplomaticEvents: [],
  };
}

describe("NATIONAL independent strategic planner", () => {
  it("AI-01 / FOG-07 disregards human identity and hidden force counts", () => {
    const w = situation();
    const first = planNationalInterest(
      projectNationalObservation(w, "self"),
      initialNationalPlannerMemory("self"),
      60,
    );
    const swapped = planNationalInterest(
      projectNationalObservation(
        {
          ...w,
          nations: w.nations.map((n) => ({
            ...n,
            controllerKind:
              n.controllerKind === "human"
                ? ("ai" as const)
                : ("human" as const),
            troops: n.id === "neighbor" ? 1 : n.troops,
          })),
          assets: w.assets.map((a) => ({ ...a, strength: 9999999 })),
        },
        "self",
      ),
      initialNationalPlannerMemory("self"),
      60,
    );
    expect(swapped).toEqual(first);
  });

  it("AI-02 prefers a plausible local opportunity over unreachable giant", () => {
    const result = planNationalInterest(
      projectNationalObservation(situation(), "self"),
      initialNationalPlannerMemory("self"),
      60,
    );
    expect(result.decision?.objective).toBe("expand");
    expect(result.decision?.targetId).toBe("neighbor");
    expect(result.decision?.rationale).toBe("reachable-opportunity");
  });

  it("AI-04 never mechanically submits a tiny independent nation to an empire", () => {
    const w = situation();
    const result = planNationalInterest(
      projectNationalObservation({ ...w, frontiers: [] }, "self"),
      initialNationalPlannerMemory("self"),
      60,
    );
    expect(result.decision).toEqual({
      objective: "consolidate",
      targetId: null,
      score: 0,
      rationale: "preserve-options",
    });
    expect(result.memory.objective).toBe("consolidate");
  });

  it("bounded planning cadence and observed events can trigger replanning", () => {
    const w = situation();
    const initial = planNationalInterest(
      projectNationalObservation(w, "self"),
      initialNationalPlannerMemory("self"),
      40,
    );
    expect(initial.memory.nextPlanningTick).toBe(90);
    const skipped = planNationalInterest(
      projectNationalObservation({ ...w, tick: 60 }, "self"),
      initial.memory,
      40,
    );
    expect(skipped.planned).toBe(false);
    const triggered = planNationalInterest(
      projectNationalObservation(
        {
          ...w,
          tick: 61,
          diplomaticEvents: [
            {
              id: "evt-1",
              actorId: "neighbor",
              tick: 61,
              kind: "bluff-exposed",
              public: true,
            },
          ],
        },
        "self",
      ),
      skipped.memory,
      40,
    );
    expect(triggered.planned).toBe(true);
    expect(triggered.memory.reputation).toEqual([
      { nationId: "neighbor", credibility: -3, lastObservedTick: 61 },
    ]);
    const again = planNationalInterest(
      projectNationalObservation(
        {
          ...w,
          tick: 62,
          diplomaticEvents: [
            {
              id: "evt-1",
              actorId: "neighbor",
              tick: 61,
              kind: "bluff-exposed",
              public: true,
            },
          ],
        },
        "self",
      ),
      triggered.memory,
      40,
    );
    expect(again.planned).toBe(false);
    expect(again.memory.lastProcessedEvent).toEqual({ tick: 61, id: "evt-1" });
    expect(again.memory.reputation).toEqual([
      { nationId: "neighbor", credibility: -3, lastObservedTick: 61 },
    ]);
  });

  it("rejects another nation's memory and invalid cadence", () => {
    const view = projectNationalObservation(situation(), "self");
    expect(() =>
      planNationalInterest(view, initialNationalPlannerMemory("neighbor"), 20),
    ).toThrow();
    expect(() =>
      planNationalInterest(view, initialNationalPlannerMemory("self"), 0),
    ).toThrow();
  });
});
