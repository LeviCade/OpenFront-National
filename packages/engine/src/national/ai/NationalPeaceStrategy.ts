import { z } from "zod";
import type { NationalObservation } from "../observation/NationalObservation";
import { deriveNationalWarSides } from "./NationalPlanner";

const LIMIT = 32;
const RETRY_TICKS = 120;
const TRUCE_TICKS = 600;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const tick = z.number().int().nonnegative();

export const NationalPeaceMemorySchema = z.object({
  observerId: z.string(),
  wars: z
    .array(
      z.object({
        warId: z.string(),
        peakTroops: z.number().nonnegative(),
        retryAfterTick: tick,
        lastOutcome: z.enum(["accepted", "rejected"]).nullable(),
      }),
    )
    .max(LIMIT),
  enemies: z.array(z.string()).max(LIMIT),
  truces: z
    .array(z.object({ targetId: z.string(), untilTick: tick }))
    .max(LIMIT),
});
export type NationalPeaceMemory = z.infer<typeof NationalPeaceMemorySchema>;
export type NationalPeaceChoice =
  | { kind: "propose-peace"; warId: string }
  | { kind: "accept-peace"; warId: string; motionId: string };

/**
 * C6C2-E5: observation-only negotiation, never a second authority or ledger.
 * Public territory, actual reach, sighted military and own troop attrition
 * inform survival. Neither controller identity nor foreign balances enter.
 */
export function planNationalPeace(
  observation: NationalObservation,
  previous: NationalPeaceMemory | null,
): { memory: NationalPeaceMemory; choice: NationalPeaceChoice | null } {
  const { observerId, ownResources, tick } = observation;
  if (previous !== null && previous.observerId !== observerId)
    throw new Error("NATIONAL peace memory principal mismatch");
  const enemies = deriveNationalWarSides(observation.wars, observerId).enemies;
  const truces = new Map(
    (previous?.truces ?? [])
      .filter((item) => item.untilTick > tick)
      .map((item) => [item.targetId, item.untilTick]),
  );
  for (const id of previous?.enemies ?? []) {
    if (!enemies.has(id)) truces.set(id, tick + TRUCE_TICKS);
  }
  // A surviving parallel WAR takes precedence over any no-redeclaration hold.
  for (const id of enemies) truces.delete(id);
  const memory: NationalPeaceMemory = {
    observerId,
    wars: [],
    enemies: [...enemies].sort(cmp).slice(0, LIMIT),
    truces: [...truces]
      .map(([targetId, untilTick]) => ({ targetId, untilTick }))
      .sort((a, b) => b.untilTick - a.untilTick || cmp(a.targetId, b.targetId))
      .slice(0, LIMIT),
  };
  const nations = new Map(observation.nations.map((n) => [n.id, n]));
  const self = nations.get(observerId);
  if (!self?.alive) return { memory, choice: null };
  const wars = new Map(observation.wars.map((war) => [war.id, war]));
  const prior = new Map((previous?.wars ?? []).map((war) => [war.warId, war]));
  const fronts = new Set(observation.frontiers.map((front) => front.targetId));
  const military = new Set(
    observation.visibleAssets
      .filter((asset) => asset.kind === "army" || asset.kind === "warship")
      .map((asset) => asset.ownerId),
  );
  let choice: NationalPeaceChoice | null = null;
  const negotiations = [...(observation.peaceNegotiations ?? [])]
    .sort((a, b) => cmp(a.warId, b.warId))
    .slice(0, LIMIT);
  for (const negotiation of negotiations) {
    const war = wars.get(negotiation.warId);
    if (!war || war.startedTick > tick) continue;
    const old = prior.get(war.id);
    const peakTroops = Math.max(ownResources.troops, old?.peakTroops ?? 0);
    const row = {
      warId: war.id,
      peakTroops,
      retryAfterTick: old?.retryAfterTick ?? 0,
      lastOutcome: old?.lastOutcome ?? null,
    };
    memory.wars.push(row);
    if (tick < row.retryAfterTick) continue;
    const ownSide = negotiation.side === 0 ? war.first : war.second;
    const opposing = negotiation.side === 0 ? war.second : war.first;
    const ownLand = ownSide.activeMemberIds.reduce(
      (sum, id) => sum + (nations.get(id)?.landPercent ?? 0),
      0,
    );
    const enemyLand = opposing.activeMemberIds.reduce(
      (sum, id) => sum + (nations.get(id)?.landPercent ?? 0),
      0,
    );
    const reachable = opposing.activeMemberIds.some((id) => fronts.has(id));
    const visibleThreat = opposing.activeMemberIds.some((id) =>
      military.has(id),
    );
    const overmatched = enemyLand >= Math.max(1, ownLand * 1.5);
    const attrition =
      peakTroops >= 1000 && ownResources.troops <= peakTroops * 0.55;
    const vulnerable =
      (overmatched && ownResources.troops <= 1000) ||
      (attrition && (overmatched || visibleThreat));
    const exhaustedRemoteWar =
      !reachable && !visibleThreat && tick - war.startedTick >= 180 &&
      ownResources.troops <= 1000;
    if (!((reachable || visibleThreat) && vulnerable) && !exhaustedRemoteWar)
      continue;
    const incoming = [...negotiation.incomingMotionIds].sort(cmp)[0];
    if (incoming !== undefined) {
      // Prefer a genuine incoming motion over opening a competing motion.
      if (choice?.kind !== "accept-peace")
        choice = { kind: "accept-peace", warId: war.id, motionId: incoming };
    } else if (!negotiation.outgoingPending && choice === null) {
      choice = { kind: "propose-peace", warId: war.id };
    }
  }
  return { memory, choice };
}

/** Only a verified synchronous canonical Game result may set an outcome. */
export function recordNationalPeaceOutcome(
  memory: NationalPeaceMemory,
  choice: NationalPeaceChoice,
  tick: number,
  accepted: boolean | null,
): NationalPeaceMemory {
  return {
    ...memory,
    wars: memory.wars.map((row) =>
      row.warId === choice.warId
        ? {
            ...row,
            retryAfterTick: tick + RETRY_TICKS,
            lastOutcome:
              accepted === null ? null : accepted ? "accepted" : "rejected",
          }
        : row,
    ),
  };
}

export function holdsNationalPeace(
  memory: NationalPeaceMemory | null,
  targetId: string,
  tick: number,
): boolean {
  return (
    memory?.truces.some(
      (row) => row.targetId === targetId && row.untilTick > tick,
    ) ?? false
  );
}
