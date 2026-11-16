/**
 * NATIONAL conflict-state rules (D-010, D-014; WAR-01..04, WAR-07).
 *
 * This is an isolated deterministic rules module, NOT the conductor's canonical
 * WarRecord/PoliticalIdentity, command schema, or GameSnapshot definition.
 * M0 must supply a live PoliticsPort and adopt persistence/routing before any
 * result here becomes authoritative in gameplay.
 */

export type ConflictParty = Readonly<{
  kind: "nation" | "empire";
  id: string;
}>;

export interface PoliticsPort {
  /** A nation's present empire, or null when independent. */
  empireOf(nationId: string): string | null;
  /** Current leader's nation ID (changes on transfer). */
  emperorOf(empireId: string): string | null;
  /** Current member nation IDs, including imperial nation. */
  membersOf(empireId: string): readonly string[];
  /** Current live nation and empire facts; must not rely on user claims. */
  nationAlive(nationId: string): boolean;
  empireExists(empireId: string): boolean;
  /** Delegation of member-specific authority; emperor is always authorized. */
  mayDeclareNational(memberId: string): boolean;
  maySettleNational(memberId: string): boolean;
  /** An applicable NAP/MDA still prohibits offensive aggression. */
  treatyProtects(attackerId: string, targetId: string): boolean;
}

type Side = { kind: "nation" | "empire"; id: string };
type Layer = {
  id: string;
  scope: "national" | "imperial";
  first: Side;
  second: Side;
  declaredBy: string;
  startedTick: number;
  endedTick: number | null;
};
type Motion = {
  id: string;
  layerId: string;
  proposedBy: string;
  proposingSide: 0 | 1;
  proposedTick: number;
  acceptedTick: number | null;
  acceptedBy: string | null;
};

/** Standalone portable state only. It is not the canonical engine snapshot. */
export interface ConflictLedgerState {
  readonly version: 1;
  readonly layers: readonly Readonly<Layer>[];
  readonly motions: readonly Readonly<Motion>[];
  readonly lastTick: number;
}

const idCompare = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
const partyKey = (p: Side): string => `${p.kind}:${p.id}`;
const sameParty = (a: Side, b: Side): boolean =>
  a.kind === b.kind && a.id === b.id;

function requireId(id: string): void {
  if (typeof id !== "string" || id.length === 0 || id.length > 256) {
    throw new Error("nonempty bounded identity required");
  }
}
function requireTick(tick: number): void {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new Error("invalid tick");
}
function copyLayer(l: Layer): Layer {
  return { ...l, first: { ...l.first }, second: { ...l.second } };
}
function copyMotion(m: Motion): Motion {
  return { ...m };
}

export class WarLedger {
  private layers = new Map<string, Layer>();
  private motions = new Map<string, Motion>();
  private lastTick = 0;

  constructor(private readonly politics: PoliticsPort) {}

  /** Deterministic export sorted by stable IDs; suitable for an M0 adapter. */
  exportState(): ConflictLedgerState {
    return {
      version: 1,
      layers: [...this.layers.values()]
        .map(copyLayer)
        .sort((a, b) => idCompare(a.id, b.id)),
      motions: [...this.motions.values()]
        .map(copyMotion)
        .sort((a, b) => idCompare(a.id, b.id)),
      lastTick: this.lastTick,
    };
  }

  /** Restores a complete standalone state, never silently drops a war layer. */
  restoreState(state: ConflictLedgerState): void {
    if (state.version !== 1) throw new Error("unknown conflict ledger version");
    requireTick(state.lastTick);
    const layers = new Map<string, Layer>();
    const motions = new Map<string, Motion>();
    for (const item of state.layers) {
      const l = copyLayer(item as Layer);
      requireId(l.id);
      requireId(l.declaredBy);
      requireId(l.first.id);
      requireId(l.second.id);
      requireTick(l.startedTick);
      if (l.startedTick > state.lastTick) throw new Error("future declaration");
      if (l.endedTick !== null) {
        requireTick(l.endedTick);
        if (l.endedTick < l.startedTick || l.endedTick > state.lastTick)
          throw new Error("invalid peace tick");
      }
      if (l.scope !== "national" && l.scope !== "imperial")
        throw new Error("unknown war scope");
      if (sameParty(l.first, l.second)) throw new Error("self-war");
      if (
        l.scope === "national" &&
        (l.first.kind !== "nation" || l.second.kind !== "nation")
      )
        throw new Error("invalid national war");
      if (
        l.scope === "imperial" &&
        l.first.kind !== "empire" &&
        l.second.kind !== "empire"
      )
        throw new Error("imperial war requires empire");
      if (layers.has(l.id)) throw new Error("duplicate war ID");
      layers.set(l.id, l);
    }
    const activePairs = new Set<string>();
    for (const l of layers.values())
      if (l.endedTick === null) {
        const pair = this.pairKey(l.scope, l.first, l.second);
        if (activePairs.has(pair)) throw new Error("duplicate active war");
        activePairs.add(pair);
      }
    for (const item of state.motions) {
      const m = copyMotion(item as Motion);
      requireId(m.id);
      requireId(m.layerId);
      requireId(m.proposedBy);
      requireTick(m.proposedTick);
      if (m.proposingSide !== 0 && m.proposingSide !== 1)
        throw new Error("invalid proposing side");
      const layer = layers.get(m.layerId);
      if (
        !layer ||
        m.proposedTick < layer.startedTick ||
        m.proposedTick > state.lastTick
      )
        throw new Error("orphan/future peace motion");
      if (m.acceptedTick !== null) {
        requireTick(m.acceptedTick);
        if (
          m.acceptedTick < m.proposedTick ||
          m.acceptedTick > state.lastTick ||
          layer.endedTick !== m.acceptedTick ||
          m.acceptedBy === null
        )
          throw new Error("invalid accepted motion");
        requireId(m.acceptedBy);
      } else if (m.acceptedBy !== null)
        throw new Error("invalid acceptance actor");
      if (motions.has(m.id)) throw new Error("duplicate peace ID");
      motions.set(m.id, m);
    }
    this.layers = layers;
    this.motions = motions;
    this.lastTick = state.lastTick;
  }

  /** WAR-01/02: a nation may declare only its own scoped national war. */
  declareNational(
    id: string,
    actorId: string,
    aggressorId: string,
    targetId: string,
    tick: number,
  ): void {
    this.validateClock(tick);
    requireId(id);
    requireId(actorId);
    requireId(aggressorId);
    requireId(targetId);
    if (
      !this.politics.nationAlive(aggressorId) ||
      !this.politics.nationAlive(targetId)
    )
      throw new Error("dead or unknown belligerent");
    if (aggressorId === targetId || this.sameEmpire(aggressorId, targetId))
      throw new Error("internal war forbidden");
    if (this.politics.treatyProtects(aggressorId, targetId))
      throw new Error("betray protected treaty first");
    this.requireNationalAuthority(actorId, aggressorId, "declare");
    this.addLayer({
      id,
      scope: "national",
      first: { kind: "nation", id: aggressorId },
      second: { kind: "nation", id: targetId },
      declaredBy: actorId,
      startedTick: tick,
      endedTick: null,
    });
    this.lastTick = tick;
  }

  /** WAR-03/07: an empire is represented by its stable empire ID, not crown holder. */
  declareImperial(
    id: string,
    actorId: string,
    aggressor: ConflictParty,
    target: ConflictParty,
    tick: number,
  ): void {
    this.validateClock(tick);
    requireId(id);
    requireId(actorId);
    requireId(aggressor.id);
    requireId(target.id);
    this.validateImperialSide(aggressor);
    this.validateImperialSide(target);
    if (aggressor.kind !== "empire" && target.kind !== "empire")
      throw new Error("imperial war requires an empire");
    if (sameParty(aggressor, target)) throw new Error("self-war");
    if (
      aggressor.kind === "empire" &&
      target.kind === "nation" &&
      this.politics.empireOf(target.id) === aggressor.id
    )
      throw new Error("internal war forbidden");
    if (
      target.kind === "empire" &&
      aggressor.kind === "nation" &&
      this.politics.empireOf(aggressor.id) === target.id
    )
      throw new Error("internal war forbidden");
    if (!this.mayActImperially(actorId, aggressor))
      throw new Error("imperial declaration not authorized");
    const attackers = this.expand(aggressor),
      targets = this.expand(target);
    for (const a of attackers)
      for (const b of targets) {
        if (a === b || this.politics.treatyProtects(a, b))
          throw new Error("betray protected treaty first");
      }
    this.addLayer({
      id,
      scope: "imperial",
      first: { ...aggressor },
      second: { ...target },
      declaredBy: actorId,
      startedTick: tick,
      endedTick: null,
    });
    this.lastTick = tick;
  }

  proposePeace(id: string, warId: string, actorId: string, tick: number): void {
    this.validateClock(tick);
    requireId(id);
    requireId(actorId);
    if (this.motions.has(id)) throw new Error("peace ID already used");
    const war = this.requireActive(warId);
    const side = this.authorizedSide(war, actorId, "peace");
    if (side === null) throw new Error("peace proposal not authorized");
    // Only one outstanding motion per side per layer; prevent replay spam.
    if (
      [...this.motions.values()].some(
        (m) =>
          m.layerId === warId &&
          m.proposingSide === side &&
          m.acceptedTick === null,
      )
    )
      throw new Error("peace motion already pending");
    this.motions.set(id, {
      id,
      layerId: warId,
      proposedBy: actorId,
      proposingSide: side,
      proposedTick: tick,
      acceptedTick: null,
      acceptedBy: null,
    });
    this.lastTick = tick;
  }

  /** WAR-04: only the selected record closes; other war layers survive. */
  acceptPeace(motionId: string, actorId: string, tick: number): void {
    this.validateClock(tick);
    requireId(actorId);
    const motion = this.motions.get(motionId);
    if (!motion || motion.acceptedTick !== null)
      throw new Error("no pending peace motion");
    const war = this.requireActive(motion.layerId);
    const side = this.authorizedSide(war, actorId, "peace");
    if (side === null || side === motion.proposingSide)
      throw new Error("other belligerent must accept peace");
    war.endedTick = tick;
    motion.acceptedTick = tick;
    motion.acceptedBy = actorId;
    // Clear all other pending motions for the closed layer, not their war records.
    for (const [id, candidate] of this.motions)
      if (
        id !== motionId &&
        candidate.layerId === war.id &&
        candidate.acceptedTick === null
      )
        this.motions.delete(id);
    this.lastTick = tick;
  }

  /** Derived hostility; never stores a mutable hostile flag. */
  atWar(nationA: string, nationB: string): boolean {
    if (nationA === nationB) return false;
    for (const l of this.layers.values()) {
      if (l.endedTick !== null) continue;
      const aa =
        this.sideContains(l.first, nationA) &&
        this.sideContains(l.second, nationB);
      const bb =
        this.sideContains(l.first, nationB) &&
        this.sideContains(l.second, nationA);
      if (aa || bb) return true;
    }
    return false;
  }

  /** Terra nullius capture is not an offensive action against a nation. */
  authorizeOffensiveAction(
    attackerId: string,
    targetId: string | null,
  ): boolean {
    // Even neutral territory needs an existing, living authoritative actor.
    if (!this.politics.nationAlive(attackerId)) return false;
    if (targetId === null) return true;
    if (!this.politics.nationAlive(targetId)) return false;
    if (attackerId === targetId || this.sameEmpire(attackerId, targetId))
      return false;
    if (this.politics.treatyProtects(attackerId, targetId)) return false;
    return this.atWar(attackerId, targetId);
  }

  private validateClock(tick: number): void {
    requireTick(tick);
    if (tick < this.lastTick) throw new Error("out-of-order tick");
  }
  private pairKey(scope: string, a: Side, b: Side): string {
    const keys = [partyKey(a), partyKey(b)].sort(idCompare);
    return `${scope}|${keys[0]}|${keys[1]}`;
  }
  private addLayer(l: Layer): void {
    if (this.layers.has(l.id)) throw new Error("war ID already used");
    if (
      [...this.layers.values()].some(
        (active) =>
          active.endedTick === null &&
          this.pairKey(active.scope, active.first, active.second) ===
            this.pairKey(l.scope, l.first, l.second),
      )
    )
      throw new Error("war already active");
    this.layers.set(l.id, l);
  }
  private requireActive(id: string): Layer {
    const l = this.layers.get(id);
    if (!l || l.endedTick !== null) throw new Error("unknown or settled war");
    return l;
  }
  private sameEmpire(a: string, b: string): boolean {
    const e = this.politics.empireOf(a);
    return e !== null && e === this.politics.empireOf(b);
  }
  private validateImperialSide(p: ConflictParty): void {
    if (p.kind === "empire") {
      if (
        !this.politics.empireExists(p.id) ||
        this.politics.emperorOf(p.id) === null
      )
        throw new Error("unknown empire");
    } else if (p.kind === "nation") {
      if (
        !this.politics.nationAlive(p.id) ||
        this.politics.empireOf(p.id) !== null
      )
        throw new Error("imperial war nation party must be independent");
    } else throw new Error("unknown political party kind");
  }
  private expand(p: Side): readonly string[] {
    return p.kind === "nation" ? [p.id] : this.politics.membersOf(p.id);
  }
  private sideContains(p: Side, nationId: string): boolean {
    return p.kind === "nation"
      ? p.id === nationId
      : this.politics.empireOf(nationId) === p.id;
  }
  private mayActImperially(actorId: string, side: Side): boolean {
    return side.kind === "nation"
      ? actorId === side.id && this.politics.nationAlive(side.id)
      : this.politics.emperorOf(side.id) === actorId;
  }
  private requireNationalAuthority(
    actor: string,
    nation: string,
    action: "declare" | "peace",
  ): void {
    const empire = this.politics.empireOf(nation);
    if (empire === null) {
      if (actor !== nation) throw new Error("national authority denied");
    } else if (
      this.politics.emperorOf(empire) !== actor &&
      !(
        actor === nation &&
        (action === "declare"
          ? this.politics.mayDeclareNational(nation)
          : this.politics.maySettleNational(nation))
      )
    ) {
      throw new Error("national authority denied");
    }
  }
  private authorizedSide(
    war: Layer,
    actor: string,
    action: "peace",
  ): 0 | 1 | null {
    const sides = [war.first, war.second] as const;
    for (const index of [0, 1] as const) {
      const s = sides[index];
      if (war.scope === "national") {
        try {
          this.requireNationalAuthority(actor, s.id, action);
          return index;
        } catch {
          /* other side or forbidden */
        }
      } else if (this.mayActImperially(actor, s)) return index;
    }
    return null;
  }
}
