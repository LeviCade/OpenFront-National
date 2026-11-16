import {
  deriveNationalWarSides,
  initialNationalPlannerMemory,
  planNationalInterest,
} from "@openfront/engine/national/ai/NationalPlanner";
import {
  advanceLastKnown,
  projectNationalObservation,
  type NationalWarView,
  type NationalWorld,
} from "@openfront/engine/national/observation/NationalObservation";

function war(
  id: string,
  scope: NationalWarView["scope"],
  firstKind: "nation" | "empire",
  firstId: string,
  firstMembers: readonly string[],
  secondKind: "nation" | "empire",
  secondId: string,
  secondMembers: readonly string[],
): NationalWarView {
  return {
    id,
    scope,
    first: { kind: firstKind, stableId: firstId, activeMemberIds: firstMembers },
    second: {
      kind: secondKind,
      stableId: secondId,
      activeMemberIds: secondMembers,
    },
    startedTick: 11,
  };
}

function world(): NationalWorld {
  const names = ["a", "b", "c", "d", "e", "f", "x", "y"];
  return {
    tick: 40,
    nations: names.map((id) => ({
      id,
      name: id.toUpperCase(),
      landPercent: id === "a" ? 0.5 : 5,
      status: "independent" as const,
      alive: true,
      troops: 800,
      treasury: 100,
      controllerKind: id === "a" ? ("human" as const) : ("ai" as const),
    })),
    coalitions: [],
    wars: [
      war(
        "empire-war",
        "imperial",
        "empire",
        "e-one",
        ["a", "b"],
        "nation",
        "c",
        ["c"],
      ),
    ],
    invitations: [],
    assets: [
      { id: "b-army", kind: "army", ownerId: "b", x: 4, y: 4, strength: 100000 },
      { id: "c-army", kind: "army", ownerId: "c", x: 6, y: 6, strength: 50000 },
      {
        id: "x-secret",
        kind: "warship",
        ownerId: "x",
        x: 999,
        y: 999,
        strength: 999999,
      },
    ],
    sightGrants: [
      {
        observerId: "a",
        assetId: "b-army",
        source: "border",
        observedAtTick: 40,
        expiresAtTick: 40,
      },
      {
        observerId: "a",
        assetId: "c-army",
        source: "border",
        observedAtTick: 40,
        expiresAtTick: 40,
      },
    ],
    frontiers: [
      { observerId: "a", targetId: "b", access: "land" },
      { observerId: "a", targetId: "c", access: "land" },
    ],
    diplomaticEvents: [],
  };
}

function enemies(w: NationalWorld, id = "a"): string[] {
  return [
    ...deriveNationalWarSides(projectNationalObservation(w, id).wars, id)
      .enemies,
  ].sort();
}

describe("NATIONAL opposing war sides (WAR-03/07, AI-01, FOG-06/07)", () => {
  it("A and B fight together against C: B never becomes hostile or a target", () => {
    const w = world();
    const view = projectNationalObservation(w, "a");
    const sides = deriveNationalWarSides(view.wars, "a");
    expect([...sides.enemies]).toEqual(["c"]);
    expect([...sides.allies]).toEqual(["b"]);
    expect(view.wars).toEqual(w.wars);

    // The only detected military unit is friendly B, so no panic defense.
    const friendlyOnly = projectNationalObservation(
      {
        ...w,
        sightGrants: w.sightGrants.filter((g) => g.assetId === "b-army"),
      },
      "a",
    );
    const plan = planNationalInterest(
      friendlyOnly,
      initialNationalPlannerMemory("a"),
      30,
    );
    expect(plan.decision?.objective).not.toBe("defend");
    expect(plan.decision?.targetId).toBe("c");
    expect(plan.decision?.targetId).not.toBe("b");

    // An observed army belonging to opposing C is a legitimate threat.
    const underAttack = planNationalInterest(
      view,
      initialNationalPlannerMemory("a"),
      30,
    );
    expect(underAttack.decision?.objective).toBe("defend");
    expect(underAttack.decision?.targetId).toBeNull();
  });

  it("multiple imperial members versus multiple opposing nations", () => {
    const w = world();
    const record = war(
      "two-empires",
      "imperial",
      "empire",
      "left",
      ["a", "b", "d", "e"],
      "empire",
      "right",
      ["c", "f", "x", "y"],
    );
    const next = { ...w, wars: [record] };
    expect(enemies(next, "a")).toEqual(["c", "f", "x", "y"]);
    expect(enemies(next, "b")).toEqual(["c", "f", "x", "y"]);
    expect(enemies(next, "c")).toEqual(["a", "b", "d", "e"]);
    expect(
      [
        ...deriveNationalWarSides(
          projectNationalObservation(next, "a").wars,
          "a",
        ).allies,
      ].sort(),
    ).toEqual(["b", "d", "e"]);
    expect(projectNationalObservation(next, "a").wars[0].first).toEqual(
      record.first,
    );
  });

  it("an individual national war coexists with a distinct imperial war", () => {
    const w = world();
    const individual = war(
      "national-a-x",
      "national",
      "nation",
      "a",
      ["a"],
      "nation",
      "x",
      ["x"],
    );
    const layered = { ...w, wars: [...w.wars, individual] };
    expect(enemies(layered, "a")).toEqual(["c", "x"]);
    expect(enemies(layered, "b")).toEqual(["c"]);
    expect(enemies(layered, "x")).toEqual(["a"]);
    expect(
      projectNationalObservation(layered, "a").wars.map((r) => [r.id, r.scope]),
    ).toEqual([
      ["empire-war", "imperial"],
      ["national-a-x", "national"],
    ]);
  });

  it("peace in either war layer leaves the independent other layer intact", () => {
    const w = world();
    const individual = war(
      "national-a-c",
      "national",
      "nation",
      "a",
      ["a"],
      "nation",
      "c",
      ["c"],
    );
    const both = { ...w, wars: [...w.wars, individual] };
    expect(enemies(both)).toEqual(["c"]);

    // These lists simulate authoritative ledger output after accepted peace.
    const imperialPeace = {
      ...both,
      tick: 41,
      wars: both.wars.filter((r) => r.id !== "empire-war"),
    };
    expect(projectNationalObservation(imperialPeace, "a").wars).toEqual([
      individual,
    ]);
    expect(enemies(imperialPeace)).toEqual(["c"]);

    const nationalPeace = {
      ...both,
      tick: 41,
      wars: both.wars.filter((r) => r.id !== "national-a-c"),
    };
    expect(enemies(nationalPeace)).toEqual(["c"]);
    expect(enemies({ ...both, tick: 42, wars: [] })).toEqual([]);
  });

  it("malformed double-sided membership fails closed instead of attacking allies", () => {
    const invalid = war(
      "invalid",
      "imperial",
      "empire",
      "left",
      ["a", "b"],
      "empire",
      "right",
      ["a", "c"],
    );
    const ambiguous = deriveNationalWarSides([invalid], "a");
    expect([...ambiguous.enemies]).toEqual([]);
    expect([...ambiguous.allies]).toEqual([]);

    const shared = war(
      "shared",
      "imperial",
      "empire",
      "left",
      ["a", "b"],
      "nation",
      "c",
      ["c"],
    );
    const conflicting = war(
      "conflicting",
      "national",
      "nation",
      "a",
      ["a"],
      "nation",
      "b",
      ["b"],
    );
    const sides = deriveNationalWarSides([shared, conflicting], "a");
    expect([...sides.allies]).toEqual(["b"]);
    expect([...sides.enemies]).toEqual(["c"]);
  });

  it("imperial intelligence and confidential terms do not reach outsiders", () => {
    const w = world();
    const empire = {
      id: "e-one",
      kind: "empire" as const,
      leaderId: "a",
      members: ["a", "b"],
      terms: { taxRate: 99, privateCode: "secret" },
    };
    const connected: NationalWorld = {
      ...w,
      coalitions: [empire],
      diplomaticEvents: [
        {
          id: "hidden-event",
          tick: 40,
          actorId: "c",
          kind: "bluff-exposed",
          public: false,
          visibleTo: ["b"],
        },
      ],
      sightGrants: [
        ...w.sightGrants,
        {
          observerId: "b",
          assetId: "x-secret",
          source: "warship",
          observedAtTick: 40,
          expiresAtTick: 40,
        },
      ],
    };
    const member = projectNationalObservation(connected, "a");
    const outsider = projectNationalObservation(connected, "c");
    expect(
      member.visibleAssets.find((a) => a.id === "x-secret")?.source,
    ).toBe("empire");
    expect(
      member.diplomaticEvents.some((e) => e.id === "hidden-event"),
    ).toBe(true);
    expect(
      outsider.visibleAssets.some((a) => a.id === "x-secret"),
    ).toBe(false);
    expect(
      outsider.diplomaticEvents.some((e) => e.id === "hidden-event"),
    ).toBe(false);
    expect(outsider.coalitions[0].terms).toBeUndefined();
    const serialized = JSON.stringify(outsider);
    expect(serialized).not.toContain("privateCode");
    expect(serialized).not.toContain("999999");
    expect(serialized).not.toContain("hidden-event");

    const remembered = advanceLastKnown(member, null, 10);
    const dissolved = projectNationalObservation(
      {
        ...connected,
        tick: 41,
        coalitions: [],
        sightGrants: connected.sightGrants.filter(
          (grant) => grant.observerId === "a",
        ),
      },
      "a",
    );
    expect(
      dissolved.visibleAssets.find((a) => a.id === "x-secret"),
    ).toBeUndefined();
    expect(
      advanceLastKnown(dissolved, remembered.memory, 10).stale.find(
        (a) => a.id === "x-secret",
      ),
    ).toBeUndefined();
  });

  it("human/AI controller swaps change neither observations nor strategy", () => {
    const w = world();
    const flipped: NationalWorld = {
      ...w,
      nations: w.nations.map((n) => ({
        ...n,
        controllerKind:
          n.controllerKind === "human" ? ("ai" as const) : ("human" as const),
      })),
    };
    for (const id of ["a", "b", "c"]) {
      const before = projectNationalObservation(w, id);
      const after = projectNationalObservation(flipped, id);
      expect(after).toEqual(before);
      expect(
        planNationalInterest(after, initialNationalPlannerMemory(id), 30),
      ).toEqual(
        planNationalInterest(before, initialNationalPlannerMemory(id), 30),
      );
    }
  });
});
