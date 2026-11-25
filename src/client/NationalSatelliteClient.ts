import {
  NationalSatelliteIntentSchema,
  type NationalSatelliteIntent,
} from "@openfront/engine-api/Schemas";

export function parseNationalSatelliteIntent(
  input: unknown,
): NationalSatelliteIntent | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const keys = Object.keys(input);
  if (
    keys.length !== 4 ||
    keys.some(
      (key) => !["type", "gameId", "issuedTick", "requestId"].includes(key),
    )
  )
    return null;
  const parsed = NationalSatelliteIntentSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
