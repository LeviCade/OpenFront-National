import {
  NationalIssueUltimatumIntentSchema,
  NationalRespondUltimatumIntentSchema,
  NationalResolveUltimatumIntentSchema,
  type Intent,
} from "@openfront/engine-api/Schemas";
import type { NationalUltimatumViewData } from "@openfront/engine-api/game/GameUpdates";
import {
  NATIONAL_RECON_COST,
  NATIONAL_RECON_DURATION_TICKS,
  NATIONAL_RECON_RADIUS,
  type NationalReconnaissanceViewData,
} from "@openfront/engine-api/game/NationalReconView";

const receiptId = /^np_[0-9a-f]{32}$/;
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const natural = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export const nationalReconQuote = Object.freeze({
  cost: NATIONAL_RECON_COST,
  radius: NATIONAL_RECON_RADIUS,
  durationTicks: NATIONAL_RECON_DURATION_TICKS,
});

/** Exact-shape client command. Zod alone strips forged extras. */
export function parseNationalUltimatumIntent(candidate: unknown): Intent | null {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate))
    return null;
  const data = candidate as Record<string, unknown>;
  const shape =
    data.type === "national_issue_ultimatum"
      ? ["type", "empireId", "targetId", "threat", "durationTicks", "requestId"]
      : data.type === "national_respond_ultimatum" ||
          data.type === "national_resolve_ultimatum"
        ? ["type", "ultimatumId", "decision", "requestId"]
        : null;
  if (
    shape === null ||
    Object.keys(data).length !== shape.length ||
    Object.keys(data).some((key) => !shape.includes(key))
  )
    return null;
  const parsed =
    data.type === "national_issue_ultimatum"
      ? NationalIssueUltimatumIntentSchema.safeParse(data)
      : data.type === "national_respond_ultimatum"
        ? NationalRespondUltimatumIntentSchema.safeParse(data)
        : NationalResolveUltimatumIntentSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Reject missing, outsider, future, stale and impossible private disclosures. */
export function readNationalUltimatumView(
  input: unknown,
  actorId: string | null,
  currentTick: number,
): NationalUltimatumViewData | null {
  if (!actorId || !natural(currentTick) || !input || typeof input !== "object")
    return null;
  const v = input as Partial<NationalUltimatumViewData>;
  if (
    v.version !== 1 ||
    v.recipientId !== actorId ||
    !Array.isArray(v.items) ||
    v.items.length > 128
  )
    return null;
  const ids = new Set<string>();
  const phases = new Set(["pending", "consented", "decision-required", "acceded", "enforced", "backed-down", "withdrawn", "expired"]);
  const valid = v.items.every((row) => {
    if (!row || !validId(row.id) || ids.has(row.id) ||
      !validId(row.issuerId) || !validId(row.targetId) || !validId(row.empireId) ||
      (row.role === "issuer" ? row.issuerId !== actorId : row.role !== "recipient" || row.targetId !== actorId) ||
      (row.threat !== "embargo" && row.threat !== "imperial-war") ||
      !natural(row.issuedTick) || !natural(row.deadlineTick) ||
      row.issuedTick > currentTick || row.deadlineTick <= row.issuedTick ||
      !phases.has(row.phase) ||
      !["none", "accept", "refuse"].includes(row.response) ||
      !["pending", "kept", "broken", "void"].includes(row.credibility) ||
      !Number.isSafeInteger(row.version) || row.version < 1 ||
      (row.warId !== null && !validId(row.warId)) ||
      !Array.isArray(row.imposedMembers) ||
      row.imposedMembers.length > 128 ||
      row.imposedMembers.some((id) => !validId(id)) ||
      (row.requestId !== null && (row.role !== "issuer" || !receiptId.test(row.requestId))) ||
      !Array.isArray(row.acknowledgedRequestIds) ||
      row.acknowledgedRequestIds.length > 64 ||
      row.acknowledgedRequestIds.some((id) => typeof id !== "string" || !receiptId.test(id)))
      return false;
    ids.add(row.id);
    return true;
  });
  return valid ? (v as NationalUltimatumViewData) : null;
}

export function readNationalReconnaissanceView(
  input: unknown,
  actorId: string | null,
  currentTick: number,
): NationalReconnaissanceViewData | null {
  if (!actorId || !natural(currentTick) || !input || typeof input !== "object")
    return null;
  const v = input as Partial<NationalReconnaissanceViewData>;
  if (v.version !== 1 || v.recipientId !== actorId || v.tick !== currentTick ||
      !Array.isArray(v.grants) || v.grants.length > 4096)
    return null;
  const ids = new Set<string>();
  for (const g of v.grants) {
    if (!g || !receiptId.test(g.requestId) || ids.has(g.requestId) ||
      !validId(g.targetId) || g.targetId === actorId ||
      !natural(g.centerX) || !natural(g.centerY) ||
      g.radius !== NATIONAL_RECON_RADIUS ||
      g.cost !== NATIONAL_RECON_COST.toString() ||
      !natural(g.effectiveTick) || !natural(g.expiresAtTick) ||
      g.effectiveTick > currentTick || g.expiresAtTick <= currentTick ||
      g.expiresAtTick - g.effectiveTick !== NATIONAL_RECON_DURATION_TICKS)
      return null;
    ids.add(g.requestId);
  }
  return v as NationalReconnaissanceViewData;
}
