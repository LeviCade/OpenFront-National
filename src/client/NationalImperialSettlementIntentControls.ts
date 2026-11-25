import type { NationalSettlementRow } from "@openfront/engine-api/game/NationalSettlementView";
import { IntentSchema, type Intent } from "@openfront/engine-api/Schemas";

export function settlementOfferIntent(
  row: NationalSettlementRow,
  actor: string,
  wallet: bigint,
  amount: unknown,
  requestId: string,
): Intent | null {
  if (
    row.role !== "payer" || row.payerId !== actor ||
    !row.canOffer || row.offer !== null ||
    typeof amount !== "string" || !/^[1-9][0-9]{0,17}$/.test(amount) ||
    BigInt(amount) > wallet
  ) return null;
  const result = IntentSchema.safeParse({
    type: "national_offer_sanction_settlement",
    sanctionId: row.sanctionId,
    amountGold: amount,
    requestId,
  });
  return result.success ? result.data : null;
}

export function settlementDecisionIntent(
  row: NationalSettlementRow,
  actor: string,
  tick: number,
  decision: "accept" | "refuse",
  requestId: string,
): Intent | null {
  if (
    row.role !== "issuer" || row.issuerId !== actor ||
    row.payerId === actor || row.offer?.status !== "pending" ||
    row.offer.expiresAt <= tick ||
    !(decision === "accept" ? row.canAccept : row.canRefuse)
  ) return null;
  const result = IntentSchema.safeParse({
    type: "national_decide_sanction_settlement",
    sanctionId: row.sanctionId,
    recipientId: row.payerId,
    offerId: row.offer.requestId,
    decision,
    requestId,
  });
  return result.success ? result.data : null;
}
