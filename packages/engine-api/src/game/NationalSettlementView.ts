import { z } from "zod";

const id = z.string().min(1).max(256);
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const gold = z.string().regex(/^[1-9][0-9]{0,17}$/);
const offerSchema = z
  .object({
    requestId: id,
    gold,
    offeredAt: tick,
    expiresAt: tick,
    status: z.enum(["pending", "accepted", "refused", "expired"]),
  })
  .strict();
const rowSchema = z
  .object({
    sanctionId: id,
    payerId: id,
    issuerId: id,
    role: z.enum(["payer", "issuer"]),
    canOffer: z.boolean(),
    canAccept: z.boolean(),
    canRefuse: z.boolean(),
    tradePermitted: z.boolean(),
    offer: offerSchema.nullable(),
    lastPaidCommerce: z.object({
      tick,
      counterpartyId: id,
      grossGold: z.string().regex(/^[1-9][0-9]{0,127}$/),
    }).strict().nullable(),
  })
  .strict();
const schema = z
  .object({
    version: z.literal(1),
    recipientId: id,
    tick,
    streamId: z.string().min(1).max(256).optional(),
    paidMaritimeGold: z.string().regex(/^(0|[1-9][0-9]{0,39})$/),
    items: z.array(rowSchema).max(2048),
  })
  .strict();

export type NationalSettlementRow = z.infer<typeof rowSchema>;
export type NationalSettlementView = z.infer<typeof schema>;

/** Only the host's current authenticated seat may receive or retain a row. */
export function readNationalSettlementView(
  raw: unknown,
  actor: string | null,
  packetTick: number,
  streamId?: string | null,
): NationalSettlementView | null {
  const parsed = schema.safeParse(raw);
  if (
    !parsed.success ||
    actor === null ||
    streamId === null ||
    parsed.data.recipientId !== actor ||
    parsed.data.tick !== packetTick ||
    parsed.data.streamId !== streamId
  )
    return null;
  const seen = new Set<string>();
  for (const row of parsed.data.items) {
    const key = JSON.stringify([row.sanctionId, row.payerId]);
    const offer = row.offer;
    if (
      seen.has(key) ||
      row.payerId === row.issuerId ||
      (row.role === "payer" ? row.payerId : row.issuerId) !== actor ||
      (row.canOffer && (row.role !== "payer" || offer !== null)) ||
      ((row.canAccept || row.canRefuse) &&
        (row.role !== "issuer" ||
          offer?.status !== "pending" ||
          offer.expiresAt <= packetTick)) ||
      (row.lastPaidCommerce !== null &&
        (offer?.status !== "accepted" ||
          row.lastPaidCommerce.counterpartyId === row.payerId ||
          row.lastPaidCommerce.tick < offer.offeredAt ||
          row.lastPaidCommerce.tick > packetTick)) ||
      (offer !== null &&
        (offer.offeredAt > packetTick ||
          offer.expiresAt !== offer.offeredAt + 120 ||
          (offer.status === "pending" && offer.expiresAt <= packetTick)))
    )
      return null;
    seen.add(key);
  }
  return parsed.data;
}

export function validateNationalSettlementPacket(
  raw: unknown,
  actor: string | null,
  packetTick: number,
  streamId?: string,
): void {
  if (
    raw !== undefined &&
    readNationalSettlementView(raw, actor, packetTick, streamId) === null
  )
    throw new Error("NATIONAL invalid private sanction settlement disclosure");
}
