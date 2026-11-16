import {
  planNationalInterest,
  initialNationalPlannerMemory,
} from "@openfront/engine/national/ai/NationalPlanner";
import {
  projectNationalObservation,
  type NationalWorld,
} from "@openfront/engine/national/observation/NationalObservation";

describe("NATIONAL observation and planning performance", () => {
  it("reports deterministic throughput on a large synthetic world", () => {
    const count = 8000;
    const world: NationalWorld = {
      tick: 40,
      nations: Array.from({ length: 200 }, (_, i) => ({
        id: "n" + i,
        name: "Nation " + i,
        landPercent: 0.5,
        status: "independent" as const,
        alive: true,
        troops: 900 + i,
        treasury: 200 + i,
      })),
      coalitions: [],
      wars: [],
      invitations: [],
      assets: Array.from({ length: count }, (_, i) => ({
        id: "asset-" + i,
        ownerId: "n" + (i % 200),
        kind: "warship" as const,
        x: i % 900,
        y: Math.floor(i / 900),
        strength: i * 10,
      })),
      sightGrants: Array.from({ length: 1000 }, (_, i) => ({
        observerId: "n0",
        assetId: "asset-" + i,
        source: "warship" as const,
        observedAtTick: 40,
        expiresAtTick: 40,
      })),
      frontiers: Array.from({ length: 199 }, (_, i) => ({
        observerId: "n0",
        targetId: "n" + (i + 1),
        access: "land" as const,
      })),
      diplomaticEvents: [],
    };
    const iterations = 20;
    const start = performance.now();
    let sightCount = 0;
    for (let i = 0; i < iterations; i++) {
      const observed = projectNationalObservation(world, "n0");
      sightCount += observed.visibleAssets.length;
      const plan = planNationalInterest(
        observed,
        initialNationalPlannerMemory("n0"),
        60,
      );
      expect(plan.decision?.targetId).not.toBeNull();
    }
    const elapsed = performance.now() - start;
    expect(sightCount).toBe(iterations * (1000 + 40 - 5));
    console.info(
      "[NATIONAL perf] " +
        iterations +
        " projections+plans; nations=200; assets=" +
        count +
        "; sightGrants=1000; elapsedMs=" +
        elapsed.toFixed(2) +
        "; averageMs=" +
        (elapsed / iterations).toFixed(3),
    );
  });
});
