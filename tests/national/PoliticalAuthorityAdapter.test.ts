import type { PlayerID } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it } from "vitest";
import { NationalRuntime } from "../../packages/engine/src/national/NationalRuntime";
import {
  PoliticalAuthorityAdapter,
  type NationalConflictPoliticsPort,
  type NationalDelegationReader,
  type NationalPoliticalAuthority,
} from "../../packages/engine/src/national/politics/PoliticalAuthorityAdapter";
import {
  acceptEmpireAccession,
  acceptPactInvitation,
  betrayPact,
  eliminatePoliticalNation,
  evaluateUngovernable,
  foundEmpire,
  foundPact,
  initialPolitics,
  inviteToPact,
  lastSovereignVictory,
  METRIC_KEYS,
  proposeEmpireAccession,
  transferCrown,
  type PoliticsMetrics,
  type PoliticsProjection,
} from "../../packages/engine/src/national/politics/sovereignty";

const alpha: PlayerID = "p:real-player-0001";
const beta: PlayerID = "p:real-player-0002";
const gamma: PlayerID = "p:real-player-0003";
const delta: PlayerID = "p:real-player-0004";
const missing: PlayerID = "p:does-not-exist";

const metrics = (value: number): PoliticsMetrics =>
  Object.fromEntries(METRIC_KEYS.map((key) => [key, value])) as PoliticsMetrics;

function states(...ids: PlayerID[]): PoliticsProjection {
  return initialPolitics(ids.map((id) => ({ id, alive: true, metrics: metrics(4) })));
}

function addEmpireMember(
  state: PoliticsProjection,
  empireId: string,
  applicant: PlayerID,
  proposer: PlayerID,
): PoliticsProjection {
  const offered = proposeEmpireAccession(state, empireId, proposer, applicant);
  const recipient = proposer === applicant
    ? offered.empires.find((e) => e.id === empireId)!.leaderId
    : applicant;
  return acceptEmpireAccession(offered, empireId, recipient, applicant);
}

function setupEmpire(): PoliticsProjection {
  let state = foundEmpire(states(alpha, beta, gamma, delta), "empire-1", alpha);
  state = addEmpireMember(state, "empire-1", beta, alpha);
  return state;
}

function authority(
  get: () => PoliticsProjection,
  delegation?: NationalDelegationReader,
): PoliticalAuthorityAdapter {
  return new PoliticalAuthorityAdapter(get, delegation);
}

describe("Round Two M0 politics authority (D-003, D-009, D-010)", () => {
  it("M0-ID-01: reads existing actual PlayerID strings without creating a second state", () => {
    // Conductor's M0 runtime already owns exactly one live projection.
    const runtime = new NationalRuntime([alpha, beta, gamma]);
    const a = new PoliticalAuthorityAdapter(() => runtime.snapshot().politics);
    expect(a.alive(alpha)).toBe(true);
    expect(a.empireOf(alpha)).toBeNull();
    runtime.perform(alpha, { kind: "found-empire", empireId: "empire-1" });
    expect(a.empireOf(alpha)).toBe("empire-1");
    expect(a.emperorOf("empire-1")).toBe(alpha);
    expect(a.membersOf("empire-1")).toEqual([alpha]);
    const replayed = NationalRuntime.restore(
      runtime.snapshot(),
      [alpha, beta, gamma],
      0,
    );
    const restored = new PoliticalAuthorityAdapter(
      () => replayed.snapshot().politics,
    );
    expect(restored.emperorOf("empire-1")).toBe(alpha);
    expect(restored.checkLastSovereignVictory()).toBeNull();
  });

  it("M0-ID-02: unknown, empty, dead identities cannot claim political authority", () => {
    let state = setupEmpire();
    const a = authority(() => state);
    expect(a.alive(missing)).toBe(false);
    expect(a.alive("")).toBe(false);
    expect(a.empireOf(missing)).toBeNull();
    expect(a.emperorOf("unknown-empire")).toBeNull();
    expect(a.membersOf("unknown-empire")).toEqual([]);
    expect(a.empireExists("unknown-empire")).toBe(false);
    expect(a.delegatedNationalWar(missing, "declare")).toBe(false);
    expect(a.maySettleNational(missing)).toBe(false);
    expect(a.authorizedNationalWarActor(missing, alpha, "peace")).toBe(false);
    state = eliminatePoliticalNation(state, beta);
    expect(a.alive(beta)).toBe(false);
    expect(a.empireOf(beta)).toBeNull();
    expect(a.authorizedNationalWarActor(beta, alpha, "declare")).toBe(false);
  });

  it("M0-ACC/COAL-06: a two-party accession updates member and emperor queries immediately", () => {
    let state = foundEmpire(states(alpha, beta, gamma), "empire-1", alpha);
    const a = authority(() => state);
    expect(a.membersOf("empire-1")).toEqual([alpha]);
    const offer = proposeEmpireAccession(state, "empire-1", beta, beta);
    expect(a.empireOf(beta)).toBeNull();
    expect(() => acceptEmpireAccession(offer, "empire-1", beta, beta)).toThrow();
    state = acceptEmpireAccession(offer, "empire-1", alpha, beta);
    expect(a.empireOf(beta)).toBe("empire-1");
    expect(a.emperorOf("empire-1")).toBe(alpha);
    expect(a.membersOf("empire-1")).toEqual([alpha, beta]);
    const roster = a.membersOf("empire-1") as PlayerID[];
    roster.push(missing);
    expect(a.membersOf("empire-1")).toEqual([alpha, beta]);
  });

  it("M0-SUCC/SOV-04: succession changes emperor but not stable empire identity", () => {
    let state = setupEmpire();
    const a = authority(() => state);
    state = transferCrown(state, "empire-1", alpha, beta);
    expect(a.emperorOf("empire-1")).toBe(beta);
    expect(a.empireOf(alpha)).toBe("empire-1");
    expect(a.empireOf(beta)).toBe("empire-1");
    expect(a.membersOf("empire-1")).toEqual([alpha, beta]);
    expect(a.authorizedNationalWarActor(beta, alpha, "peace")).toBe(true);
    expect(a.authorizedNationalWarActor(alpha, beta, "peace")).toBe(false);
    state = eliminatePoliticalNation(state, gamma);
    state = eliminatePoliticalNation(state, delta);
    expect(a.checkLastSovereignVictory()?.prizes).toEqual([
      { kind: "ImperialVictor", nationId: beta, empireId: "empire-1" },
      { kind: "EmpireVictor", nationId: alpha, empireId: "empire-1" },
    ]);
  });

  it("M0-SOV-06: eliminated emperor collapses empire; survivors regain sovereignty", () => {
    let state = setupEmpire();
    const a = authority(() => state);
    state = eliminatePoliticalNation(state, alpha);
    expect(a.emperorOf("empire-1")).toBeNull();
    expect(a.empireExists("empire-1")).toBe(false);
    expect(a.membersOf("empire-1")).toEqual([]);
    expect(a.empireOf(beta)).toBeNull();
    expect(a.alive(beta)).toBe(true);
    expect(a.authorizedNationalWarActor(beta, beta, "declare")).toBe(true);
    expect(a.checkLastSovereignVictory()).toBeNull();
    state = eliminatePoliticalNation(state, gamma);
    state = eliminatePoliticalNation(state, delta);
    expect(a.checkLastSovereignVictory()?.prizes).toEqual([
      { kind: "SovereignVictor", nationId: beta },
    ]);
  });

  it("M0-CRISIS/SOV-05: strict inferior crown collapses at deterministic tick deadline", () => {
    let state = foundEmpire(states(alpha, beta), "empire-1", alpha);
    state = addEmpireMember(state, "empire-1", beta, alpha);
    state.nations.find((n) => n.id === alpha)!.metrics = metrics(1);
    state.nations.find((n) => n.id === beta)!.metrics = metrics(2);
    const a = authority(() => state);
    const checked = evaluateUngovernable(state, 100);
    state = checked.state;
    expect(checked.warnings).toEqual([
      { empireId: "empire-1", deadlineMs: 10100 },
    ]);
    expect(a.emperorOf("empire-1")).toBe(alpha);
    state = evaluateUngovernable(state, 10100).state;
    expect(a.emperorOf("empire-1")).toBeNull();
    expect(a.empireOf(beta)).toBeNull();
    expect(a.checkLastSovereignVictory()).toBeNull();
  });
});

describe("Round Two treaty and war permission queries (D-007, D-010)", () => {
  it("M0-COAL-05: treaty protection is bidirectional until actual Betray", () => {
    let state = foundPact(states(alpha, beta, gamma), {
      id: "pact-1",
      name: "Treaty",
      kind: "NAP",
      founderId: alpha,
      terms: { admission: "leader", expulsion: "forbidden" },
    });
    state = inviteToPact(state, "pact-1", alpha, beta);
    state = acceptPactInvitation(state, "pact-1", beta);
    const a = authority(() => state);
    expect(a.protectedByTreaty(alpha, beta)).toBe(true);
    expect(a.treatyProtects(beta, alpha)).toBe(true);
    expect(a.treatyProtects(alpha, gamma)).toBe(false);
    expect(a.treatyProtects(alpha, alpha)).toBe(false);
    expect(a.treatyProtects(alpha, missing)).toBe(false);
    state = betrayPact(state, "pact-1", beta);
    expect(a.treatyProtects(alpha, beta)).toBe(false);
  });

  it("WAR-04/07: independent and reigning emperor have authority; subordinate defaults DENY", () => {
    let state = setupEmpire();
    const a: NationalPoliticalAuthority & NationalConflictPoliticsPort =
      authority(() => state);
    expect(a.delegatedNationalWar(gamma, "declare")).toBe(true);
    expect(a.delegatedNationalWar(gamma, "peace")).toBe(true);
    expect(a.delegatedNationalWar(alpha, "declare")).toBe(true);
    expect(a.delegatedNationalWar(alpha, "peace")).toBe(true);
    expect(a.delegatedNationalWar(beta, "declare")).toBe(false);
    expect(a.delegatedNationalWar(beta, "peace")).toBe(false);
    expect(a.mayDeclareNational(beta)).toBe(false);
    expect(a.maySettleNational(beta)).toBe(false);
    expect(a.authorizedNationalWarActor(alpha, beta, "declare")).toBe(true);
    expect(a.authorizedNationalWarActor(alpha, beta, "peace")).toBe(true);
    expect(a.authorizedNationalWarActor(beta, beta, "declare")).toBe(false);
    expect(a.authorizedNationalWarActor(beta, beta, "peace")).toBe(false);
    expect(a.authorizedNationalWarActor(beta, alpha, "peace")).toBe(false);
    expect(a.authorizedNationalWarActor(gamma, beta, "peace")).toBe(false);
    // Crown transfer invalidates the old crown's blanket executive authority.
    state = transferCrown(state, "empire-1", alpha, beta);
    expect(a.authorizedNationalWarActor(alpha, beta, "peace")).toBe(false);
    expect(a.authorizedNationalWarActor(beta, alpha, "peace")).toBe(true);
  });

  it("WAR-04: explicit delegated peace need not imply permission to declare war", () => {
    const state = setupEmpire();
    const delegation: NationalDelegationReader = (id, action) =>
      id === beta && action === "peace" ? true : undefined;
    const a = authority(() => state, delegation);
    expect(a.mayDeclareNational(beta)).toBe(false);
    expect(a.maySettleNational(beta)).toBe(true);
    expect(a.authorizedNationalWarActor(beta, beta, "peace")).toBe(true);
    expect(a.authorizedNationalWarActor(beta, beta, "declare")).toBe(false);
    expect(a.authorizedNationalWarActor(alpha, beta, "declare")).toBe(true);
    expect(a.authorizedNationalWarActor(beta, alpha, "peace")).toBe(false);
  });

  it("WAR-07: only the emperor has imperial war authority, regardless of national delegation", () => {
    const state = setupEmpire();
    const a = authority(() => state, () => true);
    expect(a.emperorOf("empire-1")).toBe(alpha);
    expect(a.emperorOf("empire-1") === beta).toBe(false);
    expect(a.authorizedNationalWarActor(beta, beta, "declare")).toBe(true);
    expect(a.authorizedNationalWarActor(beta, alpha, "declare")).toBe(false);
    // The E2 port consults emperorOf() for its separately-scoped imperial wars.
    // Neither the existence nor settlement of an imperial war is stored here.
    expect(a.empireExists("empire-1")).toBe(true);
    expect(a.membersOf("empire-1")).toEqual([alpha, beta]);
  });

  it("WAR-04/07: undefined, false and absent delegation policies fail closed", () => {
    const state = setupEmpire();
    const outcomes: Array<NationalDelegationReader | undefined> = [
      undefined,
      () => undefined,
      () => false,
    ];
    for (const policy of outcomes) {
      const a = authority(() => state, policy);
      for (const action of ["declare", "peace"] as const) {
        expect(a.delegatedNationalWar(beta, action)).toBe(false);
        expect(a.authorizedNationalWarActor(beta, beta, action)).toBe(false);
      }
      expect(a.emperorOf("empire-1")).toBe(alpha);
    }
  });

  it("M0-REPLAY: stable ID query results survive serialize/restore and pure transition replay", () => {
    function play(): PoliticsProjection {
      let state = setupEmpire();
      state = transferCrown(state, "empire-1", alpha, beta);
      state = eliminatePoliticalNation(state, gamma);
      return state;
    }
    const state = play();
    const rehydrated = JSON.parse(JSON.stringify(state)) as PoliticsProjection;
    const a = authority(() => state);
    const b = authority(() => rehydrated);
    expect(a.membersOf("empire-1")).toEqual(b.membersOf("empire-1"));
    expect(a.emperorOf("empire-1")).toBe(b.emperorOf("empire-1"));
    expect(a.checkLastSovereignVictory()).toEqual(b.checkLastSovereignVictory());
    expect(JSON.stringify(play())).toBe(JSON.stringify(state));
    expect(lastSovereignVictory(state).sovereignPowerCount).toBe(2);
  });
});
