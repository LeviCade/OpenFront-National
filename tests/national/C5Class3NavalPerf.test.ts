import { planObservedNationalNavalTargets } from "@openfront/engine/national/ai/NationalNavalStrategy";
import {
  projectNationalObservation,
  type NationalWorld,
} from "@openfront/engine/national/observation/NationalObservation";
import { describe, expect, it } from "vitest";

/**
 * Stress the recipient projection AND the NAVAL planner. The world is a
 * 100-sovereign public-war fixture; only 100 actual sight grants per observer
 * reveal ship tracks. Planning never accesses foreign Game state.
 */
describe("C5 E6 bounded naval planning on 100 independent nations", () => {
  it("uses only granted enemy tracks, remains deterministic and bounded", () => {
    const nations: NationalWorld["nations"] = Array.from(
      { length: 100 },
      (_, i) => ({
        id: "sovereign-" + i,
        name: "Nation " + i,
        landPercent: 1,
        status: "independent" as const,
        alive: true,
        troops: 250_000,
        treasury: 200_000,
      }),
    );
    const wars: NationalWorld["wars"] = Array.from(
      { length: 50 },
      (_, i) => ({
        id: "nav-perf-war-" + i,
        scope: "national" as const,
        first: {
          kind: "nation" as const,
          stableId: "sovereign-" + (2 * i),
          activeMemberIds: ["sovereign-" + (2 * i)],
        },
        second: {
          kind: "nation" as const,
          stableId: "sovereign-" + (2 * i + 1),
          activeMemberIds: ["sovereign-" + (2 * i + 1)],
        },
        startedTick: 1,
      }),
    );
    const assets: NationalWorld["assets"] = Array.from(
      { length: 2500 },
      (_, i) => ({
        id: "ship-" + i,
        ownerId: "sovereign-" + (i % 100),
        kind: "trade-ship" as const,
        x: 100 + (i % 300),
        y: 200 + (i % 400),
      }),
    );
    const grants: NationalWorld["sightGrants"] = Array.from(
      { length: 100 },
      (_, observer) =>
        Array.from({ length: 250 }, (_, slot) => ({
          observerId: "sovereign-" + observer,
          assetId: "ship-" + ((observer + slot) % 2500),
          source: "coast" as const,
          observedAtTick: 100,
          expiresAtTick: 100,
        })),
    ).flat();
    const world: NationalWorld = {
      tick: 100,
      nations,
      wars,
      coalitions: [],
      invitations: [],
      assets,
      sightGrants: grants,
      frontiers: [],
      diplomaticEvents: [],
    };
    const ownPorts = [
      { x: 101, y: 201 },
      { x: 140, y: 240 },
      { x: 175, y: 275 },
    ];
    const start = performance.now();
    let selected = 0;
    for (let run = 0; run < 2; run++) {
      for (let i = 0; i < 100; i++) {
        const observer = "sovereign-" + i;
        const observation = projectNationalObservation(world, observer);
        const first = planObservedNationalNavalTargets(observation, ownPorts);
        const again = planObservedNationalNavalTargets(observation, ownPorts);
        expect(again).toEqual(first);
        expect(first.length).toBeLessThanOrEqual(24);
        expect(first.every((t) => t.ownerId !== observer)).toBe(true);
        selected += first.length;
      }
    }
    const elapsedMs = performance.now() - start;
    expect(selected).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(8000);
    console.info("C5_NAVAL_PERF=" + JSON.stringify({
      independentNations: 100,
      totalShips: 2500,
      grants: grants.length,
      observationsAndPlans: 200,
      selected,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      budgetMs: 8000,
    }));
  });
});
