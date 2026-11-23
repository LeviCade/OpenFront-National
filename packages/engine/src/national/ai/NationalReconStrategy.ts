import type { NationalObservation, VisibleAsset } from "../observation/NationalObservation";
import { REGIONAL_RECON_COST, REGIONAL_RECON_DURATION_TICKS } from "../observation/NationalReconnaissance";
import { deriveNationalWarSides } from "./NationalPlanner";

/**
 * A deliberately conservative, observation-only AI decision boundary.
 * No Game, Player, map-wide enemy sweep or controller-kind information enters.
 * An observed foreign structure provides the location of a lawful search
 * region; we NEVER reverse-engineer a location from hidden enemy units.
 */
export interface NationalReconAttempt {
  readonly targetId: string;
  readonly anchorAssetId: string;
  readonly requestId: string;
  readonly purchasedTick: number;
  readonly expiresAtTick: number;
  readonly outcome: "accepted" | "rejected";
}

export interface NationalReconDiscovery {
  readonly targetId: string;
  readonly assetId: string;
  readonly kind: "army" | "warship" | "transport";
  readonly observedTick: number;
  readonly expiresAtTick: number;
}

export interface NationalReconMemory {
  readonly observerId: string;
  readonly nextDecisionTick: number;
  readonly attempts: readonly NationalReconAttempt[];
  readonly lastDiscovery: NationalReconDiscovery | null;
}

export interface NationalReconProposal {
  readonly targetId: string;
  readonly anchorAssetId: string;
  readonly centerX: number;
  readonly centerY: number;
}

export interface NationalReconDecision {
  readonly memory: NationalReconMemory;
  readonly purchase: NationalReconProposal | null;
  /** Never suppress defense against another nation or neutral expansion. */
  readonly holdOffenseAgainst: string | null;
}

const MAX_ATTEMPTS = 4;
const SURVIVAL_GOLD_RESERVE = 2_000;
const MIN_SURVIVAL_TROOPS = 1_000;
const RECON_COOLDOWN_TICKS = REGIONAL_RECON_DURATION_TICKS + 60;
const DENIED_COOLDOWN_TICKS = 180;
const militaryKinds = new Set(["army", "warship", "transport"]);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function initialNationalReconMemory(observerId: string): NationalReconMemory {
  return { observerId, nextDecisionTick: 0, attempts: [], lastDiscovery: null };
}

function validForeignMilitary(
  asset: VisibleAsset,
  targetId: string,
  tick: number,
): asset is VisibleAsset & { reconExpiresAtTick: number } {
  return (
    asset.ownerId === targetId &&
    asset.source === "recon" &&
    militaryKinds.has(asset.kind) &&
    asset.reconExpiresAtTick !== undefined &&
    tick < asset.reconExpiresAtTick
  );
}

/** Record ONLY actual current recipient-visible discoveries, never stale fog memory. */
export function planNationalRecon(
  observation: NationalObservation,
  previous: NationalReconMemory,
): NationalReconDecision {
  if (observation.observerId !== previous.observerId)
    throw new Error("NATIONAL recon AI: principal mismatch");
  const self = observation.nations.find((n) => n.id === observation.observerId);
  const sides = deriveNationalWarSides(observation.wars, observation.observerId);
  const protectedPartners = new Set(sides.allies);
  for (const pact of observation.coalitions) {
    if (pact.members.includes(observation.observerId)) {
      for (const id of pact.members) protectedPartners.add(id);
    }
  }
  const discoveries = previous.attempts
    .filter((a) => a.outcome === "accepted" && observation.tick < a.expiresAtTick)
    .flatMap((a) =>
      observation.visibleAssets
        .filter((v) => validForeignMilitary(v, a.targetId, observation.tick))
        .map((v) => ({
          targetId: a.targetId,
          assetId: v.id,
          kind: v.kind as NationalReconDiscovery["kind"],
          observedTick: observation.tick,
          expiresAtTick: v.reconExpiresAtTick!,
        })),
    )
    .sort((a, b) => cmp(a.targetId, b.targetId) || cmp(a.assetId, b.assetId));
  const first = discoveries[0];
  const memory: NationalReconMemory = {
    ...previous,
    lastDiscovery:
      first === undefined
        ? previous.lastDiscovery !== null &&
          observation.tick < previous.lastDiscovery.expiresAtTick
          ? previous.lastDiscovery
          : null
        : first,
  };
  const holdOffenseAgainst =
    memory.lastDiscovery !== null &&
    observation.tick < memory.lastDiscovery.expiresAtTick &&
    observation.frontiers.some(
      (f) => f.targetId === memory.lastDiscovery!.targetId && f.access === "land",
    )
      ? memory.lastDiscovery.targetId
      : null;
  if (
    !self?.alive ||
    self.status !== "independent" ||
    observation.unownedFrontier ||
    observation.ownResources.treasury <
      Number(REGIONAL_RECON_COST) + SURVIVAL_GOLD_RESERVE ||
    observation.ownResources.troops < MIN_SURVIVAL_TROOPS ||
    observation.tick < memory.nextDecisionTick ||
    memory.attempts.length >= MAX_ATTEMPTS
  )
    return { memory, purchase: null, holdOffenseAgainst };

  const candidates = observation.frontiers
    .filter((f) => f.access === "land" && !protectedPartners.has(f.targetId))
    .map((f) => {
      const nation = observation.nations.find((n) => n.id === f.targetId);
      if (!nation?.alive) return null;
      if (memory.attempts.some((a) => a.targetId === f.targetId)) return null;
      // Scouting is worth a fee only at a known militarily relevant front
      // with a disclosed coordinate to extend sight beyond free sensors.
      const anchors = observation.visibleAssets
        .filter(
          (asset) =>
            asset.ownerId === f.targetId &&
            asset.kind === "structure" &&
            asset.source !== "recon" &&
            Number.isSafeInteger(asset.x) &&
            asset.x >= 0 &&
            Number.isSafeInteger(asset.y) &&
            asset.y >= 0,
        )
        .sort((a, b) => cmp(a.id, b.id));
      if (anchors.length === 0) return null;
      // If an actual threat is already visible, preserve funds and respond to
      // known danger instead of paying for redundant reconnaissance.
      if (
        observation.visibleAssets.some(
          (asset) =>
            asset.ownerId === f.targetId && militaryKinds.has(asset.kind),
        )
      )
        return null;
      return {
        targetId: f.targetId,
        anchorAssetId: anchors[0].id,
        centerX: anchors[0].x,
        centerY: anchors[0].y,
        atWar: sides.enemies.has(f.targetId),
        landPercent: nation.landPercent,
      };
    })
    .filter((candidate) => candidate !== null)
    .sort(
      (a, b) =>
        Number(b.atWar) - Number(a.atWar) ||
        b.landPercent - a.landPercent ||
        cmp(a.targetId, b.targetId),
    );
  const top = candidates[0];
  return {
    memory,
    holdOffenseAgainst,
    purchase:
      top === undefined
        ? null
        : {
            targetId: top.targetId,
            anchorAssetId: top.anchorAssetId,
            centerX: top.centerX,
            centerY: top.centerY,
          },
  };
}

/**
 * The engine returns the real grant after debiting exactly 500 Player gold.
 * A rejection records a deterministic cooldown but never claims a purchase.
 * A bounded lifetime attempt count also caps the Game purchase journal.
 */
export function recordNationalReconAttempt(
  observation: NationalObservation,
  previous: NationalReconMemory,
  proposal: NationalReconProposal,
  requestId: string,
  expiresAtTick: number | null,
): NationalReconMemory {
  if (observation.observerId !== previous.observerId)
    throw new Error("NATIONAL recon AI: principal mismatch");
  if (previous.attempts.length >= MAX_ATTEMPTS)
    throw new Error("NATIONAL recon AI: lifetime attempt cap reached");
  const accepted = expiresAtTick !== null;
  return {
    ...previous,
    nextDecisionTick:
      observation.tick +
      (accepted ? RECON_COOLDOWN_TICKS : DENIED_COOLDOWN_TICKS),
    attempts: [
      ...previous.attempts,
      {
        targetId: proposal.targetId,
        anchorAssetId: proposal.anchorAssetId,
        requestId,
        purchasedTick: observation.tick,
        expiresAtTick: expiresAtTick ?? observation.tick,
        outcome: accepted ? "accepted" : "rejected",
      },
    ],
  };
}
