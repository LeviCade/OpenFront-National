/**
 * NATIONAL observation boundary (D-002, D-017; FOG-01, FOG-02, FOG-07).
 *
 * Only the authoritative simulation may construct NationalWorld. Never accept
 * this object or sight grants from a client. The projection is a whitelist,
 * not a copy of game state, and must be used for both human and AI consumers.
 *
 * Integration awaits the conductor's M0 political/wire/snapshot contracts.
 */
export type NationId = string;
export type CoalitionKind = "nap" | "mda" | "empire";
export type SovereignStatus =
  | "independent"
  | "imperial"
  | "member"
  | "eliminated";
export type AssetKind =
  | "army"
  | "structure"
  | "warship"
  | "transport"
  | "trade-ship";
export type SightSource = "border" | "coast" | "warship" | "recon";

export interface NationalNation {
  readonly id: NationId;
  readonly name: string;
  readonly landPercent: number;
  readonly status: SovereignStatus;
  readonly alive: boolean;
  /** Authoritative only; deliberately absent from every observation. */
  readonly controllerKind?: "human" | "ai";
  readonly troops: number;
  readonly treasury: number;
}

export interface NationalCoalition {
  readonly id: string;
  readonly kind: CoalitionKind;
  readonly leaderId: NationId;
  readonly members: readonly NationId[];
  /** These primitive terms NEVER appear in an outsider's projection. */
  readonly terms: Readonly<Record<string, string | number | boolean>>;
}

export interface NationalWar {
  readonly id: string;
  readonly participants: readonly NationId[];
}

export interface NationalInvitation {
  readonly coalitionId: string;
  readonly recipientId: NationId;
}

export interface NationalAsset {
  readonly id: string;
  readonly ownerId: NationId;
  readonly kind: AssetKind;
  readonly x: number;
  readonly y: number;
  readonly strength?: number;
  /** Never exposed, even if a transport has been sighted. */
  readonly landingDestination?: { readonly x: number; readonly y: number };
}

/** A currently valid sight grant produced by trusted geographic/recon logic. */
export interface NationalSightGrant {
  readonly observerId: NationId;
  readonly assetId: string;
  readonly source: SightSource;
  readonly observedAtTick: number;
  readonly expiresAtTick: number;
}

export interface NationalFrontier {
  /** Trusted, already-discovered geography, not a globally scanned target list. */
  readonly observerId: NationId;
  readonly targetId: NationId;
  readonly access: "land" | "naval";
}

export type PublicDiplomaticEventKind =
  | "treaty-kept"
  | "treaty-broken"
  | "threat-fulfilled"
  | "bluff-exposed";

export interface NationalDiplomaticEvent {
  readonly id: string;
  readonly tick: number;
  readonly actorId: NationId;
  readonly kind: PublicDiplomaticEventKind;
  readonly public: boolean;
  readonly visibleTo?: readonly NationId[];
}

export interface NationalWorld {
  readonly tick: number;
  readonly nations: readonly NationalNation[];
  readonly coalitions: readonly NationalCoalition[];
  readonly wars: readonly NationalWar[];
  readonly invitations: readonly NationalInvitation[];
  readonly assets: readonly NationalAsset[];
  readonly sightGrants: readonly NationalSightGrant[];
  readonly frontiers: readonly NationalFrontier[];
  readonly diplomaticEvents: readonly NationalDiplomaticEvent[];
}

export interface PublicNation {
  readonly id: NationId;
  readonly name: string;
  readonly landPercent: number;
  readonly status: SovereignStatus;
  readonly alive: boolean;
}

export interface CoalitionObservation {
  readonly id: string;
  readonly kind: CoalitionKind;
  readonly leaderId: NationId;
  readonly members: readonly NationId[];
  /** Only members and current, addressed invitees receive the terms. */
  readonly terms?: Readonly<Record<string, string | number | boolean>>;
  readonly invited?: true;
}

export interface VisibleAsset {
  readonly id: string;
  readonly ownerId: NationId;
  readonly kind: AssetKind;
  readonly x: number;
  readonly y: number;
  readonly source: SightSource | "own" | "empire";
  /** Origin of inherited empire sight, for revocation after dissolution. */
  readonly sourceNationId?: NationId;
  readonly strength?: number;
}

export interface NationalObservation {
  readonly observerId: NationId;
  readonly tick: number;
  readonly nations: readonly PublicNation[];
  readonly coalitions: readonly CoalitionObservation[];
  readonly wars: readonly NationalWar[];
  readonly ownResources: { readonly troops: number; readonly treasury: number };
  readonly visibleAssets: readonly VisibleAsset[];
  readonly frontiers: readonly {
    readonly targetId: NationId;
    readonly access: "land" | "naval";
  }[];
  readonly diplomaticEvents: readonly NationalDiplomaticEvent[];
}

export interface LastKnownAsset {
  readonly id: string;
  readonly ownerId: NationId;
  readonly kind: AssetKind;
  readonly x: number;
  readonly y: number;
  readonly lastSeenTick: number;
  readonly sourceNationId?: NationId;
}

export interface NationalSightMemory {
  readonly observerId: NationId;
  readonly assets: readonly LastKnownAsset[];
}

const byId = (
  a: { readonly id: string },
  b: { readonly id: string },
): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byTarget = (
  a: { readonly targetId: string; readonly access: string },
  b: { readonly targetId: string; readonly access: string },
): number =>
  byId(
    { id: a.targetId + "/" + a.access },
    { id: b.targetId + "/" + b.access },
  );

/**
 * Pure projection. Grant lists and treaty invitations MUST be built/validated
 * by authoritative game state; clients cannot create or amend them.
 *
 * O(nations + coalitions*members + wars + grants + assets + frontiers).
 * No scan of all assets per viewer, and no read of hidden asset properties.
 */
export function projectNationalObservation(
  world: NationalWorld,
  observerId: NationId,
): NationalObservation {
  const own = world.nations.find((n) => n.id === observerId);
  if (!own) throw new Error("Unknown observation principal");
  const present = new Set(world.nations.map((n) => n.id));

  // Only a present empire (never an ordinary coalition) confers shared sight.
  const empire = world.coalitions.find(
    (c) => c.kind === "empire" && c.members.includes(observerId),
  );
  const intelligencePrincipals = new Set(empire?.members ?? [observerId]);
  const invitedTo = new Set(
    world.invitations
      .filter((inv) => inv.recipientId === observerId)
      .map((inv) => inv.coalitionId),
  );
  const coalitionObservations = world.coalitions.map(
    (c): CoalitionObservation => {
      const admitted = c.members.includes(observerId);
      const invited = !admitted && invitedTo.has(c.id);
      const base: CoalitionObservation = {
        id: c.id,
        kind: c.kind,
        leaderId: c.leaderId,
        members: [...c.members].sort(),
      };
      if (!admitted && !invited) return base;
      return {
        ...base,
        terms: { ...c.terms },
        ...(invited ? { invited: true as const } : {}),
      };
    },
  );

  // Grants are the sole foreign visibility path. They expire or are revoked
  // by the authoritative observation producer when line of sight is lost.
  const validGrant = new Map<string, NationalSightGrant>();
  for (const grant of world.sightGrants) {
    if (!intelligencePrincipals.has(grant.observerId)) continue;
    if (grant.observedAtTick > world.tick || grant.expiresAtTick < world.tick)
      continue;
    const previous = validGrant.get(grant.assetId);
    if (
      !previous ||
      grant.observedAtTick > previous.observedAtTick ||
      (grant.observedAtTick === previous.observedAtTick &&
        (grant.observerId < previous.observerId ||
          (grant.observerId === previous.observerId &&
            grant.source < previous.source)))
    ) {
      validGrant.set(grant.assetId, grant);
    }
  }

  const visibleAssets: VisibleAsset[] = [];
  for (const asset of world.assets) {
    if (asset.ownerId === observerId) {
      visibleAssets.push({
        id: asset.id,
        ownerId: asset.ownerId,
        kind: asset.kind,
        x: asset.x,
        y: asset.y,
        source: "own",
        ...(asset.strength === undefined ? {} : { strength: asset.strength }),
      });
      continue;
    }
    const grant = validGrant.get(asset.id);
    if (grant === undefined) continue;
    visibleAssets.push({
      id: asset.id,
      ownerId: asset.ownerId,
      kind: asset.kind,
      x: asset.x,
      y: asset.y,
      source: grant.observerId === observerId ? grant.source : "empire",
      ...(grant.observerId === observerId
        ? {}
        : { sourceNationId: grant.observerId }),
    });
  }

  const frontiers = world.frontiers
    .filter(
      (f) =>
        f.observerId === observerId &&
        present.has(f.targetId) &&
        f.targetId !== observerId,
    )
    .map((f) => ({ targetId: f.targetId, access: f.access }))
    .sort(byTarget);

  return {
    observerId,
    tick: world.tick,
    nations: world.nations
      .map((n) => ({
        id: n.id,
        name: n.name,
        landPercent: n.landPercent,
        status: n.status,
        alive: n.alive,
      }))
      .sort(byId),
    coalitions: coalitionObservations.sort(byId),
    wars: world.wars
      .map((w) => ({ id: w.id, participants: [...w.participants].sort() }))
      .sort(byId),
    ownResources: { troops: own.troops, treasury: own.treasury },
    visibleAssets: visibleAssets.sort(byId),
    frontiers,
    diplomaticEvents: world.diplomaticEvents
      .filter(
        (e) =>
          e.tick <= world.tick &&
          (e.public ||
            e.visibleTo?.some((id) => intelligencePrincipals.has(id))),
      )
      .map((e) => ({
        id: e.id,
        tick: e.tick,
        actorId: e.actorId,
        kind: e.kind,
        public: e.public,
      }))
      .sort((a, b) => a.tick - b.tick || byId(a, b)),
  };
}

/**
 * Retain only a previously observed position, with an explicit stale timestamp.
 * A disappearing asset never has its new location read from authoritative state.
 * The caller owns persistence in the eventual M0 snapshot model.
 */
export function advanceLastKnown(
  observation: NationalObservation,
  previous: NationalSightMemory | null,
  retentionTicks: number,
): { memory: NationalSightMemory; stale: readonly LastKnownAsset[] } {
  if (!Number.isSafeInteger(retentionTicks) || retentionTicks < 0) {
    throw new Error("retentionTicks must be a nonnegative integer");
  }
  if (previous && previous.observerId !== observation.observerId) {
    throw new Error("Cannot share sight memory between observers");
  }
  const live = new Set(observation.visibleAssets.map((u) => u.id));
  const remembered = new Map<string, LastKnownAsset>();
  for (const entry of previous?.assets ?? []) {
    if (entry.lastSeenTick > observation.tick) continue;
    // Shared intelligence rights end when the relevant empire dissolves.
    if (
      entry.sourceNationId !== undefined &&
      !observation.coalitions.some(
        (c) =>
          c.kind === "empire" &&
          c.members.includes(observation.observerId) &&
          c.members.includes(entry.sourceNationId!),
      )
    )
      continue;
    if (observation.tick - entry.lastSeenTick <= retentionTicks) {
      remembered.set(entry.id, { ...entry });
    }
  }
  for (const unit of observation.visibleAssets) {
    remembered.set(unit.id, {
      id: unit.id,
      ownerId: unit.ownerId,
      kind: unit.kind,
      x: unit.x,
      y: unit.y,
      lastSeenTick: observation.tick,
      ...(unit.sourceNationId === undefined
        ? {}
        : { sourceNationId: unit.sourceNationId }),
    });
  }
  const entries = [...remembered.values()].sort(byId);
  return {
    memory: { observerId: observation.observerId, assets: entries },
    stale: entries.filter((entry) => !live.has(entry.id)),
  };
}
