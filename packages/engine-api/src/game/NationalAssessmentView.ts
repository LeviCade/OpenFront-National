import { z } from "zod";
import type { NationalAssessmentViewData } from "./GameUpdates";

/**
 * Host AND browser enforce identical strict assessment-only wire boundaries.
 * Neither side may receive a raw treasury, precise troop count, hidden
 * structure coordinates, request journal, covert treaties or Game snapshot.
 */
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nation = z.string().min(1).max(256);
const band = z
  .object({
    lower: z.string().regex(/^(0|[1-9][0-9]{0,29})$/),
    upperExclusive: z.string().regex(/^[1-9][0-9]{0,29}$/),
  })
  .strict();
export const NationalAssessmentViewSchema = z
  .object({
    version: z.literal(1),
    recipientId: nation,
    items: z
      .array(
        z
          .object({
            targetId: nation,
            paidBy: nation,
            confidence: z.literal("coarse-estimate"),
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
  for (const grant of report.items) {
    if (
      grant.paidBy === grant.targetId ||
      grant.effectiveTick > packetTick ||
      packetTick >= grant.expiresAtTick ||
      grant.expiresAtTick !== grant.effectiveTick + 900 ||
      BigInt(grant.treasuryGoldBand.upperExclusive) -
        BigInt(grant.treasuryGoldBand.lower) !==
        2500n ||
      BigInt(grant.militaryTroopsBand.upperExclusive) -
        BigInt(grant.militaryTroopsBand.lower) !==
        100000n ||
      BigInt(grant.treasuryGoldBand.lower) % 2500n !== 0n ||
      BigInt(grant.militaryTroopsBand.lower) % 100000n !== 0n
    )
      throw new Error("NATIONAL assessment: invalid coarse lease");
  }
}
