/** Server-owned NATIONAL reconnaissance quote and own-lease receipt. */
export const NATIONAL_RECON_COST = 500n;
export const NATIONAL_RECON_RADIUS = 90;
export const NATIONAL_RECON_DURATION_TICKS = 600;

/** Only the authenticated purchaser receives this record, never outsiders. */
export interface NationalReconnaissanceViewData {
  readonly version: 1;
  readonly recipientId: string;
  readonly tick: number;
  readonly grants: readonly {
    readonly requestId: string;
    readonly targetId: string;
    readonly centerX: number;
    readonly centerY: number;
    readonly radius: typeof NATIONAL_RECON_RADIUS;
    readonly cost: "500";
    readonly effectiveTick: number;
    readonly expiresAtTick: number;
  }[];
}
