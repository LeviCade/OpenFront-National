import {
  advanceLastKnown,
  projectNationalObservation,
  type NationalWorld,
} from "@openfront/engine/national/observation/NationalObservation";

function fixture(): NationalWorld {
  return {
    tick: 10,
    nations: [
      {
        id: "a",
        name: "Aster",
        landPercent: 3,
        status: "independent",
        alive: true,
        controllerKind: "human",
        troops: 900,
        treasury: 800,
      },
      {
        id: "b",
        name: "Birch",
        landPercent: 8,
        status: "imperial",
        alive: true,
        controllerKind: "ai",
        troops: 40000,
        treasury: 90000,
      },
      {
        id: "c",
        name: "Cedar",
        landPercent: 5,
        status: "member",
        alive: true,
        troops: 65000,
        treasury: 123000,
      },
      {
        id: "d",
        name: "Dawn",
        landPercent: 12,
        status: "independent",
        alive: true,
        troops: 2000,
        treasury: 40,
      },
    ],
    coalitions: [
      {
        id: "empire-1",
        kind: "empire",
        leaderId: "b",
        members: ["b", "c"],
        terms: { levyPercent: 55, taxRate: 42, militaryMode: "centralized" },
      },
      {
        id: "mda-2",
        kind: "mda",
        leaderId: "a",
        members: ["a", "d"],
        terms: { levyPercent: 10, vote: "unanimous" },
      },
    ],
    wars: [{ id: "war-1", participants: ["a", "b"] }],
    invitations: [],
    assets: [
      {
        id: "b-ship",
        ownerId: "b",
        kind: "transport",
        x: 150,
        y: 200,
        strength: 7777,
        landingDestination: { x: 9, y: 9 },
      },
      {
        id: "c-ship",
        ownerId: "c",
        kind: "warship",
        x: 20,
        y: 10,
        strength: 250,
      },
      {
        id: "d-fort",
        ownerId: "d",
        kind: "structure",
        x: 400,
        y: 400,
        strength: 5000,
      },
      { id: "a-ship", ownerId: "a", kind: "warship", x: 1, y: 1, strength: 50 },
    ],
    sightGrants: [
      {
        observerId: "b",
        assetId: "d-fort",
        source: "border",
        observedAtTick: 9,
        expiresAtTick: 10,
      },
      {
        observerId: "c",
        assetId: "b-ship",
        source: "coast",
        observedAtTick: 10,
        expiresAtTick: 10,
      },
    ],
    frontiers: [
      { observerId: "a", targetId: "b", access: "land" },
      { observerId: "a", targetId: "d", access: "naval" },
    ],
    diplomaticEvents: [
      { id: "p1", tick: 9, actorId: "b", kind: "bluff-exposed", public: true },
      {
        id: "private1",
        tick: 10,
        actorId: "c",
        kind: "treaty-broken",
        public: false,
        visibleTo: ["b"],
      },
    ],
  };
}

describe("NATIONAL observation FOG-01 / FOG-02 / FOG-07", () => {
  it("FOG-01 exposes public names, land, war and coalition roster without private totals", () => {
    const view = projectNationalObservation(fixture(), "a");
    expect(view.nations.map((n) => n.name)).toEqual([
      "Aster",
      "Birch",
      "Cedar",
      "Dawn",
    ]);
    expect(view.wars).toEqual([{ id: "war-1", participants: ["a", "b"] }]);
    expect(view.coalitions.find((c) => c.id === "empire-1")?.members).toEqual([
      "b",
      "c",
    ]);
    expect(view.ownResources).toEqual({ troops: 900, treasury: 800 });
    const wire = JSON.stringify(view);
    expect(wire).not.toContain("90000");
    expect(wire).not.toContain("123000");
    expect(wire).not.toContain("40000");
    expect(wire).not.toContain("controllerKind");
    expect(wire).not.toContain("landingDestination");
    expect(wire).not.toContain("private1");
  });

  it("FOG-02 hides empire clauses from outsiders but reveals to members and addressed invitees", () => {
    const w = fixture();
    const outsider = projectNationalObservation(w, "a").coalitions.find(
      (c) => c.id === "empire-1",
    )!;
    expect("terms" in outsider).toBe(false);
    expect(
      projectNationalObservation(w, "b").coalitions.find(
        (c) => c.id === "empire-1",
      )?.terms?.taxRate,
    ).toBe(42);
    const invited = projectNationalObservation(
      {
        ...w,
        invitations: [{ coalitionId: "empire-1", recipientId: "a" }],
      },
      "a",
    ).coalitions.find((c) => c.id === "empire-1")!;
    expect(invited.invited).toBe(true);
    expect(invited.terms?.levyPercent).toBe(55);
    expect(
      "terms" in
        projectNationalObservation(w, "d").coalitions.find(
          (c) => c.id === "empire-1",
        )!,
    ).toBe(false);
  });

  it("FOG-07 gives an identical whitelist to AI and human controllers", () => {
    const w = fixture();
    const swapped: NationalWorld = {
      ...w,
      nations: w.nations.map((n) => ({
        ...n,
        controllerKind:
          n.controllerKind === "human" ? ("ai" as const) : ("human" as const),
      })),
    };
    expect(projectNationalObservation(w, "a")).toEqual(
      projectNationalObservation(swapped, "a"),
    );
  });

  it("FOG-04/06 shares currently sighted intel across empire only, not externally", () => {
    const w = fixture();
    const b = projectNationalObservation(w, "b");
    const c = projectNationalObservation(w, "c");
    const a = projectNationalObservation(w, "a");
    expect(b.visibleAssets.find((u) => u.id === "b-ship")?.source).toBe("own");
    expect(c.visibleAssets.find((u) => u.id === "d-fort")?.source).toBe(
      "empire",
    );
    expect(c.visibleAssets.find((u) => u.id === "d-fort")?.sourceNationId).toBe(
      "b",
    );
    expect(c.diplomaticEvents.some((e) => e.id === "private1")).toBe(true);
    expect(b.visibleAssets.find((u) => u.id === "b-ship")?.strength).toBe(7777);
    expect(c.visibleAssets.find((u) => u.id === "b-ship")?.strength).toBe(7777);
    expect(b.visibleAssets.find((u) => u.id === "c-ship")?.source).toBe(
      "empire",
    );
    expect(b.visibleAssets.find((u) => u.id === "c-ship")?.strength).toBe(250);
    expect(a.visibleAssets.map((u) => u.id)).toEqual(["a-ship"]);
    expect(JSON.stringify(c)).not.toContain("landingDestination");
    const revoked: NationalWorld = {
      ...w,
      tick: 11,
      sightGrants: [],
    };
    expect(
      projectNationalObservation(revoked, "b").visibleAssets.some(
        (u) => u.id === "d-fort",
      ),
    ).toBe(false);
  });

  it("FOG-03/05 excludes absent sightings and hidden transport destinations even when seen", () => {
    const w = fixture();
    expect(
      projectNationalObservation(w, "a").visibleAssets.some(
        (u) => u.id === "d-fort",
      ),
    ).toBe(false);
    const spy = projectNationalObservation(
      {
        ...w,
        sightGrants: [
          ...w.sightGrants,
          {
            observerId: "a",
            assetId: "b-ship",
            source: "coast",
            observedAtTick: 10,
            expiresAtTick: 10,
          },
        ],
      },
      "a",
    );
    expect(spy.visibleAssets.find((u) => u.id === "b-ship")).toEqual({
      id: "b-ship",
      ownerId: "b",
      kind: "transport",
      x: 150,
      y: 200,
      source: "coast",
    });
  });

  it("FOG-04 retains only last-seen positions, never refreshed from newly hidden state", () => {
    const w = fixture();
    const first = projectNationalObservation(w, "c");
    const recorded = advanceLastKnown(first, null, 5);
    const moved = projectNationalObservation(
      {
        ...w,
        tick: 11,
        sightGrants: [],
        assets: w.assets.map((a) => (a.id === "d-fort" ? { ...a, x: 999 } : a)),
      },
      "c",
    );
    const stale = advanceLastKnown(moved, recorded.memory, 5);
    expect(stale.stale.find((a) => a.id === "d-fort")?.x).toBe(400);
    expect(stale.stale.find((a) => a.id === "d-fort")?.lastSeenTick).toBe(10);
    const expired = advanceLastKnown({ ...moved, tick: 16 }, stale.memory, 5);
    expect(expired.stale.find((a) => a.id === "d-fort")).toBeUndefined();
    const dissolved = advanceLastKnown(
      {
        ...moved,
        coalitions: moved.coalitions.filter((c) => c.id !== "empire-1"),
      },
      recorded.memory,
      5,
    );
    expect(dissolved.stale.find((a) => a.id === "d-fort")).toBeUndefined();
    expect(() =>
      advanceLastKnown(first, { observerId: "a", assets: [] }, 5),
    ).toThrow();
  });
});

export { fixture };
