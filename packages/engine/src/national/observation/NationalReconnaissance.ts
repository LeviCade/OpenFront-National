import {
  NATIONAL_RECON_COST,
  NATIONAL_RECON_RADIUS,
  NATIONAL_RECON_DURATION_TICKS,
} from "@openfront/engine-api/game/NationalReconView";
import { z } from "zod";

/**
 * M7 paid NATIONAL regional reconnaissance. Gold remains solely in Player;
 * this durable ledger holds purchased authority, never a second wallet.
 *
 * Tick interval is half-open [effectiveTick, expiresAtTick). A replayed
 * purchase ID remains spent even after its grant expires or the Game restores.
 */
export const REGIONAL_RECON_COST = NATIONAL_RECON_COST;
export const REGIONAL_RECON_RADIUS = NATIONAL_RECON_RADIUS;
export const REGIONAL_RECON_DURATION_TICKS = NATIONAL_RECON_DURATION_TICKS;
const MAX_RECON_PURCHASES = 4096;
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const tick = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const grantSchema = z.object({
  requestId: id,
  payerId: z.string().min(1).max(256),
  targetId: z.string().min(1).max(256),
  centerX: tick,
  centerY: tick,
  radius: z.literal(REGIONAL_RECON_RADIUS),
  cost: z.literal("500"),
  effectiveTick: tick,
  expiresAtTick: tick,
});
export type RegionalReconGrant = z.infer<typeof grantSchema>;
export const NationalReconnaissanceSnapshotSchema = z.object({
  version: z.literal(1),
  grants: z.array(grantSchema).max(MAX_RECON_PURCHASES),
});
export type NationalReconnaissanceSnapshot = z.infer<
  typeof NationalReconnaissanceSnapshotSchema
>;

export class NationalReconnaissance {
  private grants: RegionalReconGrant[] = [];
  private ids = new Set<string>();
  private byPayer = new Map<string, RegionalReconGrant[]>();

  private key(payerId: string, requestId: string): string {
    // Length-prefix avoids delimiter collisions with legitimate player IDs.
    return payerId.length + ":" + payerId + ":" + requestId;
  }

  /**
   * Trusted GameImpl calls charge only after all validations. Its callback
   * removes exactly 500 GOLD from the registered live Player, atomically
   * with adding the grant in one deterministic engine turn.
   */
  buy(
    payerId: string,
    targetId: string,
    centerX: number,
    centerY: number,
    currentTick: number,
    requestId: string,
    charge: () => void,
  ): RegionalReconGrant {
    id.parse(requestId);
    if (
      typeof payerId !== "string" ||
      !payerId ||
      typeof targetId !== "string" ||
      !targetId ||
      payerId === targetId ||
      !Number.isSafeInteger(centerX) ||
      centerX < 0 ||
      !Number.isSafeInteger(centerY) ||
      centerY < 0 ||
      !Number.isSafeInteger(currentTick) ||
      currentTick < 0 ||
      !Number.isSafeInteger(currentTick + REGIONAL_RECON_DURATION_TICKS)
    ) {
      throw new Error("NATIONAL recon: invalid purchase parameters");
    }
    const key = this.key(payerId, requestId);
    if (this.ids.has(key))
      throw new Error("NATIONAL recon: duplicate request (already processed)");
    if (this.grants.length >= MAX_RECON_PURCHASES)
      throw new Error("NATIONAL recon: purchase journal exhausted");
    const grant = grantSchema.parse({
      requestId,
      payerId,
      targetId,
      centerX,
      centerY,
      radius: REGIONAL_RECON_RADIUS,
      cost: REGIONAL_RECON_COST.toString(),
      effectiveTick: currentTick,
      expiresAtTick: currentTick + REGIONAL_RECON_DURATION_TICKS,
    });
    // A failing debit must not commit a lease or an idempotence key.
    charge();
    this.grants.push(grant);
    this.ids.add(key);
    const owned = this.byPayer.get(payerId) ?? [];
    owned.push(grant);
    this.byPayer.set(payerId, owned);
    return { ...grant };
  }

  /** Only active, own-paid leases. Empire sharing is checked LIVE by FOG. */
  activeFor(
    payerId: string,
    currentTick: number,
  ): readonly RegionalReconGrant[] {
    return (this.byPayer.get(payerId) ?? [])
      .filter(
        (g) => g.effectiveTick <= currentTick && currentTick < g.expiresAtTick,
      )
      .map((g) => ({ ...g }));
  }

  snapshot(): NationalReconnaissanceSnapshot {
    return NationalReconnaissanceSnapshotSchema.parse({
      version: 1,
      grants: this.grants,
    });
  }

  static restore(raw: unknown, currentTick: number): NationalReconnaissance {
    const state = NationalReconnaissanceSnapshotSchema.parse(raw);
    const service = new NationalReconnaissance();
    for (const g of state.grants) {
      const key = service.key(g.payerId, g.requestId);
      if (
        g.payerId === g.targetId ||
        service.ids.has(key) ||
        g.effectiveTick > currentTick ||
        g.expiresAtTick !== g.effectiveTick + REGIONAL_RECON_DURATION_TICKS
      )
        throw new Error("NATIONAL recon: invalid restored grant");
      service.grants.push({ ...g });
      service.ids.add(key);
      const own = service.byPayer.get(g.payerId) ?? [];
      own.push({ ...g });
      service.byPayer.set(g.payerId, own);
    }
    return service;
  }
}
