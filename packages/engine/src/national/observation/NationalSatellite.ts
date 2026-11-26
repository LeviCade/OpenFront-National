import {
  NATIONAL_SATELLITE_COST,
  NATIONAL_SATELLITE_DURATION_TICKS,
  type NationalSatelliteLease,
} from "@openfront/engine-api/game/NationalSatelliteView";
import { z } from "zod";

const MAX_ATTEMPTS = 4096;
const MAX_PER_PAYER = 64;
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const request = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const payer = z.string().min(1).max(256);

export const SatelliteAttemptSchema = z.object({
  payerId: payer,
  requestId: request,
  effectiveTick: tick,
  accepted: z.boolean(),
});
export const SatelliteJournalSchema = z
  .array(SatelliteAttemptSchema)
  .max(MAX_ATTEMPTS);
type Attempt = z.infer<typeof SatelliteAttemptSchema>;

/** One active lease per payer; durable accepted AND denied identities.
 * Exhaustion fails closed rather than recycling a potentially replayed ID.
 */
export class NationalSatelliteJournal {
  private readonly attempts: Attempt[] = [];
  private readonly byPayer = new Map<string, Map<string, Attempt>>();
  private readonly latest = new Map<string, Attempt>();

  private append(attempt: Attempt): void {
    const own = this.byPayer.get(attempt.payerId) ?? new Map<string, Attempt>();
    if (
      own.has(attempt.requestId) ||
      own.size >= MAX_PER_PAYER ||
      this.attempts.length >= MAX_ATTEMPTS
    )
      throw new Error("NATIONAL satellite: duplicate or exhausted journal");
    this.attempts.push(attempt);
    own.set(attempt.requestId, attempt);
    this.byPayer.set(attempt.payerId, own);
    if (attempt.accepted) this.latest.set(attempt.payerId, attempt);
  }

  activeFor(payerId: string, now: number): NationalSatelliteLease | null {
    const a = this.latest.get(payerId);
    if (
      a === undefined ||
      a.effectiveTick > now ||
      now >= a.effectiveTick + NATIONAL_SATELLITE_DURATION_TICKS
    )
      return null;
    return {
      requestId: a.requestId,
      cost: "25000",
      effectiveTick: a.effectiveTick,
      expiresAtTick: a.effectiveTick + NATIONAL_SATELLITE_DURATION_TICKS,
    };
  }

  buy(
    payerId: string,
    requestId: string,
    now: number,
    charge: (cost: bigint) => void,
  ): NationalSatelliteLease {
    const a = SatelliteAttemptSchema.parse({
      payerId,
      requestId,
      effectiveTick: now,
      accepted: false,
    });
    if (!Number.isSafeInteger(now + NATIONAL_SATELLITE_DURATION_TICKS))
      throw new Error("NATIONAL satellite: tick overflow");
    // Check every capacity and identity before attempting a debit.
    const own = this.byPayer.get(payerId);
    if (
      own?.has(requestId) ||
      (own?.size ?? 0) >= MAX_PER_PAYER ||
      this.attempts.length >= MAX_ATTEMPTS
    )
      throw new Error("NATIONAL satellite: duplicate or exhausted journal");
    if (this.activeFor(payerId, now) !== null) {
      this.append(a);
      throw new Error("NATIONAL satellite: lease already active");
    }
    try {
      charge(NATIONAL_SATELLITE_COST);
    } catch (error) {
      this.append(a);
      throw error;
    }
    this.append({ ...a, accepted: true });
    return this.activeFor(payerId, now)!;
  }

  snapshot(): Attempt[] {
    return this.attempts.map((a) => ({ ...a }));
  }

  static restore(raw: unknown, now: number): NationalSatelliteJournal {
    const journal = new NationalSatelliteJournal();
    let priorTick = -1;
    for (const a of SatelliteJournalSchema.parse(raw)) {
      if (
        a.effectiveTick < priorTick ||
        a.effectiveTick > now ||
        !Number.isSafeInteger(
          a.effectiveTick + NATIONAL_SATELLITE_DURATION_TICKS,
        ) ||
        (a.accepted && journal.activeFor(a.payerId, a.effectiveTick) !== null)
      )
        throw new Error("NATIONAL satellite: invalid restored journal");
      journal.append(a);
      priorTick = a.effectiveTick;
    }
    return journal;
  }
}
