import { z } from "zod";

const publicId = z.string().min(1).max(256).refine((id) =>
  !Array.from(id).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
);
const prizeSchema = z.union([
  z.strictObject({ kind: z.literal("SovereignVictor"), nationId: publicId }),
  z.strictObject({
    kind: z.literal("ImperialVictor"),
    nationId: publicId,
    empireId: publicId,
  }),
  z.strictObject({
    kind: z.literal("EmpireVictor"),
    nationId: publicId,
    empireId: publicId,
  }),
]);

/** Public terminal result, captured when Game.setWinner actually executes. */
export const NationalConfirmedVictorySchema = z
  .strictObject({
    sovereignPowerCount: z.literal(1),
    resolved: z.literal(true),
    confirmedTick: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    prizes: z.array(prizeSchema).min(1).max(4096),
  })
  .refine(({ prizes }) => {
    const first = prizes[0];
    if (new Set(prizes.map((p) => p.nationId)).size !== prizes.length)
      return false;
    if (first.kind === "SovereignVictor") return prizes.length === 1;
    return (
      first.kind === "ImperialVictor" &&
      prizes
        .slice(1)
        .every(
          (p) => p.kind === "EmpireVictor" && p.empireId === first.empireId,
        )
    );
  }, "Invalid sovereign award roster");

export type NationalConfirmedVictory = z.infer<
  typeof NationalConfirmedVictorySchema
>;

export function readNationalConfirmedVictory(
  source: unknown,
  tick: number,
): NationalConfirmedVictory | null {
  if (!Number.isSafeInteger(tick) || tick < 0) return null;
  const parsed = NationalConfirmedVictorySchema.safeParse(source);
  return parsed.success && parsed.data.confirmedTick <= tick
    ? parsed.data
    : null;
}
