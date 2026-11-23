import { z } from "zod";
import type { Game } from "../../game/Game";

/** Distinct paid M7 nation-strength intelligence, never geographic sight. */
export const NATIONAL_ASSESSMENT_COST = 1200n;
export const NATIONAL_ASSESSMENT_DURATION_TICKS = 900;
const MAX_JOURNAL = 4096;
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const nation = z.string().min(1).max(256);
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const band = z.object({
  lower: z.string().regex(/^(0|[1-9][0-9]*)$/),
  upperExclusive: z.string().regex(/^[1-9][0-9]*$/),
});
const grantSchema = z.object({
  requestId: id, payerId: nation, targetId: nation,
  cost: z.literal("1200"), effectiveTick: tick, expiresAtTick: tick,
  treasuryGoldBand: band, militaryTroopsBand: band,
});
export type NationalAssessmentGrant = z.infer<typeof grantSchema>;
export type NationalAssessmentReport = Omit<NationalAssessmentGrant, "requestId" | "payerId" | "cost"> & {
  readonly paidBy: string; readonly confidence: "coarse-estimate";
};
export const NationalAssessmentSnapshotSchema = z.object({
  version: z.literal(1), grants: z.array(grantSchema).max(MAX_JOURNAL),
});
export type NationalAssessmentSnapshot = z.infer<typeof NationalAssessmentSnapshotSchema>;

/** Called only inside the Game's post-admission/paid server projector. */
export function captureNationalAssessmentBands(gold: bigint, troops: number) {
  if (gold < 0n || !Number.isSafeInteger(troops) || troops < 0)
    throw new Error("NATIONAL assessment: invalid authoritative resources");
  const g = gold / 2500n * 2500n;
  const t = BigInt(troops) / 100000n * 100000n;
  return {
    treasuryGoldBand: { lower: String(g), upperExclusive: String(g + 2500n) },
    militaryTroopsBand: { lower: String(t), upperExclusive: String(t + 100000n) },
  };
}

export class NationalAssessment {
  private readonly grants: NationalAssessmentGrant[] = [];
  private readonly ids = new Set<string>();
  private readonly byPayer = new Map<string, NationalAssessmentGrant[]>();
  private key(payer: string, request: string): string {
    return payer.length + ":" + payer + ":" + request;
  }
  buy(
    payerId: string, targetId: string, now: number, requestId: string,
    charge: () => void, refund: () => void,
    capture: () => ReturnType<typeof captureNationalAssessmentBands>,
  ): NationalAssessmentGrant {
    id.parse(requestId);
    nation.parse(payerId);
    nation.parse(targetId);
    if (payerId === targetId || !Number.isSafeInteger(now) || now < 0 ||
        !Number.isSafeInteger(now + NATIONAL_ASSESSMENT_DURATION_TICKS))
      throw new Error("NATIONAL assessment: invalid purchase parameters");
    const key = this.key(payerId, requestId);
    if (this.ids.has(key)) throw new Error("NATIONAL assessment: duplicate request");
    if (this.grants.length >= MAX_JOURNAL)
      throw new Error("NATIONAL assessment: purchase journal exhausted");
    // Confidential measurements are inaccessible until admission and debit.
    charge();
    let grant: NationalAssessmentGrant;
    try {
      grant = grantSchema.parse({
        requestId, payerId, targetId,
        cost: NATIONAL_ASSESSMENT_COST.toString(),
        effectiveTick: now, expiresAtTick: now + NATIONAL_ASSESSMENT_DURATION_TICKS,
        ...capture(),
      });
    } catch (error) {
      refund();
      throw error;
    }
    this.grants.push(grant);
    this.ids.add(key);
    const own = this.byPayer.get(payerId) ?? [];
    own.push(grant);
    this.byPayer.set(payerId, own);
    return { ...grant, treasuryGoldBand: { ...grant.treasuryGoldBand },
      militaryTroopsBand: { ...grant.militaryTroopsBand } };
  }
  activeFor(payerId: string, now: number): readonly NationalAssessmentGrant[] {
    return (this.byPayer.get(payerId) ?? [])
      .filter((g) => g.effectiveTick <= now && now < g.expiresAtTick)
      .map((g) => ({ ...g, treasuryGoldBand: { ...g.treasuryGoldBand },
        militaryTroopsBand: { ...g.militaryTroopsBand } }));
  }
  snapshot(): NationalAssessmentSnapshot {
    return NationalAssessmentSnapshotSchema.parse({ version: 1, grants: this.grants });
  }
  static restore(raw: unknown, now: number): NationalAssessment {
    const source = NationalAssessmentSnapshotSchema.parse(raw);
    const state = new NationalAssessment();
    for (const g of source.grants) {
      const key = state.key(g.payerId, g.requestId);
      if (g.payerId === g.targetId || state.ids.has(key) ||
          g.effectiveTick > now ||
          g.expiresAtTick !== g.effectiveTick + NATIONAL_ASSESSMENT_DURATION_TICKS ||
          BigInt(g.treasuryGoldBand.upperExclusive) - BigInt(g.treasuryGoldBand.lower) !== 2500n ||
          BigInt(g.militaryTroopsBand.upperExclusive) - BigInt(g.militaryTroopsBand.lower) !== 100000n ||
          BigInt(g.treasuryGoldBand.lower) % 2500n !== 0n ||
          BigInt(g.militaryTroopsBand.lower) % 100000n !== 0n)
        throw new Error("NATIONAL assessment: invalid restored grant");
      state.grants.push(g);
      state.ids.add(key);
      const own = state.byPayer.get(g.payerId) ?? [];
      own.push(g);
      state.byPayer.set(g.payerId, own);
    }
    return state;
  }
}

/**
 * One trusted recipient projector for human and bot. Reciprocal membership
 * is reevaluated every read, including crown change and dissolution.
 */
export function projectLiveNationalAssessments(
  game: Game, recipientId: string,
): readonly NationalAssessmentReport[] {
  if (!game.config().nationalMode() || !game.hasPlayer(recipientId)) return [];
  const recipient = game.player(recipientId);
  if (!recipient.isPlayer() || !recipient.isAlive() || !recipient.hasSpawned())
    return [];
  const auth = game.nationalPoliticalAuthority();
  const empire = auth?.empireOf(recipientId) ?? null;
  const members = empire === null || auth === null
    ? [recipientId]
    : auth.membersOf(empire).includes(recipientId)
      ? auth.membersOf(empire).filter((m) => auth.empireOf(m) === empire)
      : [recipientId];
  const reports: NationalAssessmentReport[] = [];
  for (const payerId of [...new Set(members)].sort()) {
    if (!game.hasPlayer(payerId)) continue;
    const payer = game.player(payerId);
    if (!payer.isAlive() || !payer.hasSpawned()) continue;
    for (const grant of game.nationalAssessmentsFor(payerId)) {
      if (!game.hasPlayer(grant.targetId) || !game.player(grant.targetId).isAlive() ||
          grant.effectiveTick > game.ticks() || game.ticks() >= grant.expiresAtTick)
        continue;
      reports.push({
        targetId: grant.targetId, paidBy: payerId, confidence: "coarse-estimate",
        effectiveTick: grant.effectiveTick, expiresAtTick: grant.expiresAtTick,
        treasuryGoldBand: { ...grant.treasuryGoldBand },
        militaryTroopsBand: { ...grant.militaryTroopsBand },
      });
    }
  }
  reports.sort((a, b) => a.targetId.localeCompare(b.targetId) ||
    a.paidBy.localeCompare(b.paidBy) || a.effectiveTick - b.effectiveTick);
  return reports;
}
