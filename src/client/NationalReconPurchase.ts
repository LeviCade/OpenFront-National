import {
  NationalReconnaissanceIntentSchema,
  type NationalReconnaissanceIntent,
} from "@openfront/engine-api/Schemas";

/**
 * Fail-closed client ingress for the already-canonical regional recon command.
 * No client may choose a price, duration, payer, actor, visibility scope or
 * server principal. Transport and Game enforce real authority independently.
 *
 * The E1 native purchase UI may call this helper after checking its own
 * currently visible public target list and the user's selected map center.
 */
export function parseNationalReconnaissanceIntent(
  candidate: unknown,
): NationalReconnaissanceIntent | null {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  )
    return null;
  const keys = Object.keys(candidate);
  if (
    keys.length !== 5 ||
    keys.some(
      (key) =>
        key !== "type" &&
        key !== "targetId" &&
        key !== "centerX" &&
        key !== "centerY" &&
        key !== "requestId",
    )
  )
    return null;
  const checked = NationalReconnaissanceIntentSchema.safeParse(candidate);
  return checked.success ? checked.data : null;
}
