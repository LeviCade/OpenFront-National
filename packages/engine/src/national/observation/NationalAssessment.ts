import { z } from "zod";
import type { Game } from "../../game/Game";

/** Distinct paid M7 nation-strength intelligence, never geographic sight. */
export const NATIONAL_ASSESSMENT_COST = 1200n;
export const NATIONAL_ASSESSMENT_DURATION_TICKS = 900;
/** Paid defense changes only future hostile report precision. */
export const NATIONAL_COUNTERASSESSMENT_COST = 1800n;
export const NATIONAL_COUNTERASSESSMENT_DURATION_TICKS = 600;
const SHIELDED_GOLD_STEP = 10000n;
const SHIELDED_TROOP_STEP = 400000n;
const MAX_ACTIVE_SHIELDS = 512;
const MAX_JOURNAL = 4096;
/** Never exceed the strict per-recipient trusted wire DTO item capacity. */
const MAX_ACTIVE_GRANTS = 2048;
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const nation = z.string().min(1).max(256);
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const band = z.object({
  lower: z.string().regex(/^(0|[1-9][0-9]*)$/),
  upperExclusive: z.string().regex(/^[1-9][0-9]*$/),
});
const grantSchema = z.object({
  requestId: id,
  payerId: nation,
  targetId: nation,
  cost: z.literal("1200"),
  effectiveTick: tick,
  expiresAtTick: tick,
  treasuryGoldBand: band,
  militaryTroopsBand: band,
  confidence: z.enum(["coarse-estimate", "shielded-coarse-estimate"]).optional(),
}).strict();
const shieldSchema = z.object({
  requestId: id,
  defenderId: nation,
  cost: z.literal("1800"),
  effectiveTick: tick,
  expiresAtTick: tick,
}).strict();
export type NationalAssessmentShield = z.infer<typeof shieldSchema>;
export type NationalAssessmentGrant = z.infer<typeof grantSchema>;
export type NationalAssessmentReport = Omit<
  NationalAssessmentGrant,
  "requestId" | "payerId" | "cost" | "confidence"
> & {
  readonly paidBy: string;
  readonly confidence: "coarse-estimate" | "shielded-coarse-estimate";
};
export const NationalAssessmentSnapshotSchema = z.object({
  version: z.literal(1),
  grants: z.array(grantSchema).max(MAX_JOURNAL),
  /** Optional additive migration from inherited Game v6 assessments. */
  shields: z.array(shieldSchema).max(MAX_JOURNAL).optional(),
});
export type NationalAssessmentSnapshot = z.infer<
  typeof NationalAssessmentSnapshotSchema
>;

/** Called only inside the Game's post-admission/paid server projector. */
export function captureNationalAssessmentBands(
  gold: bigint,
  troops: number,
  shielded = false,
) {
  if (gold < 0n || !Number.isSafeInteger(troops) || troops < 0)
    throw new Error("NATIONAL assessment: invalid authoritative resources");
  const goldStep = shielded ? SHIELDED_GOLD_STEP : 2500n;
  const troopStep = shielded ? SHIELDED_TROOP_STEP : 100000n;
  const g = (gold / goldStep) * goldStep;
  const t = (BigInt(troops) / troopStep) * troopStep;
  return {
    confidence: shielded ? ("shielded-coarse-estimate" as const) : ("coarse-estimate" as const),
    treasuryGoldBand: { lower: String(g), upperExclusive: String(g + goldStep) },
    militaryTroopsBand: {
      lower: String(t),
      upperExclusive: String(t + troopStep),
    },
  };
}

export class NationalAssessment {
  private readonly grants: NationalAssessmentGrant[] = [];
  private readonly ids = new Set<string>();
  private readonly byPayer = new Map<string, NationalAssessmentGrant[]>();
  private readonly shields: NationalAssessmentShield[] = [];
  private readonly shieldIds = new Set<string>();
  buyShield(
    defenderId: string,
    now: number,
    requestId: string,
    charge: () => void,
    refund: () => void,
  ): NationalAssessmentShield {
    id.parse(requestId);
    nation.parse(defenderId);
    if (!Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(now + NATIONAL_COUNTERASSESSMENT_DURATION_TICKS))
      throw new Error("NATIONAL counterassessment: invalid tick");
    const key = this.key(defenderId, requestId);
    if (this.shieldIds.has(key))
      throw new Error("NATIONAL counterassessment: duplicate request");
    if (this.shields.length >= MAX_JOURNAL)
      throw new Error("NATIONAL counterassessment: shield journal exhausted");
    if (this.isShielded(defenderId, now))
      throw new Error("NATIONAL counterassessment: shield already active");
    let activeCount = 0;
    for (const shield of this.shields)
      if (shield.effectiveTick <= now && now < shield.expiresAtTick) activeCount++;
    if (activeCount >= MAX_ACTIVE_SHIELDS)
      throw new Error("NATIONAL counterassessment: active shield capacity exhausted");
    charge();
    let shield: NationalAssessmentShield;
    try {
      shield = shieldSchema.parse({
        defenderId, requestId,
        cost: NATIONAL_COUNTERASSESSMENT_COST.toString(),
        effectiveTick: now,
        expiresAtTick: now + NATIONAL_COUNTERASSESSMENT_DURATION_TICKS,
      });
    } catch (error) { refund(); throw error; }
    this.shields.push(shield);
    this.shieldIds.add(key);
    return { ...shield };
  }
  isShielded(defenderId: string, now: number): boolean {
    return this.shields.some((s) =>
      s.defenderId === defenderId &&
      s.effectiveTick <= now && now < s.expiresAtTick);
  }
  private key(payer: string, request: string): string {
    return payer.length + ":" + payer + ":" + request;
  }
  buy(
    payerId: string,
    targetId: string,
    now: number,
    requestId: string,
    charge: () => void,
    refund: () => void,
    capture: () => ReturnType<typeof captureNationalAssessmentBands>,
  ): NationalAssessmentGrant {
    id.parse(requestId);
    nation.parse(payerId);
    nation.parse(targetId);
    if (
      payerId === targetId ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !Number.isSafeInteger(now + NATIONAL_ASSESSMENT_DURATION_TICKS)
    )
      throw new Error("NATIONAL assessment: invalid purchase parameters");
    const key = this.key(payerId, requestId);
    if (this.ids.has(key))
      throw new Error("NATIONAL assessment: duplicate request");
    if (this.grants.length >= MAX_JOURNAL)
      throw new Error("NATIONAL assessment: purchase journal exhausted");
    let activeCount = 0;
    for (const grant of this.grants)
      if (grant.effectiveTick <= now && now < grant.expiresAtTick)
        activeCount++;
    // Bound a reciprocal empire's worst-case packet before spending gold.
    // Expired receipts remain in the journal to reject request replay.
    if (activeCount >= MAX_ACTIVE_GRANTS)
      throw new Error("NATIONAL assessment: active report capacity exhausted");
    // Confidential measurements are inaccessible until admission and debit.
    charge();
    let grant: NationalAssessmentGrant;
    try {
      grant = grantSchema.parse({
        requestId,
        payerId,
        targetId,
        cost: NATIONAL_ASSESSMENT_COST.toString(),
        effectiveTick: now,
        expiresAtTick: now + NATIONAL_ASSESSMENT_DURATION_TICKS,
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
    return {
      ...grant,
      treasuryGoldBand: { ...grant.treasuryGoldBand },
      militaryTroopsBand: { ...grant.militaryTroopsBand },
    };
  }
  activeFor(payerId: string, now: number): readonly NationalAssessmentGrant[] {
    return (this.byPayer.get(payerId) ?? [])
      .filter((g) => g.effectiveTick <= now && now < g.expiresAtTick)
      .map((g) => ({
        ...g,
        treasuryGoldBand: { ...g.treasuryGoldBand },
        militaryTroopsBand: { ...g.militaryTroopsBand },
      }));
  }
  snapshot(): NationalAssessmentSnapshot {
    return NationalAssessmentSnapshotSchema.parse({
      version: 1,
      grants: this.grants,
      shields: this.shields,
    });
  }
  static restore(raw: unknown, now: number): NationalAssessment {
    const source = NationalAssessmentSnapshotSchema.parse(raw);
    const state = new NationalAssessment();
    let activeCount = 0;
    for (const g of source.grants) {
      const goldStep = g.confidence === "shielded-coarse-estimate" ? SHIELDED_GOLD_STEP : 2500n;
      const troopStep = g.confidence === "shielded-coarse-estimate" ? SHIELDED_TROOP_STEP : 100000n;
      const key = state.key(g.payerId, g.requestId);
      if (
        g.payerId === g.targetId ||
        state.ids.has(key) ||
        g.effectiveTick > now ||
        g.expiresAtTick !==
          g.effectiveTick + NATIONAL_ASSESSMENT_DURATION_TICKS ||
        BigInt(g.treasuryGoldBand.upperExclusive) -
          BigInt(g.treasuryGoldBand.lower) !==
          goldStep ||
        BigInt(g.militaryTroopsBand.upperExclusive) -
          BigInt(g.militaryTroopsBand.lower) !==
          troopStep ||
        BigInt(g.treasuryGoldBand.lower) % goldStep !== 0n ||
        BigInt(g.militaryTroopsBand.lower) % troopStep !== 0n
      )
        throw new Error("NATIONAL assessment: invalid restored grant");
      if (g.effectiveTick <= now && now < g.expiresAtTick) activeCount++;
      if (activeCount > MAX_ACTIVE_GRANTS)
        throw new Error(
          "NATIONAL assessment: invalid restored active capacity",
        );
      state.grants.push(g);
      state.ids.add(key);
      const own = state.byPayer.get(g.payerId) ?? [];
      own.push(g);
      state.byPayer.set(g.payerId, own);
    }
    let activeShields = 0;
    for (const shield of source.shields ?? []) {
      const key = state.key(shield.defenderId, shield.requestId);
      if (
        state.shieldIds.has(key) ||
        shield.effectiveTick > now ||
        shield.expiresAtTick !== shield.effectiveTick + NATIONAL_COUNTERASSESSMENT_DURATION_TICKS ||
        state.shields.some((old) => old.defenderId === shield.defenderId &&
          old.effectiveTick < shield.expiresAtTick &&
          shield.effectiveTick < old.expiresAtTick)
      ) throw new Error("NATIONAL counterassessment: invalid restored shield");
      if (shield.effectiveTick <= now && now < shield.expiresAtTick) activeShields++;
      if (activeShields > MAX_ACTIVE_SHIELDS)
        throw new Error("NATIONAL counterassessment: restored active shield capacity exceeded");
      state.shields.push(shield);
      state.shieldIds.add(key);
    }
    return state;
  }
}

/**
 * One trusted recipient projector for human and bot. Reciprocal membership
 * is reevaluated every read, including crown change and dissolution.
 */
export function projectLiveNationalAssessments(
  game: Game,
  recipientId: string,
): readonly NationalAssessmentReport[] {
  if (!game.config().nationalMode() || !game.hasPlayer(recipientId)) return [];
  const recipient = game.player(recipientId);
  if (!recipient.isPlayer() || !recipient.isAlive() || !recipient.hasSpawned())
    return [];
  const auth = game.nationalPoliticalAuthority();
  const empire = auth?.empireOf(recipientId) ?? null;
  const members =
    empire === null || auth === null
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
      if (
        !game.hasPlayer(grant.targetId) ||
        !game.player(grant.targetId).isAlive() ||
        grant.effectiveTick > game.ticks() ||
        game.ticks() >= grant.expiresAtTick
      )
        continue;
      reports.push({
        targetId: grant.targetId,
        paidBy: payerId,
        confidence: grant.confidence ?? "coarse-estimate",
        effectiveTick: grant.effectiveTick,
        expiresAtTick: grant.expiresAtTick,
        treasuryGoldBand: { ...grant.treasuryGoldBand },
        militaryTroopsBand: { ...grant.militaryTroopsBand },
      });
    }
  }
  reports.sort(
    (a, b) =>
      a.targetId.localeCompare(b.targetId) ||
      a.paidBy.localeCompare(b.paidBy) ||
      a.effectiveTick - b.effectiveTick,
  );
  return reports;
}
