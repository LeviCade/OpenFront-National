/**
 * Sovereign survival under imperial coercion (D-002, D-005, D-013).
 *
 * This module is deliberately independent of E3's authoritative ultimatum
 * ledger. E3 must project a RECIPIENT-ONLY view from Game-owned state, and
 * dispatch the proposed action through its authenticated command adapter.
 * No world, Game, hidden fleet, foreign treasury or controller kind enters.
 */
import type {
  CoalitionObservation,
  NationalObservation,
} from "../observation/NationalObservation";
import { deriveNationalWarSides } from "./NationalPlanner";

/** The recipient/issuer may see only its own canonical E3 ultimatum. */
export interface ObservedImperialUltimatum {
  readonly id: string;
  readonly empireId: string;
  readonly issuerId: string;
  readonly targetId: string;
  readonly role: "issuer" | "recipient";
  readonly threat: "embargo" | "imperial-war";
  readonly deadlineTick: number;
  readonly phase:
    | "pending"
    | "consented"
    | "decision-required"
    | "acceded"
    | "enforced"
    | "backed-down"
    | "withdrawn"
    | "expired";
  readonly response: "none" | "accept" | "refuse";
}

export interface NationalCoercionMemory {
  readonly observerId: string;
  readonly processedOutcomeIds: string[];
  readonly issuerCredibility: {
    readonly issuerId: string;
    readonly score: number;
    readonly lastObservedTick: number;
  }[];
  readonly publicEmpireLand: {
    readonly empireId: string;
    readonly landPercent: number;
    readonly lastObservedTick: number;
  }[];
}

export type CoercionDecision =
  | {
      readonly kind: "resist";
      readonly ultimatumId: string;
      readonly reason: string;
    }
  | {
      readonly kind: "acknowledge-consent";
      readonly ultimatumId: string;
    }
  | {
      readonly kind: "request-consent";
      readonly ultimatumId: string;
      readonly empireId: string;
    }
  | {
      readonly kind: "accept-consent";
      readonly ultimatumId: string;
      readonly empireId: string;
    }
  | {
      readonly kind: "enforce" | "back-down";
      readonly ultimatumId: string;
      readonly reason: string;
    }
  | {
      readonly kind: "issue";
      readonly candidateId: string;
      readonly empireId: string;
    };

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const clamp = (value: number) => Math.max(-6, Math.min(6, value));

export function initialNationalCoercionMemory(
  observerId: string,
): NationalCoercionMemory {
  return {
    observerId,
    processedOutcomeIds: [],
    issuerCredibility: [],
    publicEmpireLand: [],
  };
}

/** Idempotent recipient-only reputation and PUBLIC land trend, snapshot-safe. */
export function updateNationalCoercionMemory(
  observation: NationalObservation,
  views: readonly ObservedImperialUltimatum[],
  previous: NationalCoercionMemory,
): NationalCoercionMemory {
  if (previous.observerId !== observation.observerId)
    throw new Error("Coercion memory principal mismatch");
  const processed = new Set(previous.processedOutcomeIds);
  const credibility = new Map(
    previous.issuerCredibility.map((c) => [c.issuerId, c]),
  );
  for (const view of [...views].sort(
    (a, b) => a.deadlineTick - b.deadlineTick || compare(a.id, b.id),
  )) {
    if (
      view.role !== "recipient" ||
      view.targetId !== observation.observerId ||
      processed.has(view.id)
    )
      continue;
    if (view.phase !== "enforced" && view.phase !== "backed-down") continue;
    const empire = observation.coalitions.find(
      (c) => c.id === view.empireId && c.kind === "empire",
    );
    // Reject a foreign/counterfeit issuer: old outcomes may outlive a dissolved
    // empire, but they must have been attributed by the Game-owned projection.
    if (!empire || !empire.members.includes(view.issuerId)) continue;
    processed.add(view.id);
    const before = credibility.get(view.issuerId);
    credibility.set(view.issuerId, {
      issuerId: view.issuerId,
      score: clamp((before?.score ?? 0) + (view.phase === "enforced" ? 2 : -3)),
      lastObservedTick: observation.tick,
    });
  }
  const previousLand = new Map(
    previous.publicEmpireLand.map((v) => [v.empireId, v]),
  );
  for (const empire of observation.coalitions.filter(
    (c) => c.kind === "empire",
  )) {
    const landPercent = empire.members.reduce(
      (sum, id) =>
        sum +
        (observation.nations.find((n) => n.id === id && n.alive)?.landPercent ??
          0),
      0,
    );
    previousLand.set(empire.id, {
      empireId: empire.id,
      landPercent,
      lastObservedTick: observation.tick,
    });
  }
  return {
    observerId: observation.observerId,
    processedOutcomeIds: [...processed].sort(compare).slice(-128),
    issuerCredibility: [...credibility.values()]
      .sort(
        (a, b) =>
          b.lastObservedTick - a.lastObservedTick ||
          compare(a.issuerId, b.issuerId),
      )
      .slice(0, 16)
      .sort((a, b) => compare(a.issuerId, b.issuerId)),
    publicEmpireLand: [...previousLand.values()]
      .sort(
        (a, b) =>
          b.lastObservedTick - a.lastObservedTick ||
          compare(a.empireId, b.empireId),
      )
      .slice(0, 16)
      .sort((a, b) => compare(a.empireId, b.empireId)),
  };
}

/** Warship sightings by themselves NEVER establish amphibious landing reach. */
export function observedImperialReach(
  observation: NationalObservation,
  empire: CoalitionObservation,
): "land" | "naval" | "none" {
  const frontiers = observation.frontiers.filter((f) =>
    empire.members.includes(f.targetId),
  );
  if (frontiers.some((f) => f.access === "land")) return "land";
  if (
    frontiers.some((f) => f.access === "naval") &&
    observation.visibleAssets.some(
      (asset) =>
        empire.members.includes(asset.ownerId) && asset.kind === "transport",
    )
  )
    return "naval";
  return "none";
}

export function assessImperialShelter(
  observation: NationalObservation,
  empire: CoalitionObservation,
  previous: NationalCoercionMemory,
): {
  readonly protectorViable: boolean;
  readonly reachable: boolean;
  readonly existential: boolean;
  readonly independentRoute: boolean;
  readonly declining: boolean;
} {
  if (previous.observerId !== observation.observerId)
    throw new Error("Coercion assessment principal mismatch");
  const self = observation.nations.find((n) => n.id === observation.observerId);
  const zero = {
    protectorViable: false,
    reachable: false,
    existential: false,
    independentRoute: false,
    declining: false,
  };
  if (!self?.alive || empire.kind !== "empire") return zero;
  const sides = deriveNationalWarSides(observation.wars, self.id);
  const near = observation.frontiers
    .filter((f) => f.access === "land")
    .map((f) => f.targetId);
  const observedMilitaryOwners = new Set(
    observation.visibleAssets
      .filter((a) => a.kind === "army" || a.kind === "transport")
      .map((a) => a.ownerId),
  );
  const localDanger = near.filter((id) => {
    const enemy = observation.nations.find((n) => n.id === id && n.alive);
    return (
      enemy !== undefined &&
      (sides.enemies.has(id) ||
        (observedMilitaryOwners.has(id) &&
          enemy.landPercent > self.landPercent * 1.5))
    );
  });
  const threat = Math.max(
    0,
    ...localDanger.map(
      (id) => observation.nations.find((n) => n.id === id)?.landPercent ?? 0,
    ),
  );
  const activeWar = localDanger.some((id) => sides.enemies.has(id));
  const existential =
    (activeWar || (localDanger.length > 0 && self.landPercent <= 1)) &&
    (threat >= self.landPercent * 1.5 || self.landPercent <= 0.5);
  // Wars are not automatic defeat. This route uses ONLY our own exact troop
  // reserve and military formations the nation actually sees on its frontier.
  // Unknown enemy strength never becomes an invented zero or exact counter.
  const seenHostileArmy = observation.visibleAssets.filter(
    (asset) => asset.kind === "army" && localDanger.includes(asset.ownerId),
  );
  const reliableContact =
    seenHostileArmy.length > 0 &&
    seenHostileArmy.every(
      (asset) =>
        asset.strength !== undefined &&
        Number.isFinite(asset.strength) &&
        asset.strength >= 0,
    );
  const observedContactForce = seenHostileArmy.reduce(
    (total, asset) => total + (asset.strength ?? 0),
    0,
  );
  const viableDefense =
    activeWar &&
    reliableContact &&
    self.landPercent >= Math.max(0.4, threat * 0.35) &&
    observation.ownResources.troops >= 20_000 &&
    observation.ownResources.troops >= observedContactForce * 1.5;
  const independentRoute =
    viableDefense ||
    (observation.unownedFrontier === true &&
      (!activeWar || observation.ownResources.troops >= 1_500)) ||
    (!activeWar &&
      observation.ownResources.troops >= 4_000 &&
      self.landPercent >= 0.4);
  const empireLand = empire.members.reduce(
    (sum, id) =>
      sum +
      (observation.nations.find((n) => n.id === id && n.alive)?.landPercent ??
        0),
    0,
  );
  const priorLand = previous.publicEmpireLand.find(
    (entry) => entry.empireId === empire.id,
  );
  const decliningFromHistory =
    priorLand !== undefined &&
    priorLand.lastObservedTick < observation.tick &&
    priorLand.landPercent > 0 &&
    empireLand < priorLand.landPercent * 0.75;
  const enemyEmpires = observation.wars
    .filter(
      (w) =>
        w.first.activeMemberIds.some((id) => empire.members.includes(id)) ||
        w.second.activeMemberIds.some((id) => empire.members.includes(id)),
    )
    .flatMap((war) =>
      war.first.activeMemberIds.some((id) => empire.members.includes(id))
        ? war.second.activeMemberIds
        : war.first.activeMemberIds,
    );
  const overwhelmed = enemyEmpires.some(
    (id) =>
      (observation.nations.find((n) => n.id === id)?.landPercent ?? 0) >
      empireLand * 1.6,
  );
  const declining =
    decliningFromHistory ||
    overwhelmed ||
    !observation.nations.some((n) => n.id === empire.leaderId && n.alive);
  const reachable = observedImperialReach(observation, empire) !== "none";
  const protectorViable =
    !declining &&
    empireLand >= Math.max(0.25, threat * 0.7) &&
    !empire.members.some((id) => sides.enemies.has(id));
  return {
    protectorViable,
    reachable,
    existential,
    independentRoute,
    declining,
  };
}

/**
 * Only E3-supplied, addressed canonical demands are processed. The result
 * is advisory: E3's Game command MUST validate all principal and treaty state.
 * An existing invitation/request must still be accepted by both sides.
 */
export function planObservedImperialCoercion(
  observation: NationalObservation,
  views: readonly ObservedImperialUltimatum[],
  previous: NationalCoercionMemory,
): CoercionDecision | null {
  if (previous.observerId !== observation.observerId)
    throw new Error("Coercion planner principal mismatch");
  const self = observation.observerId;
  const own = observation.nations.find((n) => n.id === self);
  if (!own?.alive) return null;
  const empires = observation.coalitions.filter((c) => c.kind === "empire");
  const sorted = [...views].sort(
    (a, b) => a.deadlineTick - b.deadlineTick || compare(a.id, b.id),
  );
  for (const v of sorted) {
    const empire = empires.find(
      (c) => c.id === v.empireId && c.leaderId === v.issuerId,
    );
    if (!empire) continue;
    if (
      v.role === "recipient" &&
      v.targetId === self &&
      v.deadlineTick > observation.tick &&
      (v.phase === "pending" || v.phase === "consented") &&
      own.status === "independent"
    ) {
      const risk = assessImperialShelter(observation, empire, previous);
      const reputation =
        previous.issuerCredibility.find((r) => r.issuerId === v.issuerId)
          ?.score ?? 0;
      const credible = risk.reachable && reputation > -3;
      if (
        !credible ||
        !risk.existential ||
        risk.independentRoute ||
        !risk.protectorViable
      )
        return {
          kind: "resist",
          ultimatumId: v.id,
          reason: !credible
            ? "unreachable-or-bluff"
            : risk.declining
              ? "collapsing-protector"
              : "preserve-sovereignty",
        };
      // E3 acceptance of a demand is not imperial accession. The Game
      // must first record consent, then authorize its normal bilateral offer.
      if (v.phase === "pending" && v.response === "none")
        return { kind: "acknowledge-consent", ultimatumId: v.id };
      if (v.phase !== "consented" || v.response !== "accept") return null;
      const hasOffer = (observation.imperialOffers ?? []).some(
        (o) =>
          o.empireId === v.empireId &&
          o.candidateId === self &&
          o.recipientId === self &&
          o.proposerId === v.issuerId,
      );
      return hasOffer
        ? { kind: "accept-consent", ultimatumId: v.id, empireId: v.empireId }
        : { kind: "request-consent", ultimatumId: v.id, empireId: v.empireId };
    }
    if (
      v.role === "issuer" &&
      v.issuerId === self &&
      v.phase === "decision-required" &&
      own.status === "imperial"
    ) {
      const recipient = observation.nations.find((n) => n.id === v.targetId);
      const reach =
        recipient?.alive &&
        (v.threat === "embargo" ||
          observation.frontiers.some(
            (f) => f.targetId === v.targetId && f.access === "land",
          ) ||
          (observation.frontiers.some(
            (f) => f.targetId === v.targetId && f.access === "naval",
          ) &&
            observation.visibleAssets.some(
              (a) => a.ownerId === self && a.kind === "transport",
            )));
      // A declaration of coercion is not proof of capacity to enforce it.
      return {
        kind: reach ? "enforce" : "back-down",
        ultimatumId: v.id,
        reason: reach ? "observed-reach" : "unreachable-threat",
      };
    }
  }
  if (own.status === "imperial") {
    const empire = empires.find((c) => c.leaderId === self);
    if (!empire) return null;
    const target = observation.frontiers
      .filter((f) => f.access === "land")
      .map((f) =>
        observation.nations.find(
          (n) => n.id === f.targetId && n.alive && n.status === "independent",
        ),
      )
      .filter((n): n is NonNullable<typeof n> => n !== undefined)
      .sort((a, b) => compare(a.id, b.id))[0];
    if (
      target &&
      target.landPercent < own.landPercent * 0.5 &&
      !views.some(
        (v) =>
          v.role === "issuer" &&
          v.issuerId === self &&
          v.empireId === empire.id &&
          v.targetId === target.id &&
          (v.phase === "pending" ||
            v.phase === "consented" ||
            v.phase === "decision-required" ||
            observation.tick < v.deadlineTick + 180),
      )
    )
      return { kind: "issue", candidateId: target.id, empireId: empire.id };
  }
  return null;
}

/** E3's exact canonical wire fields, without importing E3's parallel branch.
 * This maps a *proposal* into an intent; it never executes or grants authority.
 * NationExecution/Executor MUST submit through E3's authenticated Game ledger.
 */
export type ProposedImperialUltimatumIntent =
  | {
      readonly type: "national_issue_ultimatum";
      readonly empireId: string;
      readonly targetId: string;
      readonly threat: "embargo" | "imperial-war";
      readonly durationTicks: number;
      readonly requestId: string;
    }
  | {
      readonly type: "national_respond_ultimatum";
      readonly ultimatumId: string;
      readonly decision: "accept" | "refuse";
      readonly requestId: string;
    }
  | {
      readonly type: "national_resolve_ultimatum";
      readonly ultimatumId: string;
      readonly decision: "enforce" | "back-down";
      readonly requestId: string;
    };

/** Narrow E3 adapter; rejects stale, cross-principal and unsupported choices.
 * Every returned action still requires execution-time authoritative validation.
 */
export function proposeCanonicalImperialUltimatumIntent(
  observation: NationalObservation,
  views: readonly ObservedImperialUltimatum[],
  choice: CoercionDecision,
  requestId: string,
): ProposedImperialUltimatumIntent | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) return null;
  const self = observation.observerId;
  const nation = observation.nations.find((n) => n.id === self && n.alive);
  if (!nation) return null;
  if (choice.kind === "request-consent" || choice.kind === "accept-consent")
    return null;
  const empires = observation.coalitions.filter((e) => e.kind === "empire");
  if (choice.kind === "issue") {
    if (nation.status !== "imperial") return null;
    const crown = empires.find(
      (e) =>
        e.id === choice.empireId &&
        e.leaderId === self &&
        e.members.includes(self),
    );
    const candidate = observation.nations.find(
      (n) =>
        n.id === choice.candidateId && n.alive && n.status === "independent",
    );
    if (
      !crown ||
      !candidate ||
      !observation.frontiers.some(
        (f) => f.targetId === candidate.id && f.access === "land",
      )
    )
      return null;
    if (
      views.some(
        (v) =>
          v.role === "issuer" &&
          v.issuerId === self &&
          v.empireId === crown.id &&
          v.targetId === candidate.id &&
          (["pending", "consented", "decision-required"].includes(v.phase) ||
            observation.tick < v.deadlineTick + 180),
      )
    )
      return null;
    return {
      type: "national_issue_ultimatum",
      empireId: crown.id,
      targetId: candidate.id,
      threat: "imperial-war",
      durationTicks: 30,
      requestId,
    };
  }
  const record = views.find((v) => v.id === choice.ultimatumId);
  if (
    !record ||
    !empires.some(
      (e) => e.id === record.empireId && e.leaderId === record.issuerId,
    )
  )
    return null;
  if (choice.kind === "resist" || choice.kind === "acknowledge-consent") {
    if (
      nation.status !== "independent" ||
      record.role !== "recipient" ||
      record.targetId !== self ||
      record.phase !== "pending" ||
      record.response !== "none" ||
      record.deadlineTick <= observation.tick
    )
      return null;
    return {
      type: "national_respond_ultimatum",
      ultimatumId: record.id,
      decision: choice.kind === "resist" ? "refuse" : "accept",
      requestId,
    };
  }
  if (
    nation.status !== "imperial" ||
    record.role !== "issuer" ||
    record.issuerId !== self ||
    record.phase !== "decision-required"
  )
    return null;
  if (choice.kind === "enforce" && record.threat === "imperial-war") {
    const reachable = observation.frontiers.some(
      (f) =>
        f.targetId === record.targetId &&
        (f.access === "land" ||
          (f.access === "naval" &&
            observation.visibleAssets.some(
              (a) => a.ownerId === self && a.kind === "transport",
            ))),
    );
    if (!reachable) return null;
  }
  return {
    type: "national_resolve_ultimatum",
    ultimatumId: record.id,
    decision: choice.kind,
    requestId,
  };
}
