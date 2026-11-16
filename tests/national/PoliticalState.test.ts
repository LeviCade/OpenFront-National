import { describe, expect, it } from "vitest";
import {
  acceptEmpireAccession,
  acceptPactInvitation,
  amendPact,
  approvePactInvitation,
  betrayPact,
  dissolveEmpire,
  eliminatePoliticalNation,
  empireOf,
  evaluateUngovernable,
  expelPactMember,
  foundEmpire,
  foundPact,
  initialPolitics,
  inviteToPact,
  lastSovereignVictory,
  METRIC_KEYS,
  preparePactAttack,
  proposeEmpireAccession,
  transferCrown,
  validatePolitics,
  viewPact,
  type PactTerms,
  type PoliticsMetrics,
  type PoliticsNation,
  type PoliticsProjection,
} from "../../packages/engine/src/national/politics/sovereignty";

const leaderTerms: PactTerms = { admission: "leader", expulsion: "forbidden" };
const unanimousTerms: PactTerms = { admission: "unanimous", expulsion: "unanimous" };

function metrics(value: number): PoliticsMetrics {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, value])) as PoliticsMetrics;
}

function nation(id: string, value = 10): PoliticsNation {
  return { id, alive: true, metrics: metrics(value) };
}

function world(...ids: string[]): PoliticsProjection {
  return initialPolitics(ids.map((id) => nation(id)));
}

function pactWith(worldState: PoliticsProjection, pactId: string, kind: "NAP" | "MDA", members: string[]) {
  let state = foundPact(worldState, {
    id: pactId,
    name: "Treaty " + pactId,
    kind,
    founderId: members[0],
    terms: leaderTerms,
  });
  for (const memberId of members.slice(1)) {
    state = inviteToPact(state, pactId, members[0], memberId);
    state = acceptPactInvitation(state, pactId, memberId);
  }
  return state;
}

function empireWith(worldState: PoliticsProjection, empireId: string, leader: string, members: string[]) {
  let state = foundEmpire(worldState, empireId, leader);
  for (const candidate of members) {
    state = proposeEmpireAccession(state, empireId, leader, candidate);
    state = acceptEmpireAccession(state, empireId, candidate, candidate);
  }
  return state;
}

describe("NATIONAL sovereignty victory (D-003, D-004)", () => {
  it("SOV-01: 99% empire cannot win against one-tile independent island", () => {
    let s = initialPolitics([nation("emperor", 9900), nation("vassal", 900), nation("island", 1)]);
    s = empireWith(s, "empire", "emperor", ["vassal"]);
    expect(lastSovereignVictory(s)).toEqual({
      sovereignPowerCount: 2,
      resolved: false,
      prizes: [],
    });
    const after = eliminatePoliticalNation(s, "island");
    expect(lastSovereignVictory(after).prizes.map((p) => p.kind)).toEqual([
      "ImperialVictor",
      "EmpireVictor",
    ]);
  });

  it("SOV-02: allied NAP/MDA treaty members remain separate sovereign contenders", () => {
    const s = pactWith(world("a", "b"), "mda", "MDA", ["a", "b"]);
    expect(lastSovereignVictory(s).sovereignPowerCount).toBe(2);
    expect(lastSovereignVictory(s).resolved).toBe(false);
  });

  it("SOV-03: last empire awards exactly one top prize and seven member prizes", () => {
    const members = ["v7", "v6", "v5", "v4", "v3", "v2", "v1"];
    const s = empireWith(world("king", ...members), "e", "king", members);
    const victory = lastSovereignVictory(s);
    expect(victory.resolved).toBe(true);
    expect(victory.prizes).toHaveLength(8);
    expect(victory.prizes[0]).toEqual({
      kind: "ImperialVictor",
      nationId: "king",
      empireId: "e",
    });
    expect(victory.prizes.slice(1).map((p) => p.nationId)).toEqual([...members].sort());
  });

  it("SOV-04: leadership transfer before victory changes supreme winner, not membership", () => {
    let s = empireWith(world("a", "b", "outsider"), "e", "a", ["b"]);
    s = transferCrown(s, "e", "a", "b");
    s = eliminatePoliticalNation(s, "outsider");
    expect(lastSovereignVictory(s).prizes).toEqual([
      { kind: "ImperialVictor", nationId: "b", empireId: "e" },
      { kind: "EmpireVictor", nationId: "a", empireId: "e" },
    ]);
  });

  it("SOV-05: strict eight-metric inferiority warns for precisely ten simulated seconds", () => {
    let s = initialPolitics([nation("weak", 1), nation("strong", 2)]);
    s = empireWith(s, "e", "weak", ["strong"]);
    let checked = evaluateUngovernable(s, 1000);
    expect(checked.warnings).toEqual([{ empireId: "e", deadlineMs: 11000 }]);
    checked = evaluateUngovernable(checked.state, 10999);
    expect(checked.collapsed).toEqual([]);
    expect(checked.warnings[0].deadlineMs).toBe(11000);
    checked = evaluateUngovernable(checked.state, 11000);
    expect(checked.collapsed).toEqual(["e"]);
    expect(checked.state.empires).toHaveLength(0);
    expect(lastSovereignVictory(checked.state).sovereignPowerCount).toBe(2);
  });

  it("SOV-05: one tie in any metric blocks crisis; recovery clears existing warning", () => {
    let s = empireWith(initialPolitics([nation("weak", 1), nation("strong", 2)]), "e", "weak", ["strong"]);
    s.nations[0].metrics.cities = 2;
    expect(evaluateUngovernable(s, 1000).warnings).toEqual([]);
    s.nations[0].metrics.cities = 1;
    const warning = evaluateUngovernable(s, 2000).state;
    warning.nations[0].metrics.warships = 2;
    const recovered = evaluateUngovernable(warning, 3000);
    expect(recovered.state.empires[0].crisisDeadlineMs).toBeNull();
    expect(evaluateUngovernable(recovered.state, 20000).collapsed).toEqual([]);
  });

  it("SOV-05: transfer before deadline resolves crisis and expired transfer is rejected", () => {
    let s = empireWith(initialPolitics([nation("weak", 1), nation("strong", 2)]), "e", "weak", ["strong"]);
    s = evaluateUngovernable(s, 0).state;
    expect(() => transferCrown(s, "e", "weak", "strong", 10000)).toThrow(/deadline/);
    const transferred = transferCrown(s, "e", "weak", "strong", 9999);
    expect(transferred.empires[0].leaderId).toBe("strong");
    expect(evaluateUngovernable(transferred, 10000).collapsed).toEqual([]);
  });

  it("SOV-06: emperor elimination atomically dissolves empire and restores independent members", () => {
    let s = empireWith(world("emperor", "b", "c"), "e", "emperor", ["b", "c"]);
    s = eliminatePoliticalNation(s, "emperor");
    expect(s.empires).toEqual([]);
    expect(empireOf(s, "b")).toBeNull();
    expect(empireOf(s, "c")).toBeNull();
    expect(lastSovereignVictory(s).sovereignPowerCount).toBe(2);
  });

  it("SOV-07: one independent nation wins despite unclaimed territory", () => {
    const s = initialPolitics([nation("survivor", 1), { ...nation("gone"), alive: false }]);
    expect(lastSovereignVictory(s)).toEqual({
      sovereignPowerCount: 1,
      resolved: true,
      prizes: [{ kind: "SovereignVictor", nationId: "survivor" }],
    });
    expect(lastSovereignVictory(initialPolitics([])).resolved).toBe(false);
  });
});

describe("NATIONAL constitutional coalitions (D-006, D-007, D-009, D-013)", () => {
  it("COAL-01: independent nation concurrently belongs to two NAPs and one MDA", () => {
    let s = world("a", "b", "c", "d");
    s = pactWith(s, "nap1", "NAP", ["a", "b"]);
    s = pactWith(s, "nap2", "NAP", ["c", "a"]);
    s = pactWith(s, "mda", "MDA", ["d", "a"]);
    expect(s.pacts.filter((p) => p.memberIds.includes("a"))).toHaveLength(3);
    expect(lastSovereignVictory(s).sovereignPowerCount).toBe(4);
  });

  it("COAL-02: outsiders receive public roster only; invitees receive constitution", () => {
    let s = foundPact(world("a", "b", "outsider"), {
      id: "nap",
      name: "Secret",
      kind: "NAP",
      founderId: "a",
      terms: leaderTerms,
    });
    expect(viewPact(s, "nap", "outsider")).toEqual({
      id: "nap",
      name: "Secret",
      kind: "NAP",
      memberIds: ["a"],
      administratorId: "a",
    });
    expect(viewPact(s, "nap", "a").terms).toEqual(leaderTerms);
    s = inviteToPact(s, "nap", "a", "b");
    expect(viewPact(s, "nap", "b").terms).toEqual(leaderTerms);
    expect(JSON.stringify(viewPact(s, "nap", "outsider"))).not.toContain("expulsion");
  });

  it("COAL-03: leader can admit, only unanimous consent can amend, compliant members cannot be expelled", () => {
    let s = pactWith(world("a", "b", "c"), "nap", "NAP", ["a", "b"]);
    expect(() => expelPactMember(s, "nap", "a", "b")).toThrow(/forbidden/);
    expect(() => inviteToPact(s, "nap", "b", "c")).toThrow(/leader/);
    s = inviteToPact(s, "nap", "a", "c");
    s = acceptPactInvitation(s, "nap", "c");
    expect(s.pacts[0].memberIds).toEqual(["a", "b", "c"]);
    expect(() =>
      amendPact(s, "nap", { terms: unanimousTerms, administratorId: "a" }, ["a", "b"]),
    ).toThrow(/unanimous/);
    expect(s.pacts[0].terms).toEqual(leaderTerms);
  });

  it("COAL-04: Betray immediately expels even with forbidden discretionary expulsion", () => {
    const s = pactWith(world("a", "b", "c"), "nap", "NAP", ["a", "b", "c"]);
    const next = betrayPact(s, "nap", "b");
    expect(next.pacts[0].memberIds).toEqual(["a", "c"]);
    expect(s.pacts[0].memberIds).toEqual(["a", "b", "c"]);
    expect(() => betrayPact(next, "nap", "b")).toThrow(/not a member/);
  });

  it("COAL-05: prohibited co-member attack cannot preserve treaty membership", () => {
    let s = pactWith(world("a", "b"), "nap", "NAP", ["a", "b"]);
    s = pactWith(s, "mda", "MDA", ["a", "b"]);
    expect(() => preparePactAttack(s, "a", "b", false)).toThrow(/confirmation/);
    expect(s.pacts).toHaveLength(2);
    const prepared = preparePactAttack(s, "a", "b", true);
    expect(prepared.betrayedPactIds).toEqual(["mda", "nap"]);
    expect(prepared.state.pacts).toHaveLength(0);
    expect(s.pacts).toHaveLength(2);
  });

  it("COAL-06: accession requires both parties and removes all outside memberships atomically", () => {
    let s = world("emperor", "a", "b", "c");
    s = pactWith(s, "nap", "NAP", ["a", "b"]);
    s = pactWith(s, "mda", "MDA", ["a", "c"]);
    s = foundEmpire(s, "e", "emperor");
    s = proposeEmpireAccession(s, "e", "a", "a"); // application from candidate
    expect(() => acceptEmpireAccession(s, "e", "a", "a")).toThrow(/consent/);
    const joined = acceptEmpireAccession(s, "e", "emperor", "a");
    expect(empireOf(joined, "a")).toBe("e");
    expect(joined.pacts).toEqual([]); // remaining one-party contracts cease to exist
    expect(joined.accessionOffers).toEqual([]);
    expect(s.pacts).toHaveLength(2);
    expect(() => foundPact(joined, {
      id: "illegal",
      name: "Illegal",
      kind: "NAP",
      founderId: "a",
      terms: leaderTerms,
    })).toThrow(/exclusive/);
    expect(() => proposeEmpireAccession(joined, "e", "emperor", "a")).toThrow(/exclusive/);
  });

  it("COAL-06: emperor invitation requires candidate acceptance, not emperor self-acceptance", () => {
    let s = foundEmpire(world("e", "a"), "imperium", "e");
    s = proposeEmpireAccession(s, "imperium", "e", "a");
    expect(() => acceptEmpireAccession(s, "imperium", "e", "a")).toThrow(/consent/);
    const joined = acceptEmpireAccession(s, "imperium", "a", "a");
    expect(joined.empires[0].memberIds).toEqual(["a", "e"]);
  });

  it("COAL-07: one veto leaves constitutional text untouched", () => {
    const s = pactWith(world("a", "b", "c"), "mda", "MDA", ["a", "b", "c"]);
    expect(() =>
      amendPact(s, "mda", { terms: unanimousTerms, administratorId: "b" }, ["a", "c"]),
    ).toThrow(/unanimous/);
    expect(s.pacts[0].administratorId).toBe("a");
    expect(s.pacts[0].terms).toEqual(leaderTerms);
    const amended = amendPact(
      s,
      "mda",
      { terms: unanimousTerms, administratorId: "b" },
      ["a", "b", "c"],
    );
    expect(amended.pacts[0].administratorId).toBe("b");
    expect(amended.pacts[0].terms).toEqual(unanimousTerms);
  });

  it("unanimous admission waits for every existing member approval", () => {
    let s = pactWith(world("a", "b", "c"), "mda", "MDA", ["a", "b"]);
    s = amendPact(s, "mda", { terms: unanimousTerms, administratorId: "a" }, ["a", "b"]);
    s = inviteToPact(s, "mda", "a", "c");
    expect(() => acceptPactInvitation(s, "mda", "c")).toThrow(/approvals/);
    s = approvePactInvitation(s, "mda", "b", "c");
    expect(acceptPactInvitation(s, "mda", "c").pacts[0].memberIds).toEqual(["a", "b", "c"]);
  });

  it("imperial members cannot secede; only incumbent emperor can dissolve or transfer", () => {
    const s = empireWith(world("a", "b", "c"), "e", "a", ["b"]);
    expect(() => dissolveEmpire(s, "e", "b")).toThrow(/emperor/);
    expect(() => transferCrown(s, "e", "b", "c")).toThrow(/emperor/);
    expect(() => transferCrown(s, "e", "a", "c")).toThrow(/successor/);
    const dissolved = dissolveEmpire(s, "e", "a");
    expect(empireOf(dissolved, "b")).toBeNull();
    expect(lastSovereignVictory(dissolved).sovereignPowerCount).toBe(3);
  });
});

describe("determinism, invariants, replay and command boundaries", () => {
  it("identical event sequences have byte-identical JSON and identical victory", () => {
    function simulate() {
      let s = world("a", "b", "c");
      s = pactWith(s, "p", "NAP", ["a", "b"]);
      s = foundEmpire(s, "e", "c");
      s = proposeEmpireAccession(s, "e", "b", "b");
      s = acceptEmpireAccession(s, "e", "c", "b");
      s = eliminatePoliticalNation(s, "a");
      s = evaluateUngovernable(s, 1234).state;
      validatePolitics(s);
      return { state: s, victory: lastSovereignVictory(s) };
    }
    expect(JSON.stringify(simulate())).toBe(JSON.stringify(simulate()));
    const roundTrip = JSON.parse(JSON.stringify(simulate().state)) as PoliticsProjection;
    expect(lastSovereignVictory(roundTrip)).toEqual(simulate().victory);
  });

  it("invalid snapshot double-membership and leaderless empire are rejected", () => {
    const s = empireWith(world("a", "b"), "e", "a", ["b"]);
    const bad = structuredClone(s);
    bad.empires.push({ id: "e2", leaderId: "b", memberIds: ["b"], crisisDeadlineMs: null });
    expect(() => validatePolitics(bad)).toThrow(/multiple empires/);
    const leaderless = structuredClone(s);
    leaderless.empires[0].leaderId = "outsider";
    expect(() => validatePolitics(leaderless)).toThrow(/leader/);
  });

  it("simulation clock is monotonic; repeated evaluation is idempotent", () => {
    let s = empireWith(initialPolitics([nation("a", 1), nation("b", 2)]), "e", "a", ["b"]);
    s = evaluateUngovernable(s, 700).state;
    expect(evaluateUngovernable(s, 700).state).toEqual(s);
    expect(() => evaluateUngovernable(s, 699)).toThrow(/monotonic/);
  });

  it("every transition preserves input state; invalid commands have no side effect", () => {
    const s = pactWith(world("a", "b"), "nap", "NAP", ["a", "b"]);
    const snapshot = JSON.stringify(s);
    expect(() => expelPactMember(s, "nap", "a", "b")).toThrow();
    expect(() => acceptEmpireAccession(s, "nonexistent", "a", "b")).toThrow();
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
