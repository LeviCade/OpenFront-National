import { z } from "zod";
import type { NationalAssessmentViewData } from "./GameUpdates";

/**
 * Host AND browser enforce identical strict assessment-only wire boundaries.
 * Neither side may receive a raw treasury, precise troop count, hidden
 * structure coordinates, foreign purchase receipts, covert treaties or Game snapshot.
 */
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nation = z.string().min(1).max(256);
const band = z
  .object({
    lower: z.string().regex(/^(0|[1-9][0-9]{0,29})$/),
    upperExclusive: z.string().regex(/^[1-9][0-9]{0,29}$/),
  })
  .strict();
const receiptIdentity = {
  requestId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  payerId: nation,
  targetId: nation,
  effectiveTick: tick,
};
export const NationalAssessmentRejectedReceiptSchema = z
  .object({
    ...receiptIdentity,
    outcome: z.literal("rejected"),
    cost: z.literal("0"),
  })
  .strict();
export const NationalAssessmentReceiptSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      ...receiptIdentity,
      outcome: z.literal("accepted"),
      cost: z.literal("1200"),
    })
    .strict(),
  NationalAssessmentRejectedReceiptSchema,
]);
export type NationalAssessmentReceipt = z.infer<
  typeof NationalAssessmentReceiptSchema
>;
export const NationalAssessmentViewSchema = z
  .object({
    version: z.literal(1),
    recipientId: nation,
    receipts: z.array(NationalAssessmentReceiptSchema).max(8192).optional(),
    items: z
      .array(
        z
          .object({
            targetId: nation,
            paidBy: nation,
            confidence: z.enum(["coarse-estimate", "shielded-coarse-estimate"]),
            effectiveTick: tick,
            expiresAtTick: tick,
            treasuryGoldBand: band,
            militaryTroopsBand: band,
          })
          .strict(),
      )
      .max(2048),
  })
  .strict();

/** Fail closed when a public frame or another private seat receives reports. */
export function validateNationalAssessmentPacket(
  raw: unknown,
  authenticatedRecipientId: string | null,
  packetTick: number,
): asserts raw is NationalAssessmentViewData | undefined {
  if (raw === undefined) return;
  const report = NationalAssessmentViewSchema.parse(raw);
  if (
    authenticatedRecipientId === null ||
    report.recipientId !== authenticatedRecipientId
  )
    throw new Error("NATIONAL assessment: invalid recipient");
  const requests = new Set<string>();
  for (const receipt of report.receipts ?? []) {
    if (
      receipt.payerId !== authenticatedRecipientId ||
      receipt.effectiveTick > packetTick ||
      packetTick - receipt.effectiveTick >= 900 ||
      requests.has(receipt.requestId) ||
      (receipt.outcome === "accepted" && receipt.payerId === receipt.targetId)
    )
      throw new Error("NATIONAL assessment: invalid private purchase receipt");
    requests.add(receipt.requestId);
  }
  for (const grant of report.items) {
    const shielded = grant.confidence === "shielded-coarse-estimate";
    const goldStep = shielded ? 10000n : 2500n;
    const troopStep = shielded ? 400000n : 100000n;
    if (
      grant.paidBy === grant.targetId ||
      grant.effectiveTick > packetTick ||
      packetTick >= grant.expiresAtTick ||
      grant.expiresAtTick !== grant.effectiveTick + 900 ||
      BigInt(grant.treasuryGoldBand.upperExclusive) -
        BigInt(grant.treasuryGoldBand.lower) !==
        goldStep ||
      BigInt(grant.militaryTroopsBand.upperExclusive) -
        BigInt(grant.militaryTroopsBand.lower) !==
        troopStep ||
      BigInt(grant.treasuryGoldBand.lower) % goldStep !== 0n ||
      BigInt(grant.militaryTroopsBand.lower) % troopStep !== 0n
    )
      throw new Error("NATIONAL assessment: invalid coarse lease");
  }
}
