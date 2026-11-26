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

// A strict, detached receipt; never accept unexpected properties from a wire.
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
function tick(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function readNationalSatelliteView(
  input: unknown,
  recipient: string | null,
  now: number,
): NationalSatelliteView | null {
  if (
    !recipient ||
    !tick(now) ||
    !record(input) ||
    !exact(input, ["version", "recipientId", "tick", "lease"]) ||
    input.version !== 1 ||
    input.recipientId !== recipient ||
    input.tick !== now
  )
    return null;
  const lease = input.lease;
  if (lease === null)
    return { version: 1, recipientId: recipient, tick: now, lease: null };
  if (
    !record(lease) ||
    !exact(lease, ["requestId", "cost", "effectiveTick", "expiresAtTick"]) ||
    typeof lease.requestId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(lease.requestId) ||
    lease.cost !== "25000" ||
    !tick(lease.effectiveTick) ||
    !tick(lease.expiresAtTick) ||
    lease.effectiveTick > now ||
    lease.expiresAtTick <= now ||
    lease.expiresAtTick - lease.effectiveTick !==
      NATIONAL_SATELLITE_DURATION_TICKS
  )
    return null;
  return {
    version: 1,
    recipientId: recipient,
    tick: now,
    lease: {
      requestId: lease.requestId,
      cost: "25000",
      effectiveTick: lease.effectiveTick,
      expiresAtTick: lease.expiresAtTick,
    },
  };
}

export function validateNationalSatellitePacket(
  input: unknown,
  recipient: string | null,
  now: number,
): void {
  if (
    input !== undefined &&
    readNationalSatelliteView(input, recipient, now) === null
  )
    throw new Error("NATIONAL satellite: invalid recipient receipt");
}
