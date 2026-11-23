/**
 * C6 E1 client-only presentation boundary for E4's server-owned assessment.
 * Never calculate, project or persist enemy strength on the client.
 * E4 owns the authoritative Game debit, grant, report and wire contract.
 */
export const NATIONAL_ASSESSMENT_QUOTE = {
  cost: 1200n,
  durationTicks: 900,
} as const;

export interface NationalAssessmentPurchaseIntent {
  readonly type: "national_buy_national_assessment";
  readonly targetId: string;
  readonly requestId: string;
}

export interface NationalAssessmentBand {
  readonly lower: string;
  readonly upperExclusive: string;
}

export interface NationalAssessmentClientReport {
  readonly targetId: string;
  readonly paidBy: string;
  readonly confidence: "coarse-estimate" | "shielded-coarse-estimate";
  readonly effectiveTick: number;
  readonly expiresAtTick: number;
  readonly treasuryGoldBand: NationalAssessmentBand;
  readonly militaryTroopsBand: NationalAssessmentBand;
}

export interface NationalAssessmentClientView {
  readonly version: 1;
  readonly recipientId: string;
  readonly items: readonly NationalAssessmentClientReport[];
}

const nationalId = /^[A-Za-z0-9_-]{1,256}$/;
const requestId = /^[A-Za-z0-9_-]{1,128}$/;
const decimal = /^(0|[1-9][0-9]{0,29})$/;
const positiveDecimal = /^[1-9][0-9]{0,29}$/;

function record(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

function exactKeys(input: Record<string, unknown>, names: string[]): boolean {
  const keys = Object.keys(input);
  return keys.length === names.length && keys.every((key) => names.includes(key));
}

function safeTick(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Strip forged actor, price, clientID, hidden scope, and extra keys before Transport. */
export function parseNationalAssessmentPurchaseIntent(
  input: unknown,
): NationalAssessmentPurchaseIntent | null {
  if (!record(input) || !exactKeys(input, ["type", "targetId", "requestId"]))
    return null;
  if (
    input.type !== "national_buy_national_assessment" ||
    typeof input.targetId !== "string" ||
    !nationalId.test(input.targetId) ||
    typeof input.requestId !== "string" ||
    !requestId.test(input.requestId)
  )
    return null;
  return {
    type: "national_buy_national_assessment",
    targetId: input.targetId,
    requestId: input.requestId,
  };
}

function readBand(input: unknown, step: bigint): NationalAssessmentBand | null {
  if (
    !record(input) ||
    !exactKeys(input, ["lower", "upperExclusive"]) ||
    typeof input.lower !== "string" ||
    typeof input.upperExclusive !== "string" ||
    !decimal.test(input.lower) ||
    !positiveDecimal.test(input.upperExclusive)
  )
    return null;
  const low = BigInt(input.lower);
  const high = BigInt(input.upperExclusive);
  if (low % step !== 0n || high - low !== step) return null;
  return { lower: input.lower, upperExclusive: input.upperExclusive };
}

/**
 * Defense-in-depth after E4's authenticated recipient-wire validation.
 * Reject ALL malformed leases, not merely the first invalid row. Never cache a
 * different recipient, future report, expired grant or precise unbounded value.
 */
export function readNationalAssessmentView(
  input: unknown,
  actorId: string | null,
  tick: number,
): NationalAssessmentClientView | null {
  if (
    !actorId ||
    !safeTick(tick) ||
    !record(input) ||
    !exactKeys(input, ["version", "recipientId", "items"]) ||
    input.version !== 1 ||
    input.recipientId !== actorId ||
    !Array.isArray(input.items) ||
    input.items.length > 2048
  )
    return null;
  const seen = new Set<string>();
  const items: NationalAssessmentClientReport[] = [];
  for (const row of input.items as unknown[]) {
    if (
      !record(row) ||
      !exactKeys(row, [
        "targetId",
        "paidBy",
        "confidence",
        "effectiveTick",
        "expiresAtTick",
        "treasuryGoldBand",
        "militaryTroopsBand",
      ]) ||
      typeof row.targetId !== "string" ||
      !nationalId.test(row.targetId) ||
      typeof row.paidBy !== "string" ||
      !nationalId.test(row.paidBy) ||
      row.paidBy === row.targetId ||
      (row.confidence !== "coarse-estimate" &&
        row.confidence !== "shielded-coarse-estimate") ||
      !safeTick(row.effectiveTick) ||
      !safeTick(row.expiresAtTick) ||
      row.effectiveTick > tick ||
      tick >= row.expiresAtTick ||
      row.expiresAtTick !==
        row.effectiveTick + NATIONAL_ASSESSMENT_QUOTE.durationTicks
    )
      return null;
    // E4 C6 shields truthfully widen FUTURE reports; validate the exact
    // confidence-matched coarse interval, never accept forged precision.
    const shielded = row.confidence === "shielded-coarse-estimate";
    const treasuryGoldBand = readBand(row.treasuryGoldBand, shielded ? 10000n : 2500n);
    const militaryTroopsBand = readBand(row.militaryTroopsBand, shielded ? 400000n : 100000n);
    if (!treasuryGoldBand || !militaryTroopsBand) return null;
    const key = [row.targetId, row.paidBy, row.effectiveTick].join(":");
    if (seen.has(key)) return null;
    seen.add(key);
    items.push({
      targetId: row.targetId,
      paidBy: row.paidBy,
      confidence: row.confidence,
      effectiveTick: row.effectiveTick,
      expiresAtTick: row.expiresAtTick,
      treasuryGoldBand,
      militaryTroopsBand,
    });
  }
  return { version: 1, recipientId: actorId, items };
}

/** A report's existence is Game-owned; it is NOT an exact click receipt.
 * E4's current outbound DTO omits requestId (present in the internal ledger).
 */
export function assessmentReportKey(
  report: Pick<NationalAssessmentClientReport, "targetId" | "paidBy" | "effectiveTick">,
): string {
  return [report.targetId, report.paidBy, report.effectiveTick].join(":");
}
