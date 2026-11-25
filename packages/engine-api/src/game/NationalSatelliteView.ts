/** Global geographic asset reconnaissance; no foreign resources or destinations. */
export const NATIONAL_SATELLITE_COST = 25_000n;
export const NATIONAL_SATELLITE_DURATION_TICKS = 300;
export const NATIONAL_SATELLITE_REQUEST_WINDOW = 100;

export interface NationalSatelliteLease {
  readonly requestId: string;
  readonly cost: "25000";
  readonly effectiveTick: number;
  readonly expiresAtTick: number;
}

export interface NationalSatelliteView {
  readonly version: 1;
  readonly recipientId: string;
  readonly tick: number;
  readonly lease: NationalSatelliteLease | null;
}

export interface NationalSatelliteAdmission {
  readonly issuedTick: number;
  readonly empireId: string | null;
  readonly policyVersion: number | null;
}
